"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useActionState } from "react";
import { sellAtMarket } from "@/lib/actions/markets";
import type { MarketProductView, MarketVariantView } from "./market-data";

// The stall screen. Designed to be read at arm's length on a phone with one
// thumb: image, price, and a row of size buttons whose colour alone tells you
// what's left. Tapping a size opens a bottom sheet to record a sale — used when
// the buyer pays cash/MB WAY. Shopify POS sales arrive via the Sales tab pull.

// Used only when the Notion options can't be read (no token, or Notion down).
const FALLBACK_PAYMENT_METHODS = ["Cash", "Shopify", "N/A"];

function euro(n: number | null): string {
  if (n == null) return "—";
  return `€${n.toFixed(2)}`;
}

/** Colour carries the stock level so you don't have to read the number. */
function chipTone(inCrate: number): string {
  if (inCrate <= 0) return "border-line bg-transparent text-ink/25 line-through";
  if (inCrate <= 2) return "border-status-ordered bg-status-ordered/10 text-status-ordered";
  return "border-status-active bg-status-active/10 text-status-active";
}

export function StockGrid({
  eventId,
  products,
  readOnly,
  paymentMethods,
}: {
  eventId: string;
  products: MarketProductView[];
  readOnly: boolean;
  /** Real option names from the Notion tracker, so we never invent new ones. */
  paymentMethods: string[];
}) {
  const [query, setQuery] = useState("");
  const [hideSoldOut, setHideSoldOut] = useState(false);
  const [selected, setSelected] = useState<{
    product: MarketProductView;
    variant: MarketVariantView;
  } | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (hideSoldOut && p.inCrate <= 0) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.variants.some((v) => v.sku.toLowerCase().includes(q))
      );
    });
  }, [products, query, hideSoldOut]);

  if (!products.length) {
    return (
      <p className="text-sm text-ink/50">
        Nothing loaded yet. Use the <span className="text-ink">Load</span> tab to put stock in the
        crate.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sticky so the search stays reachable while scrolling a long grid. */}
      <div className="sticky top-0 z-20 -mx-4 flex gap-2 bg-paper/95 px-4 py-2 backdrop-blur-sm md:mx-0 md:px-0">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search product or SKU…"
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-bone outline-none placeholder:text-ink/30 focus:border-ink"
        />
        <button
          type="button"
          onClick={() => setHideSoldOut((v) => !v)}
          aria-pressed={hideSoldOut}
          className={`label-caps shrink-0 rounded-md border px-3 ${
            hideSoldOut ? "border-ink bg-ink/10 text-ink" : "border-line text-ink/60"
          }`}
        >
          In stock
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((product) => (
          <ProductCard
            key={product.productId}
            product={product}
            readOnly={readOnly}
            onPick={(variant) => setSelected({ product, variant })}
          />
        ))}
      </div>

      {!visible.length && <p className="text-sm text-ink/50">Nothing matches “{query}”.</p>}

      {selected && (
        <SellSheet
          eventId={eventId}
          product={selected.product}
          variant={selected.variant}
          paymentMethods={paymentMethods}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ProductCard({
  product,
  readOnly,
  onPick,
}: {
  product: MarketProductView;
  readOnly: boolean;
  onPick: (variant: MarketVariantView) => void;
}) {
  // One price for the card when every size agrees; otherwise show the range.
  const prices = [...new Set(product.variants.map((v) => v.price).filter((p): p is number => p != null))];
  const priceLabel =
    prices.length === 0
      ? "—"
      : prices.length === 1
        ? euro(prices[0])
        : `${euro(Math.min(...prices))}–${euro(Math.max(...prices))}`;
  const discounted = product.variants.some((v) => v.discounted);
  const showStrike =
    discounted && product.retailPrice != null && prices.length === 1 && prices[0] < product.retailPrice;

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-lg border bg-surface ${
        product.inCrate <= 0 ? "border-line opacity-60" : "border-line"
      }`}
    >
      <div className="relative aspect-square w-full bg-ink/5">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(max-width:1024px) 50vw, 25vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="label-caps text-ink/30">No image</span>
          </div>
        )}
        {product.inCrate <= 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-paper/70">
            <span className="label-caps rounded-full border border-status-cancelled px-3 py-1 text-status-cancelled">
              Sold out
            </span>
          </div>
        )}
        <span className="absolute right-2 top-2 rounded-full bg-paper/85 px-2 py-0.5 font-mono text-xs tabular-nums text-bone">
          {product.inCrate}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="text-sm font-medium leading-tight text-bone">{product.name}</p>

        <div className="flex items-baseline gap-2">
          <span className={`font-mono text-xl tabular-nums ${discounted ? "text-pink" : "text-bone"}`}>
            {priceLabel}
          </span>
          {showStrike && (
            <span className="font-mono text-xs tabular-nums text-ink/40 line-through">
              {euro(product.retailPrice)}
            </span>
          )}
        </div>

        <div className="mt-auto flex flex-wrap gap-1.5">
          {product.variants.map((v) => (
            <button
              key={v.variantId}
              type="button"
              disabled={readOnly || v.inCrate <= 0}
              onClick={() => onPick(v)}
              title={`${v.sku} · ${v.inCrate} left · ${euro(v.price)}`}
              className={`label-caps min-w-11 rounded-md border px-2 py-2 tabular-nums transition-colors disabled:cursor-not-allowed ${chipTone(v.inCrate)}`}
            >
              {v.size ?? v.sku}
              <span className="ml-1 font-mono text-[0.7rem] opacity-70">{v.inCrate}</span>
            </button>
          ))}
        </div>

        {product.sold > 0 && (
          <p className="text-[0.7rem] text-ink/40">
            <span className="font-mono tabular-nums">{product.sold}</span> sold today
          </p>
        )}
      </div>
    </div>
  );
}

function SellSheet({
  eventId,
  product,
  variant,
  paymentMethods,
  onClose,
}: {
  eventId: string;
  product: MarketProductView;
  variant: MarketVariantView;
  paymentMethods: string[];
  onClose: () => void;
}) {
  // Notion permits near-duplicate select options — this tracker really does
  // have both "Mbway André" and "Mbway André " — so collapse them on whitespace
  // and case before showing the list.
  const methods = useMemo(() => {
    const source = paymentMethods.length ? paymentMethods : FALLBACK_PAYMENT_METHODS;
    const seen = new Map<string, string>();
    for (const m of source) {
      const key = m.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, m.trim());
    }
    return [...seen.values()];
  }, [paymentMethods]);
  const [state, formAction, isPending] = useActionState(
    async (_prev: { error?: string } | undefined, formData: FormData) => {
      try {
        await sellAtMarket(eventId, formData);
        onClose();
        return undefined;
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
    undefined,
  );

  const [payment, setPayment] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      {/* Bottom sheet on phones, centred dialog from sm up. */}
      <div
        className="max-h-[90vh] w-full max-w-md overflow-auto rounded-t-2xl border border-line bg-surface p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-medium text-bone">{product.name}</p>
            <p className="label-caps text-ink/50">
              {variant.size ?? variant.sku} · {variant.inCrate} left
            </p>
          </div>
          <button type="button" onClick={onClose} className="label-caps text-ink/60 hover:text-ink">
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
                className="w-full rounded-md border border-line bg-surface px-3 py-3 text-xl font-mono tabular-nums text-bone outline-none focus:border-ink"
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
                max={variant.inCrate}
                inputMode="numeric"
                defaultValue={1}
                required
                className="w-full rounded-md border border-line bg-surface px-3 py-3 text-xl font-mono tabular-nums text-bone outline-none focus:border-ink"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="payment_method" className="label-caps block text-ink/60">
              Paid with
            </label>
            {/* A dropdown, not chips: the tracker has 17 payment options and
                several name a specific person, so a grid of chips both buried
                the rest of the form and made a mis-tap attribute cash to the
                wrong person. No default for the same reason — pick it. */}
            <select
              id="payment_method"
              name="payment_method"
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              required
              className="w-full rounded-md border border-line bg-surface px-3 py-3 text-base text-bone outline-none focus:border-ink"
            >
              <option value="" disabled>
                Pick how they paid…
              </option>
              {methods.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="customer_ref" className="label-caps block text-ink/60">
              Who (optional — becomes the Notion row title)
            </label>
            <input
              id="customer_ref"
              name="customer_ref"
              placeholder="Miguelón"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-bone outline-none placeholder:text-ink/30 focus:border-ink"
            />
          </div>

          {state?.error && <p className="text-sm text-status-cancelled">{state.error}</p>}

          <button
            type="submit"
            disabled={isPending}
            className="label-caps w-full rounded-md bg-pink px-4 py-4 text-base text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Recording…" : "Record sale"}
          </button>
        </form>
      </div>
    </div>
  );
}
