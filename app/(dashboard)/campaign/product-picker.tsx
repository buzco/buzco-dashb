"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";

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

const eur = (n: number) =>
  "€" + n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ProductPicker({
  products,
  selectedIds,
  onToggle,
  onSelectMany,
  onClear,
}: {
  products: CalcProduct[];
  selectedIds: Set<string>;
  onToggle: (p: CalcProduct) => void;
  onSelectMany: (ps: CalcProduct[]) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
  }, [products, search]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="label-caps text-ink/60">Products in this campaign ({selectedIds.size})</h2>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onSelectMany(visible)}
            className="label-caps text-ink/50 underline-offset-2 hover:text-ink hover:underline"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={onClear}
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

      <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface/90">
        {visible.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-ink/5">
              <input
                type="checkbox"
                checked={selectedIds.has(p.id)}
                onChange={() => onToggle(p)}
                className="h-4 w-4 accent-pink"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-bone">
                  {p.name}
                  {p.hint && <span className="ml-1.5 font-mono text-xs text-ink/50">{p.hint}</span>}
                </span>
                <span className="block text-xs text-ink/50">
                  {eur(p.retailPrice)} ·{" "}
                  {p.productionCost > 0 ? (
                    <>cost {eur(p.productionCost)}</>
                  ) : (
                    <span className="text-status-ordered">no cost recorded</span>
                  )}{" "}
                  · {p.stock} in stock · {p.variantCount} variant{p.variantCount === 1 ? "" : "s"}
                </span>
              </span>
            </label>
          </li>
        ))}
        {!visible.length && (
          <li className="px-4 py-3 text-sm text-ink/50">No product matches “{search}”.</li>
        )}
      </ul>
    </div>
  );
}
