// Colourways that exist only in the SKU.
//
// Three Shopify products share the title "Butterfly Thermal Waffle Longsleeve"
// — one per colourway — and none of them carries a Colour option, so Shopify
// reports `selectedOptions` of Size alone and `variants.color` syncs as null.
// The colourway survives in two places: the SKU token (BWAF-**BEI**-3) and the
// product handle (butterfly-thermal-longsleeve-**beige**).
//
// The SKU is the one this reads, because it is the field both this app and the
// Notion tracker already key on, and because a handle can be edited for SEO
// without anyone thinking about stock.
//
// Kept deliberately small and explicit rather than "guess the middle token":
// most SKUs here are product codes (TS-CAPY-3, SUPENT-4, KC-LOGO), so a general
// rule would invent colours for garments that do not have them.

export type Colourway = {
  /** The token as it appears inside a SKU. */
  token: string;
  /** What the app should display. */
  name: string;
  /** What a human might have typed for it, in either language. */
  aliases: string[];
};

// Names are English to match the storefront titles and the product handles.
// The aliases carry the Portuguese, because the Notion tracker is kept by hand
// in it — "Butterfly Preta" has to find a BWAF-BLK garment.
export const COLOURWAYS: Colourway[] = [
  { token: "BEI", name: "Beige", aliases: ["beige", "bege"] },
  { token: "BLK", name: "Black", aliases: ["black", "preta", "preto", "noir"] },
  { token: "PRP", name: "Purple", aliases: ["purple", "roxa", "roxo", "purpura"] },
];

function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * The colourway a SKU belongs to, matched on a dash-separated token so that
 * "BWAF-BEI-3" resolves but a product code that merely contains those three
 * letters does not.
 */
export function colourFromSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const parts = sku.toUpperCase().split(/[-_\s]+/);
  return COLOURWAYS.find((c) => parts.includes(c.token))?.name ?? null;
}

/**
 * The SKU token for a colour word appearing anywhere in `text` — used to match
 * the Notion tracker's "Butterfly Preta" onto a BWAF-BLK SKU.
 */
export function colourTokenFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const words = normalise(text).split(/\s+/);
  return (
    COLOURWAYS.find((c) => c.aliases.some((a) => words.includes(a)))?.token ?? null
  );
}
