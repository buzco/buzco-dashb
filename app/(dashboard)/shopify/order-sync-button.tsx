"use client";

import { useActionState } from "react";
import { runShopifyOrderSync, type OrderSyncState } from "@/lib/actions/shopify";
import { Button } from "@/components/ui/button";

export function OrderSyncButton({ disabled }: { disabled?: boolean }) {
  const [state, formAction, isPending] = useActionState<OrderSyncState | undefined, FormData>(
    () => runShopifyOrderSync(),
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <Button type="submit" variant="secondary" disabled={disabled || isPending}>
        {isPending ? "Importing orders…" : "Import Shopify orders"}
      </Button>

      {state?.error && <p className="text-sm text-status-cancelled">{state.error}</p>}

      {state?.result && (
        <div className="space-y-1 text-sm text-ink/80">
          <p className="text-bone">Order import complete.</p>
          <p>
            {state.result.ordersSeen} orders seen · {state.result.salesCreated} sales created ·{" "}
            {state.result.salesSkipped} already imported
          </p>
          {state.result.linesWithoutKnownVariant > 0 && (
            <p className="text-ink/50">
              {state.result.linesWithoutKnownVariant} line(s) skipped (variant not in catalog — sync catalog first)
            </p>
          )}
          {state.result.errors.length > 0 && (
            <div className="text-status-cancelled">
              <p>{state.result.errors.length} error(s):</p>
              <ul className="list-inside list-disc">
                {state.result.errors.slice(0, 8).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
