/**
 * --- batch-render --- A tiny ZIP writer for the batch render's "Download all as ZIP": STORE only (no compression – the
 * clips are MP4 / WebM, compressed already), UTF-8 names, no ZIP64 (at most 65 535 files and 4 GiB), nothing else.
 *
 * Layout (APPNOTE.TXT 4.3.6): for every file a local file header (30 bytes + name) followed by its bytes, then the central
 * directory (46 bytes + name per file) and the end-of-central-directory record (22 bytes). The headers need nothing but each
 * file's name, size and CRC-32 (`zipHeaders()`), so the file data is never copied: `zipStore()` puts byte arrays between
 * the headers, `zipBlobParts()` / `zipBlobs()` the clips' own Blobs. For Blobs the archive's size is checked from
 * `blob.size` before anything is read (`zipArchiveSize()`), then every clip is read once, one slice of
 * `ZIP_READ_CHUNK_BYTES` at a time, for its checksum (`blobCrc32()`) – so besides the clips the page already holds, a ZIP
 * of any size needs one slice and the headers.
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
/** How much of a Blob `blobCrc32()` reads at a time (the only file data a ZIP of Blobs holds in memory). */
export const ZIP_READ_CHUNK_BYTES = 4 * 1024 * 1024;

export interface ZipEntry {
  /** Path inside the archive ("/" separated, no leading slash). */
  name: string;
  data: Uint8Array;
  /** Modification time stored with the file (default: now). */
  date?: Date;
}

/** A file as the headers describe it – everything but its bytes. */
export interface ZipFileInfo {
  /** Path inside the archive ("/" separated, no leading slash). */
  name: string;
  /** Length of the file's bytes. */
  size: number;
  /** CRC-32 of the file's bytes (`crc32()`, `blobCrc32()`). */
  crc: number;
  /** Modification time stored with the file (default: now). */
  date?: Date;
}

/** The headers of an archive: `locals[i]` goes right before the bytes of file i, `trailer` after the last file's bytes. */
export interface ZipHeaders {
  locals: Uint8Array<ArrayBuffer>[];
  /** The central directory (one header per file) and the end-of-central-directory record. */
  trailer: Uint8Array<ArrayBuffer>[];
  /** The archive's size in bytes (headers and file data). */
  size: number;
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

/** CRC-32 of a Blob, read one `chunkBytes` slice after the other (each slice is dropped once it is counted). */
export async function blobCrc32(blob: Blob, chunkBytes = ZIP_READ_CHUNK_BYTES): Promise<number> {
  const step = Math.max(1, Math.floor(chunkBytes));
  let crc = 0;
  for (let at = 0; at < blob.size; at += step) {
    crc = crc32(new Uint8Array(await blob.slice(at, Math.min(blob.size, at + step)).arrayBuffer()), crc);
  }
  return crc;
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

/** Where everything goes: the encoded names, every local header's offset, the central directory's offset and size. */
interface ZipLayout {
  names: Uint8Array[];
  offsets: number[];
  centralOffset: number;
  centralSize: number;
  size: number;
}

/** The layout of an archive of files with these names and sizes; throws before anything is written or read. */
function zipLayout(files: readonly { name: string; size: number }[]): ZipLayout {
  if (files.length > ZIP_MAX_ENTRIES) throw new ZipTooLargeError();
  const names: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;
  let centralSize = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    if (name.length === 0 || name.length > 0xffff) throw new Error(`Invalid file name in the archive: "${file.name}"`);
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error(`Invalid file size in the archive: "${file.name}"`);
    names.push(name);
    offsets.push(offset);
    offset += LOCAL_HEADER_SIZE + name.length + file.size;
    centralSize += CENTRAL_HEADER_SIZE + name.length;
  }
  // Every size and local header offset is at most the central directory's offset, which with the directory's size must fit 32 bits.
  if (offset + centralSize > ZIP_MAX_BYTES) throw new ZipTooLargeError();
  return { names, offsets, centralOffset: offset, centralSize, size: offset + centralSize + END_RECORD_SIZE };
}

/**
 * The size in bytes of the archive of files with these names and sizes. Throws `ZipTooLargeError` when it would need
 * ZIP64 (more than `ZIP_MAX_ENTRIES` files or 4 GiB) and an Error for a name it cannot store or a size that is not a
 * whole number of bytes.
 */
export function zipArchiveSize(files: readonly { name: string; size: number }[]): number {
  return zipLayout(files).size;
}

/** The headers of the STORE archive of `files` (their names, sizes and checksums – the bytes go between the headers). */
export function zipHeaders(files: readonly ZipFileInfo[]): ZipHeaders {
  const layout = zipLayout(files);
  const now = new Date();
  const locals: Uint8Array<ArrayBuffer>[] = [];
  const trailer: Uint8Array<ArrayBuffer>[] = [];
  files.forEach((file, i) => {
    const name = layout.names[i];
    const { date, time } = dosDateTime(file.date ?? now);
    const crc = file.crc >>> 0;
    const size = file.size;

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
    locals.push(local);

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
    c.setUint32(42, layout.offsets[i], true);
    header.set(name, CENTRAL_HEADER_SIZE);
    trailer.push(header);
  });
  const end = new Uint8Array(END_RECORD_SIZE);
  const e = new DataView(end.buffer);
  e.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
  e.setUint16(4, 0, true); // this disk
  e.setUint16(6, 0, true); // disk with the central directory
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, layout.centralSize, true);
  e.setUint32(16, layout.centralOffset, true);
  e.setUint16(20, 0, true); // comment length
  trailer.push(end);
  return { locals, trailer, size: layout.size };
}

