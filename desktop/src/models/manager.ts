import { createHash } from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import type { ModelEntry, ModelProgressEvent } from "@/lib/desktop/contract";
import { JsonFileStore } from "../journal";
import { MODEL_CATALOG, type ModelSpec } from "./catalog";
import { describeError } from "@/lib/desktop/errors"; // --- desktop-ai-fix ---

/*
 * --- desktop-exe --- The model manager: downloads a catalog model into the data folder on first use, resumably (a
 * `<file>.part` grows; the next download asks for the rest with an HTTP Range request and starts over only when the server
 * ignores it), verifies its size and SHA-256 before it is used (a `<file>.sha256` note records the verified hash, so the
 * 2 GB file is not hashed again on every start), and keeps GGUF files the user picked (checked for the GGUF magic, used
 * where they are – never copied). `fetch` and the progress callback are injected; tests/models.test.ts drives it with a
 * fake server. --- desktop-ai-fix --- main.ts injects Electron's net.fetch (the system proxy and certificate store: Node's own
 * fetch failed behind antivirus HTTPS scanning with a bare "fetch failed"), and a failed request says why (its cause codes).
 */

export interface ManagerOptions {
  dir: string;
  catalog?: readonly ModelSpec[];
  fetch?: typeof fetch;
  onProgress?: (event: ModelProgressEvent) => void;
  now?: () => number;
}

interface CustomModel {
  id: string;
  name: string;
  path: string;
  size: number;
}

export const GGUF_MAGIC = "GGUF";
/** Progress events at most this often (ms). */
const PROGRESS_EVERY_MS = 250;

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve());
  });
  return hash.digest("hex");
}

async function sizeOf(file: string): Promise<number | null> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

