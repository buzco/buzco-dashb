import "server-only";

// Direct Admin GraphQL client for the brand's single custom app.
// Auth is a permanent Admin API access token (shpat_…) sent as a header — no
// OAuth dance needed for a one-store custom app. All Shopify writes/reads go
// through here so the API version and error handling live in one place.

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";

function config() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!domain) throw new Error("SHOPIFY_STORE_DOMAIN is not set");
  if (!token) throw new Error("SHOPIFY_ADMIN_ACCESS_TOKEN is not set");
  return { domain, token };
}

export function isShopifyConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN);
}

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export async function shopifyGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const { domain, token } = config();

  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
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
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) {
    throw new Error("Shopify GraphQL returned no data");
  }
  return json.data;
}

// Lightweight connectivity check — also surfaces the granted access scopes so
// we can tell up front whether products/inventory/files writes are permitted.
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
