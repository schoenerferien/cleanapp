// Erlaubte Fotoformate. Der Typ wird aus den ersten Bytes der Datei bestimmt – die Angabe des Browsers
// zählt nicht. Alles andere (z. B. SVG, das Skripte enthalten kann) wird abgelehnt.
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export function imageExtension(type: AllowedImageType): string {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}

/** Content-Type für die Auslieferung: nur erlaubte Bildtypen, sonst als Download ohne Darstellung. */
export function safeImageContentType(stored: string): AllowedImageType | null {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(stored) ? (stored as AllowedImageType) : null;
}
