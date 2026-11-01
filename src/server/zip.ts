import { crc32, deflateRawSync } from "node:zlib";

// Minimaler ZIP-Schreiber (Deflate, UTF-8-Dateinamen) für das Monatsarchiv – ohne zusätzliche Abhängigkeit.
// Für kleine Archive gedacht: alles im Speicher, kein ZIP64 (Grenze 4 GB).

export type ZipEntry = { name: string; data: Uint8Array; modified?: Date };

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function createZip(entries: ZipEntry[]): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const raw = Buffer.from(e.data);
    const packed = deflateRawSync(raw);
    const crc = crc32(raw);
    const { time, date } = dosDateTime(e.modified ?? new Date());

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // Signatur lokaler Header
    header.writeUInt16LE(20, 4); // benötigte Version 2.0
    header.writeUInt16LE(0x0800, 6); // Bit 11: Dateiname in UTF-8
    header.writeUInt16LE(8, 8); // Deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, packed);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); // Signatur Zentralverzeichnis
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += header.length + name.length + packed.length;
  }

  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // Ende des Zentralverzeichnisses
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...local, ...central, end]));
}
