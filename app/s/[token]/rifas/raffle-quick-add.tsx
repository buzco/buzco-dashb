"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { stallRaffleSale, type StallState } from "@/lib/actions/stall";
import {
  RAFFLE_BUNDLES,
  RAFFLE_PAYMENTS,
  type RaffleBundleId,
  type RafflePaymentId,
} from "@/lib/market/raffle-options";
import type { StallEvent } from "../stall-data";

// Selling rifas is a two-tap job: how many, then who took the money. Laid out
// as bundle-first because that's the order the conversation happens in ("six
// please" → "cash or revolut?"), and every combination is one tap from there.

export function RaffleQuickAdd({
  token,
  event,
  totals,
}: {
  token: string;
  event: StallEvent;
  totals: { tickets: number; revenue: number; sales: number };
}) {
  const [bundle, setBundle] = useState<RaffleBundleId>("1");
  const [state, setState] = useState<StallState | undefined>();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(totals);

  const sell = (paymentId: RafflePaymentId) => {
    const chosen = RAFFLE_BUNDLES.find((b) => b.id === bundle)!;
    setState(undefined);
    startTransition(async () => {
      const result = await stallRaffleSale(token, event.id, bundle, paymentId);
      setState(result);
      if (result.ok) {
        setOptimistic((t) => ({
          tickets: t.tickets + chosen.tickets,
          revenue: t.revenue + chosen.price,
          sales: t.sales + 1,
        }));
      }
    });
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-24 pt-4">
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="label-caps text-ink/50">Rifas at</p>
          <h1 className="truncate text-xl font-bold text-bone">{event.name}</h1>
        </div>
        <Link href={`/s/${token}/pos`} className="label-caps shrink-0 text-pink hover:underline">
          ← Roupa
        </Link>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <Stat label="Rifas vendidas" value={String(optimistic.tickets)} />
        <Stat label="Total" value={`€${optimistic.revenue.toFixed(2)}`} accent />
      </div>

      <p className="label-caps mb-2 text-ink/60">1 · Quantas rifas</p>
      <div className="mb-6 grid grid-cols-3 gap-2">
        {RAFFLE_BUNDLES.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBundle(b.id)}
            aria-pressed={bundle === b.id}
            className={`rounded-lg border px-2 py-4 text-center transition-colors ${
              bundle === b.id
                ? "border-ink bg-ink/10"
                : "border-line hover:border-ink/50"
            }`}
          >
            <span className={`block font-mono text-2xl tabular-nums ${bundle === b.id ? "text-ink" : "text-bone"}`}>
              {b.tickets}
            </span>
            <span className="label-caps text-ink/60">€{b.price}</span>
          </button>
        ))}
      </div>

      <p className="label-caps mb-2 text-ink/60">2 · Pago com</p>
      <div className="grid grid-cols-2 gap-2">
        {RAFFLE_PAYMENTS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={pending}
            onClick={() => sell(p.id)}
            className="rounded-lg border border-line bg-surface px-3 py-5 text-left transition-colors hover:border-pink disabled:opacity-50"
          >
            <span className="block text-base font-medium text-bone">{p.label}</span>
            <span className="label-caps text-ink/50">{p.brand}</span>
          </button>
        ))}
      </div>

      {/* Feedback has to be unmissable — the seller is not looking closely. */}
      <div className="mt-5 min-h-14">
        {pending && <p className="text-center text-sm text-ink/50">A registar…</p>}
        {!pending && state?.ok && (
          <p className="rounded-lg border border-status-active bg-status-active/10 p-4 text-center text-lg font-medium text-status-active">
            ✓ {state.message}
          </p>
        )}
        {!pending && state?.error && (
          <p className="rounded-lg border border-status-cancelled bg-status-cancelled/10 p-4 text-center text-sm text-status-cancelled">
            {state.error}
          </p>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="label-caps text-ink/40">{label}</p>
      <p className={`font-mono text-2xl tabular-nums ${accent ? "text-ink" : "text-bone"}`}>{value}</p>
    </div>
  );
}
