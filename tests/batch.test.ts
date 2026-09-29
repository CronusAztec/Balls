import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  BATCH_LIST_MAX_CHARS,
  BATCH_STORAGE_KEY,
  MAX_BATCH_JOBS,
  MAX_SEED,
  SWEEP_KEYS,
  batchFileBase,
  batchJobCount,
  batchVariants,
  batchZipBase,
  defaultBatchDefinition,
  formatClipSeconds,
  formatElapsed,
  keepExportFormat,
  linkParams,
  linkSeed,
  loadBatchDefinition,
  parseBatchDefinition,
  parseBatchList,
  parseSeed,
  planBatch,
  randomSeeds,
  resolveLinkSettings,
  sameSettings,
  saveBatchDefinition,
  snapToRange,
  sweepRange,
  sweepSettings,
  sweepValues,
  uniqueFileBase,
  type BatchDefinition,
} from "@/lib/recording/batch";
import { MODE_CARD_ORDER } from "@/lib/modes";
import { RANGES, defaultSettings, settingsToSearchParams } from "@/lib/settings";
import { encodeShareCode, shareCodeUrl } from "@/lib/shareCode";
import { seededRandom } from "@/lib/recording/fastRenderPlan";

/* --- batch-render --- the pure side of the batch render: definition, pasted list, variants, plan, names */

const def = (patch: Partial<BatchDefinition> = {}): BatchDefinition => ({ ...defaultBatchDefinition(), ...patch });
const LINK = "https://cronusaztec.github.io/Balls/en/simulator/?mode=portal&g=500";

describe("batch definition", () => {
  it("defaults to three random seeds, no variants, every mode picked, clips downloaded one by one", () => {
    const d = defaultBatchDefinition();
    expect(d).toMatchObject({ source: "random", count: 3, list: "", variant: "none", sweepKey: "gravity", sweepSteps: 3, downloadEach: true });
    expect(d.modes).toEqual(MODE_CARD_ORDER);
    expect(d.sweepFrom).toBe(RANGES.gravity.min);
    expect(d.sweepTo).toBe(RANGES.gravity.max);
  });

  it("round-trips through JSON and validates what comes back", () => {
    const d = def({ source: "list", count: 7, list: "1\n2", variant: "sweep", modes: ["portal", "classic"], sweepKey: "ballSpeed", sweepFrom: 200, sweepTo: 600, sweepSteps: 5, downloadEach: false });
    expect(parseBatchDefinition(JSON.parse(JSON.stringify({ v: 1, ...d })))).toEqual(d);
    const bad = parseBatchDefinition({ source: "web", count: 999, list: 42, variant: "all", modes: ["classic", "nope", "classic", 3], sweepKey: "bogus", sweepFrom: "x", sweepTo: 1e9, sweepSteps: 0, downloadEach: "yes" });
    expect(bad).toEqual({ ...defaultBatchDefinition(), count: MAX_BATCH_JOBS, modes: ["classic"], sweepSteps: 2, sweepTo: RANGES.gravity.max });
    expect(parseBatchDefinition(null)).toEqual(defaultBatchDefinition());
    expect(parseBatchDefinition([1, 2])).toEqual(defaultBatchDefinition());
    expect(parseBatchDefinition({ list: "x".repeat(BATCH_LIST_MAX_CHARS + 50) }).list.length).toBe(BATCH_LIST_MAX_CHARS);
    // The sweep's ends are clamped to the swept setting's range.
    expect(parseBatchDefinition({ sweepKey: "gapSize", sweepFrom: -3, sweepTo: 9 })).toMatchObject({ sweepFrom: RANGES.gapSize.min, sweepTo: RANGES.gapSize.max });
  });

  describe("localStorage", () => {
    const store = new Map<string, string>();
    beforeEach(() => {
      store.clear();
      (globalThis as unknown as { window: unknown }).window = globalThis;
      (globalThis as unknown as { localStorage: Storage }).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: () => null,
        length: 0,
      } as Storage;
    });

    afterAll(() => {
      delete (globalThis as unknown as { window?: unknown }).window;
      delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    });

    it("keeps the last definition", () => {
      expect(loadBatchDefinition()).toEqual(defaultBatchDefinition());
      const d = def({ source: "list", list: "12\n34", variant: "modes", modes: ["shatter"] });
      saveBatchDefinition(d);
      expect(JSON.parse(store.get(BATCH_STORAGE_KEY) ?? "{}").v).toBe(1);
      expect(loadBatchDefinition()).toEqual(d);
    });

    it("falls back to the defaults on damaged storage and survives a storage that throws", () => {
      store.set(BATCH_STORAGE_KEY, "{not json");
      expect(loadBatchDefinition()).toEqual(defaultBatchDefinition());
      (globalThis as unknown as { localStorage: Storage }).localStorage = {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("quota");
        },
      } as unknown as Storage;
      expect(loadBatchDefinition()).toEqual(defaultBatchDefinition());
      expect(() => saveBatchDefinition(defaultBatchDefinition())).not.toThrow();
    });
  });
});

