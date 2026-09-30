import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { JsonFileStore } from "../src/journal";
import { defaultSettings } from "@/lib/settings";
import { EMPTY_QUEUE, cancelJob, enqueue, journalOf, markDone, markEncoding, markFailed, markProgress, markRendering, nextJob, queueSummary, restoreQueue, retryJob, startQueue, type QueueJobSpec } from "@/lib/desktop/renderQueue";

/* --- desktop-exe --- the render queue as the app runs it: state machine + the crash-safe journal file, across a restart */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-journal-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const spec = (name: string, seed: number): QueueJobSpec => ({ name, source: { kind: "seed" }, settings: defaultSettings("classic"), seed, resolution: "1080x1920", fps: 60, codec: "h264", preset: "tiktok", meta: { title: name, platform: "tiktok", hook: null, caption: null, hashtags: ["#physics"] } });

describe("crash-safe journal file", () => {
  it("writes atomically and falls back to the backup when the file is damaged", async () => {
    const store = new JsonFileStore<{ n: number }>(path.join(dir, "j.json"));
    expect(await store.read()).toBeNull();
    await store.write({ n: 1 });
    await Promise.all([store.write({ n: 2 }), store.write({ n: 3 })]);
    expect(await store.read()).toEqual({ n: 3 });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "j.json.bak"), "utf8"))).toEqual({ n: 2 });
    expect(fs.existsSync(path.join(dir, "j.json.tmp"))).toBe(false);
    // A crash mid-write of some other program, or a disk hiccup: the main file is garbage.
    fs.writeFileSync(path.join(dir, "j.json"), '{"n": 4');
    expect(await store.read()).toEqual({ n: 2 });
  });

  it("resumes a queue after a restart: done stays done, the interrupted job renders again", async () => {
    const file = path.join(dir, "render-journal.json");
    let n = 0;
    let q = startQueue(enqueue(EMPTY_QUEUE, [spec("a", 1), spec("b", 2), spec("c", 3)], 1, () => `j${++n}`));
    const store = new JsonFileStore(file);
    const save = () => store.write(journalOf(q, Date.now()));
    // Job a: rendered, encoded, saved.
    q = markRendering(q, nextJob(q)!.id, 2);
    q = markEncoding(q, "j1", 3);
    q = markDone(q, "j1", { path: path.join(dir, "a.mp4"), bytes: 10, durationSec: 12, encoder: "h264_nvenc" }, 4);
    await save();
    // Job b: rendering when the app is killed.
    q = markRendering(q, nextJob(q)!.id, 5);
    q = markProgress(q, "j2", 0.3, 6);
    await save();

    // --- restart ---
    const restored = restoreQueue(await new JsonFileStore(file).read(), 100);
    expect(restored.resumable).toBe(true);
    let r = startQueue(restored.state);
    expect(r.jobs.map((j) => j.status)).toEqual(["done", "queued", "queued"]);
    const next = nextJob(r)!;
    expect(next.id).toBe("j2");
    expect(next.resumed).toBe(true);
    r = markRendering(r, next.id, 101);
    r = markFailed(r, next.id, "GPU lost", 102);
    expect(queueSummary(r)).toMatchObject({ done: 1, failed: 1, queued: 1 });
    r = retryJob(r, "j2", 103);
    r = cancelJob(r, "j3", 104);
    expect(nextJob(r)?.id).toBe("j2");
  });
});

