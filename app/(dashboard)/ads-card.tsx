import Link from "next/link";
import { connection } from "next/server";
import { getAdsSummary } from "@/lib/meta/summary";

// The home page's answer to "are the ads worth it right now?".
//
// Deliberately one line of verdict and four numbers. The full picture lives on
// the Ad budget page; this exists so nobody has to open it to find out that a
// campaign has been quietly burning money since Tuesday.

const eur = (n: number) =>
  (n < 0 ? "−€" : "€") +
  Math.abs(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Cell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  const colour = tone === "good" ? "text-status-received" : tone === "bad" ? "text-status-cancelled" : "text-bone";
  return (
    <div>
      <p className="label-caps text-ink/50">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${colour}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink/40">{sub}</p>}
    </div>
  );
}

/** Same idiom as the home page's clock — a request-time input, not a render-time impurity. */
async function requestToday(): Promise<string> {
  await connection();
  return new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
}

export async function AdsCard() {
  const [summary, twoDaysAgo] = await Promise.all([getAdsSummary(), requestToday()]);

  // Nothing to say if it was never connected — don't nag about an integration
  // the user may not want.
  if (!summary.configured) return null;

  if (summary.error || !summary.attribution || !summary.connection) {
    return (
      <section className="space-y-3">
        <h2 className="label-caps text-ink/60">Ads</h2>
        <div className="rounded-lg border border-status-cancelled/60 bg-surface/90 p-5 backdrop-blur-sm">
          <p className="text-sm text-bone">Meta account unreachable</p>
          <p className="mt-1 font-mono text-xs text-status-cancelled">{summary.error}</p>
        </div>
      </section>
    );
  }

  const { attribution, breakEvenCpa, connection } = summary;
  const spending = attribution.windows.some((w) => w.end >= twoDaysAgo);

  // The headline judgement, in one sentence, using the defensible CPA rather
  // than either the flattering or the pessimistic one.
  const cpa = attribution.cpaLift > 0 ? attribution.cpaLift : attribution.cpaInWindow;
  const verdict =
    breakEvenCpa <= 0
      ? { text: "Add production costs to judge the ads", tone: undefined }
      : cpa <= 0
        ? { text: "Nothing sold while ads were running", tone: "bad" as const }
        : cpa <= breakEvenCpa
          ? { text: `Buying orders at ${eur(cpa)} against a ${eur(breakEvenCpa)} ceiling`, tone: "good" as const }
          : { text: `Orders cost ${eur(cpa)} against a ${eur(breakEvenCpa)} ceiling`, tone: "bad" as const };

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="label-caps text-ink/60">Ads</h2>
        <Link
          href="/campaign"
          className="label-caps text-ink/50 underline-offset-2 hover:text-ink hover:underline"
        >
          Ad budget
        </Link>
      </div>

      <div className="rounded-lg border border-line bg-surface/90 p-5 backdrop-blur-sm">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm text-bone">{connection.name}</span>
          <span
            className={`label-caps rounded-full border px-2 py-0.5 ${
              spending
                ? "border-status-received text-status-received"
                : "border-line text-ink/40"
            }`}
          >
            {spending ? "delivering" : "idle"}
          </span>
          <span
            className={`text-xs ${
              verdict.tone === "good"
                ? "text-status-received"
                : verdict.tone === "bad"
                  ? "text-status-cancelled"
                  : "text-ink/50"
            }`}
          >
            {verdict.text}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Cell label="Ad spend" value={eur(attribution.adSpend)} sub="lifetime" />
          <Cell
            label="Orders while running"
            value={String(attribution.ordersInWindows)}
            sub={`Meta claims ${attribution.metaClaimedOrders}`}
          />
          <Cell
            label="Cost per order"
            value={cpa > 0 ? eur(cpa) : "—"}
            sub={breakEvenCpa > 0 ? `break-even ${eur(breakEvenCpa)}` : "no costs recorded"}
            tone={breakEvenCpa > 0 && cpa > 0 ? (cpa <= breakEvenCpa ? "good" : "bad") : undefined}
          />
          <Cell
            label="Revenue while running"
            value={eur(attribution.revenueInWindows)}
            sub={`${attribution.roasInWindow.toFixed(2)}× on spend`}
          />
        </div>

        {attribution.underCountFactor > 1.2 && (
          <p className="mt-4 text-xs text-ink/40">
            Ads Manager under-reports by about {attribution.underCountFactor.toFixed(1)}× on this
            account — these are real Shopify orders matched to the days ads delivered.
          </p>
        )}
      </div>
    </section>
  );
}
