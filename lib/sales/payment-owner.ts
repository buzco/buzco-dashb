// Who a payment method belongs to.
//
// Their payment options are one method crossed with one person — "Cash André",
// "Mbway Miguel", "Revolut Miguel" — so a flat list of sixteen is really a
// short list repeated per person, and both the till and the sales table group
// by that. Kept out of lib/notion/options.ts, which is `server-only`: this is
// pure string work and the client needs it too.

/** The people and entities whose accounts the money can land in. */
export const PAYMENT_OWNERS = ["André", "Miguel", "Buzco", "Trying2", "Gr8Success"] as const;

/**
 * Ignores case, accents, spacing and punctuation, so "Revolut Andre" and
 * "Revolut André" land in the same group — the tracker's options are typed by
 * hand and both spellings exist.
 */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Which owner an option names, or null when it belongs to nobody. */
export function ownerOf(option: string): string | null {
  const words = normalize(option).split(" ");
  return PAYMENT_OWNERS.find((owner) => words.includes(normalize(owner))) ?? null;
}

export type PaymentGroup = {
  /** The person or entity, or null for the ones that belong to nobody. */
  owner: string | null;
  options: string[];
};

/**
 * Split payment options into one group per person, shared methods first.
 *
 * Shared leads because that is where the common answers live — Cash, MBWAY,
 * Shopify, N/A — and a seller reaching for "Cash" shouldn't have to pick a
 * person's section to find it. Groups follow the order the owners are declared
 * in rather than the order Notion returns, so the menu doesn't reshuffle when
 * someone adds an option.
 */
export function groupPaymentOptions(options: string[]): PaymentGroup[] {
  const groups: PaymentGroup[] = [{ owner: null, options: [] }];
  for (const owner of PAYMENT_OWNERS) groups.push({ owner, options: [] });

  for (const option of options) {
    const owner = ownerOf(option);
    const group = groups.find((g) => g.owner === owner) ?? groups[0];
    group.options.push(option);
  }
  return groups.filter((g) => g.options.length);
}
