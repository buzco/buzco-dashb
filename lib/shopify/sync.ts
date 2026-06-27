import "server-only";

import { shopifyGraphQL } from "@/lib/shopify/client";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Import / reconcile the Shopify catalog into our DB. This DB stays the source
// of truth: we map each Shopify product/variant onto our rows by Shopify GID,
// creating what's missing and updating what exists — never writing back to
// Shopify. We also pull cost-of-goods (unit cost -> production_cost) and
// reconcile Shopify's on-hand into a dedicated "shopify" inventory location via
// an adjustment movement equal to the delta, so re-running is idempotent and
// never double-counts.

export type SyncResult = {
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  variantsLinked: number;
  cogsUpdated: number;
  inventoryReconciled: number;
  errors: string[];
};

type ShopifyVariant = {
  id: string;
  sku: string | null;
  title: string;
  price: string | null;
  inventoryQuantity: number | null;
  inventoryItem: { unitCost: { amount: string } | null } | null;
  image: { url: string } | null;
  selectedOptions: Array<{ name: string; value: string }>;
};

type ShopifyProduct = {
  id: string;
  title: string;
  descriptionHtml: string | null;
  status: "ACTIVE" | "ARCHIVED" | "DRAFT";
  tags: string[];
  featuredImage: { url: string } | null;
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
          featuredImage { url }
          variants(first: 100) {
            edges {
              node {
                id
                sku
                title
                price
                inventoryQuantity
                inventoryItem { unitCost { amount } }
                image { url }
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
  if (hit.value === "Default Title") return null;
  return hit.value;
}

// One inventory_locations row of type 'shopify' represents stock held in the
// Shopify channel. Created lazily on first sync.
async function getShopifyLocationId(supabase: SupabaseClient): Promise<string> {
  const { data: existing } = await supabase
    .from("inventory_locations")
    .select("id")
    .eq("type", "shopify")
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await supabase
    .from("inventory_locations")
    .insert({ name: "Shopify", type: "shopify" })
    .select("id")
    .single();
  if (error) throw new Error(`creating Shopify location: ${error.message}`);
  return created.id;
}

// Reconcile our 'shopify' location stock for a variant to Shopify's on-hand by
// inserting a single adjustment movement for the difference (idempotent).
async function reconcileInventory(
  supabase: SupabaseClient,
  variantId: string,
  shopifyLocationId: string,
  shopifyQty: number,
): Promise<boolean> {
  const { data: cs } = await supabase
    .from("current_stock")
    .select("quantity")
    .eq("variant_id", variantId)
    .eq("location_id", shopifyLocationId)
    .maybeSingle();
  const current = cs?.quantity ?? 0;
  const delta = shopifyQty - current;
  if (delta === 0) return false;
  const { error } = await supabase.from("inventory_movements").insert({
    variant_id: variantId,
    location_id: shopifyLocationId,
    quantity_change: delta,
    reason: "adjustment",
    reference_type: "shopify_inventory_sync",
  });
  if (error) throw new Error(`reconciling inventory: ${error.message}`);
  return true;
}

export async function syncFromShopify(): Promise<SyncResult> {
  const supabase = await createClient();
  const result: SyncResult = {
    productsCreated: 0,
    productsUpdated: 0,
    variantsCreated: 0,
    variantsUpdated: 0,
    variantsLinked: 0,
    cogsUpdated: 0,
    inventoryReconciled: 0,
    errors: [],
  };

  const shopifyLocationId = await getShopifyLocationId(supabase);

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
          image_url: p.featuredImage?.url ?? null,
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

        // --- Upsert each variant, then sync cost + inventory ---
        for (const { node: v } of p.variants.edges) {
          const size = optionValue(v.selectedOptions, /size/i);
          const color = optionValue(v.selectedOptions, /colou?r/i);
          const sku = (v.sku && v.sku.trim()) || `SH-${v.id.split("/").pop()}`;
          const retail_price = v.price != null ? Number(v.price) : null;
          const unitCost =
            v.inventoryItem?.unitCost?.amount != null ? Number(v.inventoryItem.unitCost.amount) : null;

          const variantFields: {
            product_id: string;
            size: string | null;
            color: string | null;
            sku: string;
            retail_price: number | null;
            shopify_variant_id: string;
            image_url: string | null;
            production_cost?: number;
          } = {
            product_id: productId,
            size,
            color,
            sku,
            retail_price,
            shopify_variant_id: v.id,
            image_url: v.image?.url ?? p.featuredImage?.url ?? null,
          };
          // Only set cost when Shopify has one — don't clobber a PO-derived cost.
          if (unitCost != null) variantFields.production_cost = unitCost;

          let variantDbId: string;
          const { data: byGid } = await supabase
            .from("variants")
            .select("id")
            .eq("shopify_variant_id", v.id)
            .maybeSingle();

          if (byGid) {
            const { error } = await supabase.from("variants").update(variantFields).eq("id", byGid.id);
            if (error) throw new Error(`variant ${sku}: ${error.message}`);
            variantDbId = byGid.id;
            result.variantsUpdated++;
          } else {
            const { data: bySku } = await supabase
              .from("variants")
              .select("id")
              .eq("sku", sku)
              .maybeSingle();
            if (bySku) {
              const { error } = await supabase.from("variants").update(variantFields).eq("id", bySku.id);
              if (error) throw new Error(`variant ${sku}: ${error.message}`);
              variantDbId = bySku.id;
              result.variantsLinked++;
            } else {
              const { data: createdV, error } = await supabase
                .from("variants")
                .insert(variantFields)
                .select("id")
                .single();
              if (error) throw new Error(`variant ${sku}: ${error.message}`);
              variantDbId = createdV.id;
              result.variantsCreated++;
            }
          }

          if (unitCost != null) result.cogsUpdated++;

          const reconciled = await reconcileInventory(
            supabase,
            variantDbId,
            shopifyLocationId,
            v.inventoryQuantity ?? 0,
          );
          if (reconciled) result.inventoryReconciled++;
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
