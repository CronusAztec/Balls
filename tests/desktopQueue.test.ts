import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "@/lib/settings";
import { QUEUE_FPS_RANGE, chipQueueFps, commitQueueFps, queueFpsChips, type QueueFpsPick } from "@/lib/desktop/presets"; // --- insights --- (review fix) the frame-rate field's arrows
import { stepNumber } from "@/lib/uncap"; // --- insights --- (review fix) (the rates the field's arrow keys step through)
import { DEFAULT_CLIP_EDIT, type ClipEditSpec } from "@/lib/clipEdit/spec"; // --- ai-cut ---
import { clipCutOf } from "@/lib/desktop/ai/normalise"; // --- ai-cut ---
import {
  EMPTY_QUEUE,
  MAX_ATTEMPTS,
  QUEUE_JOURNAL_FORMAT,
  RENDER_SHARE,
  cancelAll,
  cancelJob,
  clearFinished,
  cutsPending,
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
    // --- ai-cut --- the done job whose TikTok cut still runs keeps its row (its bar and Cancel live there)
    expect(clearFinished(q, q.jobs[0].id).jobs.map((j) => j.id)).toEqual([q.jobs[0].id]);
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

  // --- ai-cut --- a job's master reaches the Library while the job renders or is saved, and its cut comes after it is done:
  // the autopilot's planner is told which jobs still owe a cut, so it never offers their master alone for TikTok
  it("names the jobs whose cut is still to come: one rendering or saved that carries a cut, and the done one being cut", () => {
    const cut: ClipEditSpec = { ...DEFAULT_CLIP_EDIT, startSec: 1 };
    let q = startQueue(enqueue(EMPTY_QUEUE, [{ ...spec("a"), cut }, spec("b"), { ...spec("c"), cut }], 1000, ids()));
    const [a, b, c] = q.jobs.map((j) => j.id);
    expect(cutsPending(q, null)).toEqual([]); // queued: no master yet
    q = markRendering(q, a, 2000);
    expect(cutsPending(q, null)).toEqual([a]);
    q = markEncoding(q, a, 2100); // saved through ffmpeg: the master is in the Library before the save returns
    expect(cutsPending(q, null)).toEqual([a]);
    q = markDone(q, a, { path: "C:/v/a.mp4", bytes: 1, durationSec: 12, encoder: null }, 2200);
    expect(cutsPending(q, null)).toEqual([]);
    expect(cutsPending(q, a)).toEqual([a]); // its cut is being made
    // a job without a cut owes none; the next one with a cut does while it renders
    q = markRendering(q, b, 2300);
    expect(cutsPending(q, a)).toEqual([a]);
    q = markDone(q, b, { path: "C:/v/b.mp4", bytes: 1, durationSec: 12, encoder: null }, 2400);
    q = markRendering(q, c, 2500);
    expect(cutsPending(q, null)).toEqual([c]);
    expect(cutsPending(q, c)).toEqual([c]);
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
          // (--- low-findings --- a seed past the engine's signed 32-bit range is damaged; a negative one is a found seed: kept below)
          { id: "x", name: "../../evil", status: "done", seed: 2 ** 40, resolution: "1x1", fps: 24, codec: "vp8", preset: "nope", settings: { mode: "portal", ballSpeed: 99999 } },
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
    // --- low-findings --- the finder's seeds are signed: a negative one is restored as it was journaled
    const found = restoreQueue({ format: QUEUE_JOURNAL_FORMAT, version: 1, running: false, jobs: [{ id: "y", name: "found", status: "queued", seed: -5, settings: { mode: "classic" } }] }, 1).state.jobs[0];
    expect(found.seed).toBe(-5);
  });

  // --- ai-cut --- a job's TikTok cut rides in the journal as it is (the field is additive: the version stays 1)
  it("keeps a job's cut across a restart, floors junk numbers in it and drops anything that is not a cut", () => {
    const cut: ClipEditSpec = { startSec: 2.5, lengthSec: 12, zoom: 1.4, hook: "Will it escape?", url: "jumpingballs.live", cardSec: 1 };
    let q = enqueue(EMPTY_QUEUE, [{ ...spec("a"), cut }, spec("b")], 1, ids());
    expect(q.jobs[0].cut).toEqual(cut);
    expect(q.jobs[1].cut).toBeUndefined();
    q = markRendering(startQueue(q), q.jobs[0].id, 2);
    q = markDone(q, q.jobs[0].id, { path: "C:/v/a.mp4", bytes: 9, durationSec: 16, encoder: null }, 3);
    const journal = JSON.parse(JSON.stringify(journalOf(q, 4)));
    expect(journal.version).toBe(1);
    const { state } = restoreQueue(journal, 100);
    expect(state.jobs[0]).toMatchObject({ status: "done", cut });
    expect(state.jobs[1].cut).toBeNull();
    // Journals written by hand or by an older build: junk numbers are floored (parseClipEdit), a non-object is no cut.
    const entry = (id: string, cut: unknown) => ({ id, name: id, status: "queued", seed: 1, settings: { mode: "classic" }, cut });
    const restored = restoreQueue({ format: QUEUE_JOURNAL_FORMAT, version: 1, running: false, jobs: [entry("junk", { startSec: -4, lengthSec: 1, zoom: 0.5, hook: 7, cardSec: -1, url: 3 }), entry("text", "yes"), entry("list", [1, 2]), entry("none", undefined)] }, 1).state.jobs;
    expect(restored[0].cut).toEqual({ startSec: 0, lengthSec: 3, zoom: 1, hook: DEFAULT_CLIP_EDIT.hook, url: DEFAULT_CLIP_EDIT.url, cardSec: 0 });
    expect(restored[1].cut).toBeNull();
    expect(restored[2].cut).toBeNull();
    expect(restored[3].cut).toBeNull();
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

  // --- uncap-all --- (review fix) a typed export frame rate rides through the queue as the page's own export takes it: a
  // Library re-render, the batch, the journal and the render (it became 30 or 60, so 45 rendered at 30 and 120 at 60)
  it("keeps a typed frame rate from 30 up through a re-render, the batch, the journal and the render", async () => {
    const { rerenderOptions } = await import("@/lib/desktop/queueSources");
    const { renderFormatFor } = await import("@/lib/desktop/presets");
    const clip = seedSource(defaultSettings("classic"), 5);
    for (const typed of [45, 90, 120, 59.94]) {
      const options = rerenderOptions({ recordingResolution: "1080x1920", fastExportFps: typed }, "h264", "native");
      expect(options).toEqual({ resolutions: ["1080x1920"], fps: [typed], codecs: ["h264"], presets: ["native"] });
      const [job] = enqueue(EMPTY_QUEUE, expandBatch([clip], options), 1, ids()).jobs;
      expect([typed, job.fps]).toEqual([typed, typed]);
      expect([typed, restoreQueue(journalOf({ jobs: [job], running: false }, 2), 3).state.jobs[0].fps]).toEqual([typed, typed]);
      expect(renderFormatFor(job.preset, job.resolution, job.fps)).toEqual({ resolution: "1080x1920", fps: typed });
    }
    // below the fast export's 30 a re-render renders at 30, as the page's export does; a platform preset keeps its own rate
    expect(rerenderOptions({ recordingResolution: "1080x1920", fastExportFps: 12 }, "h264", "native").fps).toEqual([30]);
    expect(renderFormatFor("reels", "1080x1920", 120)).toEqual({ resolution: "1080x1920", fps: 30 });
    // a rate that is no rate makes no job
    expect(expandBatch([clip], { resolutions: ["1080x1920"], fps: [24, Number.NaN, Infinity], codecs: ["h264"], presets: ["native"] })).toEqual([]);
  });

  // --- uncap-all --- (review fix) the add form's own frame rates: the 30 and 60 chips and the shared number field beside them,
  // which adds any other rate from 30 up as a chip of its own (the form offered only 30 and 60 while the queue renders any rate)
  it("lets the add form type any frame rate from 30 up beside the 30 and 60 chips, in en, pl and es", async () => {
    const { QUEUE_FPS_RANGE, pickQueueFps, queueFpsChips, renderFormatFor } = await import("@/lib/desktop/presets");
    const { FAST_EXPORT_RANGES } = await import("@/lib/recording/fastRenderPlan");
    expect(QUEUE_FPS_RANGE).toEqual(FAST_EXPORT_RANGES.fastExportFps); // (the page's own export field: from 30 up)
    expect(pickQueueFps([60], 45)).toEqual([60, 45]);
    expect(pickQueueFps([60, 45], 120)).toEqual([60, 45, 120]);
    expect(pickQueueFps([45, 60], 45)).toEqual([60, 45]); // (picked already: it moves last, where the field shows it)
    expect(pickQueueFps([30], 59.94)).toEqual([30, 59.94]);
    for (const junk of [24, 0, -60, Number.NaN, Infinity]) expect([junk, pickQueueFps([60], junk)]).toEqual([junk, [60]]);
    expect(queueFpsChips([60])).toEqual([30, 60]);
    expect(queueFpsChips([120, 60, 45, 59.94, 45])).toEqual([30, 60, 45, 59.94, 120]);
    // the picked rates make their jobs, and a typed one renders at its rate
    const clip = seedSource(defaultSettings("classic"), 5);
    const jobs = expandBatch([clip], { resolutions: ["1080x1920"], fps: pickQueueFps([60], 45), codecs: ["h264"], presets: ["native"] });
    expect(jobs.map((j) => j.fps)).toEqual([60, 45]);
    expect(renderFormatFor(jobs[1].preset, jobs[1].resolution, jobs[1].fps)).toEqual({ resolution: "1080x1920", fps: 45 });
    // the form: the two chips, the number field named by the frame rate and showing the rate picked last, and the line under them
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { NextIntlClientProvider } = await import("next-intl");
    (globalThis as { React?: unknown }).React = React; // (vitest compiles .tsx with the classic JSX runtime)
    const { default: QueuePanel } = await import("@/components/simulator/desktop/QueuePanel");
    const queue = { state: EMPTY_QUEUE, resumable: null, folder: "", cutting: null, lastError: null, add: () => 0, pendingCuts: () => [] } as unknown as React.ComponentProps<typeof QueuePanel>["queue"];
    const page = { settings: defaultSettings("classic"), busy: false, pageSeed: () => 1 } as unknown as React.ComponentProps<typeof QueuePanel>["page"];
    for (const locale of ["en", "pl", "es"] as const) {
      const messages = (await import(`../messages/${locale}.json`)).default as { Desktop: Record<string, string>; Uncap: Record<string, string> };
      const html = renderToStaticMarkup(
        React.createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, React.createElement(QueuePanel, { bridge: {} as React.ComponentProps<typeof QueuePanel>["bridge"], queue, page, folder: "", onFolder: () => {} })),
      ).replace(/&#x27;/g, "'");
      const field = /<input[^>]*data-number-field="queueFps"[^>]*>/.exec(html)?.[0] ?? "";
      expect([locale, field.match(/\saria-label="([^"]*)"/)?.[1], field.match(/\svalue="([^"]*)"/)?.[1], field.match(/\sdata-testid="([^"]*)"/)?.[1]]).toEqual([locale, messages.Uncap.fieldLabel.replace("{label}", messages.Desktop.queueFps), "60", "queue-fps"]);
      expect([locale, [...html.matchAll(/aria-pressed="(true|false)"[^>]*>(\d+(?:\.\d+)?) fps</g)].map((m) => `${m[2]}:${m[1]}`)]).toEqual([locale, ["30:false", "60:true"]]);
      expect([locale, html.includes(messages.Desktop.queueFpsTyped)]).toEqual([locale, true]);
    }
  });

  // --- insights --- (review fix) the field commits on every arrow press: three presses up picked 90, 120 and 150 and kept them
  it("lets the add form's frame-rate arrows edit the rate the field added, never pile up a rate per press", () => {
    const steps = (from: QueueFpsPick, ...values: number[]) => values.reduce((state, v) => commitQueueFps(state, v, "step"), from);
    const start: QueueFpsPick = { picked: [60], field: null };
    // the rates the field's own arrow keys step through from 60 (NumberField: stepNumber on the queue's range and floor)
    const arrow = (from: number, direction: 1 | -1) => stepNumber(from, direction, QUEUE_FPS_RANGE, { min: QUEUE_FPS_RANGE.min });
    expect([arrow(60, 1), arrow(90, 1), arrow(120, 1), arrow(120, -1), arrow(90, -1), arrow(60, -1), arrow(30, -1)]).toEqual([90, 120, 150, 90, 60, 30, 30]);
    // ↑ ↑ from 60 (the field steps 30 at a time: QUEUE_FPS_RANGE's step): 60 and the rate it shows
    const up = steps(start, 90, 120);
    expect(up).toEqual({ picked: [60, 120], field: 120 });
    expect(queueFpsChips(up.picked)).toEqual([30, 60, 120]);
    expect(steps(up, 150)).toEqual({ picked: [60, 150], field: 150 });
    // ↓ ↓ back to 60: 60 alone again, and a step down from it picks 30, which a step back up takes off
    const back = steps(up, 90, 60);
    expect(back).toEqual({ picked: [60], field: null });
    expect(steps(back, 30)).toEqual({ picked: [60, 30], field: 30 });
    expect(steps(back, 30, 60)).toEqual({ picked: [60], field: null });
    // typed rates still join the picked ones (the line under the field: "Type any other rate from 30 up to add it"), and the
    // arrows then edit the last one typed
    const typed = commitQueueFps(commitQueueFps(start, 45, "typed"), 120, "typed");
    expect(typed).toEqual({ picked: [60, 45, 120], field: 120 });
    expect(steps(typed, 150)).toEqual({ picked: [60, 45, 150], field: 150 });
    // a rate picked with a chip is never taken off by a step: the chip takes the field's rate over, and a step from a chip's rate adds
    const chipped = { picked: [60, 90], field: chipQueueFps({ picked: [60, 90], field: 90 }, 90) };
    expect(chipped.field).toBeNull();
    expect(steps(chipped, 120)).toEqual({ picked: [60, 90, 120], field: 120 });
    expect(chipQueueFps({ picked: [60, 90], field: 90 }, 30)).toBe(90);
    expect(steps({ picked: [60, 90, 30], field: 90 }, 60)).toEqual({ picked: [90, 30, 60], field: null }); // (the field showed 30, not its 90)
    // a rate that is no rate changes nothing
    expect(commitQueueFps(up, 24, "step")).toEqual(up);
    // what the panel does with them: the field tells a step from a typed rate, and the chips hand theirs over
    const panel = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "QueuePanel.tsx"), "utf8");
    expect(panel).toMatch(/onCommit=\{\(v, how\) => \{\s+const next = commitQueueFps\(\{ picked: fps, field: fieldFps \}, v, how \?\? "typed"\);/);
    expect(panel).toMatch(/toggle\(fps, f, setFps\);\s+setFieldFps\(chipQueueFps\(\{ picked: fps, field: fieldFps \}, f\)\)/);
    const field = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "NumberField.tsx"), "utf8");
    expect(field).toMatch(/onCommit\(next\.commit, event\.type === "step" \? "step" : "typed"\)/);
  });

  // --- ai-cut --- the cut the AI answered for a clip travels with it: source → every job of the batch → the queue
  it("carries an AI clip's TikTok cut into its jobs", () => {
    const cut: ClipEditSpec = { startSec: 3, lengthSec: 11.5, zoom: 1.25, hook: "Will Pip make it?", url: "jumpingballs.live", cardSec: 1.5 };
    const made = { planId: plan.id, name: "Pip Monday", title: "Pip!", hook: "Day 1", caption: "Will Pip make it?", hashtags: ["#pip"], platform: "tiktok" as const };
    expect(aiClipSource(made, plan).cut).toBeNull();
    const answered = clipCutOf(cut); // the model answers five fields: the address is never its to write
    const ai = aiClipSource({ ...made, cut: answered }, plan);
    expect(ai.cut).toEqual({ ...cut, url: DEFAULT_CLIP_EDIT.url });
    const specs = expandBatch([ai], { resolutions: ["1080x1920"], fps: [60], codecs: ["h264", "hevc"], presets: [presetForPlatform("tiktok")] });
    expect(specs).toHaveLength(2);
    expect(specs.every((s) => s.cut === ai.cut)).toBe(true);
    expect(enqueue(EMPTY_QUEUE, specs, 1, ids()).jobs[1]).toMatchObject({ name: "Pip-Monday-hevc-tiktok", cut: ai.cut });
    // A clip without one: no cut, never undefined (the journal and the page read `null`).
    expect(expandBatch([planSource(plan)], { resolutions: ["1080x1920"], fps: [60], codecs: ["h264"], presets: ["native"] })[0].cut).toBeNull();
  });
});
