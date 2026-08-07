"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Webhooks keep the database current; this keeps the screen current.
//
// router.refresh() re-runs the server components for the route and patches the
// result in — client state (a half-filled form, the campaign calculator's
// selection) survives it. Refreshes are skipped while the tab is hidden and
// fire once on the way back, so a dashboard left open overnight isn't polling
// into the void but is up to date the moment you look at it.

const DEFAULT_INTERVAL_MS = 30_000;

export function AutoRefresh({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    const timer = setInterval(refreshIfVisible, intervalMs);
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("online", refreshIfVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("online", refreshIfVisible);
    };
  }, [router, intervalMs]);

  return null;
}
