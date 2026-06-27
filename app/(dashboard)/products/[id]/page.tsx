import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createVariant } from "@/lib/actions/products";
import { Badge } from "@/components/ui/badge";
import { Table, Th, Td } from "@/components/ui/table";
import { Label, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ShopifyMark } from "@/components/ui/shopify-mark";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: product }, { data: variants }] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).maybeSingle(),
    supabase.from("variants").select("*").eq("product_id", id).order("size"),
  ]);

  if (!product) {
    notFound();
  }

  return (
    <div className="space-y-10">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink">
            {product.name}
            {product.shopify_product_id && <ShopifyMark />}
          </h1>
          {product.description && (
            <p className="mt-1 text-sm text-ink/60">{product.description}</p>
          )}
        </div>
        <Badge status={product.status} />
      </div>

      <div className="space-y-3">
        <h2 className="label-caps text-ink/60">Variants</h2>
        {!variants?.length ? (
          <p className="text-sm text-ink/50">No variants yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>Size</Th>
                <Th>Color</Th>
                <Th className="text-right">Retail price</Th>
                <Th className="text-right">Production cost</Th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => (
                <tr key={variant.id}>
                  <Td className="font-mono">
                    <span className="inline-flex items-center gap-1.5">
                      {variant.sku}
                      {variant.shopify_variant_id && <ShopifyMark />}
                    </span>
                  </Td>
                  <Td>{variant.size ?? "—"}</Td>
                  <Td>{variant.color ?? "—"}</Td>
                  <Td className="text-right font-mono tabular-nums">
                    {variant.retail_price != null ? `€${variant.retail_price}` : "—"}
                  </Td>
                  <Td className="text-right font-mono tabular-nums">
                    {variant.production_cost != null ? `€${variant.production_cost}` : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <div className="max-w-md space-y-3">
        <h2 className="label-caps text-ink/60">Add variant</h2>
        <form action={createVariant.bind(null, product.id)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="sku">SKU</Label>
              <Input id="sku" name="sku" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="retail_price">Retail price</Label>
              <Input id="retail_price" name="retail_price" type="number" step="0.01" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="size">Size</Label>
              <Input id="size" name="size" placeholder="XS / S / M / L / XL" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="color">Color</Label>
              <Input id="color" name="color" />
            </div>
          </div>
          <Button type="submit">Add variant</Button>
        </form>
      </div>
    </div>
  );
}
