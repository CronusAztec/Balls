import { zipStore } from "@/lib/recording/zip";
import { unzip } from "@/lib/recording/unzip";
import { FL_BY_ID } from "@/lib/physics/modes/fightLeagueRoster";
import { FL_CLIP_SLOTS, type FlClipLookup, type FlClipSlot } from "./flSoundResolve";

/**
 * --- fl-overhaul --- (Stage 4) Fight League's custom clip slots: the ONLY way licensed audio enters the fight's sound. Per
 * fighter six slots – swing, hit, ability, ko, intro (optional) and win – kept in this browser's IndexedDB (database
 * 'jbl-fl-clips', store 'clips', key `${fighterId}:${slot}`; the desktop app's renderer uses the same one). A clip is checked
 * before it is kept: at most 2 MB, an audio file by its magic bytes (RIFF/WAVE, OggS, fLaC, ID3 or an MPEG/AAC frame sync
 * 0xFFFx, an MP4 'ftyp' box, an EBML WebM), decodable by the browser, trimmed to its first 3 s and kept as 16-bit WAV with its
 * peak (the mixer normalises it). The whole set exports and imports as `<name>.jumpingballslive.zip` (the WAV files and a
 * clips.json manifest; recording/zip.ts and unzip.ts). Clips never leave the device: they are never uploaded, never put in a
 * share link or a project file, and never shipped with the site (.gitignore keeps `fight-sounds/` and `*.jumpingballslive.zip`
 * out of the repository).
 */

export const FL_CLIP_DB = "jbl-fl-clips";
export const FL_CLIP_STORE = "clips";
export const FL_CLIP_MAX_BYTES = 2 * 1024 * 1024;
export const FL_CLIP_MAX_SEC = 3;
export const FL_CLIP_SET_SUFFIX = ".jumpingballslive.zip";
export const FL_CLIP_MANIFEST = "clips.json";
export const FL_CLIP_FORMAT = "jumpingballslive-fight-sounds";

export type FlClipFormat = "wav" | "ogg" | "flac" | "mpeg" | "mp4" | "webm";
export type FlClipRefusal = "tooLarge" | "badFile";

export interface FlClipRecord {
  /** `${fighterId}:${slot}`. */
  key: string;
  fighterId: string;
  slot: FlClipSlot;
  /** The file's name as the user picked it (shown as plain text). */
  name: string;
  /** The trimmed clip as 16-bit PCM WAV. */
  bytes: ArrayBuffer;
  sec: number;
  peak: number;
  /** When it was added (ms since 1970). */
  added: number;
}

export function flClipKey(fighterId: string, slot: FlClipSlot): string {
  return `${fighterId}:${slot}`;
}

/** The audio format of a file by its first bytes (null: not an audio file this accepts). */
export function sniffAudioFormat(bytes: Uint8Array): FlClipFormat | null {
  const at = (i: number) => (i < bytes.length ? bytes[i] : -1);
  const ascii = (i: number, s: string) => {
    for (let k = 0; k < s.length; k++) if (at(i + k) !== s.charCodeAt(k)) return false;
    return true;
  };
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "wav";
  if (ascii(0, "OggS")) return "ogg";
  if (ascii(0, "fLaC")) return "flac";
  if (ascii(0, "ID3")) return "mpeg";
  if (at(0) === 0xff && at(1) >= 0 && (at(1) & 0xf0) === 0xf0) return "mpeg";
  if (ascii(4, "ftyp")) return "mp4";
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return "webm";
  return null;
}

/** 16-bit PCM WAV of `channels` (each clipped to ±1). */
export function encodeWav16(channels: readonly Float32Array[], sampleRate: number): ArrayBuffer {
  const nc = Math.max(1, Math.min(2, channels.length));
  const frames = channels.length ? channels[0].length : 0;
  const data = frames * nc * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, (channels[c] ?? channels[0])[i] || 0));
      v.setInt16(o, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
      o += 2;
    }
  }
  return buf;
}

