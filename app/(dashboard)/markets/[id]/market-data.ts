import "server-only";

import { SIZE_RUN } from "@/lib/sizes";
import { createClient } from "@/lib/supabase/server";

// Shared loader for the market console. Every tab needs the same shape of the
// crate (what's loaded, what's left, what it sells for today), so it's built
// once here rather than re-derived per tab.

export type MarketVariantView = {
  variantId: string;
  size: string | null;
  color: string | null;
  sku: string;
  retailPrice: number | null;
  /** Units physically left at the market right now. */
  inCrate: number;
  /** Units sold at this event. */
  sold: number;
  /** Today's price for this size, after override resolution. */
  price: number | null;
  /** True when `price` came from a market override rather than retail. */
  discounted: boolean;
};

export type MarketProductView = {
  productId: string;
  name: string;
  imageUrl: string | null;
  variants: MarketVariantView[];
  inCrate: number;
  sold: number;
  /** The event's product-level price override, if one is set. */
  eventPrice: number | null;
  /** Representative retail price, for showing what the discount is off. */
  retailPrice: number | null;
};

export type MarketEvent = {
  id: string;
  name: string;
  venue: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  location_id: string;
  notes: string | null;
};

export type MarketSaleView = {
  id: string;
  quantity: number;
  grossAmount: number;
  netAmount: number;
  soldAt: string;
  customerRef: string | null;
  paymentMethod: string | null;
  notes: string | null;
  shopifyOrderId: string | null;
  notionPageId: string | null;
  notionError: string | null;
  productName: string;
  size: string | null;
  sku: string;
};

export type MarketData = {
  event: MarketEvent;
  products: MarketProductView[];
  sales: MarketSaleView[];
  totals: { inCrate: number; sold: number; revenue: number; unsyncedNotion: number };
  /** `stockTotal` drives the load-in default: pointing at an empty location
   *  (their Main Warehouse holds 0 — everything sits in the Shopify mirror)
   *  makes every load-in fail the source guard. */
  locations: Array<{ id: string; name: string; type: string; stockTotal: number }>;
};

/** variant override -> product default -> variant retail price. */
function resolvePrice(
  variantId: string,
  productId: string,
  retail: number | null,
  variantOverrides: Map<string, number>,
  productOverrides: Map<string, number>,
): { price: number | null; discounted: boolean } {
  const variantOverride = variantOverrides.get(variantId);
  if (variantOverride != null) return { price: variantOverride, discounted: true };
  const productOverride = productOverrides.get(productId);
  if (productOverride != null) return { price: productOverride, discounted: true };
  return { price: retail, discounted: false };
}

