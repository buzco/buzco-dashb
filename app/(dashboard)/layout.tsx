import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/products", label: "Catalog" },
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
    <div className="flex min-h-screen flex-1 bg-paper text-ink">
      <aside className="flex w-56 flex-col justify-between border-r border-line bg-surface/80 p-6 backdrop-blur-sm">
        <div>
          <div className="mb-8">
            <Image
              src="/buzco-logo.gif"
              alt="Buzco"
              width={176}
              height={99}
              priority
              unoptimized
              className="h-auto w-full"
            />
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
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
