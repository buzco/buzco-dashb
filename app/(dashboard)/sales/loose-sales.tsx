"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { LooseSaleView } from "@/lib/sales/data";
import {
  applyView,
  takesNoValue,
  OPERATORS,
  OPERATOR_LABELS,
  type FilterOperator,
  type FilterRule,
  type SortRule,
} from "@/lib/sales/table-view";
import { COLUMNS, COLUMN_BY_KEY, SUMMED_COLUMNS } from "./loose-sales-columns";

// Everything recorded outside an order: market tills, Shopify imports, raffle
// rows, and anything logged before orders existed. Over a hundred rows and
// growing, so this is a view over the data rather than a list of it — filter
// rules, layered sorts and a properties menu, the way Notion does it.
//
// It all runs client-side. The rows are already in memory, a filter that costs
// a round trip stops being used, and this is a set that fits in a page many
// times over.

const HIDDEN_KEY = "buzco.looseSales.hiddenColumns";

// Which columns are hidden is a per-browser preference, so it lives in
// localStorage — which the server cannot read. Going through
// useSyncExternalStore rather than an effect means the server and the first
// client paint agree on the defaults, and the stored choice arrives without a
// hydration mismatch. Snapshots are the raw JSON string so their identity is
// stable between reads.
const DEFAULT_HIDDEN = COLUMNS.filter((c) => c.hiddenByDefault).map((c) => c.key);
const DEFAULT_HIDDEN_JSON = JSON.stringify(DEFAULT_HIDDEN);

let listeners: Array<() => void> = [];

function subscribe(onChange: () => void): () => void {
  listeners = [...listeners, onChange];
  return () => {
    listeners = listeners.filter((l) => l !== onChange);
  };
}

function readHidden(): string {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) ?? DEFAULT_HIDDEN_JSON;
  } catch {
    // Private window, blocked storage — the defaults are a fine answer.
    return DEFAULT_HIDDEN_JSON;
  }
}

function writeHidden(next: string[]): void {
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
  } catch {
    // Not being able to remember the choice doesn't invalidate it, but the
    // listeners still have to fire or the table won't repaint.
  }
  for (const l of listeners) l();
}

const euro = (n: number) => `€${n.toFixed(2)}`;

/** Everything the search box looks through. */
function haystack(row: LooseSaleView): string {
  return [
    row.label,
    row.productName,
    row.sku,
    row.size,
    row.color,
    row.customerRef,
    row.paymentMethod,
    row.notes,
    row.marketEvent,
    row.location,
    row.shopifyOrderNumber,
    row.channel.replace(/_/g, " "),
  ]
    .filter(Boolean)
    .join(" ");
}

type Panel = "filter" | "sort" | "properties" | null;

