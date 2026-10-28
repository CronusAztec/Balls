import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import { recipeById, RECIPES } from "@/lib/bot/playbook";
import { planClip, type CaptionRole, type ClipPlan } from "@/lib/bot/planner";
import { defaultCaption, MAX_CAPTION_TEXT_LENGTH, type Caption } from "@/lib/captions";
import { MODE_IDS } from "@/lib/physics/types";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { TRENDS } from "@/content/trends";
import type { ClipFeatures } from "@/lib/recording/clipFeatures";
import { genesOfSavedFile } from "@/lib/insights/genes";
import { runSync, scoreSavedClip, scoreSavedClipWithFacts } from "@/lib/insights/score";
import { planSource, seedSource } from "@/lib/desktop/queueSources";
import {
  CLAIMS,
  DOSSIER_KEYS,
  INTENT_MAX,
  SCREEN_MAX,
  crewClipOfPlan,
  crewClipOfSaved,
  drawnHookText,
  intentView,
  isDossierKey,
  motionBuckets,
  sceneOf,
  screenView,
  type CrewClip,
} from "@/lib/crew";

/*
 * --- crew --- The clip dossier (lib/crew/dossier.ts, C2 of the AI studio plan): the intent view the skeptic and the reviewer
 * read and the screen view the cold viewer reads. Budgets on every recipe plan at 10 captions (with a render's measurement, a
 * cut, the other candidates and a research gap), a stable key order and the same bytes every time, every key resolvable as
 * data, built from a plan and from a saved clip's genes, settings and facts (scoreSavedClipWithFacts), and a screen view that
 * holds no intent and no trend title.
 */

type Copy = Parameters<typeof planClip>[3]["copy"];
const COPIES = { en: (en as unknown as { ViralBot: Copy }).ViralBot, pl: (pl as unknown as { ViralBot: Copy }).ViralBot, es: (es as unknown as { ViralBot: Copy }).ViralBot };
const copy = COPIES.en;
const quickPlans = (locale: keyof typeof COPIES = "en") => RECIPES.flatMap((recipe) => (["resolved", "cliffhanger"] as const).map((ending) => planClip(recipe, 23, "tiktok", { copy: COPIES[locale], locale, ending, search: false, episode: 5 })));
const long = (k: number) => `Caption ${k} ${"with a great many words to read ".repeat(4)}`.slice(0, MAX_CAPTION_TEXT_LENGTH);
/** A plan's clip with its captions padded to ten (long ones, at every place and time). */
function tenCaptions(plan: ClipPlan): CrewClip {
  const clip = crewClipOfPlan(plan);
  const extra = Math.max(0, 10 - clip.captions.length);
  const captions: Caption[] = [...clip.captions, ...Array.from({ length: extra }, (_, k) => ({ ...defaultCaption(k % 3 === 0 ? "question" : "text", { text: long(k) }), start: 0.5 + 2 * k, end: k % 2 ? 0 : 1.5 + 2 * k, position: (["top", "center", "bottom"] as const)[k % 3] }))];
  return { ...clip, captions, captionRoles: [...clip.captionRoles, ...Array.from({ length: extra }, (_, k): CaptionRole => (k % 3 === 0 ? "question" : "payoff"))], settings: { ...clip.settings, captions } };
}
const features: ClipFeatures = { v: 1, sampleHz: 4, motion: [0, ...Array.from({ length: 599 }, (_, i) => 0.002 + 0.01 * Math.abs(Math.sin(i / 17)))], firstMotionSec: 0.25, peakMotionPos: 0.82, meanLuma: 0.09, meanSat: 0.52, darkShare: 0.83, soundEventsPerSec: 3.4, firstSoundSec: 0.1, gapEvents: 7, loopSeamDiff: 0.02, lufs: -14.2 };
/** The worst case: rendered, shown as a cut, four other candidates and a two-line research gap. */
const heavy = (clip: CrewClip): CrewClip => ({
  ...clip,
  measured: { features, durationSec: clip.timing.clipSec, laggedFrames: 12, frames: 1200, watermarked: true, free: true },
  cut: { startSec: 2, lengthSec: 11, hook: "A long cut hook that says something else entirely here", url: "jumpingballslive.example", cardSec: 1.5 },
});
const others = Array.from({ length: 6 }, (_, k) => ({ template: `template-${k}`, hook: `Another candidate's hook number ${k} that goes on and on` }));
const research = ["Hooks that ask a question did not beat statements in the last sample (weak evidence, 22 videos).", "Keep the busiest moment late in the clip: the most viewed peak near two thirds in (a hint, p 0.07)."];

