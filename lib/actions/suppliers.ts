"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createSupplier(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const contact_email = ((formData.get("contact_email") as string) || "").trim() || null;
  const notes = ((formData.get("notes") as string) || "").trim() || null;

  if (!name) {
    throw new Error("Supplier name is required");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .insert({ name, contact_email, notes });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/suppliers");
  revalidatePath("/purchase-orders/new");
}
