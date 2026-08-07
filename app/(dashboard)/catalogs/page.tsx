import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createCatalog } from "@/lib/actions/catalogs";
import { Table, Th, Td } from "@/components/ui/table";
import { Label, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default async function CatalogsPage() {
  const supabase = await createClient();
  const { data: catalogs } = await supabase
    .from("catalogs")
    .select("id, name, notes, created_at")
    .order("created_at", { ascending: false });

  const ids = (catalogs ?? []).map((c) => c.id);
  const { data: items } = ids.length
    ? await supabase.from("catalog_items").select("catalog_id").in("catalog_id", ids)
    : { data: [] };
  const counts = new Map<string, number>();
  for (const it of items ?? []) counts.set(it.catalog_id, (counts.get(it.catalog_id) ?? 0) + 1);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="label-caps text-ink/60">Line sheets</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink/50">
          A line sheet is the priced selection you send a shop or boutique — pick the
          pieces, set wholesale prices as a % of RRP, then draft the outreach email.
          This is the B2B side; it never touches storefront pricing.
        </p>
      </div>

      {!catalogs?.length ? (
        <p className="text-sm text-ink/50">No line sheets yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th className="text-right">Items</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {catalogs.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link href={`/catalogs/${c.id}`} className="text-bone underline-offset-2 hover:underline">
                    {c.name}
                  </Link>
                </Td>
                <Td className="text-right font-mono tabular-nums">{counts.get(c.id) ?? 0}</Td>
                <Td className="text-ink/70">{c.notes ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <div className="max-w-md space-y-3">
        <h2 className="label-caps text-ink/60">New line sheet</h2>
        <form action={createCatalog} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" placeholder="SS26 Wholesale — Boutiques" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" placeholder="MOQ, terms, lead time…" />
          </div>
          <Button type="submit">Create line sheet</Button>
        </form>
      </div>
    </div>
  );
}
