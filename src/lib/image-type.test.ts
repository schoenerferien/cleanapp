import { describe, expect, it } from "vitest";
import { safeImageContentType, sniffImageType } from "./image-type";

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new TextEncoder().encode(s);

describe("sniffImageType", () => {
  it("erkennt JPEG, PNG und WebP an den ersten Bytes", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffImageType(ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("image/webp");
  });

  it("lehnt SVG, HTML und leere Dateien ab – egal, was der Browser als Typ angibt", () => {
    expect(sniffImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImageType(ascii("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImageType(ascii("RIFF\u0000\u0000\u0000\u0000WAVE"))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
  });
});

describe("safeImageContentType", () => {
  it("liefert nur erlaubte Bildtypen aus", () => {
    expect(safeImageContentType("image/jpeg")).toBe("image/jpeg");
    expect(safeImageContentType("image/svg+xml")).toBeNull();
    expect(safeImageContentType("text/html")).toBeNull();
  });
});
