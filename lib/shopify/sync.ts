import "server-only";

import { shopifyGraphQL } from "@/lib/shopify/client";
import { createClient } from "@/lib/supabase/server";

// Initial import / reconcile of the Shopify catalog into our DB. This DB stays
// the source of truth — so we map each Shopify product/variant onto our rows by
// its Shopify GID, creating what's missing and updating what exists, and never
// the other way around. Inventory levels and order history are separate, larger
// syncs handled after this catalog pass is verified.

export type SyncResult = {
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  variantsLinked: number;
  errors: string[];
};

type ShopifyVariant = {
  id: string;
  sku: string | null;
  title: string;
  price: string | null;
  selectedOptions: Array<{ name: string; value: string }>;
};

type ShopifyProduct = {
  id: string;
  title: string;
  descriptionHtml: string | null;
  status: "ACTIVE" | "ARCHIVED" | "DRAFT";
  tags: string[];
  variants: { edges: Array<{ node: ShopifyVariant }> };
};

const PRODUCTS_QUERY = `
  query SyncProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      edges {
        node {
          id
          title
          descriptionHtml
          status
          tags
          variants(first: 100) {
            edges {
              node {
                id
                sku
                title
                price
                selectedOptions { name value }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function mapStatus(s: ShopifyProduct["status"]): string {
  return s === "ACTIVE" ? "active" : s === "ARCHIVED" ? "archived" : "draft";
}

function optionValue(opts: Array<{ name: string; value: string }>, re: RegExp): string | null {
  const hit = opts.find((o) => re.test(o.name));
  if (!hit) return null;
  // Shopify uses "Default Title" for products without real options.
  if (hit.value === "Default Title") return null;
  return hit.value;
}

export async function syncFromShopify(): Promise<SyncResult> {
  const supabase = await createClient();
  const result: SyncResult = {
    productsCreated: 0,
    productsUpdated: 0,
    variantsCreated: 0,
    variantsUpdated: 0,
    variantsLinked: 0,
    errors: [],
  };

  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const data: {
      products: {
        edges: Array<{ node: ShopifyProduct }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await shopifyGraphQL(PRODUCTS_QUERY, { cursor });

    for (const { node: p } of data.products.edges) {
      try {
        // --- Upsert product by Shopify GID ---
        const { data: existingProduct } = await supabase
          .from("products")
          .select("id")
          .eq("shopify_product_id", p.id)
          .maybeSingle();

        const productFields = {
          name: p.title,
          description: p.descriptionHtml || null,
          status: mapStatus(p.status),
          tags: p.tags.length ? p.tags : null,
          shopify_product_id: p.id,
        };

        let productId: string;
        if (existingProduct) {
          const { error } = await supabase.from("products").update(productFields).eq("id", existingProduct.id);
          if (error) throw new Error(`product "${p.title}": ${error.message}`);
          productId = existingProduct.id;
          result.productsUpdated++;
        } else {
          const { data: created, error } = await supabase
            .from("products")
            .insert(productFields)
            .select("id")
            .single();
          if (error) throw new Error(`product "${p.title}": ${error.message}`);
          productId = created.id;
          result.productsCreated++;
        }

        // --- Upsert each variant ---
        for (const { node: v } of p.variants.edges) {
          const size = optionValue(v.selectedOptions, /size/i);
          const color = optionValue(v.selectedOptions, /colou?r/i);
          const sku = (v.sku && v.sku.trim()) || `SH-${v.id.split("/").pop()}`;
          const retail_price = v.price != null ? Number(v.price) : null;

          const variantFields = {
            product_id: productId,
            size,
            color,
            sku,
            retail_price,
            shopify_variant_id: v.id,
          };

          // Already linked by Shopify GID?
          const { data: byGid } = await supabase
            .from("variants")
            .select("id")
            .eq("shopify_variant_id", v.id)
            .maybeSingle();

          if (byGid) {
            const { error } = await supabase.from("variants").update(variantFields).eq("id", byGid.id);
            if (error) throw new Error(`variant ${sku}: ${error.message}`);
            result.variantsUpdated++;
            continue;
          }

          // Not linked yet — adopt an existing variant with the same SKU if present.
          const { data: bySku } = await supabase
            .from("variants")
            .select("id")
            .eq("sku", sku)
            .maybeSingle();

          if (bySku) {
            const { error } = await supabase.from("variants").update(variantFields).eq("id", bySku.id);
            if (error) throw new Error(`variant ${sku}: ${error.message}`);
            result.variantsLinked++;
          } else {
            const { error } = await supabase.from("variants").insert(variantFields);
            if (error) throw new Error(`variant ${sku}: ${error.message}`);
            result.variantsCreated++;
          }
        }
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    hasNext = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }

  return result;
}
