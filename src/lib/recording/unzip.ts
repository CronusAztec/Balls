/**
 * --- fl-overhaul --- (Stage 4) A tiny ZIP reader for the Fight League's custom sound sets (`<name>.jumpingballslive.zip`,
 * written by zip.ts): STORE and DEFLATE entries (DEFLATE through the platform's DecompressionStream), UTF-8 or ASCII names,
 * no ZIP64, no encryption, no multi-disk. Refuses names that climb out of the archive ("..", absolute paths, backslashes),
 * more than `maxEntries` files and more than `maxBytes` of unpacked data in all – so a hostile archive cannot blow the page
 * up. Directory entries are skipped.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const END_RECORD_SIZE = 22;
const MAX_COMMENT = 0xffff;

export interface UnzipOptions {
  /** Most files read (default 256). */
  maxEntries?: number;
  /** Most bytes unpacked in all (default 64 MiB). */
  maxBytes?: number;
}

export interface UnzippedEntry {
  name: string;
  data: Uint8Array;
}

/** Thrown for an archive the reader refuses (with the reason). */
export class UnzipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnzipError";
  }
}

const decoder = new TextDecoder();

/** A safe relative path, "/" separated (no "..", no leading slash, no drive, no backslash, no NUL). */
export function safeZipName(name: string): boolean {
  if (!name || name.length > 512 || name.startsWith("/") || /^[a-zA-Z]:/.test(name) || name.includes("\\") || name.includes("\0")) return false;
  return name.split("/").every((part) => part !== ".." && part !== ".");
}

async function inflateRaw(data: Uint8Array, expected: number, limit: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new UnzipError("This browser cannot unpack compressed ZIP entries");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit || total > expected) {
      await reader.cancel().catch(() => undefined);
      throw new UnzipError("A ZIP entry unpacks to more than it says");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Reads every file of the ZIP archive `bytes` (see the header for what it refuses). */
export async function unzip(bytes: ArrayBuffer | Uint8Array, options: UnzipOptions = {}): Promise<UnzippedEntry[]> {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const maxEntries = options.maxEntries ?? 256;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  // the end-of-central-directory record: 22 bytes, then a comment of up to 64 KiB
  let eocd = -1;
  for (let i = u8.length - END_RECORD_SIZE; i >= Math.max(0, u8.length - END_RECORD_SIZE - MAX_COMMENT); i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new UnzipError("Not a ZIP archive");
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) throw new UnzipError("Multi-disk ZIP archives are not supported");
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new UnzipError("ZIP64 archives are not supported");
  if (count > maxEntries) throw new UnzipError("Too many files in the archive");
  if (cdOffset + cdSize > eocd) throw new UnzipError("A broken ZIP archive");
  const out: UnzippedEntry[] = [];
  let at = cdOffset;
  let unpacked = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > u8.length || view.getUint32(at, true) !== CENTRAL_HEADER) throw new UnzipError("A broken ZIP archive");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(u8.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new UnzipError("Encrypted ZIP entries are not supported");
    if (compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new UnzipError("ZIP64 archives are not supported");
    if (name.endsWith("/")) continue;
    if (!safeZipName(name)) throw new UnzipError(`An unsafe name in the archive: ${name.slice(0, 80)}`);
    unpacked += size;
    if (unpacked > maxBytes) throw new UnzipError("The archive unpacks to too much data");
    if (local + 30 > u8.length || view.getUint32(local, true) !== LOCAL_HEADER) throw new UnzipError("A broken ZIP archive");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compressed > u8.length) throw new UnzipError("A broken ZIP archive");
    const raw = u8.subarray(start, start + compressed);
    let data: Uint8Array;
    if (method === 0) {
      if (compressed !== size) throw new UnzipError("A broken ZIP archive");
      data = raw.slice();
    } else if (method === 8) data = await inflateRaw(raw, size, maxBytes);
    else throw new UnzipError(`Unsupported ZIP compression (method ${method})`);
    out.push({ name, data });
  }
  return out;
}
