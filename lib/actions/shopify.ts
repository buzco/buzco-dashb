"use server";

import { revalidatePath } from "next/cache";
import { syncFromShopify, type SyncResult } from "@/lib/shopify/sync";
import { isShopifyConfigured } from "@/lib/shopify/client";

export type ShopifySyncState = { result?: SyncResult; error?: string };

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
