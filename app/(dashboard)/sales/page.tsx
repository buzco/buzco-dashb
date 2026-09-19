import Link from "next/link";
import { isNotionConfigured } from "@/lib/notion/client";
import { loadLooseSales, loadSaleOrders, loadSalesTotals } from "@/lib/sales/data";
import { Table, Th, Td } from "@/components/ui/table";
import { OrderBlock } from "./order-block";

// The overview answers three questions in order: what came in today, what is
// still owed, and what was the last thing logged. Orders come first because
// that is now the unit of a sale; the table underneath is everything that
// predates orders (market tills, Shopify imports, raffle rows) so no history
// disappears from view.

export default async function SalesPage() {
  const [totals, orders, looseSales] = await Promise.all([
    loadSalesTotals(),
    loadSaleOrders({ limit: 25 }),
    loadLooseSales(25),
  ]);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today" value={`€${totals.todayNet.toFixed(2)}`} accent />
        <Stat label="This month" value={`€${totals.monthNet.toFixed(2)}`} />
        <Stat label="Units this month" value={String(totals.monthUnits)} />
        <Stat
          label="Owed to us"
          value={`€${totals.outstanding.toFixed(2)}`}
          hint={
            totals.outstandingOrders
              ? `${totals.outstandingOrders} consignation${totals.outstandingOrders === 1 ? "" : "s"}`
              : undefined
          }
        />
      </div>

      {isNotionConfigured() && totals.unsyncedNotion > 0 && (
        <p className="rounded-md border border-status-ordered/50 bg-status-ordered/5 px-4 py-3 text-sm text-status-ordered">
          {totals.unsyncedNotion} sale row{totals.unsyncedNotion === 1 ? "" : "s"} haven&apos;t reached
          Notion. Open the order below and press Retry.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="label-caps text-ink/60">Orders</h2>
        {!orders.length ? (
          <p className="text-sm text-ink/50">
            Nothing logged yet —{" "}
            <Link href="/sales/new" className="text-ink underline">
              log your first sale
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-2">
            {orders.map((order) => (
              <OrderBlock key={order.id} order={order} />
            ))}
          </div>
        )}
      </section>

      {Boolean(looseSales.length) && (
        <section className="space-y-3">
          <h2 className="label-caps text-ink/60">Other sales</h2>
          <p className="text-sm text-ink/50">
            Market tills, Shopify imports and raffle rows — recorded outside an order.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Channel</Th>
                <Th>Item</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Net</Th>
                <Th>Customer</Th>
              </tr>
            </thead>
            <tbody>
              {looseSales.map((s) => (
                <tr key={s.id}>
                  <Td className="text-ink/70">{new Date(s.soldAt).toLocaleDateString()}</Td>
                  <Td className="label-caps">{s.channel.replace(/_/g, " ")}</Td>
                  <Td className="text-bone">{s.label}</Td>
                  <Td className="text-right font-mono tabular-nums">{s.quantity}</Td>
                  <Td className="text-right font-mono tabular-nums text-bone">
                    €{s.netAmount.toFixed(2)}
                  </Td>
                  <Td className="text-ink/70">{s.customerRef ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="label-caps text-ink/40">{label}</p>
      <p className={`font-mono text-2xl tabular-nums ${accent ? "text-ink" : "text-bone"}`}>
        {value}
      </p>
      {hint && <p className="label-caps text-ink/40">{hint}</p>}
    </div>
  );
}
