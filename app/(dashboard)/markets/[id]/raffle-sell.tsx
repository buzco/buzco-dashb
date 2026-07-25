"use client";

import { useState, useTransition } from "react";
import { sellRaffleBundle, type SyncState } from "@/lib/actions/markets";
import {
  RAFFLE_BUNDLES,
  RAFFLE_PAYMENTS,
  type RaffleBundleId,
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
  const [bundle, setBundle] = useState<RaffleBundleId>("1");
  const [state, setState] = useState<SyncState | undefined>();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(totals);

  const sell = (paymentId: RafflePaymentId) => {
    const chosen = RAFFLE_BUNDLES.find((b) => b.id === bundle)!;
    setState(undefined);
    startTransition(async () => {
      const result = await sellRaffleBundle(eventId, bundle, paymentId);
      setState(result);
      if (!result.error) {
        setOptimistic((t) => ({
          tickets: t.tickets + chosen.tickets,
          revenue: t.revenue + chosen.price,
        }));
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

      <div className="grid grid-cols-3 gap-2">
        {RAFFLE_BUNDLES.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBundle(b.id)}
            aria-pressed={bundle === b.id}
            className={`rounded-lg border px-2 py-3 text-center ${
              bundle === b.id ? "border-ink bg-ink/10" : "border-line hover:border-ink/50"
            }`}
          >
            <span
              className={`block font-mono text-xl tabular-nums ${bundle === b.id ? "text-ink" : "text-bone"}`}
            >
              {b.tickets}
            </span>
            <span className="label-caps text-ink/50">€{b.price}</span>
          </button>
        ))}
      </div>

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
