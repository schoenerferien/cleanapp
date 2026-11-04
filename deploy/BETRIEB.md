# Betrieb auf einem eigenen Server (HTTPS)

Eine Instanz je Firma: kleiner Linux-Server (z. B. Ubuntu 24.04) bei einem deutschen Anbieter, **gemietet und bezahlt von der Firma selbst**.
Davor Caddy als Reverse-Proxy mit automatischem HTTPS, Daten in PostgreSQL, Fotos und Rechnungs-PDFs unter `/var/lib/cleaninghub`.

```
Internet ──443──▶ Caddy (HTTPS, HSTS) ──▶ 127.0.0.1:3000 Next.js ──▶ PostgreSQL (lokal)
                                                         └──▶ /var/lib/cleaninghub/storage
```

> **Vor echten Daten:** Backups (Datenbank + `/var/lib/cleaninghub`) einrichten und eine Wiederherstellung einmal testen.
> Diese Anleitung deckt Backups noch nicht ab.

## Server mieten

Empfehlung (Stand November 2026): **netcup Root-Server RS 500 G12.5** – 2 dedizierte Kerne, 4 GB RAM, 64 GB NVMe,
Image Ubuntu 24.04. Standort **Nürnberg** ausdrücklich wählen; die Voreinstellung „Keine Präferenz Europa“ kann auch Wien
bedeuten. 12,93 €/Monat bei 12 Monaten Laufzeit (inkl. MwSt., zzgl. Aufschlag für den festen Standort); monatlich
kündbar etwas teurer.

- Root-Server statt VPS wegen der zugesagten Verfügbarkeit von 99,9 % – für VPS gibt netcup keine Zusage. Die App hat
  keinen Offline-Modus: Ist der Server weg, kann niemand stempeln.
- 4 GB RAM reichen gut: `npm run build` braucht in der Spitze rund 1,2 GB (gemessen, ohne Build-Cache), und beim Update
  ist der Dienst gestoppt. Swap (Abschnitt 1) ist damit nur Reserve; bei 2 GB RAM ist er nötig.
- 64 GB reichen für Jahre: Fotos sind höchstens 0,5 MB groß, bei 10 Einsätzen mit je 4 Fotos am Tag sind das etwa 4 GB
  im Jahr. Mehr Platz lässt sich bei netcup als Block Storage nachbuchen.
- Mehr Reserve: RS 1000 G12.5 (4 Kerne, 8 GB, 128 GB NVMe) für 21,73 €/Monat.
- Vor echten Daten mit netcup einen **AV-Vertrag** nach Art. 28 DSGVO abschließen – Vertragspartner ist die Firma.
- Snapshots sind im Tarif enthalten (vor jedem Update einen anlegen), liegen aber auf demselben Speicher und ersetzen kein
  Backup an einem anderen Ort.

## 1. Vorbereitung

- Domain bzw. Subdomain (z. B. `app.firma.de`) mit A-/AAAA-Eintrag auf die Server-IP.
- Firewall: nur 22, 80 und 443 offen.
- Swap für `npm run build` (bei 4 GB RAM nur Reserve) – nur wenn `swapon --show` noch nichts anzeigt.

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable

sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Pakete

```bash
# Node.js 24 (NodeSource), PostgreSQL, Caddy
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt install -y nodejs postgresql git unzip
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## 3. Benutzer, Verzeichnisse, Datenbank

```bash
sudo useradd --system --create-home --home-dir /opt/cleaninghub cleaninghub
sudo mkdir -p /var/lib/cleaninghub/storage && sudo chown -R cleaninghub: /var/lib/cleaninghub

DBPASS=$(openssl rand -base64 24 | tr -d '/+=')
sudo -u postgres psql -c "CREATE ROLE cleaninghub LOGIN PASSWORD '$DBPASS';"
sudo -u postgres psql -c "CREATE DATABASE cleaninghub OWNER cleaninghub;"
echo "$DBPASS"   # für DATABASE_URL notieren
```

## 4. App installieren

```bash
sudo -iu cleaninghub
git clone <privates-repo> /opt/cleaninghub/repo   # oder per scp kopieren
cd /opt/cleaninghub/repo
npm ci
```

`.env.local` anlegen (`chmod 600 .env.local`):

```bash
DATABASE_URL=postgres://cleaninghub:<DBPASS>@localhost:5432/cleaninghub
BETTER_AUTH_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))">
BETTER_AUTH_URL=https://app.firma.de
STORAGE_DIR=/var/lib/cleaninghub/storage
KI_FOTOPRUEFUNG=aus
```

`BETTER_AUTH_URL` muss mit `https://` beginnen – dann werden die Login-Cookies als „Secure“ gesetzt.

