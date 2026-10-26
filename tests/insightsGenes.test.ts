import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  GENES_MAX_JSON,
  GENE_BUCKETS,
  GENE_BUCKET_EDGES,
  GENE_CHECKLIST,
  GENE_ENDINGS,
  GENE_FAMILIES,
  GENE_FEATURE_KEYS,
  GENE_LIMITS,
  GENE_SOURCES,
  TIKTOK_PRIVACY_GENES,
  bucketOfSeconds,
  editorGenes,
  genesAtApproval,
  genesFromPlan,
  genesFromSettings,
  genesOfCut,
  genesOfSavedFile,
  sanitizeGenes,
  tiktokPrivacyOf,
  type ClipGenes,
} from "@/lib/insights/genes";
import { BOT_FAMILIES, BUCKET_SECONDS, CHECKLIST, ENDING_STYLES, LENGTH_BUCKETS, RECIPES } from "@/lib/bot/playbook";
import { planClip, scoreClip } from "@/lib/bot/planner";
import { TIKTOK_PRIVACY } from "@/lib/desktop/socialCard";
import { MODE_IDS } from "@/lib/physics/types";
import { SONGS } from "@/lib/audio/songs";
import { BLUEPRINT_CATALOG_IDS, catalogBlueprint } from "@/lib/blueprint/catalog";
import { blueprintDigest, encodeBlueprint } from "@/lib/blueprint/codec";
import { aiClipSource, blueprintGenesOf, planSource, seedSource, settingsGenes } from "@/lib/desktop/queueSources";
import { EMPTY_QUEUE, enqueue, expandBatch, journalOf, restoreQueue, QUEUE_JOURNAL_FORMAT } from "@/lib/desktop/renderQueue";
import { PlanStore, makeVideosTools, type StudioPorts } from "@/lib/desktop/ai/studio";
import { defaultSettings } from "@/lib/settings";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- insights --- Clip genes (lib/insights/genes.ts, phase P2 of the AI platform): the closed record of what a clip was made
 * from, set by the render queue's sources (a bot plan, an AI clip, a link, the page's seed), completed when the file is saved
 * (master or cut) and sanitised by the app's main process on every write and load. These tests pin the record's lists to the
 * playbook's, build genes from real plans and settings, carry them through the queue and its journal, and throw absurd
 * answers at the sanitiser (the customContent tests' way): whatever comes in, what is stored is the record, 4 KB at most.
 */

const copy = (en as unknown as { ViralBot: Parameters<typeof planClip>[3]["copy"] }).ViralBot;
const pip = RECIPES.find((r) => r.id === "pip-escape")!;
const plan = planClip(pip, 9, "tiktok", { copy, search: false });
const ids = () => {
  let n = 0;
  return () => `job-${++n}`;
};

describe("the genes' closed lists", () => {
  it("mirror the playbook's families, endings, buckets, checklist and TikTok's privacy levels", () => {
    expect([...GENE_FAMILIES]).toEqual([...BOT_FAMILIES]);
    expect([...GENE_ENDINGS]).toEqual([...ENDING_STYLES]);
    expect([...GENE_BUCKETS]).toEqual([...LENGTH_BUCKETS]);
    expect([...GENE_CHECKLIST]).toEqual(CHECKLIST.map((c) => c.id));
    expect(Object.keys(TIKTOK_PRIVACY_GENES)).toEqual([...TIKTOK_PRIVACY]);
    expect(GENE_SOURCES).toEqual(["plan", "ai", "link", "seed", "editor"]);
    // the bucket edges: the short bucket's end, then midway from the standard bucket's end to the long one's start
    expect(GENE_BUCKET_EDGES.short).toBe(BUCKET_SECONDS.short.max);
    expect(GENE_BUCKET_EDGES.standard).toBe((BUCKET_SECONDS.standard.max + BUCKET_SECONDS.long.min) / 2);
    for (const bucket of LENGTH_BUCKETS) for (const sec of [BUCKET_SECONDS[bucket].min + 0.5, BUCKET_SECONDS[bucket].max - 0.5]) expect([bucket, sec, bucketOfSeconds(sec)]).toEqual([bucket, sec, bucket]);
    expect([bucketOfSeconds(0), bucketOfSeconds(-3), bucketOfSeconds(Number.NaN), bucketOfSeconds(null), bucketOfSeconds(3), bucketOfSeconds(600)]).toEqual([null, null, null, null, "short", "long"]);
  });

  it("keeps every recipe, catalog game, mode and built-in melody the app can name", () => {
    const keep = (patch: Partial<ClipGenes>) => sanitizeGenes({ v: 1, ...patch });
    for (const r of RECIPES) expect([r.id, keep({ recipe: r.id })?.recipe]).toEqual([r.id, r.id]);
    for (const id of BLUEPRINT_CATALOG_IDS) expect(keep({ recipe: `blueprint:${id}`, parent: `blueprint:${id}` })).toMatchObject({ recipe: `blueprint:${id}`, parent: `blueprint:${id}` });
    for (const mode of MODE_IDS) expect([mode, keep({ mode })?.mode]).toEqual([mode, mode]);
    for (const song of SONGS) expect([song.id, keep({ melody: song.id })?.melody]).toEqual([song.id, song.id]);
    expect([keep({ melody: "ladder" })?.melody, keep({ melody: "none" })?.melody]).toEqual(["ladder", "none"]);
  });

  it("names a recipe's hook by a copy key that exists in en, pl and es", () => {
    for (const r of RECIPES) {
      const recipePlan = planClip(r, 3, "reels", { copy, search: false });
      const genes = genesFromPlan(recipePlan, recipePlan, { recipe: r });
      expect(genes.hookKey).toBe(`recipes.${r.copyKey}`);
      for (const messages of [en, pl, es]) {
        const recipes = (messages as unknown as { ViralBot: { recipes: Record<string, { hook?: string }> } }).ViralBot.recipes;
        expect([r.id, typeof recipes[r.copyKey]?.hook]).toEqual([r.id, "string"]);
      }
    }
  });

  it("loads no module of the page: the app's main process bundles this file (types only)", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "insights", "genes.ts"), "utf8");
    const imports = source.split("\n").filter((l) => /^\s*import\b/.test(l));
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((l) => !/^import type \{[^}]*\} from "[^"]+";$/.test(l))).toEqual([]);
    expect(new RegExp(["tele", "metry"].join(""), "i").test(source)).toBe(false); // (tests/legalCopy.test.ts's word, spelled apart here)
  });
});

