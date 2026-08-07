import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Table, Th, Td } from "@/components/ui/table";

const eur = (n: number) =>
  "€" + n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Each tile says where its number came from. This page does no bookkeeping of
// its own — it only adds up rows other parts of the app wrote — so being able
// to trace a figure back to its table is the difference between trusting it and
// guessing.
function Stat({
  label,
  value,
  source,
  accent,
}: {
  label: string;
  value: string;
  source: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface/90 p-5 backdrop-blur-sm">
      <p className="label-caps text-ink/60">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${accent ? "text-ink" : "text-bone"}`}>{value}</p>
      <p className="mt-1 text-xs text-ink/40">{source}</p>
    </div>
  );
}

export default async function FinancePage() {
  const supabase = await createClient();

  const [{ data: sales }, { data: expenses }, { data: variants }, { data: stock }] =
    await Promise.all([
      supabase.from("sales").select("channel, quantity, gross_amount, net_amount, variant_id"),
      supabase.from("expenses").select("category, amount"),
      supabase.from("variants").select("id, production_cost"),
      supabase.from("current_stock_by_variant").select("variant_id, total_quantity"),
    ]);

  const costByVariant = new Map((variants ?? []).map((v) => [v.id, Number(v.production_cost ?? 0)]));

  // Revenue, units, COGS
  let netRevenue = 0;
  let unitsSold = 0;
  let cogs = 0;
  const revenueByChannel = new Map<string, { net: number; units: number }>();
  for (const s of sales ?? []) {
    netRevenue += Number(s.net_amount ?? 0);
    unitsSold += s.quantity;
    // A missing production cost contributes nothing — which covers raffle
    // tickets (genuinely costless) and any product whose cost was never entered
    // (a data gap that quietly understates COGS). Both are called out below.
    cogs += (s.variant_id ? (costByVariant.get(s.variant_id) ?? 0) : 0) * s.quantity;
    const ch = revenueByChannel.get(s.channel) ?? { net: 0, units: 0 };
    ch.net += Number(s.net_amount ?? 0);
    ch.units += s.quantity;
    revenueByChannel.set(s.channel, ch);
  }

  // Expenses
  let totalExpenses = 0;
  const expensesByCategory = new Map<string, number>();
  for (const e of expenses ?? []) {
    totalExpenses += Number(e.amount ?? 0);
    expensesByCategory.set(e.category, (expensesByCategory.get(e.category) ?? 0) + Number(e.amount ?? 0));
  }

  // Inventory value at cost
  let inventoryValue = 0;
  for (const row of stock ?? []) {
    inventoryValue += (costByVariant.get(row.variant_id) ?? 0) * (row.total_quantity ?? 0);
  }

  const grossProfit = netRevenue - cogs;
  const netProfit = grossProfit - totalExpenses;
  const margin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="label-caps text-ink/60">Finance</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink/50">
          Everything here is summed live from four places: every row in{" "}
          <span className="text-ink/80">sales</span> (logged at markets, imported from
          Shopify orders, or entered by hand), every row in{" "}
          <Link href="/expenses" className="text-ink/80 underline underline-offset-2 hover:text-ink">
            expenses
          </Link>
          , the <span className="text-ink/80">production cost</span> on each variant, and
          current stock levels. It covers all time — there is no date filter yet.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Net revenue" value={eur(netRevenue)} source="Σ sales.net_amount" />
        <Stat label="COGS" value={eur(cogs)} source="units sold × variant cost" />
        <Stat label="Gross profit" value={eur(grossProfit)} source="net revenue − COGS" accent />
        <Stat label="Gross margin" value={`${margin.toFixed(0)}%`} source="gross profit ÷ net revenue" />
        <Stat label="Expenses" value={eur(totalExpenses)} source="Σ expenses.amount" />
        <Stat label="Net profit" value={eur(netProfit)} source="gross profit − expenses" accent />
        <Stat label="Units sold" value={unitsSold.toString()} source="Σ sales.quantity" />
        <Stat label="Inventory @ cost" value={eur(inventoryValue)} source="stock on hand × variant cost" />
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="label-caps text-ink/60">Revenue by channel</h2>
          {!revenueByChannel.size ? (
            <p className="text-sm text-ink/50">No sales yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Channel</Th>
                  <Th className="text-right">Units</Th>
                  <Th className="text-right">Net revenue</Th>
                </tr>
              </thead>
              <tbody>
                {[...revenueByChannel.entries()]
                  .sort((a, b) => b[1].net - a[1].net)
                  .map(([ch, v]) => (
                    <tr key={ch}>
                      <Td className="label-caps">{ch.replace(/_/g, " ")}</Td>
                      <Td className="text-right font-mono tabular-nums">{v.units}</Td>
                      <Td className="text-right font-mono tabular-nums text-bone">{eur(v.net)}</Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          )}
        </div>

        <div className="space-y-3">
          <h2 className="label-caps text-ink/60">Expenses by category</h2>
          {!expensesByCategory.size ? (
            <p className="text-sm text-ink/50">No expenses yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Category</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {[...expensesByCategory.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, amt]) => (
                    <tr key={cat}>
                      <Td>{cat}</Td>
                      <Td className="text-right font-mono tabular-nums text-bone">{eur(amt)}</Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          )}
        </div>
      </div>

      <div className="max-w-2xl space-y-2 border-t border-line pt-6 text-xs text-ink/40">
        <p className="label-caps text-ink/50">Worth knowing</p>
        <p>
          COGS only counts variants that have a production cost recorded. Anything
          without one — raffle tickets, and any product whose cost was never filled in
          — contributes €0 to COGS and so flatters gross margin. Worth checking before
          quoting the margin.
        </p>
        <p>
          COGS also uses each variant&apos;s <em>current</em> production cost, not the
          cost at the moment it sold, so re-costing a variant moves history. Planning
          ad spend against these margins lives in{" "}
          <Link href="/campaign" className="text-ink/70 underline underline-offset-2 hover:text-ink">
            Ad budget
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
