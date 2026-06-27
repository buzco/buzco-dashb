"use client";

import { useActionState } from "react";
import { logSale, type LogSaleState } from "@/lib/actions/sales";
import { Label, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

type VariantOption = { id: string; label: string };
type LocationOption = { id: string; name: string };

const CHANNELS = ["market", "friends_family", "wholesale", "other", "shopify"];

export function LogSaleForm({
  variants,
  locations,
  defaultLocationId,
}: {
  variants: VariantOption[];
  locations: LocationOption[];
  defaultLocationId: string;
}) {
  const [state, formAction, isPending] = useActionState<LogSaleState | undefined, FormData>(
    logSale,
    undefined,
  );

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="channel">Channel</Label>
          <Select id="channel" name="channel" defaultValue="market">
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="quantity">Quantity</Label>
          <Input id="quantity" name="quantity" type="number" min={1} defaultValue={1} required />
        </div>
      </div>

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

      <div className="space-y-1">
        <Label htmlFor="location_id">Stock leaves from</Label>
        <Select id="location_id" name="location_id" required defaultValue={defaultLocationId}>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="gross_amount">Gross amount</Label>
          <Input id="gross_amount" name="gross_amount" type="number" step="0.01" min={0} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="discount_amount">Discount</Label>
          <Input id="discount_amount" name="discount_amount" type="number" step="0.01" min={0} defaultValue={0} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="shipping_amount">Shipping</Label>
          <Input id="shipping_amount" name="shipping_amount" type="number" step="0.01" min={0} defaultValue={0} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fees_amount">Fees</Label>
          <Input id="fees_amount" name="fees_amount" type="number" step="0.01" min={0} defaultValue={0} />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="customer_ref">Customer ref</Label>
        <Input id="customer_ref" name="customer_ref" placeholder="name / market / note" />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Logging…" : "Log sale"}
        </Button>
        {state?.error && <span className="text-sm text-status-cancelled">{state.error}</span>}
        {state?.ok && <span className="text-sm text-ink/60">Logged ✓</span>}
      </div>
    </form>
  );
}
