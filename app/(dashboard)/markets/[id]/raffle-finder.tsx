"use client";

import { useMemo, useState, useTransition } from "react";
import { claimRaffleTicket } from "@/lib/actions/markets";
import type { RaffleTicket } from "@/lib/notion/raffle";

// Someone hands you a ticket: "Rosa 46". Pick the colour, type the number, see
// the prize, hand it over, press Claim. That's the whole interaction, and it has
// to work with one hand while holding a tote bag.

export function RaffleTicketFinder({
  eventId,
  tickets,
}: {
  eventId: string;
  tickets: RaffleTicket[];
}) {
  const [colour, setColour] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [winner, setWinner] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const colours = useMemo(
    () => [...new Set(tickets.map((t) => t.colour).filter(Boolean))].sort(),
    [tickets],
  );

  const matches = useMemo(() => {
    const digits = number.trim();
    if (!digits && !colour) return [];
    return tickets
      .filter((t) => (colour ? t.colour === colour : true))
      .filter((t) => (digits ? t.name.replace(/\D/g, "").includes(digits) : true))
      .slice(0, 12);
  }, [tickets, colour, number]);

  const claim = (pageId: string) => {
    setError(null);
    const formData = new FormData();
    formData.set("page_id", pageId);
    formData.set("winner", winner);
    startTransition(async () => {
      try {
        await claimRaffleTicket(eventId, formData);
        setNumber("");
        setWinner("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="label-caps text-ink/60">Look up a ticket</h2>

      <div className="flex flex-wrap gap-2">
        {colours.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColour(colour === c ? null : c)}
            aria-pressed={colour === c}
            className={`label-caps rounded-md border px-3 py-2 ${
              colour === c ? "border-ink bg-ink/10 text-ink" : "border-line text-ink/60"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          inputMode="numeric"
          placeholder="Ticket number, e.g. 46"
          className="w-full rounded-md border border-line bg-surface px-3 py-3 text-lg font-mono tabular-nums text-bone outline-none placeholder:text-base placeholder:font-sans placeholder:text-ink/30 focus:border-ink"
        />
        <input
          value={winner}
          onChange={(e) => setWinner(e.target.value)}
          placeholder="Winner's name (optional)"
          className="w-full rounded-md border border-line bg-surface px-3 py-3 text-base text-bone outline-none placeholder:text-ink/30 focus:border-ink"
        />
      </div>

      {error && <p className="text-sm text-status-cancelled">{error}</p>}

      {matches.length > 0 && (
        <ul className="space-y-2">
          {matches.map((t) => (
            <li
              key={t.pageId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-bone">
                  <span className="font-mono">{t.name}</span>
                  {t.claimed && (
                    <span className="label-caps ml-2 rounded-full border border-status-cancelled px-2 py-0.5 text-status-cancelled">
                      claimed
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink/50">
                  {t.prize}
                  {t.valueEur != null ? ` · €${t.valueEur.toFixed(2)}` : ""}
                  {t.belongsTo.length ? ` · ${t.belongsTo.join(" + ")}` : ""}
                  {t.claimed && t.winner ? ` · won by ${t.winner}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => claim(t.pageId)}
                disabled={pending || t.claimed}
                className="label-caps shrink-0 rounded-md bg-pink px-3 py-2 text-black transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {t.claimed ? "Already claimed" : pending ? "Saving…" : "Claim"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {(colour || number) && !matches.length && (
        <p className="text-sm text-ink/50">No ticket matches that.</p>
      )}
    </div>
  );
}
