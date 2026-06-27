"use client";

import { useActionState } from "react";
import { receivePurchaseOrderLine, type ReceiveState } from "@/lib/actions/purchase-orders";

type Location = { id: string; name: string };

export function ReceiveLineForm({
  poId,
  lineId,
  remaining,
  locations,
  defaultLocationId,
}: {
  poId: string;
  lineId: string;
  remaining: number;
  locations: Location[];
  defaultLocationId: string;
}) {
  const action = receivePurchaseOrderLine.bind(null, poId, lineId);
  const [state, formAction, isPending] = useActionState<ReceiveState | undefined, FormData>(
    action,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        name="quantity"
        type="number"
        min={1}
        max={remaining}
        defaultValue={remaining}
        required
        className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-sm text-bone outline-none focus:border-ink"
      />
      <select
        name="location_id"
        defaultValue={defaultLocationId}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-bone outline-none focus:border-ink"
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="label-caps rounded-md border border-line px-3 py-1 text-ink hover:border-ink disabled:opacity-50"
      >
        {isPending ? "…" : "Receive"}
      </button>
      {state?.error && <span className="text-xs text-status-cancelled">{state.error}</span>}
      {state?.ok && <span className="text-xs text-ink/50">Received ✓</span>}
    </form>
  );
}
