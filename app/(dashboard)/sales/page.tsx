import { createClient } from "@/lib/supabase/server";
import { Table, Th, Td } from "@/components/ui/table";
import { LogSaleForm } from "./log-sale-form";

function variantLabel(v: {
  sku: string;
  size: string | null;
  color: string | null;
  productName?: string;
}) {
  const attrs = [v.size, v.color].filter(Boolean).join(" / ");
  return `${v.productName ?? "?"} — ${v.sku}${attrs ? ` (${attrs})` : ""}`;
}

export default async function SalesPage() {
  const supabase = await createClient();

  const [{ data: variants }, { data: locations }, { data: sales }] = await Promise.all([
    supabase.from("variants").select("id, sku, size, color, product_id").order("sku"),
    supabase.from("inventory_locations").select("id, name, type").order("name"),
    supabase
      .from("sales")
      .select("id, channel, variant_id, quantity, gross_amount, net_amount, customer_ref, sold_at")
      .order("sold_at", { ascending: false })
      .limit(50),
  ]);

  const productIds = [...new Set((variants ?? []).map((v) => v.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name").in("id", productIds)
    : { data: [] };
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));

  const variantById = new Map(
    (variants ?? []).map((v) => [v.id, { ...v, productName: productNameById.get(v.product_id) }]),
  );
  const variantOptions = (variants ?? []).map((v) => ({
    id: v.id,
    label: variantLabel({ ...v, productName: productNameById.get(v.product_id) }),
  }));

  const warehouse = (locations ?? []).find((l) => l.type === "warehouse");
  const defaultLocationId = warehouse?.id ?? locations?.[0]?.id ?? "";

  return (
    <div className="space-y-10">
      <h1 className="label-caps text-ink/60">Sales</h1>

      {!variants?.length ? (
        <p className="text-sm text-ink/50">Create a product and variant first.</p>
      ) : (
        <LogSaleForm
          variants={variantOptions}
          locations={(locations ?? []).map((l) => ({ id: l.id, name: `${l.name} (${l.type})` }))}
          defaultLocationId={defaultLocationId}
        />
      )}

      <div className="space-y-3">
        <h2 className="label-caps text-ink/60">Recent sales</h2>
        {!sales?.length ? (
          <p className="text-sm text-ink/50">No sales logged yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Channel</Th>
                <Th>Item</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Gross</Th>
                <Th className="text-right">Net</Th>
                <Th>Customer</Th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const v = variantById.get(s.variant_id);
                return (
                  <tr key={s.id}>
                    <Td className="text-ink/70">{new Date(s.sold_at).toLocaleDateString()}</Td>
                    <Td className="label-caps">{s.channel.replace(/_/g, " ")}</Td>
                    <Td className="text-bone">{v ? variantLabel(v) : s.variant_id.slice(0, 8)}</Td>
                    <Td className="text-right font-mono tabular-nums">{s.quantity}</Td>
                    <Td className="text-right font-mono tabular-nums">€{s.gross_amount}</Td>
                    <Td className="text-right font-mono tabular-nums text-bone">€{s.net_amount}</Td>
                    <Td className="text-ink/70">{s.customer_ref ?? "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}
