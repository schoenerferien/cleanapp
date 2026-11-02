import { and, asc, count, eq, isNull } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { EmptyState, Field, PageHeader } from "@/components/bits";
import { SubmitButton } from "@/components/client-bits";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { db, schema } from "@/db";
import { createCustomer } from "@/server/actions/masterdata";
import { requireOwner } from "@/server/session";

export default async function CustomersPage() {
  const me = await requireOwner();
  const { customers, sites } = schema;
  const rows = await db
    .select({ id: customers.id, name: customers.name, city: customers.city, contactName: customers.contactName, siteCount: count(sites.id) })
    .from(customers)
    .leftJoin(sites, eq(sites.customerId, customers.id))
    .where(and(eq(customers.tenantId, me.tenantId), isNull(customers.anonymizedAt)))
    .groupBy(customers.id)
    .orderBy(asc(customers.name));
  const siteRegions = await db
    .selectDistinct({ customerId: sites.customerId, region: sites.region })
    .from(sites)
    .where(eq(sites.tenantId, me.tenantId));

  return (
    <>
      <PageHeader title="Kunden & Objekte" description="Kunden mit ihren Objekten, Abrechnungsmodell und Arbeitsanweisungen." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-2">
          {rows.length === 0 && <EmptyState>Noch keine Kunden angelegt.</EmptyState>}
          {rows.map((c) => (
            <Link key={c.id} href={`/kunden/${c.id}`} className="flex items-center gap-3 rounded-xl border bg-background p-4 transition-colors hover:bg-muted/50">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-muted-foreground">
                  {[c.contactName, c.city].filter(Boolean).join(" · ")} · {c.siteCount} {c.siteCount === 1 ? "Objekt" : "Objekte"}
                </p>
              </div>
              <div className="hidden gap-1 sm:flex">
                {siteRegions
                  .filter((r) => r.customerId === c.id && r.region)
                  .map((r) => (
                    <Badge key={r.region} variant="outline">
                      {r.region}
                    </Badge>
                  ))}
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Neuer Kunde</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createCustomer} className="space-y-3">
              <Field label="Name / Firma">
                <Input name="name" required />
              </Field>
              <Field label="Ansprechpartner">
                <Input name="contactName" />
              </Field>
              <Field label="E-Mail">
                <Input name="email" type="email" />
              </Field>
              <Field label="Straße und Nr.">
                <Input name="street" />
              </Field>
              <div className="grid grid-cols-[100px_1fr] gap-2">
                <Field label="PLZ">
                  <Input name="zip" />
                </Field>
                <Field label="Ort">
                  <Input name="city" />
                </Field>
              </div>
              <SubmitButton className="w-full">Kunde anlegen</SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
