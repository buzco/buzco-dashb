import "server-only";

import { shopifyGraphQL } from "@/lib/shopify/client";
import { createClient } from "@/lib/supabase/server";

// Pulls Shopify POS transactions for a market event and turns each line item
// into a market sale that DEDUCTS from the event's crate.
//
// Why polling rather than webhooks: the stall runs on a phone over patchy
// venue wifi, and a webhook that fires while the dashboard is closed is a
// silent failure. Re-pulling is cheap, fully idempotent, and self-healing —
// "Pull POS sales" can be pressed any number of times, including days later.
//
// Contrast with lib/shopify/orders.ts (the generic history importer): that one
// records revenue only and never moves inventory, because the catalog sync
// already mirrors Shopify's on-hand. POS is different — the goods left YOUR
// crate, which no Shopify location mirror covers. log_market_sale handles the
// overlap: if the generic importer already created the row, it is adopted and
// given its missing movement instead of being duplicated.

export type PosPullResult = {
  ordersSeen: number;
  posOrders: number;
  salesCreated: number;
  /** Lines already imported by an earlier pull. */
  salesSkipped: number;
  unknownVariantLines: number;
  errors: string[];
  /** Line items whose product isn't linked to Shopify yet, for the UI to name. */
  unknownVariantTitles: string[];
  /** Sale ids created by this pull — the caller mirrors these into Notion. */
  createdSaleIds: string[];
};

type PosLine = {
  id: string;
  quantity: number;
  title: string;
  variantTitle: string | null;
  variant: { id: string } | null;
  originalTotalSet: { shopMoney: { amount: string } };
  discountedTotalSet: { shopMoney: { amount: string } };
};

type PosOrder = {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  sourceName: string | null;
  displayFinancialStatus: string | null;
  paymentGatewayNames: string[];
  lineItems: { edges: Array<{ node: PosLine }> };
};

