import { describe, expect, it } from "vitest";
import { defaultSettings } from "@/lib/settings";
import {
  EMPTY_QUEUE,
  MAX_ATTEMPTS,
  QUEUE_JOURNAL_FORMAT,
  RENDER_SHARE,
  cancelAll,
  cancelJob,
  clearFinished,
  enqueue,
  expandBatch,
  jobProgress,
  journalOf,
  markDone,
  markEncoding,
  markFailed,
  markProgress,
  markRendering,
  moveJob,
  nextJob,
  pauseQueue,
  queueSummary,
  removeJob,
  restoreQueue,
  retryFailed,
  retryJob,
  safeFileBase,
  startQueue,
  type QueueJobSpec,
  type QueueState,
} from "@/lib/desktop/renderQueue";

/* --- desktop-exe --- the desktop render queue's state machine and its crash-safe journal */

const spec = (name: string, seed = 7): QueueJobSpec => ({
  name,
  source: { kind: "seed" },
  settings: defaultSettings("classic"),
  seed,
  resolution: "1080x1920",
  fps: 60,
  codec: "h264",
  preset: "native",
  meta: { title: name, platform: null, hook: null, caption: null, hashtags: [] },
});

function ids() {
  let n = 0;
  return () => `job-${++n}`;
}

function queueOf(...names: string[]): QueueState {
  return enqueue(EMPTY_QUEUE, names.map((n) => spec(n)), 1000, ids());
}

