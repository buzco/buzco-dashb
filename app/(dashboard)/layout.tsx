import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/products", label: "Products" },
  { href: "/inventory", label: "Inventory" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="flex w-56 flex-col justify-between border-r border-line p-6">
        <div>
          <p className="label-caps mb-8 text-ink">Buzco Ops</p>
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
