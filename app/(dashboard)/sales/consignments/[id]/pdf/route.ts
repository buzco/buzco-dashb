import { loadSaleOrder } from "@/lib/sales/data";
import { buildConsignmentNote, consignmentNoteFilename } from "@/lib/pdf/consignment-note";

// The consignation note as a real PDF file, so it can be emailed or printed
// without anyone having to screenshot a web page.
//
// `inline` rather than `attachment`: a phone opens it in the viewer, where both
// "share" and "save" are one tap away, and a desktop browser still downloads it
// from the same menu. The filename is set either way.
//
// It sits under (dashboard) deliberately — the same auth proxy that guards the
// pages guards this route, so an order sheet isn't quietly public.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const order = await loadSaleOrder(id);
  if (!order) return new Response("Order not found", { status: 404 });
  if (order.kind !== "consignment") {
    return new Response("That order isn't a consignation", { status: 400 });
  }

  const pdf = buildConsignmentNote(order);

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${consignmentNoteFilename(order)}"`,
      // Regenerated on every request: settling an order or returning a line
      // changes what the sheet should say.
      "Cache-Control": "no-store",
    },
  });
}
