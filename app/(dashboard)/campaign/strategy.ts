import {
  LEARNING_EVENTS_PER_WEEK,
  STAGE_LABELS,
  type CampaignInputs,
  type Simulation,
  type UnitEconomics,
} from "./funnel";

// Turns the simulation into advice worth acting on. Every number quoted here is
// the user's own — nothing is generic "best practice" filler, because advice
// that isn't anchored to their margin and their stock is just noise.

export type Advice = {
  tone: "critical" | "warning" | "good" | "neutral";
  title: string;
  body: string;
};

const eur = (n: number) =>
  (n < 0 ? "−€" : "€") +
  Math.abs(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${n.toFixed(2)}%`;
const round = (n: number) => Math.round(n).toLocaleString("en-IE");

export function buildStrategy(
  sim: Simulation,
  inputs: CampaignInputs,
  econ: UnitEconomics,
): Advice[] {
  const advice: Advice[] = [];
  if (sim.totalBudget <= 0 || econ.revenuePerUnit <= 0) return advice;

  const totalLpv = sim.stages.reduce((s, r) => s + r.landingPageViews, 0);
  const ordersNeeded = sim.breakEvenCpa > 0 ? sim.totalBudget / sim.breakEvenCpa : 0;
  const requiredCvr = totalLpv > 0 ? (ordersNeeded / totalLpv) * 100 : 0;
  const assumedCvr = totalLpv > 0 ? (sim.orders / totalLpv) * 100 : 0;
  const requiredAov = sim.margin > 0 ? sim.cpa / sim.margin : 0;
  const activeStages = sim.stages.filter((s) => s.spend > 0);

  // ---- Is this plan solvent at all? ------------------------------------
  if (!sim.profitable) {
    advice.push({
      tone: "critical",
      title: `This plan loses ${eur(Math.abs(sim.netProfit))}`,
      body:
        `Each order has to cost under ${eur(sim.breakEvenCpa)} to be worth buying, and at these ` +
        `assumptions it costs ${eur(sim.cpa)}. Three levers close that gap, in order of how much ` +
        `they move: lift average order value to ${eur(requiredAov)} (bundle, or sell a second ` +
        `piece per order — this raises the break-even CPA directly), get conversion rate from ` +
        `${pct(assumedCvr)} to ${pct(requiredCvr)}, or cut cost of goods. Cutting ad spend alone ` +
        `won't fix it — the maths per order is what's wrong, not the size of the budget.`,
    });
  } else {
    advice.push({
      tone: "good",
      title: `Projected profit ${eur(sim.netProfit)} at ${sim.roas.toFixed(2)}× ROAS`,
      body:
        `You break even at ${sim.breakEvenRoas.toFixed(2)}×, so there's headroom. Scale in steps of ` +
        `about 20% of daily budget every 3-4 days — bigger jumps re-enter the learning phase and ` +
        `you lose the delivery you just paid to establish. Watch cost per purchase as you go; the ` +
        `moment it passes ${eur(sim.breakEvenCpa)} the extra spend is buying losses.`,
    });
  }

  // ---- The constraint that actually bites at this budget ---------------
  const anyStageLearns = activeStages.some((s) => s.exitsLearning);
  if (!anyStageLearns && activeStages.length > 0) {
    const cheapest = [...activeStages].sort((a, b) => a.minDailyForLearning - b.minDailyForLearning)[0];
    advice.push({
      tone: "warning",
      title: "No ad set can leave the learning phase — restructure rather than out-spend it",
      body:
        `Meta needs about ${LEARNING_EVENTS_PER_WEEK} optimisation events per ad set per week to ` +
        `deliver stably. Your best stage (${STAGE_LABELS[cheapest.key]}) produces ` +
        `${cheapest.ordersPerWeek.toFixed(1)} purchases a week, and would need ` +
        `${eur(cheapest.minDailyForLearning)}/day to hit the threshold on purchase optimisation. ` +
        `That is the normal situation at this budget and it is not solved by splitting the money ` +
        `further. Do the opposite: run ONE ad set with broad targeting so every event lands in the ` +
        `same pool, and optimise for a cheaper event — add-to-cart, or landing page view — which ` +
        `happens often enough to actually teach the algorithm. Move to purchase optimisation once ` +
        `you're clearing ~50 purchases a week.`,
    });
  }

  if (activeStages.length > 1) {
    const perStageDaily = inputs.dailyBudget / activeStages.length;
    if (perStageDaily < 10) {
      advice.push({
        tone: "warning",
        title: `${eur(perStageDaily)}/day per ad set is too thin to learn anything`,
        body:
          `Splitting ${eur(inputs.dailyBudget)}/day across ${activeStages.length} stages leaves each ` +
          `one starved, and you'll end up reading noise as signal. Until daily budget is comfortably ` +
          `into the tens of euros, put it all behind one stage — top of funnel if nobody knows you ` +
          `yet, conversion if you already have traffic to work with.`,
      });
    }
  }

  // ---- Sequencing: retargeting can't run before there's a pool ---------
  const retarget = sim.stages.find((s) => s.key === "retargeting");
  if (retarget && retarget.spend > 0 && sim.reach < 20000) {
    advice.push({
      tone: "neutral",
      title: "Fund retargeting only once top-of-funnel has built an audience",
      body:
        `You're putting ${eur(retarget.spend)} into retargeting against a projected reach of about ` +
        `${round(sim.reach)} people. A retargeting pool is made by the awareness stage, so in week ` +
        `one it's nearly empty and that budget will barely deliver. Run top of funnel first, then ` +
        `switch this on in week two when there are visitors to chase.`,
    });
  }

  // ---- Stock ------------------------------------------------------------
  if (sim.stockLimited && sim.selloutDay) {
    advice.push({
      tone: "warning",
      title: `You sell out around day ${sim.selloutDay} of ${inputs.days}`,
      body:
        `This plan generates demand for ${round(sim.demandUnits)} units and you hold ` +
        `${round(econ.availableStock)}. Roughly ${eur(sim.wastedSpend)} of the budget runs after ` +
        `the shelf is empty. Either stop at ` +
        `${sim.spendCeiling !== null ? eur(sim.spendCeiling) : "the sell-out point"}, shorten the ` +
        `campaign, or restock before launching.`,
    });
  }

  // ---- Duration ---------------------------------------------------------
  if (inputs.days > 0 && inputs.days < 7) {
    advice.push({
      tone: "warning",
      title: `${inputs.days} days is too short to judge anything`,
      body:
        `Delivery takes roughly 3-4 days to settle, so a campaign this short is mostly learning ` +
        `phase and you'll be reading it at its worst. Give it 7-14 days, and resist editing budget ` +
        `or targeting mid-flight — each significant edit restarts learning.`,
    });
  }

  // ---- Margin reality check --------------------------------------------
  if (sim.margin > 0 && sim.margin < 0.4) {
    advice.push({
      tone: "warning",
      title: `A ${(sim.margin * 100).toFixed(0)}% contribution margin makes paid acquisition brutal`,
      body:
        `At this margin every order has to come in under ${eur(sim.breakEvenCpa)}, which leaves almost ` +
        `no room for a bad day. Paid social gets much more forgiving above roughly 50% — worth ` +
        `looking at price, or at a bundle that lifts units per order, before spending heavily.`,
    });
  }

  // ---- Rules to run it by (always useful) ------------------------------
  advice.push({
    tone: "neutral",
    title: "Kill and scale rules, in your numbers",
    body:
      `Kill any ad set that has spent ${eur(sim.breakEvenCpa * 1.5)} — 1.5× your break-even CPA — ` +
      `without a purchase; it is very unlikely to recover. Pause individual creatives once they've ` +
      `spent about ${eur(sim.breakEvenCpa * 0.5)} with no add-to-cart. Judge on cost per purchase, ` +
      `not on CTR or engagement: cheap clicks that don't buy are the most expensive thing in the ` +
      `account.`,
  });

  advice.push({
    tone: "neutral",
    title: "Creative is the real targeting",
    body:
      `Launch 3-5 genuinely different creatives per ad set — not colour variants of one idea. ` +
      `Broad targeting plus varied creative now beats narrow interest stacking; the algorithm finds ` +
      `the audience if the creative tells it who to look for. Refresh whatever is still running ` +
      `after 2-3 weeks, when frequency climbs and results decay.`,
  });

  return advice;
}
