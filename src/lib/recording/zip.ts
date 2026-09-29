/**
 * --- batch-render --- A tiny ZIP writer for the batch render's "Download all as ZIP": STORE only (no compression – the
 * clips are MP4 / WebM, compressed already), UTF-8 names, no ZIP64 (at most 65 535 files and 4 GiB), nothing else.
 *
 * Layout (APPNOTE.TXT 4.3.6): for every file a local file header (30 bytes + name) followed by its bytes, then the central
 * directory (46 bytes + name per file) and the end-of-central-directory record (22 bytes). `zipStore()` returns the archive
 * as a list of parts – the file data is referenced, never copied – which a Blob (or a test) joins.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** "Version needed to extract" / "made by": 2.0 (MS-DOS attributes). */
const ZIP_VERSION = 20;
/** General purpose flag bit 11: the file name is UTF-8. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;
/** Without ZIP64 every size and offset is 32-bit and the entry count 16-bit. */
export const ZIP_MAX_BYTES = 0xffffffff;
export const ZIP_MAX_ENTRIES = 0xffff;

export interface ZipEntry {
  /** Path inside the archive ("/" separated, no leading slash). */
  name: string;
  data: Uint8Array;
  /** Modification time stored with the file (default: now). */
  date?: Date;
}

/** Thrown when the archive would need ZIP64 (too many files or more than 4 GiB). */
export class ZipTooLargeError extends Error {
  constructor() {
    super("The archive is too large for a plain ZIP file");
    this.name = "ZipTooLargeError";
  }
}

let crcTable: Uint32Array | null = null;
function table(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/**
 * CRC-32 (IEEE 802.3, the ZIP checksum) of `data`, unsigned. Pass the result of a previous call as `crc` to continue a
 * checksum over the next chunk: `crc32(b, crc32(a))` equals the CRC of `a` followed by `b`.
 */
export function crc32(data: Uint8Array, crc = 0): number {
  const t = table();
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** MS-DOS date and time of `date` (local time, two-second resolution, clamped to 1980–2107). */
export function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const early = date.getFullYear() < 1980;
  const month = early ? 1 : date.getMonth() + 1;
  const day = early ? 1 : date.getDate();
  const hours = early ? 0 : date.getHours();
  const minutes = early ? 0 : date.getMinutes();
  const seconds = early ? 0 : date.getSeconds();
  return { date: ((year - 1980) << 9) | (month << 5) | day, time: (hours << 11) | (minutes << 5) | (seconds >> 1) };
}

const encoder = new TextEncoder();

/** The archive of `entries` (STORE), as parts in file order; their concatenation is the .zip file. */
export function zipStore(entries: readonly ZipEntry[]): Uint8Array[] {
  if (entries.length > ZIP_MAX_ENTRIES) throw new ZipTooLargeError();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    if (name.length === 0 || name.length > 0xffff) throw new Error(`Invalid file name in the archive: "${entry.name}"`);
    const size = entry.data.length;
    const { date, time } = dosDateTime(entry.date ?? now);
    const crc = crc32(entry.data);
    if (size > ZIP_MAX_BYTES || offset > ZIP_MAX_BYTES) throw new ZipTooLargeError();

    const local = new Uint8Array(LOCAL_HEADER_SIZE + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, LOCAL_HEADER, true);
    l.setUint16(4, ZIP_VERSION, true);
    l.setUint16(6, FLAG_UTF8, true);
    l.setUint16(8, METHOD_STORE, true);
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, size, true); // compressed size = size (STORE)
    l.setUint32(22, size, true);
    l.setUint16(26, name.length, true);
    l.setUint16(28, 0, true); // no extra field
    local.set(name, LOCAL_HEADER_SIZE);

    const header = new Uint8Array(CENTRAL_HEADER_SIZE + name.length);
    const c = new DataView(header.buffer);
    c.setUint32(0, CENTRAL_HEADER, true);
    c.setUint16(4, ZIP_VERSION, true);
    c.setUint16(6, ZIP_VERSION, true);
    c.setUint16(8, FLAG_UTF8, true);
    c.setUint16(10, METHOD_STORE, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, size, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    c.setUint16(30, 0, true); // extra field
    c.setUint16(32, 0, true); // comment
    c.setUint16(34, 0, true); // disk number
    c.setUint16(36, 0, true); // internal attributes
    c.setUint32(38, 0, true); // external attributes
    c.setUint32(42, offset, true);
    header.set(name, CENTRAL_HEADER_SIZE);

    parts.push(local, entry.data);
    central.push(header);
    offset += local.length + size;
  }
  const centralSize = central.reduce((sum, h) => sum + h.length, 0);
  if (offset > ZIP_MAX_BYTES || offset + centralSize > ZIP_MAX_BYTES) throw new ZipTooLargeError();
  const end = new Uint8Array(END_RECORD_SIZE);
  const e = new DataView(end.buffer);
  e.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
  e.setUint16(4, 0, true); // this disk
  e.setUint16(6, 0, true); // disk with the central directory
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  e.setUint16(20, 0, true); // comment length
  return [...parts, ...central, end];
}

/** Total length of the parts `zipStore()` returned (the archive's size in bytes). */
export function zipByteLength(parts: readonly Uint8Array[]): number {
  return parts.reduce((sum, p) => sum + p.length, 0);
}

/** A .zip Blob of `files` (read one after the other, so only the archive's parts are held at once). */
export async function zipBlobs(files: readonly { name: string; blob: Blob }[], date?: Date): Promise<Blob> {
  const entries: ZipEntry[] = [];
  for (const file of files) entries.push({ name: file.name, data: new Uint8Array(await file.blob.arrayBuffer()), date });
  return new Blob(zipStore(entries) as BlobPart[], { type: "application/zip" });
}
