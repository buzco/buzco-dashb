"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  checkConnection,
  isMetaConfigured,
  isMetaPublishConfigured,
  type MetaConnection,
} from "@/lib/meta/client";
import { planBurn, type BurnInputs, type BurnPlan } from "@/lib/meta/burn";
import { createBurn, pauseCampaign, type CreatedBurn } from "@/lib/meta/create";
import { diagnoseAll, diagnoseCampaign, listCampaigns, type Diagnosis } from "@/lib/meta/monitor";

const NOT_CONNECTED =
  "Meta is not connected — add META_ACCESS_TOKEN and META_AD_ACCOUNT_ID to .env.local";

export type ConnectionState = { result?: MetaConnection; error?: string };
export type PlanState = { plan?: BurnPlan; error?: string };
export type CreateState = { created?: CreatedBurn; plan?: BurnPlan; error?: string };
export type DiagnosisState = { result?: Diagnosis[]; error?: string };

/**
 * Server Functions are reachable by direct POST, not only through the UI, so
 * anything that can spend money or read account data checks the session itself
 * rather than trusting the dashboard layout to have done it.
 */
async function requireUser(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? null : "Not signed in";
}

export async function checkMetaConnection(): Promise<ConnectionState> {
  const denied = await requireUser();
  if (denied) return { error: denied };
  if (!isMetaConfigured()) return { error: NOT_CONNECTED };

  try {
    return { result: await checkConnection() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Cost the burn out without touching Meta. Safe to call on every keystroke —
 * it's pure arithmetic — and it's what the confirmation screen shows before
 * anything is created.
 */
export async function planBurnAction(inputs: BurnInputs): Promise<PlanState> {
  const denied = await requireUser();
  if (denied) return { error: denied };

  try {
    return { plan: planBurn({ ...inputs, startAt: new Date(inputs.startAt) }) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Create the burn on Meta, PAUSED at every level.
 *
 * This spends nothing. It builds the structure and hands back a link to review
 * it; switching it on is done by hand in Ads Manager. If the plan doesn't make
 * money on its own numbers it is refused outright rather than created and
 * warned about — a paused loss-maker sitting in the account is an accident
 * waiting for a click.
 */
export async function createBurnAction(inputs: BurnInputs): Promise<CreateState> {
  const denied = await requireUser();
  if (denied) return { error: denied };
  if (!isMetaPublishConfigured()) {
    return {
      error:
        "Meta publishing is not configured — needs META_PAGE_ID and META_PIXEL_ID as well as the token",
    };
  }

  try {
    const plan = planBurn({ ...inputs, startAt: new Date(inputs.startAt) });

    const fatal = plan.warnings.find((w) => w.tone === "critical");
    if (fatal) return { plan, error: `${fatal.title}. ${fatal.body}` };

    const created = await createBurn(plan);
    revalidatePath("/campaign");
    return { created, plan };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Read every campaign on the account and say which have gone cold.
 *
 * @param breakEvenCpa Contribution per order. Everything is judged against it,
 *   so it has to come from the brand's real margin — the campaign page already
 *   computes it from Shopify order data.
 */
export async function diagnoseCampaignsAction(
  breakEvenCpa: number,
  recentDays = 2,
): Promise<DiagnosisState> {
  const denied = await requireUser();
  if (denied) return { error: denied };
  if (!isMetaConfigured()) return { error: NOT_CONNECTED };
  if (!(breakEvenCpa > 0)) {
    return { error: "Break-even CPA must be known before campaigns can be judged" };
  }

  try {
    return { result: await diagnoseAll(breakEvenCpa, recentDays) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function diagnoseOneAction(
  campaignId: string,
  breakEvenCpa: number,
): Promise<{ result?: Diagnosis; error?: string }> {
  const denied = await requireUser();
  if (denied) return { error: denied };
  if (!isMetaConfigured()) return { error: NOT_CONNECTED };

  try {
    const campaigns = await listCampaigns();
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) return { error: `Campaign ${campaignId} not found on this account` };
    return { result: await diagnoseCampaign(campaign, breakEvenCpa) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Stop a campaign. The only live change offered here, because pausing can only
 * ever reduce spend — raising budgets or unpausing stays a human decision in
 * Ads Manager.
 */
export async function pauseCampaignAction(
  campaignId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const denied = await requireUser();
  if (denied) return { error: denied };
  if (!isMetaPublishConfigured()) return { error: "Pausing needs a token with ads_management" };

  try {
    await pauseCampaign(campaignId);
    revalidatePath("/campaign");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
