import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { shopifyGraphQL } from "@/lib/shopify/client";

// Webhook plumbing for the live sync. Shopify pushes a topic to our endpoint the
// moment something changes in the store; the endpoint verifies the payload came
// from Shopify (HMAC over the raw body, keyed by the app secret) and then kicks
// the matching sync.
//
// Note the split from lib/market/*: market POS sales are still POLLED, because a
// stall runs on venue wifi with the dashboard closed and a missed push there is
// silent. Webhooks here serve the always-on deployed app, where they're the only
// way to stay current without a paid cron tier.

/** Topics we subscribe to, and which sync each one should trigger. */
export const WEBHOOK_TOPICS = [
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "INVENTORY_LEVELS_UPDATE",
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
] as const;

export type WebhookTopic = (typeof WEBHOOK_TOPICS)[number];

/** Shopify sends the topic header lowercased and slashed: "products/update". */
export function topicToKind(header: string | null): "catalog" | "orders" | null {
  if (!header) return null;
  const t = header.toLowerCase();
  if (t.startsWith("products/") || t.startsWith("inventory_levels/")) return "catalog";
  if (t.startsWith("orders/")) return "orders";
  return null;
}

/**
 * Verify Shopify's HMAC over the exact raw request body.
 *
 * Must be given the body as received — parsing and re-serialising the JSON
 * changes the bytes and the digest will never match.
 */
export function verifyWebhookSignature(rawBody: string, hmacHeader: string | null): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret || !hmacHeader) return false;

  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let received: Buffer;
  try {
    received = Buffer.from(hmacHeader, "base64");
  } catch {
    return false;
  }
  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  if (received.length !== digest.length) return false;
  return timingSafeEqual(digest, received);
}

/**
 * Public origin Shopify should call back on. Vercel exposes the deployment host,
 * but a webhook registered against a preview URL would die with that deployment,
 * so an explicit APP_URL always wins.
 */
export function callbackUrl(): string {
  const explicit = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  const base =
    explicit ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null);
  if (!base) {
    throw new Error(
      "No public URL to register webhooks against — set APP_URL to the deployed origin (e.g. https://buzco-dashb.vercel.app)",
    );
  }
  return `${base.replace(/\/$/, "")}/api/shopify/webhook`;
}

type SubscriptionNode = {
  id: string;
  topic: string;
  endpoint: { __typename: string; callbackUrl?: string };
};

export async function listWebhooks(): Promise<Array<{ id: string; topic: string; url: string }>> {
  const data = await shopifyGraphQL<{
    webhookSubscriptions: { edges: Array<{ node: SubscriptionNode }> };
  }>(`
    query ListWebhooks {
      webhookSubscriptions(first: 50) {
        edges {
          node {
            id
            topic
            endpoint {
              __typename
              ... on WebhookHttpEndpoint { callbackUrl }
            }
          }
        }
      }
    }
  `);

  return data.webhookSubscriptions.edges.map(({ node }) => ({
    id: node.id,
    topic: node.topic,
    url: node.endpoint.callbackUrl ?? "—",
  }));
}

export type RegisterResult = {
  callbackUrl: string;
  created: string[];
  alreadyLive: string[];
  replaced: string[];
  errors: string[];
};

/**
 * Make the store's subscriptions match WEBHOOK_TOPICS pointing at this app.
 *
 * Re-runnable: a topic already pointing at the right URL is left alone, and one
 * pointing at a stale URL (an old preview deployment) is deleted first so the
 * store doesn't accumulate dead endpoints.
 */
export async function registerWebhooks(): Promise<RegisterResult> {
  const url = callbackUrl();
  const result: RegisterResult = {
    callbackUrl: url,
    created: [],
    alreadyLive: [],
    replaced: [],
    errors: [],
  };

  const existing = await listWebhooks();

  for (const topic of WEBHOOK_TOPICS) {
    try {
      const mine = existing.filter((w) => w.topic === topic);
      if (mine.some((w) => w.url === url)) {
        result.alreadyLive.push(topic);
        continue;
      }

      // Same topic, wrong endpoint — clear it out before subscribing again.
      for (const stale of mine) {
        await deleteWebhook(stale.id);
        result.replaced.push(topic);
      }

      const data = await shopifyGraphQL<{
        webhookSubscriptionCreate: {
          webhookSubscription: { id: string } | null;
          userErrors: Array<{ field: string[] | null; message: string }>;
        };
      }>(
        `
        mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $url: URL!) {
          webhookSubscriptionCreate(
            topic: $topic
            webhookSubscription: { callbackUrl: $url, format: JSON }
          ) {
            webhookSubscription { id }
            userErrors { field message }
          }
        }
      `,
        { topic, url },
      );

      const errs = data.webhookSubscriptionCreate.userErrors;
      if (errs.length) {
        result.errors.push(`${topic}: ${errs.map((e) => e.message).join("; ")}`);
        continue;
      }
      result.created.push(topic);
    } catch (e) {
      result.errors.push(`${topic}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

export async function deleteWebhook(id: string): Promise<void> {
  await shopifyGraphQL(
    `
    mutation DeleteWebhook($id: ID!) {
      webhookSubscriptionDelete(id: $id) {
        userErrors { message }
      }
    }
  `,
    { id },
  );
}
