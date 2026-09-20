"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { shopifyCdnResize } from "@/lib/shopify/image";
import type { LooseSaleView } from "@/lib/sales/data";

// Everything recorded outside an order: market tills, Shopify imports, raffle
// rows, and anything logged before orders existed. Over a hundred rows and
// growing, which is why this is a real table rather than the last 25 — the
// point of the section is finding one row, and you cannot find what isn't
// rendered.
//
// Sorting and filtering are client-side on purpose. The rows are already in
// memory, a filter that costs a round trip stops being used, and this is a set
// that fits in a page many times over.

type SortKey =
  | "soldAt"
  | "label"
  | "channel"
  | "payment"
  | "quantity"
  | "unitPrice"
  | "netAmount";

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: "soldAt", label: "Date" },
  { key: "label", label: "Item" },
  { key: "channel", label: "Channel" },
  { key: "payment", label: "Payment" },
  { key: "quantity", label: "Qty", numeric: true },
  { key: "unitPrice", label: "Unit", numeric: true },
  { key: "netAmount", label: "Net", numeric: true },
];

/** Columns that mean "biggest first" when you land on them. */
const DESCENDING_FIRST: SortKey[] = ["soldAt", "quantity", "unitPrice", "netAmount"];

const euro = (n: number) => `€${n.toFixed(2)}`;

function sortValue(row: LooseSaleView, key: SortKey): string | number {
  switch (key) {
    case "soldAt":
      return new Date(row.soldAt).getTime();
    case "label":
      return (row.productName ?? row.label).toLowerCase();
    case "channel":
      return row.marketEvent ?? row.channel;
    case "payment":
      return (row.paymentMethod ?? "").toLowerCase();
    default:
      return row[key];
  }
}

