import "server-only";

import { createPage, getDatabase, isNotionConfigured } from "@/lib/notion/client";
import { buildProperties } from "@/lib/notion/props";
import type { createClient } from "@/lib/supabase/server";
import {
  ALL_RAFFLE_PAYMENTS,
  RAFFLE_BUNDLES,
  RAFFLE_PAYMENTS,
  STALL_PAYMENTS,
  packsForTickets,
  type RaffleBundle,
  type RaffleBundleId,
  type RafflePaymentId,
} from "@/lib/market/raffle-options";

export { RAFFLE_BUNDLES, RAFFLE_PAYMENTS, STALL_PAYMENTS };
export type { RaffleBundleId, RafflePaymentId };

// Raffle ticket sales ("rifas").
//
// `sales.variant_id` is NOT NULL — migration 002 set that deliberately, on the
// principle that every sale is a sale OF something. Rather than weaken it,
// rifas get a real catalogue product with one variant per bundle. That
// satisfies the invariant and gives per-bundle revenue reporting for free.
//
// The product is local-only: never pushed to Shopify, and it holds no stock, so
// it cannot show up in the stall POS next to the garments.

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

const RIFAS_PRODUCT = "Rifas (raffle tickets)";
const skuFor = (b: RaffleBundle) => `RIFA-${b.tickets}`;

function raffleSalesDbId(): string {
  const id = process.env.NOTION_RAFFLE_SALES_DB_ID;
  if (!id) throw new Error("NOTION_RAFFLE_SALES_DB_ID is not set");
  return id;
}

export function hasRaffleSalesDb(): boolean {
  return Boolean(process.env.NOTION_TOKEN && process.env.NOTION_RAFFLE_SALES_DB_ID);
}

/** Finds (or lazily creates) the rifas product; returns bundle id -> variant id. */
async function rifasVariantIds(supabase: SupabaseLike): Promise<Map<string, string>> {
  let { data: product } = await supabase
    .from("products")
    .select("id")
    .eq("name", RIFAS_PRODUCT)
    .maybeSingle();

  if (!product) {
    const { data: created, error } = await supabase
      .from("products")
      .insert({
        name: RIFAS_PRODUCT,
        description: "Raffle tickets sold at markets. Not a Shopify product.",
        status: "draft",
      })
      .select("id")
      .single();
    if (error) throw new Error(`creating rifas product: ${error.message}`);
    product = created;
  }

  const { data: existing } = await supabase
    .from("variants")
    .select("id, sku")
    .eq("product_id", product.id);
  const bySku = new Map((existing ?? []).map((v) => [v.sku, v.id]));

  const byBundle = new Map<string, string>();
  for (const bundle of RAFFLE_BUNDLES) {
    const sku = skuFor(bundle);
    let variantId = bySku.get(sku);
    if (!variantId) {
      const { data: v, error } = await supabase
        .from("variants")
        .insert({ product_id: product.id, sku, retail_price: bundle.price })
        .select("id")
        .single();
      if (error) throw new Error(`creating ${sku}: ${error.message}`);
      variantId = v.id;
    }
    byBundle.set(bundle.id, variantId);
  }
  return byBundle;
}

export type RaffleSaleResult = {
  tickets: number;
  amount: number;
  /** One entry per bundle written, e.g. { label: "12 rifas Bundle", count: 1 }. */
  packs: Array<{ label: string; count: number }>;
  saleIds: string[];
  notionOk: boolean;
  notionError?: string;
};

/**
 * Sell `tickets` rifas, automatically broken into the cheapest bundles.
 * Each bundle becomes its own row here and in Notion, matching how the tracker
 * records them by hand.
 */
export async function recordRaffleTickets(
  supabase: SupabaseLike,
  opts: { eventId: string; tickets: number; paymentId: RafflePaymentId },
): Promise<RaffleSaleResult> {
  const payment = ALL_RAFFLE_PAYMENTS.find((p) => p.id === opts.paymentId);
  if (!payment) throw new Error("Unknown payment method");

  const { tickets, packs, total } = packsForTickets(opts.tickets);
  if (tickets <= 0) throw new Error("Enter how many rifas");

  const { data: event } = await supabase
    .from("market_events")
    .select("id, name")
    .eq("id", opts.eventId)
    .single();
  if (!event) throw new Error("Market event not found");

  const variantByBundle = await rifasVariantIds(supabase);

  const result: RaffleSaleResult = {
    tickets,
    amount: total,
    packs: packs.map((p) => ({ label: p.bundle.notionOption, count: p.count })),
    saleIds: [],
    notionOk: true,
  };

  // channel 'other': event income, but not a garment sale, so revenue reporting
  // can tell the two apart. No inventory movement — rifas aren't stock.
  const rows = packs.flatMap((p) =>
    Array.from({ length: p.count }, () => ({
      channel: "other" as const,
      variant_id: variantByBundle.get(p.bundle.id) as string,
      market_event_id: opts.eventId,
      quantity: p.bundle.tickets,
      gross_amount: p.bundle.price,
      payment_method: payment.notionOption,
      customer_ref: `Rifas · ${event.name}`,
      notes: `${p.bundle.label} · ${payment.notionOption}`,
    })),
  );

  const { data: inserted, error } = await supabase.from("sales").insert(rows).select("id");
  if (error) throw new Error(error.message);
  result.saleIds = (inserted ?? []).map((r) => r.id);

  if (!isNotionConfigured() || !hasRaffleSalesDb()) {
    result.notionOk = false;
    return result;
  }

  try {
    const db = await getDatabase(raffleSalesDbId());
    let i = 0;
    for (const pack of packs) {
      for (let n = 0; n < pack.count; n++) {
        const { properties } = buildProperties(db, [
          {
            aliases: ["Name"],
            value: `${pack.bundle.label} · ${payment.notionOption} · ${event.name}`,
            isTitle: true,
          },
          { aliases: ["Select", "Bundle", "Tipo"], value: pack.bundle.notionOption },
          { aliases: ["Valor", "Value", "Amount"], value: pack.bundle.price },
          { aliases: ["Pago com", "Pago", "Payment"], value: payment.notionOption },
        ]);
        const page = await createPage(raffleSalesDbId(), properties);
        const saleId = result.saleIds[i++];
        if (saleId) {
          await supabase
            .from("sales")
            .update({ notion_page_id: page.id, notion_synced_at: new Date().toISOString() })
            .eq("id", saleId);
        }
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    result.notionOk = false;
    result.notionError = message;
    if (result.saleIds.length) {
      await supabase
        .from("sales")
        .update({ notion_error: message.slice(0, 500) })
        .in("id", result.saleIds);
    }
  }

  return result;
}

/** Totals for the event, for the counter on the raffle screens. */
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
