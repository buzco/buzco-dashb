import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShopifyMark } from "@/components/ui/shopify-mark";

export default async function ProductsPage() {
  const supabase = await createClient();

  const [{ data: products }, { data: variants }] = await Promise.all([
    supabase.from("products").select("*").order("created_at", { ascending: false }),
    supabase.from("variants").select("product_id"),
  ]);

  const variantCounts = new Map<string, number>();
  for (const v of variants ?? []) {
    variantCounts.set(v.product_id, (variantCounts.get(v.product_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="label-caps text-ink/60">Products</h1>
        <Link href="/products/new">
          <Button>New product</Button>
        </Link>
      </div>

      {!products?.length ? (
        <p className="text-sm text-ink/50">No products yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product) => (
            <Link key={product.id} href={`/products/${product.id}`}>
              <Card className="h-full p-4 hover:border-ink">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h2 className="flex items-center gap-1.5 font-medium text-ink">
                    {product.name}
                    {product.shopify_product_id && <ShopifyMark />}
                  </h2>
                  <Badge status={product.status} />
                </div>
                <p className="text-xs text-ink/50">
                  {variantCounts.get(product.id) ?? 0} variant
                  {variantCounts.get(product.id) === 1 ? "" : "s"}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
