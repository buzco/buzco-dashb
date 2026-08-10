import "server-only";

import { adAccountId, metaGet, metaGetAll } from "./client";
import type { DeliveryDay } from "./attribution";

// Reading whether a live campaign has gone cold.
//
// "Cold" is not one thing, and the distinction matters because the fixes are
// opposites. A campaign that never worked needs killing; one that worked and
// stopped needs new creative; one that is merely expensive today might just be
// a bad Tuesday. So this compares a recent window against the flight's own
// earlier days rather than against any industry benchmark, and every threshold
// is expressed in the brand's own break-even numbers.
//
// Nothing here changes anything. It returns a diagnosis and a recommendation;
// acting on it is a separate, deliberate call.

// Meta reports ONE conversion under many alias action types at once, and they
// all carry the same value. This account's insights return eight names for the
// same three purchases — purchase, omni_purchase, onsite_web_purchase,
// offsite_conversion.fb_pixel_purchase, web_in_store_purchase and more, each
// reading "3". Summing a set of aliases therefore multiplies the result by
// however many aliases happen to be present, which silently turned 3 purchases
// into 9 and a 1.23× ROAS into 3.68×.
//
// So: sum each alias across days, then take the LARGEST alias — never the sum
// across aliases. Which aliases appear varies with pixel and CAPI setup, so the
// list is generous; taking the max makes extra entries harmless. (One oddity
// seen live: web_app_in_store_purchase reports a value of 0.02 against the same
// three purchases, so max protects against low outliers too.)

const PURCHASE_ALIASES = [
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_web_purchase",
  "onsite_web_app_purchase",
  "web_in_store_purchase",
  "web_app_in_store_purchase",
];

const ADD_TO_CART_ALIASES = [
  "add_to_cart",
  "omni_add_to_cart",
  "offsite_conversion.fb_pixel_add_to_cart",
  "onsite_web_add_to_cart",
  "onsite_web_app_add_to_cart",
];

const LANDING_PAGE_VIEW_ALIASES = ["landing_page_view", "omni_landing_page_view"];

const VIEW_CONTENT_ALIASES = [
  "view_content",
  "omni_view_content",
  "offsite_conversion.fb_pixel_view_content",
  "onsite_web_view_content",
  "onsite_web_app_view_content",
];

const CHECKOUT_ALIASES = [
  "initiate_checkout",
  "omni_initiated_checkout",
  "offsite_conversion.fb_pixel_initiate_checkout",
  "onsite_web_initiate_checkout",
];

const PAYMENT_INFO_ALIASES = ["add_payment_info", "offsite_conversion.fb_pixel_add_payment_info"];

type InsightRow = {
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  /** Clicks on the ad's link only. `clicks` also counts likes, profile taps and image expands. */
  inline_link_clicks?: string;
  ctr?: string;
  cpm?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
};

const num = (v: string | undefined) => (v ? Number(v) || 0 : 0);

/**
 * Total for a conversion, counted once. Sums each alias over the day rows, then
 * returns the largest alias total — see the note above on why summing across
 * aliases triples the answer.
 */
function aliasTotal(
  rows: InsightRow[],
  aliases: string[],
  field: "actions" | "action_values",
): number {
  let best = 0;
  for (const alias of aliases) {
    let total = 0;
    for (const row of rows) {
      for (const a of row[field] ?? []) {
        if (a.action_type === alias) total += Number(a.value) || 0;
      }
    }
    if (total > best) best = total;
  }
  return best;
}

export type WindowStats = {
  days: number;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  revenue: number;
  addToCarts: number;
  landingPageViews: number;
  /** Cost per purchase. 0 when there were none. */
  cpa: number;
  roas: number;
  ctr: number;
  cpm: number;
  frequency: number;
};

