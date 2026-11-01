import { describe, expect, it } from "vitest";
import { isBelowMinWage, kuStatus, minWageAt, minijobLimitAt, minijobStatus } from "./limits";

describe("Minijob-Grenze", () => {
  it("603 € in 2026, 633 € ab 2027", () => {
    expect(minijobLimitAt("2026-10-15")).toBe(60_300);
    expect(minijobLimitAt("2027-01-01")).toBe(63_300);
  });
  it("Ampel bewertet bisher + Prognose", () => {
    expect(minijobStatus(47_250, 0, 60_300).level).toBe("gruen"); // 78 %
    expect(minijobStatus(47_250, 6_000, 60_300).level).toBe("gelb"); // 88 %
    expect(minijobStatus(47_250, 15_000, 60_300).level).toBe("rot"); // 103 %
  });
  it("genau an der Grenze ist gelb, nicht rot", () => {
    expect(minijobStatus(60_300, 0, 60_300).level).toBe("gelb");
  });
  it("Restbudget wird nie negativ", () => {
    expect(minijobStatus(70_000, 0, 60_300).remainingCents).toBe(0);
  });
});

describe("Kleinunternehmer-Ampel", () => {
  it("gelb ab 80 %, rot ab 100 %", () => {
    expect(kuStatus(1_000_000, 2_500_000).level).toBe("gruen");
    expect(kuStatus(2_000_000, 2_500_000).level).toBe("gelb");
    expect(kuStatus(2_500_000, 2_500_000).level).toBe("rot");
  });
});

describe("Branchenmindestlohn", () => {
  it("LG 1 = 15,00 € in 2026", () => {
    expect(minWageAt("2026-10-03")).toBe(1500);
    expect(isBelowMinWage(1490, "2026-10-03")).toBe(true);
    expect(isBelowMinWage(1500, "2026-10-03")).toBe(false);
    expect(isBelowMinWage(null, "2026-10-03")).toBe(false);
  });
});
