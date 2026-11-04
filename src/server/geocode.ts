import "server-only";

// Adresse → Koordinaten über OpenStreetMap Nominatim (max. 1 Anfrage/s laut Nutzungsrichtlinie).
// Im POC nur beim Speichern eines Objekts ohne Koordinaten – vorerst abgeschaltet, siehe siteValues in actions/masterdata.ts.
export async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "CleaningHub-POC/0.1 (lokale Demo)", "Accept-Language": "de" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat: string; lon: string }[];
    if (!data[0]) return null;
    return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
  } catch {
    return null;
  }
}
