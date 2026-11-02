import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/bits";
import { LogoutButton } from "@/components/client-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isOwner, requireUser, twoFactorRequired } from "@/server/session";
import { ChangePasswordForm, SignOutOthersButton, TwoFactorSettings } from "./security-forms";

// Bewusst außerhalb des Büro-Layouts: Hier landet das Büro-Konto, solange der zweite Faktor noch fehlt.
export default async function AccountPage() {
  const me = await requireUser();
  if (me.role !== "owner") redirect("/ma");
  const ready = isOwner(me);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-4 md:p-8">
      <PageHeader title="Konto und Sicherheit" description={`${me.name} · ${me.email}`}>
        {ready && (
          <Button variant="outline" asChild>
            <Link href="/dashboard">Zum Dashboard</Link>
          </Button>
        )}
        <LogoutButton />
      </PageHeader>

      {!ready && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
          <CardContent className="flex items-start gap-3 text-sm">
            <ShieldAlert className="size-5 shrink-0 text-amber-700" />
            <p>
              Das Büro-Konto sieht alle Daten der Firma. Bitte zuerst die Zwei-Faktor-Anmeldung einrichten – danach geht es weiter zum Dashboard.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Zwei-Faktor-Anmeldung</CardTitle>
          <CardDescription>
            Zusätzlich zum Passwort ein Code aus einer Authenticator-App auf dem Handy, z. B. Google Authenticator, Microsoft Authenticator oder 2FAS.
            {twoFactorRequired && " Für das Büro-Konto Pflicht."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorSettings enabled={me.twoFactorEnabled} canDisable={!twoFactorRequired} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Passwort ändern</CardTitle>
          <CardDescription>Mindestens 12 Zeichen. Danach werden alle anderen Geräte abgemeldet.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Angemeldete Geräte</CardTitle>
          <CardDescription>Eine Anmeldung im Büro gilt höchstens 12 Stunden. Bei Verdacht sofort alle anderen Geräte abmelden.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutOthersButton />
        </CardContent>
      </Card>
    </main>
  );
}
