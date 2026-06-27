"use server";

import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "product-images";
const MAX_DIM = 1600; // px on the long edge — plenty for storefront, keeps files small

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "product"
  );
}

export type UploadImageState = { error?: string; ok?: boolean; url?: string };

// Compress any uploaded image to WebP, cap its dimensions, give it an
// SEO-friendly filename, store it in Supabase Storage, and point the product
// (or a specific variant) at the public URL. Alt text is the product name,
// applied wherever the image renders.
export async function uploadProductImage(
  productId: string,
  variantId: string | null,
  _prevState: UploadImageState | undefined,
  formData: FormData,
): Promise<UploadImageState> {
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image file" };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { error: "Image must be under 10 MB" };
  }

  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select("name")
    .eq("id", productId)
    .maybeSingle();
  if (!product) {
    return { error: "Product not found" };
  }

  let webp: Buffer;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    webp = await sharp(input)
      .rotate() // honour EXIF orientation
      .resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return { error: "Could not process that image — is it a valid image file?" };
  }

  // SEO filename: product-slug[-variant]-timestamp.webp
  const slug = slugify(product.name);
  const stamp = Date.now().toString(36);
  const objectPath = `${productId}/${slug}${variantId ? "-" + variantId.slice(0, 8) : ""}-${stamp}.webp`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage.from(BUCKET).upload(objectPath, webp, {
    contentType: "image/webp",
    upsert: true,
  });
  if (upErr) {
    return { error: `Upload failed: ${upErr.message}` };
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(objectPath);
  const url = pub.publicUrl;

  const target = variantId
    ? supabase.from("variants").update({ image_url: url }).eq("id", variantId)
    : supabase.from("products").update({ image_url: url }).eq("id", productId);
  const { error: updErr } = await target;
  if (updErr) {
    return { error: updErr.message };
  }

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  revalidatePath(`/products/${productId}/edit`);
  return { ok: true, url };
}
