import "server-only";

// Minimal Notion REST client (no SDK dependency — we use four endpoints).
//
// Auth is an internal integration token from notion.so/my-integrations. The
// target databases must each be shared with that integration ("..." ->
// Connections -> add the integration), otherwise every call 404s even though
// the token is valid — Notion treats "not shared" as "does not exist".
//
// Pinned to API version 2022-06-28 on purpose: 2025-09-03 splits databases into
// "data sources" and moves the query/parent shapes, which would need a
// different client. Override with NOTION_API_VERSION if you ever migrate.

const NOTION_API = "https://api.notion.com/v1";
const API_VERSION = process.env.NOTION_API_VERSION || "2022-06-28";

export function isNotionConfigured(): boolean {
  return Boolean(process.env.NOTION_TOKEN);
}

export function salesDbId(): string {
  const id = process.env.NOTION_SALES_DB_ID;
  if (!id) throw new Error("NOTION_SALES_DB_ID is not set");
  return id;
}

export function raffleDbId(): string {
  const id = process.env.NOTION_RAFFLE_DB_ID;
  if (!id) throw new Error("NOTION_RAFFLE_DB_ID is not set");
  return id;
}

export function hasRaffleDb(): boolean {
  return Boolean(process.env.NOTION_TOKEN && process.env.NOTION_RAFFLE_DB_ID);
}

async function notionFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("Notion not configured — set NOTION_TOKEN in .env.local");

  const res = await fetch(`${NOTION_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": API_VERSION,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    // Notion errors are JSON with a human-readable `message`; surface that.
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { message?: string; code?: string };
      if (parsed.message) message = `${parsed.code ?? res.status}: ${parsed.message}`;
    } catch {
      /* non-JSON body — keep the raw slice */
    }
    throw new Error(`Notion ${res.status} on ${path} — ${message}`);
  }

  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export type NotionSelectOption = { id: string; name: string; color?: string };

export type NotionPropertySchema = {
  id: string;
  name: string;
  type: string;
  select?: { options: NotionSelectOption[] };
  multi_select?: { options: NotionSelectOption[] };
  status?: { options: NotionSelectOption[] };
};

export type NotionDatabase = {
  id: string;
  title: Array<{ plain_text: string }>;
  properties: Record<string, NotionPropertySchema>;
};

export async function getDatabase(databaseId: string): Promise<NotionDatabase> {
  return notionFetch<NotionDatabase>(`/databases/${databaseId}`);
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export type NotionPage = {
  id: string;
  url: string;
  created_time: string;
  properties: Record<string, NotionPropertyValue>;
};

// Only the value shapes we actually read back are typed out.
export type NotionPropertyValue = {
  type: string;
  title?: Array<{ plain_text: string }>;
  rich_text?: Array<{ plain_text: string }>;
  select?: { name: string } | null;
  multi_select?: Array<{ name: string }>;
  status?: { name: string } | null;
  number?: number | null;
  checkbox?: boolean;
  date?: { start: string } | null;
  formula?: { type: string; number?: number | null; string?: string | null };
  created_time?: string;
  last_edited_time?: string;
};

export async function createPage(
  databaseId: string,
  properties: Record<string, unknown>,
): Promise<NotionPage> {
  return notionFetch<NotionPage>("/pages", {
    method: "POST",
    body: { parent: { database_id: databaseId }, properties },
  });
}

export async function updatePage(
  pageId: string,
  properties: Record<string, unknown>,
): Promise<NotionPage> {
  return notionFetch<NotionPage>(`/pages/${pageId}`, {
    method: "PATCH",
    body: { properties },
  });
}

/**
 * Moves a page to Notion's trash. Used when a market sale is voided, so the
 * tracker doesn't keep a row for a sale that didn't happen. Recoverable from
 * Notion's trash for 30 days — this is not a permanent delete.
 */
export async function archivePage(pageId: string): Promise<void> {
  await notionFetch(`/pages/${pageId}`, { method: "PATCH", body: { archived: true } });
}

// Walks every page of results — these databases are small (hundreds of rows).
export async function queryDatabaseAll(
  databaseId: string,
  body: Record<string, unknown> = {},
): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const data = await notionFetch<{
      results: NotionPage[];
      has_more: boolean;
      next_cursor: string | null;
    }>(`/databases/${databaseId}/query`, {
      method: "POST",
      body: { page_size: 100, ...body, ...(cursor ? { start_cursor: cursor } : {}) },
    });
    pages.push(...data.results);
    cursor = data.has_more ? (data.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return pages;
}

// ---------------------------------------------------------------------------
// Reading values out of a page (for the raffle views)
// ---------------------------------------------------------------------------

export function plainText(v: NotionPropertyValue | undefined): string {
  if (!v) return "";
  if (v.title?.length) return v.title.map((t) => t.plain_text).join("");
  if (v.rich_text?.length) return v.rich_text.map((t) => t.plain_text).join("");
  if (v.select) return v.select.name;
  if (v.status) return v.status.name;
  if (v.multi_select?.length) return v.multi_select.map((o) => o.name).join(", ");
  if (v.type === "number") return v.number == null ? "" : String(v.number);
  if (v.date?.start) return v.date.start;
  return "";
}

/**
 * Reads a timestamp out of any of Notion's date-ish types. "Date Claimed" on the
 * raffle DB is a `last_edited_time`, not a `date`, so reaching for `.date.start`
 * alone silently returns nothing.
 */
export function dateValue(v: NotionPropertyValue | undefined): string | null {
  if (!v) return null;
  if (v.type === "date") return v.date?.start ?? null;
  if (v.type === "created_time") return v.created_time ?? null;
  if (v.type === "last_edited_time") return v.last_edited_time ?? null;
  return null;
}

export function numberValue(v: NotionPropertyValue | undefined): number | null {
  if (!v) return null;
  if (v.type === "number") return v.number ?? null;
  if (v.type === "formula" && v.formula?.type === "number") return v.formula.number ?? null;
  const parsed = Number(plainText(v));
  return Number.isFinite(parsed) ? parsed : null;
}

export function checkboxValue(v: NotionPropertyValue | undefined): boolean {
  return v?.type === "checkbox" ? Boolean(v.checkbox) : false;
}

export function multiSelectNames(v: NotionPropertyValue | undefined): string[] {
  return v?.multi_select?.map((o) => o.name) ?? [];
}
