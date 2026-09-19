// A very small PDF writer — enough for a one-page order sheet, and nothing more.
//
// Written by hand rather than pulled from npm because the only document this
// app produces is a consignation note: headings, a table of garments, totals
// and a block of terms. A PDF library would add megabytes to a serverless
// bundle to draw text in a box.
//
// It uses two of the base-14 fonts every reader already has, so nothing is
// embedded: Helvetica for words and Courier for numbers. Courier is monospaced,
// which is what makes a right-aligned money column line up exactly without
// carrying a font-metrics table for it.

const PAGE_WIDTH = 595.28; // A4 at 72dpi
const PAGE_HEIGHT = 841.89;

export const MARGIN = 48;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

type FontName = "regular" | "bold" | "mono";

const FONT_RES: Record<FontName, string> = {
  regular: "/F1",
  bold: "/F2",
  mono: "/F3",
};

// Helvetica advance widths per 1000 units, for chars 32–126. Used only to
// measure text for centring and right-alignment; anything outside the range
// falls back to the width of a lowercase "o", which is close to the average.
// prettier-ignore
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Width of `text` in points at `size`, for the given font. */
export function textWidth(text: string, size: number, font: FontName = "regular"): number {
  if (font === "mono") return text.length * 0.6 * size;
  let units = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    const w = code >= 32 && code <= 126 ? HELVETICA_WIDTHS[code - 32] : 556;
    units += w;
  }
  // Bold Helvetica runs a few percent wider than regular; close enough for
  // measuring a heading, and no caller right-aligns bold text.
  return (units / 1000) * size * (font === "bold" ? 1.05 : 1);
}

/**
 * PDF strings are Latin-1 with WinAnsiEncoding, so the euro sign lives at 0x80
 * rather than at its Unicode code point, and a few punctuation marks the app
 * uses freely (curly quotes, the middot, en dashes) have their own slots.
 * Anything still outside Latin-1 is dropped rather than emitted as mojibake.
 */
function encodeText(text: string): string {
  const WIN_ANSI: Record<string, string> = {
    "€": "\x80",
    "‚": "\x82",
    "„": "\x84",
    "…": "\x85",
    "‰": "\x89",
    "‹": "\x8b",
    "‘": "\x91",
    "’": "\x92",
    "“": "\x93",
    "”": "\x94",
    "•": "\x95",
    "–": "\x96",
    "—": "\x97",
    "›": "\x9b",
  };

  let out = "";
  for (const ch of text) {
    const mapped = WIN_ANSI[ch];
    if (mapped) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code <= 0xff) out += ch;
    // else: unrepresentable, skip it
  }
  // ( ) and \ end or escape a PDF string literal.
  return out.replace(/([\\()])/g, "\\$1");
}

export type PdfDoc = {
  /** Draw a line of text, top-left origin, y measured DOWN from the top. */
  text: (
    value: string,
    x: number,
    y: number,
    opts?: { size?: number; font?: FontName; align?: "left" | "right" | "center"; gray?: number },
  ) => void;
  /** A horizontal rule across the given span. */
  rule: (x1: number, x2: number, y: number, opts?: { gray?: number }) => void;
  /** Start a new page and return the y to carry on from. */
  newPage: () => number;
  /** Serialise everything drawn so far. */
  build: () => Uint8Array;
};

export function createPdf(): PdfDoc {
  const pages: string[] = [];
  let current = "";

  function push(op: string) {
    current += op + "\n";
  }

  const doc: PdfDoc = {
    text(value, x, y, opts = {}) {
      const size = opts.size ?? 10;
      const font = opts.font ?? "regular";
      const gray = opts.gray ?? 0;

      let drawX = x;
      if (opts.align === "right") drawX = x - textWidth(value, size, font);
      else if (opts.align === "center") drawX = x - textWidth(value, size, font) / 2;

      push("BT");
      push(`${FONT_RES[font]} ${size} Tf`);
      push(`${gray} g`);
      // PDF's origin is bottom-left; every caller thinks in distance from the
      // top, so the flip happens here once instead of at every call site.
      push(`1 0 0 1 ${drawX.toFixed(2)} ${(PAGE_HEIGHT - y).toFixed(2)} Tm`);
      push(`(${encodeText(value)}) Tj`);
      push("ET");
    },

    rule(x1, x2, y, opts = {}) {
      push(`${opts.gray ?? 0.8} G`);
      push("0.5 w");
      push(`${x1.toFixed(2)} ${(PAGE_HEIGHT - y).toFixed(2)} m`);
      push(`${x2.toFixed(2)} ${(PAGE_HEIGHT - y).toFixed(2)} l`);
      push("S");
    },

    newPage() {
      pages.push(current);
      current = "";
      return MARGIN;
    },

    build() {
      const allPages = [...pages, current];

      // Object 1 catalog, 2 pages tree, 3–5 fonts, then two objects per page.
      const objects: string[] = [];
      const pageObjectIds = allPages.map((_, i) => 6 + i * 2);

      objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
      objects[2] =
        `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] ` +
        `/Count ${allPages.length} >>`;
      objects[3] =
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
      objects[4] =
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
      objects[5] =
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>";

      allPages.forEach((content, i) => {
        const pageId = pageObjectIds[i];
        const streamId = pageId + 1;
        objects[pageId] =
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> ` +
          `/Contents ${streamId} 0 R >>`;
        objects[streamId] =
          `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`;
      });

      let out = "%PDF-1.4\n";
      const offsets: number[] = [];
      for (let id = 1; id < objects.length; id++) {
        if (!objects[id]) continue;
        offsets[id] = Buffer.byteLength(out, "latin1");
        out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
      }

      const xrefStart = Buffer.byteLength(out, "latin1");
      const count = objects.length;
      out += `xref\n0 ${count}\n0000000000 65535 f \n`;
      for (let id = 1; id < count; id++) {
        const offset = offsets[id] ?? 0;
        out += `${String(offset).padStart(10, "0")} 00000 n \n`;
      }
      out += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

      return new Uint8Array(Buffer.from(out, "latin1"));
    },
  };

  return doc;
}

/**
 * Break `text` into lines that fit `width`, so a long note doesn't run off the
 * page. Splits on spaces; a single word longer than the line is left to
 * overflow rather than being chopped mid-word.
 */
export function wrapText(
  text: string,
  width: number,
  size: number,
  font: FontName = "regular",
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, font) > width && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}
