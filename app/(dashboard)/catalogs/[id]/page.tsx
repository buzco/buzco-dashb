import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  addCatalogItem,
  updateCatalogItemPrice,
  removeCatalogItem,
  autoPriceCatalog,
} from "@/lib/actions/catalogs";
import { Table, Th, Td } from "@/components/ui/table";
import { Label, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EmailDraft } from "./email-draft";

function variantLabel(v: { sku: string; size: string | null; color: string | null; productName?: string }) {
  const attrs = [v.size, v.color].filter(Boolean).join(" / ");
  return `${v.productName ?? "?"} — ${v.sku}${attrs ? ` (${attrs})` : ""}`;
}
const eur = (n: number) => "€" + Number(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function CatalogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: catalog } = await supabase
    .from("catalogs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!catalog) notFound();

  const [{ data: items }, { data: allVariants }, { data: retailers }] = await Promise.all([
    supabase.from("catalog_items").select("id, variant_id, wholesale_price").eq("catalog_id", id),
    supabase.from("variants").select("id, sku, size, color, product_id, retail_price").order("sku"),
    supabase.from("retailers").select("id, name, contact_email").order("name"),
  ]);

  const productIds = [...new Set((allVariants ?? []).map((v) => v.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name").in("id", productIds)
    : { data: [] };
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const variantById = new Map(
    (allVariants ?? []).map((v) => [v.id, { ...v, productName: productNameById.get(v.product_id) }]),
  );

  const itemRows = (items ?? []).map((it) => {
    const v = variantById.get(it.variant_id);
    return {
      id: it.id,
      label: v ? variantLabel(v) : it.variant_id.slice(0, 8),
      retail: v?.retail_price != null ? Number(v.retail_price) : null,
      wholesale: it.wholesale_price != null ? Number(it.wholesale_price) : null,
    };
  });

  const inCatalog = new Set((items ?? []).map((i) => i.variant_id));
  const addableVariants = (allVariants ?? []).filter((v) => !inCatalog.has(v.id));

  return (
    <div className="space-y-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-bone">{catalog.name}</h1>
          {catalog.notes && <p className="mt-1 text-sm text-ink/60">{catalog.notes}</p>}
        </div>
        <Link href="/catalogs" className="label-caps text-ink/60 hover:text-ink">← Catalogs</Link>
      </div>

      {/* Items */}
      <div className="space-y-3">
        <h2 className="label-caps text-ink/60">Items</h2>
        {!itemRows.length ? (
          <p className="text-sm text-ink/50">No products yet — add some below.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th className="text-right">RRP</Th>
                <Th>Wholesale</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {itemRows.map((row) => (
                <tr key={row.id}>
                  <Td className="text-bone">{row.label}</Td>
                  <Td className="text-right font-mono tabular-nums">
                    {row.retail != null ? eur(row.retail) : "—"}
                  </Td>
                  <Td>
                    <form
                      action={updateCatalogItemPrice.bind(null, catalog.id, row.id)}
                      className="flex items-center gap-1.5"
                    >
                      <span className="text-ink/50">€</span>
                      <input
                        name="wholesale_price"
                        type="number"
                        step="0.01"
                        defaultValue={row.wholesale ?? ""}
                        className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-sm text-bone outline-none focus:border-ink"
                      />
                      <button className="label-caps rounded-md border border-line px-2 py-1 text-ink/70 hover:border-ink hover:text-ink">
                        Set
                      </button>
                    </form>
                  </Td>
                  <Td>
                    <form action={removeCatalogItem.bind(null, catalog.id, row.id)}>
                      <button className="label-caps text-status-cancelled hover:underline">Remove</button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {/* Auto price */}
        {itemRows.length > 0 && (
          <form action={autoPriceCatalog.bind(null, catalog.id)} className="flex items-center gap-2 pt-1">
            <span className="text-sm text-ink/60">Auto-price all at</span>
            <input
              name="percent"
              type="number"
              defaultValue={50}
              className="w-16 rounded-md border border-line bg-surface px-2 py-1 text-sm text-bone outline-none focus:border-ink"
            />
            <span className="text-sm text-ink/60">% of RRP</span>
            <Button type="submit" variant="secondary">Apply</Button>
          </form>
        )}
      </div>

      {/* Add item */}
      {addableVariants.length > 0 && (
        <div className="max-w-xl space-y-3">
          <h2 className="label-caps text-ink/60">Add product</h2>
          <form action={addCatalogItem.bind(null, catalog.id)} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="variant_id">Variant</Label>
              <Select id="variant_id" name="variant_id" required defaultValue="">
                <option value="" disabled>Pick a variant…</option>
                {addableVariants.map((v) => {
                  const full = variantById.get(v.id)!;
                  return (
                    <option key={v.id} value={v.id}>
                      {variantLabel(full)}
                    </option>
                  );
                })}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="wholesale_price">Wholesale €</Label>
              <Input id="wholesale_price" name="wholesale_price" type="number" step="0.01" className="w-28" />
            </div>
            <Button type="submit">Add</Button>
          </form>
        </div>
      )}

      {/* Email outreach */}
      <div className="space-y-3">
        <h2 className="label-caps text-ink/60">Email draft</h2>
        <EmailDraft
          catalogName={catalog.name}
          notes={catalog.notes}
          lines={itemRows.map((r) => ({ label: r.label, wholesale: r.wholesale, retail: r.retail }))}
          retailers={(retailers ?? []).map((r) => ({ id: r.id, name: r.name, email: r.contact_email }))}
        />
      </div>
    </div>
  );
}
