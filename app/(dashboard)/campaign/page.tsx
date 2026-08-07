import { createClient } from "@/lib/supabase/server";
import { CampaignCalculator, type CalcProduct } from "./calculator";

// A campaign promotes a PRODUCT, not a size. So the numbers are rolled up from
// variants to the product here: stock sums, while price and cost are averaged
// across the variants that actually carry a figure — weighted by stock, so the
// sizes you really hold decide the blended cost rather than a dead colourway.

function weightedAverage(rows: Array<{ value: number; weight: number }>): number {
  const usable = rows.filter((r) => r.value > 0);
  if (!usable.length) return 0;
  const totalWeight = usable.reduce((s, r) => s + r.weight, 0);
  // Every variant at zero stock — fall back to a plain mean so a sold-out
  // product still calculates instead of reporting €0.
  if (totalWeight <= 0) return usable.reduce((s, r) => s + r.value, 0) / usable.length;
  return usable.reduce((s, r) => s + r.value * r.weight, 0) / totalWeight;
}

/**
 * Something to tell two same-named products apart.
 *
 * Three separate Shopify products are all called "Butterfly Thermal Waffle
 * Longsleeve" (they're colourways), and none of them carry a colour on their
 * variants — so the picker would show three identical rows. What does differ is
 * the SKU stem: BWAF-BEI, BWAF-BLK, BWAF-PRP. Take the longest shared prefix of
 * the product's SKUs, trimmed back to a separator so it ends on a whole segment.
 */
function skuStem(skus: string[]): string | null {
  if (!skus.length) return null;
  let prefix = skus[0];
  for (const sku of skus.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < sku.length && prefix[i] === sku[i]) i++;
    prefix = prefix.slice(0, i);
  }
  const trimmed = prefix.replace(/[^A-Za-z0-9]+$/, "");
  return trimmed.length >= 3 ? trimmed : null;
}

export default async function CampaignPage() {
  const supabase = await createClient();

  const [{ data: products }, { data: variants }, { data: stock }] = await Promise.all([
    supabase.from("products").select("id, name, status").order("name"),
    supabase.from("variants").select("id, product_id, production_cost, retail_price, sku"),
    supabase.from("current_stock_by_variant").select("variant_id, total_quantity"),
  ]);

  const stockByVariant = new Map((stock ?? []).map((s) => [s.variant_id, s.total_quantity ?? 0]));

  const byProduct = new Map<
    string,
    Array<{ cost: number; price: number; qty: number; sku: string }>
  >();
  for (const v of variants ?? []) {
    const qty = stockByVariant.get(v.id) ?? 0;
    const list = byProduct.get(v.product_id) ?? [];
    list.push({
      cost: Number(v.production_cost ?? 0),
      price: Number(v.retail_price ?? 0),
      qty: Math.max(0, qty),
      sku: v.sku,
    });
    byProduct.set(v.product_id, list);
  }

  // Only disambiguate where it's actually needed — a stem next to every product
  // would be noise.
  const nameCounts = new Map<string, number>();
  for (const p of products ?? []) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);

  const calcProducts: CalcProduct[] = (products ?? [])
    .map((p) => {
      const rows = byProduct.get(p.id) ?? [];
      return {
        id: p.id,
        name: p.name,
        hint:
          (nameCounts.get(p.name) ?? 0) > 1
            ? skuStem(rows.map((r) => r.sku).filter(Boolean))
            : null,
        productionCost: weightedAverage(rows.map((r) => ({ value: r.cost, weight: r.qty }))),
        retailPrice: weightedAverage(rows.map((r) => ({ value: r.price, weight: r.qty }))),
        stock: rows.reduce((s, r) => s + r.qty, 0),
        variantCount: rows.length,
      };
    })
    .filter((p) => p.variantCount > 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="label-caps text-ink/60">Ad budget</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink/50">
          Tick every product going into the campaign. Prices and costs are averaged
          up from each product&apos;s variants (weighted by what you actually hold), so
          you plan a campaign the way you&apos;d run it — per product, not per size.
          The budget below is what the whole campaign can spend on ads and still
          break even.
        </p>
      </div>

      {!calcProducts.length ? (
        <p className="text-sm text-ink/50">
          Create a product with variants first, or sync from Shopify.
        </p>
      ) : (
        <CampaignCalculator products={calcProducts} />
      )}
    </div>
  );
}
