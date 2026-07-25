"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidLinkToken } from "@/lib/market/link";
import { recordMarketSale } from "@/lib/market/record-sale";
import {
  recordRaffleSale,
  type RaffleBundleId,
  type RafflePaymentId,
} from "@/lib/market/raffle-sales";

// Server actions for the tokenless stall pages.
//
// Two things every action here must do, because there is no logged-in user:
//  1. Re-check the link token. A server action is a public HTTP endpoint — the
//     page's guard does not protect it, so anyone could invoke this directly.
//  2. Use the service-role client, since RLS policies are written for the
//     `authenticated` role and there is no session to satisfy them.

export type StallState = { ok?: boolean; message?: string; error?: string; at?: number };

export async function stallSell(
  token: string,
  eventId: string,
  _prev: StallState | undefined,
  formData: FormData,
): Promise<StallState> {
  if (!isValidLinkToken(token)) return { error: "This link is no longer valid.", at: Date.now() };

  const variantId = (formData.get("variant_id") as string) || "";
  const quantity = Number(formData.get("quantity") || 1);
  const priceRaw = ((formData.get("price") as string) || "").trim();
  const paymentMethod = ((formData.get("payment_method") as string) || "").trim() || null;
  const customerRef = ((formData.get("customer_ref") as string) || "").trim() || null;

  if (!variantId) return { error: "Pick a size", at: Date.now() };
  if (!paymentMethod) return { error: "Pick how they paid", at: Date.now() };

  try {
    const supabase = createAdminClient();
    const result = await recordMarketSale(supabase, {
      eventId,
      variantId,
      quantity,
      unitPrice: Number(priceRaw.replace(",", ".")),
      paymentMethod,
      customerRef,
    });
    revalidatePath(`/s/${token}/pos`);
    return {
      ok: true,
      message: result.warning
        ? result.warning
        : `Sold${result.shopifyOrderName ? ` · Shopify ${result.shopifyOrderName}` : ""}`,
      at: Date.now(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), at: Date.now() };
  }
}

export async function stallRaffleSale(
  token: string,
  eventId: string,
  bundleId: RaffleBundleId,
  paymentId: RafflePaymentId,
): Promise<StallState> {
  if (!isValidLinkToken(token)) return { error: "This link is no longer valid.", at: Date.now() };

  try {
    const supabase = createAdminClient();
    const result = await recordRaffleSale(supabase, { eventId, bundleId, paymentId });
    revalidatePath(`/s/${token}/rifas`);
    return {
      ok: true,
      message: `+${result.tickets} rifa${result.tickets === 1 ? "" : "s"} · €${result.amount}${
        result.notionOk ? "" : " (not in Notion yet)"
      }`,
      at: Date.now(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), at: Date.now() };
  }
}