describe("pasted list", () => {
  it("reads seeds, links, links with seeds, comments and bad lines", () => {
    const text = ["123", "", "# a comment", "4, 5;6", LINK, `${LINK}&seed=77`, `?c=abc 9 10`, "hello", `${LINK} ${LINK}`, "99999999999", "https://example.com/page", "  42  "].join("\n");
    const { entries, invalidLines } = parseBatchList(text);
    expect(entries).toEqual([
      { line: 1, seed: 123, link: null },
      { line: 4, seed: 4, link: null },
      { line: 4, seed: 5, link: null },
      { line: 4, seed: 6, link: null },
      { line: 5, seed: null, link: LINK },
      { line: 6, seed: 77, link: `${LINK}&seed=77` },
      { line: 7, seed: 9, link: "?c=abc" },
      { line: 7, seed: 10, link: "?c=abc" },
      { line: 12, seed: 42, link: null },
    ]);
    expect(invalidLines).toEqual([8, 9, 10, 11]);
  });

  it("accepts seeds up to 2^31 - 1 only", () => {
    expect(parseSeed("0")).toBe(0);
    expect(parseSeed(String(MAX_SEED))).toBe(MAX_SEED);
    expect(parseSeed(String(MAX_SEED + 1))).toBeNull();
    expect(parseSeed("-1")).toBeNull();
    expect(parseSeed("1.5")).toBeNull();
    expect(parseSeed(null)).toBeNull();
  });

  it("recognises simulator links (long or short) and their seed", () => {
    expect(linkParams(LINK)?.get("g")).toBe("500");
    expect(linkParams("?c=xyz")?.get("c")).toBe("xyz");
    expect(linkParams("/Balls/pl/simulator/?mode=shatter")?.get("mode")).toBe("shatter");
    expect(linkParams("https://example.com/?q=1")).toBeNull();
    expect(linkSeed(`${LINK}&seed=31337`)).toBe(31337);
    expect(linkSeed(`${LINK}&seed=abc`)).toBeNull();
    expect(linkSeed(LINK)).toBeNull();
  });
});

