import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { EmptyState, Field, PageHeader } from "@/components/bits";
import { ConfirmForm, SubmitButton } from "@/components/client-bits";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db, schema } from "@/db";
import { dateDe } from "@/domain/format";
import { RETENTION_LIMITS } from "@/domain/retention";
import { runRetention, saveRetention } from "@/server/actions/privacy";
import { employeePrivacy, retentionDue } from "@/server/privacy";
import { requireOwner } from "@/server/session";

const num = new Intl.NumberFormat("de-DE");

export default async function PrivacyPage() {
  const me = await requireOwner();
  const { user, customers } = schema;
  const [due, formerEmployees, anonymizedCustomers] = await Promise.all([
    retentionDue(me.tenantId),
    db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(and(eq(user.tenantId, me.tenantId), eq(user.role, "employee"), eq(user.active, false), isNull(user.anonymizedAt))),
    db.$count(customers, and(eq(customers.tenantId, me.tenantId), isNotNull(customers.anonymizedAt))),
  ]);
  const former = await Promise.all(formerEmployees.map(async (e) => ({ ...e, privacy: await employeePrivacy(me.tenantId, e.id) })));
  const { counts, cutoffs, settings } = due;
  const rows = [
    { label: "Arbeitszeiten", hint: `vor dem ${dateDe(cutoffs.time)}`, n: counts.timeEntries },
    { label: "Einsatzzuweisungen (wer war eingeplant)", hint: `vor dem ${dateDe(cutoffs.time)}`, n: counts.assignments },
    { label: "GPS-Standorte beim Stempeln", hint: `vor dem ${dateDe(cutoffs.gps)} – die Zeiten bleiben`, n: counts.gps },
    { label: "Fotos", hint: `vor dem ${dateDe(cutoffs.photo)}`, n: counts.photos },
    { label: "Abgelaufene Anmeldesitzungen", hint: "IP-Adresse und Browser", n: counts.sessions },
  ];
  const anything = rows.some((r) => r.n > 0);

  return (
    <>
      <PageHeader title="Datenschutz" description="Löschfristen und Anonymisierung – personenbezogene Daten nur so lange wie nötig." />
      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Fällig zur Löschung</CardTitle>
            <CardDescription>Daten, deren Löschfrist abgelaufen ist. Das Löschen lässt sich nicht rückgängig machen – vorher ggf. ein Backup herunterladen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.label}>
                    <TableCell>
                      <span className="block">{r.label}</span>
                      <span className="block text-xs text-muted-foreground">{r.hint}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{num.format(r.n)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {anything ? (
              <ConfirmForm action={runRetention} message="Fällige Daten jetzt endgültig löschen?">
                <SubmitButton variant="destructive" pendingText="Lösche …">
                  <Trash2 /> Jetzt löschen
                </SubmitButton>
              </ConfirmForm>
            ) : (
              <p className="text-sm text-muted-foreground">Nichts fällig.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Löschfristen</CardTitle>
            <CardDescription>
              In Monaten ab dem jeweiligen Tag. Arbeitszeiten müssen mindestens 2 Jahre aufbewahrt werden (§ 17 MiLoG); für Lohnunterlagen können
              längere Fristen gelten – bitte mit Steuerberatung und Datenschutzberatung abstimmen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveRetention} className="grid gap-4 sm:grid-cols-3">
              {(["timeMonths", "gpsMonths", "photoMonths"] as const).map((key) => (
                <Field key={key} label={RETENTION_LIMITS[key].label} hint={`${RETENTION_LIMITS[key].min}–${RETENTION_LIMITS[key].max} Monate`}>
                  <Input
                    name={key}
                    type="number"
                    min={RETENTION_LIMITS[key].min}
                    max={RETENTION_LIMITS[key].max}
                    defaultValue={settings[key]}
                    required
                  />
                </Field>
              ))}
              <div className="sm:col-span-3">
                <SubmitButton>Speichern</SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ehemalige Mitarbeiter</CardTitle>
            <CardDescription>
              Deaktivierte Personen lassen sich anonymisieren, sobald ihre Arbeitszeiten nicht mehr aufbewahrt werden müssen. Bis dahin bleiben Name und
              Zeiten gespeichert.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {former.length === 0 ? (
              <EmptyState>Keine deaktivierten Personen.</EmptyState>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Letzter Einsatz</TableHead>
                    <TableHead>Anonymisieren</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {former.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Link href={`/mitarbeiter/${e.id}`} className="font-medium hover:underline">
                          {e.name}
                        </Link>
                      </TableCell>
                      <TableCell>{e.privacy?.lastWorkDate ? dateDe(e.privacy.lastWorkDate) : "–"}</TableCell>
                      <TableCell>
                        {e.privacy?.canAnonymize ? (
                          <Link href={`/mitarbeiter/${e.id}`} className="text-teal-700 underline">
                            jetzt möglich
                          </Link>
                        ) : e.privacy?.anonymizableFrom ? (
                          `ab ${dateDe(e.privacy.anonymizableFrom)}`
                        ) : (
                          "–"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Was bleibt</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>
                <span className="font-medium">Ehemalige Kunden</span> lassen sich auf der Kundenseite anonymisieren, sobald es keine offenen Rechnungen und
                Einsätze mehr gibt{anonymizedCustomers > 0 ? ` (bisher ${anonymizedCustomers})` : ""}.
              </li>
              <li>
                <span className="font-medium">Rechnungen</span> bleiben unverändert mit Empfänger und Leistungsnachweis – Aufbewahrungspflicht 8 Jahre (§ 147
                AO, § 14b UStG). Löschen nach Fristablauf ist noch nicht eingebaut.
              </li>
              <li>
                <span className="font-medium">Das Protokoll</span> (wer hat wann was geändert) bleibt zur Nachvollziehbarkeit der Rechnungen (GoBD).
              </li>
              <li>
                <span className="font-medium">Heruntergeladene Backups und Monatsarchive</span> liegen bei Ihnen – dort gelten dieselben Fristen.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
