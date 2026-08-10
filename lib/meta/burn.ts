// Planning a burn — a short, deliberately aggressive flight, rather than the
// slow steady drip the campaign simulator models by default.
//
// A burn breaks most of the standard advice on purpose, and it is worth being
// explicit about which rules are being broken and why, because the failure
// modes are different from a normal campaign's:
//
//   - It is too short to leave the learning phase. That is accepted, not
//     solved. The compensations are structural: ONE ad set so every event
//     lands in the same pool, and optimisation on an event that actually
//     happens often enough at this volume.
//   - It runs on a LIFETIME budget with a hard end time, not a daily one. A
//     daily budget on a 3-day flight can overspend the window by ~25% on any
//     given day and has no way to stop itself; a lifetime budget cannot spend
//     more than exists and Meta paces it across the flight.
//   - It is aimed at stock you actually hold. The whole point of burning is
//     to move a known quantity fast, so the plan is capped at the spend that
//     empties the shelf and refuses to fund demand past it.
//
// Nothing here talks to the Graph API. It produces a spec and a set of
// warnings; create.ts is what sends it, and only ever paused. Pure arithmetic
// with no credentials, deliberately NOT server-only, so the planner can run in
// the browser and cost a burn out live as the numbers are typed — same reason
// the campaign simulator's funnel.ts isn't server-only either.

/** Meta's threshold for an ad set to leave the learning phase. */
const LEARNING_EVENTS_PER_WEEK = 50;

/** Below this, an optimisation event is too rare to teach delivery anything. */
const MIN_EVENTS_FOR_SIGNAL = 15;

export type BurnOptimisation = "PURCHASE" | "ADD_TO_CART" | "LANDING_PAGE_VIEWS";

export type BurnInputs = {
  /** Shows up as the campaign name in Ads Manager, so make it recognisable. */
  name: string;
  /** Where the ad points. The product or collection being burnt. */
  destinationUrl: string;
  /** Absolute URL of the image the ad runs. */
  imageUrl: string;
  headline: string;
  primaryText: string;
  /** Burns are short by definition; 2-7 days is the useful range. */
  days: number;
  dailyBudget: number;
  startAt: Date;
  /** Units on hand. The burn will not be planned past what this can serve. */
  availableStock: number;
  unitsPerOrder: number;
  /** Selling price per unit during the burn, after any discount. */
  revenuePerUnit: number;
  /** What survives per unit after COGS, shipping and fees. */
  contributionPerUnit: number;
  /**
   * Cost per purchase to plan against. Should come from the account's own
   * recent insights, or from the campaign simulator — never a guess, because
   * every number below is derived from it.
   */
  expectedCpa: number;
  optimisation?: BurnOptimisation;
};

export type BurnWarning = {
  tone: "critical" | "warning" | "neutral";
  title: string;
  body: string;
};

export type BurnPlan = {
  name: string;
  /** Total the flight may spend. Already capped by stock. */
  lifetimeBudget: number;
  /** What the requested daily budget × days would have been, before capping. */
  requestedBudget: number;
  days: number;
  startAt: Date;
  endAt: Date;
  optimisation: BurnOptimisation;

  expectedOrders: number;
  expectedUnits: number;
  expectedRevenue: number;
  expectedContribution: number;
  expectedNetProfit: number;
  breakEvenCpa: number;
  /** Cost per purchase implied after any stock capping. */
  effectiveCpa: number;
  roas: number;

  /** Optimisation events the flight would generate, at this budget. */
  eventsInFlight: number;
  eventsPerWeek: number;
  exitsLearning: boolean;

  stockLimited: boolean;
  /** Day of the flight the shelf empties, if it does. */
  selloutDay: number | null;
  /** Spend that would have run after sell-out, and has been removed. */
  budgetTrimmed: number;

  /** Kill thresholds, in the brand's own numbers. */
  killAfterSpend: number;
  pauseCreativeAfterSpend: number;

  warnings: BurnWarning[];
  destinationUrl: string;
  imageUrl: string;
  headline: string;
  primaryText: string;
};

