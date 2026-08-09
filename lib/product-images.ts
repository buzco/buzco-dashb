import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Shared definition of "the pictures belonging to a product".
//
// There's no gallery table: the bucket folder `product-images/<productId>/` is
// the source of truth, and `products.image_url` just points at whichever one is
// main. Both the editor's uploader and the Shopify push read through here so
// they can't disagree about what a product's images are.

export const BUCKET = "product-images";

export type ProductImage = {
  /** object path inside the bucket, always `<productId>/<file>.webp` */
  path: string;
  url: string;
  name: string;
  bytes: number;
};

type Admin = ReturnType<typeof createAdminClient>;

export function publicUrl(admin: Admin, path: string): string {
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** True for URLs served out of our own Supabase Storage bucket. */
export function isOurStorageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith(".supabase.co") && url.includes(`/${BUCKET}/`);
  } catch {
    return false;
  }
}

/** The filename Shopify will show for a media item, for comparing both sides. */
export function baseName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || null;
  } catch {
    return null;
  }
}

/**
 * Product-level pictures, oldest first.
 *
 * Variant images live in the same folder and are filtered out: they belong to a
 * variant, and surfacing them here would offer a Delete that orphans the
 * variant's image_url.
 *
 * They're identified purely by the variant id stamped into the filename at
 * upload, which is the only way one reaches this bucket. Comparing against each
 * variant's image_url instead would be wrong: the Shopify sync gives every
 * variant lacking its own picture the product's featured image, so a plain
 * filename match would hide the product's own main shot from its gallery.
 */
export async function listProductImageObjects(productId: string): Promise<ProductImage[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).list(productId, {
    limit: 100,
    sortBy: { column: "created_at", order: "asc" },
  });
  if (error || !data) {
    return [];
  }

  const supabase = await createClient();
  const { data: variants } = await supabase
    .from("variants")
    .select("id")
    .eq("product_id", productId);

  const variantIdPrefixes = [...new Set((variants ?? []).map((v) => v.id.slice(0, 8)))];
  const belongsToVariant = (name: string) =>
    variantIdPrefixes.some((prefix) => name.includes(`-${prefix}-`));

  return data
    .filter((o) => o.name && !o.name.startsWith(".")) // skip .emptyFolderPlaceholder
    .filter((o) => !belongsToVariant(o.name))
    .map((o) => {
      const path = `${productId}/${o.name}`;
      return {
        path,
        url: publicUrl(admin, path),
        name: o.name,
        bytes: (o.metadata?.size as number | undefined) ?? 0,
      };
    });
}
