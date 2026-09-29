import { describe, expect, it } from "vitest";
import { blobCrc32, crc32, dosDateTime, zipArchiveSize, zipBlobParts, zipBlobs, zipByteLength, zipHeaders, zipStore, ZipTooLargeError, ZIP_MAX_BYTES, ZIP_MAX_ENTRIES } from "@/lib/recording/zip";

/* --- batch-render --- the STORE-only ZIP writer of the batch render's "Download all as ZIP" */

const bytes = (text: string) => new TextEncoder().encode(text);

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(zipByteLength(parts));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

interface ReadEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  flags: number;
  method: number;
  time: number;
  date: number;
}

/** A strict little reader: walks the end record, the central directory and every local header, checking they agree. */
function readZip(zip: Uint8Array): ReadEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const endAt = zip.length - 22;
  expect(view.getUint32(endAt, true)).toBe(0x06054b50);
  const count = view.getUint16(endAt + 8, true);
  expect(view.getUint16(endAt + 10, true)).toBe(count);
  const cdSize = view.getUint32(endAt + 12, true);
  const cdOffset = view.getUint32(endAt + 16, true);
  expect(cdOffset + cdSize).toBe(endAt);
  expect(view.getUint16(endAt + 20, true)).toBe(0);
  const entries: ReadEntry[] = [];
  let at = cdOffset;
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    expect(compressed).toBe(size);
    // The local header repeats the central one.
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 6, true)).toBe(flags);
    expect(view.getUint16(local + 8, true)).toBe(method);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    expect(view.getUint32(local + 18, true)).toBe(size);
    expect(view.getUint32(local + 22, true)).toBe(size);
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    expect(decoder.decode(zip.subarray(local + 30, local + 30 + localName))).toBe(name);
    const dataAt = local + 30 + localName + localExtra;
    entries.push({ name, data: zip.slice(dataAt, dataAt + size), crc, flags, method, time, date });
    at += 46 + nameLength + extra + comment;
  }
  expect(at).toBe(endAt);
  return entries;
}

