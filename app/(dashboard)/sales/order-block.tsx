import Image from "next/image";
import { shopifyCdnResize } from "@/lib/shopify/image";
import type { SaleOrderView } from "@/lib/sales/data";
import { SettleForm, RetryNotionButton, ReturnLineButton } from "./order-actions";

// One order, collapsed to a single line until you want the detail.
//
// <details> rather than React state: these lists get long, the toggle has to
// survive a server revalidation after settling an order, and a disclosure
// triangle is the one interaction the browser already does better than we would.

export function OrderBlock({
  order,
  paymentOptions = [],
}: {
  order: SaleOrderView;
  /** Only passed on the consignations tab, where settling happens. */
  paymentOptions?: string[];
}) {
  const isConsignment = order.kind === "consignment";
  const pending = order.paymentStatus === "pending";
  const buyer = order.retailerName ?? order.customerName;

  return (
    <details className="group overflow-hidden rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 p-3">
        <span className="label-caps text-ink/30 transition-transform group-open:rotate-90">›</span>

        <span className="font-mono text-sm tabular-nums text-ink">{order.reference}</span>

        <span
          className={`label-caps rounded-full border px-2.5 py-0.5 ${
            isConsignment
              ? "border-status-settled text-status-settled"
              : "border-status-active text-status-active"
          }`}
        >
          {isConsignment ? "Consignation" : "Sale"}
        </span>

        <span className="min-w-0 flex-1 truncate text-bone">
          {buyer ?? order.whereSold ?? "—"}
          <span className="ml-2 text-ink/40">
            {order.units} item{order.units === 1 ? "" : "s"}
          </span>
        </span>

        <span
          className={`label-caps rounded-full border px-2.5 py-0.5 ${
            pending
              ? "border-status-ordered text-status-ordered"
              : "border-status-received text-status-received"
          }`}
        >
          {pending ? "Pending" : "Paid"}
        </span>

        <span className="font-mono tabular-nums text-bone">€{order.net.toFixed(2)}</span>

        <span className="label-caps w-full text-ink/40 sm:w-auto">
          {new Date(order.createdAt).toLocaleDateString()}
        </span>
      </summary>

      <div className="space-y-4 border-t border-line p-3">
        <ul className="space-y-2">
          {order.lines.map((line) => (
            <li key={line.saleId} className="flex items-center gap-3">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-ink/5">
                {line.imageUrl && (
                  <Image
                    src={shopifyCdnResize(line.imageUrl, 200)!}
                    alt={line.productName}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-bone">
                  {line.productName}
                  {line.isFreebie && <span className="ml-2 text-pink">· freebie</span>}
                </p>
                <p className="label-caps text-ink/40">
                  {line.size ?? line.color ?? line.sku} · ×{line.quantity}
                  {line.notionError && (
                    <span className="ml-2 text-status-cancelled">Notion: {line.notionError}</span>
                  )}
                </p>
              </div>
              <span className="shrink-0 font-mono text-sm tabular-nums text-bone">
                €{line.netAmount.toFixed(2)}
              </span>
              {isConsignment && pending && (
                <ReturnLineButton orderId={order.id} saleId={line.saleId} />
              )}
            </li>
          ))}
        </ul>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <Field label="Where" value={order.whereSold} />
          <Field
            label="Payment"
            value={pending ? (isConsignment ? "Consignation" : "Pending") : order.paymentMethod}
          />
          <Field
            label="Discount"
            value={
              order.discount > 0
                ? `€${order.discount.toFixed(2)}${
                    order.discountKind === "percent" ? ` (${order.discountValue}%)` : ""
                  }`
                : null
            }
          />
          <Field label="Shopify" value={order.shopifyOrderName} />
          {order.settledAt && (
            <Field label="Settled" value={new Date(order.settledAt).toLocaleDateString()} />
          )}
        </dl>

        {order.notes && <p className="text-sm text-ink/60">{order.notes}</p>}

        <div className="flex flex-wrap items-center gap-2">
          {isConsignment && (
            <a
              href={`/sales/consignments/${order.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="label-caps rounded-md border border-ink/60 px-3 py-2 text-ink hover:bg-ink/10"
            >
              Download PDF
            </a>
          )}
          {order.unsyncedNotion > 0 && (
            <RetryNotionButton orderId={order.id} count={order.unsyncedNotion} />
          )}
        </div>

        {isConsignment && pending && paymentOptions.length > 0 && (
          <div className="border-t border-line pt-3">
            <SettleForm orderId={order.id} paymentOptions={paymentOptions} />
          </div>
        )}
      </div>
    </details>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="label-caps text-ink/40">{label}</dt>
      <dd className="text-bone">{value}</dd>
    </div>
  );
}
