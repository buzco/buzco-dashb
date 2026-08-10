import "server-only";

import { adAccountId, metaPost, isMetaPublishConfigured } from "./client";
import type { BurnPlan, BurnOptimisation } from "./burn";

// Sends a planned burn to Meta as campaign → ad set → creative → ad.
//
// EVERYTHING IS CREATED PAUSED, at every one of the four levels, and there is
// deliberately no function here that unpauses anything. Turning a burn on
// spends real money and that stays a human action taken in Ads Manager, with
// the plan's numbers in front of you. This module's job is to remove the
// tedious, error-prone part — getting budgets, dates, pixel events and the
// creative right — not to take the decision.
//
// Meta talks in minor units for money and in unix-ish local timestamps for
// dates, and it will happily accept a budget that is off by a factor of 100
// without complaint, so both conversions live in one place below.

/** Meta takes money as integer minor units of the account currency. */
const minor = (amount: number) => String(Math.round(amount * 100));

/**
 * Ad set optimisation goals, and the pixel event each one needs promoted.
 * ADD_TO_CART and PURCHASE are both offsite conversions differing only in the
 * event; landing page views are measured by Meta itself and promote nothing.
 */
const GOAL: Record<BurnOptimisation, { optimization_goal: string; custom_event_type?: string }> = {
  PURCHASE: { optimization_goal: "OFFSITE_CONVERSIONS", custom_event_type: "PURCHASE" },
  ADD_TO_CART: { optimization_goal: "OFFSITE_CONVERSIONS", custom_event_type: "ADD_TO_CART" },
  LANDING_PAGE_VIEWS: { optimization_goal: "LANDING_PAGE_VIEWS" },
};

export type CreatedBurn = {
  campaignId: string;
  adSetId: string;
  creativeId: string;
  adId: string;
  /** Deep link to the campaign in Ads Manager, to review before switching on. */
  reviewUrl: string;
  /** Always true. Stated in the return value so callers can't forget it. */
  paused: true;
};

type IdResponse = { id: string };

export async function createBurn(plan: BurnPlan): Promise<CreatedBurn> {
  if (!isMetaPublishConfigured()) {
    throw new Error(
      "Meta publishing is not configured — needs META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_PAGE_ID and META_PIXEL_ID",
    );
  }
  if (plan.lifetimeBudget <= 0) {
    throw new Error("Burn has no budget left after the stock cap — nothing to create");
  }

  const account = adAccountId();
  const pageId = process.env.META_PAGE_ID!;
  const pixelId = process.env.META_PIXEL_ID!;
  const countries = (process.env.META_TARGET_COUNTRIES || "IE").split(",").map((c) => c.trim());

  // ---- Campaign ---------------------------------------------------------
  // Budget lives on the ad set, not here: a burn is a single ad set by design,
  // so campaign budget optimisation has nothing to optimise between and only
  // makes the spend harder to reason about.
  const campaign = await metaPost<IdResponse>(`${account}/campaigns`, {
    name: plan.name,
    objective: "OUTCOME_SALES",
    status: "PAUSED",
    special_ad_categories: [],
  });

  // From here on a failure leaves orphans behind. They're all paused and
  // therefore harmless, but the error says where to find them rather than
  // leaving you to hunt through Ads Manager.
  const orphan = (stage: string, e: unknown) =>
    new Error(
      `${stage} failed — campaign ${campaign.id} was created and is PAUSED with nothing under it; ` +
        `delete it in Ads Manager or re-run. Cause: ${e instanceof Error ? e.message : String(e)}`,
    );

  // ---- Ad set -----------------------------------------------------------
  const goal = GOAL[plan.optimisation];
  let adSet: IdResponse;
  try {
    adSet = await metaPost<IdResponse>(`${account}/adsets`, {
      name: `${plan.name} — burn`,
      campaign_id: campaign.id,
      status: "PAUSED",
      // A hard-ended lifetime budget is the whole point; see burn.ts.
      lifetime_budget: minor(plan.lifetimeBudget),
      start_time: plan.startAt.toISOString(),
      end_time: plan.endAt.toISOString(),
      billing_event: "IMPRESSIONS",
      optimization_goal: goal.optimization_goal,
      ...(goal.custom_event_type
        ? { promoted_object: { pixel_id: pixelId, custom_event_type: goal.custom_event_type } }
        : {}),
      // Broad on purpose. On a flight this short there is no time to learn an
      // interest stack, and creative is doing the targeting anyway.
      targeting: {
        geo_locations: { countries },
        age_min: 18,
        targeting_automation: { advantage_audience: 1 },
      },
    });
  } catch (e) {
    throw orphan("Ad set creation", e);
  }

  // ---- Creative ---------------------------------------------------------
  let creative: IdResponse;
  try {
    creative = await metaPost<IdResponse>(`${account}/adcreatives`, {
      name: `${plan.name} — creative`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          link: plan.destinationUrl,
          message: plan.primaryText,
          name: plan.headline,
          picture: plan.imageUrl,
          call_to_action: { type: "SHOP_NOW", value: { link: plan.destinationUrl } },
        },
      },
    });
  } catch (e) {
    throw orphan("Creative creation", e);
  }

  // ---- Ad ---------------------------------------------------------------
  let ad: IdResponse;
  try {
    ad = await metaPost<IdResponse>(`${account}/ads`, {
      name: `${plan.name} — ad`,
      adset_id: adSet.id,
      creative: { creative_id: creative.id },
      status: "PAUSED",
    });
  } catch (e) {
    throw orphan("Ad creation", e);
  }

  return {
    campaignId: campaign.id,
    adSetId: adSet.id,
    creativeId: creative.id,
    adId: ad.id,
    reviewUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account.replace(
      "act_",
      "",
    )}&selected_campaign_ids=${campaign.id}`,
    paused: true,
  };
}

/**
 * Stop a running ad set. Pausing is the one live change worth automating —
 * it can only ever reduce spend, and the monitor's kill rules exist precisely
 * so something can be stopped the moment it goes bad rather than at whatever
 * hour someone next opens Ads Manager.
 */
export async function pauseAdSet(adSetId: string): Promise<void> {
  await metaPost(adSetId, { status: "PAUSED" });
}

export async function pauseCampaign(campaignId: string): Promise<void> {
  await metaPost(campaignId, { status: "PAUSED" });
}
