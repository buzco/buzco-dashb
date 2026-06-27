"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database.types";

type SaleChannel = Database["public"]["Enums"]["sale_channel"];

export type LogSaleState = { error?: string; ok?: boolean };

export async function logSale(
  _prevState: LogSaleState | undefined,
  formData: FormData,
): Promise<LogSaleState> {
  const channel = (formData.get("channel") as SaleChannel) || "market";
  const variant_id = (formData.get("variant_id") as string) || "";
  const location_id = (formData.get("location_id") as string) || "";
  const quantity = Number(formData.get("quantity"));
  const gross = Number(formData.get("gross_amount"));
  const discount = Number(formData.get("discount_amount") || 0);
  const shipping = Number(formData.get("shipping_amount") || 0);
  const fees = Number(formData.get("fees_amount") || 0);
  const customer_ref = ((formData.get("customer_ref") as string) || "").trim() || null;
  const notes = ((formData.get("notes") as string) || "").trim() || null;

  if (!variant_id) return { error: "Pick a variant" };
  if (!location_id) return { error: "Pick the location stock leaves from" };
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { error: "Quantity must be a positive whole number" };
  }
  if (!Number.isFinite(gross) || gross < 0) {
    return { error: "Gross amount must be zero or more" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("log_sale", {
    p_channel: channel,
    p_variant_id: variant_id,
    p_quantity: quantity,
    p_location_id: location_id,
    p_gross_amount: gross,
    p_discount_amount: discount,
    p_shipping_amount: shipping,
    p_fees_amount: fees,
    p_customer_ref: customer_ref,
    p_notes: notes,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/sales");
  revalidatePath("/inventory");
  revalidatePath("/");
  return { ok: true };
}
