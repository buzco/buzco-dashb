"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { archivePage, isNotionConfigured } from "@/lib/notion/client";
import { mirrorSalesToNotion, mirrorUnsyncedForEvent } from "@/lib/notion/mirror";
import { setTicketClaimed } from "@/lib/notion/raffle";
import { pullPosSalesForEvent } from "@/lib/shopify/pos";

function refreshEvent(eventId: string) {
  revalidatePath(`/markets/${eventId}`);
  revalidatePath("/markets");
  revalidatePath("/inventory");
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function createMarketEvent(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const venue = ((formData.get("venue") as string) || "").trim() || null;
  const startsRaw = (formData.get("starts_at") as string) || "";
  const endsRaw = (formData.get("ends_at") as string) || "";
  const notes = ((formData.get("notes") as string) || "").trim() || null;

  if (!name) throw new Error("Event name is required");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_market_event", {
    p_name: name,
    p_venue: venue,
    // datetime-local gives a local wall-clock string; let Postgres interpret it.
    p_starts_at: startsRaw ? new Date(startsRaw).toISOString() : new Date().toISOString(),
    p_ends_at: endsRaw ? new Date(endsRaw).toISOString() : null,
    p_notes: notes,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/markets");
  redirect(`/markets/${data.id}`);
}

export async function setMarketStatus(eventId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("market_events").update({ status }).eq("id", eventId);
  if (error) throw new Error(error.message);
  refreshEvent(eventId);
}

export async function deleteMarketEvent(eventId: string) {
  const supabase = await createClient();

  // Refuse to delete an event that has real history — the ledger movements
  // reference it, and silently orphaning them would corrupt stock counts.
  const { count } = await supabase
    .from("sales")
    .select("id", { count: "exact", head: true })
    .eq("market_event_id", eventId);
  if (count) throw new Error(`This event has ${count} sale(s) — close it instead of deleting`);

  const { data: event } = await supabase
    .from("market_events")
    .select("location_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) throw new Error("Market event not found");

  // Stock still in the crate would be stranded in a location about to vanish.
  const { data: stock } = await supabase
    .from("current_stock")
    .select("quantity")
    .eq("location_id", event.location_id)
    .gt("quantity", 0);
  const units = (stock ?? []).reduce((sum, row) => sum + row.quantity, 0);
  if (units) {
    throw new Error(`${units} unit(s) still in the crate — load them out before deleting`);
  }

  // market_prices and market_voided_lines cascade; the transfer movements and
  // the event's own location do not, so clear them explicitly.
  await supabase
    .from("inventory_movements")
    .delete()
    .eq("reference_type", "market_event")
    .eq("reference_id", eventId);

  const { error } = await supabase.from("market_events").delete().eq("id", eventId);
  if (error) throw new Error(error.message);

  await supabase.from("inventory_locations").delete().eq("id", event.location_id);

  revalidatePath("/markets");
  redirect("/markets");
}

// ---------------------------------------------------------------------------
// Load-in / load-out (what's physically in the crate)
// ---------------------------------------------------------------------------

export async function loadInVariant(eventId: string, formData: FormData) {
  const variant_id = (formData.get("variant_id") as string) || "";
  const from_location_id = (formData.get("from_location_id") as string) || "";
  const quantity = Number(formData.get("quantity"));

  if (!variant_id) throw new Error("Pick a variant");
  if (!from_location_id) throw new Error("Pick where the stock comes from");
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Quantity must be a whole number above zero");

  const supabase = await createClient();
  const { error } = await supabase.rpc("market_load_in", {
    p_market_event_id: eventId,
    p_variant_id: variant_id,
    p_quantity: quantity,
    p_from_location_id: from_location_id,
  });
  if (error) throw new Error(error.message);
  refreshEvent(eventId);
}

export async function loadOutVariant(eventId: string, formData: FormData) {
  const variant_id = (formData.get("variant_id") as string) || "";
  const to_location_id = (formData.get("to_location_id") as string) || "";
  const quantity = Number(formData.get("quantity"));

  if (!variant_id) throw new Error("Pick a variant");
  if (!to_location_id) throw new Error("Pick where the stock goes back to");
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Quantity must be a whole number above zero");

  const supabase = await createClient();
  const { error } = await supabase.rpc("market_load_out", {
    p_market_event_id: eventId,
    p_variant_id: variant_id,
    p_quantity: quantity,
    p_to_location_id: to_location_id,
  });
  if (error) throw new Error(error.message);
  refreshEvent(eventId);
}

/** Send everything left in the crate back to one location, in one press. */
export async function loadOutEverything(eventId: string, toLocationId: string) {
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("market_events")
    .select("location_id")
    .eq("id", eventId)
    .single();
  if (!event) throw new Error("Market event not found");

  const { data: rows, error } = await supabase
    .from("current_stock")
    .select("variant_id, quantity")
    .eq("location_id", event.location_id)
    .gt("quantity", 0);
  if (error) throw new Error(error.message);

  for (const row of rows ?? []) {
    const { error: rpcError } = await supabase.rpc("market_load_out", {
      p_market_event_id: eventId,
      p_variant_id: row.variant_id,
      p_quantity: row.quantity,
      p_to_location_id: toLocationId,
    });
    if (rpcError) throw new Error(rpcError.message);
  }
  refreshEvent(eventId);
}

// ---------------------------------------------------------------------------
// Event pricing (our record only — never written to Shopify)
// ---------------------------------------------------------------------------

export async function setMarketPrice(eventId: string, formData: FormData) {
  const product_id = (formData.get("product_id") as string) || "";
  const variantRaw = ((formData.get("variant_id") as string) || "").trim();
  const priceRaw = ((formData.get("price") as string) || "").trim();

  if (!product_id) throw new Error("Missing product");

  // An empty price clears the override and falls back to the next rule up
  // (variant override -> product default -> variants.retail_price).
  let price: number | null = null;
  if (priceRaw) {
    price = Number(priceRaw.replace(",", "."));
    if (!Number.isFinite(price) || price < 0) throw new Error("Enter a valid price");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_market_price", {
    p_market_event_id: eventId,
    p_product_id: product_id,
    p_variant_id: variantRaw || null,
    p_price: price,
  });
  if (error) throw new Error(error.message);
  refreshEvent(eventId);
}

/** Set every loaded product's event price to a percentage off its retail price. */
export async function bulkDiscountEvent(eventId: string, formData: FormData) {
  const pct = Number((formData.get("percent") as string) || "");
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    throw new Error("Enter a discount between 1 and 100");
  }

  const supabase = await createClient();
  const { data: priced, error } = await supabase.rpc("bulk_discount_market", {
    p_market_event_id: eventId,
    p_percent: pct,
  });
  if (error) throw new Error(error.message);
  if (!priced) {
    throw new Error("Nothing to price — load stock with retail prices into the crate first");
  }
  refreshEvent(eventId);
}

