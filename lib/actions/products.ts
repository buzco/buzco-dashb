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

export async function updateProduct(productId: string, formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const description = ((formData.get("description") as string) || "").trim() || null;
  const status = ((formData.get("status") as string) || "draft").trim();
  const tagsRaw = (formData.get("tags") as string) || "";
  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!name) {
    throw new Error("Name is required");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ name, description, status, tags: tags.length ? tags : null })
    .eq("id", productId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}`);
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
