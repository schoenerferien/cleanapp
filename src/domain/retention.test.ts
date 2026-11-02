import { describe, expect, it } from "vitest";
import { addDays } from "./time";
import { addMonths, dueFrom, retentionCutoff, retentionCutoffs, retentionError } from "./retention";

describe("addMonths", () => {
  it("verschiebt über Jahresgrenzen", () => {
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-01-15", -24)).toBe("2024-01-15");
  });
  it("kürzt auf das Monatsende", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29");
    expect(addMonths("2024-02-29", 24)).toBe("2026-02-28");
  });
});

describe("Fristen", () => {
  it("Stichtage je Kategorie", () => {
    expect(retentionCutoffs("2026-11-01", { timeMonths: 24, gpsMonths: 3, photoMonths: 12 })).toEqual({
      time: "2024-11-01",
      gps: "2026-08-01",
      photo: "2025-11-01",
    });
  });

  it("dueFrom ist genau der erste Tag, an dem der Stichtag den Datensatz erfasst", () => {
    const due = (date: string, today: string, months: number) => date < retentionCutoff(today, months);
    for (const months of [1, 3, 24]) {
      // Schaltjahr und normale Jahre, jedes Monatsende
      for (let date = "2024-01-01"; date <= "2026-12-31"; date = addDays(date, 1)) {
        const from = dueFrom(date, months);
        expect(due(date, from, months)).toBe(true);
        expect(due(date, addDays(from, -1), months)).toBe(false);
      }
    }
  });

  it("Arbeitszeiten dürfen nicht kürzer als 24 Monate aufbewahrt werden", () => {
    expect(retentionError({ timeMonths: 24, gpsMonths: 3, photoMonths: 24 })).toBeNull();
    expect(retentionError({ timeMonths: 12, gpsMonths: 3, photoMonths: 24 })).toMatch(/Arbeitszeiten.*24/);
    expect(retentionError({ timeMonths: 24, gpsMonths: 0, photoMonths: 24 })).toMatch(/GPS/);
    expect(retentionError({ timeMonths: 24, gpsMonths: 3, photoMonths: 2.5 })).toMatch(/Fotos/);
  });
});
