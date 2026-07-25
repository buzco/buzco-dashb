import "server-only";

import { createMarketOrder } from "@/lib/shopify/create-order";
import { isNotionConfigured } from "@/lib/notion/client";
import { mirrorSalesToNotion } from "@/lib/notion/mirror";
import type { createClient } from "@/lib/supabase/server";

// One code path for recording a market sale, shared by the dashboard's sell
// sheet and the standalone POS link (which has no user session and passes the
// service-role client).
//
// Order of operations matters. Shopify goes FIRST: it owns stock now, so if it
// rejects the sale — variant sold out, order refused — nothing is recorded
// anywhere and the seller sees the failure. Once Shopify has accepted, the
// ledger row is written, and only then Notion, which is a mirror and must never
// be able to fail the sale.

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

export type RecordSaleInput = {
  eventId: string;
  variantId: string;
  quantity: number;
  /** Price per unit actually charged, after any market discount. */
  unitPrice: number;
  paymentMethod: string | null;
  customerRef?: string | null;
  notes?: string | null;
};

export type RecordSaleResult = {
  saleId: string;
  shopifyOrderName: string | null;
  /** Set when the sale is recorded but Shopify couldn't be reached. */
  warning?: string;
};

/** The location mirroring Shopify's on-hand — the pool sales now come out of. */
async function shopifyLocationId(supabase: SupabaseLike): Promise<string | null> {
  const { data } = await supabase
    .from("inventory_locations")
    .select("id")
    .eq("type", "shopify")
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function recordMarketSale(
  supabase: SupabaseLike,
  input: RecordSaleInput,
): Promise<RecordSaleResult> {
  const { eventId, variantId, quantity, unitPrice } = input;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a whole number above zero");
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error("Enter a valid price");
  }

  const [{ data: variant }, { data: event }] = await Promise.all([
    supabase
      .from("variants")
      .select("id, sku, shopify_variant_id, products ( name )")
      .eq("id", variantId)
      .single(),
    supabase.from("market_events").select("id, name").eq("id", eventId).single(),
  ]);
  if (!variant) throw new Error("Unknown item");
  if (!event) throw new Error("Market event not found");

  // --- 1. Shopify (stock centre) ---
  let shopifyOrderId: string | null = null;
  let shopifyOrderName: string | null = null;
  let warning: string | undefined;

  if (variant.shopify_variant_id) {
    const order = await createMarketOrder({
      lines: [
        {
          shopifyVariantId: variant.shopify_variant_id,
          quantity,
          unitPrice,
        },
      ],
      customerRef: input.customerRef ?? null,
      paymentMethod: input.paymentMethod,
      eventName: event.name,
    });
    shopifyOrderId = order.id;
    shopifyOrderName = order.name;
  } else {
    // Not linked to Shopify (a product that was never pushed): still record the
    // sale, but say plainly that Shopify's stock wasn't touched.
    warning = `${variant.sku} isn't linked to Shopify — the sale was recorded but Shopify stock is unchanged.`;
  }

  // --- 2. Our ledger, mirroring the same pool Shopify just decremented ---
  const locationId = await shopifyLocationId(supabase);
  const gross = Math.round(unitPrice * quantity * 100) / 100;

  const { data: sale, error } = await supabase.rpc("log_market_sale", {
    p_market_event_id: eventId,
    p_variant_id: variantId,
    p_quantity: quantity,
    p_gross_amount: gross,
    p_discount_amount: 0,
    p_fees_amount: 0,
    p_customer_ref: input.customerRef ?? null,
    p_notes: input.notes ?? null,
    p_payment_method: input.paymentMethod,
    p_shopify_order_id: shopifyOrderId,
    p_location_id: locationId,
  });
  if (error) throw new Error(error.message);
  if (!sale) throw new Error("Sale was not recorded");

  // --- 3. Notion mirror (never fatal) ---
  if (isNotionConfigured()) {
    await mirrorSalesToNotion([sale.id], supabase);
  }

  return { saleId: sale.id, shopifyOrderName, warning };
}
