import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createPurchaseOrder } from "@/lib/actions/purchase-orders";
import { Label, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export default async function NewPurchaseOrderPage() {
  const supabase = await createClient();
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .order("name");

  return (
    <div className="max-w-md space-y-8">
      <h1 className="label-caps text-ink/60">New purchase order</h1>

      <form action={createPurchaseOrder} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="supplier_id">Supplier</Label>
          <Select id="supplier_id" name="supplier_id" defaultValue="">
            <option value="">— None —</option>
            {(suppliers ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          {!suppliers?.length && (
            <p className="text-xs text-ink/50">
              No suppliers yet — <Link href="/suppliers" className="underline">add one</Link> (optional).
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="reference">Reference</Label>
          <Input id="reference" name="reference" placeholder="PO-2026-001" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="currency">Currency</Label>
            <Input id="currency" name="currency" defaultValue="EUR" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="order_date">Order date</Label>
            <Input id="order_date" name="order_date" type="date" />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="total_bill">Total bill</Label>
          <Input id="total_bill" name="total_bill" type="number" step="0.01" placeholder="Full invoice amount" />
        </div>

        <div className="space-y-1">
          <Label htmlFor="notes">Notes</Label>
          <Input id="notes" name="notes" />
        </div>

        <Button type="submit">Create PO</Button>
      </form>
    </div>
  );
}