function summarise(rows: InsightRow[]): WindowStats {
  const spend = rows.reduce((s, r) => s + num(r.spend), 0);
  const impressions = rows.reduce((s, r) => s + num(r.impressions), 0);
  const clicks = rows.reduce((s, r) => s + num(r.clicks), 0);
  const purchases = aliasTotal(rows, PURCHASE_ALIASES, "actions");
  const revenue = aliasTotal(rows, PURCHASE_ALIASES, "action_values");
  const addToCarts = aliasTotal(rows, ADD_TO_CART_ALIASES, "actions");
  const landingPageViews = aliasTotal(rows, LANDING_PAGE_VIEW_ALIASES, "actions");

  // Frequency can't be summed across days — impressions per person is only
  // meaningful over the whole window, so take the highest daily reading as the
  // fatigue signal rather than inventing an average.
  const frequency = rows.reduce((m, r) => Math.max(m, num(r.frequency)), 0);

  return {
    days: rows.length,
    spend,
    impressions,
    clicks,
    purchases,
    revenue,
    addToCarts,
    landingPageViews,
    cpa: purchases > 0 ? spend / purchases : 0,
    roas: spend > 0 ? revenue / spend : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    frequency,
  };
}

export type Verdict = "healthy" | "watch" | "cooling" | "cold" | "kill";

export type Diagnosis = {
  campaignId: string;
  name: string;
  status: string;
  effectiveStatus: string;
  verdict: Verdict;
  headline: string;
  reasons: string[];
  /** What to do about it. Never applied automatically. */
  recommendation: string;
  overall: WindowStats;
  recent: WindowStats;
  earlier: WindowStats;
  breakEvenCpa: number;
};

