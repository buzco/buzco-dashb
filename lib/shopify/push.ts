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
    status: "DRAFT",
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

  return { productGid: productSet.product.id, variantsLinked };
}
