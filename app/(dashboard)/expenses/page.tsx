import { createClient } from "@/lib/supabase/server";
import { createExpense } from "@/lib/actions/expenses";
import { Table, Th, Td } from "@/components/ui/table";
import { Label, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const eur = (n: number) =>
  "€" + Number(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CATEGORIES = ["production", "software", "subscription", "shipping", "ads", "fees", "rent", "other"];

export default async function ExpensesPage() {
  const supabase = await createClient();
  const { data: expenses } = await supabase
    .from("expenses")
    .select("id, category, description, amount, currency, incurred_at, recurring_interval, source")
    .order("incurred_at", { ascending: false })
    .limit(100);

  const total = (expenses ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0);

  return (
    <div className="space-y-10">
      <h1 className="label-caps text-ink/60">Expenses</h1>

      {!expenses?.length ? (
        <p className="text-sm text-ink/50">No expenses yet.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink/60">
            Total recorded: <span className="font-mono text-bone">{eur(total)}</span>
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Category</Th>
                <Th>Description</Th>
                <Th>Source</Th>
                <Th>Recurring</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <Td className="text-ink/70">{e.incurred_at ?? "—"}</Td>
                  <Td>{e.category}</Td>
                  <Td className="text-ink/70">{e.description ?? "—"}</Td>
                  <Td className="label-caps text-ink/50">{e.source}</Td>
                  <Td className="text-ink/70">{e.recurring_interval ?? "—"}</Td>
                  <Td className="text-right font-mono tabular-nums text-bone">
                    {e.currency ?? "EUR"} {Number(e.amount).toFixed(2)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <div className="max-w-md space-y-3">
        <h2 className="label-caps text-ink/60">Add expense</h2>
        <form action={createExpense} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="category">Category</Label>
              <Select id="category" name="category" defaultValue="software">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="amount">Amount €</Label>
              <Input id="amount" name="amount" type="number" step="0.01" min="0" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="incurred_at">Date</Label>
              <Input id="incurred_at" name="incurred_at" type="date" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="recurring_interval">Recurring</Label>
              <Select id="recurring_interval" name="recurring_interval" defaultValue="">
                <option value="">one-off</option>
                <option value="monthly">monthly</option>
                <option value="yearly">yearly</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <Input id="description" name="description" placeholder="Figma, Shopify plan, fabric…" />
          </div>
          <Button type="submit">Add expense</Button>
        </form>
      </div>
    </div>
  );
}