/** The samples of a 16-bit PCM WAV (as `encodeWav16()` writes it; null for anything else). */
export function parseWav16(bytes: ArrayBuffer): { sampleRate: number; channels: Float32Array<ArrayBuffer>[] } | null {
  if (bytes.byteLength < 44) return null;
  const v = new DataView(bytes);
  const u8 = new Uint8Array(bytes);
  if (sniffAudioFormat(u8) !== "wav") return null;
  let o = 12;
  let nc = 0;
  let rate = 0;
  let bits = 0;
  let format = 0;
  while (o + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    const len = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === "fmt " && len >= 16) {
      format = v.getUint16(body, true);
      nc = v.getUint16(body + 2, true);
      rate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
    } else if (id === "data") {
      if (format !== 1 || bits !== 16 || nc < 1 || nc > 2 || !(rate >= 3000 && rate <= 384000)) return null;
      const frames = Math.floor(Math.min(len, bytes.byteLength - body) / (2 * nc));
      const channels = Array.from({ length: nc }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) for (let c = 0; c < nc; c++) channels[c][i] = v.getInt16(body + (i * nc + c) * 2, true) / 0x8000;
      return { sampleRate: rate, channels };
    }
    o = body + len + (len & 1);
  }
  return null;
}

/** What a decoder returns (an AudioBuffer, or a test's stand-in). */
export interface DecodedAudio {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * Checks and prepares the file `name` (`bytes`) for slot `slot` of fighter `fighterId`: refused when larger than 2 MB
 * ("tooLarge"), not an audio file by its magic bytes or not decodable by `decode` ("badFile"); else its first 3 s as WAV.
 */
export async function prepareFlClip(name: string, bytes: ArrayBuffer, fighterId: string, slot: FlClipSlot, decode: (bytes: ArrayBuffer) => Promise<DecodedAudio>, added = Date.now()): Promise<{ ok: true; record: FlClipRecord } | { ok: false; error: FlClipRefusal }> {
  if (!(bytes.byteLength > 0)) return { ok: false, error: "badFile" };
  if (bytes.byteLength > FL_CLIP_MAX_BYTES) return { ok: false, error: "tooLarge" };
  if (!sniffAudioFormat(new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength)))) return { ok: false, error: "badFile" };
  if (!FL_BY_ID.has(fighterId) || !FL_CLIP_SLOTS.includes(slot)) return { ok: false, error: "badFile" };
  let audio: DecodedAudio;
  try {
    audio = await decode(bytes.slice(0));
  } catch {
    return { ok: false, error: "badFile" };
  }
  if (!audio || !(audio.length > 0) || !(audio.sampleRate > 0) || !(audio.numberOfChannels > 0)) return { ok: false, error: "badFile" };
  const frames = Math.min(audio.length, Math.round(FL_CLIP_MAX_SEC * audio.sampleRate));
  const channels: Float32Array[] = [];
  let peak = 0;
  for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) {
    const d = audio.getChannelData(c).subarray(0, frames);
    const copy = new Float32Array(d);
    for (let i = 0; i < copy.length; i++) {
      const a = Math.abs(copy[i]);
      if (a > peak) peak = a;
    }
    channels.push(copy);
  }
  if (!(peak > 1e-4)) return { ok: false, error: "badFile" };
  const rate = Math.round(audio.sampleRate);
  return { ok: true, record: { key: flClipKey(fighterId, slot), fighterId, slot, name: String(name).slice(0, 120), bytes: encodeWav16(channels, rate), sec: frames / rate, peak: Math.min(1, peak), added } };
}

/* ------------------------------------------------------------------ the store */

/** Where the records live: IndexedDB in the browser, memory where there is none (and in tests). */
export interface FlClipBackend {
  getAll(): Promise<FlClipRecord[]>;
  put(record: FlClipRecord): Promise<void>;
  delete(key: string): Promise<void>;
}

