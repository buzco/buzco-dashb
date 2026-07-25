import { unclaimRaffleTicket } from "@/lib/actions/markets";
import { groupByPrize, type RaffleTicket } from "@/lib/notion/raffle";
import { RaffleTicketFinder } from "./raffle-finder";

// The raffle register stays in Notion — prizes are not products and never touch
// the inventory ledger. This tab is a read view over that database plus the one
// write you need at a stall: marking a ticket claimed.

export function RafflePanel({
  eventId,
  tickets,
  error,
}: {
  eventId: string;
  tickets: RaffleTicket[];
  error: string | null;
}) {
  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-status-cancelled">{error}</p>
        <p className="text-xs text-ink/50">
          Set <span className="font-mono">NOTION_RAFFLE_DB_ID</span> in{" "}
          <span className="font-mono">.env.local</span> and share that database with the
          integration (Notion → ••• → Connections).
        </p>
      </div>
    );
  }

  const groups = groupByPrize(tickets);
  const claimed = tickets.filter((t) => t.claimed);
  const remainingValue = groups.reduce((sum, g) => sum + g.remainingValue, 0);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tickets" value={String(tickets.length)} />
        <Stat label="Claimed" value={String(claimed.length)} />
        <Stat label="Left to give" value={String(tickets.length - claimed.length)} />
        <Stat label="Prize value left" value={`€${remainingValue.toFixed(2)}`} accent />
      </div>

      <RaffleTicketFinder eventId={eventId} tickets={tickets} />

      <div className="space-y-3">
        <h2 className="label-caps text-ink/60">Prizes</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {groups.map((g) => (
            <li
              key={g.prize}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-bone">{g.prize}</p>
                <p className="text-xs text-ink/50">
                  {g.unitValue != null ? `€${g.unitValue.toFixed(2)} each` : "no value set"}
                  {g.belongsTo.length ? ` · ${g.belongsTo.join(" + ")}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-lg tabular-nums text-bone">
                  {g.remaining}
                  <span className="text-sm text-ink/40">/{g.total}</span>
                </p>
                <p className="label-caps text-ink/40">left</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {claimed.length > 0 && (
        <div className="space-y-3">
          <h2 className="label-caps text-ink/60">Claimed today &amp; before</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {claimed
              .slice()
              .sort((a, b) => (b.dateClaimed ?? "").localeCompare(a.dateClaimed ?? ""))
              .slice(0, 25)
              .map((t) => (
                <li key={t.pageId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                  <span className="label-caps rounded-full border border-line px-2 py-0.5 text-ink/70">
                    {t.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-bone">{t.prize}</span>
                  {t.winner && <span className="text-xs text-ink/60">{t.winner}</span>}
                  {t.dateClaimed && (
                    <span className="font-mono text-xs tabular-nums text-ink/40">
                      {new Date(t.dateClaimed).toLocaleDateString()}
                    </span>
                  )}
                  <form action={unclaimRaffleTicket.bind(null, eventId, t.pageId)}>
                    <button type="submit" className="label-caps text-ink/40 hover:text-status-cancelled">
                      Undo
                    </button>
                  </form>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="label-caps text-ink/40">{label}</p>
      <p className={`font-mono text-xl tabular-nums ${accent ? "text-ink" : "text-bone"}`}>{value}</p>
    </div>
  );
}
