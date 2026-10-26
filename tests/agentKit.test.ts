import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { jsonView, roundNumber } from "@/lib/agentKit/jsonView";
import { simulate } from "@/lib/agentKit/simulate";
import { BASELINE_FILE, diffFingerprint, fingerprintOf, parseBaselineLiteral } from "@/lib/agentKit/fingerprint";
import { commonPrefix, linkChecks, modeCatalog, modeDetail, type LinkIo } from "@/lib/agentKit/modeCatalog";
import { explainFailure, testFilesIn, textReadsOf } from "@/lib/agentKit/explain";
import { AGENT_TOOLS, checkToolArgs, toolSpec } from "@/lib/agentKit/tools";
import { DEFAULT_SEED, normaliseLink, resolveRun } from "@/lib/agentKit/runRequest";
import { postizConfigFromEnv, seriesShapes, statsConfigFromEnv, statsOrigin, statsPeriod, statsRequests, statsSummary, withoutSecret } from "../scripts/agent/owner-stats.mjs";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { simulateSeed } from "@/lib/simulation/finder";
import { MODE_IDS } from "@/lib/physics/types";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { PROMPT_HIDDEN, assistantSettings } from "@/lib/desktop/ai/settingsPatch"; // --- unlimited-sizes ---
import en from "../messages/en.json";

// --- agent-cli --- The agent toolbox's pure helpers (src/lib/agentKit): what `npm run agent -- <tool>` computes. The CLI and
// the MCP wrapper end to end are tests/agentCli.test.ts and tests/agentMcp.test.ts.

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("jsonView (--- agent-cli ---)", () => {
  it("keeps 6 significant digits, names non-finite numbers and counts NaN apart from Infinity", () => {
    const v = jsonView({ a: 1 / 3, b: 12345678.9, c: Number.NaN, d: Infinity, e: -Infinity, f: 42, g: -0.0000001234567 });
    expect(v.value).toEqual({ a: 0.333333, b: 12345700, c: "NaN", d: "Infinity", e: "-Infinity", f: 42, g: -1.23457e-7 });
    expect(v.nonFinite).toBe(3);
    expect(v.nan).toBe(1);
    expect(roundNumber(-0)).toBe(0);
  });

  it("summarises typed arrays, cuts long arrays, Maps and Sets, deep objects and cycles", () => {
    const cyclic: Record<string, unknown> = { name: "x" };
    cyclic.self = cyclic;
    const v = jsonView(
      {
        halo: new Float32Array([0, 1.5, Number.NaN, -2]),
        list: Array.from({ length: 30 }, (_, i) => i),
        short: [1, undefined, () => 1],
        map: new Map([["k", 1]]),
        set: new Set([1, 2]),
        deep: { a: { b: { c: { d: { e: 1 } } } } },
        cyclic,
        fn: () => 1,
        text: "y".repeat(300),
      },
      { maxArray: 24 },
    ).value as Record<string, unknown>;
    expect(v.halo).toEqual({ typedArray: "Float32Array", length: 4, min: -2, max: 1.5, mean: -0.166667, nonZero: 2 });
    expect(v.list).toEqual({ length: 30, head: Array.from({ length: 24 }, (_, i) => i) });
    expect(v.short).toEqual([1, null, null]);
    expect(v.map).toEqual({ map: 1, head: [["k", 1]] });
    expect(v.set).toEqual({ set: 2, head: [1, 2] });
    expect(v.deep).toEqual({ a: { b: { c: "[object]" } } });
    expect(v.cyclic).toEqual({ name: "x", self: "[circular]" });
    expect("fn" in v).toBe(false);
    expect((v.text as string).length).toBe(201);
  });
});

