import "server-only";

import { getDatabase, salesDbId, type NotionDatabase } from "@/lib/notion/client";
import { findProp } from "@/lib/notion/props";

// Grouping payments by person is pure string work the client needs too, so it
// lives outside this `server-only` module and is re-exported for the callers
// that already import their option helpers from here.
export {
  ownerOf,
  groupPaymentOptions,
  PAYMENT_OWNERS,
  type PaymentGroup,
} from "@/lib/sales/payment-owner";

// The sales logger's dropdowns are the Notion tracker's own option lists.
//
// This is not cosmetic. Every option the app offers gets written straight into
// Notion, and Notion AUTO-CREATES a select option it has never seen — so an
// invented label doesn't fail loudly, it quietly pollutes a curated list that
// someone maintains by hand ("Mbway André" vs "Mbway Andre" vs "MBWay André").
// Reading the live options is what keeps the two in step.
//
// Never throws: Notion being unreachable must not stop a sale being logged, so
// every getter falls back to the options observed on the live database
// (verified 2026-09-18). A stale fallback is a labelling problem; a thrown
// error at the till is a lost sale.

export type SalesOptions = {
  /** "Where" — the channel/venue the tracker files the sale under. */
  where: string[];
  /** "Status" — Pago / Por pagar / Oferta … (a multi_select in their DB). */
  status: string[];
  /** "Método pagamento " — note the trailing space in the real column name. */
  payment: string[];
  /** "Size" — XS…XL plus N/A for non-apparel. */
  size: string[];
  /** True when these came from Notion rather than the baked-in fallback. */
  live: boolean;
};

// Observed on Sales Tracker 2025 on 2026-09-18. Only used when Notion can't be
// reached; the moment it can, the live lists win.
const FALLBACK: Omit<SalesOptions, "live"> = {
  where: ["Online", "Feira", "Physical", "Cyber Feira", "Cyber Loja", "Ladra"],
  status: ["Pago", "Por pagar", "Oferta", "Por entregar"],
  payment: [
    "Cash",
    "Revolut",
    "MBWAY",
    "Mbway André",
    "Cash André",
    "Transf Bancária",
    "Shopify",
    "Consignation",
    "N/A",
  ],
  size: ["XS", "S", "M", "L", "XL", "N/A"],
};

// The aliases each logical field is willing to answer to, same approach as
// lib/notion/sales.ts: the columns are user-editable, so a rename should
// degrade to the fallback rather than silently write nothing.
const ALIASES = {
  where: ["Where", "Onde", "Local", "Channel", "Canal"],
  status: ["Status", "Estado"],
  payment: [
    "Método pagamento",
    "Metodo pagamento",
    "Metodo de pagamento",
    "Payment method",
    "Pagamento",
  ],
  size: ["Size", "Tamanho", "Talla"],
} as const;

/** Every option list on a property, whichever select-ish type it turned out to be. */
function optionsOf(db: NotionDatabase, aliases: readonly string[]): string[] {
  const prop = findProp(db, [...aliases]);
  if (!prop) return [];
  return (
    prop.select?.options ??
    prop.multi_select?.options ??
    prop.status?.options ??
    []
  ).map((o) => o.name);
}

const CACHE_MS = 10 * 60 * 1000;
let cache: { value: SalesOptions; at: number } | null = null;

/**
 * The live option lists, cached for ten minutes.
 *
 * Cached because the logger is opened over and over during a market and each
 * open would otherwise cost a round trip to Notion before the first product
 * appears. Ten minutes is short enough that adding an option in Notion shows up
 * within one coffee, and long enough that a busy hour is one fetch.
 */
export async function getSalesOptions(): Promise<SalesOptions> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  try {
    const db = await getDatabase(salesDbId());
    const value: SalesOptions = {
      where: optionsOf(db, ALIASES.where),
      status: optionsOf(db, ALIASES.status),
      payment: optionsOf(db, ALIASES.payment),
      size: optionsOf(db, ALIASES.size),
      live: true,
    };
    // A property that resolved but has no options is a real answer; a property
    // that didn't resolve at all is not, so fill those from the fallback.
    if (!value.where.length) value.where = FALLBACK.where;
    if (!value.status.length) value.status = FALLBACK.status;
    if (!value.payment.length) value.payment = FALLBACK.payment;
    if (!value.size.length) value.size = FALLBACK.size;

    cache = { value, at: Date.now() };
    return value;
  } catch {
    return { ...FALLBACK, live: false };
  }
}

/** Forget the cached lists — used after the user edits options in Notion. */
export function clearSalesOptionsCache(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// The handful of options the app has an opinion about
// ---------------------------------------------------------------------------

/**
 * Their tracker already carries a "Consignation" payment option, which is
 * exactly right: a consigned batch has no payment method yet, and saying so in
 * the column meant for it beats leaving it blank or inventing "Pending".
 */
export const CONSIGNATION_PAYMENT = "Consignation";

/**
 * The payment options worth OFFERING a person.
 *
 * "Consignation" is dropped: it is the marker the app writes itself while a
 * batch is unpaid, so picking it for money actually received would record
 * "paid with Consignation", and picking it when settling would undo the very
 * thing settling is for. It stays in the list Notion keeps and in what the
 * mirror writes — it just isn't a choice.
 */
export function payableOptions(options: string[]): string[] {
  return options.filter((o) => !sameOption(o, CONSIGNATION_PAYMENT));
}

/**
 * Status values, matched case/accent-insensitively against the live list.
 *
 * Status is a multi-select and they already use it for two things at once:
 * one of paid/pending/gift, plus "SOLD" on consigned stock the shop has sold
 * but not yet paid us for. 46 pieces are at Cybercafé on that convention as of
 * 2026-09-19 — hence no separate "sold" column, which would split one fact
 * across two places and strand the rows already tagged this way.
 */
export const STATUS = {
  paid: "Pago",
  pending: "Por pagar",
  gift: "Oferta",
  sold: "SOLD",
} as const;

/**
 * Notion's options are typed by hand, so "Mbway André" and "MBWay Andre " are
 * the same option to a person. Comparisons here ignore case, accents, spacing
 * and punctuation for that reason.
 */
function normalizeOption(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Whether two option labels mean the same thing. */
export function sameOption(a: string, b: string): boolean {
  return normalizeOption(a) === normalizeOption(b);
}

/**
 * Pick the live option that means the same thing as `wanted`, so the app writes
 * the tracker's own spelling. Falls back to `wanted` — Notion will create it,
 * which is the right outcome when the option genuinely doesn't exist yet.
 */
export function matchOption(options: string[], wanted: string): string {
  return options.find((o) => sameOption(o, wanted)) ?? wanted;
}
