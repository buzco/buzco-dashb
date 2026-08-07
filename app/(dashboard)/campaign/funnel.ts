// The campaign model. Pure arithmetic, no React — so the numbers can be read,
// argued with, and reused without touching the UI.
//
// The shape is the standard paid-social funnel: money buys impressions at a
// CPM, some fraction of impressions get clicked, some fraction of clicks
// actually land, and some fraction of those land-ers buy. Each funnel stage
// runs that same chain with its own rates, because a stranger and someone who
// already viewed the product behave nothing alike.
//
// IMPORTANT — this model is linear: doubling spend doubles orders. Real
// campaigns don't do that. Once you exhaust the cheap, most-interested slice of
// an audience, CPMs climb and conversion rates fall. Treat the output as
// "what this budget is worth if delivery holds up", not a forecast, and re-run
// it with real numbers out of Ads Manager after a few days.

/** Meta needs roughly this many optimisation events per ad set per week to
 *  leave the learning phase and deliver stably. It is the single constraint
 *  that most often makes a small budget structurally unworkable. */
export const LEARNING_EVENTS_PER_WEEK = 50;

export type StageKey = "awareness" | "retargeting" | "conversion";

export type StageAssumptions = {
  /** Share of total budget, 0-100. */
  sharePct: number;
  /** € per 1000 impressions. */
  cpm: number;
  /** % of impressions that produce a link click. */
  ctr: number;
  /** % of landing page views that end in a purchase. */
  cvr: number;
  /** Average impressions served per person reached. */
  frequency: number;
};

export type CampaignInputs = {
  days: number;
  dailyBudget: number;
  /** % of link clicks that survive to a loaded landing page. */
  lpvRate: number;
  unitsPerOrder: number;
  /** € paid per new follower on the awareness stage. */
  costPerFollower: number;
  stages: Record<StageKey, StageAssumptions>;
};

export type UnitEconomics = {
  /** Selling price after any campaign discount. */
  revenuePerUnit: number;
  /** What's left per unit after COGS, shipping and payment fees. */
  contributionPerUnit: number;
  /** Units you can actually ship. Caps everything downstream. */
  availableStock: number;
};

export type StageResult = {
  key: StageKey;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  landingPageViews: number;
  orders: number;
  revenue: number;
  /** Cost per purchase for this stage alone. */
  cpa: number;
  ordersPerWeek: number;
  /** Daily spend this stage would need to clear the learning phase. */
  minDailyForLearning: number;
  exitsLearning: boolean;
};

export type Simulation = {
  totalBudget: number;
  stages: StageResult[];

  orders: number;
  /** Units the funnel would sell if stock were unlimited. */
  demandUnits: number;
  /** Units you can actually deliver — demand capped by stock. */
  soldUnits: number;
  stockLimited: boolean;
  /** Campaign day the shelf empties, if it does. */
  selloutDay: number | null;

  revenue: number;
  contribution: number;
  netProfit: number;

  aov: number;
  cpa: number;
  roas: number;
  breakEvenCpa: number;
  breakEvenRoas: number;
  /** Contribution margin as a share of revenue, 0-1. */
  margin: number;

  followers: number;
  reach: number;

  profitable: boolean;
  /** Most you could spend before stock runs out, at the projected CPA. */
  spendCeiling: number | null;
  /** Budget left burning after the shelf is empty. */
  wastedSpend: number;
};

const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