```bash
npm run db:migrate
npm run build
npm run firma:anlegen -- "Firmenname" "Vorname Nachname" login@firma.de   # gibt das Startpasswort einmal aus
exit
```

`npm run db:seed` **nicht** auf dem Server ausführen – es leert alle Tabellen (bricht ab, sobald eine echte Firma existiert).

Bei der ersten Anmeldung richtet das Büro die **Zwei-Faktor-Anmeldung** ein (Authenticator-App, im Betrieb Pflicht) und
sichert die Notfall-Codes. Danach unter *Konto und Sicherheit* ein eigenes Passwort setzen (mind. 12 Zeichen).

**Notfall** (Passwort vergessen oder Handy verloren und keine Notfall-Codes): auf dem Server

```bash
sudo -iu cleaninghub
cd /opt/cleaninghub/repo
npm run zugang:zuruecksetzen -- login@firma.de   # neues Startpasswort, Zwei-Faktor beim nächsten Login neu einrichten
```

## 5. Dienst und HTTPS starten

```bash
sudo cp /opt/cleaninghub/repo/deploy/cleaninghub.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now cleaninghub

sudo cp /opt/cleaninghub/repo/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/app.example.de/app.firma.de/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy holt das Zertifikat beim ersten Aufruf selbst und verlängert es automatisch.

## 6. Prüfen

```bash
curl -sI https://app.firma.de/login | grep -iE "strict-transport|x-content-type|x-frame|content-security"
curl -sI http://app.firma.de      # muss auf https umleiten (308)
curl -s  http://<server-ip>:3000  # darf NICHT antworten (App nur lokal erreichbar)
journalctl -u cleaninghub -f      # Logs der App
```

## Updates

Vorher im netcup Server Control Panel einen Snapshot anlegen – geht beim Update etwas schief, ist der alte Stand mit
einem Klick zurück.

```bash
sudo systemctl stop cleaninghub   # npm ci und build tauschen node_modules und .next aus, die der laufende Dienst nutzt
sudo -iu cleaninghub
cd /opt/cleaninghub/repo && git pull
npm ci && npm run db:migrate && npm run build
exit
sudo systemctl start cleaninghub
```

Hat sich etwas unter `deploy/` geändert, `cleaninghub.service` bzw. `Caddyfile` wie in Abschnitt 5 neu kopieren
(im Caddyfile die Domain wieder eintragen).

## Monatsarchiv

Die Firma lädt jeden Monat im Dashboard das **Monatsarchiv** herunter (Arbeitszeiten als CSV, ausgestellte Rechnungen als PDF,
`LIESMICH.txt` mit Prüfsummen) und bewahrt es selbst auf: Arbeitszeiten mindestens 2 Jahre (§ 17 MiLoG), Rechnungen 8 Jahre.
Das Dashboard erinnert, bis das Archiv des Vormonats heruntergeladen wurde.

## Datensicherung in der App

Unter **Datensicherung** lädt die Firma jederzeit ein komplettes Backup als ZIP herunter: alle Tabellen der Firma als JSON,
alle Fotos und alle ausgestellten Rechnungs-PDFs, dazu `backup.json` (Manifest), `PRUEFSUMMEN.sha256` und `LIESMICH.txt`
mit der Anleitung zur Wiederherstellung. Passwörter, PINs, Zwei-Faktor-Schlüssel und Sitzungen sind nicht enthalten.

Das ZIP wird beim Herunterladen erzeugt und gestreamt – auf dem Server bleibt keine Kopie liegen, und der Speicherbedarf
wächst nicht mit der Datenmenge. Automatische Server-Backups ersetzt das nicht – die fehlen noch (siehe Hinweis oben).

## Datenschutz und Löschfristen

Unter **Datenschutz** stehen die Löschfristen (Standard: Arbeitszeiten 24 Monate – Minimum nach § 17 MiLoG –,
GPS-Standorte 3 Monate, Fotos 24 Monate). Ist etwas fällig, erinnert das Dashboard; gelöscht wird erst nach Bestätigung
mit *Jetzt löschen*. Die Fristen vor echten Daten mit Steuerberatung und Datenschutzberatung abstimmen – für Lohnunterlagen
können längere Fristen gelten.

Rechnungen samt Empfängerdaten und das Protokoll werden nicht gelöscht (Aufbewahrungspflicht, GoBD). Ehemalige Kunden und
ausgeschiedene Mitarbeitende lassen sich auf ihrer Seite anonymisieren.
