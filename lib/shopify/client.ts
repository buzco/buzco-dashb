import "server-only";

// Direct Admin GraphQL client for the brand's custom app.
//
// Shopify's new Dev Dashboard apps authenticate with the OAuth
// client-credentials grant: POST client_id + client_secret to
// /admin/oauth/access_token and get back a short-lived (~24h) shpat_ token.
// So the app mints its own token from the credentials in env and caches it in
// memory until just before expiry — no manual token reveal/rotation needed.
// (A static SHOPIFY_ADMIN_ACCESS_TOKEN, if set, overrides and is used as-is.)

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";

let cached: { token: string; expiresAt: number } | null = null;

function domain(): string {
  const d = process.env.SHOPIFY_STORE_DOMAIN;
  if (!d) throw new Error("SHOPIFY_STORE_DOMAIN is not set");
  return d;
}

export function isShopifyConfigured(): boolean {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return Boolean(process.env.SHOPIFY_STORE_DOMAIN);
  return Boolean(
    process.env.SHOPIFY_STORE_DOMAIN &&
      process.env.SHOPIFY_API_KEY &&
      process.env.SHOPIFY_API_SECRET,
  );
}

async function getAccessToken(): Promise<string> {
  const override = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (override) return override;

  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  const key = process.env.SHOPIFY_API_KEY;
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!key || !secret) {
    throw new Error("Shopify not configured — set SHOPIFY_API_KEY and SHOPIFY_API_SECRET");
  }

  const res = await fetch(`https://${domain()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: key,
      client_secret: secret,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Shopify token exchange ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: json.access_token, expiresAt: now + (json.expires_in ?? 86400) * 1000 };
  return cached.token;
}

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }> | string;
};

export async function shopifyGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = await getAccessToken();

  const res = await fetch(`https://${domain()}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors) {
    const msg = typeof json.errors === "string" ? json.errors : json.errors.map((e) => e.message).join("; ");
    throw new Error(`Shopify GraphQL error: ${msg}`);
  }
  if (!json.data) throw new Error("Shopify GraphQL returned no data");
  return json.data;
}

// Lightweight connectivity check — also surfaces granted access scopes.
export async function getShopInfo(): Promise<{
  name: string;
  myshopifyDomain: string;
  email: string | null;
  currencyCode: string;
  scopes: string[];
}> {
  const data = await shopifyGraphQL<{
    shop: { name: string; myshopifyDomain: string; email: string | null; currencyCode: string };
    currentAppInstallation: { accessScopes: Array<{ handle: string }> };
  }>(`
    query ConnectionCheck {
      shop { name myshopifyDomain email currencyCode }
      currentAppInstallation { accessScopes { handle } }
    }
  `);

  return {
    name: data.shop.name,
    myshopifyDomain: data.shop.myshopifyDomain,
    email: data.shop.email,
    currencyCode: data.shop.currencyCode,
    scopes: data.currentAppInstallation.accessScopes.map((s) => s.handle),
  };
}
