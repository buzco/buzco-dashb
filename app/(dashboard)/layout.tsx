import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/products", label: "Catalog" },
  { href: "/markets", label: "Markets" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/sales", label: "Sales" },
  { href: "/consignments", label: "Consignments" },
  { href: "/catalogs", label: "Catalogs" },
  { href: "/finance", label: "Finance" },
  { href: "/expenses", label: "Expenses" },
  { href: "/campaign", label: "Campaign" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/retailers", label: "Retailers" },
  { href: "/shopify", label: "Shopify" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    // Column on phones (top bar + content), sidebar from md up. The markets tab
    // gets used one-handed at a stall, so mobile can't lose 224px to nav chrome.
    <div className="flex min-h-screen flex-1 flex-col bg-paper text-ink md:flex-row">
      {/* Mobile: collapsible top bar. <details> keeps it zero-JS. */}
      <details className="group border-b border-line bg-surface/80 backdrop-blur-sm md:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between p-4">
          <Logo width={96} height={54} className="h-8 w-auto" />
          <span className="label-caps text-ink/70 group-open:hidden">Menu</span>
          <span className="label-caps hidden text-ink/70 group-open:inline">Close</span>
        </summary>
        <nav className="grid grid-cols-2 gap-1 px-4 pb-4">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="label-caps rounded-md px-2 py-2 text-ink/70 hover:bg-ink/10 hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
          <ThemeToggle />
          <p className="truncate text-xs text-ink/50">{user?.email}</p>
          <form action={signOut}>
            <button type="submit" className="label-caps text-ink/70 hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </details>

      <aside className="hidden w-56 flex-col justify-between border-r border-line bg-surface/80 p-6 backdrop-blur-sm md:flex">
        <div>
          <div className="mb-8">
            <Logo width={176} height={99} className="h-auto w-full" />
            <p className="label-caps mt-1 text-center text-ink/50">Ops</p>
          </div>
          <nav className="space-y-0.5">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="label-caps block rounded-md px-2 py-1.5 text-ink/70 transition-colors hover:bg-ink/10 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="space-y-3">
          <ThemeToggle />
          <p className="truncate text-xs text-ink/50">{user?.email}</p>
          <form action={signOut}>
            <button type="submit" className="label-caps text-ink/70 hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