const eur = (n: number) =>
  (n < 0 ? "−€" : "€") +
  Math.abs(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type CampaignRef = {
  id: string;
  name: string;
  status: string;
  effective_status: string;
};

/** Campaigns on the account, newest first. */
export async function listCampaigns(limit = 50): Promise<CampaignRef[]> {
  const rows = await metaGetAll<CampaignRef & { created_time: string }>(
    `${adAccountId()}/campaigns`,
    { fields: "id,name,status,effective_status,created_time" },
  );
  return rows
    .sort((a, b) => (a.created_time < b.created_time ? 1 : -1))
    .slice(0, limit)
    .map(({ id, name, status, effective_status }) => ({ id, name, status, effective_status }));
}

/**
 * Diagnose one campaign.
 *
 * @param breakEvenCpa Contribution per order — the most an order may cost
 *   before the spend is buying losses. Everything below is judged against it,
 *   because a €30 CPA is excellent on a €90 basket and ruinous on a €25 one.
 * @param recentDays Size of the "now" window. Two days is the shortest that
 *   isn't mostly noise on a small account.
 */
export async function diagnoseCampaign(
  campaign: CampaignRef,
  breakEvenCpa: number,
  recentDays = 2,
): Promise<Diagnosis> {
  const rows = await metaGetAll<InsightRow>(`${campaign.id}/insights`, {
    fields: "spend,impressions,reach,frequency,clicks,ctr,cpm,actions,action_values",
    time_increment: "1",
    date_preset: "maximum",
  });

  const ordered = [...rows].sort((a, b) => (a.date_start < b.date_start ? -1 : 1));
  const recentRows = ordered.slice(-recentDays);
  const earlierRows = ordered.slice(0, Math.max(0, ordered.length - recentDays));

  const overall = summarise(ordered);
  const recent = summarise(recentRows);
  const earlier = summarise(earlierRows);

  const reasons: string[] = [];
  let verdict: Verdict = "healthy";
  const escalate = (v: Verdict) => {
    const order: Verdict[] = ["healthy", "watch", "cooling", "cold", "kill"];
    if (order.indexOf(v) > order.indexOf(verdict)) verdict = v;
  };

  // ---- Never worked: the kill rule, in their numbers --------------------
  if (overall.purchases === 0 && overall.spend >= breakEvenCpa * 1.5) {
    escalate("kill");
    reasons.push(
      `Spent ${eur(overall.spend)} with no purchases — past the ${eur(breakEvenCpa * 1.5)} kill ` +
        `threshold (1.5× break-even CPA). Campaigns this far in without a sale very rarely recover.`,
    );
  } else if (overall.purchases === 0 && overall.spend > 0) {
    escalate("watch");
    reasons.push(
      `No purchases yet on ${eur(overall.spend)} spent. Kill threshold is ${eur(breakEvenCpa * 1.5)}.`,
    );
  }

  // ---- Worked, then stopped --------------------------------------------
  if (earlier.purchases > 0 && recent.purchases === 0 && recent.spend > breakEvenCpa) {
    escalate("cold");
    reasons.push(
      `Bought ${earlier.purchases.toFixed(0)} orders earlier in the flight, then nothing in the ` +
        `last ${recent.days} day(s) on ${eur(recent.spend)}. That is a stall, not a slow patch.`,
    );
  }

  if (recent.cpa > 0 && earlier.cpa > 0) {
    const drift = (recent.cpa - earlier.cpa) / earlier.cpa;
    if (recent.cpa > breakEvenCpa) {
      escalate(drift > 0.25 ? "cold" : "cooling");
      reasons.push(
        `Cost per purchase is ${eur(recent.cpa)} in the last ${recent.days} day(s) against a ` +
          `break-even of ${eur(breakEvenCpa)} — every order at this price is losing money.`,
      );
    } else if (drift > 0.4) {
      escalate("cooling");
      reasons.push(
        `Cost per purchase rose ${(drift * 100).toFixed(0)}% (${eur(earlier.cpa)} → ` +
          `${eur(recent.cpa)}) but is still under break-even.`,
      );
    }
  }

  // ---- Lifetime economics, independent of the recent window -------------
  // The drift checks below compare recent against earlier, so they go quiet
  // the moment a campaign stops spending — which handed a paused campaign
  // sitting at a €54 CPA against a €37 break-even a clean "healthy". Whether
  // an ad set ever made money is a fact about its whole life, not about the
  // last two days, so it is judged separately.
  if (overall.purchases > 0 && overall.cpa > breakEvenCpa) {
    escalate(overall.cpa > breakEvenCpa * 1.5 ? "cold" : "cooling");
    reasons.push(
      `Lifetime cost per purchase is ${eur(overall.cpa)} against a break-even of ` +
        `${eur(breakEvenCpa)} — over its whole life this campaign has bought ` +
        `${overall.purchases.toFixed(0)} orders for ${eur(overall.spend)} and returned ` +
        `${eur(overall.revenue)}. It is losing money per order, not just recently.`,
    );
  }

  // ---- Fatigue: the usual cause of a campaign going cold ----------------
  if (recent.frequency >= 2.5) {
    escalate(recent.frequency >= 4 ? "cold" : "cooling");
    reasons.push(
      `Frequency is ${recent.frequency.toFixed(1)} — the same people are seeing this repeatedly. ` +
        `Past about 2.5 on a short flight, results decay because the audience is used up, not ` +
        `because the offer got worse.`,
    );
  }

  if (earlier.ctr > 0 && recent.ctr > 0) {
    const decay = (earlier.ctr - recent.ctr) / earlier.ctr;
    if (decay > 0.3) {
      escalate("cooling");
      reasons.push(
        `Click-through fell ${(decay * 100).toFixed(0)}% (${earlier.ctr.toFixed(2)}% → ` +
          `${recent.ctr.toFixed(2)}%). Creative is wearing out.`,
      );
    }
  }

  if (earlier.cpm > 0 && recent.cpm > earlier.cpm * 1.4) {
    escalate("watch");
    reasons.push(
      `CPM up ${(((recent.cpm - earlier.cpm) / earlier.cpm) * 100).toFixed(0)}% ` +
        `(${eur(earlier.cpm)} → ${eur(recent.cpm)}) — you're buying a dearer slice of the audience.`,
    );
  }

  // ---- Traffic that doesn't buy ----------------------------------------
  if (overall.clicks > 100 && overall.purchases === 0 && overall.addToCarts === 0) {
    escalate("cold");
    reasons.push(
      `${overall.clicks.toFixed(0)} clicks and not one add-to-cart. The ads are working and the ` +
        `landing page isn't — check price, stock and load speed before touching targeting.`,
    );
  }

  // "Let it run", "pause it" and "don't scale it" all assume something is
  // actually delivering. Against a paused campaign they're nonsense.
  const delivering = campaign.effective_status === "ACTIVE";
  const recommendation = recommend(verdict, recent, breakEvenCpa, delivering);

  return {
    campaignId: campaign.id,
    name: campaign.name,
    status: campaign.status,
    effectiveStatus: campaign.effective_status,
    verdict,
    headline: HEADLINES[verdict],
    reasons,
    recommendation,
    overall,
    recent,
    earlier,
    breakEvenCpa,
  };
}

const HEADLINES: Record<Verdict, string> = {
  healthy: "Delivering within break-even",
  watch: "Nothing wrong yet — worth a look",
  cooling: "Declining, still salvageable",
  cold: "Gone cold",
  kill: "Past the kill threshold",
};

function recommend(
  verdict: Verdict,
  recent: WindowStats,
  breakEvenCpa: number,
  delivering: boolean,
): string {
  if (!delivering) {
    return verdict === "healthy"
      ? `Not delivering, and nothing in its history needs fixing. If you relaunch, reuse this ` +
          `structure rather than building a new one — it earned its numbers.`
      : `Not delivering, so there is nothing to stop. Fix what's above before relaunching; ` +
          `switching it back on as-is reproduces the same result.`;
  }

  switch (verdict) {
    case "kill":
      return (
        `Pause it. It has spent past 1.5× break-even without a sale, and the money spent so far is ` +
        `sunk either way — the only question is whether more follows it.`
      );
    case "cold":
      return recent.frequency >= 2.5
        ? `Pause and relaunch with genuinely new creative — not a recolour of this one. The audience ` +
            `has seen this at frequency ${recent.frequency.toFixed(1)}; more budget behind the same ` +
            `image buys the same people the same ad again.`
        : `Pause it and work out which half broke — ads or landing page. Restarting the same setup ` +
            `with more budget just re-buys the same result.`;
    case "cooling":
      return (
        `Don't scale it. Refresh creative now while it's still under control, and hold budget flat ` +
        `— a budget change here restarts learning on top of a decline. Kill it if cost per purchase ` +
        `passes ${eur(breakEvenCpa)}.`
      );
    case "watch":
      return `Leave it alone for now. Check again tomorrow; there isn't enough here to act on yet.`;
    case "healthy":
      return (
        `Let it run. If you scale, go in steps of about 20% every 3-4 days — bigger jumps re-enter ` +
        `the learning phase and lose the delivery you already paid for.`
      );
  }
}

/** Diagnose every campaign on the account that has spent anything. */
export async function diagnoseAll(breakEvenCpa: number, recentDays = 2): Promise<Diagnosis[]> {
  const campaigns = await listCampaigns();
  const out: Diagnosis[] = [];
  for (const c of campaigns) {
    // Sequential on purpose: Meta rate-limits insights per ad account hard,
    // and a burst of parallel calls is the quickest way to get throttled.
    out.push(await diagnoseCampaign(c, breakEvenCpa, recentDays));
  }
  const order: Verdict[] = ["kill", "cold", "cooling", "watch", "healthy"];
  return out.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict));
}

