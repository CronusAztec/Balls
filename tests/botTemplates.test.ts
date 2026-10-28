import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import es from "../messages/es.json";
import pl from "../messages/pl.json";
import { MAX_CAPTIONS, sanitizeCaption } from "@/lib/captions";
import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { sameSettings } from "@/lib/recording/batch";
import { RANGES, presetToSettings, type SimulatorSettings } from "@/lib/settings";
import type { BotCopy, BotLocale } from "@/lib/bot/copy";
import { BOT_DEFAULT_FAMILIES, BOT_PLATFORMS, LENGTH_BUCKETS, PLATFORMS, RECIPES, recipeById, type BotPlatform } from "@/lib/bot/playbook";
import { BOT_PLAN_VERSION, drain, hashString, matchupEpisode, planClip, planDay, planTemplate, rerollClipSteps, type ClipPlan } from "@/lib/bot/planner";
import { parseBotState } from "@/lib/bot/store";
import {
  BINDINGS,
  MODE_TEMPLATES,
  SIMPLE_LOOK,
  SIMPLE_TEXT,
  TEMPLATE_FORMATS,
  TEMPLATE_FORMAT_IDS,
  allTemplates,
  botRecipeById,
  readyTemplates,
  simpleHookText,
  simplePayoffText,
  templateById,
  templateRecipeById,
} from "@/lib/bot/templates";
import { runFactsSync, runSync, scoreRecipeFor } from "@/lib/insights/score";
import { CLAIMS, CLAIM_OF_RECIPE, crewClipOfPlan } from "@/lib/crew/clip";
import { clarityOf, type GateId } from "@/lib/crew/clarity";
import { HUD_FLAGS, hudsOn } from "@/lib/crew/hudFlags";
import { crowding, overlaysOf, SIMPLE_TRAIL_THICKNESS, wordCount } from "@/lib/crew/simplicity";

/*
 * --- templates --- The viral templates (lib/bot/templates.ts) and the Simple look: every mode bound once to one of the ten
 * formats, the 16 proven bindings ready and the other 32 hidden, the adapter the planner plans like a recipe, the template-aware
 * recipe lookups (scoreClip, the re-roll, the Insights score), the bot's own look byte-identical to before, and the Simple look
 * measured – one text at a time, Simple 80 or more, the checklist's look item kept, the run untouched.
 */

// Planning simulates physics seed by seed: a busy machine can take many times the usual couple of seconds per test.
vi.setConfig({ testTimeout: 60_000 });

const COPY: Record<BotLocale, BotCopy> = { en: en.ViralBot as BotCopy, pl: pl.ViralBot as BotCopy, es: es.ViralBot as BotCopy };
const copy = COPY.en;
const SITE = "https://example.test";

/** The 16 modes a playbook recipe plays: the proven bindings. */
const PROVEN: readonly ModeId[] = ["classic", "accumulation", "portal", "glass", "powerLayers", "grow", "multiply", "multipliers", "race", "ctf", "battle", "stringBattle", "fightLeague", "pendulum", "polyrhythm", "drop"];
/** The variants of ready bindings that are hidden, and why (they fail a gate on every plan). */
const HIDDEN_VARIANTS = ["who-wins-fight-league-boss"];
/**
 * The gates a ready template fails on every plan, by design of its mode: the square race's 3-2-1-GO opens the gate at 1.8 s
 * (G1, the first motion within 1 s), as in today's bot clips (docs/virality-playbook.md §5).
 */
const GATE_EXCEPTIONS: Readonly<Record<string, readonly GateId[]>> = { "who-wins-race": ["G1"] };

/** Every numeric setting that has a range is inside it and on its step (as tests/bot.test.ts checks the recipes). */
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

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const reason = (plan: ClipPlan, id: string) => plan.reasons.find((r) => r.id === id)!;
const ready = readyTemplates("all");
/** The platforms a template's buckets fit. */
const platformsOf = (id: string): BotPlatform[] => {
  const r = templateRecipeById(id)!;
  return BOT_PLATFORMS.filter((p) => !r.buckets || r.buckets.some((b) => PLATFORMS[p].buckets.includes(b)));
};

