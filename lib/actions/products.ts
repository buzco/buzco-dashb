"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createProduct(formData: FormData) {
  const name = formData.get("name") as string;
  const description = (formData.get("description") as string) || null;
  const tagsRaw = (formData.get("tags") as string) || "";
  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({ name, description, tags: tags.length ? tags : null })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/products");
  redirect(`/products/${data.id}`);
}

export async function createVariant(productId: string, formData: FormData) {
  const sku = formData.get("sku") as string;
  const size = (formData.get("size") as string) || null;
  const color = (formData.get("color") as string) || null;
  const retailPriceRaw = formData.get("retail_price") as string;
  const retail_price = retailPriceRaw ? Number(retailPriceRaw) : null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("variants")
    .insert({ product_id: productId, sku, size, color, retail_price });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/products/${productId}`);
}
