import "server-only";

import { createPage, getDatabase, salesDbId, type NotionDatabase } from "@/lib/notion/client";
import { buildProperties } from "@/lib/notion/props";

// Mirrors a market sale into the Notion "Sales Tracker" database.
//
// One page PER GARMENT SOLD, not per sale row: the tracker is kept by hand as
// one row per physical item (see the Size column), so a POS line for 2 tees
// becomes 2 pages, each carrying the unit price. Notion is a mirror for
// reporting — our Postgres `sales` table stays the source of truth, and a
// Notion outage must never block recording a sale.

export type NotionSaleItem = {
  productName: string;
  size: string | null;
  colour: string | null;
  sku: string | null;
  /** Price of ONE garment, after the market discount. */
  unitPrice: number;
  quantity: number;
  /** "Pago" | "Por pagar" | "Oferta" — matched against the DB's own options. */
  status: string;
  /** Payment method label, e.g. "Cash", "Card (POS)", "Mbway André". */
  paymentMethod: string | null;
  /** Free-text row label — this DB's title property is "Notes". */
  title: string;
  soldAt: string;
};

// Column names differ by language/spelling, so each logical field lists the
// variants we're willing to match. Resolution is accent/case-insensitive.
const ALIASES = {
  product: ["Artigo", "Artigos", "Produto", "Product", "Item"],
  size: ["Size", "Tamanho", "Talla"],
  colour: ["Colour", "Color", "Cor"],
  sku: ["SKU", "Ref", "Referencia"],
  where: ["Where", "Onde", "Local", "Channel", "Canal"],
  status: ["Status", "Estado"],
  payment: ["Método pagamento", "Metodo pagamento", "Metodo de pagamento", "Payment method", "Pagamento"],
  value: ["Valor", "Value", "Amount", "Preco", "Preço", "Price"],
  quantity: ["Quantity", "Qty", "Qtd", "Quantidade"],
  market: ["Market", "Event", "Evento", "Feira"],
  soldAt: ["Sold at", "Data", "Date", "Data venda"],
} as const;

export type NotionSyncResult = {
  pageIds: string[];
  /** Fields that had a value but no matching writable column in Notion. */
  skippedFields: string[];
};

export async function createSalePages(item: NotionSaleItem): Promise<NotionSyncResult> {
  const db = await getDatabase(salesDbId());
  return createSalePagesWithSchema(db, item);
}

/** Same, but reusing an already-fetched schema (bulk POS imports fetch once). */
export async function createSalePagesWithSchema(
  db: NotionDatabase,
  item: NotionSaleItem,
): Promise<NotionSyncResult> {
  const units = Math.max(1, Math.trunc(item.quantity));
  const pageIds: string[] = [];
  const skipped = new Set<string>();

  for (let i = 0; i < units; i++) {
    // Number multi-unit lines so the rows are distinguishable at a glance.
    const title = units > 1 ? `${item.title} (${i + 1}/${units})` : item.title;

    const { properties, skipped: missed } = buildProperties(db, [
      { aliases: ["Notes", "Note", "Notas"], value: title, isTitle: true },
      { aliases: [...ALIASES.product], value: item.productName },
      { aliases: [...ALIASES.size], value: item.size },
      { aliases: [...ALIASES.colour], value: item.colour },
      { aliases: [...ALIASES.sku], value: item.sku },
      { aliases: [...ALIASES.where], value: "Physical" },
      { aliases: [...ALIASES.status], value: item.status },
      { aliases: [...ALIASES.payment], value: item.paymentMethod },
      { aliases: [...ALIASES.value], value: item.unitPrice },
      { aliases: [...ALIASES.quantity], value: 1 },
      { aliases: [...ALIASES.soldAt], value: new Date(item.soldAt) },
    ]);

    missed.forEach((m) => skipped.add(m));
    const page = await createPage(salesDbId(), properties);
    pageIds.push(page.id);
  }

  return { pageIds, skippedFields: [...skipped] };
}

// The tracker's "Método pagamento" options are curated and person-specific
// ("Mbway André", "Cash Miguel", "Shopify"…). Inventing labels like "Card (POS)"
// would auto-create junk options, so the sell sheet offers the REAL ones. Cached
// because the stall screen must not wait on Notion to render.
const OPTION_CACHE_MS = 10 * 60 * 1000;
let paymentOptionCache: { options: string[]; at: number } | null = null;

/** Existing payment-method options, newest cache within 10 minutes. Never throws. */
export async function getPaymentMethodOptions(): Promise<string[]> {
  if (paymentOptionCache && Date.now() - paymentOptionCache.at < OPTION_CACHE_MS) {
    return paymentOptionCache.options;
  }
  try {
    const db = await getDatabase(salesDbId());
    const { findProp } = await import("@/lib/notion/props");
    const prop = findProp(db, [...ALIASES.payment]);
    const options = prop?.select?.options?.map((o) => o.name) ?? [];
    if (options.length) paymentOptionCache = { options, at: Date.now() };
    return options;
  } catch {
    return [];
  }
}

/**
 * Reports which of our logical fields the live Notion schema can actually
 * receive — shown on the market page so a renamed column is visible before an
 * event rather than discovered afterwards.
 */
export async function describeSalesMapping(): Promise<
  Array<{ field: string; notionColumn: string | null; notionType: string | null }>
> {
  const db = await getDatabase(salesDbId());
  const { findProp, findTitleProp } = await import("@/lib/notion/props");

  const titleProp = findTitleProp(db);
  const rows: Array<{ field: string; notionColumn: string | null; notionType: string | null }> = [
    { field: "Row label", notionColumn: titleProp?.name ?? null, notionType: titleProp?.type ?? null },
  ];

  const checks: Array<[string, readonly string[]]> = [
    ["Product", ALIASES.product],
    ["Size", ALIASES.size],
    ["Where", ALIASES.where],
    ["Status", ALIASES.status],
    ["Payment method", ALIASES.payment],
    ["Value", ALIASES.value],
  ];

  for (const [field, aliases] of checks) {
    const prop = findProp(db, [...aliases]);
    rows.push({ field, notionColumn: prop?.name ?? null, notionType: prop?.type ?? null });
  }

  return rows;
}
