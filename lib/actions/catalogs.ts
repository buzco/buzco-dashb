"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createCatalog(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const notes = ((formData.get("notes") as string) || "").trim() || null;
  if (!name) throw new Error("Catalog name is required");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalogs")
    .insert({ name, notes })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/catalogs");
  redirect(`/catalogs/${data.id}`);
}

export async function deleteCatalog(catalogId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("catalogs").delete().eq("id", catalogId);
  if (error) throw new Error(error.message);
  revalidatePath("/catalogs");
  redirect("/catalogs");
}

export async function addCatalogItem(catalogId: string, formData: FormData) {
  const variant_id = (formData.get("variant_id") as string) || "";
  const priceRaw = (formData.get("wholesale_price") as string) || "";
  const wholesale_price = priceRaw ? Number(priceRaw) : null;
  if (!variant_id) throw new Error("Pick a variant");

  const supabase = await createClient();
  const { error } = await supabase
    .from("catalog_items")
    .insert({ catalog_id: catalogId, variant_id, wholesale_price });
  if (error) {
    // Unique (catalog_id, variant_id) — already added.
    if (error.code === "23505") throw new Error("That variant is already in this catalog");
    throw new Error(error.message);
  }
  revalidatePath(`/catalogs/${catalogId}`);
}

export async function updateCatalogItemPrice(catalogId: string, itemId: string, formData: FormData) {
  const priceRaw = (formData.get("wholesale_price") as string) || "";
  const wholesale_price = priceRaw ? Number(priceRaw) : null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("catalog_items")
    .update({ wholesale_price })
    .eq("id", itemId);
  if (error) throw new Error(error.message);
  revalidatePath(`/catalogs/${catalogId}`);
}

export async function removeCatalogItem(catalogId: string, itemId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("catalog_items").delete().eq("id", itemId);
  if (error) throw new Error(error.message);
  revalidatePath(`/catalogs/${catalogId}`);
}

// Auto-fill wholesale prices for every item from a percentage of each variant's
// retail price (the classic wholesale rule, default 50%).
export async function autoPriceCatalog(catalogId: string, formData: FormData) {
  const pctRaw = (formData.get("percent") as string) || "50";
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct) || pct <= 0) throw new Error("Enter a valid percentage");

  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from("catalog_items")
    .select("id, variant_id")
    .eq("catalog_id", catalogId);
  if (error) throw new Error(error.message);

  const variantIds = (items ?? []).map((i) => i.variant_id);
  const { data: variants } = variantIds.length
    ? await supabase.from("variants").select("id, retail_price").in("id", variantIds)
    : { data: [] };
  const retailById = new Map((variants ?? []).map((v) => [v.id, Number(v.retail_price ?? 0)]));

  for (const item of items ?? []) {
    const retail = retailById.get(item.variant_id) ?? 0;
    const price = Math.round(retail * (pct / 100) * 100) / 100;
    await supabase.from("catalog_items").update({ wholesale_price: price }).eq("id", item.id);
  }
  revalidatePath(`/catalogs/${catalogId}`);
}
