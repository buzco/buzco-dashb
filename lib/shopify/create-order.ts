import "server-only";

import { shopifyGraphQL } from "@/lib/shopify/client";

// Pushes a market sale into Shopify as a real order, so Shopify stays the
// single stock centre: `inventoryBehaviour: DECREMENT_OBEYING_POLICY` makes
// Shopify decrement the variant itself, which is what removes the need to carry
// stock in and out of a per-event crate.
//
// sourceName is deliberately NOT "pos". lib/shopify/pos.ts imports orders whose
// sourceName is pos, so reusing it here would make the puller re-import orders
// this app just created — a feedback loop that double-counts every sale.

/** Marks orders this app created, so the POS importer can ignore them. */
export const MARKET_SOURCE_NAME = "buzco-market";
/** Same reasoning, for orders written from the sales tab's logger. */
export const SALES_SOURCE_NAME = "buzco-sales";

const ORDER_CREATE = `
  mutation CreateMarketOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order {
        id
        name
        displayFinancialStatus
      }
      userErrors { field message }
    }
  }
`;

export type MarketOrderLine = {
  shopifyVariantId: string;
  quantity: number;
  /** Price per unit actually charged, after any market discount. */
  unitPrice: number;
};

export type CreatedOrder = { id: string; name: string };

export async function createMarketOrder(opts: {
  lines: MarketOrderLine[];
  /** Free-text label shown on the Shopify order, e.g. the buyer's name. */
  customerRef?: string | null;
  paymentMethod?: string | null;
  eventName?: string | null;
  currency?: string;
}): Promise<CreatedOrder> {
  const currency = opts.currency ?? "EUR";
  if (!opts.lines.length) throw new Error("createMarketOrder: no line items");

  const noteParts = [
    opts.eventName ? `Market: ${opts.eventName}` : null,
    opts.customerRef ? `Buyer: ${opts.customerRef}` : null,
    opts.paymentMethod ? `Paid with: ${opts.paymentMethod}` : null,
  ].filter(Boolean);

  const data = await shopifyGraphQL<{
    orderCreate: {
      order: { id: string; name: string; displayFinancialStatus: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(ORDER_CREATE, {
    order: {
      currency,
      // Sold and paid for at the stall — no fulfilment workflow to run.
      financialStatus: "PAID",
      sourceName: MARKET_SOURCE_NAME,
      tags: ["market", opts.eventName].filter(Boolean),
      note: noteParts.join(" · ") || null,
      lineItems: opts.lines.map((l) => ({
        variantId: l.shopifyVariantId,
        quantity: l.quantity,
        // priceSet carries the discounted market price; without it Shopify
        // would bill the variant's normal retail price.
        priceSet: {
          shopMoney: { amount: l.unitPrice.toFixed(2), currencyCode: currency },
        },
      })),
    },
    options: {
      // OBEYING_POLICY so Shopify refuses to push a variant below zero unless
      // the product itself allows overselling.
      inventoryBehaviour: "DECREMENT_OBEYING_POLICY",
      sendReceipt: false,
    },
  });

  const { order, userErrors } = data.orderCreate;
  if (userErrors?.length) {
    throw new Error(
      `Shopify rejected the order: ${userErrors.map((e) => e.message).join("; ")}`,
    );
  }
  if (!order) throw new Error("Shopify returned no order");

  return { id: order.id, name: order.name };
}

// ---------------------------------------------------------------------------
// Sales-tab orders
// ---------------------------------------------------------------------------

// A sale logged from the sales tab is one Shopify order with one line per
// product+size, which is what makes a four-tee sale read as a single
// transaction in Shopify instead of four unrelated ones.
//
// The only real difference from a market sale is the financial status. A
// consignation is stock that has LEFT (so Shopify must decrement) but has not
// been paid for, which is exactly Shopify's PENDING — and settling it later is
// `markShopifyOrderPaid`. Selling normally is PAID, as at the stall.

export async function createSalesOrder(opts: {
  lines: MarketOrderLine[];
  /** false for a consignation: goods out, money not in yet. */
  paid: boolean;
  /** Buyer shown on the order — the shop's name, or a walk-up buyer's. */
  customerRef?: string | null;
  paymentMethod?: string | null;
  /** Our own reference (SL-0004 / CNS-0002), so the two systems can be tied up. */
  reference?: string | null;
  /** The Notion "Where" option, carried over as a tag for filtering in Shopify. */
  where?: string | null;
  note?: string | null;
  currency?: string;
}): Promise<CreatedOrder> {
  const currency = opts.currency ?? "EUR";
  if (!opts.lines.length) throw new Error("createSalesOrder: no line items");

  const noteParts = [
    opts.reference ? `Ref: ${opts.reference}` : null,
    opts.customerRef ? `Buyer: ${opts.customerRef}` : null,
    opts.where ? `Where: ${opts.where}` : null,
    opts.paid ? (opts.paymentMethod ? `Paid with: ${opts.paymentMethod}` : null) : "CONSIGNATION — payment pending",
    opts.note,
  ].filter(Boolean);

  const data = await shopifyGraphQL<{
    orderCreate: {
      order: { id: string; name: string; displayFinancialStatus: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(ORDER_CREATE, {
    order: {
      currency,
      financialStatus: opts.paid ? "PAID" : "PENDING",
      sourceName: SALES_SOURCE_NAME,
      tags: [opts.paid ? "sale" : "consignment", opts.where, opts.reference].filter(Boolean),
      note: noteParts.join(" · ") || null,
      lineItems: opts.lines.map((l) => ({
        variantId: l.shopifyVariantId,
        quantity: l.quantity,
        priceSet: {
          shopMoney: { amount: l.unitPrice.toFixed(2), currencyCode: currency },
        },
      })),
    },
    options: {
      inventoryBehaviour: "DECREMENT_OBEYING_POLICY",
      sendReceipt: false,
    },
  });

  const { order, userErrors } = data.orderCreate;
  if (userErrors?.length) {
    throw new Error(`Shopify rejected the order: ${userErrors.map((e) => e.message).join("; ")}`);
  }
  if (!order) throw new Error("Shopify returned no order");

  return { id: order.id, name: order.name };
}

const ORDER_MARK_PAID = `
  mutation MarkOrderPaid($input: OrderMarkAsPaidInput!) {
    orderMarkAsPaid(input: $input) {
      order { id name displayFinancialStatus }
      userErrors { field message }
    }
  }
`;

/**
 * Settling a consignation: the PENDING order Shopify has been holding becomes
 * PAID. Stock was already decremented when the order was created, so this moves
 * money only — nothing here touches inventory.
 */
export async function markShopifyOrderPaid(orderGid: string): Promise<void> {
  const data = await shopifyGraphQL<{
    orderMarkAsPaid: { userErrors: Array<{ message: string }> };
  }>(ORDER_MARK_PAID, { input: { id: orderGid } });

  const errors = data.orderMarkAsPaid?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`Shopify could not mark the order paid: ${errors.map((e) => e.message).join("; ")}`);
  }
}

// Reversing a sale. Deliberately CANCEL rather than delete: verified against
// the live store that orderDelete removes the order but does NOT put the units
// back, which would silently lose stock on every void. orderCancel takes an
// explicit restock flag.
const ORDER_CANCEL = `
  mutation CancelMarketOrder(
    $orderId: ID!
    $reason: OrderCancelReason!
    $refund: Boolean!
    $restock: Boolean!
  ) {
    orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock) {
      job { id }
      orderCancelUserErrors { field message }
    }
  }
`;

export async function cancelMarketOrder(orderGid: string): Promise<void> {
  const data = await shopifyGraphQL<{
    orderCancel: { orderCancelUserErrors: Array<{ message: string }> };
  }>(ORDER_CANCEL, {
    orderId: orderGid,
    reason: "OTHER",
    refund: true,
    restock: true,
  });

  const errors = data.orderCancel?.orderCancelUserErrors ?? [];
  if (errors.length) {
    throw new Error(`Shopify could not cancel the order: ${errors.map((e) => e.message).join("; ")}`);
  }
}