export async function clearMarketPrices(eventId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("market_prices").delete().eq("market_event_id", eventId);
  if (error) throw new Error(error.message);
  refreshEvent(eventId);
}

// ---------------------------------------------------------------------------
// Selling
// ---------------------------------------------------------------------------

/**
 * Manual sale from the stock grid — the fallback for when POS isn't used
 * (cash in hand, MB WAY, a gift). Goes through the same RPC as POS imports.
 */
export async function sellAtMarket(eventId: string, formData: FormData) {
  const variant_id = (formData.get("variant_id") as string) || "";
  const quantity = Number(formData.get("quantity") || 1);
  const priceRaw = ((formData.get("price") as string) || "").trim();
  const payment_method = ((formData.get("payment_method") as string) || "").trim() || null;
  const customer_ref = ((formData.get("customer_ref") as string) || "").trim() || null;
  const notes = ((formData.get("notes") as string) || "").trim() || null;

  if (!variant_id) throw new Error("Pick a size");
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Quantity must be a whole number above zero");

  const unitPrice = priceRaw ? Number(priceRaw.replace(",", ".")) : 0;
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Enter a valid price");

  const supabase = await createClient();
  const { data: sale, error } = await supabase.rpc("log_market_sale", {
    p_market_event_id: eventId,
    p_variant_id: variant_id,
    p_quantity: quantity,
    p_gross_amount: Math.round(unitPrice * quantity * 100) / 100,
    p_discount_amount: 0,
    p_fees_amount: 0,
    p_customer_ref: customer_ref,
    p_notes: notes,
    p_payment_method: payment_method,
  });
  if (error) throw new Error(error.message);

  // Notion is a mirror: a failure here must not undo the sale.
  if (sale && isNotionConfigured()) {
    await mirrorSalesToNotion([sale.id]);
  }
  refreshEvent(eventId);
}