export function LooseSales({ rows }: { rows: LooseSaleView[] }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [sorts, setSorts] = useState<SortRule[]>([{ column: "date", descending: true }]);
  const [panel, setPanel] = useState<Panel>(null);

  const hiddenJson = useSyncExternalStore(subscribe, readHidden, () => DEFAULT_HIDDEN_JSON);
  const hidden = useMemo(() => {
    try {
      return JSON.parse(hiddenJson) as string[];
    } catch {
      return DEFAULT_HIDDEN;
    }
  }, [hiddenJson]);

  const visibleColumns = useMemo(
    () => COLUMNS.filter((c) => !hidden.includes(c.key)),
    [hidden],
  );

  /**
   * The distinct values behind each select property, for its value dropdown.
   *
   * Built for every select column at once rather than on demand: there are a
   * handful of them over a list this size, and a lazy cache would be a Map
   * mutated inside a memo.
   */
  const selectOptions = useMemo(() => {
    const byColumn = new Map<string, string[]>();
    for (const column of COLUMNS) {
      if (column.type !== "select") continue;
      const seen = new Set<string>();
      for (const row of rows) {
        const v = column.value(row);
        if (v !== null && v !== undefined && v !== "") seen.add(String(v));
      }
      byColumn.set(column.key, [...seen].sort());
    }
    return byColumn;
  }, [rows]);

  const visible = useMemo(
    () => applyView(rows, COLUMNS, { query, search: haystack, filters, sorts }),
    [rows, query, filters, sorts],
  );

  const totals = useMemo(() => {
    const sums: Record<string, number> = {};
    for (const key of SUMMED_COLUMNS) {
      sums[key] = visible.reduce((n, row) => n + Number(COLUMN_BY_KEY.get(key)!.value(row) ?? 0), 0);
    }
    return sums;
  }, [visible]);

  function addFilter() {
    const column = COLUMNS.find((c) => !filters.some((f) => f.column === c.key)) ?? COLUMNS[0];
    setFilters((prev) => [
      ...prev,
      {
        id: `${column.key}-${Date.now()}`,
        column: column.key,
        operator: OPERATORS[column.type][0],
        value: "",
      },
    ]);
  }

  function patchFilter(id: string, patch: Partial<FilterRule>) {
    setFilters((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const next = { ...f, ...patch };
        // Switching property can strand an operator the new type can't use.
        if (patch.column) {
          const type = COLUMN_BY_KEY.get(patch.column)!.type;
          if (!OPERATORS[type].includes(next.operator)) next.operator = OPERATORS[type][0];
          next.value = "";
        }
        return next;
      }),
    );
  }

  function addSort() {
    const column = COLUMNS.find((c) => !sorts.some((s) => s.column === c.key)) ?? COLUMNS[0];
    setSorts((prev) => [...prev, { column: column.key, descending: false }]);
  }

  const filtering = Boolean(query || filters.length);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search item, size, customer, note…"
          className="min-w-48 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-bone outline-none placeholder:text-ink/30 focus:border-ink"
        />
        <ToolbarButton
          label="Filter"
          count={filters.length}
          active={panel === "filter"}
          onClick={() => setPanel(panel === "filter" ? null : "filter")}
        />
        <ToolbarButton
          label="Sort"
          count={sorts.length}
          active={panel === "sort"}
          onClick={() => setPanel(panel === "sort" ? null : "sort")}
        />
        <ToolbarButton
          label="Properties"
          count={hidden.length ? hidden.length : 0}
          countLabel={hidden.length ? `${hidden.length} hidden` : undefined}
          active={panel === "properties"}
          onClick={() => setPanel(panel === "properties" ? null : "properties")}
        />
      </div>

      {panel === "filter" && (
        <Panel>
          {!filters.length && (
            <p className="text-sm text-ink/40">No filters. Every row is showing.</p>
          )}
          {filters.map((rule, i) => {
            const column = COLUMN_BY_KEY.get(rule.column)!;
            return (
              <div key={rule.id} className="flex flex-wrap items-center gap-2">
                <span className="label-caps w-10 shrink-0 text-ink/40">
                  {i === 0 ? "Where" : "And"}
                </span>
                <Select
                  value={rule.column}
                  onChange={(v) => patchFilter(rule.id, { column: v })}
                  options={COLUMNS.map((c) => [c.key, c.label])}
                />
                <Select
                  value={rule.operator}
                  onChange={(v) => patchFilter(rule.id, { operator: v as FilterOperator })}
                  options={OPERATORS[column.type].map((o) => [o, OPERATOR_LABELS[o]])}
                />
                {!takesNoValue(rule.operator) &&
                  (column.type === "select" ? (
                    <Select
                      value={rule.value}
                      onChange={(v) => patchFilter(rule.id, { value: v })}
                      options={[["", "Pick one…"], ...(selectOptions.get(column.key) ?? []).map((o) => [o, o] as [string, string])]}
                    />
                  ) : (
                    <input
                      type={column.type === "date" ? "date" : column.type === "number" ? "number" : "text"}
                      value={rule.value}
                      onChange={(e) => patchFilter(rule.id, { value: e.target.value })}
                      placeholder="Value"
                      className="w-36 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-bone outline-none placeholder:text-ink/30 focus:border-ink"
                    />
                  ))}
                <IconButton
                  label="Remove filter"
                  onClick={() => setFilters((prev) => prev.filter((f) => f.id !== rule.id))}
                />
              </div>
            );
          })}
          <div className="flex gap-3 pt-1">
            <AddButton onClick={addFilter}>+ Add a filter</AddButton>
            {Boolean(filters.length) && (
              <AddButton onClick={() => setFilters([])}>Remove all</AddButton>
            )}
          </div>
        </Panel>
      )}

      {panel === "sort" && (
        <Panel>
          {!sorts.length && <p className="text-sm text-ink/40">No sorts. Rows are in load order.</p>}
          {sorts.map((sort, i) => (
            <div key={`${sort.column}-${i}`} className="flex flex-wrap items-center gap-2">
              <span className="label-caps w-10 shrink-0 text-ink/40">
                {i === 0 ? "Sort" : "Then"}
              </span>
              <Select
                value={sort.column}
                onChange={(v) =>
                  setSorts((prev) => prev.map((s, j) => (j === i ? { ...s, column: v } : s)))
                }
                options={COLUMNS.map((c) => [c.key, c.label])}
              />
              <Select
                value={sort.descending ? "desc" : "asc"}
                onChange={(v) =>
                  setSorts((prev) =>
                    prev.map((s, j) => (j === i ? { ...s, descending: v === "desc" } : s)),
                  )
                }
                options={
                  COLUMN_BY_KEY.get(sort.column)!.type === "number" ||
                  COLUMN_BY_KEY.get(sort.column)!.type === "date"
                    ? [
                        ["asc", "Ascending"],
                        ["desc", "Descending"],
                      ]
                    : [
                        ["asc", "A → Z"],
                        ["desc", "Z → A"],
                      ]
                }
              />
              <IconButton
                label="Remove sort"
                onClick={() => setSorts((prev) => prev.filter((_, j) => j !== i))}
              />
            </div>
          ))}
          <div className="flex gap-3 pt-1">
            <AddButton onClick={addSort}>+ Add a sort</AddButton>
            {Boolean(sorts.length) && (
              <AddButton onClick={() => setSorts([])}>Remove all</AddButton>
            )}
          </div>
        </Panel>
      )}

      {panel === "properties" && (
        <Panel>
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {COLUMNS.map((column) => {
              const shown = !hidden.includes(column.key);
              return (
                <label
                  key={column.key}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-ink/5"
                >
                  <span className={shown ? "text-sm text-bone" : "text-sm text-ink/40"}>
                    {column.label}
                  </span>
                  <input
                    type="checkbox"
                    checked={shown}
                    onChange={() =>
                      writeHidden(
                        shown
                          ? [...hidden, column.key]
                          : hidden.filter((k) => k !== column.key),
                      )
                    }
                    className="h-4 w-4 accent-pink"
                  />
                </label>
              );
            })}
          </div>
          <div className="flex gap-3 pt-1">
            <AddButton onClick={() => writeHidden([])}>Show all</AddButton>
            <AddButton
              onClick={() =>
                writeHidden(COLUMNS.filter((c) => c.hiddenByDefault).map((c) => c.key))
              }
            >
              Reset
            </AddButton>
          </div>
        </Panel>
      )}

      {!visible.length ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-sm text-ink/50">
          Nothing matches that.{" "}
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setFilters([]);
            }}
            className="text-bone underline underline-offset-2"
          >
            Clear the filters
          </button>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {visibleColumns.map((column) => {
                  const sortIndex = sorts.findIndex((s) => s.column === column.key);
                  const sort = sortIndex >= 0 ? sorts[sortIndex] : null;
                  return (
                    <th
                      key={column.key}
                      className={`label-caps border-b border-line bg-surface px-3 py-2 text-ink/50 ${
                        column.numeric ? "text-right" : ""
                      }`}
                    >
                      {/* Clicking a header sorts by it alone — the quick path.
                          Layered sorts live in the Sort panel. */}
                      <button
                        type="button"
                        onClick={() =>
                          setSorts(
                            sort && sorts.length === 1
                              ? [{ column: column.key, descending: !sort.descending }]
                              : [{ column: column.key, descending: column.type !== "text" }],
                          )
                        }
                        className={`inline-flex items-center gap-1 hover:text-ink ${
                          sort ? "text-ink" : ""
                        }`}
                      >
                        {column.label}
                        <span className={sort ? "" : "opacity-0"} aria-hidden>
                          {sort?.descending ? "↓" : "↑"}
                        </span>
                        {sorts.length > 1 && sortIndex >= 0 && (
                          <span className="text-ink/40">{sortIndex + 1}</span>
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="hover:bg-ink/5">
                  {visibleColumns.map((column) => (
                    <td
                      key={column.key}
                      className={`border-b border-line px-3 py-2 ${
                        column.numeric ? "text-right font-mono tabular-nums" : ""
                      }`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {/* Totals for whatever survived the filters, so narrowing the view
                doubles as adding it up. */}
            <tfoot>
              <tr>
                {visibleColumns.map((column, i) => (
                  <td
                    key={column.key}
                    className={`bg-surface px-3 py-2 ${
                      column.numeric ? "text-right font-mono tabular-nums text-bone" : "text-ink/40"
                    }`}
                  >
                    {i === 0
                      ? `${visible.length} ${visible.length === 1 ? "row" : "rows"}`
                      : (SUMMED_COLUMNS as readonly string[]).includes(column.key)
                        ? column.key === "qty"
                          ? totals[column.key]
                          : euro(totals[column.key])
                        : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-sm text-ink/50">
        {filtering ? `${visible.length} of ${rows.length} rows` : `${rows.length} rows`} ·{" "}
        {totals.qty} {totals.qty === 1 ? "unit" : "units"} ·{" "}
        <span className="font-mono tabular-nums text-bone">{euro(totals.net)}</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface p-3">{children}</div>
  );
}

function ToolbarButton({
  label,
  count,
  countLabel,
  active,
  onClick,
}: {
  label: string;
  count: number;
  countLabel?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`label-caps whitespace-nowrap rounded-md border px-3 py-2 transition-colors ${
        active || count
          ? "border-ink bg-ink/10 text-ink"
          : "border-line text-ink/50 hover:border-ink/50"
      }`}
    >
      {label}
      {count > 0 && <span className="ml-1.5 text-ink/60">{countLabel ?? count}</span>}
    </button>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-bone outline-none focus:border-ink"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

function IconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-md border border-line px-2 py-1 text-ink/40 hover:border-status-cancelled hover:text-status-cancelled"
    >
      ×
    </button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="label-caps text-ink/50 hover:text-ink"
    >
      {children}
    </button>
  );
}
