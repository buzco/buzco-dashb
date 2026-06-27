// Small shopping-bag glyph used to flag rows that are linked to Shopify.
// Rendered in brand green; `title` gives a hover tooltip + a11y label.
export function ShopifyMark({
  className = "",
  title = "Synced with Shopify",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={title}
      className={`inline-block h-4 w-4 text-ink ${className}`}
      fill="currentColor"
    >
      <title>{title}</title>
      <path d="M16 6V5a4 4 0 0 0-8 0v1H4.8a1 1 0 0 0-1 .9l-1 13A1.8 1.8 0 0 0 4.6 22h14.8a1.8 1.8 0 0 0 1.8-2.1l-1-13a1 1 0 0 0-1-.9H16Zm-6-1a2 2 0 0 1 4 0v1h-4V5Zm-1 4a3 3 0 0 0 6 0" stroke="none" />
    </svg>
  );
}