describe("simulate (--- agent-cli ---)", () => {
  it("is deterministic: the same request gives byte-identical JSON", () => {
    const req = { settings: defaultSettings("spiralGlass"), seed: 12345, seconds: 10 };
    const a = JSON.stringify(simulate(req));
    const b = JSON.stringify(simulate(req));
    expect(a).toBe(b);
    const r = JSON.parse(a);
    expect(r.mode).toBe("spiralGlass");
    expect(r.steps).toBe(601); // the finder's clock: steps while the float sum of 1000/60 stays under 10 000 ms
    expect(r.balls.perSecond).toHaveLength(10);
    expect(r.sounds.total).toBe(Object.values(r.sounds.byType as Record<string, number>).reduce((s, n) => s + n, 0));
    expect(r.nan).toBe(false);
    expect(r.work.subSteps).toBeGreaterThanOrEqual(4 * r.steps);
    expect(r.state).toMatchObject({ tilesLeft: expect.any(Number) });
    expect(JSON.stringify(simulate({ ...req, seed: 7 }))).not.toBe(a);
  });

  it("reports the finder's own finish time (simulateSeed) for runs that end", () => {
    for (const [mode, seed] of [["classic", 12345], ["shatter", 1], ["drop", 1]] as const) {
      const settings = defaultSettings(mode);
      const r = simulate({ settings, seed, seconds: 240 });
      const finderMs = simulateSeed(seed, finderRequestOfSettings(settings, undefined, 240), 240_000);
      expect(r.finished, mode).toBe(true);
      expect(r.finishSec, mode).toBe(roundNumber(finderMs / 1000, 9));
      expect(r.simulatedSec, mode).toBe(roundNumber(finderMs / 1000));
    }
  });

  it("stops at the finish unless asked to go on, and caps the run at 600 s", () => {
    const settings = defaultSettings("shatter");
    const stop = simulate({ settings, seed: 1, seconds: 30 });
    const on = simulate({ settings, seed: 1, seconds: 30, continueAfterFinish: true });
    expect(stop.finishSec).toBe(on.finishSec);
    expect(on.simulatedSec).toBeGreaterThan(stop.simulatedSec);
    const capped = simulate({ settings, seed: 1, seconds: 1e9, continueAfterFinish: true }).simulatedSec;
    expect(capped).toBeGreaterThanOrEqual(600);
    expect(capped).toBeLessThan(600.02);
  });
});

