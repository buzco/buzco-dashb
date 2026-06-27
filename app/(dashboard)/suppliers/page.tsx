import { createClient } from "@/lib/supabase/server";
import { createSupplier } from "@/lib/actions/suppliers";
import { Table, Th, Td } from "@/components/ui/table";
import { Label, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default async function SuppliersPage() {
  const supabase = await createClient();
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name, contact_email, notes, created_at")
    .order("name");

  return (
    <div className="space-y-10">
      <h1 className="label-caps text-ink/60">Suppliers</h1>

      {!suppliers?.length ? (
        <p className="text-sm text-ink/50">No suppliers yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id}>
                <Td>{s.name}</Td>
                <Td className="text-ink/70">{s.contact_email ?? "—"}</Td>
                <Td className="text-ink/70">{s.notes ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <div className="max-w-md space-y-3">
        <h2 className="label-caps text-ink/60">Add supplier</h2>
        <form action={createSupplier} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contact_email">Contact email</Label>
            <Input id="contact_email" name="contact_email" type="email" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" />
          </div>
          <Button type="submit">Add supplier</Button>
        </form>
      </div>
    </div>
  );
}
