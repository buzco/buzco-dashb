import { createClient } from "@/lib/supabase/server";

export default async function OverviewPage() {
  const supabase = await createClient();

  const [{ count: productCount }, { data: stockRows }] = await Promise.all([
    supabase.from("products").select("*", { count: "exact", head: true }),
    supabase.from("current_stock_by_variant").select("total_quantity"),
  ]);

  const totalUnits = (stockRows ?? []).reduce((sum, row) => sum + (row.total_quantity ?? 0), 0);

  return (
    <div className="space-y-8">
      <h1 className="label-caps text-ink/60">Overview</h1>
      <div className="flex gap-8">
        <div className="border border-line bg-white p-6">
          <p className="label-caps text-ink/50">Products</p>
          <p className="mt-2 text-3xl font-semibold text-ink">{productCount ?? 0}</p>
        </div>
        <div className="border border-line bg-white p-6">
          <p className="label-caps text-ink/50">Units in stock</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-ink">{totalUnits}</p>
        </div>
      </div>
    </div>
  );
}