describe("fingerprint (--- agent-cli ---)", () => {
  const baseline = parseBaselineLiteral(read(BASELINE_FILE));

  it("reads every mode's BASELINE entry from tests/extras.test.ts", () => {
    expect(Object.keys(baseline).sort()).toEqual([...MODE_IDS].sort());
    for (const id of MODE_IDS) expect(Array.isArray(baseline[id].samples), id).toBe(true);
  });

  it("follows the extras.test recipe exactly: classic, Merge Ring and Spiral Glass equal their BASELINE entries", () => {
    for (const mode of ["classic", "mergeRing", "spiralGlass"] as const) {
      const diff = diffFingerprint(fingerprintOf(mode), baseline[mode]);
      expect(diff, mode).toEqual({ equal: true, differences: [] });
    }
  });

  it("names each moved number, and refuses a BASELINE it cannot read", () => {
    const moved = structuredClone(baseline.classic);
    moved.samples[1][0] += 1;
    moved.walls.pop();
    const diff = diffFingerprint(moved, baseline.classic);
    expect(diff.equal).toBe(false);
    expect(diff.differences).toContain(`samples[1]: ${JSON.stringify(baseline.classic.samples[1])} → ${JSON.stringify(moved.samples[1])}`);
    expect(diff.differences.some((d) => d.startsWith("walls: 7 entries → 6"))).toBe(true);
    expect(() => parseBaselineLiteral("const nothing = {};")).toThrow(/No "const BASELINE/);
    expect(() => parseBaselineLiteral("const BASELINE: X = { a: { samples: [x] } };")).toThrow(/not plain numbers/);
  });
});

describe("mode catalog (--- agent-cli ---)", () => {
  it("lists every mode once with its family and English name", () => {
    const list = modeCatalog(en);
    expect(list.map((m) => m.id)).toEqual([...MODE_IDS]);
    for (const m of list) {
      expect(m.name, m.id).toBe((en.Modes as unknown as Record<string, { name: string }>)[m.id].name);
      expect(["escape", "rhythm", "battle", "journey", "lab"]).toContain(m.family); // --- blueprint --- (Mode Lab's family)
      expect(m.engineKeys).toBeGreaterThan(0);
    }
    const prefixes = list.map((m) => m.prefix).filter(Boolean);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("gives a mode's fields with defaults, ranges and link keys read from the site's own link writer", () => {
    const mr = modeDetail("mergeRing", en);
    expect(mr?.prefix).toBe("mr");
    expect(mr?.fieldList.find((f) => f.key === "mrTiers")).toEqual({ key: "mrTiers", default: 7, range: { min: 5, max: 10, step: 1 }, url: "mrt", engine: true, roundTrip: true, resolved: true });
    expect(modeDetail("target", en)?.fieldList.find((f) => f.key === "targetCount")?.url).toBe("tc");
    expect(modeDetail("nope", en)).toBeNull();
    expect(commonPrefix(["sgTurns", "sgTilt"])).toBe("sg");
    expect(commonPrefix(["growRate", "growLaw"])).toBe("grow");
    expect(commonPrefix([])).toBeNull();
  });

  it("--- unlimited-sizes --- lists the growth caps the app AI's prompt leaves out, with their link keys and link checks", () => {
    // (PROMPT_HIDDEN keeps them out of the assistant's prompt only: they are fields of the mode's block, set by a slider and a link)
    const hidden = [["collide", "cpRingCount", "cprc"], ["paddle", "pdMaxTempo", "pdmt"], ["fightLeague", "flBoutCap", "flBc"]] as const;
    expect([...PROMPT_HIDDEN].sort()).toEqual(hidden.map(([, key]) => key).sort());
    for (const [mode, key, url] of hidden) {
      const detail = modeDetail(mode, en)!;
      expect(detail.fieldList.find((f) => f.key === key), mode).toMatchObject({ key, url, roundTrip: true, resolved: true });
      expect(detail.fieldList.filter((f) => f.key === key), mode).toHaveLength(1);
      expect(detail.linkProblems, mode).toEqual([]);
      expect(detail.fields, mode).toBe(detail.fieldList.length);
      // the prompt still leaves it out, and the modes tool lists every other field of the prompt's mode block too
      const prompt = assistantSettings(defaultSettings(mode)).filter(([, d]) => d === `${mode} setting`).map(([k]) => k);
      expect(prompt, mode).not.toContain(key);
      expect(detail.fieldList.map((f) => f.key), mode).toEqual(expect.arrayContaining(prompt));
    }
  });
});

describe("explain (--- agent-cli ---)", () => {
  it("finds which source files a test reads as text", () => {
    const reads = textReadsOf(read("tests/freeWatermark.test.ts"));
    expect(reads).toContain("src/components/simulator/Simulator.tsx");
    expect(textReadsOf('const x = "src/a.ts"; // no read of a file')).toEqual([]);
    // the brittle neighbours of the hub files are measured, not listed: at least the watermark scans read them
    const pinned = fs.readdirSync(path.join(ROOT, "tests")).filter((f) => f.endsWith(".test.ts") && textReadsOf(read(`tests/${f}`)).some((r) => /(Simulator|Canvas|Controls)\.tsx$/.test(r)));
    expect(pinned).toEqual(expect.arrayContaining(["freeWatermark.test.ts", "watermarkEverywhere.test.ts", "docsConsistency.test.ts"]));
  });

  it("--- agent-cli --- shows a field a share link loses or presetToSettings() leaves unresolved (MODES.md rows 17, 18 and 20)", () => {
    const mr = modeDetail("mergeRing", en)!;
    expect(mr.linkProblems).toEqual([]);
    expect(mr.fieldList.every((f) => f.roundTrip === true && f.resolved === true)).toBe(true);
    const site: LinkIo = { write: settingsToSearchParams, read: settingsFromSearchParams, preset: presetToSettings };
    // the link reader without readMergeRingParams: every field a link sets comes back as the default
    const noReader: LinkIo = { ...site, read: (params) => settingsFromSearchParams(new URLSearchParams([...params].filter(([k]) => !k.startsWith("mr")))) };
    expect(modeDetail("mergeRing", en, noReader)!.fieldList.map((f) => [f.key, f.roundTrip])).toEqual(mr.fieldList.map((f) => [f.key, false]));
    // presetToSettings without resolveMergeRingFields: a wrong-typed value stays
    const noResolver: LinkIo = { ...site, preset: (p) => ({ ...defaultSettings(p.mode ?? "classic"), ...p }) as ReturnType<typeof presetToSettings> };
    const unresolved = modeDetail("mergeRing", en, noResolver)!;
    expect(unresolved.fieldList.every((f) => f.resolved === false)).toBe(true);
    expect(unresolved.linkProblems).toContain("mrTiers: presetToSettings() does not resolve it");
    // a value the resolver folds back onto the default is no round trip to try: the pendulum's 1-sided polygon is the circle
    expect(linkChecks(defaultSettings("pendulum"), "pwPolygon")).toEqual({ roundTrip: true, resolved: true });
  });

  it("sorts the guard's own findings: a weakened test, a stale export, a missing install or browser", () => {
    const weak = explainFailure('       x expect-drop: tests/freeWatermark.test.ts – expect calls 12 → 11 (1 removed and added to no other test file of the change that still runs) – needs "Test-Change: tests/freeWatermark.test.ts - <reason>" and owner review', []);
    expect(weak.kind).toBe("weakening");
    expect(weak.legitimateFix.join(" ")).toMatch(/restore the test/);
    expect(weak.legitimateFix.join(" ")).toMatch(/Test-Change: <file> - <reason>/);
    expect(weak.legitimateFix.join(" ")).not.toMatch(/fix the code/);
    expect(explainFailure("       x expect-changed: tests/freeWatermark.test.ts – 2 expect statements rewritten in place", []).kind).toBe("weakening");
    expect(explainFailure("       x skip-added: tests/shareCode.test.ts – .skip 0 → 1", []).kind).toBe("weakening");
    const stale = explainFailure("  [C vitest] vitest tests/perfGuards.test.ts > built export freshness (the core guard) is built from HEAD, not an older commit\nAssertionError: ./out was built from a402977, HEAD is e36c1e2 – rebuild it", []);
    expect(stale.kind).toBe("stale-export");
    expect(stale.legitimateFix.join(" ")).toMatch(/npm run build.*PERF_GUARD_OUT/);
    const env = explainFailure("       x desktop: tsc --noEmit -p tsconfig.json: failed – desktop/node_modules is missing – run npm ci --prefix desktop (with ELECTRON_SKIP_BINARY_DOWNLOAD=1)", []);
    expect(env.kind).toBe("environment");
    expect(env.legitimateFix.join(" ")).toMatch(/npm ci --prefix desktop/);
    expect(explainFailure(" FAIL  tests/masterBus.test.ts > peaks\nError: JBL_REQUIRE_BROWSER=1: Chromium did not start for the rendered master-bus checks: browserType.launch: Executable doesn't exist", []).kind).toBe("environment");
    expect(explainFailure("       x fingerprint changed: hoops in tests/hoops.test.ts (pinned) – needs a commit trailer \"Fingerprint-Change: hoops - <reason>\" and owner review", []).kind).toBe("fingerprint");
  });

  it("sorts a source pin, a fingerprint, a behaviour change, a timeout and a type error", () => {
    const facts = [{ file: "tests/freeWatermark.test.ts", readsAsText: ["src/components/simulator/Simulator.tsx"] }];
    const pin = explainFailure(" FAIL  tests/freeWatermark.test.ts > seals\nAssertionError: expected 'source' to match /await renderFast\\(\\{/", facts);
    expect(pin.kind).toBe("source-pin");
    expect(pin.summary).toMatch(/Simulator\.tsx as text/);
    expect(pin.neverDo.join(" ")).toMatch(/re-record a fingerprint/);
    expect(explainFailure(" FAIL  tests/extras.test.ts > leaves every mode's trajectory exactly as it was\nexpected { samples: [] }", []).kind).toBe("fingerprint");
    expect(explainFailure(" FAIL  tests/freeWatermark.test.ts > decides\nAssertionError: expected true to be false", facts).kind).toBe("behaviour");
    expect(explainFailure(" FAIL  tests/bot.test.ts > plans\nError: Test timed out in 5000ms.", []).kind).toBe("timeout");
    expect(explainFailure("src/lib/x.ts(3,1): error TS2322: Type 'string' is not assignable", []).kind).toBe("typecheck");
    expect(explainFailure("", []).kind).toBe("unknown");
    expect(testFilesIn("tests/a.test.ts and tests/a.test.ts, relay/x and tests/sub/b.test.ts")).toEqual(["tests/a.test.ts", "tests/sub/b.test.ts"]);
  });
});

describe("the tool table (--- agent-cli ---)", () => {
  it("names every tool once with an object schema; beyond localhost only owner-run commands (never over MCP) and the video tools reach the network", () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(["modes", "simulate", "fingerprint", "preview", "render", "site-shot", "analyse", "frames", "trending", "fetch-video", "inspire", "guard", "explain", "bp-schema", "bp-validate", "bp-check", "bp-link", "bp-docs", "site-stats", "postiz-probe"]);
    for (const t of AGENT_TOOLS) {
      expect(t.input.type, t.name).toBe("object");
      expect(t.input.additionalProperties, t.name).toBe(false);
      if (t.network === "owner") expect(t.mcp, t.name).toBe(false);
      // --- inspiration --- video sites through yt-dlp: the tools that learn from other creators' videos (the owner's decision)
      else if (t.network === "web") expect(["analyse", "frames", "trending", "fetch-video", "inspire"], t.name).toContain(t.name);
      else expect(["none", "localhost"]).toContain(t.network);
    }
    expect(AGENT_TOOLS.filter((t) => t.mcp).map((t) => t.name)).not.toContain("site-stats");
  });

  it("checks a call against the schema: unknown fields, wrong types, link and mode together", () => {
    expect(checkToolArgs("simulate", { mode: "classic", seed: 1 })).toEqual({ ok: true, args: { mode: "classic", seed: 1 } });
    expect(checkToolArgs("simulate", undefined)).toEqual({ ok: true, args: {} });
    expect(checkToolArgs("simulate", { mode: "classic", link: "?mode=box" })).toEqual({ ok: false, errors: ["Give link or mode, not both"] });
    expect(checkToolArgs("simulate", { bogus: 1 }).ok).toBe(false);
    expect(checkToolArgs("simulate", { seconds: 601 }).ok).toBe(false);
    expect(checkToolArgs("analyse", {}).ok).toBe(false);
    expect(checkToolArgs("preview", { out: "../escape" }).ok).toBe(false);
    expect(checkToolArgs("site-shot", { pages: ["https://example.com/"] }).ok).toBe(false);
    expect(checkToolArgs("nope", {}).ok).toBe(false);
    expect(toolSpec("render")?.writes).toBe(".agent-out");
    // --- unlimited-sizes --- a clip of any length above 0 renders (the site keeps a 3 s clip), at most the tool's 60 s
    expect([3, 0.5, 60].map((seconds) => checkToolArgs("render", { mode: "classic", seconds }).ok)).toEqual([true, true, true]);
    expect([0, -1, 61].map((seconds) => checkToolArgs("render", { mode: "classic", seconds }).ok)).toEqual([false, false, false]);
  });
});

describe("the run a call names (--- agent-cli ---)", () => {
  it("reads a link's settings and seed (the call's seed wins), or a mode's defaults with seed 1", async () => {
    expect(normaliseLink("mode=box&g=300")).toBe("?mode=box&g=300");
    expect(normaliseLink("https://x.test/en/simulator/?mode=box")).toBe("https://x.test/en/simulator/?mode=box");
    const fromLink = await resolveRun({ link: "https://jumpingballslive.com/en/simulator/?mode=box&seed=77" });
    expect(fromLink).toMatchObject({ ok: true, mode: "box", seed: 77 });
    expect(await resolveRun({ link: "mode=box&seed=77", seed: 5 })).toMatchObject({ ok: true, seed: 5 });
    const byMode = await resolveRun({ mode: "mergeRing" });
    expect(byMode).toMatchObject({ ok: true, mode: "mergeRing", seed: DEFAULT_SEED, query: "mode=mergeRing&seed=1" });
    expect(await resolveRun({ mode: "nope" })).toEqual({ ok: false, error: 'Unknown mode "nope" (see the modes tool)' });
    expect((await resolveRun({ link: "https://example.com/" })).ok).toBe(false);
  });
});

describe("owner-run commands' pure halves (--- agent-cli ---)", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");

  it("is not configured without a key, and names what is missing", () => {
    expect(statsConfigFromEnv({})).toEqual({ missing: ["PLAUSIBLE_API_KEY or UMAMI_API_KEY"] });
    expect(statsConfigFromEnv({ PLAUSIBLE_API_KEY: "k" })).toEqual({ missing: ["PLAUSIBLE_SITE_ID (or JBL_ANALYTICS_SITE_ID)"] });
    expect(postizConfigFromEnv({ POSTIZ_URL: "https://p.example" })).toEqual({ missing: ["POSTIZ_API_KEY"] });
    expect(() => statsConfigFromEnv({ PLAUSIBLE_API_KEY: "k", PLAUSIBLE_SITE_ID: "s", PLAUSIBLE_HOST: "http://stats.example.com" })).toThrow(/https/);
    expect(statsOrigin("http://localhost:8000/", "X")).toBe("http://localhost:8000");
  });

  it("asks Plausible's Stats API v2 for totals and goals of the period, with the key only in the header", () => {
    const found = statsConfigFromEnv({ PLAUSIBLE_API_KEY: "SECRET", JBL_ANALYTICS_SITE_ID: "jumpingballslive.com" });
    if (!("config" in found)) throw new Error("not configured");
    const [agg, goals] = statsRequests(found.config, 30, now);
    expect(agg.url).toBe("https://plausible.io/api/v2/query");
    expect(agg.headers.Authorization).toBe("Bearer SECRET");
    expect(JSON.parse(agg.body ?? "")).toEqual({ site_id: "jumpingballslive.com", metrics: ["visitors", "visits", "pageviews", "bounce_rate", "visit_duration"], date_range: ["2026-09-23", "2026-10-22"] });
    expect(JSON.parse(goals.body ?? "").dimensions).toEqual(["event:goal"]);
    expect(agg.url + (agg.body ?? "")).not.toContain("SECRET");
    const summary = statsSummary("plausible", { aggregate: { results: [{ metrics: [120, 150, 400, 41, 95] }] }, goals: { results: [{ metrics: [10, 14], dimensions: ["cta_click"] }] } });
    expect(summary).toEqual({ visitors: 120, visits: 150, pageviews: 400, bounceRate: 41, visitDurationSec: 95, events: { cta_click: 14 } });
  });

  it("asks Umami Cloud or a self-hosted Umami, and reads both answer shapes", () => {
    const cloud = statsConfigFromEnv({ UMAMI_API_KEY: "K", UMAMI_WEBSITE_ID: "w-1" });
    const self = statsConfigFromEnv({ UMAMI_API_KEY: "K", UMAMI_WEBSITE_ID: "w-1", UMAMI_HOST: "https://umami.example.com/" });
    if (!("config" in cloud) || !("config" in self)) throw new Error("not configured");
    const period = statsPeriod(7, now);
    expect(statsRequests(cloud.config, 7, now)[0]).toMatchObject({ url: `https://api.umami.is/v1/websites/w-1/stats?startAt=${period.startAt}&endAt=${now}`, headers: { "x-umami-api-key": "K" } });
    expect(statsRequests(self.config, 7, now)[1]).toMatchObject({ url: `https://umami.example.com/api/websites/w-1/metrics?type=event&startAt=${period.startAt}&endAt=${now}`, headers: { Authorization: "Bearer K" } });
    expect(statsSummary("umami", { stats: { visitors: { value: 50 }, visits: 80, pageviews: 200, bounces: 20, totaltime: 4000 }, events: [{ x: "sim_start", y: 33 }] })).toEqual({ visitors: 50, visits: 80, pageviews: 200, bounceRate: 25, visitDurationSec: 50, events: { sim_start: 33 } });
  });

  it("keeps only the labels and point counts of Postiz series, and cuts a key out of a message", () => {
    expect(seriesShapes([{ label: "Views", data: [{ total: 9 }, { total: 3 }] }, { data: null }])).toEqual([{ label: "Views", points: 2 }, { label: "(no label)", points: 0 }]);
    expect(withoutSecret("bad key abc123 for abc123", "abc123")).toBe("bad key [key] for [key]");
  });
});
