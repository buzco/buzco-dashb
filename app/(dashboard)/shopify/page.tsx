import { createClient } from "@/lib/supabase/server";
import { getShopInfo, isShopifyConfigured } from "@/lib/shopify/client";
import { ShopifyMark } from "@/components/ui/shopify-mark";
import { SyncButton } from "./sync-button";
import { OrderSyncButton } from "./order-sync-button";

const REQUIRED_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_orders",
];

export default async function ShopifyPage() {
  const supabase = await createClient();

  // How much of our catalog is already linked to Shopify.
  const [{ count: linkedProducts }, { count: totalProducts }] = await Promise.all([
    supabase.from("products").select("*", { count: "exact", head: true }).not("shopify_product_id", "is", null),
    supabase.from("products").select("*", { count: "exact", head: true }),
  ]);

  let shop: Awaited<ReturnType<typeof getShopInfo>> | null = null;
  let connectionError: string | null = null;
  if (isShopifyConfigured()) {
    try {
      shop = await getShopInfo();
    } catch (e) {
      connectionError = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <div className="max-w-2xl space-y-10">
      <h1 className="label-caps flex items-center gap-2 text-ink/60">
        <ShopifyMark title="Shopify" /> Shopify
      </h1>

      {/* Connection status */}
      <div className="rounded-lg border border-line bg-surface p-6">
        {shop ? (
          <div className="space-y-3">
            <p className="text-bone">
              Connected to <span className="font-bold">{shop.name}</span>
            </p>
            <p className="text-sm text-ink/70">
              {shop.myshopifyDomain} · {shop.currencyCode}
            </p>
            <div className="space-y-1">
              <p className="label-caps text-ink/50">Granted scopes</p>
              <div className="flex flex-wrap gap-1.5">
                {REQUIRED_SCOPES.map((s) => {
                  const has = shop!.scopes.includes(s);
                  return (
                    <span
                      key={s}
                      className={`label-caps rounded-full border px-2 py-0.5 ${
                        has ? "border-status-received text-status-received" : "border-status-cancelled text-status-cancelled"
                      }`}
                    >
                      {has ? "✓" : "✗"} {s}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-bone">Not connected</p>
            <p className="text-sm text-ink/70">
              {connectionError ??
                "Add the Admin API access token (shpat_…) to SHOPIFY_ADMIN_ACCESS_TOKEN in .env.local, then restart the dev server."}
            </p>
          </div>
        )}
      </div>

      {/* Sync */}
      <div className="space-y-3">
        <h2 className="label-caps text-ink/60">Sync catalog</h2>
        <p className="text-sm text-ink/50">
          Pulls products & variants from Shopify into the app, linking each by its
          Shopify ID. This DB stays the source of truth — Shopify is read here, not
          overwritten. Currently {linkedProducts ?? 0} of {totalProducts ?? 0} products are linked.
        </p>
        <SyncButton disabled={!shop} />
      </div>

      {/* Orders */}
      <div className="space-y-3">
        <h2 className="label-caps text-ink/60">Import orders</h2>
        <p className="text-sm text-ink/50">
          Pulls Shopify order history into Sales (revenue), keyed by order so
          re-running never double-counts. Stock isn&apos;t touched here — the
          catalog sync already mirrors Shopify&apos;s on-hand.
        </p>
        <OrderSyncButton disabled={!shop} />
      </div>
    </div>
  );
}
