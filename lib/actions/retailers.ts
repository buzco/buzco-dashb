"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createRetailer(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const contact_email = ((formData.get("contact_email") as string) || "").trim() || null;
  const kind = ((formData.get("kind") as string) || "").trim() || null;
  const location = ((formData.get("location") as string) || "").trim() || null;
  const status = ((formData.get("status") as string) || "prospect").trim() || "prospect";
  const notes = ((formData.get("notes") as string) || "").trim() || null;

  if (!name) {
    throw new Error("Retailer name is required");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("retailers")
    .insert({ name, contact_email, kind, location, status, notes });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/retailers");
  revalidatePath("/consignments/new");
}