/** The archive of `entries` (STORE), as parts in file order; their concatenation is the .zip file (the data is referenced, not copied). */
export function zipStore(entries: readonly ZipEntry[]): Uint8Array[] {
  zipArchiveSize(entries.map((entry) => ({ name: entry.name, size: entry.data.length }))); // too large: thrown before any checksum
  const { locals, trailer } = zipHeaders(entries.map((entry) => ({ name: entry.name, size: entry.data.length, crc: crc32(entry.data), date: entry.date })));
  const parts: Uint8Array[] = [];
  entries.forEach((entry, i) => parts.push(locals[i], entry.data));
  return [...parts, ...trailer];
}

/** Total length of the parts `zipStore()` returned (the archive's size in bytes). */
export function zipByteLength(parts: readonly Uint8Array[]): number {
  return parts.reduce((sum, p) => sum + p.length, 0);
}

/**
 * The parts of the .zip of `files` for `new Blob(parts)`: the headers with every file's own Blob between them, so the
 * clips are referenced, never copied. The archive's size comes from `blob.size` first (a `ZipTooLargeError` is thrown before
 * anything is read), then each file is read once, slice by slice, for its checksum.
 */
export async function zipBlobParts(files: readonly { name: string; blob: Blob }[], date?: Date, chunkBytes = ZIP_READ_CHUNK_BYTES): Promise<BlobPart[]> {
  zipArchiveSize(files.map((file) => ({ name: file.name, size: file.blob.size })));
  const infos: ZipFileInfo[] = [];
  for (const file of files) infos.push({ name: file.name, size: file.blob.size, crc: await blobCrc32(file.blob, chunkBytes), date });
  const { locals, trailer } = zipHeaders(infos);
  const parts: BlobPart[] = [];
  files.forEach((file, i) => parts.push(locals[i], file.blob));
  return [...parts, ...trailer];
}

/** A .zip Blob of `files` (`zipBlobParts()`): besides the Blobs themselves it holds one read slice and the headers. */
export async function zipBlobs(files: readonly { name: string; blob: Blob }[], date?: Date, chunkBytes = ZIP_READ_CHUNK_BYTES): Promise<Blob> {
  return new Blob(await zipBlobParts(files, date, chunkBytes), { type: "application/zip" });
}
