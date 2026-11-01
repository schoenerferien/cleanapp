import { eq } from "drizzle-orm";
import { Field, PageHeader } from "@/components/bits";
import { SubmitButton } from "@/components/client-bits";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { db, schema } from "@/db";
import { euro } from "@/domain/format";
import { updateTenant } from "@/server/actions/masterdata";
import { requireOwner } from "@/server/session";

export default async function SettingsPage() {
  const me = await requireOwner();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, me.tenantId));

  return (
    <>
      <PageHeader title="Einstellungen" description="Firmendaten erscheinen auf jeder Rechnung (Pflichtangaben nach § 14 UStG)." />
      <form action={updateTenant} className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Firma</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Firmenname" className="sm:col-span-2">
              <Input name="name" defaultValue={t.name} required />
            </Field>
            <Field label="Inhaberin / Inhaber">
              <Input name="ownerName" defaultValue={t.ownerName ?? ""} />
            </Field>
            <Field label="Telefon">
              <Input name="phone" defaultValue={t.phone ?? ""} />
            </Field>
            <Field label="Straße und Nr." className="sm:col-span-2">
              <Input name="street" defaultValue={t.street ?? ""} />
            </Field>
            <Field label="PLZ">
              <Input name="zip" defaultValue={t.zip ?? ""} />
            </Field>
            <Field label="Ort">
              <Input name="city" defaultValue={t.city ?? ""} />
            </Field>
            <Field label="E-Mail" className="sm:col-span-2">
              <Input name="email" type="email" defaultValue={t.email ?? ""} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Steuern und Rechnungen</CardTitle>
            <CardDescription>
              Im Gründungsjahr gilt für die Kleinunternehmerregelung eine harte Grenze von {euro(t.kuLimitCents)} Umsatz. Wird sie überschritten,
              entfällt die Regelung ab diesem Umsatz – dann hier umstellen und mit dem Steuerberater sprechen.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-start gap-3 rounded-lg border p-3 sm:col-span-2">
              <input type="checkbox" name="kleinunternehmer" defaultChecked={t.kleinunternehmer} className="mt-1 size-4" />
              <span>
                <span className="block text-sm font-medium">Kleinunternehmerin nach § 19 UStG</span>
                <span className="block text-xs text-muted-foreground">
                  Rechnungen ohne Umsatzsteuer mit Hinweis „Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.“ Aus: 19 % USt.
                </span>
              </span>
            </label>
            <Field label="Steuernummer">
              <Input name="taxNumber" defaultValue={t.taxNumber ?? ""} />
            </Field>
            <Field label="USt-IdNr. (optional)">
              <Input name="vatId" defaultValue={t.vatId ?? ""} />
            </Field>
            <Field label="Rechnungspräfix" hint={`Nächste Nummer: ${t.invoicePrefix}-${new Date().getFullYear()}-${String(t.nextInvoiceNo).padStart(4, "0")}`}>
              <Input name="invoicePrefix" defaultValue={t.invoicePrefix} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bankverbindung</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="IBAN" className="sm:col-span-2">
              <Input name="iban" defaultValue={t.iban ?? ""} />
            </Field>
            <Field label="BIC">
              <Input name="bic" defaultValue={t.bic ?? ""} />
            </Field>
            <Field label="Bank">
              <Input name="bankName" defaultValue={t.bankName ?? ""} />
            </Field>
          </CardContent>
        </Card>

        <div>
          <SubmitButton size="lg">Speichern</SubmitButton>
        </div>
      </form>
    </>
  );
}
