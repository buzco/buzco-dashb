"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The dashboard is grouped into departments so each tab's job is obvious from
// where it sits — "Line sheets" only reads as a wholesale thing under the B2B
// header. Purchase Orders and Suppliers are deliberately absent: the routes
// still resolve if you type them, they're just off the nav for now.

export type NavItem = { href: string; label: string };
export type Department = { name: string; items: NavItem[] };

export const HOME: NavItem = { href: "/", label: "Home" };

export const DEPARTMENTS: Department[] = [
  {
    // Everything that moves stock to an actual person, one piece at a time.
    name: "Retail",
    items: [
      { href: "/products", label: "Products" },
      { href: "/sales", label: "Sales" },
      { href: "/markets", label: "Markets" },
    ],
  },
  {
    // Selling to shops rather than people: the offer, who gets it, what's out.
    name: "Wholesale · B2B",
    items: [
      { href: "/catalogs", label: "Line sheets" },
      { href: "/retailers", label: "Retailers" },
      { href: "/consignments", label: "Consignments" },
    ],
  },
  {
    // Every page whose output is a number in euros.
    name: "Money",
    items: [
      { href: "/finance", label: "Finance" },
      { href: "/expenses", label: "Expenses" },
      { href: "/campaign", label: "Ad budget" },
    ],
  },
  {
    name: "System",
    items: [{ href: "/shopify", label: "Shopify" }],
  },
];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function itemClass(active: boolean) {
  return `label-caps block rounded-md px-2 py-1.5 transition-colors ${
    active ? "bg-ink/15 text-ink" : "text-ink/70 hover:bg-ink/10 hover:text-ink"
  }`;
}

/** Sidebar nav (md and up): department headers stacked down the rail. */
export function Nav() {
  const isActive = useIsActive();

  return (
    <nav className="space-y-5">
      <Link href={HOME.href} className={itemClass(isActive(HOME.href))}>
        {HOME.label}
      </Link>

      {DEPARTMENTS.map((dept) => (
        <div key={dept.name} className="space-y-0.5">
          <p className="label-caps px-2 pb-1 text-[0.65rem] text-ink/35">{dept.name}</p>
          {dept.items.map((item) => (
            <Link key={item.href} href={item.href} className={itemClass(isActive(item.href))}>
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * Mobile nav. Same departments, but each one is a row of chips — the markets
 * tab gets used one-handed at a stall, so this can't turn into a long scroll.
 */
export function NavCompact() {
  const isActive = useIsActive();

  return (
    <nav className="space-y-3 px-4 pb-4">
      <Link href={HOME.href} className={itemClass(isActive(HOME.href))}>
        {HOME.label}
      </Link>

      {DEPARTMENTS.map((dept) => (
        <div key={dept.name}>
          <p className="label-caps px-2 pb-1 text-[0.65rem] text-ink/35">{dept.name}</p>
          <div className="grid grid-cols-2 gap-1">
            {dept.items.map((item) => (
              <Link key={item.href} href={item.href} className={itemClass(isActive(item.href))}>
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
