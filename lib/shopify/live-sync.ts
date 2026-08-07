import "server-only";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncFromShopify } from "@/lib/shopify/sync";
import { syncShopifyOrders } from "@/lib/shopify/orders";

// Runs a sync on behalf of a webhook. Two things make this different from the
// "Sync now" button:
//
// 1. There is no logged-in session, and RLS only grants the `authenticated`
//    role — so every write goes through the service-role client.
// 2. Shopify fans out. Editing one product in bulk, or an order moving through
//    its lifecycle, can fire a dozen webhooks in a second, and each one would
//    otherwise start its own full catalog sync.
//
// So syncs of the same kind are coalesced: at most one runs at a time, and any
// webhooks that land while it's running collapse into a single follow-up run.
// That follow-up matters — dropping late arrivals instead would lose whatever
// changed after the in-flight sync had already read it.

export type SyncKind = "catalog" | "orders";

type Slot = { running: Promise<void> | null; queued: boolean };

// Module scope, so this is per warm serverless instance rather than global. A
// burst usually lands on one instance; when it doesn't, the worst case is a
// duplicate sync, and both syncs are idempotent.
const slots: Record<SyncKind, Slot> = {
  catalog: { running: null, queued: false },
  orders: { running: null, queued: false },
};

/** How far back an order sync looks. Wide enough to absorb a webhook retry. */
const ORDER_WINDOW_MS = 3 * 86400_000;

async function runOnce(kind: SyncKind): Promise<void> {
  const db = createAdminClient();

  if (kind === "catalog") {
    const r = await syncFromShopify(db);
    if (r.errors.length) console.error("[shopify webhook] catalog sync", r.errors);
    if (r.inventorySkippedReason) {
      console.warn("[shopify webhook] inventory not reconciled:", r.inventorySkippedReason);
    }
    revalidatePath("/products");
    revalidatePath("/inventory");
    revalidatePath("/markets");
  } else {
    const r = await syncShopifyOrders({
      sinceIso: new Date(Date.now() - ORDER_WINDOW_MS).toISOString(),
      db,
    });
    if (r.errors.length) console.error("[shopify webhook] order sync", r.errors);
    revalidatePath("/sales");
    revalidatePath("/finance");
  }

  revalidatePath("/");
  revalidatePath("/shopify");
}

/**
 * Ask for a sync of `kind`. Resolves when the work that covers this request has
 * finished, so a caller can await it inside `after()` and keep the serverless
 * invocation alive until the sync is actually done.
 */
export function requestSync(kind: SyncKind): Promise<void> {
  const slot = slots[kind];

  if (slot.running) {
    slot.queued = true;
    return slot.running;
  }

  const run = async (): Promise<void> => {
    try {
      await runOnce(kind);
    } catch (e) {
      console.error(`[shopify webhook] ${kind} sync failed`, e);
    }
    // Anything that arrived mid-run gets exactly one more pass.
    if (slot.queued) {
      slot.queued = false;
      await run();
    }
  };

  slot.running = run().finally(() => {
    slot.running = null;
  });
  return slot.running;
}
