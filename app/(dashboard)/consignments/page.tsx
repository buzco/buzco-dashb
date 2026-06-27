import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Th, Td } from "@/components/ui/table";

export default async function ConsignmentsPage() {
  const supabase = await createClient();

  const { data: consignments } = await supabase
    .from("consignments")
    .select("id, retailer_id, status, sent_date, created_at")
    .order("created_at", { ascending: false });

  const retailerIds = [...new Set((consignments ?? []).map((c) => c.retailer_id))];
  const { data: retailers } = retailerIds.length
    ? await supabase.from("retailers").select("id, name").in("id", retailerIds)
    : { data: [] };
  const retailerName = new Map((retailers ?? []).map((r) => [r.id, r.name]));

  const ids = (consignments ?? []).map((c) => c.id);
  const { data: lines } = ids.length
    ? await supabase
        .from("consignment_lines")
        .select("consignment_id, quantity_sent, quantity_sold, quantity_returned")
        .in("consignment_id", ids)
    : { data: [] };

  const summary = new Map<string, { sent: number; sold: number; returned: number }>();
  for (const l of lines ?? []) {
    const cur = summary.get(l.consignment_id) ?? { sent: 0, sold: 0, returned: 0 };
    cur.sent += l.quantity_sent;
    cur.sold += l.quantity_sold;
    cur.returned += l.quantity_returned;
    summary.set(l.consignment_id, cur);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="label-caps text-ink/60">Consignments</h1>
        <Link href="/consignments/new">
          <Button>New consignment</Button>
        </Link>
      </div>

      {!consignments?.length ? (
        <p className="text-sm text-ink/50">No consignments yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Retailer</Th>
              <Th>Status</Th>
              <Th>Sent</Th>
              <Th className="text-right">Out</Th>
              <Th className="text-right">Sold</Th>
              <Th className="text-right">Returned</Th>
            </tr>
          </thead>
          <tbody>
            {consignments.map((c) => {
              const s = summary.get(c.id) ?? { sent: 0, sold: 0, returned: 0 };
              const out = s.sent - s.sold - s.returned;
              return (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/consignments/${c.id}`} className="text-bone underline-offset-2 hover:underline">
                      {retailerName.get(c.retailer_id) ?? "—"}
                    </Link>
                  </Td>
                  <Td><Badge status={c.status} /></Td>
                  <Td className="text-ink/70">{c.sent_date ?? "—"}</Td>
                  <Td className="text-right font-mono tabular-nums text-bone">{out}</Td>
                  <Td className="text-right font-mono tabular-nums">{s.sold}</Td>
                  <Td className="text-right font-mono tabular-nums">{s.returned}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
