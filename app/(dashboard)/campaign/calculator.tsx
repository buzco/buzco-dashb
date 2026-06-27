"use client";

import { useMemo, useState } from "react";
import { Label, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export type CalcVariant = {
  id: string;
  label: string;
  productionCost: number;
  retailPrice: number;
  stock: number;
};

const eur = (n: number) =>
  "€" + n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function CampaignCalculator({ variants }: { variants: CalcVariant[] }) {
  const first = variants[0];
  const [variantId, setVariantId] = useState(first?.id ?? "");
  const [price, setPrice] = useState(String(first?.retailPrice ?? 0));
  const [cost, setCost] = useState(String(first?.productionCost ?? 0));
  const [discount, setDiscount] = useState("0");
  const [shipping, setShipping] = useState("0");
  const [feePct, setFeePct] = useState("2.9");
  const [quantity, setQuantity] = useState(String(first?.stock || 1));
  const [targetProfit, setTargetProfit] = useState("0");

  function selectVariant(id: string) {
    const v = variants.find((x) => x.id === id);
    setVariantId(id);
    if (v) {
      setPrice(String(v.retailPrice || 0));
      setCost(String(v.productionCost || 0));
      setQuantity(String(v.stock || 1));
    }
  }

  const r = useMemo(() => {
    const p = num(price);
    const disc = num(discount);
    const ship = num(shipping);
    const fee = (p * num(feePct)) / 100;
    const c = num(cost);
    const qty = Math.max(0, Math.round(num(quantity)));
    const target = num(targetProfit);

    const revenuePerUnit = p - disc;
    const costPerUnit = c + ship + fee;
    const contributionPerUnit = revenuePerUnit - costPerUnit;
    const totalContribution = contributionPerUnit * qty;
    const totalRevenue = revenuePerUnit * qty;

    const maxAdSpend = Math.max(0, totalContribution); // break-even on ads
    const adBudgetForTarget = Math.max(0, totalContribution - target);
    const adPerUnit = qty > 0 ? maxAdSpend / qty : 0;
    const breakEvenRoas = maxAdSpend > 0 ? totalRevenue / maxAdSpend : 0;

    return {
      revenuePerUnit, costPerUnit, contributionPerUnit, totalContribution,
      totalRevenue, maxAdSpend, adBudgetForTarget, adPerUnit, breakEvenRoas, fee, qty,
    };
  }, [price, cost, discount, shipping, feePct, quantity, targetProfit]);

  const positive = r.contributionPerUnit > 0;

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
      {/* Inputs */}
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="variant">Product / variant</Label>
          <Select id="variant" value={variantId} onChange={(e) => selectVariant(e.target.value)}>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} · {v.stock} in stock
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Selling price €" value={price} onChange={setPrice} />
          <Field label="Production cost €" value={cost} onChange={setCost} />
          <Field label="Discount € / unit" value={discount} onChange={setDiscount} />
          <Field label="Shipping € / unit" value={shipping} onChange={setShipping} />
          <Field label="Payment fees %" value={feePct} onChange={setFeePct} />
          <Field label="Units to sell" value={quantity} onChange={setQuantity} />
          <Field label="Profit you want to keep €" value={targetProfit} onChange={setTargetProfit} />
        </div>
      </div>

      {/* Live results */}
      <div className="space-y-4">
        <div className={`border p-6 ${positive ? "border-status-received" : "border-status-cancelled"}`}>
          <p className="label-caps text-ink/60">Ad budget — break-even</p>
          <p className="mt-1 text-4xl font-bold tabular-nums text-bone">{eur(r.maxAdSpend)}</p>
          <p className="mt-1 text-sm text-ink/60">
            across {r.qty} unit{r.qty === 1 ? "" : "s"} · {eur(r.adPerUnit)} / unit
          </p>
        </div>

        <div className="border border-line bg-surface p-6">
          <p className="label-caps text-ink/60">Ad budget — keep {eur(num(targetProfit))} profit</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-ink">{eur(r.adBudgetForTarget)}</p>
        </div>

        <dl className="space-y-1.5 text-sm">
          <Row k="Revenue / unit (after discount)" v={eur(r.revenuePerUnit)} />
          <Row k="Cost / unit (prod + ship + fees)" v={eur(r.costPerUnit)} />
          <Row k="Contribution / unit" v={eur(r.contributionPerUnit)} accent />
          <Row k="Total contribution" v={eur(r.totalContribution)} accent />
          <Row k="Total revenue" v={eur(r.totalRevenue)} />
          <Row k="Break-even ROAS" v={r.breakEvenRoas > 0 ? `${r.breakEvenRoas.toFixed(2)}×` : "—"} />
        </dl>

        {!positive && (
          <p className="text-sm text-status-cancelled">
            This sells at a loss before ads — drop the cost, raise the price, or cut the discount.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type="number" step="0.01" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
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
