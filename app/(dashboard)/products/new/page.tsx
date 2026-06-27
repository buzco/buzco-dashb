import { createProduct } from "@/lib/actions/products";
import { Label, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function NewProductPage() {
  return (
    <div className="max-w-md space-y-8">
      <h1 className="label-caps text-ink/60">New product</h1>

      <form action={createProduct} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required />
        </div>

        <div className="space-y-1">
          <Label htmlFor="description">Description</Label>
          <Input id="description" name="description" />
        </div>

        <div className="space-y-1">
          <Label htmlFor="tags">Tags (comma separated)</Label>
          <Input id="tags" name="tags" placeholder="nature, science, spirituality" />
        </div>

        <Button type="submit">Create product</Button>
      </form>
    </div>
  );
}
