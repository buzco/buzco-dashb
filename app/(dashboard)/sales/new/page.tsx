import { loadSaleCatalog } from "@/lib/sales/catalog";
import { loadCustomers, loadPriceLists } from "@/lib/sales/data";
import { getSalesOptions, payableOptions } from "@/lib/notion/options";
import { isNotionConfigured } from "@/lib/notion/client";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { SaleWizard } from "./sale-wizard";

// Everything the till needs is fetched here, in parallel, so the wizard is pure
// client state once it is on screen — at a market the network is the slowest
// part of the machine and no tap should have to wait on it.

export default async function NewSalePage() {
  const notionConfigured = isNotionConfigured();

  const [products, customers, priceLists, options] = await Promise.all([
    loadSaleCatalog(),
    loadCustomers(),
    loadPriceLists(),
    getSalesOptions(),
  ]);

  return (
    <SaleWizard
      products={products}
      customers={customers}
      priceLists={priceLists}
      whereOptions={options.where}
      paymentOptions={payableOptions(options.payment)}
      optionsAreLive={options.live && notionConfigured}
      notionConfigured={notionConfigured}
      shopifyConfigured={isShopifyConfigured()}
    />
  );
}