export function memoryClipBackend(): FlClipBackend {
  const map = new Map<string, FlClipRecord>();
  return {
    getAll: async () => [...map.values()],
    put: async (r) => {
      map.set(r.key, r);
    },
    delete: async (key) => {
      map.delete(key);
    },
  };
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** The IndexedDB backend: database FL_CLIP_DB, object store FL_CLIP_STORE keyed by `key`. */
export function indexedDbClipBackend(factory: IDBFactory): FlClipBackend {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!db) {
      db = new Promise<IDBDatabase>((resolve, reject) => {
        const r = factory.open(FL_CLIP_DB, 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains(FL_CLIP_STORE)) d.createObjectStore(FL_CLIP_STORE, { keyPath: "key" });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      db.catch(() => {
        db = null;
      });
    }
    return db;
  };
  const store = async (mode: IDBTransactionMode) => (await open()).transaction(FL_CLIP_STORE, mode).objectStore(FL_CLIP_STORE);
  return {
    getAll: async () => (await request((await store("readonly")).getAll())) as FlClipRecord[],
    put: async (rec) => {
      await request((await store("readwrite")).put(rec));
    },
    delete: async (key) => {
      await request((await store("readwrite")).delete(key));
    },
  };
}

/** A record read back from storage or an archive, checked field by field (null: not a clip record). */
export function sanitizeClipRecord(raw: unknown): FlClipRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fighterId = typeof r.fighterId === "string" ? r.fighterId : "";
  const slot = r.slot as FlClipSlot;
  if (!FL_BY_ID.has(fighterId) || !FL_CLIP_SLOTS.includes(slot)) return null;
  if (!(r.bytes instanceof ArrayBuffer) || r.bytes.byteLength > FL_CLIP_MAX_BYTES || sniffAudioFormat(new Uint8Array(r.bytes, 0, Math.min(16, r.bytes.byteLength))) !== "wav") return null;
  const sec = Number(r.sec);
  const peak = Number(r.peak);
  return {
    key: flClipKey(fighterId, slot),
    fighterId,
    slot,
    name: typeof r.name === "string" ? r.name.slice(0, 120) : "",
    bytes: r.bytes,
    sec: Number.isFinite(sec) ? Math.max(0, Math.min(FL_CLIP_MAX_SEC, sec)) : 0,
    peak: Number.isFinite(peak) ? Math.max(1e-4, Math.min(1, peak)) : 1,
    added: Number.isFinite(Number(r.added)) ? Number(r.added) : 0,
  };
}

/** The clip store: its records (cached), changes announced to subscribers. */
export class FlClipStore {
  private records: FlClipRecord[] | null = null;
  private readonly listeners = new Set<(records: readonly FlClipRecord[]) => void>();

  constructor(private readonly backend: FlClipBackend) {}

  async list(): Promise<FlClipRecord[]> {
    if (!this.records) {
      let raw: unknown[] = [];
      try {
        raw = await this.backend.getAll();
      } catch {
        raw = [];
      }
      this.records = raw.map(sanitizeClipRecord).filter((r): r is FlClipRecord => !!r);
    }
    return this.records.slice();
  }

  async put(record: FlClipRecord) {
    await this.backend.put(record);
    const list = await this.list();
    this.records = [...list.filter((r) => r.key !== record.key), record];
    this.emit();
  }

  async remove(key: string) {
    await this.backend.delete(key);
    const list = await this.list();
    this.records = list.filter((r) => r.key !== key);
    this.emit();
  }

  subscribe(fn: (records: readonly FlClipRecord[]) => void): () => void {
    this.listeners.add(fn);
    void this.list().then((r) => {
      if (this.listeners.has(fn)) fn(r);
    });
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    const list = (this.records ?? []).slice();
    for (const fn of this.listeners) fn(list);
  }
}

let pageStore: FlClipStore | null = null;
/** The page's clip store (IndexedDB when the browser has it, else memory for this visit). */
export function flClipStore(): FlClipStore {
  if (!pageStore) {
    let factory: IDBFactory | null = null;
    try {
      factory = typeof indexedDB !== "undefined" ? indexedDB : null;
    } catch {
      factory = null;
    }
    pageStore = new FlClipStore(factory ? indexedDbClipBackend(factory) : memoryClipBackend());
  }
  return pageStore;
}

/** The resolver's view of `records` (flSoundResolve.ts). */
export function flClipLookup(records: readonly FlClipRecord[]): FlClipLookup {
  const map = new Map(records.map((r) => [r.key, r]));
  return {
    clip: (fighterId, slot) => {
      const r = map.get(flClipKey(fighterId, slot));
      return r ? { key: r.key, sec: r.sec } : null;
    },
  };
}