/** The settings the Simple look may change: its look fields, the theme's, the HUD flags and the texts it draws. */
const LOOK_KEYS = new Set<string>([...Object.keys(SIMPLE_LOOK).filter((k) => k !== "background"), "backgroundType", "backgroundColors", "particleStyle", ...HUD_FLAGS.map((h) => h.key), "topText", "bottomText", "captions"]);

describe("the bindings", () => {
  it("binds every mode once to one of the ten formats; the ids are kebab-case, unique and never a recipe's", () => {
    expect(Object.keys(MODE_TEMPLATES).sort()).toEqual([...MODE_IDS].sort());
    expect(BINDINGS.map((b) => b.mode)).toEqual([...MODE_IDS]);
    for (const b of BINDINGS) {
      expect(MODE_TEMPLATES[b.mode].mode).toBe(b.mode);
      expect(TEMPLATE_FORMAT_IDS).toContain(b.format);
      expect(b.variants.length).toBeGreaterThanOrEqual(1);
    }
    const ids = allTemplates().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(RECIPES.map((r) => r.id)).not.toContain(id);
      expect(recipeById(id)).toBeUndefined();
    }
    const perFormat = Object.fromEntries(TEMPLATE_FORMAT_IDS.map((f) => [f, BINDINGS.filter((b) => b.format === f).length]));
    expect(perFormat).toEqual({ getOut: 7, smash: 4, fill: 3, count: 4, whoWins: 8, aim: 3, lineUp: 8, onTheBeat: 7, reveal: 3, labGame: 1 });
    for (const f of TEMPLATE_FORMAT_IDS) {
      expect(TEMPLATE_FORMATS[f].id).toBe(f);
      expect(CLAIMS).toContain(TEMPLATE_FORMATS[f].claim);
    }
    expect(new Set(TEMPLATE_FORMAT_IDS.map((f) => TEMPLATE_FORMATS[f].claim)).size).toBe(TEMPLATE_FORMAT_IDS.length);
  });

  it("readies the 16 proven bindings, each variant wrapping a recipe of its mode; the other 32 are declared and hidden", () => {
    const proven = BINDINGS.filter((b) => b.tier === "proven").map((b) => b.mode);
    expect([...proven].sort()).toEqual([...PROVEN].sort());
    expect(BINDINGS.filter((b) => b.ready).map((b) => b.mode).sort()).toEqual([...PROVEN].sort());
    // the proven ones are exactly the modes the playbook's recipes play
    expect([...new Set(RECIPES.flatMap((r) => r.modes))].sort()).toEqual([...PROVEN].sort());
    for (const b of BINDINGS) {
      for (const v of b.variants) {
        if (b.ready) {
          const recipe = recipeById(v.recipe);
          expect(recipe, v.id).toBeDefined();
          expect(recipe!.modes, v.id).toContain(b.mode);
          // the crew's claim of the recipe is the format's
          expect(CLAIM_OF_RECIPE[recipe!.id], v.id).toBe(TEMPLATE_FORMATS[b.format].claim);
        } else {
          expect(v.recipe, v.id).toBeNull();
          expect(templateRecipeById(v.id), v.id).toBeUndefined();
        }
      }
    }
    expect(allTemplates().filter((t) => t.binding.ready && !t.ready).map((t) => t.id)).toEqual(HIDDEN_VARIANTS);
    expect(allTemplates().filter((t) => t.ready).length).toBe(ready.length);
    expect(BINDINGS.filter((b) => !b.ready)).toHaveLength(32);
  });

  it("never binds a looping mode to 'finish', and keeps only a HUD that shows the countdown", () => {
    for (const mode of ["conveyor", "mergeRing", "brickRebuild", "colourSort", "collide", "waveTank", "lines", "drawingMachine", "illusion"] as const) expect(MODE_TEMPLATES[mode].strategy, mode).not.toBe("finish");
    for (const b of BINDINGS) {
      if (b.strategy === "outcome") expect(b.outcome, b.mode).toBeDefined();
      if (b.keepHud === null) continue;
      const flag = HUD_FLAGS.find((h) => h.key === b.keepHud);
      expect(flag?.counts, b.mode).toBe(true);
      expect(flag!.modes === "any" || flag!.modes.includes(b.mode), b.mode).toBe(true);
    }
  });

  it("offers the battle family only when it is asked for, as the daily bot does", () => {
    expect(readyTemplates().every((t) => BOT_DEFAULT_FAMILIES.includes(t.family!))).toBe(true);
    expect(readyTemplates().some((t) => t.mode === "fightLeague")).toBe(false);
    expect(readyTemplates("battle").map((t) => t.mode)).toEqual(expect.arrayContaining(["race", "ctf", "battle", "stringBattle", "fightLeague"]));
    expect(readyTemplates("battle").every((t) => t.family === "battle")).toBe(true);
    expect(readyTemplates("all")).toHaveLength(readyTemplates("default").length + readyTemplates("battle").length);
  });
});

