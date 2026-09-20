import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { PriceList } from "@/lib/sales/pricing";

// Shared reader for the sales tab. Every sub-tab wants the same shape — an
// order with its lines, its money and its sync state — so it is assembled once
// here rather than re-derived per page.
//
// Supabase's nested selects are avoided for the line side on purpose: `sales`
// rows predate `sale_orders` (markets, Shopify imports, raffles) and must keep
// loading even when they belong to no order at all.

export type SaleOrderLineView = {
  saleId: string;
  variantId: string | null;
  productName: string;
  sku: string;
  size: string | null;
  color: string | null;
  imageUrl: string | null;
  quantity: number;
  /** Before the line's share of the order discount. */
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  isFreebie: boolean;
  /** Set once the shop has sold this piece off its rail. Consignations only. */
  soldAt: string | null;
  notionPageId: string | null;
  notionError: string | null;
};

export type SaleOrderView = {
  id: string;
  reference: string;
  kind: "sale" | "consignment";
  channel: string;
  customerName: string | null;
  retailerId: string | null;
  retailerName: string | null;
  retailerEmail: string | null;
  whereSold: string | null;
  paymentStatus: "paid" | "pending";
  paymentMethod: string | null;
  discountKind: string | null;
  discountValue: number;
  notes: string | null;
  shopifyOrderName: string | null;
  settledAt: string | null;
  createdAt: string;
  lines: SaleOrderLineView[];
  units: number;
  gross: number;
  discount: number;
  net: number;
  unsyncedNotion: number;
  /** Pieces the shop has already sold, on a consignation. */
  soldUnits: number;
  /**
   * What is actually OWED right now. For a consignation that is the sold
   * pieces only — the rest is stock on loan, which the shop can hand back.
   * For anything else the whole order is owed once it is pending.
   */
  owed: number;
};

type OrderRow = {
  id: string;
  reference: string;
  kind: string;
  channel: string;
  retailer_id: string | null;
  customer_name: string | null;
  where_sold: string | null;
  payment_status: string;
  payment_method: string | null;
  discount_kind: string | null;
  discount_value: number;
  notes: string | null;
  shopify_order_name: string | null;
  settled_at: string | null;
  created_at: string;
};

/** Reports a missing migration 009 as "no orders" rather than a crashed page. */
function isMissingOrdersTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42P01 = undefined_table; PostgREST answers PGRST205 for an unknown
  // relation. The message check is a belt-and-braces for a PostgREST version
  // that words it differently — it deliberately does NOT match any error that
  // merely mentions the table, so a real failure still surfaces.
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /could not find the table.*sale_orders/i.test(error.message ?? "")
  );
}

type LoadOptions = {
  kind?: "sale" | "consignment";
  limit?: number;
  /** Only orders still awaiting payment. */
  pendingOnly?: boolean;
  /** Just this one order, with its lines assembled the same way. */
  id?: string;
};

