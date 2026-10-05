import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { ModelManager, isGguf } from "../src/models/manager";
import { DEFAULT_MODEL_ID, MODEL_CATALOG, modelById, type ModelSpec } from "../src/models/catalog";
import type { ModelProgressEvent } from "@/lib/desktop/contract";

/* --- desktop-exe --- the model manager with a fake download server: progress, resume, checksum, picked files */

const payload = Buffer.concat([Buffer.from("GGUF"), Buffer.alloc(200_000, 7)]);
const spec: ModelSpec = {
  id: "tiny",
  name: "Tiny",
  file: "tiny.gguf",
  url: "https://models.example/tiny.gguf",
  size: payload.length,
  sha256: createHash("sha256").update(payload).digest("hex"),
  licence: "Apache-2.0",
  licenceUrl: "https://example/licence",
  commercial: true,
  params: "1M",
};

interface FakeServer {
  fetch: typeof fetch;
  requests: { range: string | null }[];
}

/** Serves `body` in 10 kB chunks, honours Range (unless told not to) and can cut the connection after `cutAfter` bytes. */
function server(body: Buffer, options: { honourRange?: boolean; cutAfter?: number } = {}): FakeServer {
  const requests: { range: string | null }[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const range = headers.get("range");
    requests.push({ range });
    let start = 0;
    let status = 200;
    if (range && options.honourRange !== false) {
      start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
      if (start >= body.length) return new Response(null, { status: 416 });
      status = 206;
    }
    const slice = body.subarray(start);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (init?.signal?.aborted) {
          controller.error(new DOMException("aborted", "AbortError"));
          return;
        }
        if (options.cutAfter !== undefined && sent >= options.cutAfter) {
          controller.error(new Error("connection reset"));
          return;
        }
        if (sent >= slice.length) {
          controller.close();
          return;
        }
        const chunk = slice.subarray(sent, Math.min(slice.length, sent + 10_000));
        sent += chunk.length;
        controller.enqueue(new Uint8Array(chunk));
      },
    });
    return new Response(stream, { status });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, requests };
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-models-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("model catalog", () => {
  it("lists real GGUF files with sizes, checksums and licences", () => {
    expect(modelById(DEFAULT_MODEL_ID)?.commercial).toBe(true);
    for (const m of MODEL_CATALOG) {
      expect(m.url).toMatch(/^https:\/\/huggingface\.co\/.+\.gguf$/);
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.size).toBeGreaterThan(500_000_000);
      expect(m.licence.length).toBeGreaterThan(3);
    }
    expect(modelById("qwen2.5-3b-instruct-q4km")?.commercial).toBe(false);
  });
});

