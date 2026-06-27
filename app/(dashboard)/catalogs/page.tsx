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
      <h1 className="label-caps text-ink/60">Wholesale catalogs</h1>

      {!catalogs?.length ? (
        <p className="text-sm text-ink/50">No catalogs yet.</p>
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
        <h2 className="label-caps text-ink/60">New catalog</h2>
        <form action={createCatalog} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" placeholder="SS26 Wholesale — Boutiques" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" placeholder="MOQ, terms, lead time…" />
          </div>
          <Button type="submit">Create catalog</Button>
        </form>
      </div>
    </div>
  );
}
