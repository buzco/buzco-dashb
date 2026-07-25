"use client";

import { useActionState, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { stallSell, type StallState } from "@/lib/actions/stall";
import type { StallEvent, StallProduct, StallVariant } from "../stall-data";

// Built for a friend holding a phone in one hand and a tee in the other:
// big tap targets, no jargon, and a confirmation they can't miss. Every sale
// pushes a real Shopify order, so stock stays right without anyone thinking
// about inventory.

const FALLBACK_PAYMENTS = ["Cash", "Shopify", "N/A"];

function euro(n: number | null): string {
  return n == null ? "—" : `€${n.toFixed(2)}`;
}

function chipTone(qty: number): string {
  if (qty <= 0) return "border-line text-ink/25 line-through";
  if (qty <= 2) return "border-status-ordered bg-status-ordered/10 text-status-ordered";
  return "border-status-active bg-status-active/10 text-status-active";
}

export function StallPos({
  token,
  event,
  otherEvents,
  products,
  paymentMethods,
}: {
  token: string;
  event: StallEvent;
  otherEvents: StallEvent[];
  products: StallProduct[];
  paymentMethods: string[];
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ product: StallProduct; variant: StallVariant } | null>(
    null,
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.variants.some((v) => v.sku.toLowerCase().includes(q)),
    );
  }, [products, query]);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-4">
      <header className="mb-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="label-caps text-ink/50">Selling at</p>
            <h1 className="truncate text-xl font-bold text-bone">{event.name}</h1>
          </div>
          <Link href={`/s/${token}/rifas`} className="label-caps shrink-0 text-pink hover:underline">
            Rifas →
          </Link>
        </div>
        {otherEvents.length > 0 && (
          <p className="mt-1 text-xs text-ink/40">
            Wrong event?{" "}
            {otherEvents.map((e) => (
              <Link
                key={e.id}
                href={`/s/${token}/pos?event=${e.id}`}
                className="mr-2 underline hover:text-ink"
              >
                {e.name}
              </Link>
            ))}
          </p>
        )}
      </header>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search…"
        className="mb-4 w-full rounded-md border border-line bg-surface px-3 py-3 text-base text-bone outline-none placeholder:text-ink/30 focus:border-ink"
      />

      {!products.length ? (
        <p className="text-sm text-ink/50">
          No stock available in Shopify right now.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visible.map((product) => (
            <div
              key={product.productId}
              className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface"
            >
              <div className="relative aspect-square w-full bg-ink/5">
                {product.imageUrl ? (
                  <Image
                    src={product.imageUrl}
                    alt={product.name}
                    fill
                    sizes="(max-width:640px) 50vw, 33vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <span className="label-caps text-ink/30">No image</span>
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <p className="text-sm font-medium leading-tight text-bone">{product.name}</p>
                <PriceLine product={product} />
                <div className="mt-auto flex flex-wrap gap-1.5">
                  {product.variants.map((v) => (
                    <button
                      key={v.variantId}
                      type="button"
                      disabled={v.available <= 0}
                      onClick={() => setPicked({ product, variant: v })}
                      className={`label-caps min-w-11 rounded-md border px-2 py-2 tabular-nums ${chipTone(v.available)}`}
                    >
                      {v.size ?? v.sku}
                      <span className="ml-1 font-mono text-[0.7rem] opacity-70">{v.available}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {picked && (
        <SellSheet
          token={token}
          eventId={event.id}
          product={picked.product}
          variant={picked.variant}
          paymentMethods={paymentMethods}
          onClose={() => setPicked(null)}
        />
      )}
    </main>
  );
}

function PriceLine({ product }: { product: StallProduct }) {
  const prices = [...new Set(product.variants.map((v) => v.price).filter((p): p is number => p != null))];
  const discounted =
    product.retailPrice != null && prices.length === 1 && prices[0] < product.retailPrice;
  return (
    <div className="flex items-baseline gap-2">
      <span className={`font-mono text-lg tabular-nums ${discounted ? "text-pink" : "text-bone"}`}>
        {prices.length === 1
          ? euro(prices[0])
          : prices.length
            ? `${euro(Math.min(...prices))}–${euro(Math.max(...prices))}`
            : "—"}
      </span>
      {discounted && (
        <span className="font-mono text-xs tabular-nums text-ink/40 line-through">
          {euro(product.retailPrice)}
        </span>
      )}
    </div>
  );
}

function SellSheet({
  token,
  eventId,
  product,
  variant,
  paymentMethods,
  onClose,
}: {
  token: string;
  eventId: string;
  product: StallProduct;
  variant: StallVariant;
  paymentMethods: string[];
  onClose: () => void;
}) {
  const methods = useMemo(() => {
    const source = paymentMethods.length ? paymentMethods : FALLBACK_PAYMENTS;
    const seen = new Map<string, string>();
    for (const m of source) {
      const key = m.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, m.trim());
    }
    return [...seen.values()];
  }, [paymentMethods]);

  const [state, formAction, isPending] = useActionState<StallState | undefined, FormData>(
    stallSell.bind(null, token, eventId),
    undefined,
  );

  // Stay open on success just long enough to show the confirmation, so the
  // seller sees it worked before the sheet disappears.
  if (state?.ok) {
    return (
      <Sheet onClose={onClose}>
        <div className="space-y-4 text-center">
          <p className="text-4xl">✓</p>
          <p className="text-lg font-medium text-bone">{state.message}</p>
          <button
            type="button"
            onClick={onClose}
            className="label-caps w-full rounded-md bg-pink px-4 py-4 text-black"
          >
            Next sale
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-bone">{product.name}</p>
          <p className="label-caps text-ink/50">
            {variant.size ?? variant.sku} · {variant.available} left
          </p>
        </div>
        <button type="button" onClick={onClose} className="label-caps text-ink/60">
          Close
        </button>
      </div>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="variant_id" value={variant.variantId} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="price" className="label-caps block text-ink/60">
              Price each €
            </label>
            <input
              id="price"
              name="price"
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              defaultValue={variant.price ?? 0}
              required
              className="w-full rounded-md border border-line bg-surface px-3 py-3 font-mono text-xl tabular-nums text-bone outline-none focus:border-ink"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="quantity" className="label-caps block text-ink/60">
              Qty
            </label>
            <input
              id="quantity"
              name="quantity"
              type="number"
              min={1}
              max={variant.available}
              inputMode="numeric"
              defaultValue={1}
              required
              className="w-full rounded-md border border-line bg-surface px-3 py-3 font-mono text-xl tabular-nums text-bone outline-none focus:border-ink"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="payment_method" className="label-caps block text-ink/60">
            Paid with
          </label>
          <select
            id="payment_method"
            name="payment_method"
            required
            defaultValue=""
            className="w-full rounded-md border border-line bg-surface px-3 py-3 text-base text-bone outline-none focus:border-ink"
          >
            <option value="" disabled>
              Pick how they paid…
            </option>
            {methods.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="customer_ref" className="label-caps block text-ink/60">
            Who (optional)
          </label>
          <input
            id="customer_ref"
            name="customer_ref"
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-bone outline-none placeholder:text-ink/30 focus:border-ink"
          />
        </div>

        {state?.error && <p className="text-sm text-status-cancelled">{state.error}</p>}

        <button
          type="submit"
          disabled={isPending}
          className="label-caps w-full rounded-md bg-pink px-4 py-4 text-base text-black disabled:opacity-50"
        >
          {isPending ? "Recording…" : "Record sale"}
        </button>
      </form>
    </Sheet>
  );
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-auto rounded-t-2xl border border-line bg-surface p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