export function simulate(inputs: CampaignInputs, econ: UnitEconomics): Simulation {
  const days = Math.max(0, inputs.days);
  const totalBudget = Math.max(0, inputs.dailyBudget) * days;
  const unitsPerOrder = Math.max(0.01, inputs.unitsPerOrder);
  const lpvRate = Math.max(0, inputs.lpvRate) / 100;

  const aov = econ.revenuePerUnit * unitsPerOrder;
  const contributionPerOrder = econ.contributionPerUnit * unitsPerOrder;
  const margin = safeDiv(econ.contributionPerUnit, econ.revenuePerUnit);

  const keys: StageKey[] = ["awareness", "retargeting", "conversion"];
  const totalShare = keys.reduce((s, k) => s + Math.max(0, inputs.stages[k].sharePct), 0);

  const stages: StageResult[] = keys.map((key) => {
    const a = inputs.stages[key];
    // Normalise the split so it always sums to the budget, even mid-edit when
    // the three fields don't yet add to 100.
    const spend = totalBudget * safeDiv(Math.max(0, a.sharePct), totalShare);
    const impressions = safeDiv(spend, a.cpm) * 1000;
    const reach = safeDiv(impressions, Math.max(1, a.frequency));
    const clicks = impressions * (Math.max(0, a.ctr) / 100);
    const landingPageViews = clicks * lpvRate;
    const orders = landingPageViews * (Math.max(0, a.cvr) / 100);
    const ordersPerWeek = days > 0 ? (orders / days) * 7 : 0;
    const cpa = safeDiv(spend, orders);

    return {
      key,
      spend,
      impressions,
      reach,
      clicks,
      landingPageViews,
      orders,
      revenue: orders * aov,
      cpa,
      ordersPerWeek,
      minDailyForLearning: (LEARNING_EVENTS_PER_WEEK / 7) * cpa,
      exitsLearning: ordersPerWeek >= LEARNING_EVENTS_PER_WEEK,
    };
  });

  const orders = stages.reduce((s, r) => s + r.orders, 0);
  const demandUnits = orders * unitsPerOrder;

  // You cannot sell what you don't hold. Demand beyond stock produces no
  // revenue, and the budget aimed at it is simply burnt.
  const soldUnits = Math.min(demandUnits, Math.max(0, econ.availableStock));
  const stockLimited = demandUnits > econ.availableStock && econ.availableStock >= 0;
  const selloutDay =
    stockLimited && demandUnits > 0 ? Math.max(1, Math.ceil(days * (econ.availableStock / demandUnits))) : null;

  const revenue = soldUnits * econ.revenuePerUnit;
  const contribution = soldUnits * econ.contributionPerUnit;
  const netProfit = contribution - totalBudget;

  const cpa = safeDiv(totalBudget, orders);
  const roas = safeDiv(revenue, totalBudget);

  // Spending past the point the shelf empties buys nothing.
  const ordersStockAllows = safeDiv(Math.max(0, econ.availableStock), unitsPerOrder);
  const spendCeiling = orders > 0 ? ordersStockAllows * cpa : null;
  const wastedSpend =
    spendCeiling !== null && totalBudget > spendCeiling ? totalBudget - spendCeiling : 0;

  return {
    totalBudget,
    stages,
    orders,
    demandUnits,
    soldUnits,
    stockLimited,
    selloutDay,
    revenue,
    contribution,
    netProfit,
    aov,
    cpa,
    roas,
    breakEvenCpa: contributionPerOrder,
    breakEvenRoas: margin > 0 ? 1 / margin : 0,
    margin,
    followers: safeDiv(
      stages.find((s) => s.key === "awareness")?.spend ?? 0,
      Math.max(0.01, inputs.costPerFollower),
    ),
    reach: stages.reduce((s, r) => s + r.reach, 0),
    profitable: netProfit > 0,
    spendCeiling,
    wastedSpend,
  };
}

export const STAGE_LABELS: Record<StageKey, string> = {
  awareness: "Top of funnel",
  retargeting: "Retargeting",
  conversion: "Conversion",
};

export const STAGE_BLURBS: Record<StageKey, string> = {
  awareness: "Cold audiences who've never heard of you. Buys reach and followers cheaply; sells very little directly.",
  retargeting: "People who already visited, viewed a product or engaged. Smallest audience, dearest CPM, converts best.",
  conversion: "Purchase-optimised delivery to broad or lookalike audiences. Where most of the sales come from.",
};

/**
 * Starting assumptions, not measurements.
 *
 * These are plausible mid-range figures for EU apparel on Meta and exist so the
 * page isn't blank on first load. Every one is editable, and after a few days
 * live the real figures in Ads Manager should replace them — a CPM or CVR
 * carried over from someone else's account is worth very little.
 */
export const DEFAULT_INPUTS: CampaignInputs = {
  days: 14,
  dailyBudget: 20,
  lpvRate: 85,
  unitsPerOrder: 1.3,
  costPerFollower: 0.25,
  stages: {
    awareness: { sharePct: 45, cpm: 7, ctr: 1.0, cvr: 0.8, frequency: 1.8 },
    retargeting: { sharePct: 20, cpm: 12, ctr: 1.8, cvr: 3.5, frequency: 3.0 },
    conversion: { sharePct: 35, cpm: 9, ctr: 1.4, cvr: 2.0, frequency: 2.2 },
  },
};
