import { loadInVariant, loadOutVariant, loadOutEverything } from "@/lib/actions/markets";
import { Button } from "@/components/ui/button";
import { Label, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, Th, Td } from "@/components/ui/table";
import type { MarketData } from "./market-data";

// Packing screen: what goes in the crate before the event and what comes home
// after. Both directions are real ledger transfers, so the warehouse count is
// never quietly wrong while you're at a stall.

export type VariantOption = {
  id: string;
  label: string;
  available: number;
};

export function LoadPanel({
  data,
  variantOptions,
  defaultFromLocationId,
}: {
  data: MarketData;
  variantOptions: VariantOption[];
  defaultFromLocationId: string;
}) {
  const { event, products, locations } = data;
  // The crate itself is not a valid source or destination.
  const otherLocations = locations.filter((l) => l.id !== event.location_id);
  const sourceHoldingStock = otherLocations.find((l) => l.id === defaultFromLocationId);
  const loaded = products.flatMap((p) =>
    p.variants
      .filter((v) => v.inCrate > 0)
      .map((v) => ({ ...v, productName: p.name })),
  );

  return (
    <div className="space-y-10">
      {/* Loading out of the Shopify mirror location is currently the only option
          (Main Warehouse holds 0), but syncFromShopify() force-sets that
          location to Shopify's on-hand — so a sync run while stock is at the
          stall silently re-inflates it. Warn rather than pretend. */}
      {sourceHoldingStock?.type === "shopify" && (
        <div className="rounded-lg border border-status-ordered/60 bg-surface p-4">
          <p className="label-caps text-status-ordered">Don&apos;t run the Shopify sync mid-event</p>
          <p className="mt-1 text-sm text-ink/60">
            Your stock lives in the <span className="text-bone">{sourceHoldingStock.name}</span>{" "}
            mirror location, so that&apos;s where the crate is packed from. The Shopify page&apos;s
            &quot;Sync from Shopify&quot; forces that location back to Shopify&apos;s own on-hand
            number, which would re-add the units you carried out and overstate total stock. Load
            everything back in before syncing.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="label-caps text-ink/60">Load into the crate</h2>
        <form action={loadInVariant.bind(null, event.id)} className="max-w-2xl space-y-4">
          <div className="space-y-1">
            <Label htmlFor="variant_id">Item</Label>
            <Select id="variant_id" name="variant_id" required defaultValue="">
              <option value="" disabled>
                Pick an item…
              </option>
              {variantOptions.map((v) => (
                <option key={v.id} value={v.id} disabled={v.available <= 0}>
                  {v.label} — {v.available} available
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="quantity">Quantity</Label>
              <Input id="quantity" name="quantity" type="number" min={1} defaultValue={1} required />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="from_location_id">From</Label>
              <Select
                id="from_location_id"
                name="from_location_id"
                required
                defaultValue={defaultFromLocationId}
              >
                {otherLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.type})
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <Button type="submit">Load in</Button>
        </form>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="label-caps text-ink/60">
            In the crate ({data.totals.inCrate} unit{data.totals.inCrate === 1 ? "" : "s"})
          </h2>
          {loaded.length > 0 && otherLocations.length > 0 && (
            <form action={loadOutEverything.bind(null, event.id, defaultFromLocationId)}>
              <Button variant="secondary" type="submit">
                Return everything to{" "}
                {otherLocations.find((l) => l.id === defaultFromLocationId)?.name ?? "warehouse"}
              </Button>
            </form>
          )}
        </div>

        {!loaded.length ? (
          <p className="text-sm text-ink/50">The crate is empty.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Size</Th>
                  <Th className="text-right">In crate</Th>
                  <Th className="text-right">Sold</Th>
                  <Th>Return</Th>
                </tr>
              </thead>
              <tbody>
                {loaded.map((v) => (
                  <tr key={v.variantId}>
                    <Td className="text-bone">{v.productName}</Td>
                    <Td className="label-caps">{v.size ?? v.sku}</Td>
                    <Td className="text-right font-mono tabular-nums text-bone">{v.inCrate}</Td>
                    <Td className="text-right font-mono tabular-nums text-ink/60">{v.sold}</Td>
                    <Td>
                      <form
                        action={loadOutVariant.bind(null, event.id)}
                        className="flex items-center gap-1.5"
                      >
                        <input type="hidden" name="variant_id" value={v.variantId} />
                        <input
                          type="hidden"
                          name="to_location_id"
                          value={defaultFromLocationId}
                        />
                        <input
                          name="quantity"
                          type="number"
                          min={1}
                          max={v.inCrate}
                          defaultValue={v.inCrate}
                          required
                          className="w-16 rounded-md border border-line bg-surface px-2 py-1 text-sm text-bone outline-none focus:border-ink"
                        />
                        <button
                          type="submit"
                          className="label-caps rounded-md border border-ink/60 px-2 py-1 text-ink hover:border-ink"
                        >
                          Out
                        </button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
