import { voidSale } from "@/lib/actions/markets";
import type { MarketData } from "./market-data";
import { SyncButtons } from "./sync-buttons";

// The day's takings, newest first. Every row shows whether it reached Notion,
// because a silent mirror failure is the one thing you'd otherwise only notice
// when reconciling weeks later.

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function SalesPanel({
  data,
  notionConfigured,
}: {
  data: MarketData;
  notionConfigured: boolean;
}) {
  const { event, sales, totals } = data;

  return (
    <div className="space-y-6">
      <SyncButtons
        eventId={event.id}
        isLive={event.status === "live"}
        unsyncedNotion={totals.unsyncedNotion}
        notionConfigured={notionConfigured}
      />

      {!sales.length ? (
        <p className="text-sm text-ink/50">
          Nothing sold yet. POS transactions appear here once pulled.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {sales.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
              <span className="font-mono text-xs tabular-nums text-ink/50">{time(s.soldAt)}</span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-bone">
                  {s.productName}
                  {s.size ? <span className="label-caps ml-2 text-ink/50">{s.size}</span> : null}
                  {s.quantity > 1 && (
                    <span className="ml-2 font-mono text-xs tabular-nums text-ink/60">
                      ×{s.quantity}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-ink/40">
                  {[
                    s.customerRef,
                    s.paymentMethod,
                    s.shopifyOrderId ? "Shopify POS" : "manual",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              <span className="font-mono tabular-nums text-bone">€{s.netAmount.toFixed(2)}</span>

              {notionConfigured &&
                (s.notionPageId ? (
                  <span
                    className="label-caps text-status-active"
                    title="Mirrored to the Notion tracker"
                  >
                    Notion ✓
                  </span>
                ) : (
                  <span
                    className="label-caps text-status-ordered"
                    title={s.notionError ?? "Not mirrored yet"}
                  >
                    Notion —
                  </span>
                ))}

              <form action={voidSale.bind(null, event.id, s.id)}>
                <button
                  type="submit"
                  title="Undo this sale and put the unit back in the crate"
                  className="label-caps text-ink/40 hover:text-status-cancelled"
                >
                  Void
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {sales.some((s) => s.notionError) && (
        <div className="rounded-lg border border-status-ordered/50 bg-surface p-3">
          <p className="label-caps text-status-ordered">Notion errors</p>
          <ul className="mt-1 space-y-1">
            {[...new Set(sales.map((s) => s.notionError).filter(Boolean))].map((err) => (
              <li key={err} className="text-xs text-ink/60">
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
