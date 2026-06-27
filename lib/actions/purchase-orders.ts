"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database.types";
import { SIZE_RUN } from "@/lib/sizes";

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

function skuBase(name: string): string {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(0, 6) || "ITEM";
}

// "Superior Entity tee: 1 XS / 5 S / 6 M / 7 L / 9 XL" in one entry — creates
// the product (if new), a variant per size with a generated unique SKU, and a
// PO line for each. Mirrors the brand's real inbound flow.
export async function addPoSizeRun(poId: string, formData: FormData) {
  const existingProductId = ((formData.get("product_id") as string) || "") || null;
  const newProductName = ((formData.get("new_product_name") as string) || "").trim();
  const unitCostRaw = (formData.get("unit_cost") as string) || "";
  const unit_cost = unitCostRaw ? Number(unitCostRaw) : null;

  const quantities = SIZE_RUN.map((size) => ({
    size,
    qty: Number(formData.get(`qty_${size}`) || 0),
  })).filter((s) => Number.isInteger(s.qty) && s.qty > 0);

  if (!existingProductId && !newProductName) {
    throw new Error("Pick an existing product or enter a new product name");
  }
  if (!quantities.length) {
    throw new Error("Enter a quantity for at least one size");
  }

  const supabase = await createClient();

  // Resolve the product.
  let productId = existingProductId;
  let productName = newProductName;
  if (!productId) {
    const { data, error } = await supabase
      .from("products")
      .insert({ name: newProductName })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    productId = data.id;
    productName = data.name;
  } else {
    const { data } = await supabase.from("products").select("name").eq("id", productId).maybeSingle();
    productName = data?.name ?? "ITEM";
  }

  const base = skuBase(productName);

  for (const { size, qty } of quantities) {
    // Reuse an existing variant for this product+size, else create one.
    const { data: existing } = await supabase
      .from("variants")
      .select("id")
      .eq("product_id", productId)
      .eq("size", size)
      .is("color", null)
      .maybeSingle();

    let variantId = existing?.id ?? null;
    if (!variantId) {
      // Find a free SKU: BASE-SIZE, then BASE-SIZE-2, -3, …
      let candidate = `${base}-${size}`;
      let n = 2;
      for (;;) {
        const { data: clash } = await supabase
          .from("variants")
          .select("id")
          .eq("sku", candidate)
          .maybeSingle();
        if (!clash) break;
        candidate = `${base}-${size}-${n++}`;
      }
      const { data: created, error: vErr } = await supabase
        .from("variants")
        .insert({ product_id: productId, size, sku: candidate })
        .select("id")
        .single();
      if (vErr) throw new Error(vErr.message);
      variantId = created.id;
    }

    const { error: lineErr } = await supabase
      .from("purchase_order_lines")
      .insert({ purchase_order_id: poId, variant_id: variantId, quantity_ordered: qty, unit_cost });
    if (lineErr) throw new Error(lineErr.message);
  }

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/products");
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
