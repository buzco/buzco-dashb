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
        <div className="rounded-lg border border-line bg-surface p-6">
          <p className="label-caps text-ink/60">Products</p>
          <p className="mt-2 text-4xl font-bold text-bone">{productCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6">
          <p className="label-caps text-ink/60">Units in stock</p>
          <p className="mt-2 text-4xl font-bold tabular-nums text-bone">{totalUnits}</p>
        </div>
      </div>
    </div>
  );
}
