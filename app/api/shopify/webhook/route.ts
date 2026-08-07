import { after } from "next/server";
import { verifyWebhookSignature, topicToKind } from "@/lib/shopify/webhooks";
import { requestSync } from "@/lib/shopify/live-sync";

// Shopify's push endpoint. Registered from the /shopify page.
//
// Shopify expects a 2xx within 5 seconds and retries for ~48h otherwise, so the
// handler verifies the payload, answers immediately, and does the sync in
// `after()` — the response is already out the door while the work runs.
//
// This route is deliberately outside the auth wall (see proxy.ts): Shopify has
// no session. The HMAC over the raw body is what authenticates it, which means
// the body must be read as text and never re-serialised before checking.

export const runtime = "nodejs"; // needs node:crypto for the HMAC
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");

  if (!verifyWebhookSignature(raw, hmac)) {
    // Don't say why — an attacker probing the endpoint learns nothing.
    return new Response("Unauthorized", { status: 401 });
  }

  const topic = request.headers.get("x-shopify-topic");
  const kind = topicToKind(topic);

  if (!kind) {
    // A topic we don't handle is still a delivered webhook. 200 stops Shopify
    // retrying something we will never act on.
    return Response.json({ ok: true, ignored: topic });
  }

  after(async () => {
    await requestSync(kind);
  });

  return Response.json({ ok: true, topic, kind });
}
