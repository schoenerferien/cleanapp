import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { CustomerSnapshot, TenantSnapshot } from "@/db/schema";
import { KU_HINWEIS, monthLabel } from "@/domain/billing";
import { dateDe, decimal2, euro } from "@/domain/format";

export type InvoicePdfData = {
  draft: boolean;
  number: string | null;
  /** Stornorechnung: Nummer und Datum der stornierten Rechnung */
  cancels: { number: string; invoiceDate: string } | null;
  invoiceDate: string; // ISO
  dueDate: string; // ISO
  periodFrom: string;
  periodTo: string;
  periodMonth: string;
  kleinunternehmer: boolean;
  tenant: TenantSnapshot;
  customer: CustomerSnapshot;
  lines: { position: number; description: string; quantity: number; unit: string; unitPriceCents: number; totalCents: number }[];
  netCents: number;
  vatCents: number;
  totalCents: number;
  proof: {
    date: string;
    siteName: string;
    title: string;
    team: string;
    times: string;
    hours: string;
    photos: { kind: string; data: Buffer }[];
  }[];
};

const teal = "#0f766e";
const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 70, paddingHorizontal: 48, fontSize: 9.5, fontFamily: "Helvetica", color: "#1f2937" },
  sender: { fontSize: 7.5, color: "#6b7280", marginBottom: 6, textDecoration: "underline" },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  brand: { fontSize: 15, fontFamily: "Helvetica-Bold", color: teal },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginTop: 28, marginBottom: 6 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  muted: { color: "#6b7280" },
  metaLabel: { width: 90, color: "#6b7280" },
  th: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#d1d5db", paddingBottom: 4, marginTop: 14, fontFamily: "Helvetica-Bold" },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#e5e7eb", paddingVertical: 4 },
  cPos: { width: 26 },
  cDesc: { flex: 1, paddingRight: 6 },
  cQty: { width: 62, textAlign: "right" },
  cPrice: { width: 66, textAlign: "right" },
  cTotal: { width: 70, textAlign: "right" },
  totals: { marginTop: 10, marginLeft: "auto", width: 200 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderColor: "#1f2937", paddingTop: 4, marginTop: 2, fontFamily: "Helvetica-Bold", fontSize: 11 },
  footer: { position: "absolute", bottom: 28, left: 48, right: 48, borderTopWidth: 0.5, borderColor: "#d1d5db", paddingTop: 6, fontSize: 7, color: "#6b7280", flexDirection: "row", justifyContent: "space-between" },
  watermark: { position: "absolute", top: 330, left: 120, fontSize: 80, color: "#e5e7eb", transform: "rotate(-30deg)", fontFamily: "Helvetica-Bold" },
  proofItem: { borderBottomWidth: 0.5, borderColor: "#e5e7eb", paddingVertical: 6 },
  photos: { flexDirection: "row", gap: 6, marginTop: 4 },
  photo: { width: 110, height: 82, objectFit: "cover", borderRadius: 3 },
  photoLabel: { fontSize: 7, color: "#6b7280" },
});

