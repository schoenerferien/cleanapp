import { describe, expect, it } from "vitest";
import { berlinDateTime } from "./format";
import {
  addDays,
  earningsCents,
  effectiveMinutes,
  haversineMeters,
  monthlySummary,
  monthRange,
  shiftMonth,
  startOfWeek,
  todayBerlin,
} from "./time";

const at = (s: string) => new Date(s);

describe("haversineMeters", () => {
  it("ist 0 für denselben Punkt", () => {
    expect(haversineMeters({ lat: 53.55, lng: 9.99 }, { lat: 53.55, lng: 9.99 })).toBe(0);
  });
  it("Hamburg Rathaus → Hauptbahnhof ca. 1 km", () => {
    const d = haversineMeters({ lat: 53.5503, lng: 9.9928 }, { lat: 53.5527, lng: 10.0069 });
    expect(d).toBeGreaterThan(900);
    expect(d).toBeLessThan(1100);
  });
});

describe("effectiveMinutes", () => {
  it("rechnet Originalzeiten", () => {
    expect(effectiveMinutes({ startAt: at("2026-10-05T06:00:00Z"), endAt: at("2026-10-05T08:30:00Z") })).toBe(150);
  });
  it("Korrektur hat Vorrang", () => {
    expect(
      effectiveMinutes({
        startAt: at("2026-10-05T06:00:00Z"),
        endAt: at("2026-10-05T08:30:00Z"),
        correctedEndAt: at("2026-10-05T08:00:00Z"),
      }),
    ).toBe(120);
  });
  it("offener Eintrag zählt 0", () => {
    expect(effectiveMinutes({ startAt: at("2026-10-05T06:00:00Z"), endAt: null })).toBe(0);
  });
});

describe("Verdienst", () => {
  it("31,5 Std × 15,00 € = 472,50 €", () => {
    expect(earningsCents(31.5 * 60, 1500)).toBe(47_250);
  });
  it("monthlySummary summiert Einträge", () => {
    const s = monthlySummary(
      [
        { startAt: at("2026-10-05T06:00:00Z"), endAt: at("2026-10-05T08:00:00Z") },
        { startAt: at("2026-10-06T06:00:00Z"), endAt: at("2026-10-06T07:30:00Z") },
      ],
      1550,
    );
    expect(s).toEqual({ minutes: 210, earnedCents: 5425 });
  });
});

describe("Datumshilfen", () => {
  it("shiftMonth wechselt über Jahresgrenzen", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });

  it("monthRange kennt Schaltjahre und Monatsenden", () => {
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("startOfWeek liefert Montag", () => {
    expect(startOfWeek("2026-10-03")).toBe("2026-09-28"); // Samstag → Montag davor
    expect(startOfWeek("2026-10-05")).toBe("2026-10-05");
  });
  it("addDays über Monatsgrenze", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
  it("todayBerlin nutzt Berliner Datum", () => {
    expect(todayBerlin(at("2026-10-03T22:30:00Z"))).toBe("2026-10-04");
  });
  it("berlinDateTime beachtet Sommer- und Winterzeit", () => {
    expect(berlinDateTime("2026-07-01", "08:00").toISOString()).toBe("2026-07-01T06:00:00.000Z");
    expect(berlinDateTime("2026-12-01", "08:00").toISOString()).toBe("2026-12-01T07:00:00.000Z");
  });
});
