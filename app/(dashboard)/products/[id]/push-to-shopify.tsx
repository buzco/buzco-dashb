"use client";

import { useActionState } from "react";
import { pushProductToShopifyAction, type PushState } from "@/lib/actions/shopify";
import { Button } from "@/components/ui/button";

// The label mirrors what will actually happen: the push now sends our own
// status, so an active product goes live rather than landing as a hidden draft.
export function PushToShopify({ productId, status }: { productId: string; status: string }) {
  const goesLive = status === "active";
  const [state, formAction, isPending] = useActionState<PushState | undefined, FormData>(
    () => pushProductToShopifyAction(productId),
    undefined,
  );

  return (
    <form action={formAction} className="flex items-center gap-3">
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Pushing…" : goesLive ? "Push to Shopify (live)" : "Push to Shopify as draft"}
      </Button>
      {state?.error && <span className="text-sm text-status-cancelled">{state.error}</span>}
      {state?.ok && (
        <span className="text-sm text-ink/70">
          {goesLive ? "Published" : "Draft created"} ✓ ({state.linked} variants linked, images sent)
        </span>
      )}
    </form>
  );
}