describe("budgets", () => {
  it("keeps the intent view within 1,400 and the screen view within 1,200 characters on every recipe plan at 10 captions", () => {
    for (const locale of ["en", "pl", "es"] as const) {
      for (const plan of quickPlans(locale)) {
        const padded = tenCaptions(plan);
        expect(padded.captions.length).toBeGreaterThanOrEqual(10);
        for (const clip of [crewClipOfPlan(plan), padded, heavy(padded)]) {
          const intent = intentView(clip, { others, research });
          const screen = screenView(clip);
          expect([locale, plan.id, intent.text.length <= INTENT_MAX]).toEqual([locale, plan.id, true]);
          expect([locale, plan.id, screen.text.length <= SCREEN_MAX]).toEqual([locale, plan.id, true]);
        }
      }
    }
  });

  it("keeps every key's line even when it trims, in the stable order", () => {
    for (const plan of quickPlans()) {
      const text = intentView(heavy(tenCaptions(plan)), { others, research }).text;
      expect([plan.id, text.split("\n").map((l) => l.slice(0, l.indexOf(":")))]).toEqual([plan.id, [...DOSSIER_KEYS]]);
    }
  });
});

describe("trims the others before the clip's own words", () => {
  it("keeps the drawn hook whole at every trim level: the other candidates' hooks and the research are cut first", () => {
    // (the studio's real run, with three other candidates and two research lines, showed the skeptic the hook
    // "15 pendulums. Wait for the chord." as "15 pendulums. Wait …": the one line it judges a hook by)
    for (const locale of ["en", "pl", "es"] as const) {
      for (const plan of quickPlans(locale)) {
        const clip = heavy(tenCaptions(plan));
        const text = intentView(clip, { others, research }).text;
        const hook = drawnHookText(clip).replace(/[\r\n\t]+/g, " ").replace(/"/g, "'").replace(/\s+/g, " ").trim();
        expect([locale, plan.id, text.length <= INTENT_MAX, text.split("\n").find((l) => l.startsWith("words.hook: "))]).toEqual([locale, plan.id, true, `words.hook: "${hook}"`]);
      }
    }
  });

  it("shows a render's first sound beside its first motion: G1 reads the earlier", () => {
    const plan = planClip(recipeById("ring-escape")!, 2, "reels", { copy, ending: "resolved", episode: 3 });
    expect(intentView(heavy(crewClipOfPlan(plan))).text).toMatch(/^measured\.firstMotion: 0\.3 s \(first sound 0\.1 s\)$/m);
  });
});

describe("the intent view", () => {
  const plan = planClip(recipeById("ring-escape")!, 2, "reels", { copy, ending: "resolved", episode: 3 });
  const clip = crewClipOfPlan(plan, { run: runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec) });

  it("gives the same bytes for the same clip: the skeptic's and the reviewer's prompts share it", () => {
    const again = planClip(recipeById("ring-escape")!, 2, "reels", { copy, ending: "resolved", episode: 3 });
    const clip2 = crewClipOfPlan(again, { run: runSync(again.settings, again.seed, again.world, again.recipe, again.timing.clipSec) });
    const a = intentView(clip, { others, research });
    const b = intentView(clip2, { others, research });
    expect(a.text).toBe(b.text);
    expect(JSON.stringify(a.facts)).toBe(JSON.stringify(b.facts));
  });

  it("resolves every DOSSIER_KEYS key as data and as a line of its own", () => {
    const d = intentView(clip, { others, research });
    expect(Object.keys(d.facts)).toEqual([...DOSSIER_KEYS]);
    for (const key of DOSSIER_KEYS) {
      expect(isDossierKey(key)).toBe(true);
      expect([key, d.facts[key] !== undefined]).toEqual([key, true]);
      expect(d.text.split("\n").filter((l) => l.startsWith(`${key}: `))).toHaveLength(1);
    }
    expect(isDossierKey("clip.idea")).toBe(false);
  });

  it("says what the plan meant and what was measured", () => {
    const d = intentView(clip, { others, research });
    expect(d.facts["clip.template"]).toBe("recipe:ring-escape");
    expect(d.facts["clip.claim"]).toBe("out");
    expect(d.facts["words.hook"]).toBe(plan.hook);
    expect(d.facts["beats.payoff"]).toMatchObject({ what: "escape" });
    expect(d.facts["run.escape"]).toBeGreaterThan(0);
    expect(d.facts["score.playbook"]).toBe(plan.score);
    expect(d.facts["measured.firstMotion"]).toBeNull();
    expect(d.text).toMatch(/^measured\.firstMotion: not rendered$/m);
    const rendered = intentView(heavy(clip));
    expect(rendered.facts["measured.firstMotion"]).toBe(0.3);
    expect(rendered.facts["measured.lagged"]).toBe(1);
    expect(rendered.facts["beats.cut"]).toEqual({ from: 2, length: 11, card: 1.5 });
    // at most four other candidates and two research lines
    expect((d.facts.others as string[]).length).toBe(4);
    expect((d.facts.research as string[]).length).toBe(2);
  });
});

