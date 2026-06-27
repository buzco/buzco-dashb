import { createClient } from "@/lib/supabase/server";
import { CampaignCalculator, type CalcVariant } from "./calculator";

function variantLabel(v: { sku: string; size: string | null; color: string | null; productName?: string }) {
  const attrs = [v.size, v.color].filter(Boolean).join(" / ");
  return `${v.productName ?? "?"} — ${v.sku}${attrs ? ` (${attrs})` : ""}`;
}

export default async function CampaignPage() {
  const supabase = await createClient();

  const [{ data: variants }, { data: stock }] = await Promise.all([
    supabase.from("variants").select("id, sku, size, color, product_id, production_cost, retail_price").order("sku"),
    supabase.from("current_stock_by_variant").select("variant_id, total_quantity"),
  ]);

  const productIds = [...new Set((variants ?? []).map((v) => v.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name").in("id", productIds)
    : { data: [] };
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const stockByVariant = new Map((stock ?? []).map((s) => [s.variant_id, s.total_quantity ?? 0]));

  const calcVariants: CalcVariant[] = (variants ?? []).map((v) => ({
    id: v.id,
    label: variantLabel({ ...v, productName: productNameById.get(v.product_id) }),
    productionCost: Number(v.production_cost ?? 0),
    retailPrice: Number(v.retail_price ?? 0),
    stock: stockByVariant.get(v.id) ?? 0,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="label-caps text-ink/60">Campaign calculator</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink/50">
          Pick a piece and the numbers fill in from your catalog. Tweak price, discount,
          shipping and fees to see — live — how much you can spend on ads and still break
          even (or keep the profit you want).
        </p>
      </div>

      {!calcVariants.length ? (
        <p className="text-sm text-ink/50">Create a product and variant first (or sync from Shopify).</p>
      ) : (
        <CampaignCalculator variants={calcVariants} />
      )}
    </div>
  );
}
