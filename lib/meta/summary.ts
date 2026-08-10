import "server-only";

import { createClient } from "@/lib/supabase/server";
import { checkConnection, isMetaConfigured, type MetaConnection } from "./client";
import { accountFunnel, deliveryDays, type AccountFunnel } from "./monitor";
import { attributeOrders, type Attribution, type OrderPoint } from "./attribution";

// The one place that merges the ad account with the shop's own books.
//
// Both the Ad budget page and the home page need the same core answer — what
// was spent, what came back, and what an order is worth — so it is computed
// once here rather than assembled twice and drifting apart.

export type ShopEconomics = {
  orders: OrderPoint[];
  revenue: number;
  cogs: number;
  contribution: number;
  contributionPerOrder: number;
  marginPct: number;
  /** Share of sold units that have a production cost recorded, 0-1. */
  costCoverage: number;
  knownCosts: boolean;
};

export type AdsSummary = {
  configured: boolean;
  error: string | null;
  connection: MetaConnection | null;
  funnel: AccountFunnel | null;
  attribution: Attribution | null;
  shop: ShopEconomics;
  /** Contribution per order — the ceiling on what an order may cost. */
  breakEvenCpa: number;
  /** Meta-claimed purchases. Known to under-count. */
  metaPurchases: number;
};

/** Online orders, rolled up from line items, with costs applied. */
export async function getShopEconomics(): Promise<ShopEconomics> {
  const supabase = await createClient();
  const [{ data: sales }, { data: variants }] = await Promise.all([
    supabase
      .from("sales")
      .select("shopify_order_id, quantity, net_amount, variant_id, sold_at")
      .eq("channel", "shopify"),
    supabase.from("variants").select("id, production_cost"),
  ]);

  const costByVariant = new Map(
    (variants ?? []).map((v) => [v.id, Number(v.production_cost ?? 0)]),
  );

  const grouped = new Map<string, { date: string; net: number; units: number; cogs: number }>();
  let unitsTotal = 0;
  let unitsCosted = 0;

  for (const s of sales ?? []) {
    const key = s.shopify_order_id ?? `line:${grouped.size}`;
    const date = s.sold_at.slice(0, 10);
    const o = grouped.get(key) ?? { date, net: 0, units: 0, cogs: 0 };
    const cost = costByVariant.get(s.variant_id ?? "") ?? 0;
    o.net += Number(s.net_amount ?? 0);
    o.units += s.quantity;
    o.cogs += cost * s.quantity;
    // An order spanning midnight takes its earliest line's date.
    if (date < o.date) o.date = date;
    grouped.set(key, o);

    unitsTotal += s.quantity;
    if (cost > 0) unitsCosted += s.quantity;
  }

  const list = [...grouped.values()];
  const revenue = list.reduce((s, o) => s + o.net, 0);
  const cogs = list.reduce((s, o) => s + o.cogs, 0);
  const contribution = revenue - cogs;

  return {
    orders: list.map((o) => ({ date: o.date, net: o.net, units: o.units })),
    revenue,
    cogs,
    contribution,
    contributionPerOrder: list.length ? contribution / list.length : 0,
    marginPct: revenue > 0 ? (contribution / revenue) * 100 : 0,
    costCoverage: unitsTotal > 0 ? unitsCosted / unitsTotal : 0,
    knownCosts: unitsCosted > 0,
  };
}

export async function getAdsSummary(): Promise<AdsSummary> {
  const shop = await getShopEconomics();
  const breakEvenCpa = shop.contributionPerOrder;

  if (!isMetaConfigured()) {
    return {
      configured: false,
      error: null,
      connection: null,
      funnel: null,
      attribution: null,
      shop,
      breakEvenCpa,
      metaPurchases: 0,
    };
  }

  try {
    const [connection, funnel, days] = await Promise.all([
      checkConnection(),
      accountFunnel("maximum"),
      deliveryDays("maximum"),
    ]);

    const metaPurchases = funnel.steps.find((s) => s.key === "purchase")?.count ?? 0;
    const attribution = attributeOrders(days, shop.orders, metaPurchases, funnel.revenue);

    return {
      configured: true,
      error: null,
      connection,
      funnel,
      attribution,
      shop,
      breakEvenCpa,
      metaPurchases,
    };
  } catch (e) {
    return {
      configured: true,
      error: e instanceof Error ? e.message : String(e),
      connection: null,
      funnel: null,
      attribution: null,
      shop,
      breakEvenCpa,
      metaPurchases: 0,
    };
  }
}