describe("the adapter", () => {
  it("plans valid settings for many seeds: inside RANGES, canonical, its mode, its buckets and endings, in the Simple look", () => {
    for (const t of ready) {
      const recipe = templateRecipeById(t.id)!;
      for (const bucket of LENGTH_BUCKETS) {
        for (const ending of ["resolved", "cliffhanger"] as const) {
          for (let seed = 1; seed <= 4; seed++) {
            const plan = planTemplate(t.id, seed * 7919 + bucket.length, "reels", { copy, bucket, ending, search: false });
            const s = plan.settings;
            const where = `${t.id}/${bucket}/${ending}/${seed}`;
            expect(rangeViolations(s), where).toEqual([]);
            expect(s.mode, where).toBe(t.mode);
            expect(plan.mode, where).toBe(t.mode);
            expect(sameSettings(presetToSettings(s), s), where).toBe(true);
            expect(s.captions.length).toBeLessThanOrEqual(MAX_CAPTIONS);
            for (const c of s.captions) expect(sanitizeCaption(c), where).toEqual(c);
            expect(plan.captionRoles).toHaveLength(s.captions.length);
            expect(plan.recipe, where).toBe(t.id);
            expect(plan.template, where).toBe(t.id);
            expect(plan.look, where).toBe("simple");
            if (recipe.buckets) expect(recipe.buckets, where).toContain(plan.bucket);
            expect(recipe.endings ?? ["resolved", "cliffhanger"], where).toContain(plan.ending);
            expect(TEMPLATE_FORMATS[t.binding.format].endings, where).toContain(plan.ending);
          }
        }
      }
    }
  });

  it("is planned from its id, the same for the same inputs, and refuses a hidden or unknown template", () => {
    const a = planTemplate("get-out-classic", 5, "reels", { copy, maxSeeds: 6, siteUrl: SITE });
    const b = planTemplate("get-out-classic", 5, "reels", { copy, maxSeeds: 6, siteUrl: SITE });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(planTemplate("get-out-classic", 6, "reels", { copy, maxSeeds: 6, siteUrl: SITE }))).not.toBe(JSON.stringify(a));
    expect(() => planTemplate("who-wins-fight-league-boss", 1, "reels", { copy, search: false })).toThrow();
    expect(() => planTemplate("smash-target", 1, "reels", { copy, search: false })).toThrow();
    expect(() => planTemplate("ring-escape", 1, "reels", { copy, search: false })).toThrow();
    // the bot's own look on request
    const bot = planTemplate("get-out-classic", 5, "reels", { copy, search: false, look: "bot" });
    expect(bot.look).toBeUndefined();
    expect(bot.template).toBe("get-out-classic");
    expect(bot.settings.topText).not.toBe("");
  });

  it("resolves the template's id back wherever a plan's recipe is looked up: scoreClip, scoreRecipeFor, the re-roll", () => {
    for (const t of ready) {
      const recipe = templateRecipeById(t.id)!;
      expect(botRecipeById(t.id)).toBe(recipe);
      expect(recipe.wraps).toBe(t.recipe!.id);
      expect(recipe.modes).toEqual([t.mode]);
      expect(recipe.copyKey).toBe(t.recipe!.copyKey);
      expect(scoreRecipeFor(t.mode, t.id)).toBe(recipe);
      // another mode than the template's: the mode's own playbook recipe, as for a recipe id
      const other = t.mode === "classic" ? "drop" : "classic";
      expect(scoreRecipeFor(other, t.id)).toBe(scoreRecipeFor(other, null));
    }
    // music-first: the mode's own notes are the melody (no MIDI melody), and the sound item counts it
    const wave = planTemplate("line-up-pendulum", 3, "reels", { copy, search: false });
    expect(wave.melodyId).toBeNull();
    expect(reason(wave, "sound").key).toBe("soundOk");
    expect(reason(wave, "sound").points).toBeGreaterThanOrEqual(8);
    // the character: Gerald's name keeps the series' cast
    const glass = planTemplate("get-out-glass", 3, "reels", { copy, search: false });
    expect(glass.settings.ballName).toBe("Gerald");
    expect(reason(glass, "series").points).toBe(6); // the episode and the cast; no label on the clip in the Simple look
    // the re-roll: the same template, look, mode and place, a new plan seed
    const plan = planTemplate("get-out-classic-gerald", 9, "tiktok", { copy, maxSeeds: 6, episode: 4, index: 2 });
    const again = drain(rerollClipSteps(plan, { copy, maxSeeds: 6 }));
    expect(again.template).toBe(plan.template);
    expect(again.recipe).toBe(plan.recipe);
    expect(again.look).toBe("simple");
    expect(again.mode).toBe("classic");
    expect(again.planSeed).not.toBe(plan.planSeed);
    expect([again.episode, again.index, again.platform, again.ending]).toEqual([plan.episode, plan.index, plan.platform, plan.ending]);
    // a recipe's plan re-rolls in the bot look, as before
    const ring = planClip(recipeById("ring-escape")!, 9, "reels", { copy, search: false });
    const ringAgain = drain(rerollClipSteps(ring, { copy, search: false }));
    expect(ringAgain.look).toBeUndefined();
    expect(ringAgain.template).toBeUndefined();
  });

  it("counts a fight template's matchup by the days of the recipe it wraps", () => {
    const duel = recipeById("fight-duel")!;
    const template = templateRecipeById("who-wins-fight-league")!;
    for (const planSeed of [11, 222, 3333]) {
      const key = duel.matchup!(planSeed).key;
      expect(template.matchup!(planSeed).key).toBe(key);
      for (const episode of [1, 9, 30]) expect(matchupEpisode(template, key, episode)).toBe(matchupEpisode(duel, key, episode));
    }
  });

  it("keeps the plan version at 1: a stored template plan and a stored older one both load", () => {
    expect(BOT_PLAN_VERSION).toBe(1);
    const template = planTemplate("count-multiply", 2, "reels", { copy, search: false });
    const old = planClip(recipeById("clone-per-pass")!, 2, "reels", { copy, search: false });
    const state = parseBotState(JSON.parse(JSON.stringify({ options: {}, plan: { date: "2026-10-28", platform: "reels", kind: "custom", clips: [template, old] } })));
    expect(state.plan?.clips).toHaveLength(2);
    expect(state.plan!.clips[0].template).toBe("count-multiply");
    expect(state.plan!.clips[0].look).toBe("simple");
    expect("template" in state.plan!.clips[1]).toBe(false);
    expect("look" in state.plan!.clips[1]).toBe(false);
  });

  it("gives the crew the template and its format's claim", () => {
    for (const t of ready.slice(0, 6)) {
      const plan = planTemplate(t.id, 1, "reels", { copy, search: false });
      const clip = crewClipOfPlan(plan);
      expect(clip.template).toBe(t.id);
      expect(clip.recipe).toBe(t.id);
      expect(clip.claim).toBe(TEMPLATE_FORMATS[t.binding.format].claim);
      // the hook's author plays the clip's mode (G4)
      expect(clarityOf(clip).gates.find((g) => g.id === "G4")!.problems).not.toContain("wordsMatchPictureHookElsewhere");
    }
  });
});

