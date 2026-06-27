"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";

export type StockRow = {
  label: string;
  locations: { name: string; qty: number }[];
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

export function CatalogCard({ product }: { product: CatalogProduct }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <Link href={`/products/${product.id}`} className="block">
        <div className="relative aspect-square w-full bg-ink/5">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              sizes="(max-width:768px) 50vw, 25vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-ink/30">
              <span className="label-caps">No image</span>
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
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-bone">{product.name} — stock</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="label-caps text-ink/60 hover:text-ink"
              >
                Close
              </button>
            </div>
            {!product.stockRows.length ? (
              <p className="text-sm text-ink/50">No stock recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {product.stockRows.map((row, i) => (
                  <div key={i} className="border-b border-line pb-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-bone">{row.label}</span>
                      <span className="font-mono tabular-nums text-ink">{row.total}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                      {row.locations.length ? (
                        row.locations.map((l, j) => (
                          <span key={j} className="text-xs text-ink/50">
                            {l.name}: <span className="font-mono">{l.qty}</span>
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-ink/40">no stock</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
