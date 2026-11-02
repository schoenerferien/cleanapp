// Fehler von better-auth als deutsche Meldung (Anmeldung, Zwei-Faktor, Passwortwechsel).

const TEXT: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Anmeldung fehlgeschlagen. Bitte Benutzername und PIN bzw. Passwort prüfen.",
  INVALID_USERNAME_OR_PASSWORD: "Anmeldung fehlgeschlagen. Bitte Benutzername und PIN bzw. Passwort prüfen.",
  INVALID_PASSWORD: "Das Passwort ist falsch.",
  PASSWORD_TOO_SHORT: "Das neue Passwort braucht mindestens 12 Zeichen.",
  INVALID_CODE: "Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.",
  INVALID_BACKUP_CODE: "Der Notfall-Code stimmt nicht oder wurde schon benutzt.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "Zu viele falsche Codes. Bitte neu anmelden.",
  INVALID_TWO_FACTOR_COOKIE: "Die Anmeldung ist abgelaufen. Bitte neu anmelden.",
  ACCOUNT_TEMPORARILY_LOCKED: "Zu viele falsche Codes. Das Konto ist vorübergehend gesperrt – bitte in 15 Minuten erneut versuchen.",
};

export function authErrorText(error: { code?: string; message?: string; status?: number }): string {
  // Die Kontosperre (src/lib/auth.ts) liefert schon eine deutsche Meldung mit Uhrzeit
  if (error.code === "ACCOUNT_LOCKED" && error.message) return error.message;
  if (error.code && TEXT[error.code]) return TEXT[error.code];
  if (error.status === 429) return "Zu viele Versuche. Bitte kurz warten und erneut versuchen.";
  return "Das hat nicht geklappt. Bitte erneut versuchen.";
}

/** Nach diesen Fehlern muss die Anmeldung von vorn beginnen (Code-Abfrage abgelaufen oder verbraucht). */
export const restartsSignIn = (code?: string) => code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" || code === "INVALID_TWO_FACTOR_COOKIE";