/**
 * The bot look's plans as they were before the templates (a digest of each plan's JSON, planner.ts hashString), on fixtures of
 * every recipe: no search (en, reels, day 4, clip 2; pl, TikTok, day 9, a cliffhanger), a short search and a whole day.
 */
const BOT_DIGESTS: readonly (readonly [string, number, number])[] = [
  ["ring-escape", 2928545730, 3508333869],
  ["pip-escape", 3045835546, 3288528801],
  ["grow-fill", 2861649630, 4149103819],
  ["clone-per-pass", 357437564, 3673670190],
  ["multipliers-board", 548241521, 606634611],
  ["power-layers", 4141176622, 643044147],
  ["pendulum-wave", 3496796328, 2513376003],
  ["polyrhythm", 2825778873, 904885007],
  ["drop-symphony", 1321345401, 1949178032],
  ["glass-smash", 3393907217, 512740862],
  ["string-battle", 1277820912, 4028239604],
  ["territory", 2718466655, 3666361527],
  ["battle-royale", 1330852376, 1619894476],
  ["square-race", 2082586849, 1701544269],
  ["maze-race", 2359458233, 2583651853],
  ["fight-duel", 1315369546, 1789989685],
  ["fight-upset", 3073230687, 3826132087],
  ["fight-bracket", 3278532894, 1168343280],
  ["fight-boss", 2037265902, 2935628658],
];
const BOT_SEARCH_DIGESTS: readonly (readonly [string, number])[] = [
  ["ring-escape", 145578475],
  ["drop-symphony", 958429264],
  ["power-layers", 3662482808],
  ["square-race", 2188407354],
];
const BOT_DAY_DIGEST = 4171265516;

