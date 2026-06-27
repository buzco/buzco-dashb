import { createClient } from "@/lib/supabase/server";
import { createRetailer } from "@/lib/actions/retailers";
import { Badge } from "@/components/ui/badge";
import { Table, Th, Td } from "@/components/ui/table";
import { Label, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export default async function RetailersPage() {
  const supabase = await createClient();
  const { data: retailers } = await supabase
    .from("retailers")
    .select("id, name, contact_email, kind, location, status")
    .order("name");

  return (
    <div className="space-y-10">
      <h1 className="label-caps text-ink/60">Retailers</h1>

      {!retailers?.length ? (
        <p className="text-sm text-ink/50">No retailers yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Kind</Th>
              <Th>Location</Th>
              <Th>Status</Th>
              <Th>Email</Th>
            </tr>
          </thead>
          <tbody>
            {retailers.map((r) => (
              <tr key={r.id}>
                <Td className="text-bone">{r.name}</Td>
                <Td className="text-ink/70">{r.kind ?? "—"}</Td>
                <Td className="text-ink/70">{r.location ?? "—"}</Td>
                <Td>{r.status ? <Badge status={r.status} /> : "—"}</Td>
                <Td className="text-ink/70">{r.contact_email ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <div className="max-w-md space-y-3">
        <h2 className="label-caps text-ink/60">Add retailer</h2>
        <form action={createRetailer} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="kind">Kind</Label>
              <Input id="kind" name="kind" placeholder="boutique / wholesaler / buyer" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue="prospect">
                <option value="prospect">prospect</option>
                <option value="active">active</option>
                <option value="settled">settled</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="location">Location</Label>
              <Input id="location" name="location" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="contact_email">Contact email</Label>
              <Input id="contact_email" name="contact_email" type="email" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" />
          </div>
          <Button type="submit">Add retailer</Button>
        </form>
      </div>
    </div>
  );
}
