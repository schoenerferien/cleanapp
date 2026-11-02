"use client";

import { CheckCircle2, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { encode } from "uqr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authErrorText } from "@/lib/auth-errors";

/** Ein Formular mit Fehler- und Erfolgsmeldung; `run` liefert eine Fehlermeldung oder null. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setError(await fn());
    setBusy(false);
  }
  return { busy, error, run };
}

function PasswordField({ id, label, value, onChange, autoComplete = "current-password" }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="password" autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} required />
    </div>
  );
}

// ---------- Zwei-Faktor ----------

function QrCode({ value }: { value: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 2 });
  // Ein Quadrat je dunklem Modul, in einem Pfad – schwarz auf weiß, auch im dunklen Modus
  const d = data.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : ""))).join("");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="size-48 rounded-md" shapeRendering="crispEdges" role="img" aria-label="QR-Code für die Authenticator-App">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  function save() {
    const text = ["CleaningHub – Notfall-Codes für die Anmeldung", "Jeder Code funktioniert genau einmal, falls das Handy mit der Authenticator-App fehlt.", "", ...codes, ""].join("\r\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "cleaninghub-notfall-codes.txt" });
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm">
        <span className="font-medium">Notfall-Codes</span> – ausdrucken oder sicher ablegen. Jeder Code funktioniert einmal, falls das Handy fehlt. Sie werden
        nur jetzt angezeigt.
      </p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={save}>
        <Download /> Als Textdatei speichern
      </Button>
    </div>
  );
}

export function TwoFactorSettings({ enabled, canDisable }: { enabled: boolean; canDisable: boolean }) {
  return enabled ? <TwoFactorActive canDisable={canDisable} /> : <TwoFactorSetup />;
}

function TwoFactorSetup() {
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState("");

  if (!setup) {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const res = await authClient.twoFactor.enable({ password });
            if (res.error) return authErrorText(res.error);
            if (res.data.method !== "totp") return "Die App hat keinen Schlüssel geliefert. Bitte erneut versuchen.";
            setSetup({ totpURI: res.data.totpURI, backupCodes: res.data.backupCodes });
            return null;
          });
        }}
      >
        <PasswordField id="tf-password" label="Zur Bestätigung: Ihr Passwort" value={password} onChange={setPassword} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy}>
          {busy ? "Einen Moment …" : "Einrichten"}
        </Button>
      </form>
    );
  }

  const secret = new URL(setup.totpURI).searchParams.get("secret") ?? "";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <QrCode value={setup.totpURI} />
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <p>
            <span className="font-medium">1.</span> In der Authenticator-App „Konto hinzufügen“ wählen und den QR-Code scannen.
          </p>
          <p className="text-muted-foreground">
            Ohne Kamera: Schlüssel eingeben <code className="block break-all rounded bg-muted px-1.5 py-1 font-mono text-xs">{secret}</code>
          </p>
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <p>
          <span className="font-medium">2.</span> Notfall-Codes sichern:
        </p>
        <RecoveryCodes codes={setup.backupCodes} />
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const res = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
            if (res.error) return authErrorText(res.error);
            router.refresh();
            return null;
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="tf-code">
            <span className="font-medium">3.</span> Den 6-stelligen Code aus der App eingeben
          </Label>
          <Input
            id="tf-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="max-w-40 font-mono text-base tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy}>
          {busy ? "Prüfe …" : "Bestätigen und einschalten"}
        </Button>
      </form>
    </div>
  );
}

function TwoFactorActive({ canDisable }: { canDisable: boolean }) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm">
        <CheckCircle2 className="size-4 text-emerald-600" /> Eingeschaltet – bei jeder Anmeldung wird ein Code aus der App abgefragt.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const res = await authClient.twoFactor.generateBackupCodes({ password });
            if (res.error) return authErrorText(res.error);
            setCodes(res.data.backupCodes);
            setPassword("");
            return null;
          });
        }}
      >
        <PasswordField id="tf-active-password" label="Passwort" value={password} onChange={setPassword} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" disabled={busy}>
            Neue Notfall-Codes erzeugen
          </Button>
          {canDisable && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy || !password}
              onClick={() =>
                run(async () => {
                  const res = await authClient.twoFactor.disable({ password });
                  if (res.error) return authErrorText(res.error);
                  router.refresh();
                  return null;
                })
              }
            >
              Ausschalten
            </Button>
          )}
        </div>
      </form>
      {codes && <RecoveryCodes codes={codes} />}
    </div>
  );
}

// ---------- Passwort und Geräte ----------

export function ChangePasswordForm() {
  const { busy, error, run } = useAction();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [done, setDone] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(false);
        run(async () => {
          if (next.length < 12) return "Das neue Passwort braucht mindestens 12 Zeichen.";
          if (next !== repeat) return "Die beiden neuen Passwörter stimmen nicht überein.";
          const res = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
          if (res.error) return authErrorText(res.error);
          setCurrent("");
          setNext("");
          setRepeat("");
          setDone(true);
          return null;
        });
      }}
    >
      <PasswordField id="pw-current" label="Aktuelles Passwort" value={current} onChange={setCurrent} />
      <div className="grid gap-3 sm:grid-cols-2">
        <PasswordField id="pw-next" label="Neues Passwort (mind. 12 Zeichen)" value={next} onChange={setNext} autoComplete="new-password" />
        <PasswordField id="pw-repeat" label="Neues Passwort wiederholen" value={repeat} onChange={setRepeat} autoComplete="new-password" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {done && <p className="text-sm text-emerald-700">Passwort geändert. Alle anderen Geräte wurden abgemeldet.</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Speichern …" : "Passwort ändern"}
      </Button>
    </form>
  );
}

export function SignOutOthersButton() {
  const { busy, error, run } = useAction();
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const res = await authClient.revokeOtherSessions();
            if (res.error) return authErrorText(res.error);
            setDone(true);
            return null;
          })
        }
      >
        Auf allen anderen Geräten abmelden
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {done && <p className="text-sm text-emerald-700">Alle anderen Sitzungen wurden beendet.</p>}
    </div>
  );
}