describe("the bot's own look", () => {
  const digest = (value: unknown) => hashString(JSON.stringify(value));

  it("plans every recipe byte for byte as before the templates (no search, a search, a day)", { timeout: 120_000 }, () => {
    expect(BOT_DIGESTS.map(([id]) => id)).toEqual(RECIPES.map((r) => r.id));
    for (const [id, a, b] of BOT_DIGESTS) {
      const r = recipeById(id)!;
      expect(digest(planClip(r, 7, "reels", { copy: COPY.en, search: false, siteUrl: SITE, episode: 4, index: 2 })), id).toBe(a);
      expect(digest(planClip(r, 11, "tiktok", { copy: COPY.pl, locale: "pl", search: false, siteUrl: SITE, episode: 9, index: 1, ending: "cliffhanger" })), id).toBe(b);
    }
    for (const [id, d] of BOT_SEARCH_DIGESTS) expect(digest(planClip(recipeById(id)!, 3, "shorts", { copy, siteUrl: SITE, maxSeeds: 6, episode: 2 })), id).toBe(d);
    expect(digest(planDay("2026-10-20", "reels", 3, { copy, siteUrl: SITE, search: false, family: "all" }))).toBe(BOT_DAY_DIGEST);
  });

  it("is the default: look 'bot' plans what no look plans", () => {
    for (const r of RECIPES) {
      const none = planClip(r, 4, "shorts", { copy, search: false, siteUrl: SITE });
      expect(JSON.stringify(planClip(r, 4, "shorts", { copy, search: false, siteUrl: SITE, look: "bot" })), r.id).toBe(JSON.stringify(none));
      expect("look" in none).toBe(false);
      expect("template" in none).toBe(false);
    }
  });
});