export async function loadSaleOrders(options: LoadOptions = {}): Promise<SaleOrderView[]> {
  const supabase = await createClient();

  let query = supabase
    .from("sale_orders")
    .select(
      "id, reference, kind, channel, retailer_id, customer_name, where_sold, payment_status, payment_method, discount_kind, discount_value, notes, shopify_order_name, settled_at, created_at",
    )
    .order("created_at", { ascending: false });

  if (options.id) query = query.eq("id", options.id);
  if (options.kind) query = query.eq("kind", options.kind);
  if (options.pendingOnly) query = query.eq("payment_status", "pending");
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) {
    if (isMissingOrdersTable(error)) return [];
    throw new Error(error.message);
  }

  const orders = (data ?? []) as OrderRow[];
  if (!orders.length) return [];

  const [{ data: saleRows }, { data: retailers }] = await Promise.all([
    supabase
      .from("sales")
      .select(
        "id, sale_order_id, variant_id, quantity, gross_amount, discount_amount, net_amount, is_freebie, consignment_sold_at, notion_page_id, notion_error",
      )
      .in("sale_order_id", orders.map((o) => o.id)),
    (async () => {
      const ids = [...new Set(orders.map((o) => o.retailer_id).filter(Boolean))] as string[];
      if (!ids.length) return { data: [] };
      return supabase.from("retailers").select("id, name, contact_email").in("id", ids);
    })(),
  ]);

  const variantIds = [...new Set((saleRows ?? []).map((s) => s.variant_id).filter(Boolean))] as string[];
  const { data: variants } = variantIds.length
    ? await supabase
        .from("variants")
        .select("id, product_id, sku, size, color")
        .in("id", variantIds)
    : { data: [] };

  const productIds = [...new Set((variants ?? []).map((v) => v.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name, image_url").in("id", productIds)
    : { data: [] };

  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const variantById = new Map((variants ?? []).map((v) => [v.id, v]));
  const retailerById = new Map((retailers ?? []).map((r) => [r.id, r]));

  const linesByOrder = new Map<string, SaleOrderLineView[]>();
  for (const s of saleRows ?? []) {
    if (!s.sale_order_id) continue;
    const variant = s.variant_id ? variantById.get(s.variant_id) : undefined;
    const product = variant ? productById.get(variant.product_id) : undefined;
    const list = linesByOrder.get(s.sale_order_id) ?? [];
    list.push({
      saleId: s.id,
      variantId: s.variant_id,
      productName: product?.name ?? "Unknown product",
      sku: variant?.sku ?? "—",
      size: variant?.size ?? null,
      color: variant?.color ?? null,
      imageUrl: product?.image_url ?? null,
      quantity: s.quantity,
      grossAmount: Number(s.gross_amount),
      discountAmount: Number(s.discount_amount),
      netAmount: Number(s.net_amount),
      isFreebie: Boolean(s.is_freebie),
      soldAt: s.consignment_sold_at,
      notionPageId: s.notion_page_id,
      notionError: s.notion_error,
    });
    linesByOrder.set(s.sale_order_id, list);
  }

  return orders.map((o) => {
    const lines = (linesByOrder.get(o.id) ?? []).sort((a, b) =>
      a.productName.localeCompare(b.productName),
    );
    const retailer = o.retailer_id ? retailerById.get(o.retailer_id) : undefined;
    return {
      id: o.id,
      reference: o.reference,
      kind: o.kind === "consignment" ? "consignment" : "sale",
      channel: o.channel,
      customerName: o.customer_name,
      retailerId: o.retailer_id,
      retailerName: retailer?.name ?? null,
      retailerEmail: retailer?.contact_email ?? null,
      whereSold: o.where_sold,
      paymentStatus: o.payment_status === "pending" ? "pending" : "paid",
      paymentMethod: o.payment_method,
      discountKind: o.discount_kind,
      discountValue: Number(o.discount_value),
      notes: o.notes,
      shopifyOrderName: o.shopify_order_name,
      settledAt: o.settled_at,
      createdAt: o.created_at,
      lines,
      units: lines.reduce((n, l) => n + l.quantity, 0),
      gross: lines.reduce((n, l) => n + l.grossAmount, 0),
      discount: lines.reduce((n, l) => n + l.discountAmount, 0),
      net: lines.reduce((n, l) => n + l.netAmount, 0),
      unsyncedNotion: lines.filter((l) => !l.notionPageId).length,
      soldUnits: lines.filter((l) => l.soldAt).reduce((n, l) => n + l.quantity, 0),
      owed:
        o.payment_status !== "pending"
          ? 0
          : o.kind === "consignment"
            ? lines.filter((l) => l.soldAt).reduce((n, l) => n + l.netAmount, 0)
            : lines.reduce((n, l) => n + l.netAmount, 0),
    };
  });
}

export async function loadSaleOrder(id: string): Promise<SaleOrderView | null> {
  const [order] = await loadSaleOrders({ id });
  return order ?? null;
}

// ---------------------------------------------------------------------------
// Dashboard headline numbers
// ---------------------------------------------------------------------------

export type SalesTotals = {
  todayNet: number;
  monthNet: number;
  monthUnits: number;
  /** Money sitting with shops: consignations not yet settled. */
  outstanding: number;
  outstandingOrders: number;
  unsyncedNotion: number;
};

export async function loadSalesTotals(): Promise<SalesTotals> {
  const supabase = await createClient();

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [{ data: monthSales }, unsyncedCount, pendingOrders] = await Promise.all([
    supabase
      .from("sales")
      .select("quantity, net_amount, sold_at")
      .gte("sold_at", startOfMonth),
    // Only lines that BELONG TO AN ORDER, because the banner this feeds tells
    // you to open the order and press Retry — and that button only exists on an
    // order. Counting every unmirrored row would permanently show the hundreds
    // of imported Shopify sales that were never meant to go to Notion, which is
    // a number nobody can act on.
    (async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id")
        .is("notion_page_id", null)
        .not("sale_order_id", "is", null);
      // Pre-migration-009 the column isn't there; nothing has an order yet either.
      if (error) return 0;
      return (data ?? []).length;
    })(),
    loadSaleOrders({ pendingOnly: true }),
  ]);

  const rows = monthSales ?? [];
  return {
    todayNet: rows
      .filter((s) => s.sold_at >= startOfDay)
      .reduce((n, s) => n + Number(s.net_amount), 0),
    monthNet: rows.reduce((n, s) => n + Number(s.net_amount), 0),
    monthUnits: rows.reduce((n, s) => n + s.quantity, 0),
    outstanding: pendingOrders.reduce((n, o) => n + o.owed, 0),
    outstandingOrders: pendingOrders.length,
    unsyncedNotion: unsyncedCount,
  };
}

export type LooseSaleView = {
  id: string;
  channel: string;
  quantity: number;
  grossAmount: number;
  discountAmount: number;
  /** Payment-processing fees. Nothing writes this yet — see loadLooseSales. */
  feesAmount: number;
  shippingAmount: number;
  netAmount: number;
  /** Net per garment — what the row actually went for, whatever the quantity. */
  unitPrice: number;
  customerRef: string | null;
  paymentMethod: string | null;
  soldAt: string;
  notes: string | null;
  /** One-line description, still used where there's no room for the parts. */
  label: string;
  productName: string | null;
  sku: string | null;
  size: string | null;
  color: string | null;
  imageUrl: string | null;
  isFreebie: boolean;
  /** True for a row that is part of an unpaid consigned batch. */
  isConsignment: boolean;
  /** Which market, for a till row — "Feira da Ladra" beats "market". */
  marketEvent: string | null;
  /** Where it physically happened: the venue, "Online", or the buyer. */
  location: string | null;
  shopifyOrderId: string | null;
  /** The digits off the end of the Shopify GID — see loadLooseSales. */
  shopifyOrderNumber: string | null;
  shopifyAdminUrl: string | null;
  notionSynced: boolean;
  notionError: string | null;
};

/**
 * Sales that belong to no order — market tills, Shopify imports, raffle rows,
 * and anything logged before migration 009.
 *
 * The `sale_order_id` filter is retried without it when the column doesn't
 * exist yet, mirroring how lib/market/record-sale.ts handles the pre-008
 * signature: the page should still render on a database that hasn't been
 * migrated, showing every sale rather than none.
 */
export async function loadLooseSales(limit = 500): Promise<LooseSaleView[]> {
  const supabase = await createClient();

  // The legacy set is what a pre-007 database can answer; the rest came with
  // markets (007) and orders (009). Kept split so one missing column degrades
  // the table to fewer columns rather than to an error page.
  const LEGACY = "id, channel, variant_id, quantity, net_amount, customer_ref, sold_at, notes";
  const FULL =
    `${LEGACY}, gross_amount, discount_amount, fees_amount, shipping_amount, ` +
    "payment_method, is_freebie, market_event_id, shopify_order_id, " +
    "notion_page_id, notion_error";

  type Row = Record<string, unknown>;
  async function read(columns: string, withOrderFilter: boolean) {
    const q = supabase.from("sales").select(columns);
    return (withOrderFilter ? q.is("sale_order_id", null) : q)
      .order("sold_at", { ascending: false })
      .limit(limit);
  }

  // 42703 = undefined_column; PostgREST reports PGRST204 for the same thing.
  const undefinedColumn = (e: { code?: string } | null) =>
    e?.code === "42703" || e?.code === "PGRST204";

  let { data, error } = await read(FULL, true);
  if (undefinedColumn(error)) ({ data, error } = await read(FULL, false));
  if (undefinedColumn(error)) ({ data, error } = await read(LEGACY, true));
  if (undefinedColumn(error)) ({ data, error } = await read(LEGACY, false));
  if (error) throw new Error(error.message);

  // The column list is built at runtime, so supabase-js can't type the rows;
  // they are read back field by field below.
  const rows = (data ?? []) as unknown as Row[];
  const variantIds = [...new Set(rows.map((s) => s.variant_id).filter(Boolean))] as string[];
  const { data: variants } = variantIds.length
    ? await supabase.from("variants").select("id, sku, size, color, product_id").in("id", variantIds)
    : { data: [] };
  const productIds = [...new Set((variants ?? []).map((v) => v.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name, image_url").in("id", productIds)
    : { data: [] };

  // A till row says "market"; the event says WHICH market, which is the thing
  // you are actually scanning for.
  const eventIds = [...new Set(rows.map((s) => s.market_event_id).filter(Boolean))] as string[];
  const { data: events } = eventIds.length
    ? await supabase.from("market_events").select("id, name, venue").in("id", eventIds)
    : { data: [] };
  const eventById = new Map((events ?? []).map((e) => [e.id, e]));

  // The order NUMBER (#1055) is what the importer already parks in
  // customer_ref — Shopify's customer fields are plan-gated, so that column
  // carries the order name on a Shopify row and a real buyer on every other.
  // The GID's trailing digits are a separate thing: the admin URL wants those.
  const shopDomain = process.env.SHOPIFY_STORE_DOMAIN ?? null;

  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const variantById = new Map((variants ?? []).map((v) => [v.id, v]));

  return rows.map((s) => {
    const v = s.variant_id ? variantById.get(s.variant_id as string) : undefined;
    const product = v ? productById.get(v.product_id) : undefined;
    const attrs = v ? [v.size, v.color].filter(Boolean).join(" / ") : "";
    const quantity = Number(s.quantity ?? 0);
    const netAmount = Number(s.net_amount ?? 0);
    const event = s.market_event_id ? eventById.get(s.market_event_id as string) : undefined;
    const customerRef = (s.customer_ref as string) || null;
    const fromShopify = Boolean(s.shopify_order_id);
    const orderId = ((s.shopify_order_id as string) ?? "").split("/").pop() || null;

    return {
      id: s.id as string,
      channel: s.channel as string,
      quantity,
      grossAmount: Number(s.gross_amount ?? netAmount),
      discountAmount: Number(s.discount_amount ?? 0),
      feesAmount: Number(s.fees_amount ?? 0),
      shippingAmount: Number(s.shipping_amount ?? 0),
      netAmount,
      unitPrice: quantity > 0 ? Math.round((netAmount / quantity) * 100) / 100 : netAmount,
      // On a Shopify row this column holds the order number, not a person, so
      // it is reported as the order and left out of Customer rather than
      // showing "#1055" under a heading that promises a buyer.
      customerRef: fromShopify ? null : customerRef,
      paymentMethod: (s.payment_method as string) ?? null,
      soldAt: s.sold_at as string,
      notes: (s.notes as string) ?? null,
      // Raffle rows have no variant — show what was actually sold.
      label: v
        ? `${product?.name ?? "?"} — ${v.sku}${attrs ? ` (${attrs})` : ""}`
        : ((s.notes as string) ?? (s.customer_ref as string) ?? "—"),
      productName: product?.name ?? null,
      sku: v?.sku ?? null,
      size: v?.size ?? null,
      color: v?.color ?? null,
      imageUrl: product?.image_url ?? null,
      isFreebie: Boolean(s.is_freebie),
      isConsignment: (s.payment_method as string) === "Consignation",
      marketEvent: event?.name ?? null,
      // A market says where it stood, Shopify is by definition online, and
      // anything else falls back to who it was sold to.
      location:
        event?.venue ??
        event?.name ??
        (s.channel === "shopify" ? "Online" : null) ??
        (fromShopify ? null : customerRef),
      shopifyOrderId: (s.shopify_order_id as string) ?? null,
      shopifyOrderNumber: fromShopify ? (customerRef ?? orderId) : null,
      shopifyAdminUrl:
        shopDomain && orderId ? `https://${shopDomain}/admin/orders/${orderId}` : null,
      notionSynced: Boolean(s.notion_page_id),
      notionError: (s.notion_error as string) ?? null,
    };
  });
}

/** The wholesale customer book — retailers, newest-used first. */
export async function loadCustomers(): Promise<
  Array<{ id: string; name: string; email: string | null; location: string | null }>
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("retailers")
    .select("id, name, contact_email, location")
    .order("name");
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.contact_email,
    location: r.location,
  }));
}