describe("built from a saved clip's genes, settings and facts", () => {
  const plans = (["ring-escape", "battle-royale", "pendulum-wave"] as const).map((id) => planClip(recipeById(id)!, 4, "reels", { copy, ending: "resolved", episode: 2, maxSeeds: 6 }));

  it("reads the plan's facts back from the run scoreSavedClipWithFacts keeps", async () => {
    for (const plan of plans) {
      const genes = genesOfSavedFile(planSource(plan).meta!.genes!, { durationSec: plan.timing.clipSec, cut: "master" });
      const saved = await scoreSavedClipWithFacts(genes, { settings: plan.settings, seed: plan.seed, world: plan.world, durationSec: plan.timing.clipSec, features: null, platform: plan.platform, pause: async () => {} });
      expect(saved.genes).toBe(genes); // (a bot plan keeps its own score)
      expect(saved.run).not.toBeNull();
      const fromSaved = crewClipOfSaved({ settings: plan.settings, genes: saved.genes, facts: saved.facts!, run: saved.run, seed: plan.seed, platform: plan.platform, hook: plan.hook });
      const fromPlan = crewClipOfPlan(plan, { run: saved.run });
      const a = intentView(fromSaved);
      const b = intentView(fromPlan);
      expect(a.text.length).toBeLessThanOrEqual(INTENT_MAX);
      for (const key of ["clip.mode", "clip.ending", "clip.bucket", "words.hook", "words.topText", "words.bottomText", "run.winner", "run.escape", "run.finish", "score.simple", "look.effects", "look.huds"] as const) expect([plan.id, key, a.facts[key]]).toEqual([plan.id, key, b.facts[key]]);
      expect((a.facts["beats.payoff"] as { sec: number }).sec).toBeCloseTo((b.facts["beats.payoff"] as { sec: number }).sec, 1);
      expect(screenView(fromSaved).text).toBe(screenView(fromPlan).text);
    }
  });

  it("gives the very genes scoreSavedClip gives, with the run and the facts it read", async () => {
    const plan = plans[0];
    const page = { ...plan.settings, captions: [] };
    const link = genesOfSavedFile(seedSource(page, 9).meta!.genes!, { durationSec: plan.timing.clipSec, cut: "master" });
    const ai = { ...planSource(plan).meta!.genes!, source: "ai" as const };
    for (const [genes, settings] of [[link, page], [ai, plan.settings]] as const) {
      const input = { settings, seed: 9, world: null, durationSec: plan.timing.clipSec, features: null, platform: "reels" as const, pause: async () => {} };
      const kept = await scoreSavedClipWithFacts(genes, input);
      expect(kept.genes).toEqual(await scoreSavedClip(genes, input));
      expect(kept.run).toEqual(runSync(settings, 9, null, genes.recipe, plan.timing.clipSec));
      expect(kept.facts?.clipSec).toBe(plan.timing.clipSec);
    }
    // an aborted run: the genes as they were, no run
    expect(await scoreSavedClipWithFacts(link, { settings: page, seed: 9, world: null, durationSec: 10, features: null, platform: null, signal: { aborted: true } })).toEqual({ genes: link, run: null, facts: null });
  });
});