describe("the Simple look", () => {
  it("cuts a long hook and a long payoff by whole clauses, never adding a word", () => {
    expect(simpleHookText("Can it escape in 20 seconds?")).toBe("Can it escape in 20 seconds?");
    expect(simpleHookText("It grows every bounce. Watch it fill the ring.")).toBe("It grows every bounce.");
    expect(simpleHookText("Pick a side: which colour takes the board?")).toBe("Which colour takes the board?");
    expect(simpleHookText("Elige bando: ¿qué color se queda el tablero?")).toBe("¿Qué color se queda el tablero?");
    expect(simpleHookText("Every hit doubles the power. 400 layers to go.")).toBe("Every hit doubles the power.");
    expect(simpleHookText("3 lives each. Cut a string, cost a life.")).toBe("3 lives each.");
    expect(simpleHookText("Can Gerald beat all 3 Sandbox & online games fighters?")).toBe("Can Gerald beat all 3 Sandbox & online games fighters?");
    expect(simplePayoffText("FREE! Gerald made it 🎉")).toBe("FREE!");
    expect(simplePayoffText("UPSET! Thor wins! 😱")).toBe("UPSET! Thor wins! 😱");
    expect(simplePayoffText("Thor is the champion! 🏆")).toBe("Thor is the champion! 🏆");
    expect(SIMPLE_TEXT.hookWordsMax).toBe(7);
  });

  it("draws the calm look: its look fields, the HUDs off but the kept one, no Top or Bottom Text, the checklist's look item at 5", () => {
    expect(SIMPLE_LOOK.trailThickness).toBe(SIMPLE_TRAIL_THICKNESS);
    for (const t of ready) {
      const plan = planTemplate(t.id, 2, "reels", { copy, search: false });
      const s = plan.settings;
      for (const [key, value] of Object.entries(SIMPLE_LOOK)) {
        if (key === "background") expect(s.backgroundColors, t.id).toEqual([...SIMPLE_LOOK.background]);
        else if (key === "trailThickness") expect(s.trailThickness, t.id).toBeLessThanOrEqual(SIMPLE_TRAIL_THICKNESS);
        else expect((s as unknown as Record<string, unknown>)[key], `${t.id} ${key}`).toEqual(value);
      }
      expect(s.backgroundType).toBe("gradient");
      expect(s.particleStyle).not.toBe("confetti");
      expect([s.topText, s.bottomText], t.id).toEqual(["", ""]);
      expect(hudsOn(s).filter((h) => h.flag).map((h) => h.id), t.id).toEqual(t.binding.keepHud ? [t.binding.keepHud] : []);
      expect(reason(plan, "look").points, t.id).toBe(5);
      // the series label is in the post caption instead
      expect(plan.post.caption, t.id).toContain(plan.series.label);
    }
  });

  it("puts one text on screen at a time: a hook of at most 7 words on at most 2 lines, every caption in the safe zone, in en, pl and es", { timeout: 120_000 }, () => {
    for (const locale of ["en", "pl", "es"] as const) {
      for (const t of ready) {
        for (const platform of platformsOf(t.id)) {
          for (const seed of [1, 2]) {
            const plan = planTemplate(t.id, seed, platform, { copy: COPY[locale], locale, search: false, episode: 12, index: seed });
            const where = `${locale}/${t.id}/${platform}/${seed}`;
            const clip = crewClipOfPlan(plan);
            const texts = overlaysOf(clip).filter((o) => ["hook", "countdown", "payoff", "question"].includes(o.kind));
            expect(crowding(texts, clip.timing.clipSec).most, where).toBeLessThanOrEqual(1);
            expect(wordCount(plan.hook), where).toBeLessThanOrEqual(SIMPLE_TEXT.hookWordsMax);
            expect(plan.captionRoles.filter((r) => r === "hook").length, where).toBeLessThanOrEqual(2);
            const readable = clarityOf(clip).gates.find((g) => g.id === "G5")!;
            expect(readable.problems.filter((p) => p !== "readableHurried"), where).toEqual([]);
          }
        }
      }
    }
  });

  it("leaves the run alone: the same settings but the look, the same seed, and runFactsSync identical for every ready template", { timeout: 180_000 }, () => {
    for (const t of ready) {
      for (const seed of [1, 2]) {
        const platform = platformsOf(t.id)[0];
        const simple = planTemplate(t.id, seed, platform, { copy, search: false });
        const bot = planTemplate(t.id, seed, platform, { copy, search: false, look: "bot" });
        const where = `${t.id}/${seed}`;
        expect(simple.seed, where).toBe(bot.seed);
        const changed = Object.keys(simple.settings).filter((k) => JSON.stringify((simple.settings as unknown as Record<string, unknown>)[k]) !== JSON.stringify((bot.settings as unknown as Record<string, unknown>)[k]));
        expect(changed.filter((k) => !LOOK_KEYS.has(k)), where).toEqual([]);
        expect(runFactsSync(simple.settings, simple.seed, simple.world, simple.recipe), where).toEqual(runFactsSync(bot.settings, bot.seed, bot.world, bot.recipe));
      }
    }
  });

  it("takes the recipes to Simple 80 or more for at most 5 Playbook points, the look item kept", { timeout: 180_000 }, () => {
    const simple: number[] = [];
    const before: number[] = [];
    const after: number[] = [];
    for (const r of RECIPES) {
      const bot = planClip(r, 1, "reels", { copy, episode: 3, index: 1 });
      const calm = planClip(r, 1, "reels", { copy, episode: 3, index: 1, look: "simple" });
      const run = runSync(calm.settings, calm.seed, calm.world, calm.recipe, calm.timing.clipSec);
      simple.push(clarityOf(crewClipOfPlan(calm, { run })).simple.score);
      before.push(bot.score);
      after.push(calm.score);
      expect(reason(calm, "look").points, r.id).toBe(5);
    }
    expect(median(simple)).toBeGreaterThanOrEqual(80);
    expect(median(before) - median(after)).toBeLessThanOrEqual(5);
  });

  it("every ready template passes every clarity gate on 3 of 4 plan seeds at Playbook 75+, each plan at Simple 80+", { timeout: 240_000 }, () => {
    for (const t of ready) {
      const platform = platformsOf(t.id)[0];
      const except = new Set(GATE_EXCEPTIONS[t.id] ?? []);
      let passed = 0;
      const seen = new Set<GateId>();
      for (const seed of [1, 2, 3, 4]) {
        const plan = planTemplate(t.id, seed, platform, { copy, episode: 3, index: seed });
        const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec);
        const clarity = clarityOf(crewClipOfPlan(plan, { run }));
        const where = `${t.id}/${platform}/${seed}`;
        expect(clarity.simple.score, where).toBeGreaterThanOrEqual(80);
        const failed = clarity.gates.filter((g) => !g.ok).map((g) => g.id);
        for (const g of failed) if (except.has(g)) seen.add(g);
        // (a plan whose seed search found no payoff fails a gate and loses its payoff points: it is the 1 in 4)
        if (failed.every((g) => except.has(g))) {
          passed++;
          expect(plan.score, where).toBeGreaterThanOrEqual(75);
        }
      }
      expect(passed, t.id).toBeGreaterThanOrEqual(3);
      // an exception that no longer happens is no exception: the table only shrinks
      expect([...seen].sort(), t.id).toEqual([...except].sort());
    }
  });

  it("templates' ids and claims reach the crew from a plan that records them", () => {
    const plan = planTemplate("smash-power-layers", 4, "reels", { copy, search: false });
    expect(templateById(plan.template)?.format.claim).toBe("break");
    expect(crewClipOfPlan(plan).claim).toBe("break");
  });
});
