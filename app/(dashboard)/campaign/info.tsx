"use client";

/**
 * A "?" that explains a term on hover or keyboard focus.
 *
 * `normal-case` and `tracking-normal` are deliberate: most of these sit inside
 * `.label-caps` headings, and inherited uppercase would make the explanation
 * unreadable.
 *
 * Don't put one inside an `overflow-x-auto` container — the panel gets clipped
 * by the scroll box instead of floating over it.
 */
export function Info({ children }: { children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label="What does this mean?"
        className="ml-1 inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-ink/40 text-[0.6rem] leading-none text-ink/60 transition-colors hover:border-ink hover:text-ink focus:outline-none focus-visible:border-ink focus-visible:text-ink"
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-64 -translate-x-1/2 rounded-md border border-line bg-surface p-2.5 text-xs font-normal normal-case leading-relaxed tracking-normal text-ink/80 shadow-xl group-focus-within:block group-hover:block"
      >
        {children}
      </span>
    </span>
  );
}
