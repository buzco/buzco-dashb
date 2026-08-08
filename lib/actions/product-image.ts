"use server";

import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "product-images";
const MAX_DIM = 1600; // px on the long edge — plenty for storefront, keeps files small
const WEBP_QUALITY = 82;

// Uploads arrive already downscaled by lib/image-prepare.ts, so anything
// near this ceiling means the browser-side step was skipped or failed.
// Kept under Vercel's ~4.5 MB request body cap on purpose.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || ""
  );
}

export type ProductImage = {
  /** object path inside the bucket, always `<productId>/<file>.webp` */
  path: string;
  url: string;
  name: string;
  bytes: number;
};

export type UploadImageResult =
  | { ok: true; image: ProductImage }
  | { ok: false; error: string };

function publicUrl(admin: ReturnType<typeof createAdminClient>, path: string): string {
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Compress one uploaded image to WebP, cap its dimensions, give it an
// SEO-friendly filename, store it in Supabase Storage, and point the product
// (or a specific variant) at the public URL when it has no picture yet.
// Alt text is the product name, applied wherever the image renders.
//
// Called directly from the client one file at a time rather than through a
// form action, so a multi-file selection can report progress per picture.
export async function uploadProductImage(
  productId: string,
  variantId: string | null,
  formData: FormData,
): Promise<UploadImageResult> {
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image file" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Image is too large to send — try a smaller original" };
  }

  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select("name, image_url")
    .eq("id", productId)
    .maybeSingle();
  if (!product) {
    return { ok: false, error: "Product not found" };
  }

  let webp: Buffer;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    webp = await sharp(input)
      .rotate() // honour EXIF orientation
      .resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    return { ok: false, error: "Could not process that image — is it a valid image file?" };
  }

  // SEO filename: <base>[-variant]-<n>-<stamp>.webp, where the base defaults
  // to the product name. The stamp keeps re-uploads from colliding and busts
  // the CDN cache; the descriptive part still leads.
  const base = slugify(String(formData.get("base") ?? "")) || slugify(product.name) || "product";
  const seq = Number(formData.get("seq"));
  const position = Number.isFinite(seq) && seq > 0 ? `-${Math.floor(seq)}` : "";
  const stamp = Date.now().toString(36).slice(-5);
  const variantPart = variantId ? `-${variantId.slice(0, 8)}` : "";
  const fileName = `${base}${variantPart}${position}-${stamp}.webp`;
  const objectPath = `${productId}/${fileName}`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage.from(BUCKET).upload(objectPath, webp, {
    contentType: "image/webp",
    upsert: true,
  });
  if (upErr) {
    return { ok: false, error: `Upload failed: ${upErr.message}` };
  }

  const url = publicUrl(admin, objectPath);

  // A variant upload always claims its own slot; a product upload only takes
  // the main picture when there isn't one, so uploading a batch doesn't keep
  // reassigning it. Choosing a different main is an explicit action.
  if (variantId) {
    const { error } = await supabase.from("variants").update({ image_url: url }).eq("id", variantId);
    if (error) {
      return { ok: false, error: error.message };
    }
  } else if (!product.image_url) {
    const { error } = await supabase.from("products").update({ image_url: url }).eq("id", productId);
    if (error) {
      return { ok: false, error: error.message };
    }
  }

  revalidateProduct(productId);
  return { ok: true, image: { path: objectPath, url, name: fileName, bytes: webp.byteLength } };
}

// Every picture stored for a product. The bucket folder is the source of
// truth — there's no gallery table, and one folder per product means listing
// is enough. Ordered oldest first so the grid stays stable across uploads.
export async function listProductImages(productId: string): Promise<ProductImage[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).list(productId, {
    limit: 100,
    sortBy: { column: "created_at", order: "asc" },
  });
  if (error || !data) {
    return [];
  }
  return data
    .filter((o) => o.name && !o.name.startsWith(".")) // skip .emptyFolderPlaceholder
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

export async function setPrimaryImage(productId: string, url: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("products").update({ image_url: url }).eq("id", productId);
  if (error) {
    throw new Error(error.message);
  }
  revalidateProduct(productId);
}

export async function deleteProductImage(productId: string, path: string): Promise<void> {
  // The path comes from the client, so pin it to this product's folder
  // rather than trusting it to address the bucket.
  if (!path.startsWith(`${productId}/`) || path.includes("..")) {
    throw new Error("That image doesn't belong to this product");
  }

  const admin = createAdminClient();
  const url = publicUrl(admin, path);
  const { error } = await admin.storage.from(BUCKET).remove([path]);
  if (error) {
    throw new Error(error.message);
  }

  // Don't leave the product pointing at a deleted object — fall back to
  // whatever picture is left, or to nothing.
  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select("image_url")
    .eq("id", productId)
    .maybeSingle();
  if (product?.image_url === url) {
    const remaining = await listProductImages(productId);
    await supabase
      .from("products")
      .update({ image_url: remaining[0]?.url ?? null })
      .eq("id", productId);
  }

  revalidateProduct(productId);
}

function revalidateProduct(productId: string): void {
  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  revalidatePath(`/products/${productId}/edit`);
}
