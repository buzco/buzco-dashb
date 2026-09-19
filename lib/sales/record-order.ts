import "server-only";

import {
  cancelMarketOrder,
  createSalesOrder,
  markShopifyOrderPaid,
} from "@/lib/shopify/create-order";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { isNotionConfigured } from "@/lib/notion/client";
import { mirrorUnsyncedForOrder, resyncOrderInNotion } from "@/lib/notion/mirror";
import { apportionDiscount, cents, channelFor } from "@/lib/sales/pricing";
import type { createClient } from "@/lib/supabase/server";

// The one code path for logging a sale or a consignation from the sales tab.
//
// Order of operations is the same as the market till (lib/market/record-sale.ts)
// and for the same reason. Shopify goes FIRST: it owns stock, so if it refuses
// the order — a size that sold out online while you were typing — nothing is
// recorded anywhere and the seller sees why. Postgres is written second and is
// the source of truth. Notion goes last and can never fail the sale; a failure
// is parked on sales.notion_error and retried from the dashboard.

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

export type SaleOrderLineInput = {
  variantId: string;
  quantity: number;
  /** Price per garment before the order-level discount. Freebies are 0. */
  unitPrice: number;
  freebie: boolean;
};

export type RecordSaleOrderInput = {
  kind: "sale" | "consignment";
  retailerId: string | null;
  customerName: string | null;
  /** A Notion "Where" option, verbatim. */
  where: string | null;
  paymentStatus: "paid" | "pending";
  paymentMethod: string | null;
  discountKind: "percent" | "amount" | null;
  discountValue: number;
  notes: string | null;
  lines: SaleOrderLineInput[];
};

export type RecordSaleOrderResult = {
  orderId: string;
  reference: string;
  shopifyOrderName: string | null;
  /** Non-fatal problems worth telling the seller about. */
  warnings: string[];
};

/**
 * The location mirroring Shopify's on-hand — the pool these sales come out of.
 * Looked up through the caller's client rather than a fresh one, so this works
 * from a service-role context (no session) as well as from the dashboard.
 */
