import { assertLinkToken } from "@/lib/market/link";
import { getPaymentMethodOptions } from "@/lib/notion/sales";
import { isNotionConfigured } from "@/lib/notion/client";
import { currentStallEvent, listOpenEvents, loadStallCatalog } from "../stall-data";
import { StallPos } from "./stall-pos";

// The DIY POS link: one screen, no login, no nav. A helper opens it and can
// only do one thing — record a sale into the current market event.

export default async function StallPosPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ event?: string }>;
}) {
  const { token } = await params;
  assertLinkToken(token);

  const { event: eventParam } = await searchParams;
  const openEvents = await listOpenEvents();
  const event = eventParam
    ? (openEvents.find((e) => e.id === eventParam) ?? null)
    : await currentStallEvent();

  if (!event) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-bold text-bone">No open market</h1>
        <p className="mt-2 text-sm text-ink/60">
          Nobody has an event running. Ask André to create one (or re-open it) in the dashboard,
          then reload this page.
        </p>
      </main>
    );
  }

  const [products, paymentMethods] = await Promise.all([
    loadStallCatalog(event.id),
    isNotionConfigured() ? getPaymentMethodOptions() : Promise.resolve([]),
  ]);

  return (
    <StallPos
      token={token}
      event={event}
      otherEvents={openEvents.filter((e) => e.id !== event.id)}
      products={products}
      paymentMethods={paymentMethods}
    />
  );
}