/* ------------------------------------------------------------------ the set's archive */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A plain file name for the set (letters, digits, - and _), never empty. */
export function flClipSetName(name: string): string {
  const base = String(name ?? "")
    .replace(/\.jumpingballslive\.zip$/i, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "fight-sounds"}${FL_CLIP_SET_SUFFIX}`;
}

/** The set's archive: every clip as clips/<fighter>-<slot>.wav and the clips.json manifest. */
export function exportFlClipSet(records: readonly FlClipRecord[], name = "fight-sounds"): { fileName: string; bytes: Uint8Array } {
  const clips = records.map((r) => ({ key: r.key, fighterId: r.fighterId, slot: r.slot, name: r.name, file: `clips/${r.fighterId}-${r.slot}.wav`, sec: r.sec, peak: r.peak, added: r.added }));
  const manifest = { format: FL_CLIP_FORMAT, version: 1, clips };
  const parts = zipStore([{ name: FL_CLIP_MANIFEST, data: encoder.encode(JSON.stringify(manifest, null, 2)) }, ...records.map((r, i) => ({ name: clips[i].file, data: new Uint8Array(r.bytes) }))]);
  let size = 0;
  for (const p of parts) size += p.length;
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return { fileName: flClipSetName(name), bytes };
}

/**
 * The clips of a set's archive, each checked again like a new file (`decode` must succeed; at most 2 MB; trimmed): the
 * records and the files it refused (with why). Throws when `bytes` is not such an archive.
 */
export async function importFlClipSet(bytes: ArrayBuffer | Uint8Array, decode: (bytes: ArrayBuffer) => Promise<DecodedAudio>): Promise<{ records: FlClipRecord[]; refused: { file: string; error: FlClipRefusal }[] }> {
  const entries = await unzip(bytes, { maxEntries: 512, maxBytes: 600 * FL_CLIP_MAX_BYTES });
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const raw = byName.get(FL_CLIP_MANIFEST);
  if (!raw) throw new Error("Not a fight sound set (no clips.json)");
  let manifest: { format?: unknown; clips?: unknown };
  try {
    manifest = JSON.parse(decoder.decode(raw));
  } catch {
    throw new Error("Not a fight sound set (clips.json is not JSON)");
  }
  if (!manifest || manifest.format !== FL_CLIP_FORMAT || !Array.isArray(manifest.clips)) throw new Error("Not a fight sound set");
  const records: FlClipRecord[] = [];
  const refused: { file: string; error: FlClipRefusal }[] = [];
  for (const c of manifest.clips as Record<string, unknown>[]) {
    const file = typeof c?.file === "string" ? c.file : "";
    const data = byName.get(file);
    const fighterId = typeof c?.fighterId === "string" ? c.fighterId : "";
    const slot = c?.slot as FlClipSlot;
    if (!data || !FL_BY_ID.has(fighterId) || !FL_CLIP_SLOTS.includes(slot)) {
      refused.push({ file, error: "badFile" });
      continue;
    }
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const res = await prepareFlClip(typeof c.name === "string" ? c.name : file, buf, fighterId, slot, decode, Number.isFinite(Number(c.added)) ? Number(c.added) : Date.now());
    if (res.ok) records.push(res.record);
    else refused.push({ file, error: res.error });
  }
  return { records, refused };
}

/** Decodes with the browser (an OfflineAudioContext: nothing plays, no autoplay prompt), the WAV reader without one. */
export async function decodeWithBrowser(bytes: ArrayBuffer): Promise<DecodedAudio> {
  const Ctor = typeof OfflineAudioContext !== "undefined" ? OfflineAudioContext : null;
  if (!Ctor) {
    const wav = parseWav16(bytes);
    if (!wav) throw new Error("No audio decoder");
    return { sampleRate: wav.sampleRate, numberOfChannels: wav.channels.length, length: wav.channels[0].length, getChannelData: (c) => wav.channels[c] };
  }
  const ctx = new Ctor(1, 1, 44100);
  return await ctx.decodeAudioData(bytes);
}
