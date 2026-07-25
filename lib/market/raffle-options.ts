// Client-safe raffle constants.
//
// Deliberately separate from raffle-sales.ts: that module is `server-only`
// (it reaches Notion and the database), so importing these from a client
// component through it would drag the Notion client into the browser bundle.
// The button grids need only the shapes below.

/** The three bundles, matching the Notion `Select` options exactly. */
export const RAFFLE_BUNDLES = [
  { id: "1", notionOption: "1 rifa", label: "1 rifa", tickets: 1, price: 1 },
  { id: "6", notionOption: "6 rifas bundle", label: "6 rifas", tickets: 6, price: 5 },
  { id: "12", notionOption: "12 rifas Bundle", label: "12 rifas", tickets: 12, price: 10 },
] as const;

/**
 * Full payment options for the dashboard, matching the Notion `Pago com`
 * select exactly. These name who took the money, which is how Buzco and
 * Trying 2 split takings.
 */
export const RAFFLE_PAYMENTS = [
  { id: "dinheiro-buzco", notionOption: "Dinheiro Buzco", label: "Dinheiro", brand: "Buzco" },
  { id: "dinheiro-trying2", notionOption: "Dinheiro Trying 2", label: "Dinheiro", brand: "Trying 2" },
  { id: "revolut-andre", notionOption: "Revolut Andre", label: "Revolut", brand: "Andre" },
  { id: "revolut-vasco", notionOption: "Revolut Vasco", label: "Revolut", brand: "Vasco" },
] as const;

/**
 * What the shared QR links offer. Helpers working the table shouldn't have to
 * know whose Revolut it is or which brand the cash belongs to — two buttons,
 * no wrong answers. Reconciling to a person happens later in the dashboard.
 */
export const STALL_PAYMENTS = [
  { id: "cash", notionOption: "Cash", label: "Cash" },
  { id: "revolut", notionOption: "Revolut", label: "Revolut" },
  { id: "mbway", notionOption: "MBWAY", label: "MBWAY" },
] as const;

/** Every option any surface can submit. */
export const ALL_RAFFLE_PAYMENTS = [...RAFFLE_PAYMENTS, ...STALL_PAYMENTS];

export type RaffleBundleId = (typeof RAFFLE_BUNDLES)[number]["id"];
export type RafflePaymentId = (typeof ALL_RAFFLE_PAYMENTS)[number]["id"];

export type RaffleBundle = (typeof RAFFLE_BUNDLES)[number];
export type RafflePack = { bundle: RaffleBundle; count: number };

/**
 * Break a ticket count into bundles, largest first.
 *
 * Greedy is genuinely cheapest here rather than merely convenient: a 6-pack
 * (€5) always beats six singles (€6), and a 12-pack is exactly two 6-packs in
 * both tickets and price — so there is no count where taking a smaller bundle
 * first would come out cheaper.
 */
export function packsForTickets(tickets: number): {
  tickets: number;
  packs: RafflePack[];
  total: number;
} {
  const n = Math.max(0, Math.trunc(tickets));
  const largestFirst = [...RAFFLE_BUNDLES].sort((a, b) => b.tickets - a.tickets);

  const packs: RafflePack[] = [];
  let left = n;
  let total = 0;
  for (const bundle of largestFirst) {
    const count = Math.floor(left / bundle.tickets);
    if (count <= 0) continue;
    packs.push({ bundle, count });
    left -= count * bundle.tickets;
    total += count * bundle.price;
  }
  return { tickets: n, packs, total };
}

/**
 * How many more tickets would cost nothing extra. Five singles cost €5, the
 * same as a 6-pack — worth telling the seller so they can offer the extra one
 * instead of the buyer overpaying per ticket.
 */
export function freeUpgradeHint(tickets: number): { extra: number; to: number } | null {
  const here = packsForTickets(tickets);
  for (let extra = 1; extra <= 6; extra++) {
    const bigger = packsForTickets(tickets + extra);
    if (bigger.total <= here.total && bigger.tickets > here.tickets) {
      return { extra, to: bigger.tickets };
    }
  }
  return null;
}
