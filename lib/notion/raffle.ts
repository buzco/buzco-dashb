import "server-only";

import {
  checkboxValue,
  dateValue,
  getDatabase,
  multiSelectNames,
  numberValue,
  plainText,
  queryDatabaseAll,
  raffleDbId,
  updatePage,
} from "@/lib/notion/client";
import { buildProperties, findProp } from "@/lib/notion/props";

// The raffle prize register lives in Notion and stays there — it is not
// products/stock, so it never enters the inventory ledger. This module reads it
// so the market screen can answer "which prizes are left" at the stall, and
// writes back only the claim (Claimed / Date Claimed / Winner).
//
// A row is one raffle TICKET: title "Naranja 90" (colour + number), mapped to a
// Prize, with a Value EUR, and "Belongs to" splitting Buzco vs Trying 2 stock.

export type RaffleTicket = {
  pageId: string;
  name: string;
  colour: string;
  prize: string;
  valueEur: number | null;
  claimed: boolean;
  dateClaimed: string | null;
  winner: string;
  belongsTo: string[];
};

const A = {
  colour: ["Colour", "Color", "Cor"],
  claimed: ["Claimed", "Reclamado", "Entregue"],
  dateClaimed: ["Date Claimed", "Data Claimed", "Claimed at", "Data"],
  belongsTo: ["Belongs to", "Belongs", "Brand", "Marca"],
  prize: ["Prize", "Premio", "Prémio"],
  value: ["Value EUR", "Value", "Valor", "Valor EUR"],
  winner: ["Winner", "Vencedor", "Ganhador"],
} as const;

export async function getRaffleTickets(): Promise<RaffleTicket[]> {
  const dbId = raffleDbId();
  const db = await getDatabase(dbId);
  const pages = await queryDatabaseAll(dbId);

  const nameOf = (aliases: readonly string[]) => findProp(db, [...aliases])?.name ?? null;
  const cols = {
    colour: nameOf(A.colour),
    claimed: nameOf(A.claimed),
    dateClaimed: nameOf(A.dateClaimed),
    belongsTo: nameOf(A.belongsTo),
    prize: nameOf(A.prize),
    value: nameOf(A.value),
    winner: nameOf(A.winner),
  };
  const titleCol = Object.values(db.properties).find((p) => p.type === "title")?.name ?? null;

  const get = (page: (typeof pages)[number], col: string | null) =>
    col ? page.properties[col] : undefined;

  return pages.map((page) => ({
    pageId: page.id,
    name: plainText(get(page, titleCol)),
    colour: plainText(get(page, cols.colour)),
    prize: plainText(get(page, cols.prize)) || "Unassigned",
    valueEur: numberValue(get(page, cols.value)),
    claimed: checkboxValue(get(page, cols.claimed)),
    dateClaimed: dateValue(get(page, cols.dateClaimed)),
    winner: plainText(get(page, cols.winner)),
    belongsTo: multiSelectNames(get(page, cols.belongsTo)),
  }));
}

export type PrizeGroup = {
  prize: string;
  unitValue: number | null;
  total: number;
  claimed: number;
  remaining: number;
  /** Value of the prizes still to be given away. */
  remainingValue: number;
  belongsTo: string[];
};

export function groupByPrize(tickets: RaffleTicket[]): PrizeGroup[] {
  const map = new Map<string, PrizeGroup>();

  for (const t of tickets) {
    let g = map.get(t.prize);
    if (!g) {
      g = {
        prize: t.prize,
        unitValue: t.valueEur,
        total: 0,
        claimed: 0,
        remaining: 0,
        remainingValue: 0,
        belongsTo: [],
      };
      map.set(t.prize, g);
    }
    g.total++;
    if (t.claimed) g.claimed++;
    if (g.unitValue == null) g.unitValue = t.valueEur;
    for (const b of t.belongsTo) if (!g.belongsTo.includes(b)) g.belongsTo.push(b);
  }

  for (const g of map.values()) {
    g.remaining = g.total - g.claimed;
    g.remainingValue = g.remaining * (g.unitValue ?? 0);
  }

  // Most valuable prizes first — that's the order you talk about them in.
  return [...map.values()].sort(
    (a, b) => (b.unitValue ?? 0) - (a.unitValue ?? 0) || a.prize.localeCompare(b.prize),
  );
}

/**
 * Marks a ticket claimed (or un-claims it). Note "Date Claimed" is a
 * `last_edited_time` in this database, so it is read-only over the API — Notion
 * stamps it itself on the edit below, which is the behaviour we want anyway.
 */
export async function setTicketClaimed(
  pageId: string,
  claimed: boolean,
  winner?: string | null,
): Promise<void> {
  const db = await getDatabase(raffleDbId());

  const { properties } = buildProperties(db, [
    { aliases: [...A.claimed], value: claimed },
    { aliases: [...A.winner], value: claimed ? (winner?.trim() || null) : null },
  ]);

  // Clearing a claim has to send explicit nulls; buildProperties drops nulls.
  if (!claimed) {
    const dateCol = findProp(db, [...A.dateClaimed]);
    const winnerCol = findProp(db, [...A.winner]);
    if (dateCol?.type === "date") properties[dateCol.name] = { date: null };
    if (winnerCol?.type === "rich_text") properties[winnerCol.name] = { rich_text: [] };
    if (winnerCol?.type === "select") properties[winnerCol.name] = { select: null };
  }

  await updatePage(pageId, properties);
}
