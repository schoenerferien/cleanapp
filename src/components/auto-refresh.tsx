"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Lädt die Seite in Abständen neu (z. B. Live-Dashboard, laufende KI-Prüfung). */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
