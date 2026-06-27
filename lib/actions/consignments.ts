"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createConsignment(formData: FormData) {
  const retailer_id = (formData.get("retailer_id") as string) || "";
  const sent_date = ((formData.get("sent_date") as string) || "") || null;
  const notes = ((formData.get("notes") as string) || "").trim() || null;

  if (!retailer_id) {
    throw new Error("Pick a retailer");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consignments")
    .insert({ retailer_id, sent_date, notes })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/consignments");
  redirect(`/consignments/${data.id}`);
}

export type ConsignmentLineState = { error?: string; ok?: boolean };

// Send stock out to the retailer (creates a line + two-sided movement).
export async function consignmentSend(
  consignmentId: string,
  _prevState: ConsignmentLineState | undefined,
  formData: FormData,
): Promise<ConsignmentLineState> {
  const variant_id = (formData.get("variant_id") as string) || "";
  const quantity = Number(formData.get("quantity"));
  const wholesale_price = Number(formData.get("wholesale_price"));
  const from_location_id = (formData.get("from_location_id") as string) || "";

  if (!variant_id) return { error: "Pick a variant" };
  if (!from_location_id) return { error: "Pick the location stock leaves from" };
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { error: "Quantity must be a positive whole number" };
  }
  if (!Number.isFinite(wholesale_price) || wholesale_price < 0) {
    return { error: "Wholesale price must be zero or more" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("consignment_send", {
    p_consignment_id: consignmentId,
    p_variant_id: variant_id,
    p_quantity: quantity,
    p_wholesale_price: wholesale_price,
    p_from_location_id: from_location_id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/consignments/${consignmentId}`);
  revalidatePath("/inventory");
  return { ok: true };
}

export async function consignmentMarkSold(
  consignmentId: string,
  lineId: string,
  _prevState: ConsignmentLineState | undefined,
  formData: FormData,
): Promise<ConsignmentLineState> {
  const quantity = Number(formData.get("quantity"));
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { error: "Quantity must be a positive whole number" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("consignment_mark_sold", {
    p_line_id: lineId,
    p_quantity: quantity,
  });

  if (error) return { error: error.message };

  revalidatePath(`/consignments/${consignmentId}`);
  revalidatePath("/sales");
  revalidatePath("/inventory");
  return { ok: true };
}

export async function consignmentReturn(
  consignmentId: string,
  lineId: string,
  toLocationId: string,
  _prevState: ConsignmentLineState | undefined,
  formData: FormData,
): Promise<ConsignmentLineState> {
  const quantity = Number(formData.get("quantity"));
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { error: "Quantity must be a positive whole number" };
  }
  if (!toLocationId) return { error: "No location to return into" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("consignment_return", {
    p_line_id: lineId,
    p_quantity: quantity,
    p_to_location_id: toLocationId,
  });

  if (error) return { error: error.message };

  revalidatePath(`/consignments/${consignmentId}`);
  revalidatePath("/inventory");
  return { ok: true };
}

export async function setConsignmentStatus(consignmentId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("consignments")
    .update({ status })
    .eq("id", consignmentId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/consignments/${consignmentId}`);
  revalidatePath("/consignments");
}
