import "server-only";

// Graph API client for the brand's Meta ad account.
//
// Unlike Shopify there is no credentials grant to mint tokens from here. Meta
// System User tokens are issued once, by hand, in Business Settings and then
// never expire — so the token is read straight from env and used as-is. It
// carries exactly the permissions ticked when it was created: ads_read is
// enough to list campaigns and pull insights, ads_management is required
// before anything can be created or edited. A token missing the latter reads
// fine and then fails only at the moment you try to spend, which is a
// miserable way to find out, so checkConnection() reports both.
//
// Every id Meta hands out is a string, including the numeric-looking ones.
// Never parse them as numbers — they overflow Number.MAX_SAFE_INTEGER.

const API_VERSION = process.env.META_API_VERSION || "v23.0";
const GRAPH = "https://graph.facebook.com";

function token(): string {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new Error("META_ACCESS_TOKEN is not set");
  return t;
}

/** Meta wants the ad account id prefixed with `act_`; people copy it both ways. */
export function adAccountId(): string {
  const raw = process.env.META_AD_ACCOUNT_ID;
  if (!raw) throw new Error("META_AD_ACCOUNT_ID is not set");
  const id = raw.trim();
  return id.startsWith("act_") ? id : `act_${id}`;
}

export function isMetaConfigured(): boolean {
  return Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
}

/** Creating ads additionally needs a Page to run them from and a pixel to optimise on. */
export function isMetaPublishConfigured(): boolean {
  return isMetaConfigured() && Boolean(process.env.META_PAGE_ID && process.env.META_PIXEL_ID);
}

type GraphError = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
};

/**
 * Graph's own `message` is written for whoever wrote the SDK; `error_user_msg`
 * is written for whoever has to fix it. Prefer the second when it exists.
 */
function describe(status: number, body: string): string {
  let parsed: GraphError | null = null;
  try {
    parsed = JSON.parse(body) as GraphError;
  } catch {
    return `Meta ${status}: ${body.slice(0, 300)}`;
  }
  const e = parsed?.error;
  if (!e) return `Meta ${status}: ${body.slice(0, 300)}`;

  const headline = e.error_user_msg || e.message || "unknown error";
  const title = e.error_user_title ? `${e.error_user_title} — ` : "";
  const codes = [e.code, e.error_subcode].filter(Boolean).join("/");
  return `Meta ${status} (${codes || e.type || "?"}): ${title}${headline}`;
}

async function request<T>(
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; params?: Record<string, string>; body?: Record<string, unknown> } = {},
): Promise<T> {
  const method = init.method ?? "GET";
  const url = new URL(`${GRAPH}/${API_VERSION}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(init.params ?? {})) url.searchParams.set(k, v);

  // The token goes in the header rather than the query string so it can't be
  // captured by whatever logs URLs along the way.
  const headers: Record<string, string> = { Authorization: `Bearer ${token()}` };
  let body: string | undefined;
  if (init.body) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }

  const res = await fetch(url, { method, headers, body, cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(describe(res.status, text));
  return (text ? JSON.parse(text) : {}) as T;
}

export function metaGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  return request<T>(path, { method: "GET", params });
}

export function metaPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(path, { method: "POST", body });
}

/** Walks `paging.next` so a long campaign list doesn't silently truncate at 25. */
export async function metaGetAll<T>(
  path: string,
  params?: Record<string, string>,
  maxPages = 20,
): Promise<T[]> {
  const out: T[] = [];
  let page = await metaGet<{ data: T[]; paging?: { cursors?: { after?: string } } }>(path, {
    limit: "100",
    ...params,
  });
  out.push(...(page.data ?? []));

  for (let i = 1; i < maxPages; i++) {
    const after = page.paging?.cursors?.after;
    if (!after || !page.data?.length) break;
    page = await metaGet<{ data: T[]; paging?: { cursors?: { after?: string } } }>(path, {
      limit: "100",
      after,
      ...params,
    });
    out.push(...(page.data ?? []));
  }
  return out;
}

// Meta reports account health as an integer with no label attached.
const ACCOUNT_STATUS: Record<number, string> = {
  1: "Active",
  2: "Disabled",
  3: "Unsettled",
  7: "Pending risk review",
  8: "Pending settlement",
  9: "In grace period",
  100: "Pending closure",
  101: "Closed",
};

export type MetaConnection = {
  accountId: string;
  name: string;
  currency: string;
  timezone: string;
  status: string;
  active: boolean;
  /** Lifetime spend on the account, in account currency. */
  amountSpent: number;
  /** Account-level spend cap, if one is set. The hardest stop available. */
  spendCap: number | null;
  /** Permissions the token actually carries. */
  scopes: string[];
  canPublish: boolean;
  /** True when the account bills in something other than the euros the planner assumes. */
  currencyMismatch: boolean;
};

/**
 * Connectivity check, and the one place that answers "will this token let me
 * spend money, or only look at it". Mirrors getShopInfo() on the Shopify side.
 */
export async function checkConnection(): Promise<MetaConnection> {
  const account = await metaGet<{
    id: string;
    name: string;
    currency: string;
    timezone_name: string;
    account_status: number;
    amount_spent: string;
    spend_cap?: string;
  }>(adAccountId(), {
    fields: "name,currency,timezone_name,account_status,amount_spent,spend_cap",
  });

  // Amounts come back as minor-unit strings ("1234" = €12.34).
  const minor = (v: string | undefined) => (v ? Number(v) / 100 : 0);

  let scopes: string[] = [];
  try {
    const perms = await metaGet<{ data: Array<{ permission: string; status: string }> }>(
      "me/permissions",
    );
    scopes = (perms.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
  } catch {
    // System User tokens can refuse /me/permissions depending on how they were
    // scoped. Not fatal — it only costs us the pre-flight warning.
    scopes = [];
  }

  const cap = account.spend_cap ? minor(account.spend_cap) : null;

  return {
    accountId: account.id,
    name: account.name,
    currency: account.currency,
    timezone: account.timezone_name,
    status: ACCOUNT_STATUS[account.account_status] ?? `Unknown (${account.account_status})`,
    active: account.account_status === 1,
    amountSpent: minor(account.amount_spent),
    spendCap: cap && cap > 0 ? cap : null,
    scopes,
    // No scope list means we couldn't check, not that we can't publish.
    canPublish: scopes.length === 0 || scopes.includes("ads_management"),
    currencyMismatch: account.currency !== "EUR",
  };
}
