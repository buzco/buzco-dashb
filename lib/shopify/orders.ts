import "server-only";

import { shopifyGraphQL } from "@/lib/shopify/client";
import { createClient } from "@/lib/supabase/server";

// Import Shopify order history into the sales table for revenue reporting.
//
// IMPORTANT: this records SALES only — no inventory movements. Stock for the
// Shopify channel is kept accurate by the inventory reconciliation in
// syncFromShopify (which mirrors Shopify's live on-hand). Creating sale-driven
// movements here too would double-count. Idempotent: a line is skipped if a
// sale already exists for that (shopify_order_id, variant_id).

export type OrderSyncResult = {
  ordersSeen: number;
  salesCreated: number;
  salesSkipped: number;
  linesWithoutKnownVariant: number;
  errors: string[];
};

type OrderLine = {
  quantity: number;
  variant: { id: string } | null;
  originalTotalSet: { shopMoney: { amount: string } };
  discountedTotalSet: { shopMoney: { amount: string } };
};

type Order = {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  lineItems: { edges: Array<{ node: OrderLine }> };
};

const ORDERS_QUERY = `
  query SyncOrders($cursor: String) {
    orders(first: 50, after: $cursor, sortKey: CREATED_AT) {
      edges {
        node {
          id
          name
          createdAt
          cancelledAt
          lineItems(first: 100) {
            edges {
              node {
                quantity
                variant { id }
                originalTotalSet { shopMoney { amount } }
                discountedTotalSet { shopMoney { amount } }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function syncShopifyOrders(): Promise<OrderSyncResult> {
  const supabase = await createClient();
  const result: OrderSyncResult = {
    ordersSeen: 0,
    salesCreated: 0,
    salesSkipped: 0,
    linesWithoutKnownVariant: 0,
    errors: [],
  };

  // Map Shopify variant GID -> our variant id.
  const { data: variants } = await supabase
    .from("variants")
    .select("id, shopify_variant_id")
    .not("shopify_variant_id", "is", null);
  const variantByGid = new Map((variants ?? []).map((v) => [v.shopify_variant_id as string, v.id]));

  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const data: {
      orders: {
        edges: Array<{ node: Order }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await shopifyGraphQL(ORDERS_QUERY, { cursor });

    for (const { node: o } of data.orders.edges) {
      result.ordersSeen++;
      if (o.cancelledAt) continue;

      for (const { node: li } of o.lineItems.edges) {
        try {
          if (!li.variant) {
            result.linesWithoutKnownVariant++;
            continue;
          }
          const variantId = variantByGid.get(li.variant.id);
          if (!variantId) {
            result.linesWithoutKnownVariant++;
            continue;
          }

          // Idempotency: one sale per (order, variant).
          const { data: existing } = await supabase
            .from("sales")
            .select("id")
            .eq("shopify_order_id", o.id)
            .eq("variant_id", variantId)
            .maybeSingle();
          if (existing) {
            result.salesSkipped++;
            continue;
          }

          const original = Number(li.originalTotalSet.shopMoney.amount);
          const discounted = Number(li.discountedTotalSet.shopMoney.amount);
          const discount = Math.max(0, original - discounted);

          const { error } = await supabase.from("sales").insert({
            channel: "shopify",
            variant_id: variantId,
            quantity: li.quantity,
            gross_amount: original,
            discount_amount: discount,
            shopify_order_id: o.id,
            customer_ref: o.name, // order number; customer PII is plan-gated
            sold_at: o.createdAt,
          });
          if (error) throw new Error(`order ${o.name}: ${error.message}`);
          result.salesCreated++;
        } catch (e) {
          result.errors.push(e instanceof Error ? e.message : String(e));
        }
      }
    }

    hasNext = data.orders.pageInfo.hasNextPage;
    cursor = data.orders.pageInfo.endCursor;
  }

  return result;
}
