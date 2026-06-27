import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Th, Td } from "@/components/ui/table";

export default async function PurchaseOrdersPage() {
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("purchase_orders")
    .select("id, reference, status, currency, total_bill, order_date, supplier_id, created_at")
    .order("created_at", { ascending: false });

  const supplierIds = [...new Set((orders ?? []).map((o) => o.supplier_id).filter(Boolean) as string[])];
  const { data: suppliers } = supplierIds.length
    ? await supabase.from("suppliers").select("id, name").in("id", supplierIds)
    : { data: [] };
  const supplierById = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: lines } = orderIds.length
    ? await supabase
        .from("purchase_order_lines")
        .select("purchase_order_id, quantity_ordered, quantity_received")
        .in("purchase_order_id", orderIds)
    : { data: [] };

  const lineSummary = new Map<string, { ordered: number; received: number }>();
  for (const l of lines ?? []) {
    const cur = lineSummary.get(l.purchase_order_id) ?? { ordered: 0, received: 0 };
    cur.ordered += l.quantity_ordered;
    cur.received += l.quantity_received;
    lineSummary.set(l.purchase_order_id, cur);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="label-caps text-ink/60">Purchase Orders</h1>
        <Link href="/purchase-orders/new">
          <Button>New PO</Button>
        </Link>
      </div>

      {!orders?.length ? (
        <p className="text-sm text-ink/50">No purchase orders yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Reference</Th>
              <Th>Supplier</Th>
              <Th>Status</Th>
              <Th>Ordered</Th>
              <Th className="text-right">Received</Th>
              <Th className="text-right">Total</Th>
              <Th>Date</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const sum = lineSummary.get(o.id) ?? { ordered: 0, received: 0 };
              return (
                <tr key={o.id}>
                  <Td>
                    <Link href={`/purchase-orders/${o.id}`} className="underline-offset-2 hover:underline">
                      {o.reference ?? o.id.slice(0, 8)}
                    </Link>
                  </Td>
                  <Td className="text-ink/70">
                    {o.supplier_id ? supplierById.get(o.supplier_id) ?? "—" : "—"}
                  </Td>
                  <Td><Badge status={o.status} /></Td>
                  <Td className="font-mono tabular-nums">{sum.ordered}</Td>
                  <Td className="text-right font-mono tabular-nums">{sum.received}</Td>
                  <Td className="text-right font-mono tabular-nums">
                    {o.total_bill != null ? `${o.currency ?? "EUR"} ${o.total_bill}` : "—"}
                  </Td>
                  <Td className="text-ink/70">{o.order_date ?? "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