/**
 * Each shop's agreed prices, keyed by retailer id.
 *
 * Loaded whole and up front, like the rest of the till: the wizard is pure
 * client state once it's on screen, because at a market the network is the
 * slowest part of the machine and picking a customer must not wait on a fetch.
 * It stays small — a few sheets of a few dozen variants.
 *
 * A shop can hold more than one sheet (SS26, then AW26). The newest wins, and
 * the wizard shows its name, so the one in force is visible rather than
 * guessed at.
 */
export async function loadPriceLists(): Promise<Record<string, PriceList>> {
  const supabase = await createClient();

  const { data: catalogs } = await supabase
    .from("catalogs")
    .select("id, name, retailer_id")
    .not("retailer_id", "is", null)
    .order("created_at", { ascending: false });
  if (!catalogs?.length) return {};

  // Newest first, so the first sheet seen for a retailer is the one that counts.
  const sheetByRetailer = new Map<string, { id: string; name: string }>();
  for (const c of catalogs) {
    if (c.retailer_id && !sheetByRetailer.has(c.retailer_id)) {
      sheetByRetailer.set(c.retailer_id, { id: c.id, name: c.name });
    }
  }

  const { data: items } = await supabase
    .from("catalog_items")
    .select("catalog_id, variant_id, wholesale_price")
    .in("catalog_id", [...sheetByRetailer.values()].map((s) => s.id));

  const lists: Record<string, PriceList> = {};
  for (const [retailerId, sheet] of sheetByRetailer) {
    const prices: Record<string, number> = {};
    for (const item of items ?? []) {
      // A row with no price is a pitch line nobody agreed a rate for yet; it
      // has to fall through to RRP rather than land in the cart as €0.
      if (item.catalog_id !== sheet.id || item.wholesale_price == null) continue;
      prices[item.variant_id] = Number(item.wholesale_price);
    }
    lists[retailerId] = { catalogId: sheet.id, name: sheet.name, prices };
  }
  return lists;
}
