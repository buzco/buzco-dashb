import "server-only";

import { createPage, getDatabase, isNotionConfigured } from "@/lib/notion/client";
import { buildProperties } from "@/lib/notion/props";
import type { createClient } from "@/lib/supabase/server";
import {
  ALL_RAFFLE_PAYMENTS,
  RAFFLE_BUNDLES,
  RAFFLE_PAYMENTS,
  STALL_PAYMENTS,
  type RaffleBundleId,
  type RafflePaymentId,
} from "@/lib/market/raffle-options";

export { RAFFLE_BUNDLES, RAFFLE_PAYMENTS, STALL_PAYMENTS };
export type { RaffleBundleId, RafflePaymentId };

// Raffle ticket sales ("rifas"). These are money without a product: no variant,
// no stock movement, so they bypass log_market_sale and are written straight to
// `sales` with variant_id null — which still puts them in the Finance tab and
// the event's takings — plus a row in the Notion "Raffle sales" database.

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;


function raffleSalesDbId(): string {
  const id = process.env.NOTION_RAFFLE_SALES_DB_ID;
  if (!id) throw new Error("NOTION_RAFFLE_SALES_DB_ID is not set");
  return id;
}

export function hasRaffleSalesDb(): boolean {
  return Boolean(process.env.NOTION_TOKEN && process.env.NOTION_RAFFLE_SALES_DB_ID);
}

export type RaffleSaleResult = {
  saleId: string;
  tickets: number;
  amount: number;
  notionOk: boolean;
  notionError?: string;
};

export async function recordRaffleSale(
  supabase: SupabaseLike,
  opts: { eventId: string; bundleId: RaffleBundleId; paymentId: RafflePaymentId },
): Promise<RaffleSaleResult> {
  const bundle = RAFFLE_BUNDLES.find((b) => b.id === opts.bundleId);
  const payment = ALL_RAFFLE_PAYMENTS.find((p) => p.id === opts.paymentId);
  if (!bundle) throw new Error("Unknown raffle bundle");
  if (!payment) throw new Error("Unknown payment method");

  const { data: event } = await supabase
    .from("market_events")
    .select("id, name")
    .eq("id", opts.eventId)
    .single();
  if (!event) throw new Error("Market event not found");

  // channel 'other' rather than 'market': it is event income, but not a garment
  // sale, so revenue reporting can separate the two.
  const { data: sale, error } = await supabase
    .from("sales")
    .insert({
      channel: "other",
      variant_id: null,
      market_event_id: opts.eventId,
      quantity: bundle.tickets,
      gross_amount: bundle.price,
      payment_method: payment.notionOption,
      customer_ref: `Rifas · ${event.name}`,
      notes: `${bundle.label} · ${payment.notionOption}`,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const result: RaffleSaleResult = {
    saleId: sale.id,
    tickets: bundle.tickets,
    amount: bundle.price,
    notionOk: false,
  };

  if (!isNotionConfigured() || !hasRaffleSalesDb()) return result;

  try {
    const db = await getDatabase(raffleSalesDbId());
    const { properties } = buildProperties(db, [
      {
        aliases: ["Name"],
        value: `${bundle.label} · ${payment.notionOption} · ${event.name}`,
        isTitle: true,
      },
      { aliases: ["Select", "Bundle", "Tipo"], value: bundle.notionOption },
      { aliases: ["Valor", "Value", "Amount"], value: bundle.price },
      { aliases: ["Pago com", "Pago", "Payment"], value: payment.notionOption },
    ]);
    const page = await createPage(raffleSalesDbId(), properties);
    await supabase
      .from("sales")
      .update({ notion_page_id: page.id, notion_synced_at: new Date().toISOString() })
      .eq("id", sale.id);
    result.notionOk = true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    result.notionError = message;
    await supabase.from("sales").update({ notion_error: message.slice(0, 500) }).eq("id", sale.id);
  }

  return result;
}

/** Totals for the event, for the counter on the raffle screen. */
export async function raffleTotalsForEvent(
  supabase: SupabaseLike,
  eventId: string,
): Promise<{ tickets: number; revenue: number; sales: number }> {
  const { data } = await supabase
    .from("sales")
    .select("quantity, gross_amount")
    .eq("market_event_id", eventId)
    // Rifas are the only channel=other rows attached to an event.
    .eq("channel", "other");

  return {
    tickets: (data ?? []).reduce((sum, r) => sum + r.quantity, 0),
    revenue: (data ?? []).reduce((sum, r) => sum + Number(r.gross_amount), 0),
    sales: (data ?? []).length,
  };
}
