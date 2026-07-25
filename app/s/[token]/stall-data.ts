import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { SIZE_RUN } from "@/lib/sizes";

// Data for the stall links. Uses the service-role client because these pages
// have no logged-in user. Stock now comes from the Shopify mirror location —
// Shopify is the stock centre, so what's sellable is simply what Shopify has.

export type StallVariant = {
  variantId: string;
  size: string | null;
  sku: string;
  available: number;
  price: number | null;
};

export type StallProduct = {
  productId: string;
  name: string;
  imageUrl: string | null;
  retailPrice: number | null;
  variants: StallVariant[];
  available: number;
};

export type StallEvent = { id: string; name: string; venue: string | null; status: string };

const SIZE_ORDER = ["XXS", ...SIZE_RUN, "3XL", "OS", "ONE SIZE"];

function bySize(a: StallVariant, b: StallVariant): number {
  const ai = SIZE_ORDER.indexOf((a.size ?? "").toUpperCase());
  const bi = SIZE_ORDER.indexOf((b.size ?? "").toUpperCase());
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return (a.size ?? a.sku).localeCompare(b.size ?? b.sku);
}

/** The event a helper should be selling into: the live one, else the newest open one. */
export async function currentStallEvent(): Promise<StallEvent | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("market_events")
    .select("id, name, venue, status")
    .neq("status", "closed")
    .order("status", { ascending: true }) // 'live' sorts before 'planning'
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function listOpenEvents(): Promise<StallEvent[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("market_events")
    .select("id, name, venue, status")
    .neq("status", "closed")
    .order("starts_at", { ascending: false });
  return data ?? [];
}

export async function loadStallCatalog(eventId: string): Promise<StallProduct[]> {
  const supabase = createAdminClient();

  const { data: shopifyLoc } = await supabase
    .from("inventory_locations")
    .select("id")
    .eq("type", "shopify")
    .limit(1)
    .maybeSingle();
  if (!shopifyLoc) return [];

  const [{ data: stock }, { data: prices }] = await Promise.all([
    supabase
      .from("current_stock")
      .select("variant_id, quantity")
      .eq("location_id", shopifyLoc.id)
      .gt("quantity", 0),
    supabase
      .from("market_prices")
      .select("product_id, variant_id, price")
      .eq("market_event_id", eventId),
  ]);

  const qtyByVariant = new Map((stock ?? []).map((s) => [s.variant_id, s.quantity]));
  if (!qtyByVariant.size) return [];

  const { data: variants } = await supabase
    .from("variants")
    .select("id, product_id, size, sku, retail_price")
    .in("id", [...qtyByVariant.keys()]);

  const productIds = [...new Set((variants ?? []).map((v) => v.product_id))];
  const { data: products } = await supabase
    .from("products")
    .select("id, name, image_url")
    .in("id", productIds);
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  const variantOverride = new Map<string, number>();
  const productOverride = new Map<string, number>();
  for (const p of prices ?? []) {
    if (p.variant_id) variantOverride.set(p.variant_id, Number(p.price));
    else productOverride.set(p.product_id, Number(p.price));
  }

  const grouped = new Map<string, StallProduct>();
  for (const v of variants ?? []) {
    const product = productById.get(v.product_id);
    let entry = grouped.get(v.product_id);
    if (!entry) {
      entry = {
        productId: v.product_id,
        name: product?.name ?? "Unknown",
        imageUrl: product?.image_url ?? null,
        retailPrice: null,
        variants: [],
        available: 0,
      };
      grouped.set(v.product_id, entry);
    }
    const retail = v.retail_price == null ? null : Number(v.retail_price);
    const price = variantOverride.get(v.id) ?? productOverride.get(v.product_id) ?? retail;
    const available = qtyByVariant.get(v.id) ?? 0;

    entry.variants.push({ variantId: v.id, size: v.size, sku: v.sku, available, price });
    entry.available += available;
    if (retail != null) entry.retailPrice = Math.max(entry.retailPrice ?? 0, retail);
  }

  const list = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of list) p.variants.sort(bySize);
  return list;
}
