import fs from "fs/promises";
import path from "path";

/*
 * --- desktop-exe --- A crash-safe JSON file (the render journal, the library index). A write goes to `<file>.tmp`, is
 * flushed to disk, the current file becomes `<file>.bak` and the temporary file is renamed over it – so a crash or a power
 * cut at any moment leaves either the old or the new file whole. Reading falls back to the backup when the file is
 * missing or damaged. Writes are serialised: the last one wins, none interleave.
 */
export class JsonFileStore<T = unknown> {
  private chain: Promise<void> = Promise.resolve();

  constructor(readonly file: string) {}

  get backup(): string {
    return `${this.file}.bak`;
  }

  /** The stored value, the backup's when the file is damaged, else null. */
  async read(): Promise<T | null> {
    for (const candidate of [this.file, this.backup]) {
      try {
        return JSON.parse(await fs.readFile(candidate, "utf8")) as T;
      } catch {
        /* missing or damaged: try the next */
      }
    }
    return null;
  }

  write(value: T): Promise<void> {
    const text = JSON.stringify(value);
    const next = this.chain.then(() => this.writeNow(text));
    this.chain = next.catch(() => {});
    return next;
  }

  private async writeNow(text: string): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const handle = await fs.open(tmp, "w");
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.copyFile(this.file, this.backup);
    } catch {
      /* first write: nothing to back up */
    }
    await fs.rename(tmp, this.file);
  }
}
