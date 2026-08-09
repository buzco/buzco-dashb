import "server-only";

import { shopifyGraphQL } from "@/lib/shopify/client";
import { createClient } from "@/lib/supabase/server";
import { listProductImageObjects, isOurStorageUrl, baseName } from "@/lib/product-images";

// Push a local product to Shopify as a DRAFT (invisible to customers until the
// user publishes it there). Uses productSet to declare options + variants +
// SKUs + prices in one call, then links the returned Shopify IDs back onto our
// rows. Only creates — a product already linked to Shopify is left alone (guards
// against duplicates).

export type PushResult = {
  productGid: string;
  variantsLinked: number;
  images?: ImagePushResult;
  imageError?: string;
};

const PRODUCT_SET = `
  mutation PushProduct($input: ProductSetInput!) {
    productSet(synchronous: true, input: $input) {
      product {
        id
        variants(first: 100) { edges { node { id sku } } }
      }
      userErrors { field message }
    }
  }
`;

export async function pushProductToShopify(productId: string): Promise<PushResult> {
  const supabase = await createClient();

  const { data: product, error: pErr } = await supabase
    .from("products")
    .select("id, name, description, status, tags, shopify_product_id")
    .eq("id", productId)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  if (!product) throw new Error("Product not found");
  if (product.shopify_product_id) throw new Error("This product is already linked to Shopify");

  const { data: variants } = await supabase
    .from("variants")
    .select("id, sku, size, color, retail_price")
    .eq("product_id", productId);
  if (!variants?.length) throw new Error("Add at least one variant before pushing");

  const sizes = [...new Set(variants.map((v) => v.size).filter(Boolean) as string[])];
  const colors = [...new Set(variants.map((v) => v.color).filter(Boolean) as string[])];

  const productOptions: Array<{ name: string; values: Array<{ name: string }> }> = [];
  if (sizes.length) productOptions.push({ name: "Size", values: sizes.map((s) => ({ name: s })) });
  if (colors.length) productOptions.push({ name: "Color", values: colors.map((c) => ({ name: c })) });

  const setVariants = variants.map((v) => {
    const optionValues: Array<{ optionName: string; name: string }> = [];
    if (v.size) optionValues.push({ optionName: "Size", name: v.size });
    if (v.color) optionValues.push({ optionName: "Color", name: v.color });
    return {
      ...(optionValues.length ? { optionValues } : {}),
      price: v.retail_price != null ? String(v.retail_price) : "0.00",
      inventoryItem: { sku: v.sku, tracked: true },
    };
  });

  const input = {
    title: product.name,
    // Mirror our own status rather than always pushing DRAFT: a product marked
    // active here is one you've decided to sell, and silently landing it as a
    // draft means it never appears in the storefront until someone notices.
    status: product.status === "active" ? "ACTIVE" : "DRAFT",
    descriptionHtml: product.description ? `<p>${product.description}</p>` : undefined,
    tags: product.tags ?? undefined,
    ...(productOptions.length ? { productOptions } : {}),
    variants: setVariants,
  };

  const data = await shopifyGraphQL<{
    productSet: {
      product: { id: string; variants: { edges: Array<{ node: { id: string; sku: string | null } }> } } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(PRODUCT_SET, { input });

  const { productSet } = data;
  if (productSet.userErrors.length) {
    throw new Error(productSet.userErrors.map((e) => e.message).join("; "));
  }
  if (!productSet.product) throw new Error("Shopify returned no product");

  // Link IDs back: product, and each variant by SKU.
  await supabase
    .from("products")
    .update({ shopify_product_id: productSet.product.id })
    .eq("id", productId);

  const shopVariantBySku = new Map(
    productSet.product.variants.edges
      .filter((e) => e.node.sku)
      .map((e) => [e.node.sku as string, e.node.id]),
  );
  let variantsLinked = 0;
  for (const v of variants) {
    const gid = shopVariantBySku.get(v.sku);
    if (gid) {
      await supabase.from("variants").update({ shopify_variant_id: gid }).eq("id", v.id);
      variantsLinked++;
    }
  }

  // The product existing matters more than its pictures, so an image failure
  // doesn't undo the push — but it is reported rather than swallowed. Silently
  // discarding this is exactly what hid the images never arriving at all.
  let imageError: string | undefined;
  let images: ImagePushResult | undefined;
  try {
    images = await pushProductImages(supabase, productId);
    if (images.errors.length) imageError = images.errors.join("; ");
  } catch (e) {
    imageError = e instanceof Error ? e.message : String(e);
  }

  return { productGid: productSet.product.id, variantsLinked, images, imageError };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

// `productCreateMedia` was removed in API 2025-10. Media is now attached by
// passing it alongside productUpdate, which takes `media` as its own argument
// rather than a field on the input. Calling the old mutation failed outright,
// and because the caller swallowed image errors, uploads silently never
// reached the store.
const PRODUCT_ADD_MEDIA = `
  mutation AddProductMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]!) {
    productUpdate(product: $product, media: $media) {
      product {
        id
        media(first: 100) {
          edges { node { ... on MediaImage { id status image { url } } } }
        }
      }
      userErrors { field message }
    }
  }
`;

const PRODUCT_MEDIA = `
  query ProductMedia($id: ID!) {
    product(id: $id) {
      media(first: 100) {
        edges { node { ... on MediaImage { id status image { url } } } }
      }
    }
  }
`;

const REORDER_MEDIA = `
  mutation ReorderMedia($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) {
      userErrors { field message }
    }
  }
`;

const VARIANT_MEDIA = `
  mutation AttachVariantMedia($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }
`;

const MEDIA_STATUS = `
  query MediaStatus($id: ID!) {
    node(id: $id) { ... on MediaImage { id status } }
  }
`;

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

export type ImagePushResult = {
  created: number;
  alreadyThere: number;
  variantsWithImage: number;
  featuredSet: boolean;
  errors: string[];
};

/**
 * Sends our images to Shopify by URL.
 *
 * The images already live in public Supabase Storage, so Shopify can fetch them
 * itself via `originalSource` — which sidesteps the staged-upload dance the
 * Files API would otherwise require.
 *
 * Safe to re-run: Shopify keeps the source filename in the CDN URL it hands
 * back, so anything already on the product is recognised and skipped instead of
 * being uploaded a second time. That matters because this runs after every
 * upload batch, not just on first push.
 *
 * Only our own storage URLs are sent. After a sync, `image_url` holds a
 * cdn.shopify.com URL, and pushing those back would have Shopify re-ingest its
 * own images as duplicates.
 */
export async function pushProductImages(
  supabase: SupabaseLike,
  productId: string,
): Promise<ImagePushResult> {
  const result: ImagePushResult = {
    created: 0,
    alreadyThere: 0,
    variantsWithImage: 0,
    featuredSet: false,
    errors: [],
  };

  const { data: product } = await supabase
    .from("products")
    .select("id, name, image_url, shopify_product_id")
    .eq("id", productId)
    .maybeSingle();
  if (!product?.shopify_product_id) throw new Error("Product isn't linked to Shopify yet");

  const { data: variants } = await supabase
    .from("variants")
    .select("id, color, size, image_url, shopify_variant_id")
    .eq("product_id", productId);

  // Candidates: every picture in the product's gallery, plus any variant shot.
  const candidates: Array<{ url: string; alt: string }> = [];
  const seen = new Set<string>();
  const add = (url: string | null, alt: string) => {
    if (!isOurStorageUrl(url) || seen.has(url!)) return;
    seen.add(url!);
    candidates.push({ url: url!, alt });
  };
  for (const image of await listProductImageObjects(productId)) {
    add(image.url, product.name);
  }
  for (const v of variants ?? []) {
    add(v.image_url, [product.name, v.color, v.size].filter(Boolean).join(" — "));
  }
  if (!candidates.length) return result;

  // What's on the product already, by filename.
  const existing = await shopifyGraphQL<{
    product: { media: { edges: Array<{ node: { id: string; image: { url: string } | null } }> } } | null;
  }>(PRODUCT_MEDIA, { id: product.shopify_product_id });

  const mediaIdByFileName = new Map<string, string>();
  for (const edge of existing.product?.media.edges ?? []) {
    const name = baseName(edge.node.image?.url);
    if (name) mediaIdByFileName.set(name, edge.node.id);
  }

  const toCreate = candidates.filter((c) => {
    const name = baseName(c.url);
    return name ? !mediaIdByFileName.has(name) : true;
  });
  result.alreadyThere = candidates.length - toCreate.length;

  if (toCreate.length) {
    const added = await shopifyGraphQL<{
      productUpdate: {
        product: { media: { edges: Array<{ node: { id: string; image: { url: string } | null } }> } } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(PRODUCT_ADD_MEDIA, {
      product: { id: product.shopify_product_id },
      media: toCreate.map((c) => ({
        originalSource: c.url,
        alt: c.alt,
        mediaContentType: "IMAGE",
      })),
    });

    if (added.productUpdate.userErrors.length) {
      result.errors.push(...added.productUpdate.userErrors.map((e) => e.message));
    } else {
      result.created = toCreate.length;
    }

    // Media are ingested asynchronously; nothing can be attached to a variant
    // or reordered until Shopify reports READY, so wait rather than race it.
    const newIds = (added.productUpdate.product?.media.edges ?? [])
      .map((e) => e.node.id)
      .filter((id) => !new Set(mediaIdByFileName.values()).has(id));
    await waitForMedia(newIds);

    // Re-read so every filename maps to a real media id, including the new ones.
    const after = await shopifyGraphQL<{
      product: { media: { edges: Array<{ node: { id: string; image: { url: string } | null } }> } } | null;
    }>(PRODUCT_MEDIA, { id: product.shopify_product_id });
    mediaIdByFileName.clear();
    for (const edge of after.product?.media.edges ?? []) {
      const name = baseName(edge.node.image?.url);
      if (name) mediaIdByFileName.set(name, edge.node.id);
    }
  }

  // A product can reach here with no main picture recorded — a sync fired by
  // our own push can land before Shopify has ingested any media. Fall back to
  // the first gallery image so "main" is always something concrete.
  // Only fills a genuinely empty slot: once a sync has run, image_url points at
  // Shopify's own CDN copy, which is correct and keeps the same filename — so
  // it still resolves to the right media below.
  let mainUrl = product.image_url;
  if (!mainUrl && candidates.length) {
    mainUrl = candidates[0].url;
    await supabase.from("products").update({ image_url: mainUrl }).eq("id", productId);
  }

  // The picture marked main here should be the one Shopify features, which is
  // whichever media sits at position 0.
  const mainName = baseName(mainUrl);
  const mainMediaId = mainName ? mediaIdByFileName.get(mainName) : undefined;
  if (mainMediaId) {
    const moved = await shopifyGraphQL<{
      productReorderMedia: { userErrors: Array<{ message: string }> };
    }>(REORDER_MEDIA, {
      id: product.shopify_product_id,
      moves: [{ id: mainMediaId, newPosition: "0" }],
    });
    if (moved.productReorderMedia.userErrors.length) {
      result.errors.push(...moved.productReorderMedia.userErrors.map((e) => e.message));
    } else {
      result.featuredSet = true;
    }
  }

  const variantUpdates = (variants ?? [])
    .filter((v) => v.shopify_variant_id)
    .map((v) => {
      const name = baseName(v.image_url);
      const mediaId = name ? mediaIdByFileName.get(name) : undefined;
      return mediaId ? { id: v.shopify_variant_id as string, mediaId } : null;
    })
    .filter((u): u is { id: string; mediaId: string } => u !== null);

  if (variantUpdates.length) {
    const res = await shopifyGraphQL<{
      productVariantsBulkUpdate: { userErrors: Array<{ message: string }> };
    }>(VARIANT_MEDIA, {
      productId: product.shopify_product_id,
      variants: variantUpdates,
    });
    const errs = res.productVariantsBulkUpdate.userErrors;
    if (errs.length) result.errors.push(...errs.map((e) => e.message));
    else result.variantsWithImage = variantUpdates.length;
  }

  return result;
}

async function waitForMedia(ids: string[], attempts = 10): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const statuses = await Promise.all(
      ids.map((id) =>
        shopifyGraphQL<{ node: { status: string } | null }>(MEDIA_STATUS, { id })
          .then((d) => d.node?.status ?? "UNKNOWN")
          .catch(() => "UNKNOWN"),
      ),
    );
    if (statuses.every((s) => s === "READY" || s === "FAILED")) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
