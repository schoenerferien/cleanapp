import { crc32, deflateRawSync } from "node:zlib";

// Minimaler ZIP-Schreiber (Deflate oder unkomprimiert, UTF-8-Dateinamen, ZIP64) – ohne zusätzliche Abhängigkeit.
// createZip baut kleine Archive im Speicher (Monatsarchiv), zipStream schreibt große Archive Datei für Datei (Backup).

export type ZipEntry = {
  name: string;
  data: Uint8Array;
  modified?: Date;
  /** Unkomprimiert ablegen – für Dateien, die schon komprimiert sind (JPEG, PDF). */
  store?: boolean;
};

const MAX16 = 0xffff;
const MAX32 = 0xffffffff;

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Schreibt Einträge nacheinander; ab 4 GB bzw. 65 535 Einträgen mit ZIP64-Angaben. */
class ZipWriter {
  private central: Buffer[] = [];
  private count = 0;
  private offset = 0;

  /** Lokaler Header und Daten eines Eintrags. Der Eintrag im Zentralverzeichnis wird für finish() gesammelt. */
  add(e: ZipEntry): Buffer {
    const name = Buffer.from(e.name, "utf8");
    const raw = Buffer.from(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    if (raw.length >= MAX32) throw new Error(`Datei zu groß für das Archiv: ${e.name}`);
    const packed = e.store ? raw : deflateRawSync(raw);
    const crc = crc32(raw);
    const { time, date } = dosDateTime(e.modified ?? new Date());
    // Liegt der Eintrag hinter der 4-GB-Grenze, steht sein Offset in einem ZIP64-Extrafeld
    const zip64 = this.offset >= MAX32;
    const version = zip64 ? 45 : 20;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // Signatur lokaler Header
    header.writeUInt16LE(version, 4); // benötigte Version
    header.writeUInt16LE(0x0800, 6); // Bit 11: Dateiname in UTF-8
    header.writeUInt16LE(e.store ? 0 : 8, 8); // Store bzw. Deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);

    const extra = Buffer.alloc(zip64 ? 12 : 0);
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0); // ZIP64-Extrafeld
      extra.writeUInt16LE(8, 2);
      extra.writeBigUInt64LE(BigInt(this.offset), 4);
    }
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); // Signatur Zentralverzeichnis
    dir.writeUInt16LE(version, 4);
    dir.writeUInt16LE(version, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(e.store ? 0 : 8, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(extra.length, 30);
    dir.writeUInt32LE(zip64 ? MAX32 : this.offset, 42);
    this.central.push(dir, name, extra);

    this.count++;
    this.offset += header.length + name.length + packed.length;
    return Buffer.concat([header, name, packed]);
  }

  /** Zentralverzeichnis und Endsatz. */
  finish(): Buffer {
    const centralSize = this.central.reduce((s, b) => s + b.length, 0);
    const centralOffset = this.offset;
    const out = [...this.central];

    if (this.count >= MAX16 || centralOffset >= MAX32 || centralSize >= MAX32) {
      const rec = Buffer.alloc(56);
      rec.writeUInt32LE(0x06064b50, 0); // Ende des Zentralverzeichnisses (ZIP64)
      rec.writeBigUInt64LE(BigInt(44), 4); // Größe des restlichen Satzes
      rec.writeUInt16LE(45, 12);
      rec.writeUInt16LE(45, 14);
      rec.writeBigUInt64LE(BigInt(this.count), 24);
      rec.writeBigUInt64LE(BigInt(this.count), 32);
      rec.writeBigUInt64LE(BigInt(centralSize), 40);
      rec.writeBigUInt64LE(BigInt(centralOffset), 48);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(0x07064b50, 0); // Verweis auf den ZIP64-Endsatz
      locator.writeBigUInt64LE(BigInt(centralOffset + centralSize), 8);
      locator.writeUInt32LE(1, 16); // Anzahl Teilarchive
      out.push(rec, locator);
    }

    // Felder, die nicht passen, stehen auf dem Höchstwert – dann gilt der ZIP64-Endsatz
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); // Ende des Zentralverzeichnisses
    end.writeUInt16LE(Math.min(this.count, MAX16), 8);
    end.writeUInt16LE(Math.min(this.count, MAX16), 10);
    end.writeUInt32LE(Math.min(centralSize, MAX32), 12);
    end.writeUInt32LE(Math.min(centralOffset, MAX32), 16);
    out.push(end);
    return Buffer.concat(out);
  }
}

/** Ganzes Archiv im Speicher – für kleine Archive. */
export function createZip(entries: ZipEntry[]): Uint8Array {
  const zip = new ZipWriter();
  return new Uint8Array(Buffer.concat([...entries.map((e) => zip.add(e)), zip.finish()]));
}

/** Archiv als Stream: Einträge werden erst bei Bedarf gelesen, es liegt immer nur einer im Speicher. */
export function zipStream(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  const it = entries[Symbol.asyncIterator]();
  const zip = new ZipWriter();
  return new ReadableStream({
    async pull(controller) {
      const next = await it.next();
      if (next.done) {
        controller.enqueue(zip.finish());
        controller.close();
      } else {
        controller.enqueue(zip.add(next.value));
      }
    },
    async cancel() {
      await it.return?.();
    },
  });
}
