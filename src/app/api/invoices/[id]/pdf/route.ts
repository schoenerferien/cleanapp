import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { invoicePdf, invoicePdfFilename } from "@/server/invoice-pdf";
import { getCurrentUser, isOwner } from "@/server/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!isOwner(me)) return new Response("Nicht erlaubt", { status: 403 });

  const { invoices } = schema;
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, me.tenantId)));
  if (!inv) return new Response("Nicht gefunden", { status: 404 });

  const pdf = await invoicePdf(inv);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${invoicePdfFilename(inv)}"` },
  });
}
