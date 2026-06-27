import { createClient } from "@/lib/supabase/server";
import { Table, Th, Td } from "@/components/ui/table";

const eur = (n: number) =>
  "€" + n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="border border-line bg-surface p-5">
      <p className="label-caps text-ink/60">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${accent ? "text-ink" : "text-bone"}`}>{value}</p>
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
    cogs += (costByVariant.get(s.variant_id) ?? 0) * s.quantity;
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
      <h1 className="label-caps text-ink/60">Finance</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Net revenue" value={eur(netRevenue)} />
        <Stat label="COGS" value={eur(cogs)} />
        <Stat label="Gross profit" value={eur(grossProfit)} accent />
        <Stat label="Gross margin" value={`${margin.toFixed(0)}%`} />
        <Stat label="Expenses" value={eur(totalExpenses)} />
        <Stat label="Net profit" value={eur(netProfit)} accent />
        <Stat label="Units sold" value={unitsSold.toString()} />
        <Stat label="Inventory @ cost" value={eur(inventoryValue)} />
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
    </div>
  );
}
