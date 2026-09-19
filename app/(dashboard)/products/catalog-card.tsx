"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { shopifyCdnResize } from "@/lib/shopify/image";
import { setVariantStock } from "@/lib/actions/inventory";

export type StockRow = {
  variantId: string;
  label: string;
  /** Quantity at the stock-centre location — the editable one. */
  centreQty: number;
  /** Anywhere else holding this variant, for context only. */
  others: { name: string; qty: number }[];
  total: number;
};

export type CatalogProduct = {
  id: string;
  name: string;
  status: string;
  imageUrl: string | null;
  variantCount: number;
  totalStock: number;
  stockRows: StockRow[];
};

export function CatalogCard({
  product,
  stockLocationId,
  stockLocationName,
}: {
  product: CatalogProduct;
  /** Null until a Shopify sync has created the mirror location. */
  stockLocationId: string | null;
  stockLocationName: string;
}) {
  const [open, setOpen] = useState(false);
  // Shopify files get deleted while our image_url still points at them, and a
  // dead URL otherwise renders as the browser's broken-image glyph. Fall back to
  // the same empty state a product with no image gets.
  const [imageFailed, setImageFailed] = useState(false);
  const src = imageFailed ? null : shopifyCdnResize(product.imageUrl);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <Link href={`/products/${product.id}`} className="block">
        <div className="relative aspect-square w-full bg-ink/5">
          {src ? (
            <Image
              src={src}
              alt={product.name}
              fill
              sizes="(max-width:768px) 50vw, 25vw"
              className="object-cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-ink/30">
              <span className="label-caps">{imageFailed ? "Image missing" : "No image"}</span>
            </div>
          )}
        </div>
      </Link>

      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/products/${product.id}`} className="font-medium text-bone hover:underline">
            {product.name}
          </Link>
          <Badge status={product.status} />
        </div>
        <p className="text-xs text-ink/50">
          {product.variantCount} variant{product.variantCount === 1 ? "" : "s"} ·{" "}
          <span className="font-mono tabular-nums">{product.totalStock}</span> in stock
        </p>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="label-caps rounded-md border border-ink/50 px-2.5 py-1 text-ink hover:border-ink hover:bg-ink/10"
          >
            Inventory
          </button>
          <Link
            href={`/products/${product.id}/edit`}
            className="label-caps rounded-md border border-line px-2.5 py-1 text-ink/70 hover:border-ink hover:text-ink"
          >
            Edit
          </Link>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl border border-line bg-surface p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-bone">{product.name} — stock</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="label-caps text-ink/60 hover:text-ink"
              >
                Close
              </button>
            </div>
            <p className="mb-4 text-xs text-ink/50">
              {stockLocationId
                ? `Editing ${stockLocationName} — saving writes the new count to Shopify too.`
                : "No Shopify stock location yet — run a sync before correcting counts."}
            </p>

            {!product.stockRows.length ? (
              <p className="text-sm text-ink/50">This product has no variants yet.</p>
            ) : (
              <div className="space-y-1">
                {product.stockRows.map((row) => (
                  <StockRowEditor
                    key={row.variantId}
                    row={row}
                    locationId={stockLocationId}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One variant's count, editable in place.
 *
 * Saving writes the DIFFERENCE as a ledger movement rather than overwriting a
 * number, so "we found three more in the box" stays distinguishable from a sale
 * in the history. The input is only committed on Save, never on change: a stock
 * figure is not something to write on every keystroke.
 */
function StockRowEditor({ row, locationId }: { row: StockRow; locationId: string | null }) {
  const [value, setValue] = useState(String(row.centreQty));
  const [state, setState] = useState<{ ok?: boolean; error?: string; warning?: string } | null>(
    null,
  );
  const [pending, start] = useTransition();

  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 0;
  // `row.centreQty` is the server's number; once saved it only refreshes on the
  // next render, so compare against what was typed to know if there's work.
  const dirty = valid && parsed !== row.centreQty;

  function save() {
    if (!locationId || !dirty) return;
    start(async () => {
      const result = await setVariantStock(row.variantId, locationId, parsed);
      setState(result);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2">
      <span className="min-w-0 flex-1 truncate text-sm text-bone">{row.label}</span>

      {row.others.map((l, j) => (
        <span key={j} className="label-caps shrink-0 text-ink/40">
          {l.name} <span className="font-mono">{l.qty}</span>
        </span>
      ))}

      <input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={value}
        disabled={!locationId || pending}
        onChange={(e) => {
          setValue(e.target.value);
          setState(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
        }}
        className={`w-20 shrink-0 rounded-md border bg-surface px-2 py-1 text-right font-mono tabular-nums text-bone outline-none focus:border-ink disabled:opacity-40 ${
          valid ? "border-line" : "border-status-cancelled"
        }`}
      />

      <button
        type="button"
        onClick={save}
        disabled={!locationId || !dirty || pending}
        className="label-caps w-16 shrink-0 rounded-md border border-ink/50 px-2 py-1 text-ink disabled:border-line disabled:text-ink/25"
      >
        {pending ? "…" : state?.ok && !dirty ? "Saved" : "Save"}
      </button>

      {state?.error && (
        <p className="w-full text-xs text-status-cancelled">{state.error}</p>
      )}
      {state?.warning && <p className="w-full text-xs text-status-ordered">{state.warning}</p>}
    </div>
  );
}
