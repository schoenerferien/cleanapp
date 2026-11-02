import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field, PageHeader, selectClass } from "@/components/bits";
import { ConfirmForm, SubmitButton } from "@/components/client-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { db, schema } from "@/db";
import { dateDe, dateTimeDe } from "@/domain/format";
import { updateEmployee } from "@/server/actions/masterdata";
import { anonymizeEmployee } from "@/server/actions/privacy";
import { centsToInput } from "@/server/form";
import { employeePrivacy } from "@/server/privacy";
import { requireOwner } from "@/server/session";

export default async function EmployeeEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireOwner();
  const [e] = await db
    .select()
    .from(schema.user)
    .where(and(eq(schema.user.id, id), eq(schema.user.tenantId, me.tenantId), eq(schema.user.role, "employee")));
  if (!e) notFound();
  const privacy = (await employeePrivacy(me.tenantId, e.id))!;

  return (
    <>
      <PageHeader title={e.name} description={e.anonymizedAt ? `Anonymisiert am ${dateTimeDe(e.anonymizedAt)}` : `Benutzername: ${e.username}`}>
        <Button variant="outline" asChild>
          <Link href="/mitarbeiter">Zurück</Link>
        </Button>
      </PageHeader>
      <Card className="max-w-xl">
        <CardContent>
          <form action={updateEmployee.bind(null, e.id)} className="space-y-3">
            <Field label="Name">
              <Input name="name" defaultValue={e.name} required />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Beschäftigung">
                <select name="employmentType" className={selectClass} defaultValue={e.employmentType ?? "minijob"}>
                  <option value="minijob">Minijob</option>
                  <option value="teilzeit">Teilzeit</option>
                  <option value="vollzeit">Vollzeit</option>
                </select>
              </Field>
              <Field label="Stundenlohn €">
                <Input name="wage" inputMode="decimal" defaultValue={centsToInput(e.hourlyWageCents)} required />
              </Field>
            </div>
            <Field label="Telefon">
              <Input name="phone" defaultValue={e.phone ?? ""} />
            </Field>
            <Field label="Neue PIN" hint="Leer lassen, um die PIN nicht zu ändern">
              <Input name="pin" inputMode="numeric" pattern="\d{6}" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={e.active} className="size-4" /> Aktiv (kann sich anmelden und eingeplant werden)
            </label>
            <SubmitButton>Speichern</SubmitButton>
          </form>
        </CardContent>
      </Card>

      {!e.anonymizedAt && (
        <Card className="mt-6 max-w-xl">
          <CardHeader>
            <CardTitle>Datenschutz</CardTitle>
            <CardDescription>
              {e.active
                ? "Ausgeschieden? Oben „Aktiv“ abwählen und speichern – dann ist die Person sofort abgemeldet und kann sich nicht mehr anmelden."
                : privacy.canAnonymize
                  ? "Die Aufbewahrungsfrist ist abgelaufen. Beim Anonymisieren werden Name, Kontaktdaten, Lohn, Zugang und die Arbeitszeiten gelöscht; Fotos und Protokolleinträge zeigen danach „Ehemalige Person“."
                  : `Name und Arbeitszeiten müssen aufbewahrt werden (§ 17 MiLoG, letzter Einsatz am ${dateDe(privacy.lastWorkDate!)}). Anonymisieren ist ab dem ${dateDe(privacy.anonymizableFrom!)} möglich.`}
            </CardDescription>
          </CardHeader>
          {privacy.canAnonymize && (
            <CardContent>
              <ConfirmForm action={anonymizeEmployee.bind(null, e.id)} message={`${e.name} endgültig anonymisieren? Das lässt sich nicht rückgängig machen.`}>
                <SubmitButton variant="destructive" pendingText="Anonymisiere …">
                  Anonymisieren
                </SubmitButton>
              </ConfirmForm>
            </CardContent>
          )}
        </Card>
      )}
    </>
  );
}