function Footer({ t }: { t: TenantSnapshot }) {
  return (
    <View style={s.footer} fixed>
      <View>
        <Text>{t.name}</Text>
        <Text>{[t.street, [t.zip, t.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</Text>
        <Text>{[t.phone, t.email].filter(Boolean).join(" · ")}</Text>
      </View>
      <View>
        <Text>Steuernummer: {t.taxNumber ?? "–"}</Text>
        {t.vatId ? <Text>USt-IdNr.: {t.vatId}</Text> : null}
        {t.ownerName ? <Text>Inhaberin: {t.ownerName}</Text> : null}
      </View>
      <View>
        <Text>{t.bankName ?? ""}</Text>
        <Text>IBAN: {t.iban ?? "–"}</Text>
        <Text>BIC: {t.bic ?? "–"}</Text>
      </View>
      <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber}/${totalPages}`} />
    </View>
  );
}

export function InvoiceDocument({ d }: { d: InvoicePdfData }) {
  const t = d.tenant;
  const c = d.customer;
  const title = d.cancels ? "Stornorechnung" : "Rechnung";
  return (
    <Document title={d.number ? `${title} ${d.number}` : "Rechnungsentwurf"} author={t.name} language="de">
      <Page size="A4" style={s.page}>
        {d.draft && <Text style={s.watermark} fixed>ENTWURF</Text>}
        <View style={s.between}>
          <View style={{ width: 260 }}>
            <Text style={s.sender}>{[t.name, t.street, [t.zip, t.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{c.name}</Text>
            {c.contactName ? <Text>{c.contactName}</Text> : null}
            {c.street ? <Text>{c.street}</Text> : null}
            <Text>{[c.zip, c.city].filter(Boolean).join(" ")}</Text>
          </View>
          <View>
            <Text style={s.brand}>{t.name}</Text>
            <View style={{ marginTop: 10, gap: 2 }}>
              <View style={s.row}>
                <Text style={s.metaLabel}>Rechnungsnr.</Text>
                <Text>{d.number ?? "– (Entwurf)"}</Text>
              </View>
              <View style={s.row}>
                <Text style={s.metaLabel}>Rechnungsdatum</Text>
                <Text>{dateDe(d.invoiceDate)}</Text>
              </View>
              {d.cancels && (
                <View style={s.row}>
                  <Text style={s.metaLabel}>Storno zu</Text>
                  <Text>
                    {d.cancels.number} vom {dateDe(d.cancels.invoiceDate)}
                  </Text>
                </View>
              )}
              <View style={s.row}>
                <Text style={s.metaLabel}>Leistungszeitraum</Text>
                <Text>
                  {dateDe(d.periodFrom)} – {dateDe(d.periodTo)}
                </Text>
              </View>
              <View style={s.row}>
                <Text style={s.metaLabel}>Steuernummer</Text>
                <Text>{t.taxNumber ?? "–"}</Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={s.h1}>{title}</Text>
        {d.cancels ? (
          <Text>
            Hiermit stornieren wir unsere Rechnung Nr. {d.cancels.number} vom {dateDe(d.cancels.invoiceDate)} über die Reinigungsleistungen im{" "}
            {monthLabel(d.periodMonth)} vollständig.
          </Text>
        ) : (
          <Text>
            Für die Reinigungsleistungen im {monthLabel(d.periodMonth)} berechnen wir Ihnen wie folgt. Den Leistungsnachweis mit Zeiten und Fotos finden Sie
            im Anhang.
          </Text>
        )}

        <View style={s.th}>
          <Text style={s.cPos}>Pos.</Text>
          <Text style={s.cDesc}>Leistung</Text>
          <Text style={s.cQty}>Menge</Text>
          <Text style={s.cPrice}>Einzelpreis</Text>
          <Text style={s.cTotal}>Betrag</Text>
        </View>
        {d.lines.map((l) => (
          <View key={l.position} style={s.tr} wrap={false}>
            <Text style={s.cPos}>{l.position}</Text>
            <Text style={s.cDesc}>{l.description}</Text>
            <Text style={s.cQty}>
              {decimal2(l.quantity)} {l.unit}
            </Text>
            <Text style={s.cPrice}>{euro(l.unitPriceCents)}</Text>
            <Text style={s.cTotal}>{euro(l.totalCents)}</Text>
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          {!d.kleinunternehmer && (
            <>
              <View style={s.totalRow}>
                <Text>Nettobetrag</Text>
                <Text>{euro(d.netCents)}</Text>
              </View>
              <View style={s.totalRow}>
                <Text>Umsatzsteuer 19 %</Text>
                <Text>{euro(d.vatCents)}</Text>
              </View>
            </>
          )}
          <View style={s.grand}>
            <Text>Gesamtbetrag</Text>
            <Text>{euro(d.totalCents)}</Text>
          </View>
        </View>

        <View style={{ marginTop: 18, gap: 4 }} wrap={false}>
          {d.kleinunternehmer && <Text>{KU_HINWEIS}</Text>}
          {d.cancels ? (
            <Text>Die Rechnung Nr. {d.cancels.number} ist damit gegenstandslos. Einen bereits gezahlten Betrag erstatten oder verrechnen wir.</Text>
          ) : (
            <>
              <Text>
                Bitte überweisen Sie den Gesamtbetrag bis zum {dateDe(d.dueDate)} unter Angabe der Rechnungsnummer auf das unten genannte Konto.
              </Text>
              <Text style={s.muted}>Vielen Dank für Ihren Auftrag!</Text>
            </>
          )}
        </View>
        <Footer t={t} />
      </Page>

      {d.proof.length > 0 && (
        <Page size="A4" style={s.page}>
          {d.draft && <Text style={s.watermark} fixed>ENTWURF</Text>}
          <Text style={s.h2}>Leistungsnachweis {d.number ? `zu Rechnung ${d.number}` : ""}</Text>
          <Text style={[s.muted, { marginBottom: 8 }]}>
            Erfasste Arbeitszeiten (Beginn–Ende) und Fotodokumentation je Einsatz, abgenommen durch {t.ownerName ?? t.name}.
          </Text>
          {d.proof.map((p, i) => (
            <View key={i} style={s.proofItem} wrap={false}>
              <View style={s.between}>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>
                  {dateDe(p.date)} · {p.siteName}
                </Text>
                <Text>{p.hours}</Text>
              </View>
              <Text style={s.muted}>
                {p.title} · {p.times} · {p.team}
              </Text>
              {p.photos.length > 0 && (
                <View style={s.photos}>
                  {p.photos.map((ph, k) => (
                    <View key={k}>
                      {/* eslint-disable-next-line jsx-a11y/alt-text */}
                      <Image style={s.photo} src={{ data: ph.data, format: "jpg" }} />
                      <Text style={s.photoLabel}>{ph.kind}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
          <Footer t={t} />
        </Page>
      )}
    </Document>
  );
}
