import "server-only";

import { createPdf, wrapText, MARGIN, CONTENT_WIDTH } from "@/lib/pdf/simple-pdf";
import type { SaleOrderView } from "@/lib/sales/data";

// The document a shop actually receives with the box: what was left with them,
// at what price, and on what terms.
//
// It is generated from the same order the dashboard shows, so the sheet and the
// ledger can never disagree — there is no second place to keep the quantities.

/**
 * The standing terms printed on every consignation note.
 *
 * Kept here as plain text rather than in the database because they are the same
 * on every note and changing them is a deliberate act, not data entry. The
 * order's own notes are printed underneath, for anything specific to that drop.
 */
export const CONSIGNMENT_TERMS = [
  "Goods remain the property of Buzco / Gr8 Success until paid for in full.",
  "Payment is due on the agreed settlement date for every piece sold; unsold pieces may be returned in original condition.",
  "Please keep pieces folded, tagged and away from direct sunlight while on display.",
  "Report any damaged or lost piece as soon as it is noticed — damaged stock is invoiced at the unit price below.",
  "Report sold quantities before settlement so stock can be reconciled on both sides.",
];

const PAGE_BOTTOM = 780;

function euro(n: number): string {
  return `€${n.toFixed(2)}`;
}

export function buildConsignmentNote(order: SaleOrderView): Uint8Array {
  const doc = createPdf();
  const right = MARGIN + CONTENT_WIDTH;
  let y = MARGIN;

  // --- Header ---
  doc.text("BUZCO", MARGIN, y + 10, { size: 20, font: "bold" });
  doc.text("gr8success.xyz", MARGIN, y + 24, { size: 9, gray: 0.45 });

  doc.text("CONSIGNATION NOTE", right, y + 8, { size: 11, font: "bold", align: "right" });
  doc.text(order.reference, right, y + 22, { size: 10, font: "mono", align: "right" });
  doc.text(new Date(order.createdAt).toLocaleDateString("en-GB"), right, y + 34, {
    size: 9,
    align: "right",
    gray: 0.45,
  });

  y += 52;
  doc.rule(MARGIN, right, y);
  y += 22;

  // --- Who it's for ---
  doc.text("CONSIGNED TO", MARGIN, y, { size: 8, font: "bold", gray: 0.45 });
  y += 14;
  doc.text(order.retailerName ?? order.customerName ?? "—", MARGIN, y, {
    size: 12,
    font: "bold",
  });
  const contact = [order.retailerEmail, order.whereSold].filter(Boolean).join("  ·  ");
  if (contact) {
    y += 13;
    doc.text(contact, MARGIN, y, { size: 9, gray: 0.45 });
  }

  // Status stated plainly on the right, because the whole point of the document
  // is that these goods are not yet paid for.
  doc.text("STATUS", right, y - 13, { size: 8, font: "bold", gray: 0.45, align: "right" });
  doc.text(
    order.paymentStatus === "paid"
      ? `Settled ${order.settledAt ? new Date(order.settledAt).toLocaleDateString("en-GB") : ""}`.trim()
      : "Payment pending",
    right,
    y,
    { size: 11, font: "bold", align: "right" },
  );

  y += 28;

  // --- Line table ---
  // The three money-ish columns are right EDGES (their contents are
  // right-aligned); the first three are left edges. Spacing is set so a
  // four-figure total and a 16-character SKU still can't touch.
  const cols = {
    item: MARGIN,
    size: MARGIN + 205,
    sku: MARGIN + 245,
    qtyRight: MARGIN + 365,
    unitRight: MARGIN + 425,
    totalRight: right,
  };

  doc.rule(MARGIN, right, y);
  y += 13;
  doc.text("ITEM", cols.item, y, { size: 8, font: "bold", gray: 0.45 });
  doc.text("SIZE", cols.size, y, { size: 8, font: "bold", gray: 0.45 });
  doc.text("SKU", cols.sku, y, { size: 8, font: "bold", gray: 0.45 });
  doc.text("QTY", cols.qtyRight, y, { size: 8, font: "bold", gray: 0.45, align: "right" });
  doc.text("UNIT", cols.unitRight, y, { size: 8, font: "bold", gray: 0.45, align: "right" });
  doc.text("TOTAL", cols.totalRight, y, { size: 8, font: "bold", gray: 0.45, align: "right" });
  y += 6;
  doc.rule(MARGIN, right, y);
  y += 16;

  for (const line of order.lines) {
    if (y > PAGE_BOTTOM) y = doc.newPage();

    const unit = line.quantity ? line.netAmount / line.quantity : 0;
    doc.text(truncate(line.productName, 36), cols.item, y, { size: 10 });
    doc.text(line.size ?? line.color ?? "—", cols.size, y, { size: 10 });
    doc.text(truncate(line.sku, 16), cols.sku, y, { size: 9, font: "mono", gray: 0.4 });
    if (line.soldAt) {
      // Marks what the shop has already shifted, so a settlement conversation
      // has the same list on both sides of the table. On the row's OWN
      // baseline: set below it, at half the row spacing, it read as belonging
      // to the line underneath.
      doc.text("sold", cols.size - 10, y, { size: 8, gray: 0.5, align: "right" });
    }
    doc.text(String(line.quantity), cols.qtyRight, y, { size: 10, font: "mono", align: "right" });
    doc.text(line.isFreebie ? "free" : euro(unit), cols.unitRight, y, {
      size: 10,
      font: "mono",
      align: "right",
    });
    doc.text(euro(line.netAmount), cols.totalRight, y, { size: 10, font: "mono", align: "right" });
    y += 18;
  }

  y += 2;
  doc.rule(MARGIN, right, y);
  y += 18;

  // --- Totals ---
  // Wide enough for the longest label ("Due for pieces sold" in bold) plus a
  // four-figure amount. At 120 the two ran into each other.
  const totalsX = right - 210;
  doc.text("Pieces", totalsX, y, { size: 9, gray: 0.45 });
  doc.text(String(order.units), right, y, { size: 10, font: "mono", align: "right" });
  y += 15;

  if (order.discount > 0) {
    doc.text("Subtotal", totalsX, y, { size: 9, gray: 0.45 });
    doc.text(euro(order.gross), right, y, { size: 10, font: "mono", align: "right" });
    y += 15;
    doc.text(
      order.discountKind === "percent" ? `Discount (${order.discountValue}%)` : "Discount",
      totalsX,
      y,
      { size: 9, gray: 0.45 },
    );
    doc.text(`-${euro(order.discount)}`, right, y, { size: 10, font: "mono", align: "right" });
    y += 15;
  }

  // "Total due" would be wrong on a note that travels WITH the delivery: none
  // of it is owed until the shop sells it. The batch's value is stated, and what
  // is actually owed only appears once something has sold.
  const label =
    order.paymentStatus === "paid"
      ? "Total paid"
      : order.kind === "consignment"
        ? "Value of goods"
        : "Total due";
  doc.text(label, totalsX, y + 2, { size: 10, font: "bold" });
  doc.text(euro(order.net), right, y + 2, { size: 12, font: "mono", align: "right" });
  y += 20;

  if (order.paymentStatus === "pending" && order.owed > 0) {
    doc.text("Due for pieces sold", totalsX, y + 2, { size: 10, font: "bold" });
    doc.text(euro(order.owed), right, y + 2, { size: 12, font: "mono", align: "right" });
    y += 20;
  }
  y += 14;

  // --- Terms ---
  if (y > PAGE_BOTTOM - 140) y = doc.newPage();

  doc.rule(MARGIN, right, y);
  y += 16;
  doc.text("TERMS", MARGIN, y, { size: 8, font: "bold", gray: 0.45 });
  y += 16;

  for (const [i, term] of CONSIGNMENT_TERMS.entries()) {
    const lines = wrapText(term, CONTENT_WIDTH - 18, 9);
    for (const [j, text] of lines.entries()) {
      if (y > PAGE_BOTTOM) y = doc.newPage();
      if (j === 0) doc.text(`${i + 1}.`, MARGIN, y, { size: 9, gray: 0.45 });
      doc.text(text, MARGIN + 18, y, { size: 9, gray: 0.2 });
      y += 12;
    }
    y += 3;
  }

  if (order.notes) {
    y += 8;
    doc.text("NOTES ON THIS ORDER", MARGIN, y, { size: 8, font: "bold", gray: 0.45 });
    y += 14;
    for (const text of wrapText(order.notes, CONTENT_WIDTH, 9)) {
      if (y > PAGE_BOTTOM) y = doc.newPage();
      doc.text(text, MARGIN, y, { size: 9, gray: 0.2 });
      y += 12;
    }
  }

  // --- Signatures ---
  if (y > PAGE_BOTTOM - 60) y = doc.newPage();
  y = Math.max(y + 30, PAGE_BOTTOM - 40);

  const half = MARGIN + CONTENT_WIDTH / 2 - 20;
  doc.rule(MARGIN, half, y);
  doc.rule(half + 40, right, y);
  y += 12;
  doc.text("Buzco / Gr8 Success", MARGIN, y, { size: 8, gray: 0.45 });
  doc.text("Received by", half + 40, y, { size: 8, gray: 0.45 });

  return doc.build();
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** `Buzco-CNS-0007-Cybercafe.pdf` — safe on every filesystem. */
export function consignmentNoteFilename(order: SaleOrderView): string {
  const who = (order.retailerName ?? order.customerName ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ["Buzco", order.reference, who].filter(Boolean).join("-") + ".pdf";
}
