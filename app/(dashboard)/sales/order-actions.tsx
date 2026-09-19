"use client";

import { useActionState, useTransition } from "react";
import {
  settleOrder,
  retryOrderNotion,
  returnConsignedLine,
  type SaleOrderState,
} from "@/lib/actions/sales";

/**
 * Declaring a consignation paid.
 *
 * The method is asked for rather than assumed, because it is the one piece of
 * information that only exists at settlement time — and it is what the Notion
 * page's "Método pagamento" column gets, replacing the "Consignation" placeholder
 * written when the batch went out.
 */
export function SettleForm({
  orderId,
  paymentOptions,
}: {
  orderId: string;
  paymentOptions: string[];
}) {
  const [state, formAction, isPending] = useActionState<SaleOrderState | undefined, FormData>(
    settleOrder.bind(null, orderId),
    undefined,
  );

  return (
    <form action={formAction} className="space-y-2">
      <p className="label-caps text-ink/50">Mark paid — how did they pay?</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="payment_method"
          required
          defaultValue=""
          className="rounded-md border border-line bg-surface px-3 py-2 text-bone outline-none focus:border-ink"
        >
          <option value="" disabled>
            Payment method…
          </option>
          {paymentOptions.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={isPending}
          className="label-caps rounded-md bg-pink px-4 py-2 text-black disabled:opacity-50"
        >
          {isPending ? "Settling…" : "Mark paid"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-status-cancelled">{state.error}</p>}
      {(state?.warnings ?? []).map((w) => (
        <p key={w} className="text-sm text-status-ordered">
          {w}
        </p>
      ))}
    </form>
  );
}

export function RetryNotionButton({ orderId, count }: { orderId: string; count: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await retryOrderNotion(orderId)))}
      className="label-caps rounded-md border border-status-ordered/60 px-3 py-2 text-status-ordered disabled:opacity-50"
    >
      {pending ? "Retrying…" : `Retry Notion (${count})`}
    </button>
  );
}

/** Consigned stock coming back unsold, one line at a time. */
export function ReturnLineButton({
  orderId,
  saleId,
}: {
  orderId: string;
  saleId: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await returnConsignedLine(orderId, saleId)))}
      className="label-caps text-ink/40 hover:text-ink disabled:opacity-50"
      title="Came back unsold — return to stock"
    >
      {pending ? "…" : "Return"}
    </button>
  );
}
