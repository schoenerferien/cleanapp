import { Field, selectClass } from "@/components/bits";
import { SubmitButton } from "@/components/client-bits";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { schema } from "@/db";
import { centsToInput } from "@/server/form";

type Site = typeof schema.sites.$inferSelect;

export function SiteForm({
  action,
  site,
  submitLabel,
}: {
  action: (fd: FormData) => Promise<void>;
  site?: Site;
  submitLabel: string;
}) {
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Objektname" className="sm:col-span-2">
        <Input name="name" defaultValue={site?.name} placeholder="z. B. Treppenhaus Holstenstraße 12" required />
      </Field>
      <Field label="Straße und Nr." className="sm:col-span-2">
        <Input name="street" defaultValue={site?.street ?? ""} />
      </Field>
      <Field label="PLZ">
        <Input name="zip" defaultValue={site?.zip ?? ""} />
      </Field>
      <Field label="Ort">
        <Input name="city" defaultValue={site?.city ?? ""} />
      </Field>
      <Field label="Region" hint="Für Filter und Karte; leer = Ort">
        <Input name="region" defaultValue={site?.region ?? ""} />
      </Field>
      <Field label="Geofence (Meter)" hint="Abstand, ab dem beim Stempeln gewarnt wird">
        <Input name="geofenceM" type="number" min={50} step={10} defaultValue={site?.geofenceM ?? 200} />
      </Field>
      <Field label="Breitengrad" hint="Leer lassen = automatisch aus Adresse">
        <Input name="lat" defaultValue={site?.lat ?? ""} />
      </Field>
      <Field label="Längengrad">
        <Input name="lng" defaultValue={site?.lng ?? ""} />
      </Field>
      <Field label="Abrechnungsmodell">
        <select name="billingModel" defaultValue={site?.billingModel ?? "hourly"} className={selectClass}>
          <option value="hourly">Nach Stunden (Satz je Std)</option>
          <option value="per_visit">Festpreis je Einsatz</option>
          <option value="monthly_flat">Monatspauschale</option>
        </select>
      </Field>
      <Field label="Preis in €" hint="Stundensatz, Preis je Einsatz bzw. Monatsbetrag">
        <Input name="rate" inputMode="decimal" defaultValue={centsToInput(site?.rateCents)} required />
      </Field>
      <Field label="Arbeitsanweisung" className="sm:col-span-2">
        <Textarea name="instructions" rows={3} defaultValue={site?.instructions ?? ""} placeholder="Zugang, Schlüssel, Besonderheiten" />
      </Field>
      <Field label="Checkliste" hint="Ein Punkt pro Zeile" className="sm:col-span-2">
        <Textarea name="checklist" rows={5} defaultValue={(site?.checklist ?? []).join("\n")} />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
