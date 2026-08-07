"use client";

import { useActionState } from "react";
import { registerShopifyWebhooks, type WebhookState } from "@/lib/actions/shopify";
import { Button } from "@/components/ui/button";

export function WebhookButton({ disabled, label }: { disabled?: boolean; label: string }) {
  const [state, formAction, isPending] = useActionState<WebhookState | undefined, FormData>(
    () => registerShopifyWebhooks(),
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <Button type="submit" disabled={disabled || isPending}>
        {isPending ? "Registering…" : label}
      </Button>

      {state?.error && <p className="text-sm text-status-cancelled">{state.error}</p>}

      {state?.result && (
        <div className="space-y-1 text-sm text-ink/80">
          <p className="text-bone">Pointing at {state.result.callbackUrl}</p>
          {!!state.result.created.length && <p>Subscribed: {state.result.created.join(", ")}</p>}
          {!!state.result.replaced.length && (
            <p>Re-pointed from an old URL: {state.result.replaced.join(", ")}</p>
          )}
          {!!state.result.alreadyLive.length && (
            <p className="text-ink/50">Already live: {state.result.alreadyLive.join(", ")}</p>
          )}
          {!!state.result.errors.length && (
            <ul className="list-inside list-disc text-status-cancelled">
              {state.result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