export type FunnelStep = {
  key: string;
  label: string;
  count: number;
  /** Share of the step above it, 0-100. Where the leak is. */
  passRate: number;
};

export type AccountFunnel = {
  spend: number;
  revenue: number;
  steps: FunnelStep[];
  /** Cost of one purchase, deduped. */
  cpa: number;
  costPerLinkClick: number;
  costPerAddToCart: number;
};

/**
 * The whole storefront funnel as Meta measured it, stage by stage.
 *
 * Uses inline_link_clicks rather than the `clicks` field: `clicks` counts every
 * click on the ad including likes, profile taps and image expands, so measuring
 * landing page views against it invents a leak that isn't there — on this
 * account it reads 583 vs 253, which would show a 65% drop-off that does not
 * exist.
 */
export async function accountFunnel(datePreset = "maximum"): Promise<AccountFunnel> {
  const res = await metaGet<{ data: InsightRow[] }>(`${adAccountId()}/insights`, {
    fields: "spend,impressions,clicks,inline_link_clicks,actions,action_values",
    date_preset: datePreset,
  });
  const rows = res.data ?? [];

  const spend = rows.reduce((s, r) => s + num(r.spend), 0);
  const impressions = rows.reduce((s, r) => s + num(r.impressions), 0);
  const linkClicks = rows.reduce((s, r) => s + num(r.inline_link_clicks), 0);
  const lpv = aliasTotal(rows, LANDING_PAGE_VIEW_ALIASES, "actions");
  const viewContent = aliasTotal(rows, VIEW_CONTENT_ALIASES, "actions");
  const atc = aliasTotal(rows, ADD_TO_CART_ALIASES, "actions");
  const checkout = aliasTotal(rows, CHECKOUT_ALIASES, "actions");
  const payment = aliasTotal(rows, PAYMENT_INFO_ALIASES, "actions");
  const purchases = aliasTotal(rows, PURCHASE_ALIASES, "actions");
  const revenue = aliasTotal(rows, PURCHASE_ALIASES, "action_values");

  const raw: Array<[string, string, number]> = [
    ["impressions", "Impressions", impressions],
    ["linkClicks", "Link clicks", linkClicks],
    ["landingPageViews", "Landing page views", lpv],
    ["viewContent", "Product views", viewContent],
    ["addToCart", "Add to cart", atc],
    ["checkout", "Checkout started", checkout],
    ["payment", "Payment info added", payment],
    ["purchase", "Purchases", purchases],
  ];

  const steps: FunnelStep[] = raw.map(([key, label, count], i) => {
    const above = i === 0 ? count : raw[i - 1][2];
    return { key, label, count, passRate: above > 0 ? (count / above) * 100 : 0 };
  });

  return {
    spend,
    revenue,
    steps,
    cpa: purchases > 0 ? spend / purchases : 0,
    costPerLinkClick: linkClicks > 0 ? spend / linkClicks : 0,
    costPerAddToCart: atc > 0 ? spend / atc : 0,
  };
}

