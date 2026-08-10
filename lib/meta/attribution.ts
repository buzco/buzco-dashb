// Matching real Shopify orders to the days the ads actually delivered.
//
// This exists because the pixel demonstrably under-counts. On this account Meta
// claims 3 purchases while 8 orders landed inside the days the May campaign
// ran — iOS opt-outs, ad blockers and cookie consent all quietly drop
// conversions, and every one of them makes the ads look worse than they were.
//
// The naive correction is to credit every in-window order to the ads, and that
// overshoots just as badly in the other direction: a shop makes some sales
// regardless. So this computes three figures and shows all of them:
//
//   1. What Meta claims           — the floor, known to be under-counted
//   2. Every order in the window  — the ceiling, credits ads with organic sales
//   3. Lift over baseline         — the defensible middle
//
// Lift is the honest one: measure the order rate on days with no ads running,
// assume that rate continued during the campaign, and credit the ads only with
// the excess. It's still an estimate — a small shop's baseline is noisy, and
// this says so rather than hiding it behind a single confident number.
//
// Pure arithmetic, no credentials and no Graph calls, so it stays testable and
// can run in the browser like funnel.ts and burn.ts.

/** A day the account actually spent money. */
export type DeliveryDay = { date: string; spend: number };

/** One Shopify order, reduced to what attribution needs. */
export type OrderPoint = { date: string; net: number; units: number };

export type AdWindow = {
  /** First and last day money was spent. */
  start: string;
  end: string;
  /** Last day an order still counts, after the attribution tail. */
  tailEnd: string;
  spend: number;
  /** Days in the window including the tail. */
  days: number;
  orders: number;
  revenue: number;
};

export type Attribution = {
  windows: AdWindow[];
  adSpend: number;

  ordersInWindows: number;
  revenueInWindows: number;
  daysInWindows: number;

  /** Days in the observed period with no ads running, and what happened on them. */
  ordersOutside: number;
  revenueOutside: number;
  daysOutside: number;

  /** Orders per day when nothing was running. The counterfactual. */
  baselineOrdersPerDay: number;
  baselineRevenuePerDay: number;
  expectedOrganicOrders: number;
  expectedOrganicRevenue: number;

  /** In-window activity above what the baseline predicts. Can be negative. */
  liftOrders: number;
  liftRevenue: number;

  metaClaimedOrders: number;
  metaClaimedRevenue: number;

  /** Cost per order under each of the three readings. 0 when undefined. */
  cpaMetaClaimed: number;
  cpaInWindow: number;
  cpaLift: number;
  roasMetaClaimed: number;
  roasInWindow: number;
  roasLift: number;

  /** How much Meta appears to be under- (or over-) counting, as a multiple. */
  underCountFactor: number;

  /** True when there aren't enough quiet days to trust the baseline. */
  baselineIsThin: boolean;
  tailDays: number;
};

const day = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();

/**
 * Group delivery days into windows.
 *
 * Consecutive spending days become one window; a gap of more than `maxGap` days
 * starts a new one, because two flights a month apart are two experiments, not
 * one. Each window is then extended by `tailDays` — someone who clicks on the
 * last day of a campaign can still buy on the Tuesday after, and cutting the
 * window at the final impression would hand that order to "organic".
 */
export function buildWindows(
  deliveryDays: DeliveryDay[],
  tailDays = 3,
  maxGap = 2,
): Array<Omit<AdWindow, "orders" | "revenue">> {
  const spending = deliveryDays
    .filter((d) => d.spend > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!spending.length) return [];

  const windows: Array<Omit<AdWindow, "orders" | "revenue">> = [];
  let start = spending[0].date;
  let end = spending[0].date;
  let spend = spending[0].spend;

  const push = () => {
    const tailEnd = iso(ms(end) + tailDays * day);
    windows.push({
      start,
      end,
      tailEnd,
      spend,
      days: Math.round((ms(tailEnd) - ms(start)) / day) + 1,
    });
  };

  for (const d of spending.slice(1)) {
    const gap = Math.round((ms(d.date) - ms(end)) / day);
    if (gap > maxGap) {
      push();
      start = d.date;
      spend = 0;
    }
    end = d.date;
    spend += d.spend;
  }
  push();

  return windows;
}

export function attributeOrders(
  deliveryDays: DeliveryDay[],
  orders: OrderPoint[],
  metaClaimedOrders: number,
  metaClaimedRevenue: number,
  tailDays = 3,
): Attribution {
  const base = buildWindows(deliveryDays, tailDays);

  const inWindow = (date: string) =>
    base.some((w) => date >= w.start && date <= w.tailEnd);

  const windows: AdWindow[] = base.map((w) => {
    const matched = orders.filter((o) => o.date >= w.start && o.date <= w.tailEnd);
    return {
      ...w,
      orders: matched.length,
      revenue: matched.reduce((s, o) => s + o.net, 0),
    };
  });

  const adSpend = deliveryDays.reduce((s, d) => s + d.spend, 0);
  const ordersInWindows = windows.reduce((s, w) => s + w.orders, 0);
  const revenueInWindows = windows.reduce((s, w) => s + w.revenue, 0);
  const daysInWindows = windows.reduce((s, w) => s + w.days, 0);

  // The quiet period: everything from the first order or first ad day to the
  // last, minus the window days. Using the observed span rather than "all time"
  // keeps a shop that opened last month from being handed a year of zeroes.
  const dates = [...orders.map((o) => o.date), ...deliveryDays.map((d) => d.date)].sort();
  const spanDays = dates.length
    ? Math.round((ms(dates[dates.length - 1]) - ms(dates[0])) / day) + 1
    : 0;
  const daysOutside = Math.max(0, spanDays - daysInWindows);

  const outside = orders.filter((o) => !inWindow(o.date));
  const ordersOutside = outside.length;
  const revenueOutside = outside.reduce((s, o) => s + o.net, 0);

  const baselineOrdersPerDay = daysOutside > 0 ? ordersOutside / daysOutside : 0;
  const baselineRevenuePerDay = daysOutside > 0 ? revenueOutside / daysOutside : 0;
  const expectedOrganicOrders = baselineOrdersPerDay * daysInWindows;
  const expectedOrganicRevenue = baselineRevenuePerDay * daysInWindows;

  const liftOrders = ordersInWindows - expectedOrganicOrders;
  const liftRevenue = revenueInWindows - expectedOrganicRevenue;

  const div = (a: number, b: number) => (b > 0 ? a / b : 0);

  return {
    windows,
    adSpend,
    ordersInWindows,
    revenueInWindows,
    daysInWindows,
    ordersOutside,
    revenueOutside,
    daysOutside,
    baselineOrdersPerDay,
    baselineRevenuePerDay,
    expectedOrganicOrders,
    expectedOrganicRevenue,
    liftOrders,
    liftRevenue,
    metaClaimedOrders,
    metaClaimedRevenue,
    cpaMetaClaimed: div(adSpend, metaClaimedOrders),
    cpaInWindow: div(adSpend, ordersInWindows),
    cpaLift: div(adSpend, Math.max(0, liftOrders)),
    roasMetaClaimed: div(metaClaimedRevenue, adSpend),
    roasInWindow: div(revenueInWindows, adSpend),
    roasLift: div(Math.max(0, liftRevenue), adSpend),
    underCountFactor: div(ordersInWindows, metaClaimedOrders),
    // Fewer than a fortnight of quiet days makes the counterfactual guesswork.
    baselineIsThin: daysOutside < 14 || ordersOutside < 3,
    tailDays,
  };
}
