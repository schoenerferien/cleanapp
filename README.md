# CleaningHub – POC

Lokaler Prototyp für eine Reinigungs-Neugründung (Gründerin + 2–3 Angestellte, Einsätze in mehreren Regionen):
Einsätze planen, per Handy stempeln und mit Fotos dokumentieren, Einsätze kontrollieren (mit KI-Hinweisen von Mistral) und Rechnungen als Kleinunternehmerin (§ 19 UStG) schreiben.

Plan und Abgrenzung: [`../docs/poc-plan.md`](../docs/poc-plan.md) · Gesamtplan: [`../docs/gesamtplan.md`](../docs/gesamtplan.md)

## Starten

Voraussetzung: Node 22+. Docker ist nicht nötig – Postgres läuft aus `node_modules` (`embedded-postgres`).

```bash
npm install
cp .env.example .env.local      # BETTER_AUTH_SECRET setzen, optional MISTRAL_API_KEY
npm run db:start                # Terminal 1: Postgres auf Port 5433 (läuft weiter)
npm run db:migrate && npm run db:seed
npm run dev                     # Terminal 2: http://localhost:3000
```

`npm run db:seed` setzt alle Daten auf den Demo-Stand zurück.

## Logins (Seed)

| Rolle | Login | Passwort / PIN |
|---|---|---|
| Gründerin (Büro) | `gruenderin@glanzwerk.demo` | `demo1234` |
| Anna (Minijob) | `anna` | `111111` |
| Bogdan (Minijob) | `bogdan` | `222222` |
| Celine (Teilzeit) | `celine` | `333333` |

Das Büro-Konto braucht im Betrieb (`NODE_ENV=production`) eine Zwei-Faktor-Anmeldung per Authenticator-App; lokal mit
`npm run dev` ist sie freiwillig. Büro-Sitzungen enden nach 12 Stunden; nach 10 falschen Passwörtern bzw. PINs ist ein
Konto 15 Minuten gesperrt.

## Am Handy testen

Kamera und GPS funktionieren im Browser nur über HTTPS. Am einfachsten über einen Cloudflare-Quick-Tunnel:

```bash
brew install cloudflared        # einmalig
npm run tunnel                  # gibt eine https://….trycloudflare.com-Adresse aus
```

Die Adresse am Handy öffnen, als `anna` / `111111` anmelden und „Zum Home-Bildschirm“ hinzufügen.

## KI-Fotoprüfung

**Standardmäßig aus.** Nur mit `KI_FOTOPRUEFUNG=an` **und** `MISTRAL_API_KEY` in `.env.local` prüft Mistral nach jedem
beendeten Einsatz die Vorher-/Nachher-Fotos (unscharf? Person erkennbar? Verbesserung sichtbar?). Ist sie aus, gehen keine
Fotos an Mistral und die App zeigt keine KI-Elemente. Modell über `MISTRAL_VISION_MODEL` (Standard `ministral-14b-latest`).
Die Hinweise beziehen sich nur auf den Einsatz – es gibt keine Bewertung von Personen. Jeder Aufruf wird in
`ai_invocations` protokolliert.

## Demo-Ablauf

1. **Gründerin** → Dashboard: wer ist gerade eingestempelt, was ist zu prüfen, Minijob- und Kleinunternehmer-Ampel.
2. **Einsätze**: Woche, Filter nach Region/Mitarbeiter, Karte; neuen Einsatz „wöchentlich bis …“ anlegen.
3. **Anna am Handy**: heutigen Einsatz öffnen → *Einsatz starten* (GPS-Abstand zum Objekt) → Checkliste,
   Vorher-/Nachher-Fotos, Mangel mit Foto, Notiz → *Einsatz beenden*.
4. **Gründerin** → Einsatz prüfen: Fotos nebeneinander (mit KI-Hinweis, falls eingeschaltet), Zeit mit Begründung korrigieren, *Abnehmen* oder *Nacharbeit*.
5. **Arbeitszeiten**: Monatsübersicht mit Minijob-Prognose, CSV-Export (Beginn/Ende/Dauer, Korrekturen mit Original).
6. **Rechnungen** → Neue Rechnung: Kunde + Monat → Vorschau → Entwurf → *Finalisieren* (fortlaufende Nummer, danach gesperrt) → PDF mit Leistungsnachweis.
   Das PDF wird beim Finalisieren unverändert abgelegt – spätere Abrufe liefern genau das verschickte Dokument.
   Korrektur nur per *Stornieren*: Stornorechnung mit eigener Nummer und negativen Beträgen, die Rechnung bleibt unverändert
   (Status „storniert“), die Einsätze werden frei – auf Wunsch gleich als korrigierbarer Entwurf mit den bisherigen Positionen.