export type CountryRow = {
  country: string;
  spend: number;
  impressions: number;
  linkClicks: number;
  landingPageViews: number;
  purchases: number;
};

/**
 * Where the money actually went, by country.
 *
 * Worth surfacing because it settles arguments about unexplained traffic: if a
 * country isn't in this list, Meta never sent anyone there, and whatever the
 * analytics tool is showing came from somewhere else.
 */
export async function spendByCountry(datePreset = "maximum"): Promise<CountryRow[]> {
  const rows = await metaGetAll<InsightRow & { country: string }>(`${adAccountId()}/insights`, {
    fields: "spend,impressions,inline_link_clicks,actions",
    breakdowns: "country",
    date_preset: datePreset,
  });

  const byCountry = new Map<string, Array<InsightRow & { country: string }>>();
  for (const r of rows) {
    const list = byCountry.get(r.country) ?? [];
    list.push(r);
    byCountry.set(r.country, list);
  }

  return [...byCountry.entries()]
    .map(([country, list]) => ({
      country,
      spend: list.reduce((s, r) => s + num(r.spend), 0),
      impressions: list.reduce((s, r) => s + num(r.impressions), 0),
      linkClicks: list.reduce((s, r) => s + num(r.inline_link_clicks), 0),
      landingPageViews: aliasTotal(list, LANDING_PAGE_VIEW_ALIASES, "actions"),
      purchases: aliasTotal(list, PURCHASE_ALIASES, "actions"),
    }))
    .filter((r) => r.impressions > 0)
    .sort((a, b) => b.spend - a.spend);
}

/**
 * Day-by-day spend, for matching real orders against the days ads ran.
 *
 * Days with no delivery are omitted by Meta rather than returned as zero, which
 * is exactly what the window builder wants — a gap in this list is a gap in
 * delivery.
 */
export async function deliveryDays(datePreset = "maximum"): Promise<DeliveryDay[]> {
  const rows = await metaGetAll<InsightRow>(`${adAccountId()}/insights`, {
    fields: "spend",
    time_increment: "1",
    date_preset: datePreset,
  });
  return rows
    .map((r) => ({ date: r.date_start, spend: num(r.spend) }))
    .filter((d) => d.spend > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Account-level spend for a period — the sanity check against the bank. */
export async function accountSpend(datePreset = "last_7d"): Promise<WindowStats> {
  const res = await metaGet<{ data: InsightRow[] }>(`${adAccountId()}/insights`, {
    fields: "spend,impressions,clicks,actions,action_values",
    date_preset: datePreset,
  });
  return summarise(res.data ?? []);
}
