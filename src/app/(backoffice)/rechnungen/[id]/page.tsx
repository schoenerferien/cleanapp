import { and, asc, eq, type SQL } from "drizzle-orm";
import { Ban, CheckCircle2, FileDown, Lock, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, selectClass } from "@/components/bits";
import { ConfirmForm, SubmitButton } from "@/components/client-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { db, schema } from "@/db";
import { canCancel, KU_HINWEIS, monthLabel } from "@/domain/billing";
import { dateDe, dateTimeDe, decimal2, euro } from "@/domain/format";
import { addDraftLine, cancelInvoice, deleteDraft, deleteDraftLine, finalizeInvoice, markPaid, updateDraftLine } from "@/server/actions/invoices";
import { centsToInput } from "@/server/form";
import { requireOwner } from "@/server/session";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireOwner();
  const { invoices, invoiceLines, customers, jobs, sites } = schema;
  const [row] = await db
    .select({ inv: invoices, customerName: customers.name })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, me.tenantId)));
  if (!row) notFound();
  const { inv } = row;
  const [lines, billedJobs, [cancels], [cancelledBy]] = await Promise.all([
    db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position)),
    db
      .select({ id: jobs.id, date: jobs.date, title: jobs.title, siteName: sites.name })
      .from(jobs)
      .innerJoin(sites, eq(sites.id, jobs.siteId))
      .where(eq(jobs.invoiceId, id))
      .orderBy(asc(jobs.date)),
    inv.cancelsInvoiceId ? relatedInvoice(eq(invoices.id, inv.cancelsInvoiceId)) : [],
    inv.status === "storniert" ? relatedInvoice(eq(invoices.cancelsInvoiceId, inv.id)) : [],
  ]);
  const draft = inv.status === "entwurf";
  const storno = inv.kind === "storno";
  const title = storno ? "Stornorechnung" : "Rechnung";

  return (
    <>
      <PageHeader title={inv.number ? `${title} ${inv.number}` : "Rechnungsentwurf"} description={`${row.customerName} · Leistungszeitraum ${monthLabel(inv.periodMonth)}`}>
        <Button variant="outline" asChild>
          <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer">
            <FileDown /> {draft ? "PDF-Vorschau" : "PDF"}
          </a>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/rechnungen">Zurück</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Positionen</CardTitle>
            {draft && <CardDescription>Im Entwurf können Positionen angepasst, gelöscht oder ergänzt werden.</CardDescription>}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">Pos.</TableHead>
                  <TableHead>Beschreibung</TableHead>
                  <TableHead className="w-28 text-right">Menge</TableHead>
                  <TableHead className="w-28 text-right">Einzelpreis</TableHead>
                  <TableHead className="w-28 text-right">Betrag</TableHead>
                  {draft && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) =>
                  draft ? (
                    <TableRow key={l.id}>
                      <TableCell>{l.position}</TableCell>
                      <TableCell colSpan={3} className="p-1">
                        <form id={`line-${l.id}`} action={updateDraftLine.bind(null, l.id)} className="grid grid-cols-[1fr_7rem_7rem] gap-1">
                          <Input name="description" defaultValue={l.description} />
                          <Input name="quantity" inputMode="decimal" defaultValue={decimal2(l.quantity)} className="text-right" title={l.unit} />
                          <Input name="unitPrice" inputMode="decimal" defaultValue={centsToInput(l.unitPriceCents)} className="text-right" />
                        </form>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{euro(l.totalCents)}</TableCell>
                      <TableCell className="flex gap-1">
                        <Button form={`line-${l.id}`} type="submit" size="xs" variant="secondary">
                          OK
                        </Button>
                        <form action={deleteDraftLine.bind(null, l.id)}>
                          <Button type="submit" size="icon-xs" variant="ghost" aria-label="Position löschen">
                            <Trash2 />
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={l.id}>
                      <TableCell>{l.position}</TableCell>
                      <TableCell>{l.description}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {decimal2(l.quantity)} {l.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{euro(l.unitPriceCents)}</TableCell>
                      <TableCell className="text-right tabular-nums">{euro(l.totalCents)}</TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>

            <div className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
              {!inv.kleinunternehmer && (
                <>
                  <div className="flex justify-between">
                    <span>Netto</span>
                    <span className="tabular-nums">{euro(inv.netCents)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>USt 19 %</span>
                    <span className="tabular-nums">{euro(inv.vatCents)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between border-t pt-1 text-base font-semibold">
                <span>Gesamt</span>
                <span className="tabular-nums">{euro(inv.totalCents)}</span>
              </div>
              {inv.kleinunternehmer && <p className="text-xs text-muted-foreground">{KU_HINWEIS}</p>}
            </div>

            {draft && (
              <form action={addDraftLine.bind(null, inv.id)} className="mt-6 grid gap-2 border-t pt-4 sm:grid-cols-[1fr_6rem_7rem_7rem_auto]">
                <Input name="description" placeholder="Zusätzliche Position, z. B. Sonderreinigung Fenster" required />
                <Input name="quantity" inputMode="decimal" defaultValue="1" className="text-right" />
                <select name="unit" className={selectClass} defaultValue="Pauschal">
                  <option>Pauschal</option>
                  <option>Std</option>
                  <option>Einsatz</option>
                </select>
                <Input name="unitPrice" inputMode="decimal" placeholder="Preis €" className="text-right" required />
                <SubmitButton variant="secondary">
                  <Plus /> Hinzufügen
                </SubmitButton>
              </form>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {draft ? "Entwurf" : <><Lock className="size-4" /> Finalisiert</>}
                {inv.status === "bezahlt" && <Badge className="border-transparent bg-emerald-100 text-emerald-800">bezahlt</Badge>}
                {inv.status === "storniert" && <Badge className="border-transparent bg-red-100 text-red-800">storniert</Badge>}
              </CardTitle>
              <CardDescription>
                {draft
                  ? "Beim Finalisieren wird die fortlaufende Rechnungsnummer vergeben. Danach ist die Rechnung unveränderbar."
                  : `Nr. ${inv.number} vom ${dateDe(inv.invoiceDate!)} · finalisiert ${dateTimeDe(inv.finalizedAt)}${inv.paidAt ? ` · bezahlt ${dateTimeDe(inv.paidAt)}` : ""}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {cancels && (
                <p className="text-sm">
                  Storniert die Rechnung{" "}
                  <Link href={`/rechnungen/${cancels.id}`} className="font-medium underline">
                    {cancels.number}
                  </Link>{" "}
                  vom {dateDe(cancels.invoiceDate!)}.
                </p>
              )}
              {cancelledBy && (
                <p className="text-sm">
                  Storniert durch die Stornorechnung{" "}
                  <Link href={`/rechnungen/${cancelledBy.id}`} className="font-medium underline">
                    {cancelledBy.number}
                  </Link>{" "}
                  vom {dateDe(cancelledBy.invoiceDate!)}. Diese Rechnung bleibt unverändert erhalten.
                </p>
              )}
              {draft ? (
                <>
                  <ConfirmForm action={finalizeInvoice.bind(null, inv.id)} message="Rechnung jetzt finalisieren? Danach sind keine Änderungen mehr möglich.">
                    <SubmitButton className="w-full" pendingText="Finalisiere …">
                      <Lock /> Finalisieren
                    </SubmitButton>
                  </ConfirmForm>
                  <ConfirmForm action={deleteDraft.bind(null, inv.id)} message="Entwurf löschen? Die Einsätze werden wieder freigegeben.">
                    <SubmitButton variant="ghost" className="w-full" pendingText="Lösche …">
                      <Trash2 /> Entwurf löschen
                    </SubmitButton>
                  </ConfirmForm>
                </>
              ) : (
                inv.status === "final" &&
                !storno && (
                  <form action={markPaid.bind(null, inv.id)}>
                    <SubmitButton variant="secondary" className="w-full">
                      <CheckCircle2 /> Als bezahlt markieren
                    </SubmitButton>
                  </form>
                )
              )}
            </CardContent>
          </Card>

          {canCancel(inv) && (
            <Card>
              <CardHeader>
                <CardTitle>Korrigieren</CardTitle>
                <CardDescription>
                  Eine ausgestellte Rechnung wird nicht geändert, sondern storniert: Es entsteht eine Stornorechnung mit eigener Nummer und negativen
                  Beträgen. Die Einsätze werden wieder frei.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ConfirmForm
                  action={cancelInvoice.bind(null, inv.id)}
                  message={`Rechnung ${inv.number} stornieren? Die Stornorechnung erhält die nächste Nummer – das lässt sich nicht rückgängig machen.`}
                  className="space-y-3"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="reason">Grund (nur intern, fürs Protokoll)</Label>
                    <Textarea id="reason" name="reason" rows={2} placeholder="z. B. falscher Stundensatz" />
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="correct" defaultChecked className="mt-0.5 size-4" />
                    <span>Korrigierte Rechnung als Entwurf anlegen (mit den bisherigen Positionen)</span>
                  </label>
                  <SubmitButton variant="destructive" className="w-full" pendingText="Storniere …">
                    <Ban /> Rechnung stornieren
                  </SubmitButton>
                </ConfirmForm>
              </CardContent>
            </Card>
          )}

          {!storno && (
            <Card>
              <CardHeader>
                <CardTitle>Leistungsnachweis</CardTitle>
                <CardDescription>{billedJobs.length} Einsätze – werden mit Zeiten und Fotos an die Rechnung angehängt.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {billedJobs.map((j) => (
                  <Link key={j.id} href={`/einsaetze/${j.id}`} className="flex justify-between gap-2 hover:underline">
                    <span className="truncate">{j.siteName}</span>
                    <span className="shrink-0 text-muted-foreground">{dateDe(j.date)}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function relatedInvoice(where: SQL) {
  const { invoices } = schema;
  return db.select({ id: invoices.id, number: invoices.number, invoiceDate: invoices.invoiceDate }).from(invoices).where(where);
}
