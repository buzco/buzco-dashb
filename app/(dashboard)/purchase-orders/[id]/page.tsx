import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  addPurchaseOrderLine,
  addPoSizeRun,
  setPurchaseOrderStatus,
  recordPurchaseOrderExpense,
} from "@/lib/actions/purchase-orders";
import { SIZE_RUN } from "@/lib/sizes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Th, Td } from "@/components/ui/table";
import { Label, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ReceiveLineForm } from "./receive-line-form";

function variantLabel(v: {
  sku: string;
  size: string | null;
  color: string | null;
  productName?: string;
}) {
  const attrs = [v.size, v.color].filter(Boolean).join(" / ");
  return `${v.productName ?? "?"} — ${v.sku}${attrs ? ` (${attrs})` : ""}`;
}

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!po) {
    notFound();
  }

  const [{ data: lines }, { data: locations }, { data: allVariants }, { data: expense }] =
    await Promise.all([
      supabase
        .from("purchase_order_lines")
        .select("id, variant_id, quantity_ordered, quantity_received, unit_cost")
        .eq("purchase_order_id", id),
      supabase.from("inventory_locations").select("id, name, type").order("name"),
      supabase.from("variants").select("id, sku, size, color, product_id").order("sku"),
      supabase
        .from("expenses")
        .select("id, amount, currency")
        .eq("source", "purchase_order")
        .eq("source_id", id)
        .maybeSingle(),
    ]);

  // Resolve product names for variants (for both the line table and add-line picker).
  const productIds = [...new Set((allVariants ?? []).map((v) => v.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name").in("id", productIds)
    : { data: [] };
  // All products (not just those with variants) for the size-run picker.
  const { data: allProducts } = await supabase
    .from("products")
    .select("id, name")
    .order("name");

  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const variantById = new Map(
    (allVariants ?? []).map((v) => [
      v.id,
      { ...v, productName: productNameById.get(v.product_id) },
    ]),
  );

  const supplier = po.supplier_id
    ? (await supabase.from("suppliers").select("name").eq("id", po.supplier_id).maybeSingle()).data
    : null;

  const warehouse = (locations ?? []).find((l) => l.type === "warehouse");
  const defaultLocationId = warehouse?.id ?? locations?.[0]?.id ?? "";

  const canReceive = po.status !== "cancelled";
  const isTerminal = po.status === "cancelled" || po.status === "received";

  return (
    <div className="space-y-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            {po.reference ?? `PO ${po.id.slice(0, 8)}`}
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            {supplier?.name ?? "No supplier"}
            {po.order_date ? ` · ordered ${po.order_date}` : ""}
            {po.received_date ? ` · received ${po.received_date}` : ""}
          </p>
          {po.notes && <p className="mt-1 text-sm text-ink/50">{po.notes}</p>}
        </div>
        <Badge status={po.status} />
      </div>

      {/* Status + billing actions */}
      <div className="flex flex-wrap items-center gap-3">
        {po.status === "draft" && (
          <form action={setPurchaseOrderStatus.bind(null, po.id, "ordered")}>
            <Button type="submit" variant="secondary">Mark as ordered</Button>
          </form>
        )}
        {!isTerminal && (
          <form action={setPurchaseOrderStatus.bind(null, po.id, "cancelled")}>
            <Button type="submit" variant="secondary">Cancel PO</Button>
          </form>
        )}
        {po.total_bill != null &&
          (expense ? (
            <span className="label-caps text-ink/50">
              Expense recorded · {expense.currency ?? "EUR"} {expense.amount}
            </span>
          ) : (
            <form action={recordPurchaseOrderExpense.bind(null, po.id)}>
              <Button type="submit" variant="secondary">
                Record €{po.total_bill} as expense
              </Button>
            </form>
          ))}
      </div>

      {/* Lines */}
      <div className="space-y-3">
        <h2 className="label-caps text-ink/60">Lines</h2>
        {!lines?.length ? (
          <p className="text-sm text-ink/50">No lines yet — add one below.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th className="text-right">Ordered</Th>
                <Th className="text-right">Received</Th>
                <Th className="text-right">Unit cost</Th>
                <Th>Receive</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const v = variantById.get(line.variant_id);
                const remaining = line.quantity_ordered - line.quantity_received;
                return (
                  <tr key={line.id}>
                    <Td>{v ? variantLabel(v) : line.variant_id.slice(0, 8)}</Td>
                    <Td className="text-right font-mono tabular-nums">{line.quantity_ordered}</Td>
                    <Td className="text-right font-mono tabular-nums">{line.quantity_received}</Td>
                    <Td className="text-right font-mono tabular-nums">
                      {line.unit_cost != null ? `€${line.unit_cost}` : "—"}
                    </Td>
                    <Td>
                      {remaining <= 0 ? (
                        <span className="label-caps text-ink/40">Complete</span>
                      ) : canReceive && defaultLocationId ? (
                        <ReceiveLineForm
                          poId={po.id}
                          lineId={line.id}
                          remaining={remaining}
                          locations={locations ?? []}
                          defaultLocationId={defaultLocationId}
                        />
                      ) : (
                        <span className="label-caps text-ink/40">{remaining} pending</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>

      {/* Quick size run — the headline inbound flow */}
      {!isTerminal && (
        <div className="max-w-3xl space-y-3">
          <h2 className="label-caps text-ink/60">Add size run</h2>
          <p className="text-sm text-ink/50">
            Enter a product and quantities per size — creates a variant (with an
            auto SKU) and a line for each size at once.
          </p>
          <form action={addPoSizeRun.bind(null, po.id)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="product_id">Existing product</Label>
                <Select id="product_id" name="product_id" defaultValue="">
                  <option value="">— New product →</option>
                  {(allProducts ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="new_product_name">…or new product name</Label>
                <Input id="new_product_name" name="new_product_name" placeholder="Superior Entity tee" />
              </div>
            </div>
            <div className="grid grid-cols-7 gap-2">
              {SIZE_RUN.map((s) => (
                <div key={s} className="space-y-1">
                  <Label htmlFor={`qty_${s}`}>{s}</Label>
                  <Input id={`qty_${s}`} name={`qty_${s}`} type="number" min={0} defaultValue={0} />
                </div>
              ))}
              <div className="space-y-1">
                <Label htmlFor="run_unit_cost">Unit €</Label>
                <Input id="run_unit_cost" name="unit_cost" type="number" step="0.01" />
              </div>
            </div>
            <Button type="submit">Add size run</Button>
          </form>
        </div>
      )}

      {/* Add a single existing variant as a line */}
      {!isTerminal && (
        <div className="max-w-xl space-y-3">
          <h2 className="label-caps text-ink/60">Add line</h2>
          {!allVariants?.length ? (
            <p className="text-sm text-ink/50">
              No variants exist yet — create a product and variant first.
            </p>
          ) : (
            <form action={addPurchaseOrderLine.bind(null, po.id)} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="variant_id">Variant</Label>
                <Select id="variant_id" name="variant_id" required defaultValue="">
                  <option value="" disabled>
                    Pick a variant…
                  </option>
                  {(allVariants ?? []).map((v) => {
                    const full = variantById.get(v.id)!;
                    return (
                      <option key={v.id} value={v.id}>
                        {variantLabel(full)}
                      </option>
                    );
                  })}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="quantity_ordered">Quantity ordered</Label>
                  <Input
                    id="quantity_ordered"
                    name="quantity_ordered"
                    type="number"
                    min={1}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="unit_cost">Unit cost</Label>
                  <Input id="unit_cost" name="unit_cost" type="number" step="0.01" />
                </div>
              </div>
              <Button type="submit">Add line</Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
