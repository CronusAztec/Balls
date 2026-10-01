import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { LibraryItem, LibraryMeta } from "@/lib/desktop/contract";
import { JsonFileStore } from "./journal";

/*
 * --- desktop-exe --- The Library: every clip the render queue saved, kept in library.json (crash-safe) with its thumbnail
 * (a JPEG in the data folder, handed to the page as a data: URL), length, size, the encoder that wrote it and what it was
 * made from (mode, seed, the simulator link that re-renders it, the post copy). A clip deleted outside the app shows as
 * missing; deleting from the app moves the file to the recycle bin.
 */

export type StoredItem = Omit<LibraryItem, "thumbnail" | "exists"> & { thumbnailFile: string | null };

export const MAX_LIBRARY_ITEMS = 2000;

export function uniquePath(folder: string, base: string, extension: string, taken: (p: string) => boolean): string {
  let candidate = path.join(folder, `${base}.${extension}`);
  for (let n = 2; taken(candidate); n++) candidate = path.join(folder, `${base}-${n}.${extension}`);
  return candidate;
}

export class Library {
  private readonly store: JsonFileStore<StoredItem[]>;

  constructor(file: string, private readonly thumbsDir: string) {
    this.store = new JsonFileStore<StoredItem[]>(file);
  }

  private async items(): Promise<StoredItem[]> {
    const list = await this.store.read();
    return Array.isArray(list) ? list.filter((i) => i && typeof i.id === "string" && typeof i.path === "string") : [];
  }

  async add(entry: { path: string; bytes: number; durationSec: number | null; width: number | null; height: number | null; encoder: string | null; meta: LibraryMeta; thumbnailFile: string | null }, now = Date.now()): Promise<LibraryItem> {
    const item: StoredItem = { id: randomUUID(), fileName: path.basename(entry.path), createdAt: now, ...entry };
    const list = [item, ...(await this.items()).filter((i) => i.path !== entry.path)].slice(0, MAX_LIBRARY_ITEMS);
    await this.store.write(list);
    return this.present(item);
  }

  thumbnailPathFor(id: string): string {
    return path.join(this.thumbsDir, `${id}.jpg`);
  }

  private async present(item: StoredItem): Promise<LibraryItem> {
    const { thumbnailFile, ...rest } = item;
    let thumbnail: string | null = null;
    if (thumbnailFile) {
      const data = await fs.readFile(thumbnailFile).catch(() => null);
      if (data) thumbnail = `data:image/jpeg;base64,${data.toString("base64")}`;
    }
    const exists = await fs.stat(item.path).then((s) => s.isFile()).catch(() => false);
    return { ...rest, thumbnail, exists };
  }

  async list(): Promise<LibraryItem[]> {
    return Promise.all((await this.items()).map((i) => this.present(i)));
  }

  async get(id: string): Promise<StoredItem | undefined> {
    return (await this.items()).find((i) => i.id === id);
  }

  /** Forgets a clip (and its thumbnail); `trash` moves the video itself to the recycle bin when asked. */
  async remove(id: string, deleteFile: boolean, trash: (file: string) => Promise<void>): Promise<LibraryItem[]> {
    const list = await this.items();
    const item = list.find((i) => i.id === id);
    if (item) {
      if (deleteFile) await trash(item.path).catch(() => {});
      if (item.thumbnailFile) await fs.rm(item.thumbnailFile, { force: true }).catch(() => {});
      await this.store.write(list.filter((i) => i.id !== id));
    }
    return this.list();
  }
}
