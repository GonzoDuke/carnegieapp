// Minimal ZIP archive builder — STORE method only (no compression).
//
// We bundle already-compressed payloads (JPEG/PNG/WebP photos plus a small
// CSV); deflating those buys essentially nothing and costs CPU, so storing
// them verbatim is the right trade. No ZIP64: every entry and the whole
// archive must stay under 4 GB, which a batch of phone photos always does.
// Pure Node Buffers, no dependency.
//
// Format reference: PKWARE APPNOTE — local file header (30 B) + name +
// data per entry, then a central directory, then the end-of-central-
// directory record.

export type ZipEntry = { name: string; data: Uint8Array };

// Standard CRC-32 (polynomial 0xEDB88320), precomputed table. ZIP stores a
// CRC of each entry's uncompressed bytes in both headers.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const fileParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  // Fixed DOS timestamp (1980-01-01 00:00): keeps output deterministic and
  // avoids stamping each entry with a capture time. date 0x0021 = 1980-01-01.
  const dosTime = 0;
  const dosDate = 0x21;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const size = data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract (2.0)
    local.writeUInt16LE(0x0800, 6); // flags: bit 11 = UTF-8 names
    local.writeUInt16LE(0, 8); // compression method: 0 = store
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size (== uncompressed)
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    fileParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header sig
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(0x0800, 8); // flags
    central.writeUInt16LE(0, 10); // compression method
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(0, 38); // external file attributes
    central.writeUInt32LE(offset, 42); // offset of local header
    centralParts.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // number of this disk
  end.writeUInt16LE(0, 6); // disk where central directory starts
  end.writeUInt16LE(entries.length, 8); // central dir records on this disk
  end.writeUInt16LE(entries.length, 10); // total central dir records
  end.writeUInt32LE(centralDir.length, 12); // size of central directory
  end.writeUInt32LE(offset, 16); // offset of central directory start
  end.writeUInt16LE(0, 20); // ZIP file comment length

  return Buffer.concat([...fileParts, centralDir, end]);
}
