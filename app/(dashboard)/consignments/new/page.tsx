import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createConsignment } from "@/lib/actions/consignments";
import { Label, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export default async function NewConsignmentPage() {
  const supabase = await createClient();
  const { data: retailers } = await supabase
    .from("retailers")
    .select("id, name")
    .order("name");

  return (
    <div className="max-w-md space-y-8">
      <h1 className="label-caps text-ink/60">New consignment</h1>

      {!retailers?.length ? (
        <p className="text-sm text-ink/50">
          No retailers yet — <Link href="/retailers" className="text-ink underline">add one</Link> first.
        </p>
      ) : (
        <form action={createConsignment} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="retailer_id">Retailer</Label>
            <Select id="retailer_id" name="retailer_id" required defaultValue="">
              <option value="" disabled>
                Pick a retailer…
              </option>
              {retailers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sent_date">Sent date</Label>
            <Input id="sent_date" name="sent_date" type="date" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" />
          </div>
          <Button type="submit">Create consignment</Button>
        </form>
      )}
    </div>
  );
}
