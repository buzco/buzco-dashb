import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateProduct } from "@/lib/actions/products";
import { Label, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ImageUploader } from "./image-uploader";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select("id, name, description, status, tags, image_url")
    .eq("id", id)
    .maybeSingle();

  if (!product) {
    notFound();
  }

  return (
    <div className="max-w-3xl space-y-10">
      <div className="flex items-center justify-between">
        <h1 className="label-caps text-ink/60">Edit product</h1>
        <Link href={`/products/${product.id}`} className="label-caps text-ink/60 hover:text-ink">
          ← Back
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        {/* Details */}
        <form action={updateProduct.bind(null, product.id)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={product.name} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <Input id="description" name="description" defaultValue={product.description ?? ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={product.status}>
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tags">Tags (comma separated)</Label>
            <Input id="tags" name="tags" defaultValue={(product.tags ?? []).join(", ")} />
          </div>
          <Button type="submit">Save changes</Button>
        </form>

        {/* Image */}
        <div className="space-y-3">
          <h2 className="label-caps text-ink/60">Picture</h2>
          <ImageUploader productId={product.id} currentUrl={product.image_url} />
        </div>
      </div>
    </div>
  );
}
