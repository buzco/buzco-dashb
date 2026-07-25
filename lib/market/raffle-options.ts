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

/** Payment options, matching the Notion `Pago com` select exactly. */
export const RAFFLE_PAYMENTS = [
  { id: "dinheiro-buzco", notionOption: "Dinheiro Buzco", label: "Dinheiro", brand: "Buzco" },
  { id: "dinheiro-trying2", notionOption: "Dinheiro Trying 2", label: "Dinheiro", brand: "Trying 2" },
  { id: "revolut-andre", notionOption: "Revolut Andre", label: "Revolut", brand: "Andre" },
  { id: "revolut-vasco", notionOption: "Revolut Vasco", label: "Revolut", brand: "Vasco" },
] as const;

export type RaffleBundleId = (typeof RAFFLE_BUNDLES)[number]["id"];
export type RafflePaymentId = (typeof RAFFLE_PAYMENTS)[number]["id"];