describe("model manager", () => {
  it("downloads with progress, verifies the checksum and reports ready", async () => {
    const events: ModelProgressEvent[] = [];
    let t = 0;
    const s = server(payload);
    const m = new ModelManager({ dir, catalog: [spec], fetch: s.fetch, onProgress: (e) => events.push(e), now: () => (t += 300) });
    expect((await m.list(""))[0].state).toBe("missing");
    const entry = await m.download("tiny");
    expect(entry.state).toBe("ready");
    expect(fs.readFileSync(path.join(dir, "tiny.gguf")).equals(payload)).toBe(true);
    expect(fs.readFileSync(path.join(dir, "tiny.gguf.sha256"), "utf8")).toBe(spec.sha256);
    expect(events.some((e) => e.state === "downloading" && e.downloaded > 0 && e.downloaded < spec.size)).toBe(true);
    expect(events.at(-1)).toMatchObject({ state: "ready", downloaded: spec.size });
    expect(await m.readyPath("tiny")).toBe(path.join(dir, "tiny.gguf"));
    // Ready: no second download.
    await m.download("tiny");
    expect(s.requests).toHaveLength(1);
  });

  it("resumes an interrupted download with a Range request", async () => {
    const cut = server(payload, { cutAfter: 60_000 });
    const m1 = new ModelManager({ dir, catalog: [spec], fetch: cut.fetch });
    await expect(m1.download("tiny")).rejects.toThrow(/connection reset/);
    const partial = (await m1.list(""))[0];
    expect(partial.state).toBe("partial");
    expect(partial.downloaded).toBe(60_000);
    const s = server(payload);
    const m2 = new ModelManager({ dir, catalog: [spec], fetch: s.fetch });
    expect((await m2.download("tiny")).state).toBe("ready");
    expect(s.requests[0].range).toBe("bytes=60000-");
    expect(fs.readFileSync(path.join(dir, "tiny.gguf")).equals(payload)).toBe(true);
  });

  it("starts over when the server ignores the range", async () => {
    fs.writeFileSync(path.join(dir, "tiny.gguf.part"), payload.subarray(0, 50_000));
    const s = server(payload, { honourRange: false });
    const m = new ModelManager({ dir, catalog: [spec], fetch: s.fetch });
    expect((await m.download("tiny")).state).toBe("ready");
    expect(fs.statSync(path.join(dir, "tiny.gguf")).size).toBe(spec.size);
  });

  it("removes a download whose checksum does not match", async () => {
    const bad = Buffer.from(payload);
    bad[1000] ^= 0xff;
    const m = new ModelManager({ dir, catalog: [spec], fetch: server(bad).fetch });
    await expect(m.download("tiny")).rejects.toThrow(/Checksum mismatch/);
    expect(fs.existsSync(path.join(dir, "tiny.gguf"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "tiny.gguf.part"))).toBe(false);
    expect((await m.list(""))[0].state).toBe("missing");
  });

  it("cancels, keeping the part for a resume", async () => {
    const s = server(payload);
    const m = new ModelManager({ dir, catalog: [spec], fetch: s.fetch, onProgress: (e) => e.state === "downloading" && m.cancel("tiny") });
    await expect(m.download("tiny")).rejects.toThrow(/cancelled/);
    expect((await m.list(""))[0].state).toBe("partial");
  });

  // --- review fix (desktop-ai-fix) --- the ready hook (main.ts selects the download there) runs before the "ready" event the
  // page refreshes on – also for a model that was already there – and a failing hook never fails a verified download
  it("runs the ready hook before the ready event, and a failing hook never fails the download", async () => {
    const order: string[] = [];
    const m: ModelManager = new ModelManager({
      dir,
      catalog: [spec],
      fetch: server(payload).fetch,
      onProgress: (e) => void (e.state === "ready" && order.push("ready event")),
      onReady: async (id) => {
        const state = (await m.list("")).find((e) => e.id === id)?.state;
        order.push(`hook ${id} (${state}, ${fs.existsSync(path.join(dir, "tiny.gguf.sha256")) ? "checked" : "unchecked"})`);
      },
    });
    await m.download("tiny");
    order.push("returned");
    await m.download("tiny"); // already there
    order.push("returned");
    expect(order).toEqual(["hook tiny (ready, checked)", "ready event", "returned", "hook tiny (ready, checked)", "ready event", "returned"]);
    await m.remove("tiny", "");
    const events: ModelProgressEvent[] = [];
    const failing = new ModelManager({
      dir,
      catalog: [spec],
      fetch: server(payload).fetch,
      onProgress: (e) => events.push(e),
      onReady: () => {
        throw new Error("the settings file is locked");
      },
    });
    expect((await failing.download("tiny")).state).toBe("ready");
    expect(events.at(-1)).toMatchObject({ id: "tiny", state: "ready", downloaded: spec.size });
    expect(events.some((e) => e.error)).toBe(false);
    // A download that fails never runs the hook.
    await failing.remove("tiny", "");
    let hooked = 0;
    const broken = new ModelManager({ dir, catalog: [spec], fetch: server(Buffer.from("GGUF not the model")).fetch, onReady: () => void hooked++ });
    await expect(broken.download("tiny")).rejects.toThrow(/Incomplete download|Checksum mismatch/);
    expect(hooked).toBe(0);
  });

  it("marks a file that fails its check as corrupt and uses picked GGUF files in place", async () => {
    fs.writeFileSync(path.join(dir, "tiny.gguf"), payload.subarray(0, 10));
    const m = new ModelManager({ dir, catalog: [spec], fetch: server(payload).fetch });
    expect((await m.list(""))[0].state).toBe("corrupt");
    const mine = path.join(dir, "my-model.gguf");
    fs.writeFileSync(mine, payload);
    const notGguf = path.join(dir, "notes.gguf");
    fs.writeFileSync(notGguf, "hello");
    expect(await isGguf(mine)).toBe(true);
    await expect(m.importFile(notGguf)).rejects.toThrow(/Not a GGUF/);
    const list = await m.importFile(mine);
    const custom = list.find((e) => e.custom)!;
    expect(custom).toMatchObject({ id: "custom:my-model.gguf", state: "ready", path: mine, selected: true });
    expect(await m.readyPath("custom:my-model.gguf")).toBe(mine);
    const after = await m.remove("custom:my-model.gguf", "");
    expect(after.some((e) => e.custom)).toBe(false);
    expect(fs.existsSync(mine)).toBe(true); // a picked file is never deleted
    await m.remove("tiny", "");
    expect(fs.existsSync(path.join(dir, "tiny.gguf"))).toBe(false);
  });
});
