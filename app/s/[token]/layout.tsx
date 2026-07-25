import type { Metadata } from "next";

// Standalone shell for the stall links: no sidebar, no nav into the rest of the
// app, nothing a helper could wander into. Deliberately noindex/nofollow so a
// shared link can't turn up in a search engine.

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function StallLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-paper text-ink">{children}</div>;
}
