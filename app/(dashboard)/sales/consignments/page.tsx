import Link from "next/link";
import { loadSaleOrders } from "@/lib/sales/data";
import { getSalesOptions, payableOptions } from "@/lib/notion/options";
import { OrderBlock } from "../order-block";

// Consignations kept apart from sales because they are a different kind of
// fact: the goods have gone but the money hasn't come, and the only thing you
// ever want to do here is chase or settle. Open ones sit on top; settled ones
// stay below as history rather than disappearing.

export default async function ConsignmentsSubTabPage() {
  const [orders, options] = await Promise.all([
    loadSaleOrders({ kind: "consignment" }),
    getSalesOptions(),
  ]);

  const open = orders.filter((o) => o.paymentStatus === "pending");
  const settled = orders.filter((o) => o.paymentStatus === "paid");

  const outstanding = open.reduce((n, o) => n + o.net, 0);
  const unitsOut = open.reduce((n, o) => n + o.units, 0);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Open" value={String(open.length)} />
        <Stat label="Units out" value={String(unitsOut)} />
        <Stat label="Owed to us" value={`€${outstanding.toFixed(2)}`} accent />
      </div>

      <section className="space-y-3">
        <h2 className="label-caps text-ink/60">Awaiting payment</h2>
        {!open.length ? (
          <p className="text-sm text-ink/50">
            Nothing out on consignation.{" "}
            <Link href="/sales/new" className="text-ink underline">
              Log one
            </Link>{" "}
            and it lands here.
          </p>
        ) : (
          <div className="space-y-2">
            {open.map((order) => (
              <OrderBlock key={order.id} order={order} paymentOptions={payableOptions(options.payment)} />
            ))}
          </div>
        )}
      </section>

      {Boolean(settled.length) && (
        <section className="space-y-3">
          <h2 className="label-caps text-ink/60">Settled</h2>
          <div className="space-y-2">
            {settled.map((order) => (
              <OrderBlock key={order.id} order={order} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="label-caps text-ink/40">{label}</p>
      <p className={`font-mono text-2xl tabular-nums ${accent ? "text-ink" : "text-bone"}`}>
        {value}
      </p>
    </div>
  );
}
