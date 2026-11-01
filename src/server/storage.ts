import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Lokale Ablage für den POC. Im Zielsystem: S3-kompatibler EU-Speicher mit presigned URLs.
// turbopackIgnore: Laufzeit-Ablage, nicht Teil des Server-Bundles
const ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? "./storage");

function resolveKey(key: string): string {
  const full = path.resolve(/*turbopackIgnore: true*/ ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Ungültiger Speicherpfad");
  return full;
}

export async function putFile(key: string, bytes: Uint8Array): Promise<void> {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
}

export async function getFile(key: string): Promise<Buffer> {
  return readFile(/*turbopackIgnore: true*/ resolveKey(key));
}

/** Wie getFile, aber null statt Fehler, wenn die Datei (noch) nicht existiert. */
export async function findFile(key: string): Promise<Buffer | null> {
  try {
    return await getFile(key);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