describe("genes from a plan, an AI clip, a link and the page's seed", () => {
  it("gives a bot plan's clip its recipe, family, ending, bucket, score and the nine checklist values", () => {
    const genes = planSource(plan).meta!.genes!;
    expect(genes).toMatchObject({ v: 1, source: "plan", recipe: "pip-escape", family: plan.family, mode: plan.mode, ending: plan.ending, bucket: plan.bucket, episode: plan.episode, planScore: plan.score, hookKey: "recipes.pipEscape", melody: plan.melodyId, hashtagCount: plan.post.hashtags.length, cut: null, features: null, tiktokPrivacy: null });
    expect(genes.durationSec).toBeCloseTo(plan.timing.clipSec, 2);
    expect(Object.keys(genes.checklist ?? {})).toEqual([...GENE_CHECKLIST]);
    for (const reason of plan.reasons) expect(genes.checklist?.[reason.id]).toBeCloseTo(reason.points / reason.max, 3);
    expect(genes.hookChars).toBe([...plan.hook.trim()].length);
    expect(genes.captionQuestion).toBe(/[?¿]/.test(`${plan.post.caption} ${plan.post.question}`));
    // a music-first recipe plays the mode's own notes: its melody gene is the ladder
    const rhythm = RECIPES.find((r) => r.musicFirst)!;
    const rhythmPlan = planClip(rhythm, 4, "reels", { copy, search: false });
    expect(planSource(rhythmPlan).meta!.genes!.melody).toBe("ladder");
  });

  it("gives an AI clip its plan's genes as the AI's set_clip_settings left the plan, scored again, with the AI's own copy", async () => {
    const same = aiClipSource({ planId: plan.id, name: "Pip Monday", title: "Pip!", hook: plan.hook, caption: "Will Pip make it?", hashtags: ["#pip", "#physics", "#asmr"], platform: "tiktok" }, plan).meta!.genes!;
    expect(same).toMatchObject({ source: "ai", recipe: plan.recipe, planScore: plan.score, hookKey: "recipes.pipEscape", hashtagCount: 3, captionQuestion: true });
    // the AI changes the plan with its tool: the genes read the plan the store holds now, and its score is the new one
    const store = new PlanStore();
    store.add(plan);
    const ports: StudioPorts = { planClips: async () => [plan], findSimulation: async () => ({ found: false, seed: plan.seed, durationSec: 0 }) };
    const setClipSettings = makeVideosTools(store, ports).find((t) => t.name === "set_clip_settings")!;
    await setClipSettings.run({ planId: plan.id, changes: [{ setting: "ballName", value: "Bob" }] }, { signal: undefined, progress: () => {} } as never);
    const changed = store.get(plan.id)!;
    expect(changed.settings.ballName).toBe("Bob");
    const rescored = scoreClip(changed);
    expect(rescored.score).toBeLessThan(plan.score); // Gerald's series loses its cast
    const genes = aiClipSource({ planId: plan.id, name: "Bob", title: "Bob!", hook: "Can Bob escape?", caption: "Bob's first day", hashtags: ["#bob", "#physics", "#asmr", "#fyp"], platform: "tiktok" }, changed).meta!.genes!;
    expect(genes).toMatchObject({ source: "ai", planScore: rescored.score, hookKey: "custom", hookChars: 15, hashtagCount: 4, captionQuestion: false });
    expect(genes.checklist?.series).toBeCloseTo(rescored.reasons.find((r) => r.id === "series")!.points / rescored.reasons.find((r) => r.id === "series")!.max, 3);
  });

  it("gives a link's and the page's clip the mode, length, bucket and hook, and Mode Lab's game as its recipe", () => {
    const page = seedSource({ ...defaultSettings("glass"), recordingDuration: 22, topText: "Will it break?" }, 42).meta!.genes!;
    expect(page).toMatchObject({ source: "seed", mode: "glass", durationSec: 22, bucket: "standard", hookKey: "custom", hookChars: 14, hashtagCount: 0, captionQuestion: false, recipe: null, family: null, planScore: null, melody: null });
    const link = seedSource(defaultSettings("classic"), 5, { kind: "link", link: "https://example.invalid/en/simulator/?mode=classic" }).meta!.genes!;
    expect(link).toMatchObject({ source: "link", mode: "classic", hookKey: null, hookChars: 0 });
    // Mode Lab: a catalog game is the recipe "blueprint:<id>" with its spec's digest; a link's spec has a digest and no recipe
    const lab = { ...defaultSettings("blueprint"), mode: "blueprint" as const, blPreset: "ringBreaker", blSpec: "" };
    expect(blueprintGenesOf(lab)).toEqual({ catalogId: "ringBreaker", digest: blueprintDigest(catalogBlueprint("ringBreaker")) });
    expect(seedSource(lab, 7).meta!.genes).toMatchObject({ recipe: "blueprint:ringBreaker", blueprintDigest: blueprintDigest(catalogBlueprint("ringBreaker")) });
    const spec = catalogBlueprint("hatchery");
    const fromLink = settingsGenes({ ...lab, blSpec: encodeBlueprint(spec) }, { hook: null }, "link");
    expect(fromLink).toMatchObject({ recipe: null, blueprintDigest: blueprintDigest(spec) });
    expect(fromLink.blueprintDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(blueprintGenesOf(defaultSettings("classic"))).toBeNull();
    // without the page's resolution, a catalog game still names its recipe (no digest)
    expect(genesFromSettings(lab, {}, "seed")).toMatchObject({ recipe: "blueprint:ringBreaker", blueprintDigest: null });
  });

  it("completes the genes when the queue saves the file: its length, master or cut, the cut's own hook and bucket", () => {
    const planned = planSource(plan).meta!.genes!;
    const master = genesOfSavedFile(planned, { durationSec: 41.3, cut: "master" });
    expect(master).toMatchObject({ cut: "master", durationSec: 41.3, bucket: plan.bucket, recipe: plan.recipe, planScore: plan.score }); // the planned bucket stays
    const cut = genesOfCut(master, { durationSec: 11.5, hook: "Will Pip make it?", sameHook: false });
    expect(cut).toMatchObject({ cut: "tiktok", durationSec: 11.5, bucket: "short", hookKey: "custom", hookChars: 17, recipe: plan.recipe, planScore: plan.score });
    expect(genesOfCut(master, { durationSec: 11.5, hook: plan.hook, sameHook: true })).toMatchObject({ hookKey: "recipes.pipEscape", hookChars: master.hookChars });
    // a clip from settings takes the file's own bucket (a run may end before its clip length); a re-rendered cut is whole again
    const page = seedSource({ ...defaultSettings("glass"), recordingDuration: 60 }, 1).meta!.genes!;
    expect(genesOfSavedFile(page, { durationSec: 12, cut: "master" })).toMatchObject({ bucket: "short", durationSec: 12 });
    expect(genesOfSavedFile(cut, { durationSec: 41.3, cut: "master" })).toMatchObject({ cut: "master", bucket: "standard" });
    // a length that is no length keeps the one it had
    expect(genesOfSavedFile(planned, { durationSec: null, cut: "master" }).durationSec).toBe(planned.durationSec);
    // the Clip editor's cut of a clip without genes
    expect(editorGenes({ mode: "glass", durationSec: 9, copy: { hook: "Which floor?", caption: "Guess!", hashtags: ["#glass"] } })).toMatchObject({ source: "editor", mode: "glass", cut: "tiktok", bucket: "short", hookKey: "custom", hookChars: 12, hashtagCount: 1, captionQuestion: false });
  });

  it("travels with the job through the batch and the journal, sanitised on restore", () => {
    const specs = expandBatch([planSource(plan)], { resolutions: ["1080x1920"], fps: [60], codecs: ["h264", "hevc"], presets: ["native"] });
    expect(specs.every((s) => s.meta.genes?.recipe === plan.recipe)).toBe(true);
    const state = enqueue(EMPTY_QUEUE, specs, 1, ids());
    const restored = restoreQueue(JSON.parse(JSON.stringify(journalOf(state, 2))), 3).state.jobs;
    expect(restored.map((j) => j.meta.genes)).toEqual(state.jobs.map((j) => j.meta.genes));
    // junk genes in a journal are dropped, an old journal (no genes) restores without the key
    const job = { ...state.jobs[0], meta: { ...state.jobs[0].meta, genes: { v: 1, recipe: "<script>", planScore: 1e9, cut: "director" } } };
    const old = { ...state.jobs[1], meta: { title: "old", platform: null, hook: null, caption: null, hashtags: [] } };
    const [junk, before] = restoreQueue({ format: QUEUE_JOURNAL_FORMAT, version: 1, running: false, jobs: [job, old] }, 4).state.jobs;
    expect(junk.meta.genes).toMatchObject({ recipe: null, planScore: 100, cut: null });
    expect(before.meta).not.toHaveProperty("genes");
    expect(restoreQueue({ format: QUEUE_JOURNAL_FORMAT, version: 1, running: false, jobs: [{ ...job, meta: { ...job.meta, genes: "yes" } }] }, 4).state.jobs[0].meta).not.toHaveProperty("genes");
  });
});

describe("sanitizeGenes", () => {
  const good = planSource(plan).meta!.genes!;

  it("keeps a record as it is (and a second pass changes nothing)", () => {
    expect(sanitizeGenes(good)).toEqual(good);
    expect(sanitizeGenes(sanitizeGenes(good))).toEqual(good);
    expect(sanitizeGenes(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  it("refuses what is not a version-1 record", () => {
    for (const raw of [null, undefined, 1, "genes", [], [good], { ...good, v: 2 }, { ...good, v: "1" }, { source: "plan" }]) expect(sanitizeGenes(raw)).toBeNull();
  });

  it("brings absurd answers inside the record: closed enums, clamped numbers, short strict strings, the rest null", () => {
    const absurd = {
      v: 1,
      source: "hacker",
      recipe: "a".repeat(65),
      family: "comedy",
      mode: "<img src=x onerror=alert(1)>",
      ending: "happily-ever-after",
      bucket: "huge",
      durationSec: 1e12,
      melody: "Für Elise",
      hookKey: "recipes.pipEscape.hook; DROP TABLE",
      hookChars: -5,
      hashtagCount: 3.7,
      captionQuestion: "yes",
      cut: "directors",
      episode: Number.POSITIVE_INFINITY,
      planScore: 250,
      checklist: { motion: 7, hook: -1, payoff: "full", evil: 1, __proto__: { polluted: 1 } },
      features: { v: 1, sampleHz: 1e99, meanLuma: Number.NaN, lufs: -14, motion: new Array(5000).fill(1), extra: "x" },
      blueprintDigest: "DEADBEEF",
      parent: "../../etc/passwd",
      tiktokPrivacy: "PUBLIC_TO_EVERYONE",
      prototype: { polluted: true },
      constructor: "x",
      extra: "x".repeat(1_000_000),
    };
    const out = sanitizeGenes(absurd)!;
    expect(out).toEqual({
      v: 1,
      source: null,
      recipe: null,
      family: null,
      mode: null,
      ending: null,
      bucket: "long", // (no bucket of its own: the bucket of its clamped length)
      durationSec: GENE_LIMITS.durationSec,
      melody: null,
      hookKey: null,
      hookChars: 0,
      hashtagCount: 4,
      captionQuestion: null,
      cut: null,
      episode: null,
      planScore: 100,
      checklist: { motion: 1, hook: 0 },
      features: { v: 1, ...Object.fromEntries(GENE_FEATURE_KEYS.map((k) => [k, null])), sampleHz: GENE_LIMITS.feature, lufs: -14 },
      blueprintDigest: null,
      parent: null,
      tiktokPrivacy: null,
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(GENES_MAX_JSON);
    // every field of the wrong type is null (or a whole record of nulls)
    const wrong = sanitizeGenes(Object.fromEntries(Object.keys(good).map((k) => [k, k === "v" ? 1 : { nested: [1, 2, 3] }])))!;
    for (const [key, value] of Object.entries(wrong)) if (key !== "v") expect([key, value]).toEqual([key, null]);
  });

  it("weighs 4 KB at most, however full, and reads only its own keys from a huge object", () => {
    const full: ClipGenes = {
      ...good,
      recipe: `blueprint:${"x".repeat(40)}`,
      mode: "m".repeat(40),
      melody: "a".repeat(64),
      hookKey: `recipes.${"k".repeat(55)}`,
      checklist: Object.fromEntries(GENE_CHECKLIST.map((id) => [id, 0.333])),
      features: { v: 1, ...Object.fromEntries(GENE_FEATURE_KEYS.map((k) => [k, -999_999.5])) } as ClipGenes["features"],
      blueprintDigest: "0123abcd",
      parent: "0123abcd",
      tiktokPrivacy: "followers",
    };
    const kept = sanitizeGenes(full)!;
    expect(kept).toEqual(full);
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(GENES_MAX_JSON);
    const huge: Record<string, unknown> = { ...good };
    for (let i = 0; i < 100_000; i++) huge[`k${i}`] = i;
    const t0 = Date.now();
    expect(sanitizeGenes(huge)).toEqual(good);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("the TikTok audience at approval", () => {
  const channel = (platform: string, settings: unknown) => ({ id: `int-${platform}`, platform, text: "t", settings });
  const tiktok = (privacy_level: unknown) => channel("tiktok", { __type: "tiktok", privacy_level });

  it("records the card's privacy level as public, friends, followers or self (null without TikTok)", () => {
    expect(TIKTOK_PRIVACY.map((level) => tiktokPrivacyOf([tiktok(level)]))).toEqual(["public", "friends", "followers", "self"]);
    expect(tiktokPrivacyOf([channel("youtube", { __type: "youtube", privacy_level: "SELF_ONLY" })])).toBeNull();
    expect(tiktokPrivacyOf([tiktok("EVERYONE"), tiktok(undefined)])).toBeNull();
    expect(tiktokPrivacyOf([channel("youtube", { __type: "youtube" }), tiktok("SELF_ONLY")])).toBe("self");
    expect(tiktokPrivacyOf([channel("custom", { __type: "tiktok", privacy_level: "MUTUAL_FOLLOW_FRIENDS" })])).toBe("friends");
    expect(tiktokPrivacyOf([channel("tiktok", "nope"), channel("tiktok", null), channel("tiktok", ["SELF_ONLY"])])).toBeNull();
  });

  it("copies the clip's genes with it, and nothing for a clip without genes", () => {
    expect(genesAtApproval(planSource(plan).meta!.genes, [tiktok("SELF_ONLY")])).toEqual({ ...planSource(plan).meta!.genes, tiktokPrivacy: "self" });
    expect(genesAtApproval(undefined, [tiktok("SELF_ONLY")])).toBeNull();
    expect(genesAtApproval({ v: 9 }, [tiktok("SELF_ONLY")])).toBeNull();
  });
});
