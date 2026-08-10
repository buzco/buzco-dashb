import { getAdsSummary } from "@/lib/meta/summary";
import { diagnoseAll, spendByCountry, type Diagnosis, type Verdict } from "@/lib/meta/monitor";

// The live half of this page: what the ads are actually doing, judged against
// what the shop actually earns.
//
// The point of merging the two sides is that neither is trustworthy alone.
// Meta reports the revenue it believes it caused, attributed on its own rules
// and its own click window; Shopify reports money that genuinely arrived. They
// disagree, always, and the size of the disagreement is the most useful number
// on this page — it's the difference between the ROAS in Ads Manager and the
// ROAS your bank sees.
//
// Break-even is computed from real production costs rather than an assumed
// margin, so the "is this worth running" line is the brand's own arithmetic.

const eur = (n: number) =>
  (n < 0 ? "−€" : "€") +
  Math.abs(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number) => Math.round(n).toLocaleString("en-IE");

const VERDICT_STYLE: Record<Verdict, string> = {
  healthy: "border-status-received text-status-received",
  watch: "border-line text-ink/50",
  cooling: "border-status-ordered text-status-ordered",
  cold: "border-status-partially_received text-status-partially_received",
  kill: "border-status-cancelled text-status-cancelled",
};

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "plain";
}) {
  const colour =
    tone === "good" ? "text-status-received" : tone === "bad" ? "text-status-cancelled" : "text-bone";
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="label-caps text-ink/50">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${colour}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-ink/40">{sub}</p>}
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="label-caps text-ink/60">{title}</h2>
        {hint && <p className="mt-1 max-w-3xl text-xs text-ink/40">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export async function LiveOverview() {
  const summary = await getAdsSummary();
  const { shop, breakEvenCpa } = summary;

  if (!summary.configured) {
    return (
      <div className="rounded-lg border border-line bg-surface p-6">
        <p className="text-bone">Meta not connected</p>
        <p className="mt-2 text-sm text-ink/70">
          Add META_ACCESS_TOKEN and META_AD_ACCOUNT_ID to .env.local to see live campaign data
          here. Until then the simulator below still works on its own.
        </p>
      </div>
    );
  }

  if (summary.error || !summary.connection || !summary.funnel || !summary.attribution) {
    return (
      <div className="rounded-lg border border-status-cancelled/60 bg-surface p-6">
        <p className="text-bone">Couldn&apos;t read the Meta account</p>
        <p className="mt-2 font-mono text-sm text-status-cancelled">{summary.error}</p>
      </div>
    );
  }

  const { connection, funnel, attribution } = summary;

  // These two need the break-even figure and are only used on this page, so
  // they aren't part of the shared summary.
  let diagnoses: Diagnosis[] = [];
  let countries: Awaited<ReturnType<typeof spendByCountry>> = [];
  try {
    countries = await spendByCountry("maximum");
    if (breakEvenCpa > 0) diagnoses = await diagnoseAll(breakEvenCpa);
  } catch {
    // A failure here costs the campaign table and the country table, not the
    // whole page — the money figures above are already in hand.
  }

  const shopRevenue = shop.revenue;
  const shopCogs = shop.cogs;
  const marginPct = shop.marginPct;
  const costCoverage = shop.costCoverage;
  const knownCosts = shop.knownCosts;
  const orderList = shop.orders;

  const adSpend = funnel.spend;
  const metaRevenue = funnel.revenue;
  const purchases = summary.metaPurchases;

  // Blended ROAS — every euro the shop took against every euro spent on ads.
  //
  // It counts organic and word-of-mouth revenue as if the ads produced it, so
  // it flatters them whenever most sales aren't paid. It is still the right
  // number for "is the whole operation ahead", which is why it's here — but it
  // is labelled as what it is, and never used to judge the ads.
  const blendedRoas = adSpend > 0 ? shopRevenue / adSpend : 0;
  const metaRoas = adSpend > 0 ? metaRevenue / adSpend : 0;
  const netAfterAds = shop.contribution - adSpend;
  const attributionGap = metaRevenue - shopRevenue;
  const organicShare =
    orderList.length > 0 ? Math.max(0, (orderList.length - purchases) / orderList.length) : 0;

  const activeCount = diagnoses.filter((d) => d.effectiveStatus === "ACTIVE").length;
  const needsAction = diagnoses.filter((d) => d.verdict === "kill" || d.verdict === "cold");

  return (
    <div className="space-y-10">
      {/* ---- Connection -------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-bone font-bold">{connection.name}</span>
        <span className="text-ink/40">{connection.accountId}</span>
        <span
          className={`label-caps rounded-full border px-2 py-0.5 ${
            connection.active
              ? "border-status-received text-status-received"
              : "border-status-cancelled text-status-cancelled"
          }`}
        >
          {connection.status}
        </span>
        <span className="text-ink/40">
          {connection.currency} · {connection.timezone}
        </span>
        <span className="text-ink/40">
          {activeCount} active campaign{activeCount === 1 ? "" : "s"}
        </span>
        {!connection.canPublish && (
          <span className="label-caps rounded-full border border-status-ordered px-2 py-0.5 text-status-ordered">
            read-only token
          </span>
        )}
      </div>

      {/* ---- The money --------------------------------------------------- */}
      <Panel
        title="Money in, money out"
        hint="Ad spend and Meta's attributed revenue come from the ad account. Shop revenue and
              cost of goods come from your own Shopify orders. Where they disagree, the shop is right."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Ad spend" value={eur(adSpend)} sub="lifetime, this account" />
          <Stat
            label="Shop revenue"
            value={eur(shopRevenue)}
            sub={`${orderList.length} online order${orderList.length === 1 ? "" : "s"}`}
          />
          <Stat
            label="Meta ROAS"
            value={`${metaRoas.toFixed(2)}×`}
            sub={`${int(purchases)} orders Meta claims credit for`}
            tone={metaRoas >= 1 ? "good" : "bad"}
          />
          {/* Deliberately not a headline tile for blended ROAS — it's a
              flattering number on a shop this organic, so it appears only in
              the caveat below where it comes with its explanation. */}
          <Stat
            label="Net after ads"
            value={eur(netAfterAds)}
            sub="all online contribution − ad spend"
            tone={netAfterAds >= 0 ? "good" : "bad"}
          />
        </div>

        {organicShare > 0.2 && (
          <p className="rounded-md border border-status-ordered/60 p-3 text-sm text-status-ordered">
            Blended ROAS counts revenue the ads didn&apos;t produce. Meta claims{" "}
            {int(purchases)} of your {orderList.length} online orders, so about{" "}
            {(organicShare * 100).toFixed(0)}% of that {blendedRoas.toFixed(2)}× is organic,
            word-of-mouth or repeat custom. Judge the ads on the{" "}
            {metaRoas.toFixed(2)}× and on cost per purchase below — not on the blended figure.
          </p>
        )}

        {Math.abs(attributionGap) > 0.5 && (
          <p className="rounded-md border border-line bg-surface p-3 text-sm text-ink/60">
            <span className="text-bone">Attribution gap: {eur(Math.abs(attributionGap))}.</span>{" "}
            Meta credits itself with {eur(metaRevenue)} of sales; your Shopify orders total{" "}
            {eur(shopRevenue)} across all channels and sources.{" "}
            {attributionGap > 0
              ? "Meta claiming more than the shop took is normal — it counts a sale if someone saw or clicked an ad within its attribution window, whether or not the ad caused the purchase."
              : "The shop took more than Meta claims, which means some sales arrived through channels the pixel never saw."}
          </p>
        )}
      </Panel>

      {/* ---- Attribution ------------------------------------------------- */}
      <Panel
        title="What the ads actually sold"
        hint="Meta's pixel misses conversions — iOS opt-outs, ad blockers, cookie consent. So
              real orders are matched to the days the ads ran instead. Three readings, worst to
              best case, because the truth is somewhere between them."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Meta claims"
            value={`${int(attribution.metaClaimedOrders)} orders`}
            sub={
              attribution.cpaMetaClaimed > 0
                ? `${eur(attribution.cpaMetaClaimed)} each · known to under-count`
                : "no purchases tracked"
            }
            tone={
              attribution.cpaMetaClaimed > 0 && breakEvenCpa > 0
                ? attribution.cpaMetaClaimed <= breakEvenCpa
                  ? "good"
                  : "bad"
                : "plain"
            }
          />
          <Stat
            label="Orders while ads ran"
            value={`${int(attribution.ordersInWindows)} orders`}
            sub={
              attribution.cpaInWindow > 0
                ? `${eur(attribution.cpaInWindow)} each · credits ads with organic too`
                : "none in window"
            }
            tone="plain"
          />
          <Stat
            label="Lift over baseline"
            value={`${attribution.liftOrders.toFixed(1)} orders`}
            sub={
              attribution.cpaLift > 0
                ? `${eur(attribution.cpaLift)} each · the defensible figure`
                : "no measurable lift"
            }
            tone={
              attribution.cpaLift > 0 && breakEvenCpa > 0
                ? attribution.cpaLift <= breakEvenCpa
                  ? "good"
                  : "bad"
                : "plain"
            }
          />
        </div>

        {attribution.underCountFactor > 1.2 && (
          <p className="rounded-md border border-line bg-surface p-3 text-sm text-ink/60">
            <span className="text-bone">
              Meta appears to under-count by about {attribution.underCountFactor.toFixed(1)}×.
            </span>{" "}
            {int(attribution.ordersInWindows)} orders landed while the ads were running and it
            claims {int(attribution.metaClaimedOrders)}. Judging the account on Ads Manager
            alone makes it look roughly {attribution.underCountFactor.toFixed(1)} times worse
            than it is — which is how a campaign worth keeping gets switched off.
          </p>
        )}

        {attribution.baselineIsThin ? (
          <p className="rounded-md border border-status-ordered/60 p-3 text-sm text-status-ordered">
            The baseline is thin — only {attribution.ordersOutside} order
            {attribution.ordersOutside === 1 ? "" : "s"} across{" "}
            {attribution.daysOutside} quiet days to compare against. Treat the lift figure as a
            rough direction, not a measurement.
          </p>
        ) : (
          <p className="text-xs text-ink/40">
            Baseline: {attribution.baselineOrdersPerDay.toFixed(2)} orders/day across{" "}
            {attribution.daysOutside} days with no ads running, so about{" "}
            {attribution.expectedOrganicOrders.toFixed(1)} of the in-window orders would likely
            have happened anyway. Windows include a {attribution.tailDays}-day tail, since a
            click can convert days later.
          </p>
        )}

        {attribution.windows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[38rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="label-caps px-3 py-2 font-normal text-ink/50">Flight</th>
                  <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">Spend</th>
                  <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">Orders</th>
                  <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">
                    Revenue
                  </th>
                  <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">CPA</th>
                </tr>
              </thead>
              <tbody>
                {attribution.windows.map((w) => (
                  <tr key={w.start} className="border-b border-line/50 last:border-0">
                    <td className="px-3 py-2 text-bone">
                      {w.start} → {w.end}
                      <span className="ml-2 text-xs text-ink/40">+{attribution.tailDays}d tail</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink/70">
                      {eur(w.spend)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink/70">
                      {int(w.orders)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink/70">
                      {eur(w.revenue)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        w.orders > 0 && breakEvenCpa > 0 && w.spend / w.orders > breakEvenCpa
                          ? "text-status-cancelled"
                          : "text-ink/70"
                      }`}
                    >
                      {w.orders > 0 ? eur(w.spend / w.orders) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ---- Break-even -------------------------------------------------- */}
      <Panel
        title="What an order is worth"
        hint="Computed from your real production costs, not an assumed margin. This is the ceiling
              on what an order may cost before the spend is buying losses."
      >
        {!knownCosts ? (
          <p className="rounded-md border border-status-ordered/60 p-3 text-sm text-status-ordered">
            No production costs recorded on your variants, so contribution can&apos;t be worked out
            and none of the campaign verdicts below can be trusted. Fill in cost per variant and
            this page becomes accurate.
          </p>
        ) : (
          <div className="space-y-3">
            {costCoverage < 0.999 && (
              <p className="rounded-md border border-status-ordered/60 p-3 text-sm text-status-ordered">
                Only {(costCoverage * 100).toFixed(0)}% of the units you&apos;ve sold have a
                production cost recorded. The rest count as pure profit, so the margin and
                break-even CPA below are both flattering — the real ceiling on what an order may
                cost is lower than {eur(breakEvenCpa)}. Fill in the missing costs to make this
                exact.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Break-even CPA" value={eur(breakEvenCpa)} sub="contribution per order" />
            <Stat
              label="Actual CPA"
              value={purchases > 0 ? eur(funnel.cpa) : "—"}
              sub={purchases > 0 ? `${int(purchases)} purchases` : "no purchases yet"}
              tone={purchases > 0 ? (funnel.cpa <= breakEvenCpa ? "good" : "bad") : "plain"}
            />
            <Stat
              label="Contribution margin"
              value={`${marginPct.toFixed(0)}%`}
              sub={`${eur(shopRevenue)} − ${eur(shopCogs)} cost`}
            />
            <Stat
              label="Kill threshold"
              value={eur(breakEvenCpa * 1.5)}
              sub="spend with no sale → stop"
            />
            </div>
          </div>
        )}
      </Panel>

      {/* ---- Campaigns --------------------------------------------------- */}
      <Panel
        title="Campaigns"
        hint="Judged against your break-even, not against industry benchmarks. A campaign is cold
              when it worked and stopped; killed when it never worked at all."
      >
        {!diagnoses.length ? (
          <p className="text-sm text-ink/50">
            {breakEvenCpa > 0
              ? "No campaigns on this account yet."
              : "Campaign verdicts need a break-even figure — add production costs to your variants."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="label-caps px-3 py-2 font-normal text-ink/50">Campaign</th>
                  <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">Spend</th>
                  <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">Orders</th>
                  <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">CPA</th>
                  <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">ROAS</th>
                  <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">Freq</th>
                  <th className="label-caps px-3 py-2 font-normal text-ink/50">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {diagnoses.map((d) => (
                  <tr key={d.campaignId} className="border-b border-line/50 last:border-0">
                    <td className="px-3 py-2">
                      <span className="text-bone">{d.name}</span>
                      <span className="ml-2 text-xs text-ink/40">
                        {d.effectiveStatus.toLowerCase().replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink/70">
                      {eur(d.overall.spend)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink/70">
                      {int(d.overall.purchases)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        d.overall.cpa > 0 && d.overall.cpa > breakEvenCpa
                          ? "text-status-cancelled"
                          : "text-ink/70"
                      }`}
                    >
                      {d.overall.cpa > 0 ? eur(d.overall.cpa) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink/70">
                      {d.overall.roas.toFixed(2)}×
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink/70">
                      {d.overall.frequency.toFixed(1)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`label-caps rounded-full border px-2 py-0.5 ${VERDICT_STYLE[d.verdict]}`}
                      >
                        {d.verdict}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {needsAction.map((d) => (
          <div key={d.campaignId} className="rounded-md border border-line bg-surface p-3">
            <p className="text-sm text-bone">
              {d.name} — {d.headline}
            </p>
            <ul className="mt-2 space-y-1">
              {d.reasons.map((r, i) => (
                <li key={i} className="text-xs text-ink/60">
                  · {r}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink/50">{d.recommendation}</p>
          </div>
        ))}
      </Panel>

      {/* ---- Funnel ------------------------------------------------------ */}
      <Panel
        title="Where people drop out"
        hint="Each percentage is the share that survived from the step above. The biggest fall is
              where the money is being lost — fixing it beats raising budget."
      >
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[30rem] text-sm">
            <tbody>
              {funnel.steps.map((s, i) => (
                <tr key={s.key} className="border-b border-line/50 last:border-0">
                  <td className="px-3 py-2 text-ink/70">{s.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-bone">{int(s.count)}</td>
                  <td className="w-24 px-3 py-2 text-right tabular-nums text-xs text-ink/40">
                    {i === 0 ? "" : `${s.passRate.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Cost per link click" value={eur(funnel.costPerLinkClick)} />
          <Stat label="Cost per add to cart" value={eur(funnel.costPerAddToCart)} />
          <Stat
            label="Cost per purchase"
            value={purchases > 0 ? eur(funnel.cpa) : "—"}
            tone={purchases > 0 && breakEvenCpa > 0 ? (funnel.cpa <= breakEvenCpa ? "good" : "bad") : "plain"}
          />
        </div>
      </Panel>

      {/* ---- Geography --------------------------------------------------- */}
      <Panel
        title="Where the ads actually ran"
        hint="Only countries Meta delivered to appear here. Traffic from anywhere else came from
              somewhere other than these ads — organic, referral, or bots."
      >
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="label-caps px-3 py-2 font-normal text-ink/50">Country</th>
                <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">Spend</th>
                <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">
                  Impressions
                </th>
                <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">Clicks</th>
                <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">
                  Page views
                </th>
                <th className="label-caps px-3 py-2 text-right font-normal text-ink/50">Orders</th>
              </tr>
            </thead>
            <tbody>
              {countries.map((c) => (
                <tr key={c.country} className="border-b border-line/50 last:border-0">
                  <td className="px-3 py-2 font-mono text-bone">{c.country}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink/70">{eur(c.spend)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink/70">
                    {int(c.impressions)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink/70">
                    {int(c.linkClicks)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink/70">
                    {int(c.landingPageViews)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink/70">
                    {int(c.purchases)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
