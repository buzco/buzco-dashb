import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createMarketEvent } from "@/lib/actions/markets";
import { isNotionConfigured } from "@/lib/notion/client";
import { describeSalesMapping } from "@/lib/notion/sales";
import { Button } from "@/components/ui/button";
import { Label, Input } from "@/components/ui/input";
import { StallLinks } from "./stall-links";

function statusTone(status: string): string {
  if (status === "live") return "border-status-active text-status-active";
  if (status === "closed") return "border-status-settled text-status-settled";
  return "border-status-draft text-status-draft";
}

function dateRange(startsAt: string, endsAt: string | null): string {
  const start = new Date(startsAt);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (!endsAt) return start.toLocaleDateString(undefined, opts);
  const end = new Date(endsAt);
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

export default async function MarketsPage() {
  const supabase = await createClient();

  const { data: events } = await supabase
    .from("market_events")
    .select("id, name, venue, starts_at, ends_at, status, location_id")
    .order("starts_at", { ascending: false });

  // Units still in each crate + money taken, per event — the two numbers worth
  // seeing without opening an event.
  const locationIds = (events ?? []).map((e) => e.location_id);
  const [{ data: stock }, { data: sales }] = await Promise.all([
    supabase.from("current_stock").select("location_id, quantity").in("location_id", locationIds),
    supabase
      .from("sales")
      .select("market_event_id, quantity, net_amount")
      .not("market_event_id", "is", null),
  ]);

  const unitsByLocation = new Map<string, number>();
  for (const row of stock ?? []) {
    unitsByLocation.set(row.location_id, (unitsByLocation.get(row.location_id) ?? 0) + row.quantity);
  }
  const takingsByEvent = new Map<string, { units: number; revenue: number }>();
  for (const s of sales ?? []) {
    const key = s.market_event_id as string;
    const acc = takingsByEvent.get(key) ?? { units: 0, revenue: 0 };
    acc.units += s.quantity;
    acc.revenue += Number(s.net_amount);
    takingsByEvent.set(key, acc);
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="label-caps text-ink/60">Markets &amp; pop-ups</h1>
        <p className="mt-1 text-sm text-ink/50">
          One event per selling day. Load the crate, set the day&apos;s prices, and every POS sale
          comes back here and into Notion.
        </p>
      </div>

      {!events?.length ? (
        <p className="text-sm text-ink/50">No events yet — create your first one below.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {events.map((e) => {
            const units = unitsByLocation.get(e.location_id) ?? 0;
            const takings = takingsByEvent.get(e.id) ?? { units: 0, revenue: 0 };
            return (
              <li key={e.id}>
                <Link
                  href={`/markets/${e.id}`}
                  className="block rounded-lg border border-line bg-surface p-4 transition-colors hover:border-ink/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-bone">{e.name}</p>
                      <p className="truncate text-xs text-ink/50">
                        {[e.venue, dateRange(e.starts_at, e.ends_at)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <span
                      className={`label-caps shrink-0 rounded-full border px-2.5 py-0.5 ${statusTone(e.status)}`}
                    >
                      {e.status}
                    </span>
                  </div>
                  <div className="mt-4 flex gap-6">
                    <div>
                      <p className="label-caps text-ink/40">In crate</p>
                      <p className="font-mono text-lg tabular-nums text-bone">{units}</p>
                    </div>
                    <div>
                      <p className="label-caps text-ink/40">Sold</p>
                      <p className="font-mono text-lg tabular-nums text-bone">{takings.units}</p>
                    </div>
                    <div>
                      <p className="label-caps text-ink/40">Taken</p>
                      <p className="font-mono text-lg tabular-nums text-ink">
                        €{takings.revenue.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <StallLinks />

      <NotionMappingCheck />

      <div className="space-y-3">
        <h2 className="label-caps text-ink/60">New event</h2>
        <form action={createMarketEvent} className="max-w-xl space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Event name</Label>
            <Input id="name" name="name" required placeholder="Feira do Relógio — July" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="venue">Venue</Label>
            <Input id="venue" name="venue" placeholder="Lisbon, Alvalade" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="starts_at">Starts</Label>
              <Input id="starts_at" name="starts_at" type="datetime-local" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ends_at">Ends</Label>
              <Input id="ends_at" name="ends_at" type="datetime-local" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" placeholder="Stall 14, load in 8am" />
          </div>
          <Button type="submit">Create event</Button>
        </form>
      </div>
    </div>
  );
}

/**
 * Shows how our fields line up with the live Notion columns. Column names and
 * types are editable in Notion, so this makes a rename visible here rather than
 * as quietly-missing data after an event.
 */
async function NotionMappingCheck() {
  if (!isNotionConfigured()) {
    return (
      <div className="rounded-lg border border-line bg-surface p-4">
        <p className="label-caps text-ink/60">Notion mirror</p>
        <p className="mt-1 text-sm text-ink/50">
          Not configured. Add <span className="font-mono text-ink/70">NOTION_TOKEN</span> and{" "}
          <span className="font-mono text-ink/70">NOTION_SALES_DB_ID</span> to{" "}
          <span className="font-mono text-ink/70">.env.local</span>, and share the Sales Tracker
          database with the integration. Market sales still record normally without it.
        </p>
      </div>
    );
  }

  let rows: Awaited<ReturnType<typeof describeSalesMapping>> = [];
  let error: string | null = null;
  try {
    rows = await describeSalesMapping();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <details className="rounded-lg border border-line bg-surface p-4">
      <summary className="label-caps cursor-pointer list-none text-ink/60">
        Notion mirror {error ? "· error" : `· ${rows.filter((r) => r.notionColumn).length}/${rows.length} fields mapped`}
      </summary>
      {error ? (
        <p className="mt-2 text-sm text-status-cancelled">{error}</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {rows.map((r) => (
            <li key={r.field} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink/60">{r.field}</span>
              {r.notionColumn ? (
                <span className="text-bone">
                  {r.notionColumn}{" "}
                  <span className="label-caps text-ink/40">{r.notionType}</span>
                </span>
              ) : (
                <span className="label-caps text-status-ordered">no matching column</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
