import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createZip, zipStream, type ZipEntry } from "./zip";

const tempZip = (bytes: Uint8Array) => {
  const dir = mkdtempSync(path.join(tmpdir(), "zip-test-"));
  const file = path.join(dir, "archiv.zip");
  writeFileSync(file, bytes);
  return { dir, file };
};

async function* generate(entries: ZipEntry[]) {
  yield* entries;
}

const streamed = async (entries: AsyncIterable<ZipEntry>) => new Uint8Array(await new Response(zipStream(entries)).arrayBuffer());

describe("createZip", () => {
  it("erzeugt ein Archiv, das ein Standard-Werkzeug fehlerfrei entpackt", () => {
    const csv = "﻿Mitarbeiter;Datum\r\nAnna Müller;01.09.2026\r\n";
    const pdf = new Uint8Array(4096).map((_, i) => (i * 7) % 256);
    const zip = createZip([
      { name: "arbeitszeiten-2026-09.csv", data: new TextEncoder().encode(csv) },
      { name: "rechnungen/Rechnung-GW-2026-001.pdf", data: pdf },
    ]);

    const { dir, file } = tempZip(zip);
    // unzip -t prüft die CRC jeder Datei
    expect(execFileSync("unzip", ["-t", file]).toString()).toContain("No errors detected");
    execFileSync("unzip", ["-q", file, "-d", dir]);
    expect(readFileSync(path.join(dir, "arbeitszeiten-2026-09.csv"), "utf8")).toBe(csv);
    expect(new Uint8Array(readFileSync(path.join(dir, "rechnungen/Rechnung-GW-2026-001.pdf")))).toEqual(pdf);
  });
});

describe("zipStream", () => {
  it("schreibt komprimierte und unkomprimierte Einträge", async () => {
    const json = '[\n{"id":"1","name":"Praxis Dr. Meier"}\n]\n';
    const jpg = new Uint8Array(20_000).map((_, i) => (i * 13) % 251);
    const zip = await streamed(
      generate([
        { name: "datenbank/customers.json", data: new TextEncoder().encode(json) },
        { name: "fotos/job/foto.jpg", data: jpg, store: true },
      ]),
    );

    const { dir, file } = tempZip(zip);
    expect(execFileSync("unzip", ["-t", file]).toString()).toContain("No errors detected");
    execFileSync("unzip", ["-q", file, "-d", dir]);
    expect(readFileSync(path.join(dir, "datenbank/customers.json"), "utf8")).toBe(json);
    expect(new Uint8Array(readFileSync(path.join(dir, "fotos/job/foto.jpg")))).toEqual(jpg);
  });

  it("nutzt ZIP64 ab 65 535 Einträgen", async () => {
    const count = 70_000;
    async function* many() {
      for (let i = 0; i < count; i++) yield { name: `fotos/${i}.txt`, data: new TextEncoder().encode(String(i)), store: true };
    }
    const { file } = tempZip(await streamed(many()));

    expect(execFileSync("unzip", ["-tq", file]).toString()).toContain("No errors detected");
    expect(execFileSync("unzip", ["-Zt", file]).toString()).toMatch(new RegExp(`^${count} files`));
  });

  it("liest bei Abbruch keine weiteren Einträge", async () => {
    let read = 0;
    let closed = false;
    async function* entries() {
      try {
        for (;;) {
          read++;
          yield { name: `${read}.txt`, data: new Uint8Array(10) };
        }
      } finally {
        closed = true;
      }
    }
    const reader = zipStream(entries()).getReader();
    await reader.read();
    await reader.cancel();
    expect(closed).toBe(true);
    expect(read).toBeLessThan(5);
  });
});
