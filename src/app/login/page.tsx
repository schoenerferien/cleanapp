"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authErrorText, restartsSignIn } from "@/lib/auth-errors";

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  // Zweiter Schritt (Büro): Code aus der Authenticator-App oder ein Notfall-Code
  const [step, setStep] = useState<"password" | "code">("password");
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function done() {
    router.replace("/");
    router.refresh();
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const id = login.trim();
    const res = id.includes("@")
      ? await authClient.signIn.email({ email: id, password })
      : await authClient.signIn.username({ username: id, password });
    setBusy(false);
    if (res.error) return setError(authErrorText(res.error));
    if (res.data && "twoFactorRedirect" in res.data && res.data.twoFactorRedirect) {
      setPassword("");
      setStep("code");
      return;
    }
    done();
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const value = code.replace(/\s/g, "");
    const res = recovery ? await authClient.twoFactor.verifyBackupCode({ code: value }) : await authClient.twoFactor.verifyTotp({ code: value });
    setBusy(false);
    if (res.error) {
      setError(authErrorText(res.error));
      if (restartsSignIn(res.error.code)) {
        setStep("password");
        setCode("");
      }
      return;
    }
    done();
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-teal-700 text-white">
            <Sparkles className="size-5" />
          </div>
          <CardTitle className="text-xl">CleaningHub</CardTitle>
          <CardDescription>
            {step === "password" ? "Büro: E-Mail und Passwort · Team: Benutzername und PIN" : "Zweiter Schritt: Bestätigung mit dem Handy"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "password" ? (
            <form onSubmit={submitPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="login">E-Mail oder Benutzername</Label>
                <Input
                  id="login"
                  autoComplete="username"
                  autoCapitalize="none"
                  className="h-11 text-base"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Passwort oder PIN</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className="h-11 text-base"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="h-11 w-full text-base" disabled={busy}>
                {busy ? "Anmelden …" : "Anmelden"}
              </Button>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="code">{recovery ? "Notfall-Code" : "6-stelliger Code aus der Authenticator-App"}</Label>
                <Input
                  id="code"
                  inputMode={recovery ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  autoFocus
                  className="h-11 font-mono text-base tracking-widest"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="h-11 w-full text-base" disabled={busy}>
                {busy ? "Prüfe …" : "Bestätigen"}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-muted-foreground underline"
                onClick={() => {
                  setRecovery(!recovery);
                  setCode("");
                  setError(null);
                }}
              >
                {recovery ? "Doch den Code aus der App verwenden" : "Handy nicht zur Hand? Notfall-Code verwenden"}
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
