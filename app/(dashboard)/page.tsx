import Link from "next/link";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Table, Th, Td } from "@/components/ui/table";

// The landing page. Its whole job is to answer "is anything wrong, and what
// moved since I last looked?" without making you open five tabs. Everything
// here is derived from tables the rest of the app already writes — there is no
// separate dashboard state to keep in sync.

const LOW_STOCK_AT = 3;
const WINDOW_DAYS = 30;

const eur = (n: number) =>
  "€" + n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface/90 p-5 backdrop-blur-sm">
      <p className="label-caps text-ink/60">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-bone">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink/50">{sub}</p>}
    </div>
  );
}

function Panel({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="label-caps text-ink/60">{title}</h2>
        <Link href={href} className="label-caps text-ink/50 underline-offset-2 hover:text-ink hover:underline">
          {linkLabel}
        </Link>
      </div>
      {children}
    </section>
  );
}

function timeAgo(iso: string | null, now: number): string {
  if (!iso) return "never";
  const mins = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The wall clock, read at request time.
 *
 * connection() is what makes that legal: it defers past the static shell so
 * "30 days ago" is measured when the page is served rather than frozen at build
 * time. Kept out of the component body because reading a clock mid-render is
 * exactly the impurity the react-hooks lint is watching for — here it's a
 * deliberate request-time input, so it enters as one.
 */
async function requestClock(): Promise<number> {
  await connection();
  return Date.now();
}

export default async function HomePage() {
  const now = await requestClock();
  const supabase = await createClient();
  const since = new Date(now - WINDOW_DAYS * 86400_000).toISOString();

  const [
    { data: recentSales },
    { data: allSales },
    { data: variants },
    { data: products },
    { data: stock },
    { data: openMarkets },
    { count: totalProducts },
    { count: linkedProducts },
    { data: lastLinked },
  ] = await Promise.all([
    supabase
      .from("sales")
      .select("id, channel, quantity, net_amount, variant_id, sold_at")
      .order("sold_at", { ascending: false })
      .limit(6),
    supabase.from("sales").select("quantity, net_amount, sold_at").gte("sold_at", since),
    supabase.from("variants").select("id, sku, size, color, product_id, production_cost"),
    supabase.from("products").select("id, name"),
    supabase.from("current_stock_by_variant").select("variant_id, total_quantity"),
    supabase
      .from("market_events")
      .select("id, name, venue, starts_at, status")
      .neq("status", "closed")
      .order("starts_at"),
    supabase.from("products").select("*", { count: "exact", head: true }),
    supabase
      .from("products")
      .select("*", { count: "exact", head: true })
      .not("shopify_product_id", "is", null),
    // No sync-log table exists, so the freshest linked product's updated_at is
    // the closest honest proxy for "when did Shopify last reach us".
    supabase
      .from("products")
      .select("updated_at")
      .not("shopify_product_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const productById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const variantById = new Map((variants ?? []).map((v) => [v.id, v]));
  const costByVariant = new Map((variants ?? []).map((v) => [v.id, Number(v.production_cost ?? 0)]));

  // Window totals
  let windowRevenue = 0;
  let windowUnits = 0;
  for (const s of allSales ?? []) {
    windowRevenue += Number(s.net_amount ?? 0);
    windowUnits += s.quantity;
  }

  // Stock position
  let unitsInStock = 0;
  let inventoryValue = 0;
  const low: Array<{ id: string; label: string; qty: number }> = [];
  for (const row of stock ?? []) {
    const qty = row.total_quantity ?? 0;
    unitsInStock += qty;
    inventoryValue += (costByVariant.get(row.variant_id) ?? 0) * qty;
    if (qty <= LOW_STOCK_AT) {
      const v = variantById.get(row.variant_id);
      if (!v) continue;
      const attrs = [v.size, v.color].filter(Boolean).join(" / ");
      low.push({
        id: row.variant_id,
        label: `${productById.get(v.product_id) ?? v.sku}${attrs ? ` · ${attrs}` : ""}`,
        qty,
      });
    }
  }
  low.sort((a, b) => a.qty - b.qty);
  const outOfStock = low.filter((l) => l.qty <= 0).length;

  function saleLabel(variantId: string | null): string {
    if (!variantId) return "Raffle ticket";
    const v = variantById.get(variantId);
    if (!v) return "—";
    const attrs = [v.size, v.color].filter(Boolean).join(" / ");
    return `${productById.get(v.product_id) ?? v.sku}${attrs ? ` · ${attrs}` : ""}`;
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="label-caps text-ink/60">Home</h1>
        <p className="mt-2 text-sm text-ink/50">
          Last {WINDOW_DAYS} days · Shopify last reached us{" "}
          {timeAgo(lastLinked?.updated_at ?? null, now)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={`Revenue ${WINDOW_DAYS}d`} value={eur(windowRevenue)} sub="net, all channels" />
        <Stat label={`Units sold ${WINDOW_DAYS}d`} value={windowUnits.toString()} />
        <Stat label="Units in stock" value={unitsInStock.toString()} sub={eur(inventoryValue) + " at cost"} />
        <Stat
          label="On Shopify"
          value={`${linkedProducts ?? 0}/${totalProducts ?? 0}`}
          sub="products linked"
        />
      </div>

      {!!openMarkets?.length && (
        <Panel title="Markets open now" href="/markets" linkLabel="All markets">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {openMarkets.map((m) => (
              <Link
                key={m.id}
                href={`/markets/${m.id}`}
                className="rounded-lg border border-line bg-surface/90 p-4 backdrop-blur-sm transition-colors hover:border-ink/40"
              >
                <p className="font-bold text-bone">{m.name}</p>
                <p className="mt-1 text-sm text-ink/60">
                  {m.venue ?? "—"} · {new Date(m.starts_at).toLocaleDateString("en-IE")}
                </p>
              </Link>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <Panel title="Recent sales" href="/sales" linkLabel="All sales">
          {!recentSales?.length ? (
            <p className="text-sm text-ink/50">No sales logged yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Channel</Th>
                  <Th className="text-right">Net</Th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map((s) => (
                  <tr key={s.id}>
                    <Td className="text-bone">{saleLabel(s.variant_id)}</Td>
                    <Td className="label-caps text-ink/60">{s.channel.replace(/_/g, " ")}</Td>
                    <Td className="text-right font-mono tabular-nums">{eur(Number(s.net_amount ?? 0))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title={`Low stock (${LOW_STOCK_AT} or fewer)`} href="/products" linkLabel="All products">
          {!low.length ? (
            <p className="text-sm text-ink/50">Nothing running low.</p>
          ) : (
            <>
              {outOfStock > 0 && (
                <p className="text-sm text-status-cancelled">
                  {outOfStock} variant{outOfStock === 1 ? " is" : "s are"} at zero or oversold.
                </p>
              )}
              <Table>
                <thead>
                  <tr>
                    <Th>Variant</Th>
                    <Th className="text-right">Left</Th>
                  </tr>
                </thead>
                <tbody>
                  {low.slice(0, 8).map((l) => (
                    <tr key={l.id}>
                      <Td className="text-bone">{l.label}</Td>
                      <Td
                        className={`text-right font-mono tabular-nums ${
                          l.qty <= 0 ? "text-status-cancelled" : "text-ink/80"
                        }`}
                      >
                        {l.qty}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {low.length > 8 && (
                <p className="text-xs text-ink/50">+{low.length - 8} more running low.</p>
              )}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
