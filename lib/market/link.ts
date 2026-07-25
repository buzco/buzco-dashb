import "server-only";

import { notFound } from "next/navigation";

// Access control for the standalone stall pages. There is no login: the whole
// guard is an unguessable token in the URL, which the user chose so helpers can
// open a link and start selling with no friction.
//
// Consequences worth being deliberate about:
//  - Anyone holding the link can record sales and raffle entries. Rotating
//    MARKET_LINK_TOKEN invalidates every link at once.
//  - Comparison is constant-time so the token can't be recovered by timing.
//  - A wrong token returns 404, not 403 — a 403 would confirm the path exists.
//  - These pages are noindex (see their layout) so the link can't be found
//    through a search engine.

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function linkTokenConfigured(): boolean {
  return Boolean(process.env.MARKET_LINK_TOKEN);
}

/** Renders 404 unless `token` matches. Call at the top of every /s/ page. */
export function assertLinkToken(token: string): void {
  const expected = process.env.MARKET_LINK_TOKEN;
  // No token configured means the feature is off, not open to everyone.
  if (!expected) notFound();
  if (!token || !timingSafeEqual(token, expected)) notFound();
}

/** Same check for server actions, which must not rely on the page's guard. */
export function isValidLinkToken(token: string): boolean {
  const expected = process.env.MARKET_LINK_TOKEN;
  if (!expected || !token) return false;
  return timingSafeEqual(token, expected);
}
