import "server-only";

import { getDatabase, salesDbId, updatePage } from "@/lib/notion/client";
import { buildProperties } from "@/lib/notion/props";
import { createSalePagesWithSchema, type NotionSaleItem } from "@/lib/notion/sales";
import { getSalesOptions, matchOption, CONSIGNATION_PAYMENT, STATUS } from "@/lib/notion/options";
import { createClient } from "@/lib/supabase/server";

// Pushes `sales` rows into the Notion tracker and records the result back on the
// row (notion_page_id / notion_synced_at / notion_error).
//
// Deliberately never throws for a single row: the sale is already safely in
// Postgres, so a Notion failure is a sync problem to retry, not a lost sale.
// The market and sales tabs surface the count of unsynced rows with a retry
// button.

export type MirrorResult = {
  synced: number;
  failed: number;
  errors: string[];
};

/** Either the request-scoped client or the service-role one. */
type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

type SaleRow = {
  id: string;
  quantity: number;
  gross_amount: number;
  discount_amount: number;
  customer_ref: string | null;
  payment_method: string | null;
  sold_at: string;
  notion_page_id: string | null;
  is_freebie: boolean | null;
  market_events: { name: string } | null;
  sale_orders: {
    reference: string;
    kind: string;
    where_sold: string | null;
    payment_status: string;
    customer_name: string | null;
    retailers: { name: string } | null;
  } | null;
  variants: {
    sku: string;
    size: string | null;
    color: string | null;
    products: { name: string } | null;
  } | null;
};

const SALE_SELECT = `
  id, quantity, gross_amount, discount_amount, customer_ref, payment_method, sold_at,
  notion_page_id, is_freebie,
  market_events ( name ),
  sale_orders ( reference, kind, where_sold, payment_status, customer_name, retailers ( name ) ),
  variants ( sku, size, color, products ( name ) )
`;

/**
 * Their tracker's vocabulary: a giveaway is "Oferta", an IOU is "Por pagar",
 * anything actually collected is "Pago".
 *
 * Three different things can mean unpaid, and all three have to land on "Por
 * pagar": a consignation (the batch is out but nothing is owed yet), an order
 * logged as payment-pending, and the "Unpaid" marker the Shopify POS importer
 * writes into payment_method for a PENDING order.
 */
function statusFor(sale: SaleRow): string {
  const net = Number(sale.gross_amount) - Number(sale.discount_amount);
  if (sale.is_freebie || net <= 0) return STATUS.gift;
  if (sale.sale_orders?.payment_status === "pending") return STATUS.pending;
  if ((sale.payment_method ?? "").toLowerCase() === "unpaid") return STATUS.pending;
  return STATUS.paid;
}

/**
 * "Unpaid" is an internal marker (see lib/shopify/pos.ts) that drives the Status
 * column, not a payment method. Their tracker already has "N/A" for "no method
 * yet" and "Consignation" for goods left with a shop, so use those and leave the
 * curated option list alone.
 */
function paymentFor(sale: SaleRow): string | null {
  if (sale.sale_orders?.kind === "consignment" && sale.sale_orders.payment_status === "pending") {
    return CONSIGNATION_PAYMENT;
  }
  if ((sale.payment_method ?? "").toLowerCase() === "unpaid") return "N/A";
  return sale.payment_method;
}

/** Who and where, which is how the tracker's title column is filled by hand. */
function titleFor(sale: SaleRow): string {
  const order = sale.sale_orders;
  if (order) {
    const who = order.retailers?.name ?? order.customer_name ?? null;
    const what = order.kind === "consignment" ? "Consignation" : null;
    return [who, what, order.reference].filter(Boolean).join(" · ");
  }
  const marketName = sale.market_events?.name ?? null;
  return [sale.customer_ref, marketName].filter(Boolean).join(" · ") || "Market sale";
}

function toNotionItem(sale: SaleRow, options: Awaited<ReturnType<typeof getSalesOptions>>): NotionSaleItem {
  const qty = Math.max(1, sale.quantity);
  const net = Number(sale.gross_amount) - Number(sale.discount_amount);
  const payment = paymentFor(sale);

  return {
    productName: sale.variants?.products?.name ?? "Unknown product",
    size: sale.variants?.size ?? null,
    colour: sale.variants?.color ?? null,
    sku: sale.variants?.sku ?? null,
    unitPrice: Math.round((net / qty) * 100) / 100,
    quantity: qty,
    // Written through matchOption so the tracker's own spelling wins rather
    // than ours auto-creating a near-duplicate option.
    status: matchOption(options.status, statusFor(sale)),
    paymentMethod: payment ? matchOption(options.payment, payment) : null,
    where: sale.sale_orders?.where_sold
      ? matchOption(options.where, sale.sale_orders.where_sold)
      : null,
    title: titleFor(sale),
    soldAt: sale.sold_at,
  };
}

