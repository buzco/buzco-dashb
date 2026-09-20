import Image from "next/image";
import { shopifyCdnResize } from "@/lib/shopify/image";
import type { LooseSaleView } from "@/lib/sales/data";

// The column definitions for the Other sales table, kept apart from the table
// itself because everything else — sorting, filtering, the properties menu —
// is driven off this list. Adding a column here is meant to be the whole job.

export type ColumnType = "text" | "select" | "number" | "date";

export type Column = {
  key: string;
  label: string;
  type: ColumnType;
  /** Right-aligned, monospaced: money and counts. */
  numeric?: boolean;
  /** Off until someone asks for it in the properties menu. */
  hiddenByDefault?: boolean;
  /** The comparable value, used for both sorting and filtering. */
  value: (row: LooseSaleView) => string | number | null;
  render: (row: LooseSaleView) => React.ReactNode;
};

const euro = (n: number) => `€${n.toFixed(2)}`;

function ItemCell({ row }: { row: LooseSaleView }) {
  const thumb = row.imageUrl ? shopifyCdnResize(row.imageUrl, 120) : null;
  const attrs = [row.size, row.color].filter(Boolean).join(" / ");

  return (
    <div className="flex items-center gap-2.5">
      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-ink/5">
        {thumb && <Image src={thumb} alt="" fill sizes="36px" className="object-cover" />}
      </div>
      <div className="min-w-0">
        <p className="truncate text-bone">{row.productName ?? row.label}</p>
        <p className="label-caps truncate text-ink/40">
          {attrs || row.sku || "—"}
          {row.isFreebie && <span className="ml-1.5 text-pink">freebie</span>}
        </p>
      </div>
    </div>
  );
}

/** A money cell that stays quiet when there is nothing to say. */
function Money({ amount, muted = true }: { amount: number; muted?: boolean }) {
  if (!amount) return <span className="text-ink/25">—</span>;
  return <span className={muted ? "text-ink/70" : "text-bone"}>{euro(amount)}</span>;
}

