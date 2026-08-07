"use client";

import { useMemo, useState } from "react";
import { Label, Input } from "@/components/ui/input";
import { Info } from "./info";
import { ProductPicker, type CalcProduct } from "./product-picker";
import { StrategyPanel } from "./strategy-panel";
import {
  DEFAULT_INPUTS,
  STAGE_BLURBS,
  STAGE_LABELS,
  simulate,
  type CampaignInputs,
  type StageKey,
  type UnitEconomics,
} from "./funnel";

export type { CalcProduct };

/** Per-product overrides. Strings so the inputs stay editable mid-typing. */
type LineEdit = { units: string; price: string; cost: string };

const STAGE_KEYS: StageKey[] = ["awareness", "retargeting", "conversion"];

// Sign goes outside the symbol — "€-74.28" reads as a typo, "−€74.28" reads as a loss.
const eur = (n: number) =>
  (n < 0 ? "−€" : "€") +
  Math.abs(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number) => Math.round(n).toLocaleString("en-IE");

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function defaultsFor(p: CalcProduct): LineEdit {
  return {
    units: String(p.stock || 1),
    price: p.retailPrice.toFixed(2),
    cost: p.productionCost.toFixed(2),
  };
}

/** String mirror of CampaignInputs, so half-typed values don't snap to 0. */
type Draft = {
  days: string;
  dailyBudget: string;
  lpvRate: string;
  unitsPerOrder: string;
  costPerFollower: string;
  stages: Record<StageKey, Record<"sharePct" | "cpm" | "ctr" | "cvr" | "frequency", string>>;
};

function draftFromDefaults(unitsPerOrder: number): Draft {
  const d = DEFAULT_INPUTS;
  return {
    days: String(d.days),
    dailyBudget: String(d.dailyBudget),
    lpvRate: String(d.lpvRate),
    unitsPerOrder: unitsPerOrder.toFixed(2),
    costPerFollower: String(d.costPerFollower),
    stages: Object.fromEntries(
      STAGE_KEYS.map((k) => [
        k,
        {
          sharePct: String(d.stages[k].sharePct),
          cpm: String(d.stages[k].cpm),
          ctr: String(d.stages[k].ctr),
          cvr: String(d.stages[k].cvr),
          frequency: String(d.stages[k].frequency),
        },
      ]),
    ) as Draft["stages"],
  };
}

