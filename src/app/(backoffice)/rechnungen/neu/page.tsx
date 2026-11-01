import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { EmptyState, Field, PageHeader, selectClass } from "@/components/bits";
import { SubmitButton } from "@/components/client-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db, schema } from "@/db";
import { KU_HINWEIS, monthLabel } from "@/domain/billing";
import { billingModelLabel, decimal2, euro } from "@/domain/format";
import { monthOf, todayBerlin } from "@/domain/time";
import { createDraftInvoice } from "@/server/actions/invoices";
import { computeInvoice } from "@/server/billing-data";
import { requireOwner } from "@/server/session";

function previousMonth(): string {
  const [y, m] = monthOf(todayBerlin()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ kunde?: string; m?: string }> }) {
  const sp = await searchParams;
  const me = await requireOwner();
  const [customers, [tenant]] = await Promise.all([
    db.select().from(schema.customers).where(eq(schema.customers.tenantId, me.tenantId)).orderBy(asc(schema.customers.name)),
    db.select().from(schema.tenants).where(eq(schema.tenants.id, me.tenantId)),
  ]);
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : previousMonth();
  const customer = customers.find((c) => c.id === sp.kunde);
  const preview = customer ? await computeInvoice(me.tenantId, customer.id, month, tenant.kleinunternehmer) : null;

  return (
    <>
      <PageHeader title="Neue Rechnung" description="Positionen entstehen aus abgenommenen, noch nicht berechneten Einsätzen des Monats.">
        <Button variant="outline" asChild>
          <Link href="/rechnungen">Zurück</Link>
        </Button>
      </PageHeader>

      <Card className="mb-6">
        <CardContent>
          <form action="/rechnungen/neu" className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
            <Field label="Kunde">
              <select name="kunde" defaultValue={customer?.id ?? ""} className={selectClass} required>
                <option value="" disabled>
                  Bitte wählen
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Leistungsmonat">
              <Input type="month" name="m" defaultValue={month} required />
            </Field>
            <Button type="submit" variant="secondary">
              Vorschau
            </Button>
          </form>
        </CardContent>
      </Card>

      {preview && customer && (
        <Card>
          <CardHeader>
            <CardTitle>
              Vorschau: {customer.name} · {monthLabel(month)}
            </CardTitle>
            <CardDescription>
              {preview.sites.map((s) => `${s.name}: ${billingModelLabel[s.billingModel]} ${euro(s.rateCents)}`).join(" · ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.lines.length === 0 ? (
              <EmptyState>
                Nichts abzurechnen. Einsätze müssen <strong>abgenommen</strong> und dürfen noch nicht berechnet sein.
              </EmptyState>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Beschreibung</TableHead>
                      <TableHead className="text-right">Menge</TableHead>
                      <TableHead className="text-right">Einzelpreis</TableHead>
                      <TableHead className="text-right">Betrag</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.lines.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>{l.description}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {decimal2(l.quantity)} {l.unit}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{euro(l.unitPriceCents)}</TableCell>
                        <TableCell className="text-right tabular-nums">{euro(l.totalCents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    {!tenant.kleinunternehmer && (
                      <>
                        <TableRow>
                          <TableCell colSpan={3}>Netto</TableCell>
                          <TableCell className="text-right">{euro(preview.netCents)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={3}>USt 19 %</TableCell>
                          <TableCell className="text-right">{euro(preview.vatCents)}</TableCell>
                        </TableRow>
                      </>
                    )}
                    <TableRow>
                      <TableCell colSpan={3} className="font-semibold">
                        Gesamt
                      </TableCell>
                      <TableCell className="text-right font-semibold">{euro(preview.totalCents)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
                {tenant.kleinunternehmer && <p className="text-sm text-muted-foreground">{KU_HINWEIS}</p>}
                <form action={createDraftInvoice.bind(null, customer.id, month)}>
                  <SubmitButton pendingText="Erstelle …">Entwurf erstellen ({preview.jobIds.length} Einsätze)</SubmitButton>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