export async function loadMarketData(eventId: string): Promise<MarketData | null> {
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("market_events")
    .select("id, name, venue, starts_at, ends_at, status, location_id, notes")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;

  // current_stock keeps a row at 0 once something is loaded and then sold out,
  // which is exactly what we want — "sold out" must stay visible on the grid.
  const [{ data: stock }, { data: prices }, { data: saleRows }, { data: locations }, { data: allStock }] =
    await Promise.all([
      supabase
        .from("current_stock")
        .select("variant_id, quantity")
        .eq("location_id", event.location_id),
      supabase
        .from("market_prices")
        .select("product_id, variant_id, price")
        .eq("market_event_id", eventId),
      supabase
        .from("sales")
        .select(
          "id, variant_id, quantity, gross_amount, net_amount, sold_at, customer_ref, payment_method, notes, shopify_order_id, notion_page_id, notion_error",
        )
        .eq("market_event_id", eventId)
        .order("sold_at", { ascending: false }),
      supabase.from("inventory_locations").select("id, name, type").order("name"),
      supabase.from("current_stock").select("location_id, quantity"),
    ]);

  const stockTotalByLocation = new Map<string, number>();
  for (const row of allStock ?? []) {
    stockTotalByLocation.set(
      row.location_id,
      (stockTotalByLocation.get(row.location_id) ?? 0) + row.quantity,
    );
  }

  const crateByVariant = new Map((stock ?? []).map((s) => [s.variant_id, s.quantity]));
  const soldByVariant = new Map<string, number>();
  for (const s of saleRows ?? []) {
    // Raffle ticket rows carry no variant — they're money, not garments.
    if (!s.variant_id) continue;
    soldByVariant.set(s.variant_id, (soldByVariant.get(s.variant_id) ?? 0) + s.quantity);
  }

  // Every variant we need to describe: currently in the crate, or sold from it.
  const variantIds = [...new Set([...crateByVariant.keys(), ...soldByVariant.keys()])];
  const { data: variants } = variantIds.length
    ? await supabase
        .from("variants")
        .select("id, product_id, size, color, sku, retail_price")
        .in("id", variantIds)
    : { data: [] };

  const productIds = [...new Set((variants ?? []).map((v) => v.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name, image_url").in("id", productIds)
    : { data: [] };
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  const variantOverrides = new Map<string, number>();
  const productOverrides = new Map<string, number>();
  for (const p of prices ?? []) {
    if (p.variant_id) variantOverrides.set(p.variant_id, Number(p.price));
    else productOverrides.set(p.product_id, Number(p.price));
  }

  // Group variants under their product.
  const grouped = new Map<string, MarketProductView>();
  for (const v of variants ?? []) {
    const product = productById.get(v.product_id);
    let entry = grouped.get(v.product_id);
    if (!entry) {
      entry = {
        productId: v.product_id,
        name: product?.name ?? "Unknown product",
        imageUrl: product?.image_url ?? null,
        variants: [],
        inCrate: 0,
        sold: 0,
        eventPrice: productOverrides.get(v.product_id) ?? null,
        retailPrice: null,
      };
      grouped.set(v.product_id, entry);
    }

    const retail = v.retail_price == null ? null : Number(v.retail_price);
    const { price, discounted } = resolvePrice(
      v.id,
      v.product_id,
      retail,
      variantOverrides,
      productOverrides,
    );
    const inCrate = crateByVariant.get(v.id) ?? 0;
    const sold = soldByVariant.get(v.id) ?? 0;

    entry.variants.push({
      variantId: v.id,
      size: v.size,
      color: v.color,
      sku: v.sku,
      retailPrice: retail,
      inCrate,
      sold,
      price,
      discounted,
    });
    entry.inCrate += inCrate;
    entry.sold += sold;
    if (retail != null) entry.retailPrice = Math.max(entry.retailPrice ?? 0, retail);
  }

  const variantById = new Map((variants ?? []).map((v) => [v.id, v]));
  const sales: MarketSaleView[] = (saleRows ?? []).map((s) => {
    const v = s.variant_id ? variantById.get(s.variant_id) : undefined;
    return {
      id: s.id,
      quantity: s.quantity,
      grossAmount: Number(s.gross_amount),
      netAmount: Number(s.net_amount),
      soldAt: s.sold_at,
      customerRef: s.customer_ref,
      paymentMethod: s.payment_method,
      notes: s.notes,
      shopifyOrderId: s.shopify_order_id,
      notionPageId: s.notion_page_id,
      notionError: s.notion_error,
      productName: v
        ? (productById.get(v.product_id)?.name ?? "Unknown")
        : (s.notes ?? "Rifas"),
      size: v?.size ?? null,
      sku: v?.sku ?? "—",
    };
  });

  const productList = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of productList) {
    p.variants.sort(bySizeThenSku);
  }

  return {
    event,
    products: productList,
    sales,
    totals: {
      inCrate: productList.reduce((sum, p) => sum + p.inCrate, 0),
      sold: sales.reduce((sum, s) => sum + s.quantity, 0),
      revenue: sales.reduce((sum, s) => sum + s.netAmount, 0),
      unsyncedNotion: sales.filter((s) => !s.notionPageId).length,
    },
    locations: (locations ?? []).map((l) => ({
      ...l,
      stockTotal: stockTotalByLocation.get(l.id) ?? 0,
    })),
  };
}

// Sizes must read XS → S → M → L → XL, not alphabetically. Extends the
// purchase-order size run with the odd sizes that show up on caps/towels.
const SIZE_ORDER = ["XXS", ...SIZE_RUN, "3XL", "OS", "ONE SIZE"];

function bySizeThenSku(a: MarketVariantView, b: MarketVariantView): number {
  const ai = SIZE_ORDER.indexOf((a.size ?? "").toUpperCase());
  const bi = SIZE_ORDER.indexOf((b.size ?? "").toUpperCase());
  if (ai !== -1 && bi !== -1 && ai !== bi) return ai - bi;
  if (ai !== -1 && bi === -1) return -1;
  if (ai === -1 && bi !== -1) return 1;
  return (a.size ?? a.color ?? a.sku).localeCompare(b.size ?? b.color ?? b.sku);
}