describe("crc32", () => {
  it("matches the standard check value and the empty input", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(bytes("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });

  it("continues over chunks", () => {
    const data = bytes("viralballs batch render – chunked checksum");
    for (const cut of [0, 1, 7, data.length - 1, data.length]) {
      expect(crc32(data.subarray(cut), crc32(data.subarray(0, cut)))).toBe(crc32(data));
    }
  });

  it("is unsigned", () => {
    const all = new Uint8Array(256).map((_, i) => i);
    const crc = crc32(all);
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBe(0x29058c73);
  });
});

describe("dosDateTime", () => {
  it("packs local date and time with two-second resolution", () => {
    const { date, time } = dosDateTime(new Date(2026, 8, 29, 14, 32, 59));
    expect(date).toBe(((2026 - 1980) << 9) | (9 << 5) | 29);
    expect(time).toBe((14 << 11) | (32 << 5) | 29);
  });

  it("clamps dates before 1980", () => {
    expect(dosDateTime(new Date(1970, 0, 1, 12, 0, 0))).toEqual({ date: (1 << 5) | 1, time: 0 });
  });
});

describe("zipStore", () => {
  const when = new Date(2026, 0, 2, 3, 4, 6);

  it("writes a readable STORE archive with UTF-8 names and the right checksums", () => {
    const files = [
      { name: "classic-123-30s.mp4", data: bytes("first clip") },
      { name: "portal-456-12.4s.webm", data: new Uint8Array(1000).map((_, i) => (i * 31) & 0xff) },
      { name: "empty.txt", data: new Uint8Array(0) },
      { name: "żółw-ñandú.mp4", data: bytes("unicode") },
    ];
    const zip = join(zipStore(files.map((f) => ({ ...f, date: when }))));
    const read = readZip(zip);
    expect(read.map((e) => e.name)).toEqual(files.map((f) => f.name));
    read.forEach((e, i) => {
      expect(e.method).toBe(0);
      expect(e.flags & 0x0800).toBe(0x0800);
      expect([...e.data]).toEqual([...files[i].data]);
      expect(e.crc).toBe(crc32(files[i].data));
      expect(e).toMatchObject(dosDateTime(when));
    });
    // Headers: 30 + name per file, 46 + name in the directory, 22 for the end record.
    const names = files.reduce((sum, f) => sum + new TextEncoder().encode(f.name).length, 0);
    const data = files.reduce((sum, f) => sum + f.data.length, 0);
    expect(zip.length).toBe(files.length * (30 + 46) + 2 * names + data + 22);
  });

  it("keeps the data by reference (no copy of the clips)", () => {
    const data = bytes("clip");
    const parts = zipStore([{ name: "a.mp4", data }]);
    expect(parts.includes(data)).toBe(true);
  });

  it("writes an empty archive as a bare end record", () => {
    const zip = join(zipStore([]));
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });

  it("refuses names it cannot store and archives that would need ZIP64", () => {
    expect(() => zipStore([{ name: "", data: new Uint8Array(1) }])).toThrow();
    const many = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({ name: `f${i}`, data: new Uint8Array(0) }));
    expect(() => zipStore(many)).toThrow(ZipTooLargeError);
  });

  it("zips Blobs in order", async () => {
    const blob = await zipBlobs(
      [
        { name: "one.mp4", blob: new Blob([bytes("one")]) },
        { name: "two.webm", blob: new Blob([bytes("two, longer")]) },
      ],
      when,
    );
    expect(blob.type).toBe("application/zip");
    const read = readZip(new Uint8Array(await blob.arrayBuffer()));
    expect(read.map((e) => [e.name, new TextDecoder().decode(e.data)])).toEqual([
      ["one.mp4", "one"],
      ["two.webm", "two, longer"],
    ]);
  });

  it("knows the archive's size from the names and sizes alone", () => {
    const files = [
      { name: "classic-1-30s.mp4", data: new Uint8Array(777) },
      { name: "żółw.webm", data: new Uint8Array(0) },
    ];
    expect(zipArchiveSize(files.map((f) => ({ name: f.name, size: f.data.length })))).toBe(zipByteLength(zipStore(files)));
    expect(zipArchiveSize([])).toBe(22);
    expect(zipHeaders(files.map((f) => ({ name: f.name, size: f.data.length, crc: crc32(f.data) }))).size).toBe(zipByteLength(zipStore(files)));
  });

  it("allows 32-bit offsets up to the last byte and not one more (no data needed to tell)", () => {
    // One file named "a": 31 bytes of local header, its data, 47 bytes of central directory.
    const fits = ZIP_MAX_BYTES - 31 - 47;
    const headers = zipHeaders([{ name: "a", size: fits, crc: 0 }]);
    expect(headers.size).toBe(ZIP_MAX_BYTES + 22);
    const end = new DataView(headers.trailer[1].buffer);
    expect(end.getUint32(16, true)).toBe(31 + fits); // the central directory's offset
    expect(() => zipHeaders([{ name: "a", size: fits + 1, crc: 0 }])).toThrow(ZipTooLargeError);
    expect(() => zipArchiveSize([{ name: "a.mp4", size: 3 * 2 ** 30 }, { name: "b.mp4", size: 2 ** 30 }])).toThrow(ZipTooLargeError);
    expect(() => zipArchiveSize([{ name: "a.mp4", size: -1 }])).toThrow();
  });
});

/** A Blob that records how it is read: the slices asked for, and whole-Blob reads. */
class TrackedBlob extends Blob {
  slices: [number, number][] = [];
  wholeReads = 0;
  slice(start?: number, end?: number, contentType?: string): Blob {
    this.slices.push([start ?? 0, end ?? this.size]);
    return super.slice(start, end, contentType);
  }
  arrayBuffer(): Promise<ArrayBuffer> {
    this.wholeReads++;
    return super.arrayBuffer();
  }
  stream(): ReturnType<Blob["stream"]> {
    this.wholeReads++;
    return super.stream();
  }
  text(): Promise<string> {
    this.wholeReads++;
    return super.text();
  }
}

describe("zipBlobs keeps the clips out of memory", () => {
  const when = new Date(2026, 0, 2, 3, 4, 6);
  const pattern = (n: number) => new Uint8Array(n).map((_, i) => (i * 131 + (i >> 8)) & 0xff);

  it("checksums a Blob slice by slice, never reading it whole", async () => {
    const data = pattern(1000);
    for (const chunk of [1, 7, 64, 999, 1000, 4096]) {
      const blob = new TrackedBlob([data]);
      expect(await blobCrc32(blob, chunk)).toBe(crc32(data));
      expect(blob.wholeReads).toBe(0);
      expect(blob.slices.length).toBe(Math.ceil(1000 / chunk));
      expect(blob.slices.every(([a, b]) => b - a <= chunk && b <= 1000)).toBe(true);
      expect(blob.slices.map(([a]) => a)).toEqual(Array.from({ length: Math.ceil(1000 / chunk) }, (_, i) => i * chunk));
    }
    expect(await blobCrc32(new Blob([]))).toBe(0);
  });

  it("puts the clips' own Blobs between the headers (referenced, not copied)", async () => {
    const files = [
      { name: "classic-101-10s.mp4", blob: new TrackedBlob([pattern(5000)]) },
      { name: "portal-202-12.4s.webm", blob: new TrackedBlob([pattern(123)]) },
      { name: "empty.mp4", blob: new TrackedBlob([]) },
    ];
    const parts = await zipBlobParts(files, when, 512);
    expect(parts.length).toBe(files.length * 2 + files.length + 1);
    files.forEach((f, i) => expect(parts[2 * i + 1]).toBe(f.blob));
    expect(files.every((f) => f.blob.wholeReads === 0 && f.blob.slices.every(([a, b]) => b - a <= 512))).toBe(true);
    // Byte for byte the archive zipStore() writes from the same bytes.
    const zip = new Uint8Array(await new Blob(parts).arrayBuffer());
    const stored = join(zipStore(await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await new Blob([f.blob]).arrayBuffer()), date: when })))));
    expect([...zip]).toEqual([...stored]);
    const read = readZip(zip);
    expect(read.map((e) => e.name)).toEqual(files.map((f) => f.name));
    expect(read.map((e) => e.data.length)).toEqual([5000, 123, 0]);
  });

  it("refuses an archive over 4 GiB or 65 535 files before reading a single clip", async () => {
    const touched: string[] = [];
    const untouchable = (size: number) =>
      ({
        size,
        type: "video/mp4",
        slice: () => (touched.push("slice"), new Blob()),
        arrayBuffer: async () => (touched.push("arrayBuffer"), new ArrayBuffer(0)),
        stream: () => (touched.push("stream"), new Blob().stream()),
        text: async () => (touched.push("text"), ""),
      }) as unknown as Blob;
    const small = new TrackedBlob([pattern(100)]);
    await expect(zipBlobs([{ name: "small.mp4", blob: small }, { name: "a.mp4", blob: untouchable(2 ** 31) }, { name: "b.mp4", blob: untouchable(2 ** 31) }])).rejects.toThrow(ZipTooLargeError);
    const many = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({ name: `clip-${i}.mp4`, blob: untouchable(1) }));
    await expect(zipBlobs(many)).rejects.toThrow(ZipTooLargeError);
    await expect(zipBlobs([{ name: "", blob: small }])).rejects.toThrow("Invalid file name");
    expect(touched).toEqual([]);
    expect(small.slices).toEqual([]);
    expect(small.wholeReads).toBe(0);
  });
});
