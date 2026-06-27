"use client";

import { useActionState } from "react";
import {
  consignmentSend,
  consignmentMarkSold,
  consignmentReturn,
  type ConsignmentLineState,
} from "@/lib/actions/consignments";
import { Label, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

type VariantOption = { id: string; label: string };
type LocationOption = { id: string; name: string };

export function ConsignmentSendForm({
  consignmentId,
  variants,
  locations,
  defaultLocationId,
}: {
  consignmentId: string;
  variants: VariantOption[];
  locations: LocationOption[];
  defaultLocationId: string;
}) {
  const action = consignmentSend.bind(null, consignmentId);
  const [state, formAction, isPending] = useActionState<ConsignmentLineState | undefined, FormData>(
    action,
    undefined,
  );

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <div className="space-y-1">
        <Label htmlFor="variant_id">Variant</Label>
        <Select id="variant_id" name="variant_id" required defaultValue="">
          <option value="" disabled>
            Pick a variant…
          </option>
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1">
          <Label htmlFor="quantity">Quantity</Label>
          <Input id="quantity" name="quantity" type="number" min={1} defaultValue={1} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="wholesale_price">Wholesale €</Label>
          <Input id="wholesale_price" name="wholesale_price" type="number" step="0.01" min={0} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="from_location_id">From</Label>
          <Select id="from_location_id" name="from_location_id" required defaultValue={defaultLocationId}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Sending…" : "Send to retailer"}
        </Button>
        {state?.error && <span className="text-sm text-status-cancelled">{state.error}</span>}
        {state?.ok && <span className="text-sm text-ink/60">Sent ✓</span>}
      </div>
    </form>
  );
}

// Compact per-line quantity action, reused for "mark sold" and "return".
export function LineQuantityAction({
  kind,
  consignmentId,
  lineId,
  toLocationId,
  max,
  verb,
}: {
  kind: "sold" | "return";
  consignmentId: string;
  lineId: string;
  toLocationId?: string;
  max: number;
  verb: string;
}) {
  const action =
    kind === "sold"
      ? consignmentMarkSold.bind(null, consignmentId, lineId)
      : consignmentReturn.bind(null, consignmentId, lineId, toLocationId ?? "");
  const [state, formAction, isPending] = useActionState<ConsignmentLineState | undefined, FormData>(
    action,
    undefined,
  );

  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input
        name="quantity"
        type="number"
        min={1}
        max={max}
        defaultValue={1}
        required
        className="w-16 rounded-md border border-line bg-surface px-2 py-1 text-sm text-bone outline-none focus:border-ink"
      />
      <button
        type="submit"
        disabled={isPending}
        className="label-caps rounded-md border border-ink/60 px-2 py-1 text-ink hover:border-ink disabled:opacity-50"
      >
        {isPending ? "…" : verb}
      </button>
      {state?.error && <span className="text-xs text-status-cancelled">{state.error}</span>}
      {state?.ok && <span className="text-xs text-ink/50">✓</span>}
    </form>
  );
}
