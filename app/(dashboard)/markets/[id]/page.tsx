import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { setMarketStatus } from "@/lib/actions/markets";
import { hasRaffleDb, isNotionConfigured } from "@/lib/notion/client";
import { getRaffleTickets, type RaffleTicket } from "@/lib/notion/raffle";
import { getPaymentMethodOptions } from "@/lib/notion/sales";
import { raffleTotalsForEvent } from "@/lib/market/raffle-sales";
import { loadMarketData } from "./market-data";
import { StockGrid } from "./stock-grid";
import { LoadPanel, type VariantOption } from "./load-panel";
import { PricesPanel } from "./prices-panel";
import { SalesPanel } from "./sales-panel";
import { RafflePanel } from "./raffle-panel";

// Tabs are URL state rather than client state on purpose: each tab fetches only
// what it needs (the raffle tab hits the Notion API, the stock tab doesn't), and
// a reload at the stall lands you back where you were.
const TABS = [
  { key: "stock", label: "Stock" },
  { key: "sales", label: "Sales" },
  { key: "prices", label: "Prices" },
  { key: "load", label: "Load" },
  { key: "raffle", label: "Raffle" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function MarketEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "stock";

  const data = await loadMarketData(id);
  if (!data) notFound();

  const { event, totals } = data;
  const notionConfigured = isNotionConfigured();

  // Load-tab-only extras: every variant plus what's available to pack from.
  let variantOptions: VariantOption[] = [];
  if (tab === "load") {
    variantOptions = await loadVariantOptions(event.location_id);
  }

  // The sell sheet offers the tracker's own payment options (cached, never
  // throws) so a manual sale can't invent a new option in their database.
  const paymentMethods = tab === "stock" && notionConfigured ? await getPaymentMethodOptions() : [];

  // Raffle-tab-only: the Notion prize register.
  let raffleTickets: RaffleTicket[] = [];
  let raffleError: string | null = null;
  let raffleTotals = { tickets: 0, revenue: 0 };
  if (tab === "raffle") {
    const supabase = await createClient();
    const t = await raffleTotalsForEvent(supabase, id);
    raffleTotals = { tickets: t.tickets, revenue: t.revenue };
    if (!hasRaffleDb()) {
      raffleError = "Notion raffle database isn't configured yet.";
    } else {
      try {
        raffleTickets = await getRaffleTickets();
      } catch (e) {
        raffleError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  // Default the load-in source to wherever the stock actually is, not to the
  // warehouse on principle — Main Warehouse currently holds 0 units (everything
  // sits in the Shopify mirror location), so defaulting by type alone would make
  // every load-in fail market_load_in's source guard. Warehouse breaks ties.
  const sourceLocations = data.locations.filter((l) => l.id !== event.location_id);
  const defaultFromLocationId =
    [...sourceLocations].sort(
      (a, b) =>
        b.stockTotal - a.stockTotal ||
        Number(b.type === "warehouse") - Number(a.type === "warehouse"),
    )[0]?.id ?? "";

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href="/markets" className="label-caps text-ink/50 hover:text-ink">
              ← Markets
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-bone">{event.name}</h1>
            <p className="text-sm text-ink/50">
              {[
                event.venue,
                new Date(event.starts_at).toLocaleString(undefined, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {["planning", "live", "closed"].map((status) => (
              <form key={status} action={setMarketStatus.bind(null, event.id, status)}>
                <button
                  type="submit"
                  disabled={event.status === status}
                  className={`label-caps rounded-full border px-3 py-1 ${
                    event.status === status
                      ? "border-status-active text-status-active"
                      : "border-line text-ink/50 hover:border-ink/60 hover:text-ink"
                  }`}
                >
                  {status}
                </button>
              </form>
            ))}
          </div>
        </div>

        {/* The three numbers that matter mid-event, big enough to read standing up. */}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="In crate" value={String(totals.inCrate)} />
          <Stat label="Sold" value={String(totals.sold)} />
          <Stat label="Taken" value={`€${totals.revenue.toFixed(2)}`} accent />
        </div>

        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/markets/${event.id}?tab=${t.key}`}
              className={`label-caps shrink-0 rounded-md border px-3 py-2 ${
                tab === t.key
                  ? "border-ink bg-ink/10 text-ink"
                  : "border-transparent text-ink/50 hover:text-ink"
              }`}
            >
              {t.label}
              {t.key === "sales" && totals.unsyncedNotion > 0 && notionConfigured && (
                <span className="ml-1.5 text-status-ordered">•</span>
              )}
            </Link>
          ))}
        </nav>
      </header>

      {tab === "stock" && (
        <StockGrid
          eventId={event.id}
          products={data.products}
          readOnly={event.status === "closed"}
          paymentMethods={paymentMethods}
        />
      )}
      {tab === "sales" && <SalesPanel data={data} notionConfigured={notionConfigured} />}
      {tab === "prices" && <PricesPanel data={data} />}
      {tab === "load" && (
        <LoadPanel
          data={data}
          variantOptions={variantOptions}
          defaultFromLocationId={defaultFromLocationId}
        />
      )}
      {tab === "raffle" && (
        <RafflePanel
          eventId={event.id}
          tickets={raffleTickets}
          error={raffleError}
          raffleTotals={raffleTotals}
        />
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

/**
 * Everything packable, labelled and annotated with how many units exist outside
 * this market's own crate — so you can't try to load what you don't have.
 */
async function loadVariantOptions(marketLocationId: string): Promise<VariantOption[]> {
  const supabase = await createClient();

  const [{ data: variants }, { data: stock }] = await Promise.all([
    supabase.from("variants").select("id, product_id, size, color, sku").order("sku"),
    supabase.from("current_stock").select("variant_id, location_id, quantity"),
  ]);

  const productIds = [...new Set((variants ?? []).map((v) => v.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name").in("id", productIds)
    : { data: [] };
  const nameById = new Map((products ?? []).map((p) => [p.id, p.name]));

  const availableByVariant = new Map<string, number>();
  for (const row of stock ?? []) {
    if (row.location_id === marketLocationId) continue;
    availableByVariant.set(
      row.variant_id,
      (availableByVariant.get(row.variant_id) ?? 0) + row.quantity,
    );
  }

  // The SKU is always shown, not just as a fallback: three separate Shopify
  // products are all named "Butterfly Thermal Waffle Longsleeve" (colourways
  // with no colour set), so name+size alone renders five sets of identical
  // options and you cannot tell which one you're packing.
  return (variants ?? [])
    .map((v) => {
      const attrs = [v.size, v.color].filter(Boolean).join(" / ");
      const name = nameById.get(v.product_id) ?? "Unknown";
      return {
        id: v.id,
        label: attrs ? `${name} — ${attrs} · ${v.sku}` : `${name} — ${v.sku}`,
        available: availableByVariant.get(v.id) ?? 0,
      };
    })
    .sort((a, b) => Number(b.available > 0) - Number(a.available > 0) || a.label.localeCompare(b.label));
}
