import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createZip } from "./zip";

describe("createZip", () => {
  it("erzeugt ein Archiv, das ein Standard-Werkzeug fehlerfrei entpackt", () => {
    const csv = "﻿Mitarbeiter;Datum\r\nAnna Müller;01.09.2026\r\n";
    const pdf = new Uint8Array(4096).map((_, i) => (i * 7) % 256);
    const zip = createZip([
      { name: "arbeitszeiten-2026-09.csv", data: new TextEncoder().encode(csv) },
      { name: "rechnungen/Rechnung-GW-2026-001.pdf", data: pdf },
    ]);

    const dir = mkdtempSync(path.join(tmpdir(), "zip-test-"));
    const file = path.join(dir, "archiv.zip");
    writeFileSync(file, zip);
    // unzip -t prüft die CRC jeder Datei
    expect(execFileSync("unzip", ["-t", file]).toString()).toContain("No errors detected");
    execFileSync("unzip", ["-q", file, "-d", dir]);
    expect(readFileSync(path.join(dir, "arbeitszeiten-2026-09.csv"), "utf8")).toBe(csv);
    expect(new Uint8Array(readFileSync(path.join(dir, "rechnungen/Rechnung-GW-2026-001.pdf")))).toEqual(pdf);
  });
});
