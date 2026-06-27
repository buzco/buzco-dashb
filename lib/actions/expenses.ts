"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createExpense(formData: FormData) {
  const category = (formData.get("category") as string)?.trim();
  const description = ((formData.get("description") as string) || "").trim() || null;
  const amount = Number(formData.get("amount"));
  const currency = ((formData.get("currency") as string) || "EUR").trim() || "EUR";
  const incurred_at = ((formData.get("incurred_at") as string) || "") || undefined;
  const recurring_interval = ((formData.get("recurring_interval") as string) || "") || null;

  if (!category) throw new Error("Category is required");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero");

  const supabase = await createClient();
  const { error } = await supabase.from("expenses").insert({
    category,
    description,
    amount,
    currency,
    ...(incurred_at ? { incurred_at } : {}),
    recurring_interval,
    source: "manual",
  });

  if (error) throw new Error(error.message);

  revalidatePath("/expenses");
  revalidatePath("/finance");
  revalidatePath("/");
}
