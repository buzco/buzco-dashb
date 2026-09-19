import "server-only";

import { queryDatabaseAll, salesDbId, plainText, multiSelectNames } from "@/lib/notion/client";
import { CONSIGNATION_PAYMENT, STATUS, sameOption } from "@/lib/notion/options";
import { colourTokenFromText } from "@/lib/colourways";
import type { createClient } from "@/lib/supabase/server";

// Backfills consignations that were recorded in Notion by hand, before the app
// could hold them — the 46 pieces sitting at Cybercafé as of 2026-09-19.
//
// Two decisions worth knowing:
//
// 1. It writes NO stock movements and NO Shopify order. Those garments left
//    months ago and whatever Shopify and the ledger say about them today
//    already reflects that. Creating movements now would deduct them a second
//    time. This is the same call lib/shopify/orders.ts makes for imported
//    order history, and for the same reason.
//
// 2. It carries each row's Notion page id onto the sale, so the mirror treats
//    the line as already synced and never creates a duplicate page. Marking a
//    piece sold later updates that same page, which is exactly what should
//    happen to a row someone typed by hand.
//
// Idempotent: a Notion page already imported is skipped, so running it twice
// changes nothing.

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

export type ConsignmentImportResult = {
  scanned: number;
  ordersCreated: number;
  linesCreated: number;
  skippedAlreadyImported: number;
  /** Notion rows whose product/size doesn't match a variant here. */
  unmatched: string[];
  errors: string[];
};

type NotionConsignRow = {
  pageId: string;
  created: string;
  product: string;
  size: string;
  where: string;
  sold: boolean;
};

