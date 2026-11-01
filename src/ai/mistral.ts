import "server-only";
import { Mistral } from "@mistralai/mistralai";

// Modell-IDs kommen aus der Konfiguration, nicht aus dem Code.
export const VISION_MODEL = process.env.MISTRAL_VISION_MODEL || "ministral-14b-latest";

// Standard: aus. Die KI läuft nur, wenn sie ausdrücklich eingeschaltet ist UND ein Key gesetzt ist –
// ein versehentlich kopierter Key schaltet sie nicht ein. Ohne KI gehen keine Fotos an Mistral.
export function aiEnabled(): boolean {
  return process.env.KI_FOTOPRUEFUNG === "an" && Boolean(process.env.MISTRAL_API_KEY);
}

export function mistralClient(): Mistral | null {
  const apiKey = process.env.MISTRAL_API_KEY;
  return aiEnabled() && apiKey ? new Mistral({ apiKey }) : null;
}
