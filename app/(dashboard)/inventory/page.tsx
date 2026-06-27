import { createClient } from "@/lib/supabase/server";
import { Table, Th, Td } from "@/components/ui/table";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location } = await searchParams;
  const supabase = await createClient();

  const { data: locations } = await supabase
    .from("inventory_locations")
    .select("id, name, type")
    .order("name");

  const stockQuery = location
    ? supabase.from("current_stock").select("variant_id, quantity").eq("location_id", location)
    : supabase.from("current_stock_by_variant").select("variant_id, total_quantity");

  const { data: stockRows } = await stockQuery;

  const variantIds = (stockRows ?? []).map((r) => r.variant_id);
  const { data: variants } = variantIds.length
    ? await supabase
        .from("variants")
        .select("id, sku, size, color, product_id")
        .in("id", variantIds)
    : { data: [] };

  const productIds = [...new Set((variants ?? []).map((v) => v.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name").in("id", productIds)
    : { data: [] };

  const variantById = new Map((variants ?? []).map((v) => [v.id, v]));
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  const rows = (stockRows ?? [])
    .map((r) => {
      const variant = variantById.get(r.variant_id);
      const product = variant ? productById.get(variant.product_id) : undefined;
      const quantity = "quantity" in r ? r.quantity : r.total_quantity;
      return { variant, product, quantity };
    })
    .filter((r) => r.variant)
    .sort((a, b) => (a.product?.name ?? "").localeCompare(b.product?.name ?? ""));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="label-caps text-ink/60">Inventory</h1>
        <form method="get" className="flex items-center gap-2">
          <select
            name="location"
            defaultValue={location ?? ""}
            className="border border-line bg-surface px-3 py-2 text-sm text-bone"
          >
            <option value="">All locations</option>
            {(locations ?? []).map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name} ({loc.type})
              </option>
            ))}
          </select>
          <button type="submit" className="label-caps border border-line px-4 py-2 text-ink hover:border-ink">
            Filter
          </button>
        </form>
      </div>

      {!rows.length ? (
        <p className="text-sm text-ink/50">No stock movements recorded yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>SKU</Th>
              <Th>Size</Th>
              <Th>Color</Th>
              <Th className="text-right">Quantity</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <Td>{row.product?.name ?? "—"}</Td>
                <Td className="font-mono">{row.variant?.sku}</Td>
                <Td>{row.variant?.size ?? "—"}</Td>
                <Td>{row.variant?.color ?? "—"}</Td>
                <Td className="text-right font-mono tabular-nums">{row.quantity}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
