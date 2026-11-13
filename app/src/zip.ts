/**
 * A zip archive written in memory, for a download that is more than one file:
 * a page and the images it shows. Each file is deflated, or stored when that
 * saves nothing (an image usually is compressed already), and its name is
 * marked UTF-8 so a page or an image named in any language unpacks as it was.
 * There is no ZIP64, so an archive past 4 GiB or 65,535 files is refused.
 */
import { deflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** The path inside the archive, `/`-separated, with no leading slash. */
  name: string;
  data: Buffer;
}

const LIMIT = 0xffffffff;

/** The CRC-32 table zip's checksums use (polynomial 0xEDB88320). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A date as the MS-DOS time and date fields every zip header carries. */
function dosTime(when: Date): { time: number; date: number } {
  const year = Math.min(Math.max(when.getFullYear(), 1980), 2107);
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

/** Pack `entries`, in order, into one zip archive stamped with `when`. */
export function zip(entries: readonly ZipEntry[], when: Date = new Date()): Buffer {
  if (entries.length > 0xffff) throw new Error("A zip without ZIP64 holds at most 65,535 files.");
  const { time, date } = dosTime(when);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const deflated = deflateRawSync(entry.data);
    const stored = deflated.length >= entry.data.length;
    const body = stored ? entry.data : deflated;
    if (entry.data.length > LIMIT || offset > LIMIT) {
      throw new Error("A zip without ZIP64 holds at most 4 GiB.");
    }

    // The fields a local header and its central directory record share.
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0); // version needed to extract: 2.0
    common.writeUInt16LE(0x0800, 2); // general purpose flags: names in UTF-8
    common.writeUInt16LE(stored ? 0 : 8, 4); // stored, or deflated
    common.writeUInt16LE(time, 6);
    common.writeUInt16LE(date, 8);
    common.writeUInt32LE(crc32(entry.data), 10);
    common.writeUInt32LE(body.length, 14);
    common.writeUInt32LE(entry.data.length, 18);
    common.writeUInt16LE(name.length, 22);
    common.writeUInt16LE(0, 24); // no extra field

    const local = Buffer.concat([u32(0x04034b50), common, name, body]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20), // made by: version 2.0, MS-DOS attributes
      common,
      u16(0), // no comment
      u16(0), // disk 0
      u16(0), // internal attributes
      u32(0), // external attributes
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const directory = Buffer.concat(centrals);
  if (offset > LIMIT) throw new Error("A zip without ZIP64 holds at most 4 GiB.");
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0), // this disk
    u16(0), // the disk the directory starts on
    u16(entries.length),
    u16(entries.length),
    u32(directory.length),
    u32(offset),
    u16(0), // no comment
  ]);
  return Buffer.concat([...locals, directory, end]);
}

function u16(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return buf;
}

function u32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}