describe("variants", () => {
  it("sweeps on the setting's slider: snapped, clamped, both ends, no repeats", () => {
    expect(sweepValues("gravity", 0, 600, 4)).toEqual([0, 200, 400, 600]);
    expect(sweepValues("gravity", 600, 0, 3)).toEqual([600, 300, 0]);
    expect(sweepValues("gapSize", 0.1, 0.4, 4)).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(sweepValues("wallCount", 3, 5, 12)).toEqual([3, 4, 5]);
    expect(sweepValues("ballSpeed", -100, 5000, 2)).toEqual([RANGES.ballSpeed.min, RANGES.ballSpeed.max]);
    expect(sweepValues("gravity", 100, 200, 1)).toEqual([100, 200]); // at least two steps
    expect(snapToRange(0.123456, { min: 0, max: 0.05, step: 0.001 })).toBe(0.05);
    expect(snapToRange(0.0234, { min: 0, max: 0.05, step: 0.001 })).toBe(0.023);
    expect(snapToRange(Number.NaN, { min: 4, max: 30, step: 1 })).toBe(4);
  });

  it("only sweeps numeric settings that have a range", () => {
    const d = defaultSettings();
    for (const key of SWEEP_KEYS) {
      expect(typeof d[key]).toBe("number");
      expect(sweepRange(key)).toEqual(RANGES[key]);
    }
  });

  it("renders every picked mode in card order, or the sweep's values, or the seed as is", () => {
    expect(batchVariants(def())).toEqual([{ kind: "none" }]);
    expect(batchVariants(def({ variant: "modes", modes: ["shatter", "classic"] }))).toEqual([
      { kind: "mode", mode: "classic" },
      { kind: "mode", mode: "shatter" },
    ]);
    expect(batchVariants(def({ variant: "modes", modes: [] }))).toEqual([]);
    expect(batchVariants(def({ variant: "sweep", sweepKey: "ballRadius", sweepFrom: 5, sweepTo: 15, sweepSteps: 3 }))).toEqual([
      { kind: "sweep", key: "ballRadius", value: 5 },
      { kind: "sweep", key: "ballRadius", value: 10 },
      { kind: "sweep", key: "ballRadius", value: 15 },
    ]);
  });
});

describe("plan", () => {
  it("renders every seed in every variant, seed by seed", () => {
    const list = parseBatchList("11\n22");
    const { jobs, truncated } = planBatch(def({ source: "list", variant: "modes", modes: ["classic", "portal"] }), list);
    expect(truncated).toBe(false);
    expect(jobs.map((j) => [j.id, j.seed, j.variant.kind === "mode" ? j.variant.mode : ""])).toEqual([
      [1, 11, "classic"],
      [2, 11, "portal"],
      [3, 22, "classic"],
      [4, 22, "portal"],
    ]);
    expect(batchJobCount(def({ source: "list", variant: "modes", modes: ["classic", "portal"] }), list)).toEqual({ count: 4, requested: 4, truncated: false });
  });

  it("draws distinct random seeds, reproducibly for a seeded generator, and gives unseeded links a seed", () => {
    const a = planBatch(def({ count: 5 }), parseBatchList(""), seededRandom(1));
    const b = planBatch(def({ count: 5 }), parseBatchList(""), seededRandom(1));
    expect(a).toEqual(b);
    expect(new Set(a.jobs.map((j) => j.seed)).size).toBe(5);
    for (const job of a.jobs) {
      expect(job.seed).toBeGreaterThanOrEqual(1);
      expect(job.seed).toBeLessThan(MAX_SEED);
      expect(job.link).toBeNull();
    }
    const linked = planBatch(def({ source: "list" }), parseBatchList(`${LINK}\n${LINK}&seed=5`), seededRandom(2)).jobs;
    expect(linked[0].link).toBe(LINK);
    expect(linked[0].seed).toBeGreaterThan(0);
    expect(linked[1].seed).toBe(5);
    expect(randomSeeds(3, () => 0.5)).toHaveLength(1); // a generator stuck on one value cannot give three different seeds
  });

  it("caps a batch at MAX_BATCH_JOBS", () => {
    const d = def({ count: 40, variant: "sweep", sweepSteps: 3 });
    expect(batchJobCount(d, parseBatchList(""))).toEqual({ count: MAX_BATCH_JOBS, requested: 120, truncated: true });
    const { jobs, truncated } = planBatch(d, parseBatchList(""), seededRandom(3));
    expect(truncated).toBe(true);
    expect(jobs).toHaveLength(MAX_BATCH_JOBS);
    expect(jobs.map((j) => j.id)).toEqual(Array.from({ length: MAX_BATCH_JOBS }, (_, i) => i + 1));
  });

  it("has nothing to render without seeds or without modes", () => {
    expect(planBatch(def({ source: "list" }), parseBatchList("oops")).jobs).toEqual([]);
    expect(planBatch(def({ variant: "modes", modes: [] }), parseBatchList("")).jobs).toEqual([]);
    expect(batchJobCount(def({ variant: "modes", modes: [] }), parseBatchList("")).count).toBe(0);
  });
});

