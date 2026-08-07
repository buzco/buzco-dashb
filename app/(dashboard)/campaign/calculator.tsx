"use client";

import { useMemo, useState } from "react";
import { Label, Input } from "@/components/ui/input";

export type CalcProduct = {
  id: string;
  name: string;
  /** Set only when another product shares this name — e.g. a SKU stem. */
  hint: string | null;
  productionCost: number;
  retailPrice: number;
  stock: number;
  variantCount: number;
};

/** Per-product overrides. Everything is a string so the inputs stay editable. */
type LineEdit = { units: string; price: string; cost: string };

const eur = (n: number) =>
  "€" + n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function defaultsFor(p: CalcProduct): LineEdit {
  return {
    // Plan on selling what you hold; a sold-out product defaults to 1 so it
    // doesn't silently contribute nothing when you tick it.
    units: String(p.stock || 1),
    price: p.retailPrice.toFixed(2),
    cost: p.productionCost.toFixed(2),
  };
}

export function CampaignCalculator({ products }: { products: CalcProduct[] }) {
  const [selected, setSelected] = useState<Record<string, LineEdit>>({});
  const [search, setSearch] = useState("");

  // Campaign-wide assumptions — these apply per unit across every product.
  const [discount, setDiscount] = useState("0");
  const [shipping, setShipping] = useState("0");
  const [feePct, setFeePct] = useState("2.9");
  const [targetProfit, setTargetProfit] = useState("0");

  const selectedIds = Object.keys(selected);

  function toggle(p: CalcProduct) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[p.id]) delete next[p.id];
      else next[p.id] = defaultsFor(p);
      return next;
    });
  }

  function edit(id: string, field: keyof LineEdit, value: string) {
    setSelected((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], [field]: value } } : prev));
  }

  function selectAllVisible(visible: CalcProduct[]) {
    setSelected((prev) => {
      const next = { ...prev };
      for (const p of visible) next[p.id] ??= defaultsFor(p);
      return next;
    });
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
  }, [products, search]);

  const result = useMemo(() => {
    const disc = num(discount);
    const ship = num(shipping);
    const fee = num(feePct);

    const lines = products
      .filter((p) => selected[p.id])
      .map((p) => {
        const e = selected[p.id];
        const price = num(e.price);
        const cost = num(e.cost);
        const units = Math.max(0, Math.round(num(e.units)));
        const revenuePerUnit = price - disc;
        const costPerUnit = cost + ship + (price * fee) / 100;
        const contributionPerUnit = revenuePerUnit - costPerUnit;
        return {
          id: p.id,
          name: p.name,
          cost,
          units,
          revenuePerUnit,
          contributionPerUnit,
          revenue: revenuePerUnit * units,
          contribution: contributionPerUnit * units,
        };
      });

    const totalRevenue = lines.reduce((s, l) => s + l.revenue, 0);
    const totalContribution = lines.reduce((s, l) => s + l.contribution, 0);
    const totalUnits = lines.reduce((s, l) => s + l.units, 0);

    const maxAdSpend = Math.max(0, totalContribution); // break-even on ads
    const target = num(targetProfit);

    return {
      lines,
      totalRevenue,
      totalContribution,
      totalUnits,
      maxAdSpend,
      adBudgetForTarget: Math.max(0, totalContribution - target),
      adPerUnit: totalUnits > 0 ? maxAdSpend / totalUnits : 0,
      breakEvenRoas: maxAdSpend > 0 ? totalRevenue / maxAdSpend : 0,
      losers: lines.filter((l) => l.contributionPerUnit <= 0),
      // A product with no cost recorded counts its whole price as profit, which
      // silently inflates the budget. Overstating what you can spend on ads is
      // the one error here that actually costs money, so it has to be loud.
      costless: lines.filter((l) => l.cost <= 0 && l.units > 0),
    };
  }, [products, selected, discount, shipping, feePct, targetProfit]);

  const positive = result.totalContribution > 0;

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        {/* Product picker */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="label-caps text-ink/60">
              Products in this campaign ({selectedIds.length})
            </h2>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => selectAllVisible(visible)}
                className="label-caps text-ink/50 underline-offset-2 hover:text-ink hover:underline"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setSelected({})}
                className="label-caps text-ink/50 underline-offset-2 hover:text-ink hover:underline"
              >
                Clear
              </button>
            </div>
          </div>

          <Input
            type="search"
            placeholder="Filter products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface/90">
            {visible.map((p) => {
              const on = Boolean(selected[p.id]);
              return (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-ink/5">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(p)}
                      className="h-4 w-4 accent-pink"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-bone">
                        {p.name}
                        {p.hint && (
                          <span className="ml-1.5 font-mono text-xs text-ink/50">{p.hint}</span>
                        )}
                      </span>
                      <span className="block text-xs text-ink/50">
                        {eur(p.retailPrice)} ·{" "}
                        {p.productionCost > 0 ? (
                          <>cost {eur(p.productionCost)}</>
                        ) : (
                          <span className="text-status-ordered">no cost recorded</span>
                        )}{" "}
                        · {p.stock} in stock · {p.variantCount} variant
                        {p.variantCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
            {!visible.length && (
              <li className="px-4 py-3 text-sm text-ink/50">No product matches “{search}”.</li>
            )}
          </ul>
        </div>

        {/* Campaign-wide assumptions + headline result */}
        <div className="space-y-4">
          <h2 className="label-caps text-ink/60">Campaign assumptions</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Discount € / unit" value={discount} onChange={setDiscount} />
            <Field label="Shipping € / unit" value={shipping} onChange={setShipping} />
            <Field label="Payment fees %" value={feePct} onChange={setFeePct} />
            <Field label="Profit you want to keep €" value={targetProfit} onChange={setTargetProfit} />
          </div>

          <div
            className={`rounded-lg border p-6 ${
              positive ? "border-status-received" : "border-status-cancelled"
            }`}
          >
            <p className="label-caps text-ink/60">Ad budget — break-even</p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-bone">{eur(result.maxAdSpend)}</p>
            <p className="mt-1 text-sm text-ink/60">
              {selectedIds.length} product{selectedIds.length === 1 ? "" : "s"} · {result.totalUnits}{" "}
              unit{result.totalUnits === 1 ? "" : "s"} · {eur(result.adPerUnit)} / unit
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface/90 p-6">
            <p className="label-caps text-ink/60">
              Ad budget — keep {eur(num(targetProfit))} profit
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-ink">
              {eur(result.adBudgetForTarget)}
            </p>
          </div>

          <dl className="space-y-1.5 text-sm">
            <Row k="Total revenue (after discount)" v={eur(result.totalRevenue)} />
            <Row k="Total contribution" v={eur(result.totalContribution)} accent />
            <Row
              k="Break-even ROAS"
              v={result.breakEvenRoas > 0 ? `${result.breakEvenRoas.toFixed(2)}×` : "—"}
            />
          </dl>

          {!!result.costless.length && (
            <p className="rounded-md border border-status-ordered/60 p-2 text-sm text-status-ordered">
              This budget is optimistic. {result.costless.length} product
              {result.costless.length === 1 ? " has" : "s have"} no production cost
              recorded ({result.costless.map((l) => l.name).join(", ")}), so their full
              price is being counted as profit. Fill the cost in below, or on the
              product, before trusting the number.
            </p>
          )}

          {!!result.losers.length && (
            <p className="text-sm text-status-cancelled">
              {result.losers.map((l) => l.name).join(", ")} sell{result.losers.length === 1 ? "s" : ""}{" "}
              at a loss before ads — they drag the whole campaign budget down.
            </p>
          )}
        </div>
      </div>

      {/* Per-product lines, editable */}
      {!!result.lines.length && (
        <div className="space-y-3">
          <h2 className="label-caps text-ink/60">Per product</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="label-caps px-3 py-2 text-left text-ink/60">Product</th>
                  <th className="label-caps px-3 py-2 text-right text-ink/60">Units</th>
                  <th className="label-caps px-3 py-2 text-right text-ink/60">Price €</th>
                  <th className="label-caps px-3 py-2 text-right text-ink/60">Cost €</th>
                  <th className="label-caps px-3 py-2 text-right text-ink/60">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((l) => (
                  <tr key={l.id} className="border-b border-line">
                    <td className="px-3 py-2 text-bone">{l.name}</td>
                    <td className="px-3 py-2">
                      <CellInput
                        value={selected[l.id].units}
                        onChange={(v) => edit(l.id, "units", v)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <CellInput
                        value={selected[l.id].price}
                        onChange={(v) => edit(l.id, "price", v)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <CellInput value={selected[l.id].cost} onChange={(v) => edit(l.id, "cost", v)} />
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
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type="number" step="0.01" value={value} onChange={(e) => onChange(e.target.value)} />
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
      className="w-24 rounded-md border border-line bg-transparent px-2 py-1 text-right font-mono tabular-nums text-ink focus:border-ink/50 focus:outline-none"
    />
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-1.5">
      <dt className="text-ink/60">{k}</dt>
      <dd className={`font-mono tabular-nums ${accent ? "text-bone" : "text-ink/80"}`}>{v}</dd>
    </div>
  );
}