/** A Notion row that represents consigned stock rather than a completed sale. */
function isConsignmentRow(payment: string, where: string): boolean {
  return sameOption(payment, CONSIGNATION_PAYMENT) || /cyber/i.test(where);
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

export async function importNotionConsignments(
  supabase: SupabaseLike,
  options: { since: string; retailerId: string; dryRun?: boolean },
): Promise<ConsignmentImportResult> {
  const result: ConsignmentImportResult = {
    scanned: 0,
    ordersCreated: 0,
    linesCreated: 0,
    skippedAlreadyImported: 0,
    unmatched: [],
    errors: [],
  };

  const pages = await queryDatabaseAll(salesDbId());

  const rows: NotionConsignRow[] = [];
  for (const page of pages) {
    const created = page.created_time.slice(0, 10);
    if (created < options.since) continue;

    const payment = plainText(page.properties["Método pagamento "] ?? page.properties["Método pagamento"]);
    const where = plainText(page.properties["Where"]);
    if (!isConsignmentRow(payment, where)) continue;

    const statuses = multiSelectNames(page.properties["Status"]);
    rows.push({
      pageId: page.id,
      created,
      product: plainText(page.properties["Artigo"]),
      size: plainText(page.properties["Size"]),
      where,
      sold: statuses.some((s) => sameOption(s, STATUS.sold)),
    });
  }
  result.scanned = rows.length;
  if (!rows.length) return result;

  // Already-imported pages, so a second run is a no-op.
  const { data: existing } = await supabase
    .from("sales")
    .select("notion_page_id")
    .not("notion_page_id", "is", null);
  const imported = new Set(
    (existing ?? []).flatMap((s) => (s.notion_page_id ?? "").split(",").filter(Boolean)),
  );

  // Match Notion's free-text product + size to a real variant. Notion's "Artigo"
  // is a curated select whose names match our product names, so this is a
  // straight lookup rather than fuzzy matching — anything that misses is
  // reported rather than guessed at.
  const { data: variants } = await supabase
    .from("variants")
    .select("id, sku, size, products ( name )");
  const allVariants = (variants ?? []) as unknown as Array<{
    id: string;
    sku: string;
    size: string | null;
    products: { name: string } | null;
  }>;

  const variantKey = new Map<string, string>();
  for (const v of allVariants) {
    if (!v.products?.name) continue;
    variantKey.set(`${norm(v.products.name)}|${norm(v.size ?? "")}`, v.id);
  }

  /**
   * Resolve a Notion product+size to a variant. Exact name first; failing that,
   * the colourway route for products whose name collides (see lib/colourways.ts).
   * An ambiguous colour match is reported rather than guessed at — picking one
   * of two candidates would silently consign the wrong garment.
   */
  function findVariant(product: string, size: string): string | null {
    const exact = variantKey.get(`${norm(product)}|${norm(size)}`);
    if (exact) return exact;

    // Three Butterfly products share one title; the colourway is only in the
    // SKU. See lib/colourways.ts.
    const token = colourTokenFromText(product);
    if (!token) return null;

    const firstWord = norm(product).split(/\s+/)[0];
    const candidates = allVariants.filter(
      (v) =>
        v.products?.name &&
        norm(v.products.name).startsWith(firstWord) &&
        norm(v.size ?? "") === norm(size) &&
        v.sku.toUpperCase().includes(token),
    );
    return candidates.length === 1 ? candidates[0].id : null;
  }

  const { data: location } = await supabase
    .from("inventory_locations")
    .select("id")
    .eq("type", "shopify")
    .limit(1)
    .maybeSingle();
  if (!location) {
    result.errors.push("No Shopify stock location — run a Shopify sync first");
    return result;
  }

  // One order per drop date: that is how they physically went out, and it is
  // what makes a printable note per delivery possible.
  const byDate = new Map<string, NotionConsignRow[]>();
  for (const row of rows) {
    if (imported.has(row.pageId)) {
      result.skippedAlreadyImported++;
      continue;
    }
    const key = row.created;
    byDate.set(key, [...(byDate.get(key) ?? []), row]);
  }

  for (const [date, drop] of [...byDate.entries()].sort()) {
    const matched: Array<{ row: NotionConsignRow; variantId: string }> = [];
    for (const row of drop) {
      const variantId = findVariant(row.product, row.size);
      if (!variantId) {
        const label = `${row.product} ${row.size}`.trim();
        if (!result.unmatched.includes(label)) result.unmatched.push(label);
        continue;
      }
      matched.push({ row, variantId });
    }
    if (!matched.length) continue;
    if (options.dryRun) {
      result.ordersCreated++;
      result.linesCreated += matched.length;
      continue;
    }

    try {
      // Written directly rather than through log_sale_order, because that
      // function's whole job is to move stock — which is exactly what this
      // import must not do.
      const { data: order, error: orderError } = await supabase
        .from("sale_orders")
        .insert({
          kind: "consignment",
          reference: `CNS-N${date.replace(/-/g, "").slice(2)}`,
          channel: "wholesale",
          retailer_id: options.retailerId,
          where_sold: drop[0].where || "Cyber Loja",
          payment_status: "pending",
          payment_method: CONSIGNATION_PAYMENT,
          notes: `Imported from the Notion tracker (drop of ${date}).`,
          created_at: `${date}T12:00:00Z`,
        })
        .select("id")
        .single();
      if (orderError) throw new Error(orderError.message);

      const { error: linesError } = await supabase.from("sales").insert(
        matched.map(({ row, variantId }) => ({
          channel: "wholesale" as const,
          variant_id: variantId,
          quantity: 1, // the tracker is one row per physical garment
          gross_amount: 0, // priced at settlement; the tracker carries no consigned price
          sale_order_id: order.id,
          payment_method: CONSIGNATION_PAYMENT,
          customer_ref: "Cybercafé",
          sold_at: `${date}T12:00:00Z`,
          consignment_sold_at: row.sold ? `${date}T12:00:00Z` : null,
          // Claiming the existing page stops the mirror writing a duplicate.
          notion_page_id: row.pageId,
          notion_synced_at: new Date().toISOString(),
        })),
      );
      if (linesError) throw new Error(linesError.message);

      result.ordersCreated++;
      result.linesCreated += matched.length;
    } catch (e) {
      result.errors.push(`${date}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}
