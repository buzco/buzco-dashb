"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { setShopifyStock } from "@/lib/shopify/inventory";

// Correcting a stock figure by hand — a miscount, a breakage, a piece that came
// back, anything the ledger never saw.
//
// The ledger is append-only, so this does not overwrite a number: it writes the
// DIFFERENCE as an `adjustment` movement, exactly as the Shopify sync does. The
// history of how stock got to where it is stays intact, which is the whole
// reason stock lives in a ledger rather than a column.

export type SetStockState = {
  ok?: boolean;
  error?: string;
  /** Shown when the correction landed but is worth a second look. */
  warning?: string;
  quantity?: number;
  at?: number;
};

export async function setVariantStock(
  variantId: string,
  locationId: string,
  quantity: number,
): Promise<SetStockState> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { error: "Stock must be a whole number, zero or more", at: Date.now() };
  }

  try {
    const supabase = await createClient();

    const [{ data: variant }, { data: location }, { data: current }] = await Promise.all([
      supabase
        .from("variants")
        .select("id, sku, shopify_variant_id")
        .eq("id", variantId)
        .maybeSingle(),
      supabase
        .from("inventory_locations")
        .select("id, name, type")
        .eq("id", locationId)
        .maybeSingle(),
      supabase
        .from("current_stock")
        .select("quantity")
        .eq("variant_id", variantId)
        .eq("location_id", locationId)
        .maybeSingle(),
    ]);

    if (!variant) return { error: "Unknown variant", at: Date.now() };
    if (!location) return { error: "Unknown location", at: Date.now() };

    const before = current?.quantity ?? 0;
    const delta = quantity - before;
    if (delta === 0) return { ok: true, quantity, at: Date.now() };

    let warning: string | undefined;

    // Shopify first, and only for the location that mirrors it. Correcting that
    // location without telling Shopify would be undone by the next sync, so a
    // Shopify refusal has to stop the local write too — otherwise the two
    // numbers disagree until someone notices.
    if (location.type === "shopify") {
      if (!variant.shopify_variant_id) {
        warning = `${variant.sku} isn't linked to Shopify, so only this ledger was corrected.`;
      } else if (!isShopifyConfigured()) {
        warning = "Shopify isn't configured, so only this ledger was corrected.";
      } else {
        await setShopifyStock(variant.shopify_variant_id, quantity);
      }
    }

    const { error } = await supabase.from("inventory_movements").insert({
      variant_id: variantId,
      location_id: locationId,
      quantity_change: delta,
      reason: "adjustment",
      reference_type: "manual_correction",
    });
    if (error) {
      return {
        error:
          location.type === "shopify" && variant.shopify_variant_id
            ? `${error.message} — Shopify was already set to ${quantity}, so the two now disagree.`
            : error.message,
        at: Date.now(),
      };
    }

    revalidatePath("/products");
    revalidatePath(`/products/${variant.id}`);
    revalidatePath("/inventory");
    revalidatePath("/sales/new");
    return { ok: true, quantity, warning, at: Date.now() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), at: Date.now() };
  }
}
