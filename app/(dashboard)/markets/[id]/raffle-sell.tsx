"use client";

import { useState, useTransition } from "react";
import { sellRaffleBundle, type SyncState } from "@/lib/actions/markets";
import {
  RAFFLE_PAYMENTS,
  freeUpgradeHint,
  packsForTickets,
  type RafflePaymentId,
} from "@/lib/market/raffle-options";

// The same two-tap flow as the standalone /rifas link, embedded in the
// dashboard so rifas can be sold from either screen.

export function RaffleSell({
  eventId,
  totals,
}: {
  eventId: string;
  totals: { tickets: number; revenue: number };
}) {
  const [tickets, setTickets] = useState(1);
  const [state, setState] = useState<SyncState | undefined>();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(totals);

  // Bundles are derived from the count — the dashboard shouldn't make you do
  // arithmetic the stall screen already does for you.
  const quote = packsForTickets(tickets);
  const upgrade = freeUpgradeHint(tickets);

  const sell = (paymentId: RafflePaymentId) => {
    setState(undefined);
    startTransition(async () => {
      const result = await sellRaffleBundle(eventId, tickets, paymentId);
      setState(result);
      if (!result.error) {
        setOptimistic((t) => ({
          tickets: t.tickets + quote.tickets,
          revenue: t.revenue + quote.total,
        }));
        setTickets(1);
      }
    });
  };

  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="label-caps text-ink/60">Sell rifas</h2>
        <p className="text-sm text-ink/60">
          <span className="font-mono tabular-nums text-bone">{optimistic.tickets}</span> sold ·{" "}
          <span className="font-mono tabular-nums text-ink">€{optimistic.revenue.toFixed(2)}</span>
        </p>
      </div>

      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => setTickets((n) => Math.max(1, n - 1))}
          className="w-12 rounded-lg border border-line text-xl text-ink hover:border-ink/60"
          aria-label="One fewer rifa"
        >
          −
        </button>
        <input
          type="number"
          min={1}
          inputMode="numeric"
          value={tickets}
          onChange={(e) => setTickets(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
          className="w-full rounded-lg border border-line bg-surface py-3 text-center font-mono text-2xl tabular-nums text-bone outline-none focus:border-ink"
        />
        <button
          type="button"
          onClick={() => setTickets((n) => n + 1)}
          className="w-12 rounded-lg border border-line text-xl text-ink hover:border-ink/60"
          aria-label="One more rifa"
        >
          +
        </button>
      </div>

      <p className="text-sm text-ink/60">
        {quote.packs.map((p) => `${p.count}× ${p.bundle.label}`).join("  +  ")} ={" "}
        <span className="font-mono tabular-nums text-ink">€{quote.total.toFixed(2)}</span>
        {upgrade && (
          <span className="ml-2 text-status-ordered">({upgrade.to} costs the same)</span>
        )}
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {RAFFLE_PAYMENTS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={pending}
            onClick={() => sell(p.id)}
            className="rounded-lg border border-line px-3 py-3 text-left hover:border-pink disabled:opacity-50"
          >
            <span className="block text-sm font-medium text-bone">{p.label}</span>
            <span className="label-caps text-ink/50">{p.brand}</span>
          </button>
        ))}
      </div>

      {pending && <p className="text-sm text-ink/50">Recording…</p>}
      {!pending && state?.message && <p className="text-sm text-status-active">✓ {state.message}</p>}
      {!pending && state?.error && <p className="text-sm text-status-cancelled">{state.error}</p>}
    </div>
  );
}