describe("job settings", () => {
  it("opens a long link like the page does", async () => {
    const r = await resolveLinkSettings(`${LINK}&seed=4`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.mode).toBe("portal");
      expect(r.settings.gravity).toBe(500);
    }
    expect(await resolveLinkSettings("https://example.com/")).toEqual({ ok: false, error: "invalid" });
  });

  it("opens a short ?c= link, its other parameters on top", async () => {
    const settings = { ...defaultSettings("shatter"), wallCount: 12, ballSpeed: 600 };
    const code = await encodeShareCode(settingsToSearchParams(settings));
    expect(code).toBeTruthy();
    const r = await resolveLinkSettings(`${shareCodeUrl("https://x.test/en/simulator/", code as string)}&s=300`);
    expect(r.ok).toBe(true);
    if (r.ok) expect([r.settings.mode, r.settings.wallCount, r.settings.ballSpeed]).toEqual(["shatter", 12, 300]);
    expect(await resolveLinkSettings("?c=%%%")).toEqual({ ok: false, error: "invalid" });
  });

  it("keeps the batch's export format and applies a swept value", () => {
    const link = { ...defaultSettings("portal"), recordingResolution: "1920x1080", fastExportFps: 30 };
    const page = { ...defaultSettings(), recordingResolution: "500x500", fastExportFps: 60 };
    expect(keepExportFormat(link, page)).toMatchObject({ mode: "portal", recordingResolution: "500x500", fastExportFps: 60 });
    expect(sweepSettings(page, "gravity", 750).gravity).toBe(750);
    expect(page.gravity).toBe(defaultSettings().gravity);
  });

  it("compares settings by value, whatever the field order", () => {
    const a = defaultSettings();
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(sameSettings(a, reordered)).toBe(true);
    expect(sameSettings(a, { ...a })).toBe(true);
    expect(sameSettings(a, { ...a, gravity: a.gravity + 1 })).toBe(false);
    expect(sameSettings(a, { ...a, obstacles: [...a.obstacles] })).toBe(true);
  });
});

describe("names and times", () => {
  it("names a clip mode-seed-duration (plus the swept setting)", () => {
    expect(batchFileBase({ mode: "classic", seed: 123456, durationSec: 30, variant: { kind: "none" } })).toBe("classic-123456-30s");
    expect(batchFileBase({ mode: "colorMatch", seed: 7, durationSec: 12.366, variant: { kind: "mode", mode: "colorMatch" } })).toBe("colorMatch-7-12.4s");
    expect(batchFileBase({ mode: "portal", seed: 1, durationSec: 9.96, variant: { kind: "sweep", key: "gapSize", value: 0.35 } })).toBe("portal-1-10s-gapSize-0.35");
    expect(formatClipSeconds(59.94)).toBe("59.9s");
  });

  it("keeps the names of a batch unique", () => {
    const used = new Set<string>();
    expect(uniqueFileBase("classic-1-30s", "mp4", used)).toBe("classic-1-30s");
    expect(uniqueFileBase("classic-1-30s", "mp4", used)).toBe("classic-1-30s-2");
    expect(uniqueFileBase("classic-1-30s", "webm", used)).toBe("classic-1-30s");
    expect(uniqueFileBase("classic-1-30s", "mp4", used)).toBe("classic-1-30s-3");
    expect([...used]).toEqual(["classic-1-30s.mp4", "classic-1-30s-2.mp4", "classic-1-30s.webm", "classic-1-30s-3.mp4"]);
  });

  it("formats the ZIP name and wall-clock times", () => {
    expect(batchZipBase(new Date(2026, 8, 9, 7, 5))).toBe("viralballs-batch-20260909-0705");
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7400)).toBe("0:07");
    expect(formatElapsed(151_000)).toBe("2:31");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});
