"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  recordSaleOrder,
  settleSaleOrder,
  type RecordSaleOrderInput,
} from "@/lib/sales/record-order";
import { mirrorUnsyncedForOrder } from "@/lib/notion/mirror";
import { clearSalesOptionsCache } from "@/lib/notion/options";

// Server actions for the sales tab.
//
// The logger posts a whole order as one object rather than a FormData blob:
// the cart is built up in React state (product, size, qty, freebie, per-line
// price), and flattening that into form fields only to parse it back would be
// a lossy round trip for no gain.

export type SaleOrderState = {
  ok?: boolean;
  error?: string;
  reference?: string;
  orderId?: string;
  shopifyOrderName?: string | null;
  warnings?: string[];
  /** Changes on every result so the UI can react to two identical outcomes. */
  at?: number;
};

export type SaleOrderPayload = {
  kind: "sale" | "consignment";
  retailerId: string | null;
  customerName: string | null;
  where: string | null;
  paymentStatus: "paid" | "pending";
  paymentMethod: string | null;
  discountKind: "percent" | "amount" | null;
  discountValue: number;
  notes: string | null;
  lines: Array<{
    variantId: string;
    quantity: number;
    unitPrice: number;
    freebie: boolean;
  }>;
};

function revalidateSales() {
  revalidatePath("/sales");
  revalidatePath("/sales/new");
  revalidatePath("/sales/consignments");
  revalidatePath("/inventory");
  revalidatePath("/finance");
  revalidatePath("/");
}

export async function logSaleOrder(payload: SaleOrderPayload): Promise<SaleOrderState> {
  try {
    const input: RecordSaleOrderInput = {
      kind: payload.kind === "consignment" ? "consignment" : "sale",
      retailerId: payload.retailerId || null,
      customerName: payload.customerName?.trim() || null,
      where: payload.where?.trim() || null,
      paymentStatus: payload.paymentStatus === "pending" ? "pending" : "paid",
      paymentMethod: payload.paymentMethod?.trim() || null,
      discountKind: payload.discountKind ?? null,
      discountValue: Number(payload.discountValue) || 0,
      notes: payload.notes?.trim() || null,
      lines: (payload.lines ?? []).map((l) => ({
        variantId: l.variantId,
        quantity: Math.trunc(Number(l.quantity)),
        unitPrice: l.freebie ? 0 : Number(l.unitPrice),
        freebie: Boolean(l.freebie),
      })),
    };

    const supabase = await createClient();
    const result = await recordSaleOrder(supabase, input);

    revalidateSales();
    return {
      ok: true,
      orderId: result.orderId,
      reference: result.reference,
      shopifyOrderName: result.shopifyOrderName,
      warnings: result.warnings,
      at: Date.now(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), at: Date.now() };
  }
}

/** Declare a consignation paid — the shop settled up for what it kept. */
export async function settleOrder(
  orderId: string,
  _prev: SaleOrderState | undefined,
  formData: FormData,
): Promise<SaleOrderState> {
  const method = ((formData.get("payment_method") as string) || "").trim() || null;
  if (!method) return { error: "Pick how they paid", at: Date.now() };

  try {
    const supabase = await createClient();
    const { warnings } = await settleSaleOrder(supabase, orderId, method);
    revalidateSales();
    return { ok: true, warnings, at: Date.now() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), at: Date.now() };
  }
}

/**
 * Consigned stock coming back unsold. The line is deleted and the units return
 * to the Shopify pool, because they are sellable again the moment they're back
 * on the shelf.
 */
export async function returnConsignedLine(
  orderId: string,
  saleId: string,
): Promise<SaleOrderState> {
  try {
    const supabase = await createClient();
    const { data: location } = await supabase
      .from("inventory_locations")
      .select("id")
      .eq("type", "shopify")
      .limit(1)
      .maybeSingle();
    if (!location) return { error: "No Shopify stock location to return into", at: Date.now() };

    const { error } = await supabase.rpc("return_sale_order_line", {
      p_sale_id: saleId,
      p_to_location_id: location.id,
    });
    if (error) return { error: error.message, at: Date.now() };

    revalidateSales();
    return {
      ok: true,
      orderId,
      warnings: [
        "Returned here. Shopify still holds the original order — cancel or edit it there if the units need to go back into Shopify's count.",
      ],
      at: Date.now(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), at: Date.now() };
  }
}

/** Create a wholesale customer mid-sale, without leaving the logger. */
export async function createCustomer(
  name: string,
  email: string | null,
): Promise<{ id?: string; name?: string; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the customer a name" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("retailers")
    .insert({
      name: trimmed,
      contact_email: email?.trim() || null,
      // They're buying right now, so "prospect" would be wrong from the start.
      status: "active",
      kind: "wholesale",
    })
    .select("id, name")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/retailers");
  revalidateSales();
  return { id: data.id, name: data.name };
}

/** Retry the Notion mirror for one order's unsynced lines. */
export async function retryOrderNotion(orderId: string): Promise<SaleOrderState> {
  try {
    const supabase = await createClient();
    const result = await mirrorUnsyncedForOrder(orderId, supabase);
    revalidateSales();
    return {
      ok: result.failed === 0,
      error: result.errors[0],
      warnings: result.failed ? [`${result.failed} still failing`] : [],
      at: Date.now(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), at: Date.now() };
  }
}

/** Drop the cached Notion option lists after editing them in Notion. */
export async function refreshNotionOptions(): Promise<void> {
  clearSalesOptionsCache();
  revalidateSales();
}
