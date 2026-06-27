"use server";

import { revalidatePath } from "next/cache";
import { syncFromShopify, type SyncResult } from "@/lib/shopify/sync";
import { syncShopifyOrders, type OrderSyncResult } from "@/lib/shopify/orders";
import { isShopifyConfigured } from "@/lib/shopify/client";

export type ShopifySyncState = { result?: SyncResult; error?: string };
export type OrderSyncState = { result?: OrderSyncResult; error?: string };

export async function runShopifySync(): Promise<ShopifySyncState> {
  if (!isShopifyConfigured()) {
    return { error: "Shopify is not connected — add SHOPIFY_ADMIN_ACCESS_TOKEN to .env.local" };
  }

  try {
    const result = await syncFromShopify();
    revalidatePath("/shopify");
    revalidatePath("/products");
    revalidatePath("/inventory");
    revalidatePath("/");
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runShopifyOrderSync(): Promise<OrderSyncState> {
  if (!isShopifyConfigured()) {
    return { error: "Shopify is not connected — add SHOPIFY_ADMIN_ACCESS_TOKEN to .env.local" };
  }

  try {
    const result = await syncShopifyOrders();
    revalidatePath("/shopify");
    revalidatePath("/sales");
    revalidatePath("/finance");
    revalidatePath("/");
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
