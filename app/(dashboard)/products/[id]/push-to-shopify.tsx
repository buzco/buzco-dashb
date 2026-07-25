"use client";

import { useActionState } from "react";
import { pushProductToShopifyAction, type PushState } from "@/lib/actions/shopify";
import { Button } from "@/components/ui/button";

export function PushToShopify({ productId }: { productId: string }) {
  const [state, formAction, isPending] = useActionState<PushState | undefined, FormData>(
    () => pushProductToShopifyAction(productId),
    undefined,
  );

  return (
    <form action={formAction} className="flex items-center gap-3">
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Pushing…" : "Push to Shopify as draft"}
      </Button>
      {state?.error && <span className="text-sm text-status-cancelled">{state.error}</span>}
      {state?.ok && (
        <span className="text-sm text-ink/70">Draft created ✓ ({state.linked} variants linked)</span>
      )}
    </form>
  );
}