// `query` uses Shopify's order search syntax. created_at is filtered here so a
// long-running store doesn't page through years of history every pull.
const POS_ORDERS_QUERY = `
  query PosOrders($cursor: String, $query: String!) {
    orders(first: 50, after: $cursor, sortKey: CREATED_AT, query: $query) {
      edges {
        node {
          id
          name
          createdAt
          cancelledAt
          sourceName
          displayFinancialStatus
          paymentGatewayNames
          lineItems(first: 100) {
            edges {
              node {
                id
                quantity
                title
                variantTitle
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

/**
 * Shopify gateway handles are machine-ish, and the Notion tracker's payment
 * options are a curated list. "Shopify" is already one of them and is the honest
 * label for anything rung through POS, so card/manual/unknown all land there
 * rather than auto-creating new options in their database.
 */
export function paymentLabel(gateways: string[], sourceName: string | null): string {
  const g = gateways.map((x) => x.toLowerCase());
  if (g.some((x) => x.includes("cash"))) return "Cash";
  return sourceName === "pos" || gateways.length ? "Shopify" : "Unknown";
}

/**
 * A POS order counts as belonging to this event when Shopify says it came from
 * the point-of-sale channel and it happened inside the event window. `ends_at`
 * is often unset while an event is live, so an open-ended window means "until
 * now".
 */
function isPosOrder(order: PosOrder): boolean {
  const src = (order.sourceName ?? "").toLowerCase();
  return src === "pos" || src.includes("point_of_sale") || src.includes("point of sale");
}

export async function pullPosSalesForEvent(marketEventId: string): Promise<PosPullResult> {
  const supabase = await createClient();
  const result: PosPullResult = {
    ordersSeen: 0,
    posOrders: 0,
    salesCreated: 0,
    salesSkipped: 0,
    unknownVariantLines: 0,
    errors: [],
    unknownVariantTitles: [],
    createdSaleIds: [],
  };

  const { data: event, error: eventError } = await supabase
    .from("market_events")
    .select("id, name, starts_at, ends_at")
    .eq("id", marketEventId)
    .single();
  if (eventError || !event) throw new Error(eventError?.message ?? "Market event not found");

  const { data: variants } = await supabase
    .from("variants")
    .select("id, shopify_variant_id")
    .not("shopify_variant_id", "is", null);
  const variantByGid = new Map(
    (variants ?? []).map((v) => [v.shopify_variant_id as string, v.id]),
  );

  // Lines already imported. log_market_sale is idempotent anyway, but checking
  // here is what lets the UI report "3 new" instead of re-counting everything.
  const [{ data: importedLines }, { data: voidedLines }] = await Promise.all([
    supabase.from("sales").select("shopify_line_item_id").not("shopify_line_item_id", "is", null),
    // Lines deliberately voided must stay gone: their sale row is deleted, so
    // without these tombstones the next pull would happily re-import them.
    supabase.from("market_voided_lines").select("shopify_line_item_id"),
  ]);
  const alreadyImported = new Set([
    ...(importedLines ?? []).map((s) => s.shopify_line_item_id as string),
    ...(voidedLines ?? []).map((v) => v.shopify_line_item_id),
  ]);

  // Shopify's search takes a date (or ISO) — pad the start by a day so a
  // timezone gap at the boundary can't hide the first sale of the morning.
  const from = new Date(new Date(event.starts_at).getTime() - 24 * 60 * 60 * 1000);
  const parts = [`created_at:>='${from.toISOString()}'`];
  if (event.ends_at) {
    const to = new Date(new Date(event.ends_at).getTime() + 24 * 60 * 60 * 1000);
    parts.push(`created_at:<='${to.toISOString()}'`);
  }
  const searchQuery = parts.join(" AND ");

  const windowStart = new Date(event.starts_at).getTime();
  const windowEnd = event.ends_at ? new Date(event.ends_at).getTime() : Number.POSITIVE_INFINITY;

  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const data: {
      orders: {
        edges: Array<{ node: PosOrder }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await shopifyGraphQL(POS_ORDERS_QUERY, { cursor, query: searchQuery });

    for (const { node: order } of data.orders.edges) {
      result.ordersSeen++;
      if (order.cancelledAt) continue;
      if (!isPosOrder(order)) continue;

      const created = new Date(order.createdAt).getTime();
      if (created < windowStart || created > windowEnd) continue;

      result.posOrders++;
      const payment = paymentLabel(order.paymentGatewayNames, order.sourceName);
      const paid = (order.displayFinancialStatus ?? "").toUpperCase() === "PAID";

      for (const { node: line } of order.lineItems.edges) {
        try {
          if (alreadyImported.has(line.id)) {
            result.salesSkipped++;
            continue;
          }

          const variantId = line.variant ? variantByGid.get(line.variant.id) : undefined;
          if (!variantId) {
            result.unknownVariantLines++;
            const label = [line.title, line.variantTitle].filter(Boolean).join(" — ");
            if (label && !result.unknownVariantTitles.includes(label)) {
              result.unknownVariantTitles.push(label);
            }
            continue;
          }

          const original = Number(line.originalTotalSet.shopMoney.amount);
          const discounted = Number(line.discountedTotalSet.shopMoney.amount);

          const { data: sale, error } = await supabase.rpc("log_market_sale", {
            p_market_event_id: marketEventId,
            p_variant_id: variantId,
            p_quantity: line.quantity,
            p_gross_amount: original,
            p_discount_amount: Math.max(0, original - discounted),
            p_fees_amount: 0,
            p_customer_ref: order.name,
            p_notes: `Shopify POS ${order.name} · ${payment}${paid ? "" : " · unpaid"}`,
            p_shopify_order_id: order.id,
            p_shopify_line_item_id: line.id,
            p_sold_at: order.createdAt,
          });
          if (error) throw new Error(`${order.name}: ${error.message}`);
          if (sale) {
            result.salesCreated++;
            result.createdSaleIds.push(sale.id);
            alreadyImported.add(line.id);
          }
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
