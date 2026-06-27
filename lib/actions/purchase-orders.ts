"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database.types";

type PoStatus = Database["public"]["Enums"]["po_status"];

export async function createPurchaseOrder(formData: FormData) {
  const supplier_id = ((formData.get("supplier_id") as string) || "") || null;
  const reference = ((formData.get("reference") as string) || "").trim() || null;
  const currency = ((formData.get("currency") as string) || "EUR").trim() || "EUR";
  const order_date = ((formData.get("order_date") as string) || "") || null;
  const totalBillRaw = (formData.get("total_bill") as string) || "";
  const total_bill = totalBillRaw ? Number(totalBillRaw) : null;
  const notes = ((formData.get("notes") as string) || "").trim() || null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .insert({ supplier_id, reference, currency, order_date, total_bill, notes })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/purchase-orders");
  redirect(`/purchase-orders/${data.id}`);
}

export async function addPurchaseOrderLine(poId: string, formData: FormData) {
  const variant_id = (formData.get("variant_id") as string) || "";
  const quantity_ordered = Number(formData.get("quantity_ordered"));
  const unitCostRaw = (formData.get("unit_cost") as string) || "";
  const unit_cost = unitCostRaw ? Number(unitCostRaw) : null;

  if (!variant_id) {
    throw new Error("Pick a variant");
  }
  if (!Number.isInteger(quantity_ordered) || quantity_ordered <= 0) {
    throw new Error("Quantity ordered must be a positive whole number");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_order_lines")
    .insert({ purchase_order_id: poId, variant_id, quantity_ordered, unit_cost });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/purchase-orders/${poId}`);
}

export type ReceiveState = { error?: string; ok?: boolean };

export async function receivePurchaseOrderLine(
  poId: string,
  lineId: string,
  _prevState: ReceiveState | undefined,
  formData: FormData,
): Promise<ReceiveState> {
  const quantity = Number(formData.get("quantity"));
  const location_id = (formData.get("location_id") as string) || "";

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { error: "Quantity must be a positive whole number" };
  }
  if (!location_id) {
    return { error: "Pick a location to receive into" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_po_line", {
    p_line_id: lineId,
    p_quantity: quantity,
    p_location_id: location_id,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/inventory");
  revalidatePath("/");
  return { ok: true };
}

export async function setPurchaseOrderStatus(poId: string, status: PoStatus) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ status })
    .eq("id", poId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/purchase-orders");
}

// Records the PO's total_bill as an expense (source = purchase_order),
// guarding against double-recording. Billing is a deliberate manual step,
// separate from receiving stock.
export async function recordPurchaseOrderExpense(poId: string) {
  const supabase = await createClient();

  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .select("id, total_bill, currency, reference")
    .eq("id", poId)
    .maybeSingle();

  if (poErr) {
    throw new Error(poErr.message);
  }
  if (!po) {
    throw new Error("Purchase order not found");
  }
  if (po.total_bill == null) {
    throw new Error("Set a total bill on the purchase order first");
  }

  const { data: existing } = await supabase
    .from("expenses")
    .select("id")
    .eq("source", "purchase_order")
    .eq("source_id", poId)
    .maybeSingle();

  if (existing) {
    throw new Error("An expense for this purchase order is already recorded");
  }

  const { error } = await supabase.from("expenses").insert({
    category: "production",
    description: `Purchase order${po.reference ? ` ${po.reference}` : ""}`,
    amount: po.total_bill,
    currency: po.currency ?? "EUR",
    source: "purchase_order",
    source_id: poId,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/purchase-orders/${poId}`);
}
