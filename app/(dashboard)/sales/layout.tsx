import Link from "next/link";
import { loadSaleOrders } from "@/lib/sales/data";
import { SalesTabs } from "./sales-tabs";

// The header is in a layout rather than repeated per page so the tab strip and
// the "New sale" button don't flicker when moving between sub-tabs — only the
// panel below them re-renders.

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const pending = await loadSaleOrders({ kind: "consignment", pendingOnly: true });

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="label-caps text-ink/60">Sales</h1>
          <Link
            href="/sales/new"
            className="label-caps rounded-md bg-pink px-4 py-2 text-black transition-opacity hover:opacity-90"
          >
            + New sale
          </Link>
        </div>
        <SalesTabs pendingCount={pending.length} />
      </header>

      {children}
    </div>
  );
}