describe("render queue state machine", () => {
  it("adds jobs with unique, safe names", () => {
    const q = enqueue(EMPTY_QUEUE, [spec("Ring escape!"), spec("ring escape!"), spec("")], 1, ids());
    expect(q.jobs.map((j) => j.name)).toEqual(["Ring-escape", "ring-escape-2", "clip"]);
    expect(q.jobs.every((j) => j.status === "queued" && j.progress === 0 && j.attempts === 0)).toBe(true);
    expect(safeFileBase("Łódź / día 3 ✨")).toBe("Lodz-dia-3");
  });

  it("runs one job at a time: rendering → encoding → done, with progress", () => {
    let q = startQueue(queueOf("a", "b"));
    const first = nextJob(q)!;
    expect(first.name).toBe("a");
    q = markRendering(q, first.id, 2000);
    expect(nextJob(q)).toBeNull(); // one at a time
    q = markProgress(q, first.id, jobProgress("rendering", 0.5, true), 2100);
    expect(q.jobs[0].progress).toBeCloseTo(0.5 * RENDER_SHARE);
    q = markProgress(q, first.id, 0.1, 2150); // never goes backwards
    expect(q.jobs[0].progress).toBeCloseTo(0.5 * RENDER_SHARE);
    q = markEncoding(q, first.id, 2200);
    expect(q.jobs[0].status).toBe("encoding");
    q = markProgress(q, first.id, jobProgress("encoding", 0.5, true), 2300);
    expect(q.jobs[0].progress).toBeCloseTo(RENDER_SHARE + 0.5 * (1 - RENDER_SHARE));
    q = markDone(q, first.id, { path: "C:/v/a.mp4", bytes: 123, durationSec: 12, encoder: "h264_nvenc" }, 2400);
    expect(q.jobs[0]).toMatchObject({ status: "done", progress: 1, attempts: 1 });
    expect(nextJob(q)?.name).toBe("b");
    expect(jobProgress("rendering", 0.5, false)).toBe(0.5);
  });

  it("pauses after the job in progress and resumes", () => {
    let q = startQueue(queueOf("a", "b"));
    q = markRendering(q, q.jobs[0].id, 1);
    q = pauseQueue(q);
    q = markDone(q, q.jobs[0].id, { path: "a", bytes: 1, durationSec: 1, encoder: null }, 2);
    expect(nextJob(q)).toBeNull();
    expect(queueSummary(q).idle).toBe(true);
    q = startQueue(q);
    expect(nextJob(q)?.name).toBe("b");
  });

  it("cancels, retries and removes jobs", () => {
    let q = startQueue(queueOf("a", "b", "c"));
    const [a, b, c] = q.jobs;
    q = markRendering(q, a.id, 1);
    q = cancelJob(q, a.id, 2);
    expect(q.jobs[0].status).toBe("cancelled");
    expect(nextJob(q)?.id).toBe(b.id);
    q = markRendering(q, b.id, 3);
    q = markFailed(q, b.id, "encoder crashed", 4);
    expect(q.jobs[1]).toMatchObject({ status: "failed", error: "encoder crashed" });
    q = retryJob(q, a.id, 5);
    expect(q.jobs[0]).toMatchObject({ status: "queued", error: null, progress: 0 });
    q = retryFailed(q, 6);
    expect(q.jobs[1].status).toBe("queued");
    expect(removeJob(markRendering(q, c.id, 7), c.id).jobs.length).toBe(3); // an active job stays
    q = removeJob(q, c.id);
    expect(q.jobs.map((j) => j.name)).toEqual(["a", "b"]);
    q = moveJob(q, b.id, -1);
    expect(q.jobs.map((j) => j.name)).toEqual(["b", "a"]);
    q = cancelAll(q, 8);
    expect(q.running).toBe(false);
    expect(q.jobs.every((j) => j.status === "cancelled")).toBe(true);
    expect(clearFinished(q).jobs).toEqual([]);
  });

  it("summarises the queue", () => {
    let q = startQueue(queueOf("a", "b", "c", "d"));
    const [a, b, c] = q.jobs;
    q = markRendering(q, a.id, 1);
    q = markDone(q, a.id, { path: "a", bytes: 1, durationSec: 1, encoder: null }, 2);
    q = markRendering(q, b.id, 3);
    q = markProgress(q, b.id, 0.5, 4);
    q = cancelJob(q, c.id, 5);
    expect(queueSummary(q)).toMatchObject({ total: 4, queued: 1, active: 1, done: 1, failed: 0, cancelled: 1, idle: false });
    expect(queueSummary(q).progress).toBeCloseTo((1 + 0.5 + 0) / 3);
  });

  it("expands a batch over resolutions, frame rates, codecs and presets", () => {
    const clips = [
      { name: "ring", source: { kind: "seed" as const }, settings: defaultSettings("classic"), seed: 1 },
      { name: "glass", source: { kind: "seed" as const }, settings: defaultSettings("glass"), seed: 2 },
    ];
    const specs = expandBatch(clips, { resolutions: ["1080x1920", "1920x1080"], fps: [30, 60], codecs: ["h264"], presets: ["native"] });
    expect(specs).toHaveLength(8);
    expect(specs.map((s) => s.name).slice(0, 4)).toEqual(["ring-1080x1920-30fps", "ring-1080x1920-60fps", "ring-1920x1080-30fps", "ring-1920x1080-60fps"]);
    // A platform preset renders at its own size and rate: its variants collapse.
    const platform = expandBatch(clips.slice(0, 1), { resolutions: ["1080x1920", "1920x1080"], fps: [30, 60], codecs: ["h264", "hevc"], presets: ["tiktok"] });
    expect(platform.map((s) => s.name)).toEqual(["ring-h264-tiktok", "ring-hevc-tiktok"]);
    expect(expandBatch(clips, { resolutions: ["999x1"], fps: [60], codecs: ["h264"], presets: ["native"] })).toEqual([]);
  });
});