async function shopifyLocationId(supabase: SupabaseLike): Promise<string | null> {
  const { data } = await supabase
    .from("inventory_locations")
    .select("id")
    .eq("type", "shopify")
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function recordSaleOrder(
  supabase: SupabaseLike,
  input: RecordSaleOrderInput,
): Promise<RecordSaleOrderResult> {
  const warnings: string[] = [];

  const lines = input.lines.filter((l) => l.quantity > 0);
  if (!lines.length) throw new Error("Add at least one item");
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
      throw new Error("Quantities must be whole numbers above zero");
    }
    if (!Number.isFinite(l.unitPrice) || l.unitPrice < 0) {
      throw new Error("Enter a valid price for every item");
    }
  }
  if (input.kind === "consignment" && !input.retailerId) {
    throw new Error("A consignation needs a customer — pick one or create it");
  }

  const locationId = await shopifyLocationId(supabase);
  if (!locationId) {
    throw new Error("No Shopify stock location yet — run a Shopify sync first");
  }

  // Preflight, because Shopify is written BEFORE the ledger: if the order
  // tables aren't there, every attempt would create a real Shopify order and
  // decrement real stock before discovering it has nowhere to record it. One
  // cheap read up front turns that into a message. (It probes the table rather
  // than the function because the two ship in the same migration, and probing
  // an RPC means running it.)
  const { error: preflight } = await supabase.from("sale_orders").select("id").limit(1);
  if (preflight) {
    throw new Error(
      `The sales-order tables aren't in the database yet — apply migration 009 and try again. Nothing was sent to Shopify. (${preflight.message})`,
    );
  }

  const { data: variantRows, error: variantError } = await supabase
    .from("variants")
    .select("id, sku, shopify_variant_id")
    .in("id", lines.map((l) => l.variantId));
  if (variantError) throw new Error(variantError.message);
  const variantById = new Map((variantRows ?? []).map((v) => [v.id, v]));

  const discounts = apportionDiscount(lines, input.discountKind, input.discountValue);

  // A consignation is unpaid however the form was filled in.
  const paid = input.kind !== "consignment" && input.paymentStatus === "paid";

  // --- 1. Shopify (stock centre) ---
  let shopifyOrderId: string | null = null;
  let shopifyOrderName: string | null = null;

  const shopifyLines = lines
    .map((l, i) => {
      const variant = variantById.get(l.variantId);
      if (!variant?.shopify_variant_id) return null;
      const net = cents(l.unitPrice * l.quantity - discounts[i]);
      return {
        shopifyVariantId: variant.shopify_variant_id,
        quantity: l.quantity,
        unitPrice: cents(net / l.quantity),
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const unlinked = lines.filter((l) => !variantById.get(l.variantId)?.shopify_variant_id);
  if (unlinked.length) {
    const skus = unlinked.map((l) => variantById.get(l.variantId)?.sku ?? "?").join(", ");
    warnings.push(
      `${skus} ${unlinked.length === 1 ? "isn't" : "aren't"} linked to Shopify — recorded here, but Shopify stock is unchanged.`,
    );
  }

  if (shopifyLines.length && isShopifyConfigured()) {
    const order = await createSalesOrder({
      lines: shopifyLines,
      paid,
      customerRef: input.customerName,
      paymentMethod: input.paymentMethod,
      where: input.where,
      note: input.notes,
    });
    shopifyOrderId = order.id;
    shopifyOrderName = order.name;
  } else if (shopifyLines.length) {
    warnings.push("Shopify isn't configured — recorded here only.");
  }

  // --- 2. Our ledger (source of truth) ---
  const { data: order, error } = await supabase.rpc("log_sale_order", {
    p_kind: input.kind,
    p_channel: channelFor(input),
    p_retailer_id: input.retailerId,
    p_customer_name: input.customerName,
    p_where: input.where,
    p_payment_status: paid ? "paid" : "pending",
    p_payment_method: input.paymentMethod,
    p_discount_kind: input.discountKind,
    p_discount_value: input.discountValue || 0,
    p_notes: input.notes,
    p_location_id: locationId,
    p_lines: lines.map((l, i) => ({
      variant_id: l.variantId,
      quantity: l.quantity,
      unit_price: l.freebie ? 0 : l.unitPrice,
      discount_amount: discounts[i],
      freebie: l.freebie,
    })),
    p_shopify_order_id: shopifyOrderId,
    p_shopify_order_name: shopifyOrderName,
  });

  if (error) {
    // Shopify has already decremented and there is no ledger row to hang a void
    // on, so roll it back here. orderCancel restocks, which is the whole point:
    // the alternative is stock quietly missing from Shopify for a sale that was
    // never recorded anywhere.
    if (!shopifyOrderId) throw new Error(error.message);

    let rolledBack = false;
    try {
      await cancelMarketOrder(shopifyOrderId);
      rolledBack = true;
    } catch {
      // Nothing to do but say so — the message below is the only way anyone
      // finds out the order is still standing.
    }

    throw new Error(
      rolledBack
        ? `${error.message} — the Shopify order was cancelled and its stock put back.`
        : `${error.message} — and Shopify order ${shopifyOrderName} could NOT be cancelled, so it is still holding that stock. Cancel it by hand.`,
    );
  }
  if (!order) throw new Error("The order was not recorded");

  // --- 3. Notion mirror (never fatal) ---
  if (isNotionConfigured()) {
    const mirror = await mirrorUnsyncedForOrder(order.id, supabase);
    if (mirror.failed) {
      warnings.push(
        `${mirror.failed} line${mirror.failed === 1 ? "" : "s"} didn't reach Notion — retry from the sales list.`,
      );
    }
  }

  return {
    orderId: order.id,
    reference: order.reference,
    shopifyOrderName,
    warnings,
  };
}

/**
 * A shop settled up for what it kept. Marks the order paid here, moves its
 * Shopify order from PENDING to PAID, and re-states its Notion pages as "Pago".
 *
 * Postgres goes first this time, unlike recording: the money is already in the
 * user's hand, so a Shopify hiccup must not be able to reject the fact.
 */
export async function settleSaleOrder(
  supabase: SupabaseLike,
  orderId: string,
  paymentMethod: string | null,
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];

  const { data: order, error } = await supabase.rpc("settle_sale_order", {
    p_order_id: orderId,
    p_payment_method: paymentMethod,
  });
  if (error) throw new Error(error.message);
  if (!order) throw new Error("Order not found");

  if (order.shopify_order_id && isShopifyConfigured()) {
    try {
      await markShopifyOrderPaid(order.shopify_order_id);
    } catch (e) {
      warnings.push(
        `Marked paid here, but Shopify ${order.shopify_order_name ?? "order"} is still pending (${
          e instanceof Error ? e.message : String(e)
        }).`,
      );
    }
  }

  if (isNotionConfigured()) {
    const resync = await resyncOrderInNotion(orderId, supabase);
    if (resync.failed) {
      warnings.push(`${resync.failed} Notion page${resync.failed === 1 ? "" : "s"} still say "Por pagar".`);
    }
  }

  return { warnings };
}
