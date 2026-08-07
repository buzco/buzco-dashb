import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";
import { Nav, NavCompact } from "@/components/nav";
import { AutoRefresh } from "@/components/auto-refresh";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    // Column on phones (top bar + content), sidebar from md up. The markets tab
    // gets used one-handed at a stall, so mobile can't lose 224px to nav chrome.
    // Background is translucent so the starfield mosaic shows through.
    <div className="flex min-h-screen flex-1 flex-col bg-paper/50 text-ink md:flex-row">
      {/* Shopify webhooks update the DB; this pulls those updates onto the page
          without anyone hitting reload. */}
      <AutoRefresh />

      {/* Mobile: collapsible top bar. <details> keeps it zero-JS. */}
      <details className="group border-b border-line bg-surface/80 backdrop-blur-sm md:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between p-4">
          <Logo width={96} height={54} className="h-8 w-auto" />
          <span className="label-caps text-ink/70 group-open:hidden">Menu</span>
          <span className="label-caps hidden text-ink/70 group-open:inline">Close</span>
        </summary>
        <NavCompact />
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
          <Nav />
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
