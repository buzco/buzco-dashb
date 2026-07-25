"use client";

import { useEffect, useState, useTransition } from "react";
import { pullPosSales, retryNotionSync, type SyncState } from "@/lib/actions/markets";

// Shopify POS sales are polled, not pushed: a webhook that fires while the
// dashboard is shut is a silent miss, and venue wifi drops. Pulling is
// idempotent, so "check again" is always safe — and while the event is live we
// do it automatically every 30s so the grid keeps up with the till.

const POLL_MS = 30_000;

export function SyncButtons({
  eventId,
  isLive,
  unsyncedNotion,
  notionConfigured,
}: {
  eventId: string;
  isLive: boolean;
  unsyncedNotion: number;
  notionConfigured: boolean;
}) {
  const [state, setState] = useState<SyncState | undefined>();
  const [pending, startTransition] = useTransition();
  const [autoPoll, setAutoPoll] = useState(isLive);

  const pull = () => {
    startTransition(async () => {
      setState(await pullPosSales(eventId));
    });
  };

  const retry = () => {
    startTransition(async () => {
      setState(await retryNotionSync(eventId));
    });
  };

  useEffect(() => {
    if (!autoPoll) return;
    const timer = setInterval(() => {
      startTransition(async () => {
        setState(await pullPosSales(eventId));
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [autoPoll, eventId]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={pull}
          disabled={pending}
          className="label-caps rounded-md bg-pink px-4 py-2 text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Checking POS…" : "Pull POS sales"}
        </button>

        <button
          type="button"
          onClick={() => setAutoPoll((v) => !v)}
          aria-pressed={autoPoll}
          className={`label-caps rounded-md border px-3 py-2 ${
            autoPoll ? "border-status-active text-status-active" : "border-line text-ink/60"
          }`}
        >
          {autoPoll ? "Auto every 30s · on" : "Auto every 30s · off"}
        </button>

        {notionConfigured && unsyncedNotion > 0 && (
          <button
            type="button"
            onClick={retry}
            disabled={pending}
            className="label-caps rounded-md border border-status-ordered px-3 py-2 text-status-ordered disabled:opacity-50"
          >
            Retry {unsyncedNotion} Notion sync{unsyncedNotion === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {state?.message && <p className="text-sm text-ink/60">{state.message}</p>}
      {state?.error && <p className="text-sm text-status-cancelled">{state.error}</p>}
      {!notionConfigured && (
        <p className="text-xs text-ink/40">
          Notion isn&apos;t configured — set NOTION_TOKEN and NOTION_SALES_DB_ID to mirror sales
          into the tracker.
        </p>
      )}
    </div>
  );
}
