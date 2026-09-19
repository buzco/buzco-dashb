"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Sub-tabs are real routes, not client state: each one loads only what it
// needs (the logger reaches Notion for its option lists, the history doesn't),
// and a reload mid-market lands you back on the same tab.

const TABS = [
  { href: "/sales", label: "Overview", exact: true },
  { href: "/sales/new", label: "New sale", exact: false },
  { href: "/sales/consignments", label: "Consignations", exact: false },
] as const;

export function SalesTabs({ pendingCount }: { pendingCount: number }) {
  const pathname = usePathname();

  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`label-caps shrink-0 rounded-md border px-3 py-2 ${
              active
                ? "border-ink bg-ink/10 text-ink"
                : "border-transparent text-ink/50 hover:text-ink"
            }`}
          >
            {t.label}
            {t.href === "/sales/consignments" && pendingCount > 0 && (
              <span className="ml-1.5 font-mono text-status-ordered">{pendingCount}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
