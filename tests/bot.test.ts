import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import es from "../messages/es.json";
import pl from "../messages/pl.json";
import { MAX_CAPTIONS, sanitizeCaption, type Caption } from "@/lib/captions";
import { isModeId } from "@/lib/physics/types";
import { sameSettings } from "@/lib/recording/batch";
import { RANGES, presetToSettings, settingsFromSearchParams, type SimulatorSettings } from "@/lib/settings";
import { clipHashtags, fillTemplate, parseHashtags, postCopy, type BotCopy } from "@/lib/bot/copy";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { HUD_BAND } from "@/lib/physics/modes/arenaGames";
import { MANIFEST_FORMAT, batchTextFiles, buildManifest, captionFileName, captionFileText, reasonText, scheduleMarkdown } from "@/lib/bot/output";
import {
  BOT_FAMILIES,
  BOT_FRAME,
  BUCKET_SECONDS,
  CHECKLIST,
  HASHTAG_COUNT,
  LENGTH_BUCKETS,
  MASCOT,
  PLATFORMS,
  RECIPES,
  SERIES_ROSTER,
  TOP_HUD_MODES,
  recipeBucket,
  recipeById,
  recipesOfFamily,
  type BotRecipe,
  type ChecklistId,
} from "@/lib/bot/playbook";
import {
  captionBoxAt,
  daySlots,
  dayIndexOf,
  edgeTextBox,
  estimateTextWidth,
  inSafeZone,
  planClip,
  planDay,
  resolveEnding,
  scoreClip,
  simulateFacts,
  splitCaptionLines,
  type ClipPlan,
} from "@/lib/bot/planner";
import { parseBotState } from "@/lib/bot/store";

/**
 * The viral video bot's planner (lib/bot): the recipes' settings against RANGES, the determinism of planClip / planDay, the
 * daily rotation, the score's checklist item by item, the caption safe zone, the copy in three languages and the
 * manifest, caption files and posting schedule.
 */

// Planning simulates physics seed by seed: a busy machine can take many times the usual couple of seconds per test.
vi.setConfig({ testTimeout: 60_000 });

const COPY: Record<string, BotCopy> = { en: en.ViralBot as BotCopy, pl: pl.ViralBot as BotCopy, es: es.ViralBot as BotCopy };
const copy = COPY.en;

/** Every numeric setting that has a range is inside it and on its step. */
function rangeViolations(s: SimulatorSettings): string[] {
  const bad: string[] = [];
  for (const [key, range] of Object.entries(RANGES) as [string, { min: number; max: number; step: number }][]) {
    const value = (s as unknown as Record<string, unknown>)[key];
    if (typeof value !== "number") continue;
    const steps = (value - range.min) / range.step;
    if (!(value >= range.min - 1e-9 && value <= range.max + 1e-9) || Math.abs(steps - Math.round(steps)) > 1e-6) bad.push(`${key}=${value}`);
  }
  return bad;
}

const points = (plan: ClipPlan, id: ChecklistId) => scoreClip(plan).reasons.find((r) => r.id === id)!.points;

