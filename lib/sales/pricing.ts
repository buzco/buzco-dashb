// The money and routing arithmetic behind a sale order.
//
// Deliberately separate from record-order.ts, for the same reason
// lib/market/raffle-options.ts is separate from raffle-sales.ts: that module is
// `server-only` and reaches Shopify, Notion and the database, so nothing there
// can be exercised without a live world. Everything here is pure, which is what
// makes lib/sales/pricing.test.ts possible — and this is the code where a
// rounding slip quietly costs real euros.

export type SaleChannel = "shopify" | "market" | "friends_family" | "wholesale" | "other";

export type PricedLine = {
  quantity: number;
  /** Price per garment before the order-level discount. Freebies are 0. */
  unitPrice: number;
  freebie: boolean;
};

/** Rounds to cents without the floating-point surprises of toFixed arithmetic. */
export function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Split an order-level discount across its lines, proportionally to what each
 * line is worth.
 *
 * It has to be split rather than stored once on the order, because the Notion
 * tracker is one page PER GARMENT with the price that garment actually went for
 * — a 10% order discount that lived only on the header would leave every page
 * showing full price. The last discounted line absorbs the rounding remainder,
 * so the parts always add back up to the whole.
 *
 * Freebies are weighted at zero: they were already free, so discounting them
 * would silently move money off the lines that are actually being paid for.
 */
export function apportionDiscount(
  lines: PricedLine[],
  kind: "percent" | "amount" | null,
  value: number,
): number[] {
  const lineTotals = lines.map((l) => (l.freebie ? 0 : cents(l.unitPrice * l.quantity)));
  const subtotal = cents(lineTotals.reduce((a, b) => a + b, 0));
  if (!kind || !Number.isFinite(value) || value <= 0 || subtotal <= 0) {
    return lines.map(() => 0);
  }

  // Never discount below zero: 150% off is a typo, not a refund.
  const total = cents(
    kind === "percent" ? Math.min(subtotal, (subtotal * value) / 100) : Math.min(subtotal, value),
  );

  const shares = lineTotals.map((t) => cents((total * t) / subtotal));
  const lastDiscountable = lineTotals.reduce((last, t, i) => (t > 0 ? i : last), -1);
  if (lastDiscountable >= 0) {
    const drift = cents(total - shares.reduce((a, b) => a + b, 0));
    shares[lastDiscountable] = cents(shares[lastDiscountable] + drift);
  }
  return shares;
}

/** Which `sale_channel` this order belongs to, from what the seller told us. */
export function channelFor(input: {
  kind: string;
  retailerId: string | null;
  where: string | null;
}): SaleChannel {
  if (input.kind === "consignment" || input.retailerId) return "wholesale";
  const where = (input.where ?? "").toLowerCase();
  if (where.includes("online")) return "shopify";
  if (where.includes("feira") || where.includes("ladra") || where.includes("physical")) {
    return "market";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Agreed prices
// ---------------------------------------------------------------------------

/**
 * What one shop has agreed to pay, per variant — a line sheet pointed at a
 * retailer (see migration 010).
 *
 * The rates are negotiated, not derived: Cybercafé's €26 / €36 / €22 work out
 * at 52% / 48% / 55% of RRP. There is no percentage to apply, so a variant
 * missing from the sheet has NO agreed price and must not be invented.
 */
export type PriceList = {
  catalogId: string;
  /** Shown on screen, so which sheet was applied is never a guess. */
  name: string;
  /** variantId -> agreed unit price. */
  prices: Record<string, number>;
};

export type PricedFor = {
  unitPrice: number;
  /** False when this fell back to RRP because the sheet doesn't cover it. */
  agreed: boolean;
};

/**
 * The price a variant should go out at for this buyer.
 *
 * Falls back to retail rather than to zero or to a guessed percentage: selling
 * at RRP is a wrong price someone can see and fix, while a silent €0 is a
 * giveaway and a silently invented discount is a loss nobody notices.
 */
export function priceFor(
  variantId: string,
  retail: number,
  list: PriceList | null,
): PricedFor {
  const agreed = list?.prices[variantId];
  if (agreed == null || !Number.isFinite(agreed)) {
    return { unitPrice: cents(retail), agreed: false };
  }
  return { unitPrice: cents(agreed), agreed: true };
}

export type RepricableLine = {
  variantId: string;
  unitPrice: number;
  /** Retail, kept so switching back to "no customer" can restore it. */
  retailPrice: number;
  /** Set once the seller types a price by hand. */
  priceEdited: boolean;
};

/**
 * Re-price a cart after the buyer changes.
 *
 * The wizard asks for items BEFORE it asks who they're for, so by the time a
 * shop is picked the cart is already full of RRP. Repricing then is the whole
 * point — but a price the seller typed themselves is a decision, not a default,
 * so an edited line is left exactly as it is.
 */
export function repriceCart<T extends RepricableLine>(lines: T[], list: PriceList | null): T[] {
  return lines.map((line) => {
    if (line.priceEdited) return line;
    const { unitPrice } = priceFor(line.variantId, line.retailPrice, list);
    return unitPrice === line.unitPrice ? line : { ...line, unitPrice };
  });
}
