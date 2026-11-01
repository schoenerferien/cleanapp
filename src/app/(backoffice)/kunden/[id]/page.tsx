import { and, asc, eq } from "drizzle-orm";
import { MapPin, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, Field, PageHeader } from "@/components/bits";
import { SubmitButton } from "@/components/client-bits";
import { SiteForm } from "@/components/site-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { db, schema } from "@/db";
import { billingModelLabel, euro } from "@/domain/format";
import { createSite, updateCustomer } from "@/server/actions/masterdata";
import { requireOwner } from "@/server/session";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireOwner();
  const [c] = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.id, id), eq(schema.customers.tenantId, me.tenantId)));
  if (!c) notFound();
  const sites = await db.select().from(schema.sites).where(eq(schema.sites.customerId, id)).orderBy(asc(schema.sites.name));

  return (
    <>
      <PageHeader title={c.name} description={[c.contactName, c.email].filter(Boolean).join(" · ")}>
        <Button variant="outline" asChild>
          <Link href="/kunden">Zurück</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Objekte</h2>
          {sites.length === 0 && <EmptyState>Noch keine Objekte – unten anlegen.</EmptyState>}
          {sites.map((s) => (
            <Card key={s.id}>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="size-3.5" />
                      {[s.street, [s.zip, s.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
                      {s.lat == null && <span className="text-amber-600"> · keine Koordinaten</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{s.region}</Badge>
                    <Badge variant="secondary">
                      {billingModelLabel[s.billingModel]}: {euro(s.rateCents)}
                    </Badge>
                    <Button size="icon-sm" variant="ghost" asChild>
                      <Link href={`/kunden/objekt/${s.id}`} aria-label="Objekt bearbeiten">
                        <Pencil />
                      </Link>
                    </Button>
                  </div>
                </div>
                {s.instructions && <p className="text-sm">{s.instructions}</p>}
                {s.checklist.length > 0 && <p className="text-xs text-muted-foreground">Checkliste: {s.checklist.join(" · ")}</p>}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle>Neues Objekt</CardTitle>
            </CardHeader>
            <CardContent>
              <SiteForm action={createSite.bind(null, c.id)} submitLabel="Objekt anlegen" />
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Kundendaten</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateCustomer.bind(null, c.id)} className="space-y-3">
              <Field label="Name / Firma">
                <Input name="name" defaultValue={c.name} required />
              </Field>
              <Field label="Ansprechpartner">
                <Input name="contactName" defaultValue={c.contactName ?? ""} />
              </Field>
              <Field label="E-Mail">
                <Input name="email" type="email" defaultValue={c.email ?? ""} />
              </Field>
              <Field label="Telefon">
                <Input name="phone" defaultValue={c.phone ?? ""} />
              </Field>
              <Field label="Straße und Nr.">
                <Input name="street" defaultValue={c.street ?? ""} />
              </Field>
              <div className="grid grid-cols-[100px_1fr] gap-2">
                <Field label="PLZ">
                  <Input name="zip" defaultValue={c.zip ?? ""} />
                </Field>
                <Field label="Ort">
                  <Input name="city" defaultValue={c.city ?? ""} />
                </Field>
              </div>
              <SubmitButton className="w-full">Speichern</SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