const keysOf = (o: unknown, prefix = ""): string[] =>
  o && typeof o === "object" && !Array.isArray(o) ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === "object" ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`])) : [];

describe("recipes", () => {
  it("has at least 12 recipes across the three families, each with its own id, copy and a real mode", () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(12);
    for (const family of BOT_FAMILIES) expect(recipesOfFamily(family).length).toBeGreaterThanOrEqual(4);
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    expect(new Set(RECIPES.map((r) => r.copyKey)).size).toBe(RECIPES.length);
    for (const r of RECIPES) {
      expect(r.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      for (const mode of r.modes) expect(isModeId(mode), `${r.id}: ${mode}`).toBe(true);
    }
  });

  it("every recipe gives valid settings for many seeds: inside RANGES, canonical, 1080×1920 at 60 fps, its own mode", () => {
    for (const recipe of RECIPES) {
      for (const bucket of LENGTH_BUCKETS) {
        for (const ending of ["resolved", "cliffhanger"] as const) {
          for (let seed = 1; seed <= 12; seed++) {
            const plan = planClip(recipe, seed * 7919 + bucket.length, "reels", { copy, bucket, ending, search: false });
            const s = plan.settings;
            const where = `${recipe.id}/${bucket}/${ending}/${seed}`;
            expect(rangeViolations(s), where).toEqual([]);
            expect(recipe.modes, where).toContain(s.mode);
            expect(sameSettings(presetToSettings(s), s), where).toBe(true);
            expect(s.recordingResolution).toBe("1080x1920");
            expect(s.fastExportFps).toBe(60);
            expect(Number.isInteger(s.recordingDuration)).toBe(true);
            expect(s.captions.length).toBeLessThanOrEqual(MAX_CAPTIONS);
            for (const c of s.captions) expect(sanitizeCaption(c), where).toEqual(c);
            expect(plan.captionRoles).toHaveLength(s.captions.length);
            expect(plan.bucket).toBe(recipeBucket(recipe, bucket));
          }
        }
      }
    }
  });

  it("the share link opens the planned settings and carries the seed", () => {
    const plan = planClip(recipeById("string-battle")!, 42, "reels", { copy, search: false, siteUrl: "https://example.com/Balls" });
    const url = new URL(plan.shareUrl);
    expect(url.origin + url.pathname).toBe("https://example.com/Balls/en/simulator/");
    expect(url.searchParams.get("seed")).toBe(String(plan.seed));
    const opened = settingsFromSearchParams(url.searchParams);
    expect(opened.mode).toBe(plan.settings.mode);
    expect(opened.captions).toEqual(plan.settings.captions);
    expect(opened.teams).toEqual(plan.settings.teams);
    expect(opened.sbLives).toBe(plan.settings.sbLives);
  });
});

describe("planner determinism", () => {
  it("planClip: the same inputs give the same plan; another plan seed a different one", () => {
    for (const id of ["ring-escape", "pendulum-wave", "string-battle", "glass-smash"]) {
      const recipe = recipeById(id)!;
      const a = planClip(recipe, 1234, "reels", { copy, maxSeeds: 4 });
      const b = planClip(recipe, 1234, "reels", { copy, maxSeeds: 4 });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const c = planClip(recipe, 1235, "reels", { copy, maxSeeds: 4 });
      expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
    }
  });

  it("planDay: the same date gives the same plan, another date another one", () => {
    const a = planDay("2026-10-05", "reels", 3, { copy, maxSeeds: 3 });
    const b = planDay("2026-10-05", "reels", 3, { copy, maxSeeds: 3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.clips).toHaveLength(3);
    expect(a.episode).toBe(dayIndexOf("2026-10-05") + 1);
    const c = planDay("2026-10-06", "reels", 3, { copy, maxSeeds: 3 });
    expect(c.clips.map((p) => p.recipe)).not.toEqual(a.clips.map((p) => p.recipe));
    expect(() => planDay("2026-02-30", "reels", 1, { copy, search: false })).toThrow();
  });

  it("a found seed plays its payoff when simulated again (the page's world, the same settings)", () => {
    const plan = planClip(recipeById("ring-escape")!, 99, "reels", { copy, bucket: "standard", ending: "resolved", maxSeeds: 12 });
    expect(plan.timing.found).toBe(true);
    const request = finderRequestOfSettings(plan.settings, plan.world, 60);
    const facts = simulateFacts(request, plan.seed, { strategy: "escape" }, 60);
    expect(facts.firstEscapeSec).toBeCloseTo(plan.payoff.atSec!, 6);
  });

  it("resolved clips land the payoff in the last 20 % of the clip, cut clips end 0.5–1 s before it", () => {
    for (const id of ["ring-escape", "pendulum-wave", "power-layers", "battle-royale", "clone-per-pass"]) {
      const recipe = recipeById(id)!;
      const resolved = planClip(recipe, 7, "reels", { copy, bucket: "standard", ending: "resolved", maxSeeds: 24 });
      expect(resolved.timing.found, id).toBe(true);
      expect(resolved.payoff.position!, id).toBeGreaterThanOrEqual(0.8);
      expect(resolved.payoff.position!, id).toBeLessThanOrEqual(0.97);
      if (recipe.endings && !recipe.endings.includes("cliffhanger")) continue;
      const cut = planClip(recipe, 7, "reels", { copy, bucket: "standard", ending: "cliffhanger", maxSeeds: 24 });
      expect(cut.timing.found, id).toBe(true);
      expect(cut.payoff.cutGapSec!, id).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(cut.payoff.cutGapSec!, id).toBeLessThanOrEqual(1 + 1e-9);
      expect(cut.captionRoles).toContain("question");
    }
  });
});

describe("square race: the payoff is the first finisher", () => {
  // The race names its winner (callout, fanfare, "wins!" badge) the moment the first racer crosses – not at the podium.
  const world = { width: 790, height: 444 };
  const firstFinishSec = (plan: ClipPlan, untilSec: number) => {
    const request = finderRequestOfSettings(plan.settings, plan.world, untilSec);
    const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, plan.seed);
    let t = 0;
    let winnerAtCut: number | null = null;
    while (t < untilSec * 1000) {
      engine.update(1000 / 60, 0);
      t += 1000 / 60;
      engine.consumeSoundEvents();
      if (winnerAtCut === null && t >= plan.timing.recordingDuration * 1000 - 1e-6) winnerAtCut = engine.getRaceProgress().winner;
      if (engine.getRaceProgress().winner >= 0) return { sec: t / 1000, winnerAtCut: winnerAtCut ?? -1, winner: engine.getRaceProgress().winner };
    }
    return { sec: -1, winnerAtCut: winnerAtCut ?? -1, winner: -1 };
  };

  it("a cut clip ends before anybody crosses the line, 0.5–1 s before the winner does", () => {
    for (const planSeed of [101, 202, 303, 404]) {
      const plan = planClip(recipeById("square-race")!, planSeed, "reels", { copy, bucket: "standard", ending: "cliffhanger", world, maxSeeds: 24 });
      expect(plan.timing.found, `${planSeed}`).toBe(true);
      const first = firstFinishSec(plan, 60);
      expect(first.winnerAtCut, `${planSeed}: winner at the cut`).toBe(-1);
      expect(first.sec - plan.timing.recordingDuration, `${planSeed}`).toBeGreaterThanOrEqual(0.5 - 1e-6);
      expect(first.sec - plan.timing.recordingDuration, `${planSeed}`).toBeLessThanOrEqual(1 + 1 / 60 + 1e-6);
      expect(plan.payoff.atSec!).toBeCloseTo(first.sec, 6);
      expect(plan.payoff.winner).toBe(plan.settings.teams[first.winner].name);
    }
  });

  it("a resolved clip shows the winner cross in its last 10–20 %", () => {
    for (const planSeed of [101, 202, 303, 404]) {
      const plan = planClip(recipeById("square-race")!, planSeed, "reels", { copy, bucket: "standard", ending: "resolved", world, maxSeeds: 24 });
      expect(plan.timing.found, `${planSeed}`).toBe(true);
      const first = firstFinishSec(plan, 60);
      expect(plan.payoff.atSec!).toBeCloseTo(first.sec, 6);
      expect(first.sec / plan.timing.clipSec, `${planSeed}`).toBeGreaterThanOrEqual(0.8);
      expect(first.sec / plan.timing.clipSec, `${planSeed}`).toBeLessThanOrEqual(0.9 + 1e-6);
    }
  });
});

describe("power layers: the hook states the rule the clip plays by", () => {
  it("names the sequence of its settings in every language, and tags #itdoubles only when it doubles", () => {
    const seen = new Set<string>();
    for (const locale of ["en", "pl", "es"] as const) {
      const c = COPY[locale];
      const rules = c.plRules as Record<string, string>;
      const tags = c.plTags as Record<string, string>;
      for (const bucket of LENGTH_BUCKETS) {
        for (const ending of ["resolved", "cliffhanger"] as const) {
          for (let seed = 1; seed <= 8; seed++) {
            const plan = planClip(recipeById("power-layers")!, seed * 31 + bucket.length, "reels", { copy: c, locale, bucket, ending, search: false });
            const sequence = plan.settings.plSequence;
            const where = `${locale}/${bucket}/${ending}/${seed}: ${sequence} "${plan.hook}"`;
            seen.add(sequence);
            expect(rules[sequence], where).toBeTruthy();
            expect(plan.hook.startsWith(rules[sequence]), where).toBe(true);
            for (const [other, text] of Object.entries(rules)) if (other !== sequence) expect(plan.hook, where).not.toContain(text);
            // The hook caption on screen is that hook (plPills is off: it is the only rule shown).
            const onScreen = plan.settings.captions.filter((_, i) => plan.captionRoles[i] === "hook").map((k) => k.text).join(" ");
            expect(onScreen, where).toBe(plan.hook);
            expect(plan.settings.plPills).toBe(false);
            const doubles = plan.post.hashtags.some((h) => h.toLowerCase() === tags.double.toLowerCase());
            expect(doubles, where).toBe(sequence === "double");
            if (tags[sequence]) expect(plan.post.hashtags, where).toContain(tags[sequence]);
            expect(plan.post.caption, where).not.toMatch(/\{\w+\}/);
            if (locale === "en" && sequence !== "double") expect(`${plan.post.caption} ${plan.hook}`, where).not.toMatch(/doubl/i);
          }
        }
      }
    }
    expect(seen.has("double")).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("the series label and the arena games' scoreboard", () => {
  const arena = RECIPES.filter((r) => r.modes.some((m) => TOP_HUD_MODES.includes(m)));

  it("puts the label in the Bottom Text of battle royale and capture the flag, the Top Text elsewhere", () => {
    expect(arena.map((r) => r.id).sort()).toEqual(["battle-royale", "territory"]);
    for (const recipe of RECIPES) {
      for (const ending of ["resolved", "cliffhanger"] as const) {
        const plan = planClip(recipe, 17, "reels", { copy, ending, search: false, episode: 3 });
        const s = plan.settings;
        if (TOP_HUD_MODES.includes(s.mode)) {
          expect(s.topText, recipe.id).toBe("");
          expect(s.bottomText, recipe.id).toBe(plan.series.label);
          expect(inSafeZone(edgeTextBox(s.bottomText, "bottom"))).toBe(true);
        } else {
          expect(s.topText, recipe.id).toBe(plan.series.label);
          expect(s.bottomText, recipe.id).toBe("");
        }
        expect(points(plan, "series"), recipe.id).toBe(10);
      }
    }
  });

  it("keeps the top captions below the scoreboard band (as the canvas stacks them)", () => {
    for (const recipe of arena) {
      const plan = planClip(recipe, 5, "reels", { copy, search: false });
      const s = plan.settings;
      const band = (BOT_FRAME.height - BOT_FRAME.width) / 2 + HUD_BAND * BOT_FRAME.width;
      for (let i = 0; i < s.captions.length; i++) {
        if (s.captions[i].position !== "top") continue;
        const box = captionBoxAt(s.captions, i, s.captions[i].start + 0.1, BOT_FRAME, false, true)!;
        expect(box.top, `${recipe.id} "${s.captions[i].text}"`).toBeGreaterThan(band);
        expect(inSafeZone(box)).toBe(true);
      }
    }
  });

  it("scores a Top Text over the scoreboard down: the countdown and the label cannot be read", () => {
    const plan = planClip(recipeById("battle-royale")!, 5, "reels", { copy, search: false });
    expect(plan.countdown.source).toBe("hud");
    expect(points(plan, "countdown")).toBe(10);
    expect(points(plan, "series")).toBe(10);
    const covered: ClipPlan = JSON.parse(JSON.stringify(plan));
    covered.settings.topText = plan.series.label;
    covered.settings.bottomText = "";
    const reasons = scoreClip(covered).reasons;
    expect(reasons.find((r) => r.id === "countdown")).toMatchObject({ key: "countdownHudCovered" });
    expect(points(covered, "countdown")).toBeLessThan(10);
    expect(reasons.find((r) => r.id === "series")).toMatchObject({ key: "seriesCovered" });
    expect(points(covered, "series")).toBe(6);
    for (const r of reasons) expect(reasonText(copy, r)).not.toMatch(/\{\w+\}/);
  });
});

describe("daily rotation", () => {
  it("never plans a recipe two days in a row, whatever the count or the series", () => {
    for (const family of ["all", ...BOT_FAMILIES] as const) {
      for (let count = 1; count <= 6; count++) {
        for (let day = -5; day < 60; day++) {
          const today = new Set(daySlots(day, count, family).map((s) => s.recipe.id));
          const tomorrow = daySlots(day + 1, count, family).map((s) => s.recipe.id);
          expect(tomorrow.filter((id) => today.has(id)), `${family} ×${count} day ${day}`).toEqual([]);
        }
      }
    }
  });

  it("rotates the leading family day by day and gives every family a turn", () => {
    const leads = Array.from({ length: 6 }, (_, d) => daySlots(d, 1)[0].recipe.family);
    for (let d = 1; d < leads.length; d++) expect(leads[d]).not.toBe(leads[d - 1]);
    expect(new Set(leads)).toEqual(new Set(BOT_FAMILIES));
    const three = daySlots(10, 3).map((s) => s.recipe.family);
    expect(new Set(three).size).toBe(3);
    const used = new Set<string>();
    for (let d = 0; d < 20; d++) for (const s of daySlots(d, 3)) used.add(s.recipe.id);
    expect(used.size).toBeGreaterThanOrEqual(12);
  });

  it("alternates the endings clip by clip and day by day", () => {
    expect(resolveEnding("auto", 1, 1)).not.toBe(resolveEnding("auto", 1, 2));
    expect(resolveEnding("auto", 1, 1)).not.toBe(resolveEnding("auto", 2, 1));
    expect(resolveEnding("cliffhanger", 1, 1)).toBe("cliffhanger");
    expect(resolveEnding("cliffhanger", 1, 1, ["resolved"])).toBe("resolved");
    const day = planDay("2026-10-07", "reels", 4, { copy, search: false });
    const endings = day.clips.map((c) => c.ending);
    for (let i = 1; i < endings.length; i++) {
      const recipe = recipeById(day.clips[i].recipe)!;
      const prev = recipeById(day.clips[i - 1].recipe)!;
      if (!recipe.endings && !prev.endings) expect(endings[i]).not.toBe(endings[i - 1]);
    }
  });

  it("takes the recipes that can fill a long bucket when some can", () => {
    for (let d = 0; d < 10; d++) {
      for (const slot of daySlots(d, 3, "all", "", "long")) {
        const half = recipesOfFamily(slot.recipe.family).filter((_, i) => i % 2 === ((d % 2) + 2) % 2);
        if (half.some((r) => !r.buckets || r.buckets.includes("long"))) expect(!slot.recipe.buckets || slot.recipe.buckets.includes("long")).toBe(true);
      }
    }
  });
});

describe("scoreClip", () => {
  const base = planClip(recipeById("ring-escape")!, 99, "reels", { copy, bucket: "standard", ending: "resolved", maxSeeds: 12 });
  const cut = planClip(recipeById("maze-race")!, 5, "reels", { copy, bucket: "standard", ending: "cliffhanger", maxSeeds: 12 });
  const clone = (plan: ClipPlan): ClipPlan => JSON.parse(JSON.stringify(plan));
  const withCaptions = (plan: ClipPlan, f: (captions: Caption[], roles: ClipPlan["captionRoles"]) => void) => {
    const p = clone(plan);
    f(p.settings.captions, p.captionRoles);
    return p;
  };

  it("adds up the checklist to 0–100", () => {
    const { score, reasons } = scoreClip(base);
    expect(reasons.map((r) => r.id)).toEqual(CHECKLIST.map((c) => c.id));
    expect(CHECKLIST.reduce((sum, c) => sum + c.points, 0)).toBe(100);
    expect(score).toBe(reasons.reduce((sum, r) => sum + r.points, 0));
    expect(score).toBeGreaterThanOrEqual(90);
    for (const r of reasons) expect(reasonText(copy, r)).not.toMatch(/\{\w+\}/);
  });

  it("motion in the first second", () => {
    const p = clone(base);
    p.timing.firstImpactSec = 0.4;
    expect(points(p, "motion")).toBe(10);
    p.timing.firstImpactSec = 1.6;
    expect(points(p, "motion")).toBe(5);
    p.timing.firstImpactSec = 3;
    expect(points(p, "motion")).toBe(0);
  });

  it("the hook: present, shown for 2–3 s from the start, inside the safe zone", () => {
    expect(points(base, "hook")).toBe(15);
    const none = withCaptions(base, (c, roles) => {
      for (let i = roles.length - 1; i >= 0; i--) if (roles[i] === "hook") {
        c.splice(i, 1);
        roles.splice(i, 1);
      }
    });
    expect(points(none, "hook")).toBe(0);
    const late = withCaptions(base, (c, roles) => roles.forEach((r, i) => r === "hook" && ((c[i].start = 4), (c[i].end = 9))));
    expect(points(late, "hook")).toBeLessThan(15);
    const wide = withCaptions(base, (c, roles) => roles.forEach((r, i) => r === "hook" && ((c[i].text = "WWWWWWWWWWWWWWWWWWWWWWWW"), (c[i].style.size = 2))));
    expect(points(wide, "hook")).toBeLessThanOrEqual(8);
  });

  it("a visible countdown", () => {
    expect(points(base, "countdown")).toBe(10);
    const none = withCaptions(base, (c, roles) => {
      const i = roles.indexOf("countdown");
      c.splice(i, 1);
      roles.splice(i, 1);
    });
    expect(points(none, "countdown")).toBe(0);
    const hud = planClip(recipeById("string-battle")!, 3, "reels", { copy, search: false });
    expect(points(hud, "countdown")).toBe(10);
    hud.settings.sbHud = false;
    expect(points(hud, "countdown")).toBe(0);
  });

  it("the payoff in the last 10–20 %, or 0.5–1 s after a cut", () => {
    const p = clone(base);
    p.payoff.position = 0.85;
    expect(points(p, "payoff")).toBe(20);
    p.payoff.position = 0.94;
    expect(points(p, "payoff")).toBe(16);
    p.payoff.position = 0.5;
    expect(points(p, "payoff")).toBe(0);
    p.payoff.position = null;
    expect(points(p, "payoff")).toBe(0);
    const c = clone(cut);
    c.payoff.cutGapSec = 0.75;
    expect(points(c, "payoff")).toBe(20);
    c.payoff.cutGapSec = 2.5;
    expect(points(c, "payoff")).toBe(10);
    c.payoff.cutGapSec = 6;
    expect(points(c, "payoff")).toBe(0);
  });

  it("a length that fits the bucket and the platform", () => {
    const p = clone(base);
    expect(points(p, "length")).toBe(10);
    p.timing.clipSec = 50;
    expect(points(p, "length")).toBe(5);
    const shorts = clone(base);
    shorts.platform = "shorts";
    shorts.bucket = "long";
    shorts.timing.clipSec = 70;
    expect(points(shorts, "length")).toBe(5);
  });

  it("sound with a melody on a scale", () => {
    expect(points(base, "sound")).toBe(10);
    const p = clone(base);
    p.melodyId = null;
    p.settings.scale = "chromatic";
    expect(points(p, "sound")).toBeLessThanOrEqual(2);
  });

  it("the ending: a tight loop after a resolved payoff, a question on a cut clip", () => {
    const p = clone(base);
    p.payoff.atSec = p.timing.clipSec - 1;
    expect(points(p, "ending")).toBe(10);
    p.payoff.atSec = p.timing.clipSec - 8;
    expect(points(p, "ending")).toBe(2);
    expect(points(cut, "ending")).toBe(10);
    const noQuestion = withCaptions(cut, (c, roles) => {
      for (let i = roles.length - 1; i >= 0; i--) if (roles[i] === "question") {
        c.splice(i, 1);
        roles.splice(i, 1);
      }
    });
    expect(points(noQuestion, "ending")).toBe(4);
  });

  it("series continuity: the label, the episode, the recurring cast", () => {
    expect(points(cut, "series")).toBe(10);
    const p = clone(cut);
    p.settings.topText = "";
    expect(points(p, "series")).toBe(6);
    p.settings.teams = p.settings.teams.map((t, i) => ({ ...t, name: `Stranger ${i}` }));
    expect(points(p, "series")).toBe(3);
    const pip = planClip(recipeById("pip-escape")!, 3, "reels", { copy, search: false });
    expect(pip.settings.ballName).toBe(MASCOT.name);
    expect(points(pip, "series")).toBe(10);
  });

  it("the look: neon on black, glow and trails", () => {
    expect(points(base, "look")).toBe(5);
    const p = clone(base);
    p.settings.backgroundColors = ["#ffffff", "#ffffff"];
    expect(points(p, "look")).toBe(2);
    p.settings.showGlow = false;
    expect(points(p, "look")).toBe(0);
  });
});

describe("safe zone", () => {
  it("keeps every hook, countdown and closing caption clear of the bottom 20 % and the right 12 %, in every language", () => {
    for (const locale of ["en", "pl", "es"]) {
      for (const recipe of RECIPES) {
        for (const ending of ["resolved", "cliffhanger"] as const) {
          for (let seed = 1; seed <= 3; seed++) {
            const plan = planClip(recipe, seed, "reels", { copy: COPY[locale], locale: locale as "en", ending, search: false });
            const s = plan.settings;
            for (let i = 0; i < s.captions.length; i++) {
              const c = s.captions[i];
              const box = captionBoxAt(s.captions, i, c.start + 0.1, undefined, !!s.topText, TOP_HUD_MODES.includes(s.mode));
              expect(box, `${locale}/${recipe.id}/${i}`).not.toBeNull();
              expect(inSafeZone(box!), `${locale}/${recipe.id} "${c.text}"`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("splits a long hook into lines that each fit, and flags a box that does not", () => {
    const lines = splitCaptionLines("Every hit doubles the power. 800 layers to go before freedom arrives", 1.2);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(estimateTextWidth(line, 48.6 * 1.2) + 1.1 * 48.6 * 1.2).toBeLessThanOrEqual(0.76 * 1080);
    expect(inSafeZone({ left: 100, right: 1000, top: 500, bottom: 560 })).toBe(false);
    expect(inSafeZone({ left: 200, right: 880, top: 1500, bottom: 1600 })).toBe(false);
    expect(inSafeZone({ left: 200, right: 880, top: 500, bottom: 560 })).toBe(true);
  });
});

describe("copy in three languages", () => {
  it("the ViralBot namespace and its Controls keys have the same structure in en, pl and es", () => {
    const k = keysOf(en.ViralBot);
    expect(keysOf(pl.ViralBot)).toEqual(k);
    expect(keysOf(es.ViralBot)).toEqual(k);
    for (const m of [en, pl, es]) {
      const controls = m.Controls as Record<string, string>;
      expect(controls.viralBot).toBeTruthy();
      expect(controls.viralBotTip).toBeTruthy();
    }
    for (const r of RECIPES) for (const field of ["name", "series", "hook", "payoff", "cliffQuestion", "postQuestion", "cliffPostQuestion", "keywords", "hashtags"]) for (const loc of ["en", "pl", "es"]) expect((COPY[loc].recipes as Record<string, Record<string, string>>)[r.copyKey]?.[field], `${loc} ${r.copyKey}.${field}`).toBeTruthy();
  });

  it("fills every placeholder and writes 5–10 niche hashtags with a specific question, per locale", () => {
    for (const locale of ["en", "pl", "es"] as const) {
      for (const recipe of RECIPES) {
        for (const ending of ["resolved", "cliffhanger"] as const) {
          const plan = planClip(recipe, 11, "tiktok", { copy: COPY[locale], locale, ending, search: false, episode: 12 });
          const where = `${locale}/${recipe.id}/${ending}`;
          expect(plan.hook, where).not.toMatch(/\{\w+\}/);
          expect(plan.post.caption, where).not.toMatch(/\{\w+\}/);
          for (const c of plan.settings.captions) expect(c.text, where).not.toMatch(/\{\w+\}/);
          expect(plan.post.hashtags.length, where).toBeGreaterThanOrEqual(HASHTAG_COUNT.min);
          expect(plan.post.hashtags.length, where).toBeLessThanOrEqual(HASHTAG_COUNT.max);
          expect(new Set(plan.post.hashtags.map((h) => h.toLowerCase())).size).toBe(plan.post.hashtags.length);
          for (const tag of plan.post.hashtags) expect(tag).toMatch(/^#[\p{L}\p{N}_]+$/u);
          expect(plan.post.hashtags).toContain(PLATFORMS.tiktok.tag);
          expect(plan.post.caption).toContain(plan.post.question);
          expect(plan.post.caption).toContain(plan.post.hashtags.join(" "));
          expect(plan.post.question.length).toBeGreaterThan(5);
          expect(plan.post.caption).toContain("12");
        }
      }
    }
  });

  it("the copy helpers", () => {
    expect(fillTemplate("Can it escape in {seconds} s? {x}", { seconds: 24 })).toBe("Can it escape in 24 s? {x}");
    expect(parseHashtags("#a #b, #A nope #c_d #")).toEqual(["#a", "#b", "#c_d"]);
    const tags = clipHashtags(copy, recipeById("polyrhythm")!, "shorts");
    expect(tags[tags.length - 1]).not.toBe("#shorts");
    expect(tags).toContain("#shorts");
    const post = postCopy(copy, { recipe: recipeById("ring-escape")!, platform: "reels", ending: "cliffhanger", hook: "Hook", episode: 3, vars: {}, postingTime: "18:00", bucketLabel: "Standard", answer: "ESCAPED" });
    expect(post.note).toContain("18:00");
    expect(post.note).toContain("ESCAPED");
    expect(post.caption.startsWith("Hook")).toBe(true);
  });
});

describe("output files", () => {
  const day = planDay("2026-10-03", "reels", 3, { copy, search: false });
  const rendered = [
    { id: day.clips[0].id, status: "done" as const, file: `${day.clips[0].id}.mp4`, durationSec: 21.5, bytes: 1234 },
    { id: day.clips[1].id, status: "failed" as const, file: null, durationSec: null, bytes: null },
  ];

  it("names every clip <episode>-<recipe>-<seed>", () => {
    for (const plan of day.clips) {
      expect(plan.id).toBe(`${plan.episodeCode}-${plan.recipe}-${plan.seed}`);
      expect(plan.episodeCode).toMatch(/^ep\d{3}-\d+$/);
      expect(captionFileName(plan)).toBe(`${plan.id}.txt`);
    }
  });

  it("the manifest: recipe, seed, share URL, caption, score, ending and posting time per clip", () => {
    const manifest = JSON.parse(JSON.stringify(buildManifest(day.clips, copy, { date: day.date, platform: "reels", locale: "en" }, rendered)));
    expect(manifest.format).toBe(MANIFEST_FORMAT);
    expect(manifest.version).toBe(1);
    expect(manifest.date).toBe("2026-10-03");
    expect(manifest.clips).toHaveLength(3);
    const fields = ["episode", "day", "index", "recipe", "family", "mode", "seed", "planSeed", "status", "file", "captionFile", "durationSec", "recordingDuration", "bucket", "ending", "payoff", "hook", "score", "reasons", "shareUrl", "caption", "hashtags", "postingTime", "postingNote", "melody", "cover" /* --- mode-thumbnails --- */];
    for (const clip of manifest.clips) {
      expect(Object.keys(clip).sort()).toEqual([...fields].sort());
      expect(clip.shareUrl).toContain(`seed=${clip.seed}`);
      expect(clip.postingTime).toMatch(/^2026-10-03 \d{2}:\d{2}$/);
      expect(["resolved", "cliffhanger"]).toContain(clip.ending);
      expect(clip.reasons).toHaveLength(CHECKLIST.length);
    }
    expect(manifest.clips[0].status).toBe("done");
    expect(manifest.clips[0].file).toBe(`${day.clips[0].id}.mp4`);
    expect(manifest.clips[0].durationSec).toBe(21.5);
    expect(manifest.clips[1].status).toBe("failed");
    expect(manifest.clips[2].status).toBe("planned");
  });

  it("the caption file, the posting schedule and the whole set", () => {
    const text = captionFileText(day.clips[0], copy);
    expect(text).toContain(day.clips[0].post.caption);
    expect(text).toContain(day.clips[0].shareUrl);
    expect(text).toContain(day.clips[0].post.note);
    const md = scheduleMarkdown(day.clips, copy, { date: day.date, platform: "reels" }, rendered);
    expect(md.startsWith("# Posting schedule")).toBe(true);
    expect(md.split("\n").filter((l) => /^\| \d+ \|/.test(l))).toHaveLength(3);
    expect(md).toContain(`${day.clips[0].id}.mp4`);
    const files = batchTextFiles(day.clips, copy, { date: day.date, platform: "reels", locale: "en" }, rendered);
    expect(files.map((f) => f.name)).toEqual([...day.clips.map((p) => `${p.id}.txt`), "manifest.json", "posting-schedule.md"]);
  });

  it("keeps the panel's state valid (unknown options fall back, foreign plans are dropped)", () => {
    const state = parseBotState({ options: { platform: "myspace", count: 99, family: "battle", bucket: "long", ending: "nope" }, plan: { date: day.date, platform: "reels", kind: "today", clips: [...day.clips, { version: 0 }] } });
    expect(state.options).toEqual({ platform: "reels", count: 50, family: "battle", bucket: "long", ending: "auto" }); // --- uncap-all --- (past the slider's 20, up to the clips' memory-safety ceiling)
    expect(state.plan?.clips).toHaveLength(3);
    expect(parseBotState("junk").plan).toBeNull();
  });
});

describe("the roster and the buckets", () => {
  it("battles use the recurring roster, in order", () => {
    const plan = planClip(recipeById("maze-race")!, 8, "reels", { copy, search: false });
    plan.settings.teams.forEach((t, i) => expect(t).toEqual(SERIES_ROSTER[i]));
  });

  it("a recipe that cannot fill a bucket plays the nearest one it can", () => {
    const battle = recipeById("string-battle") as BotRecipe;
    expect(recipeBucket(battle, "long")).toBe("standard");
    expect(recipeBucket(battle, "short")).toBe("standard");
    expect(recipeBucket(recipeById("pendulum-wave")!, "long")).toBe("long");
    for (const b of LENGTH_BUCKETS) expect(BUCKET_SECONDS[b].max).toBeGreaterThan(BUCKET_SECONDS[b].min);
  });
});