export const COLUMNS: Column[] = [
  {
    key: "date",
    label: "Date",
    type: "date",
    // Sorted and filtered on the calendar day, not the instant: "is 14 Aug"
    // should catch a sale at 21:40 as readily as one at 09:00.
    value: (r) => r.soldAt.slice(0, 10),
    render: (r) => {
      const d = new Date(r.soldAt);
      return (
        <span className="whitespace-nowrap text-ink/70">
          {d.toLocaleDateString("en-IE", { day: "2-digit", month: "short" })}
          <span className="label-caps block text-ink/30">{d.getFullYear()}</span>
        </span>
      );
    },
  },
  {
    key: "item",
    label: "Item",
    type: "text",
    value: (r) => r.productName ?? r.label,
    render: (r) => <ItemCell row={r} />,
  },
  {
    key: "type",
    label: "Type",
    type: "select",
    hiddenByDefault: true,
    value: (r) => (r.isConsignment ? "Consignment" : "Sale"),
    render: (r) =>
      r.isConsignment ? (
        <span className="label-caps rounded-full border border-status-ordered px-2 py-0.5 text-status-ordered">
          consignment
        </span>
      ) : (
        <span className="label-caps text-ink/40">sale</span>
      ),
  },
  {
    key: "channel",
    label: "Channel",
    type: "select",
    value: (r) => r.channel,
    render: (r) => (
      <span className="label-caps whitespace-nowrap text-ink/70">
        {r.channel.replace(/_/g, " ")}
      </span>
    ),
  },
  {
    key: "location",
    label: "Location",
    type: "select",
    value: (r) => r.location,
    render: (r) => (
      <span className="text-ink/70">
        {r.location ?? <span className="text-ink/25">—</span>}
        {/* The venue is the location; the event name is the occasion. */}
        {r.marketEvent && r.marketEvent !== r.location && (
          <span className="block truncate text-xs text-ink/40">{r.marketEvent}</span>
        )}
      </span>
    ),
  },
  {
    key: "payment",
    label: "Payment",
    type: "select",
    value: (r) => r.paymentMethod,
    render: (r) => (
      <span className="whitespace-nowrap text-ink/70">
        {r.paymentMethod ?? <span className="text-ink/25">—</span>}
      </span>
    ),
  },
  {
    key: "customer",
    label: "Customer",
    type: "text",
    hiddenByDefault: true,
    value: (r) => r.customerRef,
    render: (r) => (
      <span className="text-ink/70">{r.customerRef ?? <span className="text-ink/25">—</span>}</span>
    ),
  },
  {
    key: "qty",
    label: "Qty",
    type: "number",
    numeric: true,
    value: (r) => r.quantity,
    render: (r) => <span className="text-ink/70">{r.quantity}</span>,
  },
  {
    key: "unit",
    label: "Unit",
    type: "number",
    numeric: true,
    value: (r) => r.unitPrice,
    render: (r) => <span className="text-ink/70">{euro(r.unitPrice)}</span>,
  },
  {
    key: "gross",
    label: "Gross",
    type: "number",
    numeric: true,
    hiddenByDefault: true,
    value: (r) => r.grossAmount,
    render: (r) => <Money amount={r.grossAmount} />,
  },
  {
    key: "discount",
    label: "Discount",
    type: "number",
    numeric: true,
    hiddenByDefault: true,
    value: (r) => r.discountAmount,
    render: (r) =>
      r.discountAmount > 0 ? (
        <span className="text-pink">−{euro(r.discountAmount)}</span>
      ) : (
        <span className="text-ink/25">—</span>
      ),
  },
  {
    key: "fees",
    label: "Fees",
    type: "number",
    numeric: true,
    hiddenByDefault: true,
    value: (r) => r.feesAmount,
    render: (r) => <Money amount={r.feesAmount} />,
  },
  {
    key: "shipping",
    label: "Shipping",
    type: "number",
    numeric: true,
    hiddenByDefault: true,
    value: (r) => r.shippingAmount,
    render: (r) => <Money amount={r.shippingAmount} />,
  },
  {
    key: "net",
    label: "Net",
    type: "number",
    numeric: true,
    value: (r) => r.netAmount,
    render: (r) => (
      <span className="whitespace-nowrap">
        <span className="text-bone">{euro(r.netAmount)}</span>
        {/* A discount is invisible in the net alone, and it is the number that
            explains why two rows for the same garment disagree. */}
        {r.discountAmount > 0 && (
          <span className="label-caps block text-pink">−{euro(r.discountAmount)}</span>
        )}
      </span>
    ),
  },
  {
    key: "shopify",
    label: "Shopify order",
    type: "text",
    hiddenByDefault: true,
    value: (r) => r.shopifyOrderNumber,
    render: (r) =>
      r.shopifyOrderNumber ? (
        r.shopifyAdminUrl ? (
          <a
            href={r.shopifyAdminUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-bone underline-offset-2 hover:underline"
          >
            {r.shopifyOrderNumber}
          </a>
        ) : (
          <span className="font-mono text-xs text-ink/70">{r.shopifyOrderNumber}</span>
        )
      ) : (
        <span className="text-ink/25">—</span>
      ),
  },
  {
    key: "notes",
    label: "Notes",
    type: "text",
    hiddenByDefault: true,
    value: (r) => r.notes,
    render: (r) => (
      <span className="block max-w-56 truncate text-ink/60" title={r.notes ?? undefined}>
        {r.notes ?? <span className="text-ink/25">—</span>}
      </span>
    ),
  },
];

export const COLUMN_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]));

/** Which totals are worth adding up under a filtered view. */
export const SUMMED_COLUMNS = ["qty", "gross", "discount", "fees", "shipping", "net"] as const;
