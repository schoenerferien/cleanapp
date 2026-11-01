// Hilfen zum Auslesen von FormData in Server Actions.

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function optStr(fd: FormData, key: string): string | null {
  return str(fd, key) || null;
}

export function int(fd: FormData, key: string, fallback = 0): number {
  const n = Number.parseInt(str(fd, key), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function optFloat(fd: FormData, key: string): number | null {
  const s = str(fd, key).replace(",", ".");
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** "32,50" / "32.50" / "1.234,50" → 3250 Cent */
export function euroToCents(input: string): number {
  let s = input.replace(/[€\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) throw new Error(`Ungültiger Betrag: ${input}`);
  return Math.round(n * 100);
}

export function centsToInput(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

/** Mehrzeiliger Text → Liste ohne Leerzeilen (z. B. Checkliste). */
export function lines(fd: FormData, key: string): string[] {
  return str(fd, key)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