const eur = (n: number) =>
  (n < 0 ? "−€" : "€") +
  Math.abs(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round = (n: number) => Math.round(n).toLocaleString("en-IE");

/**
 * How much cheaper a softer optimisation event is than a purchase. Rough
 * industry ratios, used only to check whether an event fires often enough to
 * be worth optimising on — never to forecast revenue.
 */
const EVENT_COST_RATIO: Record<BurnOptimisation, number> = {
  PURCHASE: 1,
  ADD_TO_CART: 0.25,
  LANDING_PAGE_VIEWS: 0.04,
};

export function planBurn(inputs: BurnInputs): BurnPlan {
  const days = Math.max(1, Math.round(inputs.days));
  const requestedBudget = Math.max(0, inputs.dailyBudget) * days;
  const unitsPerOrder = Math.max(0.01, inputs.unitsPerOrder);
  const cpa = Math.max(0.01, inputs.expectedCpa);
  const stock = Math.max(0, inputs.availableStock);

  const contributionPerOrder = inputs.contributionPerUnit * unitsPerOrder;
  const breakEvenCpa = contributionPerOrder;

  // Demand the requested budget would generate, before stock is considered.
  const demandOrders = requestedBudget / cpa;
  const demandUnits = demandOrders * unitsPerOrder;

  // Spending past the point the shelf empties buys nothing at all, so the plan
  // is capped there rather than merely warned about.
  const ordersStockAllows = stock / unitsPerOrder;
  const spendCeiling = ordersStockAllows * cpa;
  const stockLimited = demandUnits > stock;
  const lifetimeBudget = stockLimited ? Math.min(requestedBudget, spendCeiling) : requestedBudget;
  const budgetTrimmed = requestedBudget - lifetimeBudget;
  const selloutDay =
    stockLimited && demandUnits > 0 ? Math.max(1, Math.ceil(days * (stock / demandUnits))) : null;

  const expectedOrders = lifetimeBudget / cpa;
  const expectedUnits = Math.min(expectedOrders * unitsPerOrder, stock);
  const expectedRevenue = expectedUnits * inputs.revenuePerUnit;
  const expectedContribution = expectedUnits * inputs.contributionPerUnit;
  const expectedNetProfit = expectedContribution - lifetimeBudget;

  // Pick the optimisation event on volume, not on preference. Purchase
  // optimisation on a flight that produces four purchases teaches nothing.
  const purchasesInFlight = expectedOrders;
  const optimisation: BurnOptimisation =
    inputs.optimisation ??
    (purchasesInFlight >= MIN_EVENTS_FOR_SIGNAL
      ? "PURCHASE"
      : purchasesInFlight / EVENT_COST_RATIO.ADD_TO_CART >= MIN_EVENTS_FOR_SIGNAL
        ? "ADD_TO_CART"
        : "LANDING_PAGE_VIEWS");

  const eventsInFlight = purchasesInFlight / EVENT_COST_RATIO[optimisation];
  const eventsPerWeek = (eventsInFlight / days) * 7;

  const startAt = inputs.startAt;
  const endAt = new Date(startAt.getTime() + days * 86_400_000);

  const warnings: BurnWarning[] = [];

  // An empty shelf is checked before anything else and returns early. Left to
  // fall through, the stock cap trims the budget to zero and every downstream
  // number becomes a degenerate zero — which reads as "this burn loses €0.00,
  // sells out on day 1", technically true and completely useless.
  if (stock <= 0) {
    warnings.push({
      tone: "critical",
      title: "No stock — there is nothing to burn",
      body:
        `Every euro of this flight would run against an empty shelf. Restock before launching, ` +
        `or point the burn at something you actually hold.`,
    });
    return {
      name: inputs.name,
      lifetimeBudget: 0,
      requestedBudget,
      days,
      startAt,
      endAt,
      optimisation: inputs.optimisation ?? "LANDING_PAGE_VIEWS",
      expectedOrders: 0,
      expectedUnits: 0,
      expectedRevenue: 0,
      expectedContribution: 0,
      expectedNetProfit: 0,
      breakEvenCpa,
      effectiveCpa: 0,
      roas: 0,
      eventsInFlight: 0,
      eventsPerWeek: 0,
      exitsLearning: false,
      stockLimited: true,
      selloutDay: null,
      budgetTrimmed: requestedBudget,
      killAfterSpend: breakEvenCpa * 1.5,
      pauseCreativeAfterSpend: breakEvenCpa * 0.5,
      warnings,
      destinationUrl: inputs.destinationUrl,
      imageUrl: inputs.imageUrl,
      headline: inputs.headline,
      primaryText: inputs.primaryText,
    };
  }

  // ---- Does the burn make money at all? --------------------------------
  if (expectedNetProfit <= 0) {
    warnings.push({
      tone: "critical",
      title: `This burn loses ${eur(Math.abs(expectedNetProfit))}`,
      body:
        `An order has to cost under ${eur(breakEvenCpa)} to be worth buying and you're planning ` +
        `against ${eur(cpa)}. Burning harder makes the hole deeper, not shallower — the maths per ` +
        `order is what's wrong. Raise order value (bundle, or a second piece per order), discount ` +
        `less, or don't run this one.`,
    });
  }

  // ---- The learning phase, stated rather than pretended away -----------
  if (eventsPerWeek < LEARNING_EVENTS_PER_WEEK) {
    warnings.push({
      tone: "warning",
      title: `Nothing here leaves the learning phase — that is inherent to a ${days}-day burn`,
      body:
        `Meta wants about ${LEARNING_EVENTS_PER_WEEK} optimisation events per ad set per week and ` +
        `this flight produces roughly ${round(eventsPerWeek)} at ${optimisation.toLowerCase().replace(/_/g, " ")} ` +
        `optimisation. Don't try to out-spend it over three days. The plan already does the two ` +
        `things that help: one single ad set so every event lands in the same pool, and the ` +
        `cheapest event that still correlates with buying. Read the result as "did it move the ` +
        `stock", not as a clean CPA measurement — delivery never settles in a window this short.`,
    });
  }

  if (optimisation !== "PURCHASE") {
    warnings.push({
      tone: "neutral",
      title: `Optimising for ${optimisation.toLowerCase().replace(/_/g, " ")} rather than purchases`,
      body:
        `At ${eur(lifetimeBudget)} total you'd generate about ${round(purchasesInFlight)} purchases, ` +
        `far too few for purchase optimisation to find a pattern in. The softer event fires often ` +
        `enough to steer delivery. Switch back to purchase optimisation when a flight clears ` +
        `${MIN_EVENTS_FOR_SIGNAL}+ purchases on its own.`,
    });
  }

  // ---- Stock ------------------------------------------------------------
  if (stockLimited && budgetTrimmed > 0) {
    warnings.push({
      tone: "warning",
      title: `Budget trimmed to ${eur(lifetimeBudget)} — you sell out around day ${selloutDay}`,
      body:
        `${eur(requestedBudget)} over ${days} days generates demand for ${round(demandUnits)} units ` +
        `and you hold ${round(stock)}. The extra ${eur(budgetTrimmed)} would run against an empty ` +
        `shelf, so it has been taken out of the lifetime budget. Restock first if you want to spend ` +
        `the full amount.`,
    });
  }

  // ---- Things specific to burning rather than dripping ------------------
  if (days <= 3) {
    warnings.push({
      tone: "neutral",
      title: `${days} days gives you almost no room to react`,
      body:
        `Delivery takes 3-4 days to settle, so this flight is entirely learning phase. That's the ` +
        `trade you're making for speed. Load every creative up front — editing mid-flight resets ` +
        `what little delivery has been established — and judge it on stock moved, not CPA.`,
    });
  }

  warnings.push({
    tone: "neutral",
    title: "Lifetime budget with a hard end, not a daily budget",
    body:
      `The ad set carries ${eur(lifetimeBudget)} for the whole flight and stops at ` +
      `${endAt.toISOString().slice(0, 16).replace("T", " ")}. A daily budget can overspend by ` +
      `around 25% on a given day and has no end date of its own, which on a burn is how you find ` +
      `out afterwards that it ran a week.`,
  });

  return {
    name: inputs.name,
    lifetimeBudget,
    requestedBudget,
    days,
    startAt,
    endAt,
    optimisation,
    expectedOrders,
    expectedUnits,
    expectedRevenue,
    expectedContribution,
    expectedNetProfit,
    breakEvenCpa,
    effectiveCpa: expectedOrders > 0 ? lifetimeBudget / expectedOrders : 0,
    roas: lifetimeBudget > 0 ? expectedRevenue / lifetimeBudget : 0,
    eventsInFlight,
    eventsPerWeek,
    exitsLearning: eventsPerWeek >= LEARNING_EVENTS_PER_WEEK,
    stockLimited,
    selloutDay,
    budgetTrimmed,
    // The same kill rules the campaign strategy panel gives, so the advice
    // doesn't contradict itself between the planner and the live monitor.
    killAfterSpend: breakEvenCpa * 1.5,
    pauseCreativeAfterSpend: breakEvenCpa * 0.5,
    warnings,
    destinationUrl: inputs.destinationUrl,
    imageUrl: inputs.imageUrl,
    headline: inputs.headline,
    primaryText: inputs.primaryText,
  };
}
