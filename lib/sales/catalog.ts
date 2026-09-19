import "server-only";

import { SIZE_RUN } from "@/lib/sizes";
import { createClient } from "@/lib/supabase/server";

// What the sales logger can sell right now, with the stock figure it shows on
// every size button.
//
// Stock is read from the `shopify` mirror location rather than summed across
// every location, because Shopify is the stock centre: logging a sale creates a
// Shopify order that decrements exactly this pool. Showing a warehouse total
// here would promise units the till can't actually sell.

export type SaleVariantView = {
  variantId: string;
  size: string | null;
  color: string | null;
  sku: string;
  /** Live Shopify on-hand for this size. */
  available: number;
  /** Retail price per unit. */
  price: number | null;
  /** Null until the product has been pushed to Shopify. */
  shopifyVariantId: string | null;
};

export type SaleProductView = {
  productId: string;
  name: string;
  /**
   * Set when every variant shares a colour the product NAME does not mention —
   * the three Butterfly longsleeves, which are otherwise three identical cards.
   */
  colourway: string | null;
  imageUrl: string | null;
  price: number | null;
  variants: SaleVariantView[];
  available: number;
};

const SIZE_ORDER = ["XXS", ...SIZE_RUN, "3XL", "OS", "ONE SIZE"];

function bySize(a: SaleVariantView, b: SaleVariantView): number {
  const ai = SIZE_ORDER.indexOf((a.size ?? "").toUpperCase());
  const bi = SIZE_ORDER.indexOf((b.size ?? "").toUpperCase());
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return (a.size ?? a.color ?? a.sku).localeCompare(b.size ?? b.color ?? b.sku);
}

/** The location mirroring Shopify's on-hand — the pool the catalog reads from. */
async function shopifyLocationId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("inventory_locations")
    .select("id")
    .eq("type", "shopify")
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Every product with a variant that has stock, or that has ever had stock.
 *
 * Sold-out sizes are kept (and rendered struck through) rather than hidden: a
 * seller reaching for a size that isn't there needs to see it's gone, not
 * wonder whether they're on the wrong screen.
 */
export async function loadSaleCatalog(): Promise<SaleProductView[]> {
  const supabase = await createClient();

  const locationId = await shopifyLocationId();
  if (!locationId) return [];

  const { data: stock } = await supabase
    .from("current_stock")
    .select("variant_id, quantity")
    .eq("location_id", locationId);

  const qtyByVariant = new Map((stock ?? []).map((s) => [s.variant_id, s.quantity]));
  if (!qtyByVariant.size) return [];

  const { data: variants } = await supabase
    .from("variants")
    .select("id, product_id, size, color, sku, retail_price, shopify_variant_id")
    .in("id", [...qtyByVariant.keys()]);

  const productIds = [...new Set((variants ?? []).map((v) => v.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name, image_url").in("id", productIds)
    : { data: [] };
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  const grouped = new Map<string, SaleProductView>();
  for (const v of variants ?? []) {
    const product = productById.get(v.product_id);
    let entry = grouped.get(v.product_id);
    if (!entry) {
      entry = {
        productId: v.product_id,
        name: product?.name ?? "Unknown product",
        colourway: null,
        imageUrl: product?.image_url ?? null,
        price: null,
        variants: [],
        available: 0,
      };
      grouped.set(v.product_id, entry);
    }

    const retail = v.retail_price == null ? null : Number(v.retail_price);
    const available = qtyByVariant.get(v.id) ?? 0;

    entry.variants.push({
      variantId: v.id,
      size: v.size,
      color: v.color,
      sku: v.sku,
      available,
      price: retail,
      shopifyVariantId: v.shopify_variant_id,
    });
    entry.available += Math.max(0, available);
    if (retail != null) entry.price = Math.max(entry.price ?? 0, retail);
  }

  const list = [...grouped.values()]
    // A product with nothing left anywhere is noise on a phone screen.
    .filter((p) => p.available > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const p of list) {
    p.variants.sort(bySize);
    // Only worth showing when it actually disambiguates: one colour across the
    // product, and a name that does not already say it.
    const colours = [...new Set(p.variants.map((v) => v.color).filter(Boolean))] as string[];
    if (colours.length === 1 && !p.name.toLowerCase().includes(colours[0].toLowerCase())) {
      p.colourway = colours[0];
    }
  }
  return list;
}