export async function voidSale(eventId: string, saleId: string) {
  const supabase = await createClient();

  // Grab the mirrored page ids before the row goes away.
  const { data: sale } = await supabase
    .from("sales")
    .select("notion_page_id")
    .eq("id", saleId)
    .maybeSingle();

  const { error } = await supabase.rpc("void_market_sale", { p_sale_id: saleId });
  if (error) throw new Error(error.message);

  // Send the tracker rows to Notion's trash (restorable for 30 days) so it
  // doesn't keep a row for a sale that didn't happen. Best-effort: the sale is
  // already reversed here, and a Notion hiccup shouldn't surface as a failure.
  const pageIds = (sale?.notion_page_id ?? "").split(",").filter(Boolean);
  if (pageIds.length && isNotionConfigured()) {
    for (const pageId of pageIds) {
      try {
        await archivePage(pageId);
      } catch {
        /* leave the row in Notion rather than failing the void */
      }
    }
  }

  refreshEvent(eventId);
}

// ---------------------------------------------------------------------------
// Shopify POS + Notion sync
// ---------------------------------------------------------------------------

export type SyncState = { message?: string; error?: string; at?: number };

/**
 * Pull every POS transaction for the event, then mirror the new ones to Notion.
 * Safe to press repeatedly — both halves are idempotent.
 */
export async function pullPosSales(eventId: string): Promise<SyncState> {
  try {
    const pos = await pullPosSalesForEvent(eventId);

    const parts: string[] = [
      `${pos.salesCreated} new sale${pos.salesCreated === 1 ? "" : "s"} from ${pos.posOrders} POS order${pos.posOrders === 1 ? "" : "s"}`,
    ];
    if (pos.salesSkipped) parts.push(`${pos.salesSkipped} already imported`);

    if (pos.createdSaleIds.length && isNotionConfigured()) {
      const notion = await mirrorSalesToNotion(pos.createdSaleIds);
      parts.push(`${notion.synced} mirrored to Notion`);
      if (notion.failed) parts.push(`${notion.failed} Notion failure(s)`);
    }
    if (pos.unknownVariantLines) {
      parts.push(
        `${pos.unknownVariantLines} line(s) skipped — not linked to a product here: ${pos.unknownVariantTitles.slice(0, 3).join(", ")}`,
      );
    }

    refreshEvent(eventId);
    return {
      message: parts.join(" · "),
      error: pos.errors.length ? pos.errors.slice(0, 2).join("; ") : undefined,
      at: Date.now(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), at: Date.now() };
  }
}

export async function retryNotionSync(eventId: string): Promise<SyncState> {
  try {
    const result = await mirrorUnsyncedForEvent(eventId);
    refreshEvent(eventId);
    return {
      message: `${result.synced} mirrored to Notion${result.failed ? `, ${result.failed} failed` : ""}`,
      error: result.errors.length ? result.errors.slice(0, 2).join("; ") : undefined,
      at: Date.now(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), at: Date.now() };
  }
}

// ---------------------------------------------------------------------------
// Raffle (lives entirely in Notion)
// ---------------------------------------------------------------------------

export async function claimRaffleTicket(eventId: string, formData: FormData) {
  const pageId = (formData.get("page_id") as string) || "";
  const winner = ((formData.get("winner") as string) || "").trim() || null;
  if (!pageId) throw new Error("Missing ticket");

  await setTicketClaimed(pageId, true, winner);
  revalidatePath(`/markets/${eventId}`);
}

export async function unclaimRaffleTicket(eventId: string, pageId: string) {
  await setTicketClaimed(pageId, false);
  revalidatePath(`/markets/${eventId}`);
}
