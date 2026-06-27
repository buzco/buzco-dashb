import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/products", label: "Products" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/inventory", label: "Inventory" },
  { href: "/sales", label: "Sales" },
  { href: "/consignments", label: "Consignments" },
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
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col justify-between border-r border-line bg-black/50 p-6 backdrop-blur-sm">
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
          <nav className="space-y-3">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="label-caps block text-ink/70 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="space-y-3">
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
