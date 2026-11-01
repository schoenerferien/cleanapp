import { and, desc, eq } from "drizzle-orm";
import { FilePlus2 } from "lucide-react";
import Link from "next/link";
import { AmpelBadge, AmpelBar, EmptyState, PageHeader } from "@/components/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db, schema } from "@/db";
import { monthLabel } from "@/domain/billing";
import { dateDe, euro } from "@/domain/format";
import { kuStatus } from "@/domain/limits";
import { todayBerlin } from "@/domain/time";
import { revenueInYear } from "@/server/queries";
import { requireOwner } from "@/server/session";

const invoiceStatusStyle: Record<string, string> = {
  entwurf: "bg-slate-100 text-slate-700",
  final: "bg-amber-100 text-amber-800",
  bezahlt: "bg-emerald-100 text-emerald-800",
};
const statusLabel: Record<string, string> = { entwurf: "Entwurf", final: "Offen", bezahlt: "Bezahlt" };

export default async function InvoicesPage() {
  const me = await requireOwner();
  const { invoices, customers, tenants } = schema;
  const year = Number(todayBerlin().slice(0, 4));
  const [rows, revenue, [tenant]] = await Promise.all([
    db
      .select({ inv: invoices, customerName: customers.name })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(and(eq(invoices.tenantId, me.tenantId)))
      .orderBy(desc(invoices.createdAt)),
    revenueInYear(me.tenantId, year),
    db.select().from(tenants).where(eq(tenants.id, me.tenantId)),
  ]);
  const ku = kuStatus(revenue, tenant.kuLimitCents);

  return (
    <>
      <PageHeader title="Rechnungen" description={tenant.kleinunternehmer ? "Kleinunternehmerin nach § 19 UStG – Rechnungen ohne Umsatzsteuer." : "Rechnungen mit 19 % Umsatzsteuer."}>
        <Button asChild>
          <Link href="/rechnungen/neu">
            <FilePlus2 /> Neue Rechnung
          </Link>
        </Button>
      </PageHeader>

      {tenant.kleinunternehmer && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Umsatz {year} und Kleinunternehmergrenze</CardTitle>
            <CardDescription>
              Im Gründungsjahr darf der Umsatz {euro(tenant.kuLimitCents)} nicht überschreiten – sonst entfällt die Regelung sofort.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span>
                {euro(revenue)} von {euro(tenant.kuLimitCents)}
              </span>
              <AmpelBadge level={ku.level}>{ku.pct} %</AmpelBadge>
            </div>
            <AmpelBar level={ku.level} pct={ku.pct} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState>Noch keine Rechnungen. Über „Neue Rechnung“ Kunde und Monat wählen.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nummer</TableHead>
                  <TableHead>Kunde</TableHead>
                  <TableHead>Leistungszeitraum</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead className="text-right">Betrag</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ inv, customerName }) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Link href={`/rechnungen/${inv.id}`} className="font-medium hover:underline">
                        {inv.number ?? "Entwurf"}
                      </Link>
                    </TableCell>
                    <TableCell>{customerName}</TableCell>
                    <TableCell>{monthLabel(inv.periodMonth)}</TableCell>
                    <TableCell>{inv.invoiceDate ? dateDe(inv.invoiceDate) : "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">{euro(inv.totalCents)}</TableCell>
                    <TableCell>
                      <Badge className={`border-transparent ${invoiceStatusStyle[inv.status]}`}>{statusLabel[inv.status]}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
