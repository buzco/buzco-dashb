// Outlined pill badges — the storefront uses fully-rounded (4rem) badges with
// a colored border + matching text on a dark fill. Literal class names (not
// template-built) so Tailwind's scanner picks every one up. Maps po_status,
// consignment status, and retailer status to a brand-ish color.
const BORDER_STYLES: Record<string, string> = {
  draft: "border-status-draft",
  ordered: "border-status-ordered",
  partially_received: "border-status-partially_received",
  received: "border-status-received",
  cancelled: "border-status-cancelled",
  active: "border-status-active",
  settled: "border-status-settled",
  returned: "border-status-returned",
  prospect: "border-status-prospect",
};

const TEXT_STYLES: Record<string, string> = {
  draft: "text-status-draft",
  ordered: "text-status-ordered",
  partially_received: "text-status-partially_received",
  received: "text-status-received",
  cancelled: "text-status-cancelled",
  active: "text-status-active",
  settled: "text-status-settled",
  returned: "text-status-returned",
  prospect: "text-status-prospect",
};

export function Badge({ status }: { status: string }) {
  const border = BORDER_STYLES[status] ?? "border-status-draft";
  const text = TEXT_STYLES[status] ?? "text-status-draft";

  return (
    <span
      className={`label-caps inline-block rounded-full border bg-black px-2.5 py-0.5 ${border} ${text}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
