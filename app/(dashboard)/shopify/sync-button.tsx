"use client";

import { useActionState } from "react";
import { runShopifySync, type ShopifySyncState } from "@/lib/actions/shopify";
import { Button } from "@/components/ui/button";

export function SyncButton({ disabled }: { disabled?: boolean }) {
  const [state, formAction, isPending] = useActionState<ShopifySyncState | undefined, FormData>(
    () => runShopifySync(),
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <Button type="submit" disabled={disabled || isPending}>
        {isPending ? "Syncing…" : "Sync from Shopify"}
      </Button>

      {state?.error && <p className="text-sm text-status-cancelled">{state.error}</p>}

      {state?.result && (
        <div className="space-y-1 text-sm text-ink/80">
          <p className="text-bone">Sync complete.</p>
          <p>
            Products: {state.result.productsCreated} created, {state.result.productsUpdated} updated
          </p>
          <p>
            Variants: {state.result.variantsCreated} created, {state.result.variantsLinked} linked,{" "}
            {state.result.variantsUpdated} updated
          </p>
          {state.result.errors.length > 0 && (
            <div className="text-status-cancelled">
              <p>{state.result.errors.length} row(s) skipped:</p>
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
