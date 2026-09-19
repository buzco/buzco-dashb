import "server-only";

import { shopifyGraphQL } from "@/lib/shopify/client";

// Writing stock back to Shopify.
//
// This is the first write-back in the app: until now Shopify inventory was read
// and mirrored, never set. It exists because editing the mirrored number alone
// would be a lie — lib/shopify/sync.ts reconciles that location to Shopify's
// count on every sync and webhook, so a local-only correction is silently undone
// minutes later.
//
// Scope note: the app is NOT granted `read_locations`, which is why
// lib/shopify/sync.ts reads the `inventoryQuantity` scalar instead of inventory
// levels. Location *ids* turn out to be readable without it — only `name` is
// gated — and an id is all `inventorySetQuantities` needs. So this works with
// the scopes already granted; asking for a location's name would not.

const LOCATION_QUERY = `
  query InventoryLocation {
    locations(first: 1) {
      edges { node { id } }
    }
  }
`;

const INVENTORY_ITEM_QUERY = `
  query InventoryItemForVariant($id: ID!) {
    productVariant(id: $id) {
      id
      inventoryQuantity
      inventoryItem { id }
    }
  }
`;

const INVENTORY_SET = `
  mutation SetInventory($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { createdAt reason }
      userErrors { field message }
    }
  }
`;

// The store has a single location and it never changes, so it is worth exactly
// one lookup per server lifetime rather than one per edit.
let cachedLocationId: string | null = null;

async function primaryLocationId(): Promise<string> {
  if (cachedLocationId) return cachedLocationId;
  const data = await shopifyGraphQL<{
    locations: { edges: Array<{ node: { id: string } }> };
  }>(LOCATION_QUERY);
  const id = data.locations?.edges?.[0]?.node?.id;
  if (!id) throw new Error("Shopify returned no inventory location");
  cachedLocationId = id;
  return id;
}

export type ShopifyStockResult = {
  /** What Shopify held before the write — worth reporting when it surprises. */
  previousQuantity: number | null;
};

/**
 * Set a variant's on-hand quantity in Shopify to `quantity`.
 *
 * `ignoreCompareQuantity` is true because this is a human saying "there are
 * actually nine of these in the box". A compare-and-set would reject the
 * correction whenever a sale landed between opening the popup and pressing
 * save, which is precisely when someone is most likely to be fixing the count.
 */
export async function setShopifyStock(
  shopifyVariantGid: string,
  quantity: number,
): Promise<ShopifyStockResult> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error("Stock must be a whole number, zero or more");
  }

  const [locationId, variant] = await Promise.all([
    primaryLocationId(),
    shopifyGraphQL<{
      productVariant: {
        id: string;
        inventoryQuantity: number | null;
        inventoryItem: { id: string } | null;
      } | null;
    }>(INVENTORY_ITEM_QUERY, { id: shopifyVariantGid }),
  ]);

  const inventoryItemId = variant.productVariant?.inventoryItem?.id;
  if (!inventoryItemId) {
    throw new Error("That variant has no inventory item in Shopify");
  }

  const data = await shopifyGraphQL<{
    inventorySetQuantities: {
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(INVENTORY_SET, {
    input: {
      name: "available",
      reason: "correction",
      ignoreCompareQuantity: true,
      quantities: [{ inventoryItemId, locationId, quantity }],
    },
  });

  const errors = data.inventorySetQuantities?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`Shopify refused the stock change: ${errors.map((e) => e.message).join("; ")}`);
  }

  return { previousQuantity: variant.productVariant?.inventoryQuantity ?? null };
}
