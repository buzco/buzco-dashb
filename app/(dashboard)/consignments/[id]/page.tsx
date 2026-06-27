import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { setConsignmentStatus } from "@/lib/actions/consignments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Th, Td } from "@/components/ui/table";
import { ConsignmentSendForm, LineQuantityAction } from "./consignment-forms";

function variantLabel(v: { sku: string; size: string | null; color: string | null; productName?: string }) {
  const attrs = [v.size, v.color].filter(Boolean).join(" / ");
  return `${v.productName ?? "?"} — ${v.sku}${attrs ? ` (${attrs})` : ""}`;
}

export default async function ConsignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: consignment } = await supabase
    .from("consignments")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!consignment) {
    notFound();
  }

  const [{ data: lines }, { data: locations }, { data: allVariants }, { data: retailer }] =
    await Promise.all([
      supabase
        .from("consignment_lines")
        .select("id, variant_id, quantity_sent, quantity_sold, quantity_returned, wholesale_price")
        .eq("consignment_id", id),
      supabase.from("inventory_locations").select("id, name, type").order("name"),
      supabase.from("variants").select("id, sku, size, color, product_id").order("sku"),
      supabase.from("retailers").select("name").eq("id", consignment.retailer_id).maybeSingle(),
    ]);

  const productIds = [...new Set((allVariants ?? []).map((v) => v.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name").in("id", productIds)
    : { data: [] };
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const variantById = new Map(
    (allVariants ?? []).map((v) => [v.id, { ...v, productName: productNameById.get(v.product_id) }]),
  );
  const variantOptions = (allVariants ?? []).map((v) => ({
    id: v.id,
    label: variantLabel({ ...v, productName: productNameById.get(v.product_id) }),
  }));

  // Warehouse for sending out of / returning into.
  const warehouse = (locations ?? []).find((l) => l.type === "warehouse");
  const defaultLocationId = warehouse?.id ?? locations?.[0]?.id ?? "";
  const sourceLocations = (locations ?? [])
    .filter((l) => l.type !== "consignment")
    .map((l) => ({ id: l.id, name: `${l.name} (${l.type})` }));

  const isClosed = consignment.status !== "active";

  return (
    <div className="space-y-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-bone">{retailer?.name ?? "Consignment"}</h1>
          <p className="mt-1 text-sm text-ink/60">
            {consignment.sent_date ? `Sent ${consignment.sent_date}` : "Consignment"}
          </p>
          {consignment.notes && <p className="mt-1 text-sm text-ink/50">{consignment.notes}</p>}
        </div>
        <Badge status={consignment.status} />
      </div>

      {consignment.status === "active" && (
        <div className="flex flex-wrap items-center gap-3">
          <form action={setConsignmentStatus.bind(null, consignment.id, "settled")}>
            <Button type="submit" variant="secondary">Mark settled</Button>
          </form>
          <form action={setConsignmentStatus.bind(null, consignment.id, "returned")}>
            <Button type="submit" variant="secondary">Close as returned</Button>
          </form>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="label-caps text-ink/60">Lines</h2>
        {!lines?.length ? (
          <p className="text-sm text-ink/50">Nothing sent yet — send a variant below.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th className="text-right">Sent</Th>
                <Th className="text-right">Sold</Th>
                <Th className="text-right">Returned</Th>
                <Th className="text-right">Out</Th>
                <Th className="text-right">Wholesale</Th>
                <Th>Mark sold</Th>
                <Th>Return</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const v = variantById.get(line.variant_id);
                const out = line.quantity_sent - line.quantity_sold - line.quantity_returned;
                return (
                  <tr key={line.id}>
                    <Td className="text-bone">{v ? variantLabel(v) : line.variant_id.slice(0, 8)}</Td>
                    <Td className="text-right font-mono tabular-nums">{line.quantity_sent}</Td>
                    <Td className="text-right font-mono tabular-nums">{line.quantity_sold}</Td>
                    <Td className="text-right font-mono tabular-nums">{line.quantity_returned}</Td>
                    <Td className="text-right font-mono tabular-nums text-bone">{out}</Td>
                    <Td className="text-right font-mono tabular-nums">
                      {line.wholesale_price != null ? `€${line.wholesale_price}` : "—"}
                    </Td>
                    <Td>
                      {out > 0 && !isClosed ? (
                        <LineQuantityAction
                          kind="sold"
                          consignmentId={consignment.id}
                          lineId={line.id}
                          max={out}
                          verb="Sold"
                        />
                      ) : (
                        <span className="label-caps text-ink/40">—</span>
                      )}
                    </Td>
                    <Td>
                      {out > 0 && !isClosed && defaultLocationId ? (
                        <LineQuantityAction
                          kind="return"
                          consignmentId={consignment.id}
                          lineId={line.id}
                          toLocationId={defaultLocationId}
                          max={out}
                          verb="Return"
                        />
                      ) : (
                        <span className="label-caps text-ink/40">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>

      {!isClosed && (
        <div className="space-y-3">
          <h2 className="label-caps text-ink/60">Send stock</h2>
          {!allVariants?.length ? (
            <p className="text-sm text-ink/50">Create a product and variant first.</p>
          ) : (
            <ConsignmentSendForm
              consignmentId={consignment.id}
              variants={variantOptions}
              locations={sourceLocations}
              defaultLocationId={defaultLocationId}
            />
          )}
        </div>
      )}
    </div>
  );
}
