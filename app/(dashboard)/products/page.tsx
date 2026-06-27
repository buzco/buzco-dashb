import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { CatalogCard, type CatalogProduct } from "./catalog-card";

function variantLabel(v: { sku: string; size: string | null; color: string | null }) {
  const attrs = [v.size, v.color].filter(Boolean).join(" / ");
  return `${v.sku}${attrs ? ` (${attrs})` : ""}`;
}

export default async function ProductsPage() {
  const supabase = await createClient();

  const [{ data: products }, { data: variants }, { data: stock }, { data: locations }] =
    await Promise.all([
      supabase.from("products").select("id, name, status, image_url").order("created_at", { ascending: false }),
      supabase.from("variants").select("id, product_id, sku, size, color"),
      supabase.from("current_stock").select("variant_id, location_id, quantity"),
      supabase.from("inventory_locations").select("id, name, type"),
    ]);

  const locationName = new Map((locations ?? []).map((l) => [l.id, `${l.name}`]));

  // stock per variant -> [{location, qty}]
  const stockByVariant = new Map<string, { name: string; qty: number }[]>();
  for (const s of stock ?? []) {
    if (!s.quantity) continue;
    const arr = stockByVariant.get(s.variant_id) ?? [];
    arr.push({ name: locationName.get(s.location_id) ?? "—", qty: s.quantity });
    stockByVariant.set(s.variant_id, arr);
  }

  const variantsByProduct = new Map<string, typeof variants>();
  for (const v of variants ?? []) {
    const arr = variantsByProduct.get(v.product_id) ?? [];
    arr.push(v);
    variantsByProduct.set(v.product_id, arr);
  }

  const catalog: CatalogProduct[] = (products ?? []).map((p) => {
    const pv = variantsByProduct.get(p.id) ?? [];
    const stockRows = pv.map((v) => {
      const locs = stockByVariant.get(v.id) ?? [];
      return {
        label: variantLabel(v),
        locations: locs,
        total: locs.reduce((s, l) => s + l.qty, 0),
      };
    });
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      imageUrl: p.image_url,
      variantCount: pv.length,
      totalStock: stockRows.reduce((s, r) => s + r.total, 0),
      stockRows,
    };
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="label-caps text-ink/60">Catalog</h1>
        <Link href="/products/new">
          <Button>New product</Button>
        </Link>
      </div>

      {!catalog.length ? (
        <p className="text-sm text-ink/50">No products yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {catalog.map((product) => (
            <CatalogCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