/** Everything a person might type into the box, flattened into one haystack. */
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
    row.channel.replace(/_/g, " "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function LooseSales({ rows }: { rows: LooseSaleView[] }) {
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("");
  const [payment, setPayment] = useState("");
  const [sort, setSort] = useState<SortKey>("soldAt");
  const [descending, setDescending] = useState(true);

  const channels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.channel, (counts.get(r.channel) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const payments = useMemo(
    () => [...new Set(rows.map((r) => r.paymentMethod).filter(Boolean))].sort() as string[],
    [rows],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter(
      (r) =>
        (!channel || r.channel === channel) &&
        (!payment || r.paymentMethod === payment) &&
        (!q || haystack(r).includes(q)),
    );
    const direction = descending ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sort);
      const bv = sortValue(b, sort);
      // Ties fall back to newest first, so a sort on Channel or Payment still
      // reads chronologically inside each group.
      if (av === bv) return new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime();
      return av > bv ? direction : -direction;
    });
  }, [rows, query, channel, payment, sort, descending]);

  const shown = useMemo(
    () => ({
      net: visible.reduce((n, r) => n + r.netAmount, 0),
      units: visible.reduce((n, r) => n + r.quantity, 0),
    }),
    [visible],
  );

  // Clicking the column you are already on flips it, like every table that
  // behaves the way people expect.
  function toggleSort(key: SortKey) {
    if (key === sort) {
      setDescending((d) => !d);
      return;
    }
    setSort(key);
    setDescending(DESCENDING_FIRST.includes(key));
  }

  function clearFilters() {
    setQuery("");
    setChannel("");
    setPayment("");
  }

  const filtering = Boolean(query || channel || payment);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search item, size, customer, note…"
          className="min-w-52 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-bone outline-none placeholder:text-ink/30 focus:border-ink"
        />
        <select
          value={payment}
          onChange={(e) => setPayment(e.target.value)}
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-bone outline-none focus:border-ink"
        >
          <option value="">Any payment</option>
          {payments.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Chip label={`All ${rows.length}`} active={!channel} onClick={() => setChannel("")} />
        {channels.map(([name, count]) => (
          <Chip
            key={name}
            label={`${name.replace(/_/g, " ")} ${count}`}
            active={channel === name}
            onClick={() => setChannel(channel === name ? "" : name)}
          />
        ))}
      </div>

      {!visible.length ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-sm text-ink/50">
          Nothing matches that.{" "}
          <button
            type="button"
            onClick={clearFilters}
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
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className={`label-caps border-b border-line bg-surface px-3 py-2 text-ink/50 ${
                      c.numeric ? "text-right" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={`inline-flex items-center gap-1 hover:text-ink ${
                        sort === c.key ? "text-ink" : ""
                      }`}
                    >
                      {c.label}
                      {/* Held in the layout even when inactive, so the header
                          row doesn't jiggle as the sort moves between columns. */}
                      <span className={sort === c.key ? "" : "opacity-0"} aria-hidden>
                        {descending ? "↓" : "↑"}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-sm text-ink/50">
        {filtering ? `${visible.length} of ${rows.length} rows` : `${rows.length} rows`} ·{" "}
        {shown.units} {shown.units === 1 ? "unit" : "units"} ·{" "}
        <span className="font-mono tabular-nums text-bone">{euro(shown.net)}</span>
      </p>
    </div>
  );
}

function Row({ row }: { row: LooseSaleView }) {
  const thumb = row.imageUrl ? shopifyCdnResize(row.imageUrl, 120) : null;
  const attrs = [row.size, row.color].filter(Boolean).join(" / ");
  const soldAt = new Date(row.soldAt);

  return (
    <tr className="hover:bg-ink/5">
      <td className="whitespace-nowrap border-b border-line px-3 py-2 text-ink/70">
        {soldAt.toLocaleDateString("en-IE", { day: "2-digit", month: "short" })}
        <span className="label-caps block text-ink/30">{soldAt.getFullYear()}</span>
      </td>

      <td className="border-b border-line px-3 py-2">
        <div className="flex items-center gap-2.5">
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-ink/5">
            {thumb && <Image src={thumb} alt="" fill sizes="36px" className="object-cover" />}
          </div>
          <div className="min-w-0">
            <p className="truncate text-bone">{row.productName ?? row.label}</p>
            <p className="label-caps truncate text-ink/40">
              {attrs || row.sku || row.customerRef || "—"}
              {row.isFreebie && <span className="ml-1.5 text-pink">freebie</span>}
            </p>
          </div>
        </div>
      </td>

      <td className="whitespace-nowrap border-b border-line px-3 py-2">
        <span className="label-caps text-ink/70">{row.channel.replace(/_/g, " ")}</span>
        {/* Which market, not just "market" — that is the thing being scanned for. */}
        {row.marketEvent && (
          <span className="block truncate text-xs text-ink/40">{row.marketEvent}</span>
        )}
      </td>

      <td className="whitespace-nowrap border-b border-line px-3 py-2 text-ink/70">
        {row.paymentMethod ?? "—"}
      </td>

      <td className="border-b border-line px-3 py-2 text-right font-mono tabular-nums text-ink/70">
        {row.quantity}
      </td>

      <td className="border-b border-line px-3 py-2 text-right font-mono tabular-nums text-ink/70">
        {euro(row.unitPrice)}
      </td>

      <td className="whitespace-nowrap border-b border-line px-3 py-2 text-right">
        <span className="font-mono tabular-nums text-bone">{euro(row.netAmount)}</span>
        {/* A discount is invisible in the net alone, and it is the number that
            explains why two rows for the same piece don't match. */}
        {row.discountAmount > 0 && (
          <span className="label-caps block text-pink">−{euro(row.discountAmount)}</span>
        )}
      </td>
    </tr>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`label-caps rounded-full border px-2.5 py-1 transition-colors ${
        active ? "border-ink bg-ink/10 text-ink" : "border-line text-ink/50 hover:border-ink/50"
      }`}
    >
      {label}
    </button>
  );
}