describe("render journal", () => {
  it("round-trips and resumes an interrupted queue after a restart", () => {
    let q = startQueue(queueOf("a", "b", "c"));
    const [a, b] = q.jobs;
    q = markRendering(q, a.id, 1);
    q = markDone(q, a.id, { path: "C:/v/a.mp4", bytes: 9, durationSec: 12.5, encoder: "libx264" }, 2);
    q = markRendering(q, b.id, 3);
    q = markProgress(q, b.id, 0.4, 4);
    // The app stops here; the journal was written after the last change.
    const journal = JSON.parse(JSON.stringify(journalOf(q, 5)));
    expect(journal.format).toBe(QUEUE_JOURNAL_FORMAT);
    const { state, resumable, resumed } = restoreQueue(journal, 100);
    expect(resumable).toBe(true);
    expect(resumed).toBe(1);
    expect(state.running).toBe(false); // it waits for the user to resume
    expect(state.jobs.map((j) => j.status)).toEqual(["done", "queued", "queued"]);
    expect(state.jobs[0].output).toEqual({ path: "C:/v/a.mp4", bytes: 9, durationSec: 12.5, encoder: "libx264" });
    expect(state.jobs[1]).toMatchObject({ resumed: true, attempts: 1, progress: 0 });
    // Resumed: the interrupted job renders again first.
    const again = startQueue(state);
    expect(nextJob(again)?.id).toBe(b.id);
    expect(markRendering(again, b.id, 101).jobs[1].attempts).toBe(2);
  });

  it("gives up on a job interrupted too often", () => {
    let q = startQueue(queueOf("a"));
    const id = q.jobs[0].id;
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      q = markRendering(startQueue(q), id, i);
      q = restoreQueue(journalOf(q, i), i).state;
    }
    // MAX_ATTEMPTS − 1 tries were interrupted and put back; the last one interrupted fails the job.
    expect(q.jobs[0]).toMatchObject({ status: "queued", attempts: MAX_ATTEMPTS - 1 });
    q = markRendering(startQueue(q), id, 10);
    q = restoreQueue(journalOf(q, 11), 12).state;
    expect(q.jobs[0]).toMatchObject({ status: "failed", error: "interrupted" });
  });

  it("refuses foreign or newer journals and cleans damaged entries", () => {
    expect(restoreQueue(null, 1).state.jobs).toEqual([]);
    expect(restoreQueue({ format: "other", version: 1, jobs: [] }, 1).state.jobs).toEqual([]);
    expect(restoreQueue({ format: QUEUE_JOURNAL_FORMAT, version: 99, jobs: [] }, 1).state.jobs).toEqual([]);
    const { state } = restoreQueue(
      {
        format: QUEUE_JOURNAL_FORMAT,
        version: 1,
        running: false,
        jobs: [
          { id: "x", name: "../../evil", status: "done", seed: -5, resolution: "1x1", fps: 24, codec: "vp8", preset: "nope", settings: { mode: "portal", ballSpeed: 99999 } },
          { id: "x", name: "dup" },
          "garbage",
          { name: "no id" },
        ],
      },
      1,
    );
    expect(state.jobs).toHaveLength(1);
    const job = state.jobs[0];
    expect(job.name).toBe("evil");
    expect(job.status).toBe("queued"); // "done" without an output
    expect(job).toMatchObject({ seed: 1, resolution: "1080x1920", fps: 60, codec: "h264", preset: "native" });
    expect(job.settings.mode).toBe("portal");
    expect(job.settings.ballSpeed).toBe(99999); // --- uncap-all --- the project loader keeps any finite number (no slider maximum)
  });
});

describe("queue sources", async () => {
  const { planClip } = await import("@/lib/bot/planner");
  const { RECIPES } = await import("@/lib/bot/playbook");
  const en = (await import("../messages/en.json")).default as unknown as { ViralBot: Record<string, unknown> };
  const { aiClipSource, planSource, presetForPlatform, seedSource } = await import("@/lib/desktop/queueSources");
  const plan = planClip(RECIPES[1], 9, "tiktok", { copy: en.ViralBot, search: false });

  it("turns the page's setup, a bot plan and an AI clip into queue jobs", () => {
    const page = seedSource(defaultSettings("glass"), 42);
    expect(page).toMatchObject({ name: "glass-42", seed: 42, source: { kind: "seed" } });
    const bot = planSource(plan);
    expect(bot).toMatchObject({ name: plan.id, seed: plan.seed, source: { kind: "plan", recipe: plan.recipe }, meta: { platform: "tiktok", hook: plan.hook, link: plan.shareUrl } });
    expect(bot.meta?.hashtags).toEqual(plan.post.hashtags);
    const ai = aiClipSource({ planId: plan.id, name: "Pip Monday", title: "Pip!", hook: "Day 1", caption: "Will Pip make it?", hashtags: ["#pip", "#physics", "#asmr"], platform: "shorts" }, plan);
    expect(ai).toMatchObject({ name: "Pip Monday", settings: plan.settings, seed: plan.seed, meta: { platform: "shorts", caption: "Will Pip make it?" } });
    const specs = expandBatch([ai], { resolutions: ["1080x1920"], fps: [60], codecs: ["h264"], presets: [presetForPlatform("shorts")] });
    const q = enqueue(EMPTY_QUEUE, specs, 1, ids());
    expect(q.jobs[0]).toMatchObject({ name: "Pip-Monday-shorts", preset: "shorts", source: { kind: "ai" } });
    expect(presetForPlatform(null)).toBe("native");
  });
});
