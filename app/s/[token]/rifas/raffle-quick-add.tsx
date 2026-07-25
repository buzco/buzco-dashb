"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { stallRaffleSale, type StallState } from "@/lib/actions/stall";
import {
  STALL_PAYMENTS,
  freeUpgradeHint,
  packsForTickets,
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
  const [tickets, setTickets] = useState(1);
  const [state, setState] = useState<StallState | undefined>();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(totals);

  // Bundles are worked out from the count, so the seller never has to do the
  // arithmetic: 7 rifas is a 6-pack plus a single, priced accordingly.
  const quote = packsForTickets(tickets);
  const upgrade = freeUpgradeHint(tickets);

  const sell = (paymentId: RafflePaymentId) => {
    setState(undefined);
    startTransition(async () => {
      const result = await stallRaffleSale(token, event.id, tickets, paymentId);
      setState(result);
      if (result.ok) {
        setOptimistic((t) => ({
          tickets: t.tickets + quote.tickets,
          revenue: t.revenue + quote.total,
          sales: t.sales + quote.packs.reduce((n, p) => n + p.count, 0),
        }));
        setTickets(1);
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

      <div className="mb-2 flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => setTickets((n) => Math.max(1, n - 1))}
          className="w-16 rounded-lg border border-line text-2xl text-ink"
          aria-label="Menos uma rifa"
        >
          −
        </button>
        <input
          type="number"
          min={1}
          inputMode="numeric"
          value={tickets}
          onChange={(e) => setTickets(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
          className="w-full rounded-lg border border-line bg-surface py-5 text-center font-mono text-4xl tabular-nums text-bone outline-none focus:border-ink"
        />
        <button
          type="button"
          onClick={() => setTickets((n) => n + 1)}
          className="w-16 rounded-lg border border-line text-2xl text-ink"
          aria-label="Mais uma rifa"
        >
          +
        </button>
      </div>

      <div className="mb-2 grid grid-cols-4 gap-2">
        {[1, 6, 12, 24].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setTickets(n)}
            className="label-caps rounded-md border border-line py-2 text-ink/60 hover:border-ink/50"
          >
            {n}
          </button>
        ))}
      </div>

      {/* Show the arithmetic, so the seller can sanity-check the price out loud. */}
      <div className="mb-2 rounded-lg border border-line bg-surface p-3 text-center">
        <p className="text-sm text-ink/60">
          {quote.packs
            .map((p) => `${p.count}× ${p.bundle.label}`)
            .join("  +  ")}
        </p>
        <p className="font-mono text-3xl tabular-nums text-ink">€{quote.total.toFixed(2)}</p>
      </div>

      {upgrade && (
        <p className="mb-6 text-center text-xs text-status-ordered">
          {upgrade.to} rifas custam o mesmo — oferece mais {upgrade.extra}?
        </p>
      )}
      {!upgrade && <div className="mb-6" />}

      <p className="label-caps mb-2 text-ink/60">2 · Pago com</p>
      <div className="grid grid-cols-2 gap-2">
        {STALL_PAYMENTS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={pending}
            onClick={() => sell(p.id)}
            className="rounded-lg border border-line bg-surface px-2 py-8 transition-colors hover:border-pink disabled:opacity-50"
          >
            <span className="block text-center text-base font-medium text-bone">{p.label}</span>
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
