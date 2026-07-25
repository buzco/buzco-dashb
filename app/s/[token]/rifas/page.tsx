import { assertLinkToken } from "@/lib/market/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { raffleTotalsForEvent } from "@/lib/market/raffle-sales";
import { currentStallEvent, listOpenEvents } from "../stall-data";
import { RaffleQuickAdd } from "./raffle-quick-add";

export default async function StallRafflePage({
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
          Ask André to create or re-open an event in the dashboard, then reload.
        </p>
      </main>
    );
  }

  const totals = await raffleTotalsForEvent(createAdminClient(), event.id);

  return <RaffleQuickAdd token={token} event={event} totals={totals} />;
}
