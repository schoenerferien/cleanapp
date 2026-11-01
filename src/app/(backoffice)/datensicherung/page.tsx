import { Camera, Database, Download, FileText, type LucideIcon } from "lucide-react";
import { AmpelBadge, EmptyState, PageHeader } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bytesDe, dateTimeDe } from "@/domain/format";
import { backupHistory, backupStats } from "@/server/backup";
import { requireOwner } from "@/server/session";

const num = new Intl.NumberFormat("de-DE");

export default async function BackupPage() {
  const me = await requireOwner();
  const [stats, history] = await Promise.all([backupStats(me.tenantId), backupHistory(me.tenantId)]);

  return (
    <>
      <PageHeader title="Datensicherung" description="Alle Daten Ihrer Firma als ZIP-Datei herunterladen und selbst aufbewahren." />
      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Backup erstellen</CardTitle>
            <CardDescription>
              Das Backup wird beim Herunterladen mit dem aktuellen Stand erstellt. Je nach Anzahl der Fotos kann der Download einige Minuten dauern.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Part
                icon={Database}
                label="Datenbank"
                value={`${num.format(stats.rows)} Datensätze`}
                hint="Firma, Mitarbeiter, Kunden, Objekte, Einsätze, Arbeitszeiten, Rechnungen, Protokolle"
              />
              <Part icon={Camera} label="Fotos" value={num.format(stats.photos)} hint={`zusammen ${bytesDe(stats.photoBytes)}`} />
              <Part icon={FileText} label="Rechnungs-PDFs" value={num.format(stats.invoices)} hint="ausgestellte Rechnungen, unverändert wie verschickt" />
            </div>
            <Button asChild size="lg">
              <a href="/api/exports/datensicherung">
                <Download /> Backup herunterladen
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Nicht enthalten sind Passwörter, PINs und Anmeldesitzungen – nach einer Wiederherstellung bekommen alle neue Zugangsdaten.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sicher aufbewahren</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>
                Das Backup enthält personenbezogene Daten: Adressen, Löhne, Arbeitszeiten, Standorte beim Stempeln und Fotos. Nicht per E-Mail
                verschicken, am besten verschlüsselt ablegen.
              </li>
              <li>An zwei Orten aufbewahren, z. B. auf dem eigenen Rechner und einem verschlüsselten USB-Stick.</li>
              <li>Regelmäßig ein neues Backup erstellen, z. B. einmal im Monat zusammen mit dem Monatsarchiv.</li>
              <li>Im ZIP liegt eine LIESMICH.txt mit Prüfsummen und einer Anleitung zur Wiederherstellung für die Technik.</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bisherige Backups</CardTitle>
            <CardDescription>Vollständig heruntergeladene Backups</CardDescription>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <EmptyState>Noch kein Backup heruntergeladen.</EmptyState>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Erstellt</TableHead>
                    <TableHead>Von</TableHead>
                    <TableHead>Inhalt</TableHead>
                    <TableHead className="text-right">Größe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map(({ at, name, data }) => (
                    <TableRow key={at.toISOString()}>
                      <TableCell>{dateTimeDe(at)}</TableCell>
                      <TableCell>{name ?? "–"}</TableCell>
                      <TableCell>
                        {num.format(data.rows)} Datensätze, {num.format(data.files)} Dateien
                        {data.missing > 0 && (
                          <span className="ml-2">
                            <AmpelBadge level="gelb">{num.format(data.missing)} fehlten</AmpelBadge>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{bytesDe(data.bytes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Part({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
