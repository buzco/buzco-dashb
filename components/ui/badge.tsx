// Literal class names (not template-built) so Tailwind's scanner picks
// every one up — this is the direct translation of the storefront's
// "NEW" / "LAST UNITS" badges into status chips for po_status,
// consignment status, and retailer status.
const STATUS_STYLES: Record<string, string> = {
  draft: "bg-status-draft",
  ordered: "bg-status-ordered",
  partially_received: "bg-status-partially_received",
  received: "bg-status-received",
  cancelled: "bg-status-cancelled",
  active: "bg-status-active",
  settled: "bg-status-settled",
  returned: "bg-status-returned",
  prospect: "bg-status-prospect",
};

export function Badge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-status-draft";

  return (
    <span className={`label-caps inline-block px-2 py-0.5 text-ink ${style}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
