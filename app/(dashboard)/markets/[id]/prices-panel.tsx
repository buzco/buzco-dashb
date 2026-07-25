import { bulkDiscountEvent, clearMarketPrices, setMarketPrice } from "@/lib/actions/markets";
import { Button } from "@/components/ui/button";
import type { MarketData } from "./market-data";

// Today's prices. These live only in our DB — Shopify variant prices are global,
// so pushing a market discount there would also discount the online storefront.
// You key the number below into POS (or use the manual sell sheet, which
// pre-fills it).

function euro(n: number | null): string {
  return n == null ? "—" : `€${n.toFixed(2)}`;
}

export function PricesPanel({ data }: { data: MarketData }) {
  const { event, products } = data;

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="label-caps text-ink/60">Discount everything</h2>
        <p className="mt-1 text-sm text-ink/50">
          Sets each loaded product&apos;s price to a percentage off its retail price. Tweak
          individual products below afterwards.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <form action={bulkDiscountEvent.bind(null, event.id)} className="flex items-end gap-2">
            <div className="space-y-1">
              <label htmlFor="percent" className="label-caps block text-ink/60">
                % off
              </label>
              <input
                id="percent"
                name="percent"
                type="number"
                min={1}
                max={100}
                defaultValue={20}
                className="w-24 rounded-md border border-line bg-surface px-3 py-2 font-mono tabular-nums text-bone outline-none focus:border-ink"
              />
            </div>
            <Button type="submit">Apply</Button>
          </form>
          <form action={clearMarketPrices.bind(null, event.id)}>
            <Button variant="secondary" type="submit">
              Reset to retail
            </Button>
          </form>
        </div>
      </div>

      {!products.length ? (
        <p className="text-sm text-ink/50">Load stock into the crate first.</p>
      ) : (
        <div className="space-y-3">
          <h2 className="label-caps text-ink/60">Per product</h2>
          <ul className="space-y-2">
            {products.map((p) => {
              const sizePrices = [
                ...new Set(p.variants.map((v) => v.price).filter((x): x is number => x != null)),
              ];
              return (
                <li
                  key={p.productId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-bone">{p.name}</p>
                    <p className="text-xs text-ink/50">
                      Retail {euro(p.retailPrice)} · today{" "}
                      <span className={p.eventPrice != null ? "text-pink" : ""}>
                        {sizePrices.length === 1
                          ? euro(sizePrices[0])
                          : sizePrices.length
                            ? `${euro(Math.min(...sizePrices))}–${euro(Math.max(...sizePrices))}`
                            : "—"}
                      </span>
                      {" · "}
                      <span className="font-mono tabular-nums">{p.available}</span> in crate
                    </p>
                  </div>
                  <form
                    action={setMarketPrice.bind(null, event.id)}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="product_id" value={p.productId} />
                    <input
                      name="price"
                      type="number"
                      step="0.01"
                      min={0}
                      inputMode="decimal"
                      placeholder={p.retailPrice != null ? String(p.retailPrice) : "0.00"}
                      defaultValue={p.eventPrice ?? ""}
                      className="w-24 rounded-md border border-line bg-surface px-3 py-2 font-mono tabular-nums text-bone outline-none placeholder:text-ink/30 focus:border-ink"
                    />
                    <button
                      type="submit"
                      className="label-caps rounded-md border border-ink/60 px-3 py-2 text-ink hover:border-ink hover:bg-ink/10"
                    >
                      Set
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-ink/40">
            Leave a price empty and press Set to clear the override and fall back to retail.
          </p>
        </div>
      )}
    </div>
  );
}
