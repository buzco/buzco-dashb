import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/products", label: "Products" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/inventory", label: "Inventory" },
  { href: "/sales", label: "Sales" },
  { href: "/consignments", label: "Consignments" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/retailers", label: "Retailers" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="flex w-56 flex-col justify-between border-r border-line p-6">
        <div>
          <div className="mb-8">
            <p className="text-2xl font-bold leading-none text-ink">Buzco</p>
            <p className="label-caps mt-1 text-ink/50">Ops</p>
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
