// Shared by client components — deliberately no "server-only" here.

/**
 * Ask Shopify's CDN for a size-capped copy of an image.
 *
 * The URLs the sync stores are the originals, and this store's originals run to
 * ~6 MB. next/image then has to fetch and re-encode that on every cold request,
 * which overruns its own timeout: the optimizer answers 500 and the card renders
 * blank. Shopify's CDN resizes on demand from a `width` query param, and the
 * same image comes back at ~400 KB — well inside the budget.
 *
 * Non-Shopify URLs (Supabase Storage uploads, already run through the WebP
 * pipeline) are returned untouched.
 */
export function shopifyCdnResize(url: string | null | undefined, width = 800): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "cdn.shopify.com") return url;
    // Respect an explicit width already on the URL rather than fighting it.
    if (!parsed.searchParams.has("width")) parsed.searchParams.set("width", String(width));
    return parsed.toString();
  } catch {
    // Not a parseable absolute URL (a relative path, say) — leave it alone.
    return url;
  }
}