7. **Monatsarchiv** (Dashboard-Erinnerung bzw. Arbeitszeiten → *Monatsarchiv*): ZIP mit Arbeitszeiten-CSV, den im Monat
   ausgestellten Rechnungs-PDFs und `LIESMICH.txt` mit Prüfsummen. Die Firma bewahrt es selbst auf – die App ist kein Archiv.
8. **Datensicherung**: komplettes Backup als ZIP – alle Tabellen der Firma als JSON, alle Fotos, alle ausgestellten
   Rechnungs-PDFs, dazu `backup.json`, `LIESMICH.txt` (mit Anleitung zur Wiederherstellung) und `PRUEFSUMMEN.sha256`.
   Wird beim Herunterladen gestreamt (ZIP64, auch über 4 GB). Ohne Passwörter, PINs, Zwei-Faktor-Schlüssel und Sitzungen.
9. **Datenschutz**: Löschfristen (Arbeitszeiten mind. 24 Monate, GPS-Standorte, Fotos) mit Vorschau und *Jetzt löschen*,
   Erinnerung im Dashboard. Ehemalige Kunden (ohne offene Rechnungen/Einsätze) und ausgeschiedene Mitarbeitende (nach Ablauf
   der Aufbewahrungsfrist ihrer Arbeitszeiten) lassen sich anonymisieren. Rechnungen und Protokoll bleiben unverändert.
10. **Konto und Sicherheit** (Sidebar unten): Zwei-Faktor-Anmeldung mit QR-Code und Notfall-Codes, Passwort ändern
    (mind. 12 Zeichen), alle anderen Geräte abmelden.

Standort: GPS wird nur beim Ein- und Ausstempeln erfasst, nicht bei Fotos.

Abrechnungsmodelle je Objekt: nach Stunden, Festpreis je Einsatz, Monatspauschale.

## Tests

```bash
npm test                 # Fachlogik (Vitest): Abrechnung, Minijob-/KU-Grenzen, Zeiten
npx playwright test      # Demo-Drehbuch Ende-zu-Ende (setzt die DB per Seed zurück!)
npm run lint && npm run typecheck && npm run build
```

Der Playwright-Test legt Screenshots unter `e2e/screenshots/` ab.

## Aufbau

```
src/
  app/(backoffice)/   Büro: dashboard, einsaetze, kunden, mitarbeiter, zeiten, rechnungen, datensicherung, einstellungen
  app/ma/             Mitarbeiter-App (mobil)
  app/api/            Auth, Foto-Upload/-Abruf, Rechnungs-PDF, CSV-Export, Monatsarchiv, Datensicherung
  domain/             reine Fachlogik mit Tests (wandert später nach packages/domain)
  server/             Session, Server Actions, Abfragen, Dateiablage
  ai/                 Mistral-Client und Fotoprüfung
  pdf/                Rechnungs-PDF (@react-pdf/renderer)
  db/                 Drizzle-Schema, Seed, Ersteinrichtung (firma-anlegen)
drizzle/              Migrationen inkl. GoBD-Trigger (finalisierte Rechnungen unveränderbar)
deploy/               Betrieb mit HTTPS: Caddyfile, systemd-Dienst, Anleitung (BETRIEB.md)
```

## Betrieb

Eine Instanz je Firma auf einem eigenen Server, HTTPS über Caddy: siehe [`deploy/BETRIEB.md`](deploy/BETRIEB.md).
Automatische Server-Backups sind dort noch nicht enthalten – vor echten Daten einrichten. Die Datensicherung in der App
ersetzt sie nicht, weil sie davon abhängt, dass jemand regelmäßig herunterlädt.

## Bewusst nicht im POC

Mandanten-Registrierung und Row-Level-Security (nur `tenant_id`-Spalten), Offline-Modus und native App,
Zuschläge/Tarife/DATEV-Export, E-Rechnung (für Kleinunternehmer nicht Pflicht), Teilstorno/Rechnungskorrektur einzelner
Positionen, Löschen von Rechnungen nach Ablauf der Aufbewahrungsfrist, SEPA, Mahnwesen, Kundenportal, Mehrsprachigkeit,
automatische Server-Backups. Siehe Gesamtplan.
