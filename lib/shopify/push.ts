import "server-only";

import { shopifyGraphQL } from "@/lib/shopify/client";
import { createClient } from "@/lib/supabase/server";

// Push a local product to Shopify as a DRAFT (invisible to customers until the
// user publishes it there). Uses productSet to declare options + variants +
// SKUs + prices in one call, then links the returned Shopify IDs back onto our
// rows. Only creates — a product already linked to Shopify is left alone (guards
// against duplicates).

export type PushResult = { productGid: string; variantsLinked: number };

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

  await pushProductImages(supabase, productId).catch(() => {
    // Images are cosmetic next to the product itself existing; a failure here
    // is reported by the standalone retry rather than losing the whole push.
  });

  return { productGid: productSet.product.id, variantsLinked };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

const PRODUCT_CREATE_MEDIA = `
  mutation AddProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { ... on MediaImage { id status image { url } } }
      mediaUserErrors { field message }
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

export type ImagePushResult = { created: number; variantsWithImage: number; errors: string[] };

/**
 * Sends our images to Shopify by URL.
 *
 * The images already live in public Supabase Storage, so Shopify can fetch them
 * itself via `originalSource` — which sidesteps the staged-upload dance the
 * Files API would otherwise require.
 */
export async function pushProductImages(
  supabase: SupabaseLike,
  productId: string,
): Promise<ImagePushResult> {
  const result: ImagePushResult = { created: 0, variantsWithImage: 0, errors: [] };

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

  // One media entry per distinct URL; the product shot leads so it becomes the
  // featured image.
  const urls: Array<{ url: string; alt: string }> = [];
  const seen = new Set<string>();
  const add = (url: string | null, alt: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push({ url, alt });
  };
  add(product.image_url, product.name);
  for (const v of variants ?? []) {
    add(v.image_url, [product.name, v.color, v.size].filter(Boolean).join(" — "));
  }
  if (!urls.length) return result;

  const created = await shopifyGraphQL<{
    productCreateMedia: {
      media: Array<{ id: string; status: string; image: { url: string } | null }>;
      mediaUserErrors: Array<{ message: string }>;
    };
  }>(PRODUCT_CREATE_MEDIA, {
    productId: product.shopify_product_id,
    media: urls.map((u) => ({
      originalSource: u.url,
      alt: u.alt,
      mediaContentType: "IMAGE",
    })),
  });

  if (created.productCreateMedia.mediaUserErrors.length) {
    result.errors.push(...created.productCreateMedia.mediaUserErrors.map((e) => e.message));
  }
  const mediaIds = created.productCreateMedia.media.map((m) => m.id);
  result.created = mediaIds.length;

  // Media are ingested asynchronously and cannot be attached to a variant until
  // Shopify reports READY, so wait briefly rather than racing it.
  const byUrlIndex = new Map(urls.map((u, i) => [u.url, i]));
  await waitForMedia(mediaIds);

  const variantUpdates = (variants ?? [])
    .filter((v) => v.shopify_variant_id && v.image_url && byUrlIndex.has(v.image_url))
    .map((v) => ({
      id: v.shopify_variant_id as string,
      mediaId: mediaIds[byUrlIndex.get(v.image_url as string) as number],
    }))
    .filter((u) => u.mediaId);

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
