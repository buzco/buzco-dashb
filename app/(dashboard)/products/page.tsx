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

  // The location mirroring Shopify is the one worth editing: it is where the
  // stock actually is, and correcting it writes through to Shopify. Everything
  // else (a market crate, a retailer) is shown for context only, because those
  // move by transfer rather than by typing a new number.
  const stockCentre = (locations ?? []).find((l) => l.type === "shopify") ?? null;

  const centreQtyByVariant = new Map<string, number>();
  const otherStockByVariant = new Map<string, { name: string; qty: number }[]>();
  for (const s of stock ?? []) {
    if (stockCentre && s.location_id === stockCentre.id) {
      centreQtyByVariant.set(s.variant_id, s.quantity);
      continue;
    }
    if (!s.quantity) continue;
    const arr = otherStockByVariant.get(s.variant_id) ?? [];
    arr.push({ name: locationName.get(s.location_id) ?? "—", qty: s.quantity });
    otherStockByVariant.set(s.variant_id, arr);
  }

  const variantsByProduct = new Map<string, typeof variants>();
  for (const v of variants ?? []) {
    const arr = variantsByProduct.get(v.product_id) ?? [];
    arr.push(v);
    variantsByProduct.set(v.product_id, arr);
  }

  const catalog: CatalogProduct[] = (products ?? []).map((p) => {
    const pv = variantsByProduct.get(p.id) ?? [];
    // Every variant gets a row, including the ones sitting at zero — those are
    // exactly the ones someone opens this popup to put a number back into.
    const stockRows = pv.map((v) => {
      const others = otherStockByVariant.get(v.id) ?? [];
      const centreQty = centreQtyByVariant.get(v.id) ?? 0;
      return {
        variantId: v.id,
        label: variantLabel(v),
        centreQty,
        others,
        total: centreQty + others.reduce((s, l) => s + l.qty, 0),
      };
    });
    // One colour across every variant, not already in the name, is the only
    // thing telling the three Butterfly products apart.
    const colours = [...new Set(pv.map((v) => v.color).filter(Boolean))] as string[];
    const colourway =
      colours.length === 1 && !p.name.toLowerCase().includes(colours[0].toLowerCase())
        ? colours[0]
        : null;

    return {
      id: p.id,
      name: p.name,
      colourway,
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
        {/* "Catalog" collided with the wholesale catalogs (now Line sheets). */}
        <h1 className="label-caps text-ink/60">Products</h1>
        <Link href="/products/new">
          <Button>New product</Button>
        </Link>
      </div>

      {!catalog.length ? (
        <p className="text-sm text-ink/50">No products yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {catalog.map((product) => (
            <CatalogCard
              key={product.id}
              product={product}
              stockLocationId={stockCentre?.id ?? null}
              stockLocationName={stockCentre?.name ?? "stock"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