/** Whether a file starts with the GGUF magic. */
export async function isGguf(file: string): Promise<boolean> {
  try {
    const handle = await fs.open(file, "r");
    try {
      const buf = Buffer.alloc(4);
      await handle.read(buf, 0, 4, 0);
      return buf.toString("latin1") === GGUF_MAGIC;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

export class ModelManager {
  private readonly catalog: readonly ModelSpec[];
  private readonly fetchImpl: typeof fetch;
  private readonly customStore: JsonFileStore<CustomModel[]>;
  private readonly downloads = new Map<string, AbortController>();
  private readonly verifying = new Set<string>();

  constructor(private readonly options: ManagerOptions) {
    this.catalog = options.catalog ?? MODEL_CATALOG;
    this.fetchImpl = options.fetch ?? fetch;
    this.customStore = new JsonFileStore<CustomModel[]>(path.join(options.dir, "custom-models.json"));
  }

  private fileOf(spec: ModelSpec): string {
    return path.join(this.options.dir, spec.file);
  }

  private async customs(): Promise<CustomModel[]> {
    const list = await this.customStore.read();
    return Array.isArray(list) ? list.filter((m) => m && typeof m.id === "string" && typeof m.path === "string") : [];
  }

  /** The state of a catalog model on disk. */
  async entryOf(spec: ModelSpec, selectedId: string): Promise<ModelEntry> {
    const file = this.fileOf(spec);
    const size = await sizeOf(file);
    const part = await sizeOf(`${file}.part`);
    let state: ModelEntry["state"] = "missing";
    let downloaded = 0;
    if (this.downloads.has(spec.id)) {
      state = "downloading";
      downloaded = part ?? 0;
    } else if (this.verifying.has(spec.id)) {
      state = "verifying";
      downloaded = spec.size;
    } else if (size !== null) {
      const note = await fs.readFile(`${file}.sha256`, "utf8").catch(() => "");
      state = size === spec.size && note.trim() === spec.sha256 ? "ready" : "corrupt";
      downloaded = size;
    } else if (part !== null) {
      state = "partial";
      downloaded = part;
    }
    return {
      id: spec.id,
      name: spec.name,
      size: spec.size,
      sha256: spec.sha256,
      licence: spec.licence,
      licenceUrl: spec.licenceUrl,
      url: spec.url,
      state,
      downloaded,
      path: state === "ready" ? file : null,
      custom: false,
      selected: spec.id === selectedId,
    };
  }

  async list(selectedId: string): Promise<ModelEntry[]> {
    const entries = await Promise.all(this.catalog.map((spec) => this.entryOf(spec, selectedId)));
    for (const c of await this.customs()) {
      const size = await sizeOf(c.path);
      entries.push({ id: c.id, name: c.name, size: c.size, sha256: null, licence: "your file – check its licence", licenceUrl: "", url: null, state: size === null ? "missing" : "ready", downloaded: size ?? 0, path: size === null ? null : c.path, custom: true, selected: c.id === selectedId });
    }
    return entries;
  }

  /** The file of a model that is ready to load, else null. */
  async readyPath(id: string): Promise<string | null> {
    const entry = (await this.list(id)).find((e) => e.id === id);
    return entry?.state === "ready" ? entry.path : null;
  }

  private emit(event: ModelProgressEvent) {
    this.options.onProgress?.(event);
  }

  /** Downloads (or resumes) a catalog model and verifies it. Resolves with its entry; rejects on failure or cancel. */
  async download(id: string): Promise<ModelEntry> {
    const spec = this.catalog.find((m) => m.id === id);
    if (!spec) throw new Error(`Unknown model ${id}`);
    if (this.downloads.has(id)) throw new Error("This model is already downloading");
    const current = await this.entryOf(spec, "");
    if (current.state === "ready") return current;
    await fs.mkdir(this.options.dir, { recursive: true });
    const file = this.fileOf(spec);
    const part = `${file}.part`;
    // A complete file whose check failed is downloaded again.
    await fs.rm(file, { force: true });
    await fs.rm(`${file}.sha256`, { force: true });
    const controller = new AbortController();
    this.downloads.set(id, controller);
    const now = this.options.now ?? Date.now;
    try {
      let have = (await sizeOf(part)) ?? 0;
      if (have > spec.size) {
        await fs.rm(part, { force: true });
        have = 0;
      }
      if (have < spec.size) {
        // --- desktop-ai-fix --- a network failure says why (the cause codes explained)
        const response = await this.fetchImpl(spec.url, { headers: have > 0 ? { Range: `bytes=${have}-` } : {}, signal: controller.signal, redirect: "follow" }).catch((err: unknown) => {
          if (controller.signal.aborted) throw err;
          throw new Error(`Download failed: ${describeError(err)}`, { cause: err });
        });
        if (response.status === 416 && have > 0) {
          // The server says the range is past the end: the part is complete (or wrong – the checksum decides).
        } else if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
        else {
          const resumed = have > 0 && response.status === 206;
          if (!resumed) have = 0; // the server sent the whole file: start over
          const out = await fs.open(part, resumed ? "a" : "w");
          let lastEmit = 0;
          let windowStart = now();
          let windowBytes = 0;
          let rate = 0;
          try {
            const reader = response.body.getReader();
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              if (!value) continue;
              await out.write(value);
              have += value.byteLength;
              windowBytes += value.byteLength;
              const t = now();
              if (t - windowStart >= 1000) {
                rate = (windowBytes * 1000) / (t - windowStart);
                windowStart = t;
                windowBytes = 0;
              }
              if (t - lastEmit >= PROGRESS_EVERY_MS) {
                lastEmit = t;
                this.emit({ id, downloaded: have, size: spec.size, bytesPerSec: rate, state: "downloading" });
              }
              if (have > spec.size) throw new Error("The download is larger than the model should be");
            }
          } finally {
            await out.close();
          }
        }
      }
      this.downloads.delete(id);
      // Verify: the size, then the checksum over the whole file.
      this.verifying.add(id);
      this.emit({ id, downloaded: have, size: spec.size, bytesPerSec: 0, state: "verifying" });
      const size = (await sizeOf(part)) ?? 0;
      if (size !== spec.size) throw new Error(`Incomplete download (${size} of ${spec.size} bytes) – download again to resume`);
      const digest = await sha256File(part);
      if (digest !== spec.sha256) {
        await fs.rm(part, { force: true });
        throw new Error("Checksum mismatch – the damaged download was removed, download again");
      }
      await fs.rename(part, file);
      await fs.writeFile(`${file}.sha256`, digest, "utf8");
      this.verifying.delete(id);
      const entry = await this.entryOf(spec, "");
      this.emit({ id, downloaded: spec.size, size: spec.size, bytesPerSec: 0, state: "ready" });
      return entry;
    } catch (err) {
      const cancelled = controller.signal.aborted;
      const message = cancelled ? "cancelled" : describeError(err); // --- desktop-ai-fix --- (was err.message: the cause was lost)
      const partial = (await sizeOf(part)) ?? 0;
      this.emit({ id, downloaded: partial, size: spec.size, bytesPerSec: 0, state: partial > 0 ? "partial" : "missing", error: message });
      throw new Error(message);
    } finally {
      this.downloads.delete(id);
      this.verifying.delete(id);
    }
  }

  /** Stops a download; the part stays for a resume. */
  cancel(id: string): void {
    this.downloads.get(id)?.abort();
  }

  /** --- desktop-ai-fix --- Stops every download (the app is quitting); the parts stay for a resume. */
  cancelAll(): void {
    for (const controller of this.downloads.values()) controller.abort();
  }

  /** Adds a GGUF file the user picked (used in place). */
  async importFile(file: string): Promise<ModelEntry[]> {
    if (!(await isGguf(file))) throw new Error("Not a GGUF model file");
    const size = (await sizeOf(file)) ?? 0;
    const name = path.basename(file);
    const id = `custom:${name}`;
    const list = (await this.customs()).filter((c) => c.id !== id);
    list.push({ id, name, path: file, size });
    await this.customStore.write(list);
    return this.list(id);
  }

  /** Deletes a downloaded model (and its part), or forgets a picked file (the file itself stays). */
  async remove(id: string, selectedId: string): Promise<ModelEntry[]> {
    const spec = this.catalog.find((m) => m.id === id);
    if (spec) {
      this.cancel(id);
      const file = this.fileOf(spec);
      await Promise.all([file, `${file}.part`, `${file}.sha256`].map((f) => fs.rm(f, { force: true })));
    } else {
      await this.customStore.write((await this.customs()).filter((c) => c.id !== id));
    }
    return this.list(selectedId);
  }
}