describe("the screen view holds no intent", () => {
  const FORBIDDEN_WORDS = /\b(template|idea|intent|payoff|claim|recipe)\b/i;
  /** The view without the clip's own drawn words (quoted): the structured part, which must say nothing of what was meant. */
  const unquoted = (text: string) => text.replace(/"[^"]*"/g, '""');

  it("names no template, format, claim or recipe, and never the words template, idea, intent or payoff", () => {
    for (const locale of ["en", "pl", "es"] as const) {
      for (const plan of quickPlans(locale)) {
        for (const clip of [crewClipOfPlan(plan), heavy(tenCaptions(plan))]) {
          const text = screenView(clip).text;
          expect([locale, plan.id, FORBIDDEN_WORDS.test(text)]).toEqual([locale, plan.id, false]);
          const bare = unquoted(text).toLowerCase();
          expect([plan.id, bare.includes(plan.recipe)]).toEqual([plan.id, false]);
          for (const claim of CLAIMS) expect([plan.id, claim, new RegExp(`\\b${claim}\\b`, "i").test(bare)]).toEqual([plan.id, claim, false]);
          expect(bare).not.toMatch(/\b(getout|smash|whowins|lineup|onthebeat|reveal|labgame)\b/i);
        }
      }
    }
  });

  it("describes the scene neutrally: the things on screen, never a mode's name or a claim", () => {
    const names = (en as unknown as { Modes: Record<string, { name?: string }> }).Modes;
    for (const mode of MODE_IDS) {
      const scene = sceneOf(defaultSettings(mode)).toLowerCase();
      const name = names[mode]?.name;
      expect([mode, !!name && scene.includes(name.toLowerCase())]).toEqual([mode, false]);
      for (const claim of CLAIMS) expect([mode, claim, new RegExp(`\\b${claim}\\b`, "i").test(scene)]).toEqual([mode, claim, false]);
    }
  });

  it("draws the scene as the settings lay it out: a pendulum layout's shape, the layer stack under the ball", () => {
    // (the studio's real run: a wheel of pendulums read "side by side", a ball bouncing on top of its layers read "under")
    const pendulums = (pwLayout: SimulatorSettings["pwLayout"], pwPolygon = 0) => sceneOf({ ...defaultSettings("pendulum"), pwCount: 15, pwLayout, pwPolygon });
    expect(pendulums("row")).toBe("15 pendulums side by side, each a little longer than the last");
    expect(pendulums("arc")).toBe("15 pendulums hanging inward from a ring, each a little longer than the last");
    expect(pendulums("circle")).toBe("15 balls on the spokes of a wheel, each swinging to and from the center along its spoke");
    expect(pendulums("circle", 5)).toBe("15 balls on the spokes of a slowly turning 5-sided shape, each swinging to and from the center along its spoke");
    expect(pendulums("galaxy")).toBe("15 balls on the spokes of a slowly turning wheel, each swinging to and from the center along its spoke");
    expect(pendulums("sliding")).toBe("15 balls sliding left and right on stacked rails");
    expect(pendulums("bouncing")).toBe("15 balls bouncing on a floor, each at its own pace");
    expect(sceneOf({ ...defaultSettings("powerLayers"), plLayers: 700 })).toBe("one ball bouncing on top of a stack of 700 coloured layers");
  });

  it("shows what is drawn and heard: the texts with their seconds and place, the look, and after a render the motion in 8 parts", () => {
    const plan = planClip(recipeById("ring-escape")!, 2, "reels", { copy, ending: "resolved", episode: 3, search: false });
    const text = screenView(heavy(crewClipOfPlan(plan))).text;
    expect(text).toMatch(/^scene: one ball inside \d+ spinning rings, one gap in each$/m);
    expect(text).toContain(plan.hook.split(" ")[0]);
    expect(text).toMatch(/^motion in 8 parts \(0 still - 9 most\): (\d ){7}\d$/m);
    expect(text).toMatch(/^shown as a cut from 2 s for 11 s/m);
    expect(motionBuckets(features.motion)).toHaveLength(8);
    expect(Math.max(...motionBuckets(features.motion))).toBe(9);
    expect(motionBuckets([0, 0, 0])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("no trend title reaches a role", () => {
  it("quotes no example title of the trend summary in either view, even with research lines from it", () => {
    expect(TRENDS).not.toBeNull();
    const titles = TRENDS!.examples.map((e) => e.title).filter((t): t is string => !!t && t.length > 12);
    expect(titles.length).toBeGreaterThan(0);
    const lines = TRENDS!.recommendations.slice(0, 2).map((r) => r.advice);
    for (const plan of quickPlans()) {
      const clip = heavy(tenCaptions(plan));
      const views = [intentView(clip, { others, research: lines }).text, screenView(clip).text];
      for (const v of views) for (const t of titles) expect([plan.id, v.includes(t)]).toEqual([plan.id, false]);
    }
  });
});