/**
 * @param client Pass the service-role client when there is no logged-in user
 *   (the standalone POS/raffle links); otherwise the request-scoped one is used.
 */
export async function mirrorSalesToNotion(
  saleIds: string[],
  client?: SupabaseLike,
): Promise<MirrorResult> {
  const result: MirrorResult = { synced: 0, failed: 0, errors: [] };
  if (!saleIds.length) return result;

  const supabase = client ?? (await createClient());
  const { data, error } = await supabase.from("sales").select(SALE_SELECT).in("id", saleIds);
  if (error) return { synced: 0, failed: saleIds.length, errors: [error.message] };

  const sales = (data ?? []) as unknown as SaleRow[];
  // One schema fetch and one option fetch for the whole batch.
  const [db, options] = await Promise.all([getDatabase(salesDbId()), getSalesOptions()]);

  for (const sale of sales) {
    if (sale.notion_page_id) continue; // already mirrored
    try {
      const { pageIds } = await createSalePagesWithSchema(db, toNotionItem(sale, options));
      await supabase
        .from("sales")
        .update({
          notion_page_id: pageIds.join(","),
          notion_synced_at: new Date().toISOString(),
          notion_error: null,
        })
        .eq("id", sale.id);
      result.synced++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result.failed++;
      result.errors.push(message);
      await supabase
        .from("sales")
        .update({ notion_error: message.slice(0, 500) })
        .eq("id", sale.id);
    }
  }

  return result;
}

/** Retries every market sale for an event that has no Notion page yet. */
export async function mirrorUnsyncedForEvent(
  marketEventId: string,
  client?: SupabaseLike,
): Promise<MirrorResult> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("sales")
    .select("id")
    .eq("market_event_id", marketEventId)
    .is("notion_page_id", null);

  if (error) return { synced: 0, failed: 0, errors: [error.message] };
  return mirrorSalesToNotion((data ?? []).map((s) => s.id), client);
}

/** Retries every line of one order that has no Notion page yet. */
export async function mirrorUnsyncedForOrder(
  orderId: string,
  client?: SupabaseLike,
): Promise<MirrorResult> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("sales")
    .select("id")
    .eq("sale_order_id", orderId)
    .is("notion_page_id", null);

  if (error) return { synced: 0, failed: 0, errors: [error.message] };
  return mirrorSalesToNotion((data ?? []).map((s) => s.id), client);
}

/**
 * Re-states an order's pages in Notion after it changed — which today means a
 * consignation being settled, moving every one of its pages from "Por pagar" to
 * "Pago" and stamping the method it was finally paid with.
 *
 * Patches the existing pages rather than writing new ones: the tracker is read
 * by hand and a settled consignation must not double the garment count. Lines
 * that were never mirrored are created instead, so settling also repairs a sync
 * that failed at sale time.
 */
export async function resyncOrderInNotion(
  orderId: string,
  client?: SupabaseLike,
): Promise<MirrorResult> {
  const result: MirrorResult = { synced: 0, failed: 0, errors: [] };
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase
    .from("sales")
    .select(SALE_SELECT)
    .eq("sale_order_id", orderId);
  if (error) return { synced: 0, failed: 0, errors: [error.message] };

  const sales = (data ?? []) as unknown as SaleRow[];
  if (!sales.length) return result;

  const unmirrored = sales.filter((s) => !s.notion_page_id).map((s) => s.id);
  const [db, options] = await Promise.all([getDatabase(salesDbId()), getSalesOptions()]);

  for (const sale of sales.filter((s) => s.notion_page_id)) {
    const item = toNotionItem(sale, options);
    // One sale row can own several pages (one per garment) — all of them move.
    const pageIds = (sale.notion_page_id ?? "").split(",").filter(Boolean);
    for (const pageId of pageIds) {
      try {
        const { properties } = buildProperties(db, [
          { aliases: ["Status", "Estado"], value: item.status },
          {
            aliases: [
              "Método pagamento",
              "Metodo pagamento",
              "Payment method",
              "Pagamento",
            ],
            value: item.paymentMethod,
          },
        ]);
        if (Object.keys(properties).length) await updatePage(pageId, properties);
        result.synced++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        result.failed++;
        result.errors.push(message);
      }
    }
  }

  if (unmirrored.length) {
    const created = await mirrorSalesToNotion(unmirrored, supabase);
    result.synced += created.synced;
    result.failed += created.failed;
    result.errors.push(...created.errors);
  }

  return result;
}