export function CampaignCalculator({
  products,
  observedUnitsPerOrder,
  observedAov,
  observedOrders,
}: {
  products: CalcProduct[];
  observedUnitsPerOrder: number;
  observedAov: number;
  observedOrders: number;
}) {
  const [selected, setSelected] = useState<Record<string, LineEdit>>({});
  const [discount, setDiscount] = useState("0");
  const [shipping, setShipping] = useState("0");
  const [feePct, setFeePct] = useState("2.9");
  const [draft, setDraft] = useState<Draft>(() => draftFromDefaults(observedUnitsPerOrder));

  const selectedIds = useMemo(() => new Set(Object.keys(selected)), [selected]);

  function toggle(p: CalcProduct) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[p.id]) delete next[p.id];
      else next[p.id] = defaultsFor(p);
      return next;
    });
  }

  function selectMany(ps: CalcProduct[]) {
    setSelected((prev) => {
      const next = { ...prev };
      for (const p of ps) next[p.id] ??= defaultsFor(p);
      return next;
    });
  }

  function editLine(id: string, field: keyof LineEdit, value: string) {
    setSelected((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], [field]: value } } : prev));
  }

  function editDraft(field: keyof Omit<Draft, "stages">, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function editStage(key: StageKey, field: keyof Draft["stages"][StageKey], value: string) {
    setDraft((prev) => ({
      ...prev,
      stages: { ...prev.stages, [key]: { ...prev.stages[key], [field]: value } },
    }));
  }

  // ---- Unit economics, blended across whatever is ticked ----------------
  const { econ, lines, costless } = useMemo(() => {
    const disc = num(discount);
    const ship = num(shipping);
    const fee = num(feePct);

    const rows = products
      .filter((p) => selected[p.id])
      .map((p) => {
        const e = selected[p.id];
        const price = num(e.price);
        const cost = num(e.cost);
        const units = Math.max(0, Math.round(num(e.units)));
        const revenuePerUnit = price - disc;
        const contributionPerUnit = revenuePerUnit - (cost + ship + (price * fee) / 100);
        return {
          id: p.id,
          name: p.name,
          price,
          cost,
          units,
          revenuePerUnit,
          contributionPerUnit,
          contribution: contributionPerUnit * units,
        };
      });

    const totalUnits = rows.reduce((s, r) => s + r.units, 0);
    // Blend by planned units: a product you'll sell 50 of should dominate the
    // average over one you'll sell 2 of.
    const blend = (pick: (r: (typeof rows)[number]) => number) =>
      totalUnits > 0
        ? rows.reduce((s, r) => s + pick(r) * r.units, 0) / totalUnits
        : rows.length
          ? rows.reduce((s, r) => s + pick(r), 0) / rows.length
          : 0;

    return {
      lines: rows,
      costless: rows.filter((r) => r.cost <= 0 && r.units > 0),
      econ: {
        revenuePerUnit: blend((r) => r.revenuePerUnit),
        contributionPerUnit: blend((r) => r.contributionPerUnit),
        availableStock: totalUnits,
      } satisfies UnitEconomics,
    };
  }, [products, selected, discount, shipping, feePct]);

  const inputs = useMemo<CampaignInputs>(
    () => ({
      days: num(draft.days),
      dailyBudget: num(draft.dailyBudget),
      lpvRate: num(draft.lpvRate),
      unitsPerOrder: num(draft.unitsPerOrder),
      costPerFollower: num(draft.costPerFollower),
      stages: Object.fromEntries(
        STAGE_KEYS.map((k) => [
          k,
          {
            sharePct: num(draft.stages[k].sharePct),
            cpm: num(draft.stages[k].cpm),
            ctr: num(draft.stages[k].ctr),
            cvr: num(draft.stages[k].cvr),
            frequency: num(draft.stages[k].frequency),
          },
        ]),
      ) as CampaignInputs["stages"],
    }),
    [draft],
  );

  const sim = useMemo(() => simulate(inputs, econ), [inputs, econ]);
  const hasSelection = lines.length > 0;
  const shareTotal = STAGE_KEYS.reduce((s, k) => s + num(draft.stages[k].sharePct), 0);

  return (
    <div className="space-y-12">
      {/* ================= 1. What you're selling ===================== */}
      <section className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <ProductPicker
          products={products}
          selectedIds={selectedIds}
          onToggle={toggle}
          onSelectMany={selectMany}
          onClear={() => setSelected({})}
        />

        <div className="space-y-4">
          <h2 className="label-caps text-ink/60">
            Per-unit economics
            <Info>
              What one unit leaves you after everything except advertising. This is the number the
              whole campaign lives or dies on — the ad budget is spent out of it.
            </Info>
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Discount € / unit"
              value={discount}
              onChange={setDiscount}
              info="Any campaign-specific markdown. Comes straight off revenue, so a €5 discount costs exactly €5 of margin."
            />
            <Field
              label="Shipping € / unit"
              value={shipping}
              onChange={setShipping}
              info="What you pay to get one unit to the customer, if you're not charging them separately for it."
            />
            <Field
              label="Payment fees %"
              value={feePct}
              onChange={setFeePct}
              info="Processor's cut of each sale — Shopify Payments and most card processors sit near 2.9% plus a fixed fee."
            />
          </div>

          {hasSelection ? (
            <dl className="space-y-1.5 text-sm">
              <Row
                k="Blended price / unit"
                info="Average selling price across the products you ticked, weighted by how many of each you plan to sell."
                v={eur(econ.revenuePerUnit)}
              />
              <Row
                k="Contribution / unit"
                info="Price minus cost of goods, shipping and fees. What each sale actually contributes toward ads, overheads and profit."
                v={eur(econ.contributionPerUnit)}
                accent
              />
              <Row
                k="Contribution margin"
                info="Contribution as a share of revenue. Below roughly 40% paid acquisition gets very hard; above 50% it gets forgiving."
                v={`${(sim.margin * 100).toFixed(0)}%`}
              />
              <Row
                k="Units available"
                info="Total units you've planned across the ticked products. Defaults to stock on hand — the campaign can't sell more than this."
                v={int(econ.availableStock)}
              />
            </dl>
          ) : (
            <p className="text-sm text-ink/50">Tick some products to see the economics.</p>
          )}

          {!!costless.length && (
            <p className="rounded-md border border-status-ordered/60 p-2 text-sm text-status-ordered">
              {costless.length} product{costless.length === 1 ? " has" : "s have"} no production cost
              recorded ({costless.map((l) => l.name).join(", ")}), so their full price counts as
              profit and every projection below is optimistic.
            </p>
          )}
        </div>
      </section>

      {/* ================= 2. Per-product lines ======================= */}
      {hasSelection && (
        <section className="space-y-3">
          <h2 className="label-caps text-ink/60">Per product</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="label-caps px-3 py-2 text-left font-normal text-ink/60">Product</th>
                  <th className="label-caps px-3 py-2 text-right font-normal text-ink/60">Units</th>
                  <th className="label-caps px-3 py-2 text-right font-normal text-ink/60">Price €</th>
                  <th className="label-caps px-3 py-2 text-right font-normal text-ink/60">Cost €</th>
                  <th className="label-caps px-3 py-2 text-right font-normal text-ink/60">
                    Contribution
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-line">
                    <td className="px-3 py-2 text-bone">{l.name}</td>
                    {/* text-right on the cell: the inputs are narrower than the
                        column, so without it they drift left of the headers. */}
                    <td className="px-3 py-2 text-right">
                      <CellInput
                        value={selected[l.id].units}
                        onChange={(v) => editLine(l.id, "units", v)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <CellInput
                        value={selected[l.id].price}
                        onChange={(v) => editLine(l.id, "price", v)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <CellInput
                        value={selected[l.id].cost}
                        onChange={(v) => editLine(l.id, "cost", v)}
                      />
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        l.contribution > 0 ? "text-bone" : "text-status-cancelled"
                      }`}
                    >
                      {eur(l.contribution)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ================= 3. The campaign ============================ */}
      <section className="space-y-6">
        <div>
          <h2 className="label-caps text-ink/60">Campaign</h2>
          <p className="mt-1 text-sm text-ink/50">
            Set how long you&apos;ll run and what you&apos;ll spend a day. Everything below is
            simulated from that.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Field
            label="Days"
            value={draft.days}
            onChange={(v) => editDraft("days", v)}
            info="How long the campaign runs. Delivery takes 3-4 days to settle, so anything under a week is mostly learning phase."
          />
          <Field
            label="Budget € / day"
            value={draft.dailyBudget}
            onChange={(v) => editDraft("dailyBudget", v)}
            info="Daily spend across the whole campaign, split between the stages below."
          />
          <div className="space-y-1">
            <Label>Total budget</Label>
            <p className="rounded-md border border-line bg-surface/60 px-3 py-2 font-mono tabular-nums text-bone">
              {eur(sim.totalBudget)}
            </p>
          </div>
          <Field
            label="Units / order"
            value={draft.unitsPerOrder}
            onChange={(v) => editDraft("unitsPerOrder", v)}
            info={`How many pieces the average order contains. Your Shopify orders average ${observedUnitsPerOrder.toFixed(2)}. Raising this is the cheapest way to make ads work — it lifts order value without costing a click.`}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Field
            label="Landing page view %"
            value={draft.lpvRate}
            onChange={(v) => editDraft("lpvRate", v)}
            info="Share of clicks that survive to a loaded page. The rest bounce on a slow load. Meta reports clicks and landing page views separately, and the gap is often 15-25%."
          />
          <Field
            label="Cost per follower €"
            value={draft.costPerFollower}
            onChange={(v) => editDraft("costPerFollower", v)}
            info="What one new follower costs on the top-of-funnel stage. Ads Manager reports this directly once you're running — replace this guess with your real figure."
          />
        </div>
      </section>

      {/* ================= 4. Funnel stages =========================== */}
      <section className="space-y-4">
        <div>
          <h2 className="label-caps text-ink/60">
            Funnel stages
            <Info>
              A stranger and someone who already viewed the product behave nothing alike, so each
              stage gets its own rates. Split the budget between them here.
            </Info>
          </h2>
          <p className="mt-1 text-sm text-ink/50">
            These are starting assumptions, not measurements — plausible mid-range figures so the
            page isn&apos;t blank. After a few days live, replace every one with your own numbers
            from Ads Manager.
          </p>
          {Math.abs(shareTotal - 100) > 0.5 && (
            <p className="mt-2 text-sm text-status-ordered">
              Budget split adds up to {shareTotal.toFixed(0)}%, not 100% — the shares are being
              scaled proportionally so the total budget still balances.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {STAGE_KEYS.map((key) => {
            const s = sim.stages.find((x) => x.key === key)!;
            return (
              <div key={key} className="space-y-3 rounded-lg border border-line bg-surface/90 p-4">
                <div>
                  <h3 className="label-caps text-ink">{STAGE_LABELS[key]}</h3>
                  <p className="mt-1 text-xs text-ink/50">{STAGE_BLURBS[key]}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <SmallField
                    label="% of budget"
                    value={draft.stages[key].sharePct}
                    onChange={(v) => editStage(key, "sharePct", v)}
                  />
                  <SmallField
                    label="CPM €"
                    value={draft.stages[key].cpm}
                    onChange={(v) => editStage(key, "cpm", v)}
                    info="Cost per 1000 impressions. Smaller, more specific audiences cost more."
                  />
                  <SmallField
                    label="CTR %"
                    value={draft.stages[key].ctr}
                    onChange={(v) => editStage(key, "ctr", v)}
                    info="Share of impressions that get a link click. Driven almost entirely by creative."
                  />
                  <SmallField
                    label="CVR %"
                    value={draft.stages[key].cvr}
                    onChange={(v) => editStage(key, "cvr", v)}
                    info="Share of landing page views that buy. Driven by price, product page and trust — not by the ad."
                  />
                  <SmallField
                    label="Frequency"
                    value={draft.stages[key].frequency}
                    onChange={(v) => editStage(key, "frequency", v)}
                    info="Average times one person sees the ad. Above ~3-4 on cold audiences, results decay and you're paying to annoy people."
                  />
                </div>

                <dl className="space-y-1 border-t border-line pt-3 text-xs">
                  <MiniRow k="Spend" v={eur(s.spend)} />
                  <MiniRow k="Reach" v={int(s.reach)} />
                  <MiniRow k="Clicks" v={int(s.clicks)} />
                  <MiniRow k="Orders" v={s.orders.toFixed(1)} />
                  <MiniRow k="Cost / purchase" v={s.orders > 0 ? eur(s.cpa) : "—"} />
                </dl>

                {s.spend > 0 && !s.exitsLearning && (
                  <p className="text-xs text-status-ordered">
                    {/* One template literal: JSX drops the space between an
                        expression and the text that follows it on the same line. */}
                    {`${s.ordersPerWeek.toFixed(1)} purchases/week — under Meta's ~50 needed to leave the learning phase. Would need ${eur(s.minDailyForLearning)}/day.`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ================= 5. Results ================================= */}
      {hasSelection && sim.totalBudget > 0 && (
        <section className="space-y-6">
          <h2 className="label-caps text-ink/60">Projection</h2>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <BigStat
              label="Projected ROAS"
              value={`${sim.roas.toFixed(2)}×`}
              sub={`break-even is ${sim.breakEvenRoas.toFixed(2)}×`}
              good={sim.roas >= sim.breakEvenRoas}
              info="Revenue divided by ad spend. It has to clear your break-even ROAS — anything under and you're buying sales at a loss."
            />
            <BigStat
              label="Net profit"
              value={eur(sim.netProfit)}
              sub={`after ${eur(sim.totalBudget)} of ads`}
              good={sim.netProfit > 0}
              info="Contribution from everything sold, minus the entire ad budget. This is the number that ends up in the bank."
            />
            <BigStat
              label="Cost per purchase"
              value={sim.orders > 0 ? eur(sim.cpa) : "—"}
              sub={`break-even is ${eur(sim.breakEvenCpa)}`}
              good={sim.orders > 0 && sim.cpa <= sim.breakEvenCpa}
              info="What one order costs you in ad spend. Keep it under the break-even CPA — that's your contribution per order — and every sale makes money."
            />
            <BigStat
              label="Spend ceiling"
              value={sim.spendCeiling !== null ? eur(sim.spendCeiling) : "—"}
              sub="before stock runs out"
              good={sim.spendCeiling === null || sim.totalBudget <= sim.spendCeiling}
              info="The most this campaign can usefully absorb: past here you've sold everything you hold, and further spend buys nothing."
            />
          </div>

          <dl className="grid grid-cols-1 gap-x-10 gap-y-1.5 text-sm md:grid-cols-2">
            <Row
              k="Orders"
              v={sim.orders.toFixed(1)}
              info="Purchases the funnel produces across every stage."
            />
            <Row
              k="Units sold"
              v={`${int(sim.soldUnits)}${sim.stockLimited ? ` of ${int(sim.demandUnits)} demanded` : ""}`}
              info="Orders times units per order, capped by what you actually hold."
            />
            <Row
              k="Average order value"
              v={eur(sim.aov)}
              info={`Blended price times units per order. For reference your ${observedOrders} real Shopify orders average ${eur(observedAov)}.`}
            />
            <Row k="Revenue" v={eur(sim.revenue)} info="Units sold times price after discount." />
            <Row
              k="Contribution"
              v={eur(sim.contribution)}
              info="Revenue minus cost of goods, shipping and fees — before ad spend."
            />
            <Row
              k="People reached"
              v={int(sim.reach)}
              info="Distinct people who see an ad at least once, across all stages."
            />
            <Row
              k="New followers"
              v={int(sim.followers)}
              info="Top-of-funnel spend divided by cost per follower. Followers aren't revenue, but they're the audience the next campaign retargets."
            />
            {sim.wastedSpend > 0 && (
              <Row
                k="Spend after sell-out"
                v={eur(sim.wastedSpend)}
                info="Budget still running once there's nothing left to ship."
              />
            )}
          </dl>
        </section>
      )}

      {/* ================= 6. Strategy ================================ */}
      {hasSelection && sim.totalBudget > 0 && (
        <StrategyPanel sim={sim} inputs={inputs} econ={econ} />
      )}

      {!hasSelection && (
        <p className="text-sm text-ink/50">
          Tick at least one product above to run the simulation.
        </p>
      )}
    </div>
  );
}

/* ------------------------------- bits -------------------------------- */

function Field({
  label,
  value,
  onChange,
  info,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  info?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>
        {label}
        {info && <Info>{info}</Info>}
      </Label>
      <Input type="number" step="0.01" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SmallField({
  label,
  value,
  onChange,
  info,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  info?: string;
}) {
  return (
    <div className="space-y-1">
      <span className="label-caps block text-[0.65rem] text-ink/50">
        {label}
        {info && <Info>{info}</Info>}
      </span>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-line bg-transparent px-2 py-1 text-right font-mono text-sm tabular-nums text-bone focus:border-ink focus:outline-none"
      />
    </div>
  );
}

function CellInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      step="0.01"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-24 rounded-md border border-line bg-transparent px-2 py-1 text-right font-mono tabular-nums text-ink focus:border-ink focus:outline-none"
    />
  );
}

function Row({ k, v, accent, info }: { k: string; v: string; accent?: boolean; info?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-1.5">
      <dt className="text-ink/60">
        {k}
        {info && <Info>{info}</Info>}
      </dt>
      <dd className={`font-mono tabular-nums ${accent ? "text-bone" : "text-ink/80"}`}>{v}</dd>
    </div>
  );
}

function MiniRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink/50">{k}</dt>
      <dd className="font-mono tabular-nums text-ink/80">{v}</dd>
    </div>
  );
}

function BigStat({
  label,
  value,
  sub,
  good,
  info,
}: {
  label: string;
  value: string;
  sub: string;
  good: boolean;
  info: string;
}) {
  return (
    <div
      className={`rounded-lg border p-5 ${good ? "border-status-received" : "border-status-cancelled"}`}
    >
      <p className="label-caps text-ink/60">
        {label}
        <Info>{info}</Info>
      </p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-bone">{value}</p>
      <p className="mt-1 text-xs text-ink/50">{sub}</p>
    </div>
  );
}
