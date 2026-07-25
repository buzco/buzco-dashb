import "server-only";

import { getDatabase, salesDbId } from "@/lib/notion/client";
import { createSalePagesWithSchema, type NotionSaleItem } from "@/lib/notion/sales";
import { createClient } from "@/lib/supabase/server";

// Pushes `sales` rows into the Notion tracker and records the result back on the
// row (notion_page_id / notion_synced_at / notion_error).
//
// Deliberately never throws for a single row: the sale is already safely in
// Postgres, so a Notion failure is a sync problem to retry, not a lost sale.
// The market UI surfaces the count of unsynced rows with a retry button.

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
  market_events: { name: string } | null;
  variants: {
    sku: string;
    size: string | null;
    color: string | null;
    products: { name: string } | null;
  } | null;
};

const SALE_SELECT = `
  id, quantity, gross_amount, discount_amount, customer_ref, payment_method, sold_at,
  notion_page_id,
  market_events ( name ),
  variants ( sku, size, color, products ( name ) )
`;

/**
 * Their tracker's vocabulary: a giveaway is "Oferta", an IOU is "Por pagar",
 * anything actually collected is "Pago".
 */
function statusFor(sale: SaleRow): string {
  const net = Number(sale.gross_amount) - Number(sale.discount_amount);
  if (net <= 0) return "Oferta";
  if ((sale.payment_method ?? "").toLowerCase() === "unpaid") return "Por pagar";
  return "Pago";
}

/**
 * "Unpaid" is an internal marker (see lib/shopify/pos.ts) that drives the Status
 * column, not a payment method. Their tracker already has "N/A" for "no method
 * yet", so use that and leave the curated option list alone.
 */
function paymentFor(sale: SaleRow): string | null {
  if ((sale.payment_method ?? "").toLowerCase() === "unpaid") return "N/A";
  return sale.payment_method;
}

function toNotionItem(sale: SaleRow): NotionSaleItem {
  const qty = Math.max(1, sale.quantity);
  const net = Number(sale.gross_amount) - Number(sale.discount_amount);
  const marketName = sale.market_events?.name ?? null;

  return {
    productName: sale.variants?.products?.name ?? "Unknown product",
    size: sale.variants?.size ?? null,
    colour: sale.variants?.color ?? null,
    sku: sale.variants?.sku ?? null,
    unitPrice: Math.round((net / qty) * 100) / 100,
    quantity: qty,
    status: statusFor(sale),
    paymentMethod: paymentFor(sale),
    // Matches how the tracker is filled in by hand: who/where, not what.
    title: [sale.customer_ref, marketName].filter(Boolean).join(" · ") || "Market sale",
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
  // One schema fetch for the whole batch.
  const db = await getDatabase(salesDbId());

  for (const sale of sales) {
    if (sale.notion_page_id) continue; // already mirrored
    try {
      const { pageIds } = await createSalePagesWithSchema(db, toNotionItem(sale));
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
