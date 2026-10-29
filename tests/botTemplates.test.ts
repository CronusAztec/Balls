import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import es from "../messages/es.json";
import pl from "../messages/pl.json";
import { MAX_CAPTIONS, sanitizeCaption } from "@/lib/captions";
import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { sameSettings } from "@/lib/recording/batch";
import { RANGES, defaultSettings, presetToSettings, type SimulatorSettings } from "@/lib/settings";
import type { BotCopy, BotLocale } from "@/lib/bot/copy";
import { BOT_DEFAULT_FAMILIES, BOT_PLATFORMS, CLIFF_GAP_SEC, LENGTH_BUCKETS, PAYOFF_BAND, PAYOFF_STRATEGIES, PLATFORMS, RECIPES, recipeById, type BotPlatform, type RecipeContext } from "@/lib/bot/playbook";
import {
  ACTION_GAIN_SEC,
  BOT_PLAN_VERSION,
  bannerCoverSec,
  actionCoverSec,
  bottomEdgeFree,
  captionMessagesOf,
  captionsAtEdge,
  captionWordsOf,
  clipTiming,
  drain,
  evenCaptionLines,
  hashString,
  inReadingOrder,
  MARK_MODES,
  matchupEpisode,
  payoffSecOf,
  placeSimpleTexts,
  planClip,
  planDay,
  planTemplate,
  rerollClipSteps,
  seededRandom,
  simulateFacts,
  splitCaptionLines,
  type ClipPlan,
} from "@/lib/bot/planner";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { ACTION_GRID, ACTION_STEP_SEC, BANNER_MODES, actionCellsOf, actionTrackSync, actionUnder, isActionTrack, modeBannersDrawn, type ActionTrack } from "@/lib/bot/actionTrack";
import { SERIES_ROSTER } from "@/lib/bot/playbook";
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
  askHookText,
  CHORD_WORDS,
  simpleHookText,
  simplePayoffText,
  stakeNumbersOf,
  templateById,
  templateRecipeById,
  EXPERIMENTAL,
  OUTCOME_FLAG_SETTINGS,
  outcomeFlagHolds,
  ownSettingsOf,
  plannedRecipe,
  strategyCanPlan,
  variantBinding,
  type OutcomeFlag,
} from "@/lib/bot/templates";
import { AT_END_BUCKETS, AT_END_SEC, FILL_OUTCOMES, OUTCOME_MOMENTS, OWN_RUN_MODE_MOMENTS, OWN_RUN_MOMENTS, atEndRecordingSec, bucketPayoffSec, outcomeRunOf, outcomeStrategyPlans, payoffWindow, strategyOutcome } from "@/lib/bot/outcomeStrategy";
import { outcomeContextOfSettings } from "@/lib/simulation/outcomeContext";
import { availableOutcomes } from "@/lib/simulation/outcomes";
import { simulateOutcomeRun } from "@/lib/simulation/finder";
import { runFactsSync, runSync, scoreRecipeFor } from "@/lib/insights/score";
import { CLAIMS, CLAIM_OF_RECIPE, claimSeen, crewClipOfPlan } from "@/lib/crew/clip";
import { CLARITY, clarityOf, counterCutReading } from "@/lib/crew/clarity";
import { HUD_FLAGS, MODE_END_BANNERS, endBannersIn, hudsOn } from "@/lib/crew/hudFlags";
import { screenView } from "@/lib/crew/dossier";
import { OWN_HOOK_FIELD, OWN_PAYOFF_FIELD } from "@/lib/bot/copy";
import { crowding, drawnHookText, endBannersShown, overlaysOf, SIMPLE_TRAIL_THICKNESS, textOverActionSec, wordCount } from "@/lib/crew/simplicity";

/*
 * --- templates --- The viral templates (lib/bot/templates.ts) and the Simple look: every mode bound once to one of the ten
 * formats, the 16 proven bindings (15 ready: the square race's one variant is hidden; --- templates --- AI studio step 5: Ball Drop's
 * plays on the beat, its rain looped), the trial bindings AI studio steps 3 to 5 readied with their own settings (TRIAL_READY) and
 * the rest hidden, the adapter the planner plans like a recipe, the template-aware recipe lookups (scoreClip, the re-roll, the Insights
 * score), the bot's own look byte-identical to before, and the Simple look measured – one text at a time, Simple 80 or more,
 * the checklist's look item kept, the run untouched.
 */

// Planning simulates physics seed by seed: a busy machine can take many times the usual couple of seconds per test.
vi.setConfig({ testTimeout: 60_000 });
/**
 * A turn of the event loop between long synchronous plans: vitest runs one synchronous test after another without one, and a
 * minute without it times its worker's RPC out ("Timeout calling onTaskUpdate").
 */
const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

const COPY: Record<BotLocale, BotCopy> = { en: en.ViralBot as BotCopy, pl: pl.ViralBot as BotCopy, es: es.ViralBot as BotCopy };
const copy = COPY.en;
const SITE = "https://example.test";

/** The 16 modes a playbook recipe plays: the proven bindings. */
const PROVEN: readonly ModeId[] = ["classic", "accumulation", "portal", "glass", "powerLayers", "grow", "multiply", "multipliers", "race", "ctf", "battle", "stringBattle", "fightLeague", "pendulum", "polyrhythm", "drop"];
/**
 * --- templates --- (review round 2, 14 and 21) The proven bindings that plan: all but the square race, whose one variant is
 * hidden (--- templates --- AI studio step 5: and Ball Drop's, hidden in review round 2 for its fading run, plays its rain looped).
 */
const READY_MODES: readonly ModeId[] = PROVEN.filter((m) => m !== "race");
/**
 * --- templates --- (AI studio step 4) The trial bindings group B readied with their own settings, measured and watched as group A's:
 * the conveyor (its last ball out), the Maze (its first one out), Territory and Land Claim (cut before their verdict), Bullseye (its
 * first bullseye), Bouncing Shapes (its first shape at zero) and Paddle Keep-Up (its GAME OVER). Merge Ring stays experimental: its
 * own question under the ring for the whole run (watched in the render).
 */
const GROUP_B_READY: readonly ModeId[] = ["conveyor", "maze", "territory", "landClaim", "bullseye", "box"];
/**
 * --- templates --- (AI studio step 4b) The two step 3 hid for what they draw of their own, ready since a setting switches it off
 * (`journeyHud`, `sgHud`: HUD flags the Simple look turns off): the Journey (its door marked HOME) and Spiral Glass (GLASS CLEARED),
 * measured and watched as the groups' were.
 */
const OVERLAY_READY: readonly ModeId[] = ["journey", "spiralGlass"];
/**
 * --- templates --- (AI studio step 5) The trial bindings group C readied with their own settings, measured and watched as the
 * groups' before: line up (Chord Stars' close, Focus Shot's convergence, Spinning Hoops' beads all up, Bouncing Orbs in phase,
 * Colour Sort's sort, the chaos fan's split) and on the beat (Beat Machines' phrase, Collision Playground and the Wave Tank to the
 * clip's end). Beat Runner stays experimental, its first note 1.5 s in (G1), and Beat Drop and the Sound Vortex, which plan but draw
 * a HUD or a title of their own under the hook (watched in the render).
 */
const GROUP_C_READY: readonly ModeId[] = ["starChords", "ellipseFoci", "hoops", "orbGrid", "colourSort", "doublePendulum", "beatMachine", "collide", "waveTank"];
/**
 * --- templates --- (AI studio step 3) The trial bindings readied with their own settings (group A): each planned on 4 plan seeds
 * on every platform it is offered on, 3 or more passing every gate at Simple 80+ and Playbook 75+, in en, pl and es (the tests
 * below plan them with the rest of the ready templates), and watched in a render of each. Paint stays experimental, its run ending
 * at its fill, and so do Spiral Glass, whose own question over the spiral a hook would stack on, and the Journey, whose own banners,
 * mini-map and clock crowd the screen (both watched in the render).
 */
const TRIAL_READY: readonly ModeId[] = ["shatter", "colorMatch", "target", "brickRebuild", "perfectFit", ...GROUP_B_READY, ...OVERLAY_READY, ...GROUP_C_READY];
/** --- templates --- (AI studio step 3) The variants without a recipe of proven bindings: Classic's one ring (ring-at), Grow's fill that ends the run (fills-by). */
const OWN_VARIANTS = ["get-out-classic-ring", "fill-grow-fills"];
/**
 * The variants of ready bindings that are hidden, and why (they fail a gate on every plan): the boss rush's hook is over the 7
 * words of G5 and the square race's 3-2-1-GO opens the gate at 1.8 s (G1, the first impact within 1 s). (--- templates --- AI studio
 * step 5: Ball Drop's, hidden in review round 2 for its run fading out, plays its rain looped on the beat.)
 */
const HIDDEN_VARIANTS = ["fill-grow-fills", "who-wins-race", "who-wins-fight-league-boss"];
/**
 * --- templates --- (review round 2, 21) Ball Drop's recipe in the Simple look, as the studio may still plan it: its run fades out
 * (its template plays the rain looped since AI studio step 5), and the Simple look's placement and line breaks are the look's,
 * whoever planned the clip.
 */
const dropPlan = (seed: number, options: Partial<Parameters<typeof planClip>[3]> = {}) => planClip(recipeById("drop-symphony")!, seed, "reels", { copy, look: "simple", ...options });
/** --- templates --- (review round 2, 21) Ball Drop's recipe as its template played it until AI studio step 5: timed by its last note, no words. */
const lastNoteDrop = () => ({ ...recipeById("drop-symphony")!, strategy: "lastNote" as const, payoffWords: false as const });

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

  it("readies the proven bindings that have a variant to plan, each variant wrapping a recipe of its mode or playing its own way, and the trial bindings that passed their planning; the rest are declared and hidden", () => {
    const proven = BINDINGS.filter((b) => b.tier === "proven").map((b) => b.mode);
    expect([...proven].sort()).toEqual([...PROVEN].sort());
    // (a binding is ready only while one of its variants plans: the square race's one variant is hidden, so its binding is not)
    expect(BINDINGS.filter((b) => b.ready).map((b) => b.mode).sort()).toEqual([...READY_MODES, ...TRIAL_READY].sort());
    for (const b of BINDINGS) {
      const plans = b.variants.some((v) => !v.hidden && (v.recipe !== null || strategyCanPlan(variantBinding(b, v))));
      expect([b.mode, b.ready], b.mode).toEqual([b.mode, b.tier === "proven" ? plans : b.tier === "trial" && plans]);
    }
    // the proven ones are exactly the modes the playbook's recipes play
    expect([...new Set(RECIPES.flatMap((r) => r.modes))].sort()).toEqual([...PROVEN].sort());
    for (const b of BINDINGS) {
      for (const v of b.variants) {
        if (b.tier === "proven" && v.recipe !== null) {
          const recipe = recipeById(v.recipe);
          expect(recipe, v.id).toBeDefined();
          expect(recipe!.modes, v.id).toContain(b.mode);
          // the crew's claim of the recipe is the format's
          expect(CLAIM_OF_RECIPE[recipe!.id], v.id).toBe(TEMPLATE_FORMATS[b.format].claim);
        } else if (b.tier === "proven") {
          // --- templates --- (AI studio step 3) a variant without a recipe plays its own way: its strategy and outcome over its binding
          expect([v.id, OWN_VARIANTS.includes(v.id), v.own !== undefined, strategyCanPlan(variantBinding(b, v))]).toEqual([v.id, true, true, true]);
          expect(templateRecipeById(v.id) !== undefined, v.id).toBe(!v.hidden);
        } else {
          expect(v.recipe, v.id).toBeNull();
          expect(templateRecipeById(v.id) !== undefined, v.id).toBe(b.ready);
        }
      }
    }
    expect(allTemplates().filter((t) => t.binding.tier === "proven" && !t.ready).map((t) => t.id)).toEqual(HIDDEN_VARIANTS);
    expect(allTemplates().filter((t) => t.ready).length).toBe(ready.length);
    expect(BINDINGS.filter((b) => b.tier !== "proven")).toHaveLength(32);
    expect(BINDINGS.filter((b) => b.tier === "trial").map((b) => b.mode).sort()).toEqual([...TRIAL_READY].sort());
    // (--- templates --- AI studio step 5: the square race the one proven binding not ready, Ball Drop's ready on the beat)
    expect(BINDINGS.filter((b) => !b.ready)).toHaveLength(33 - TRIAL_READY.length);
  });

  it("hides a variant whose plans fail a gate on every seed, with its reason: the square race's count-in fails G1 on every plan", () => {
    const race = templateById("who-wins-race")!;
    expect([race.binding.tier, race.binding.ready, race.ready]).toEqual(["proven", false, false]);
    expect(race.binding.variants.find((v) => v.id === race.id)!.hidden).toMatch(/3-2-1-GO.*G1/);
    expect(templateRecipeById(race.id)).toBeUndefined();
    expect(readyTemplates("all").map((t) => t.id)).not.toContain(race.id);
    expect(() => planTemplate(race.id, 1, "reels", { copy, search: false })).toThrow(/ready template/);
    // the reason still holds: the race's own plans in the Simple look fail G1 (when they no longer do, it may be shown again)
    for (const seed of [1, 2, 3, 4]) {
      const plan = planClip(recipeById("square-race")!, seed, "reels", { copy, episode: 3, index: seed, look: "simple" });
      const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec);
      expect(clarityOf(crewClipOfPlan(plan, { run })).gates.filter((g) => !g.ok).map((g) => g.id), `square-race/${seed}`).toContain("G1");
    }
  });

  // --- templates --- (review round 2, 21) the studio's plans of Ball Drop ended on a faint tick, then 1.7-3.6 s of silence; (AI studio
  // step 5) its template plays the rain looped, so the beat format's payoff, the clip's end, lands on a full board
  it("plays Ball Drop's template on the beat, its rain looped to the clip's end, where its recipe's run fades out to a lone faint tick, then silence", { timeout: 120_000 }, () => {
    const drop = templateById("on-the-beat-drop")!;
    expect([drop.binding.tier, drop.binding.ready, drop.ready, drop.binding.strategy, drop.binding.tune]).toEqual(["proven", true, true, "atEnd", { dropLoop: true }]);
    expect(drop.binding.variants.find((v) => v.id === drop.id)!.hidden).toBeUndefined();
    const r = templateRecipeById(drop.id)!;
    expect([r.wraps, r.strategy, r.endings, r.buckets, r.payoffWords]).toEqual(["drop-symphony", "atEnd", ["resolved"], ["short", "standard"], false]);
    // the recipe's draw, the rain looped over it and the clip's length from the payoff target (the bot's own Drop Symphony keeps its own)
    const ctx: RecipeContext = { rng: seededRandom(3), bucket: "short", ending: "resolved", payoffTarget: 12.75, roster: SERIES_ROSTER, planSeed: 3 };
    const own = recipeById("drop-symphony")!.settings({ ...ctx, rng: seededRandom(3) });
    expect(r.settings(ctx)).toEqual({ ...own, dropLoop: true, recordingDuration: atEndRecordingSec(12.75), mode: "drop" });
    expect(own.dropLoop).toBe(false);
    for (const seed of [1, 2]) {
      const plan = planTemplate(drop.id, seed, "reels", { copy, episode: 3, index: seed });
      const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec);
      const clarity = clarityOf(crewClipOfPlan(plan, { run }));
      // heard at its payoff, the clip's last 1.5 s: many notes, no quiet end
      expect([seed, plan.ending, plan.settings.dropLoop, plan.payoff.atSec, clarity.pass]).toEqual([seed, "resolved", true, plan.timing.recordingDuration - AT_END_SEC, true]);
      expect([seed, run.moment!.sounds >= 3, (run.moment!.quietTailSec ?? 0) < 0.5]).toEqual([seed, true, true]);
    }
    // the beat format has ready templates now, its first Ball Drop's
    expect(readyTemplates("all").filter((t) => t.format.id === "onTheBeat").map((t) => t.id)).toContain(drop.id);
    // the reason it was hidden still holds for its recipe's run: timed by its last note, every plan fails G2 – a lone note fewer than
    // the run's usual moment over a board at rest, and the clip ends on silence
    for (const seed of [1, 2, 3, 4]) {
      const plan = planClip(lastNoteDrop(), seed, "reels", { copy, episode: 3, index: seed, look: "simple", ending: "resolved" });
      const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec);
      const g2 = clarityOf(crewClipOfPlan(plan, { run })).gates.find((g) => g.id === "G2")!;
      expect([seed, g2.ok, g2.problems.includes("payoffLandsStill")]).toEqual([seed, false, true]);
    }
  });

  it("narrows a variant to the buckets its seed search finds the payoff in: Gerald's Portal escape plans the standard length, on Shorts too", () => {
    const gerald = templateById("get-out-portal-gerald")!;
    expect(gerald.buckets).toEqual(["standard"]);
    expect(templateRecipeById(gerald.id)!.buckets).toEqual(["standard"]);
    // the binding's other variant keeps the binding's buckets
    expect(templateRecipeById("get-out-portal")!.buckets).toEqual(["short", "standard"]);
    expect(platformsOf(gerald.id)).toEqual([...BOT_PLATFORMS]);
    for (const platform of BOT_PLATFORMS) {
      for (const bucket of ["auto", "short", "standard"] as const) expect(planTemplate(gerald.id, 1, platform, { copy, search: false, bucket }).bucket, `${platform}/${bucket}`).toBe("standard");
    }
  });

  it("never binds a looping mode to 'finish', and keeps only a HUD that shows the countdown", () => {
    for (const mode of ["brickRebuild", "colourSort", "collide", "waveTank", "lines", "drawingMachine", "illusion"] as const) expect(MODE_TEMPLATES[mode].strategy, mode).not.toBe("finish");
    // --- templates --- (AI studio step 4) the conveyor and Merge Ring do not loop (the plan said so; the code does not): their runs
    // end, ALL OUT! 1.5 s after the last ball is out, FINAL FORM 2 s after the final form (or OVERFLOW), so "finish" fires there
    for (const mode of ["conveyor", "mergeRing"] as const) {
      expect([mode, MODE_TEMPLATES[mode].strategy]).toEqual([mode, "finish"]);
      expect([mode, simulateFacts(finderRequestOfSettings(defaultSettings(mode), undefined, 90), 1, { strategy: "finish" }, 90).finishSec > 0]).toEqual([mode, true]);
    }
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
    expect(readyTemplates("battle").map((t) => t.mode)).toEqual(expect.arrayContaining(["ctf", "battle", "stringBattle", "fightLeague"]));
    // (the square race's one template is hidden, so its binding is not ready: its count-in fails G1 on every plan)
    expect(readyTemplates("battle").map((t) => t.mode)).not.toContain("race");
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
    expect(() => planTemplate("fill-paint", 1, "reels", { copy, search: false })).toThrow(); // (--- templates --- AI studio step 3: Target is offered now)
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
      // (--- templates --- AI studio step 3: a template without a recipe wraps none and speaks with its format's words)
      expect(recipe.wraps).toBe(t.recipe ? t.recipe.id : undefined);
      expect(recipe.modes).toEqual([t.mode]);
      expect(recipe.copyKey).toBe(t.recipe ? t.recipe.copyKey : t.format.copyKey);
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
  /**
   * --- templates --- (AI studio step 4b) Every settings object carries the two overlay switches since that step (`journeyHud`,
   * `sgHud`: true, the overlay shown), so a plan's JSON is the one recorded with those two keys added and nothing else: the digest
   * is of the plan without them – the recorded numbers unchanged –, and every plan below is checked to carry both as true.
   */
  const OVERLAY_DEFAULTS: Readonly<Record<string, boolean>> = { journeyHud: true, sgHud: true };
  const withoutOverlayDefaults = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, v) => (Object.hasOwn(OVERLAY_DEFAULTS, key) && v === OVERLAY_DEFAULTS[key] ? undefined : v)));
  const overlaysShown = (plans: readonly ClipPlan[]) => plans.map((p) => [p.recipe, p.settings.journeyHud, p.settings.sgHud]);
  const digest = (value: unknown) => hashString(JSON.stringify(withoutOverlayDefaults(value)));

  it("plans every recipe byte for byte as before the templates (no search, a search, a day)", { timeout: 120_000 }, () => {
    expect(BOT_DIGESTS.map(([id]) => id)).toEqual(RECIPES.map((r) => r.id));
    const planned: ClipPlan[] = [];
    for (const [id, a, b] of BOT_DIGESTS) {
      const r = recipeById(id)!;
      const first = planClip(r, 7, "reels", { copy: COPY.en, search: false, siteUrl: SITE, episode: 4, index: 2 });
      const second = planClip(r, 11, "tiktok", { copy: COPY.pl, locale: "pl", search: false, siteUrl: SITE, episode: 9, index: 1, ending: "cliffhanger" });
      planned.push(first, second);
      expect(digest(first), id).toBe(a);
      expect(digest(second), id).toBe(b);
    }
    for (const [id, d] of BOT_SEARCH_DIGESTS) {
      const searched = planClip(recipeById(id)!, 3, "shorts", { copy, siteUrl: SITE, maxSeeds: 6, episode: 2 });
      planned.push(searched);
      expect(digest(searched), id).toBe(d);
    }
    const day = planDay("2026-10-20", "reels", 3, { copy, siteUrl: SITE, search: false, family: "all" });
    planned.push(...day.clips);
    expect(digest(day)).toBe(BOT_DAY_DIGEST);
    // (--- templates --- AI studio step 4b: the two keys the digest leaves out, as every default has them: the overlays shown)
    expect(overlaysShown(planned)).toEqual(planned.map((p) => [p.recipe, true, true]));
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
            expect(readable.problems, where).toEqual([]);
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

  // with the seed search on (DEFAULT_MAX_SEEDS), on every platform a template is offered on: the search ranks and stops on the
  // bot look's score, so the Simple look's 4 series points never send it on to other seeds and other numbers
  for (const platform of BOT_PLATFORMS) {
    it(`leaves the run alone with the seed search on, on ${platform}: the bot look's seed, numbers, payoff and run, 4 series points apart (and a time counter's 10)`, { timeout: 180_000 }, async () => {
      const offered = ready.filter((t) => platformsOf(t.id).includes(platform));
      expect(offered.length).toBeGreaterThan(0);
      for (const t of offered) {
        for (const seed of [1, 2]) {
          const options = { copy, episode: 3, index: seed };
          const simple = planTemplate(t.id, seed, platform, options);
          const bot = planTemplate(t.id, seed, platform, { ...options, look: "bot" });
          const where = `${t.id}/${platform}/${seed}`;
          expect([simple.seed, simple.timing.seedsTested, simple.payoff.atSec, simple.timing.found], where).toEqual([bot.seed, bot.timing.seedsTested, bot.payoff.atSec, bot.timing.found]);
          const changed = Object.keys(simple.settings).filter((k) => JSON.stringify((simple.settings as unknown as Record<string, unknown>)[k]) !== JSON.stringify((bot.settings as unknown as Record<string, unknown>)[k]));
          expect(changed.filter((k) => !LOOK_KEYS.has(k)), where).toEqual([]);
          expect(runFactsSync(simple.settings, simple.seed, simple.world, simple.recipe), where).toEqual(runFactsSync(bot.settings, bot.seed, bot.world, bot.recipe));
          // the checklist: the series label's 4 points apart, every other item the same – but the countdown's 10 where the Simple
          // look draws no counter: the bot look's bar or timer counts the clip's seconds, which one text at a time would cut short
          // at the payoff (--- templates --- review round 2, 22)
          const moved = bot.reasons.filter((r) => simple.reasons.find((x) => x.id === r.id)?.points !== r.points).map((r) => r.id);
          // (--- templates --- AI studio step 3: a template without a recipe lets the picture count in both looks: no counter to lose)
          const counted = simple.countdown.source === "picture" && t.recipe !== null;
          if (counted) expect([where, bot.settings.captions[bot.captionRoles.indexOf("countdown")]?.type]).toEqual([where, expect.stringMatching(/^(progress|countdown)$/)]);
          expect([moved, bot.score - simple.score], where).toEqual(counted ? [["countdown", "series"], 14] : [["series"], 4]);
        }
        await breathe();
      }
    });
  }

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

  // every platform a template is offered on, not only the first (Portal's Gerald had passed on Reels and missed on Shorts), and
  // --- templates --- (review round 2, 13) in every language, not only English: Polish Pendulum Wave had failed G5 on every Shorts plan
  for (const locale of ["en", "pl", "es"] as const)
  for (const platform of BOT_PLATFORMS) {
    it(`every ready template offered on ${platform} passes every clarity gate on 3 of 4 plan seeds at Playbook 75+, each plan at Simple 80+ (${locale})`, { timeout: 240_000 }, async () => {
      const offered = ready.filter((t) => platformsOf(t.id).includes(platform));
      expect(offered.length).toBeGreaterThan(0);
      for (const t of offered) {
        let passed = 0;
        for (const seed of [1, 2, 3, 4]) {
          const plan = planTemplate(t.id, seed, platform, { copy: COPY[locale], locale, episode: 3, index: seed });
          const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec);
          const clarity = clarityOf(crewClipOfPlan(plan, { run }));
          const where = `${locale}/${t.id}/${platform}/${seed}`;
          expect(clarity.simple.score, where).toBeGreaterThanOrEqual(80);
          // (a plan whose seed search found no payoff fails a gate and loses its payoff points: it is the 1 in 4)
          if (clarity.gates.every((g) => g.ok)) {
            passed++;
            expect(plan.score, where).toBeGreaterThanOrEqual(75);
          }
        }
        expect(passed, `${t.id}/${platform}`).toBeGreaterThanOrEqual(3);
        await breathe();
      }
    });
  }

  // --- templates --- (review round 2, 13) "Znów w jednej linii. 🎼" is one clause of 4 words: no clause cut shortens it, and on
  // Shorts its 🎼 took a second line in the 2 s the clip leaves after the payoff – 1 s a line, under G5's 1.2 s, on every plan
  it("gives the Simple payoff the time its lines need: one line where the clip's end is too near for two, its closing emoji left out", () => {
    expect(SIMPLE_TEXT.secPerLine).toBe(CLARITY.secPerLine);
    /** The payoff's captions in reading order (a text at the bottom of the square reads upwards). */
    const payoffOf = (plan: ClipPlan) => inReadingOrder(plan.settings.captions, plan.captionRoles.flatMap((r, i) => (r === "payoff" ? [i] : []))).map((i) => plan.settings.captions[i]);
    // (in the planner's world and in the page's, where the studio renders)
    for (const [world, seed] of [null, { width: 800, height: 450 }].flatMap((w) => [1, 2, 3, 4].map((n) => [w, n] as const))) {
      const plan = planTemplate("line-up-pendulum", seed, "shorts", { copy: COPY.pl, locale: "pl", episode: 3, index: seed, ...(world ? { world } : {}) });
      const where = `pl/shorts/${world ? "800x450/" : ""}${seed}`;
      const lines = payoffOf(plan);
      expect([where, lines.map((c) => c.text), plan.payoff.text]).toEqual([where, ["Znów w jednej linii."], "Znów w jednej linii."]);
      // (two lines would have had 1 s each)
      expect(plan.timing.clipSec - lines[0].start, where).toBeLessThan(2 * SIMPLE_TEXT.secPerLine);
      expect(clarityOf(crewClipOfPlan(plan)).gates.find((g) => g.id === "G5")!.ok, where).toBe(true);
    }
    // a payoff that fits one line keeps its emoji ("Back in line. 🎼"), and one with time for two lines keeps both
    const en = planTemplate("line-up-pendulum", 1, "shorts", { copy, episode: 3, index: 1 });
    expect(payoffOf(en).map((c) => c.text)).toEqual(["Back in line. 🎼"]);
    const reels = planTemplate("line-up-pendulum", 1, "reels", { copy: COPY.pl, locale: "pl", episode: 3, index: 1 });
    const two = payoffOf(reels);
    expect([two.map((c) => c.text), reels.payoff.text]).toEqual([["Znów w jednej linii.", "🎼"], "Znów w jednej linii. 🎼"]);
    expect((reels.timing.clipSec - two[0].start) / two.length).toBeGreaterThanOrEqual(SIMPLE_TEXT.secPerLine);
    // the bot's look draws the recipe's own words, as before
    const bot = planTemplate("line-up-pendulum", 1, "shorts", { copy: COPY.pl, locale: "pl", episode: 3, index: 1, look: "bot" });
    expect(bot.payoff.text).toBe("Znów w jednej linii. 🎼");
  });

  // --- templates --- (review round 2, 22) a bar and a timer count the recording's seconds: one text at a time took them off at the
  // payoff, the pendulum's bar at 84 % and Ball Drop's timer at 0:04 – and the templates tool said those formats draw none
  it("draws a counter caption only where the format takes one and it counts what happens: never a bar or a timer cut short at the payoff", () => {
    expect([TEMPLATE_FORMATS.lineUp.countdown, TEMPLATE_FORMATS.fill.countdown, TEMPLATE_FORMATS.count.countdown]).toEqual([["picture", "hud"], ["picture"], ["hud", "picture"]]);
    for (const t of ready) expect([t.id, templateRecipeById(t.id)!.countdownFrom]).toEqual([t.id, t.format.countdown]);
    for (const locale of ["en", "pl", "es"] as const) {
      for (const t of ready) {
        for (const seed of [1, 2]) {
          const plan = planTemplate(t.id, seed, "reels", { copy: COPY[locale], locale, search: false });
          const where = `${locale}/${t.id}/${seed}`;
          const counters = plan.settings.captions.filter((_, i) => plan.captionRoles[i] === "countdown");
          // a caption counts the walls, in a format that takes a caption; else the HUD or the picture counts
          expect([where, counters.map((c) => c.type)]).toEqual([where, plan.countdown.source === "caption" ? ["wallCounter"] : []]);
          if (plan.countdown.source === "caption") expect(t.format.countdown, where).toContain("caption");
          expect([where, counterCutReading(crewClipOfPlan(plan))]).toEqual([where, null]);
        }
      }
    }
    // the ones the review found: the pendulum's bar, Grow's and Clone's time, gone; the picture counts
    for (const id of ["line-up-pendulum", "line-up-polyrhythm", "fill-grow", "count-multiply"]) {
      const plan = planTemplate(id, 1, "reels", { copy, search: false });
      expect([id, plan.countdown.source, plan.captionRoles.includes("countdown")]).toEqual([id, "picture", false]);
      expect([id, reason(plan, "countdown").key]).toEqual([id, "countdownMissing"]);
    }
    // the bot look keeps its own counter, on from the start to the clip's end: it reaches 100 %
    const bot = planTemplate("line-up-pendulum", 1, "reels", { copy, search: false, look: "bot" });
    const bar = bot.settings.captions[bot.captionRoles.indexOf("countdown")];
    expect([bar.type, bar.start, bar.end, counterCutReading(crewClipOfPlan(bot))]).toEqual(["progress", 0, 0, null]);
  });

  it("templates' ids and claims reach the crew from a plan that records them", () => {
    const plan = planTemplate("smash-power-layers", 4, "reels", { copy, search: false });
    expect(templateById(plan.template)?.format.claim).toBe("break");
    expect(crewClipOfPlan(plan).claim).toBe("break");
  });
});

// --- templates --- what the studio's real run showed (review round 1, 21, 22 and 24): a chord promised at the quietest moment
// of a pendulum wave, a "Final chord" over a silent, settled board, and a Power Layers hook cut down to its rule without its goal
describe("a template keeps its format's promise where its recipe's own would break it", () => {
  /** A recipe's draw for a seeded context (the planner's own RecipeContext). */
  const ctxOf = (seed: number): RecipeContext => ({ rng: seededRandom(seed), bucket: "standard", ending: "resolved", payoffTarget: 16, roster: SERIES_ROSTER, planSeed: seed });

  it("times every ready template by its binding's strategy (its recipe's, but where it has one of its own)", () => {
    for (const t of ready) {
      const r = templateRecipeById(t.id)!;
      // (--- templates --- AI studio step 3: a variant without a recipe plays its own strategy over its binding's – Classic's one ring)
      const b = variantBinding(t.binding, t.binding.variants.find((v) => v.id === t.id));
      expect([t.id, (PAYOFF_STRATEGIES as readonly string[]).includes(b.strategy), r.strategy]).toEqual([t.id, true, b.strategy]);
      if (t.mode !== "drop" && t.recipe) expect([t.id, r.strategy]).toEqual([t.id, t.recipe.strategy]);
    }
    // (--- templates --- AI studio step 5: Ball Drop's template plays to the clip's end, its rain looped; its recipe ends on its settle)
    expect([MODE_TEMPLATES.drop.strategy, recipeById("drop-symphony")!.strategy]).toEqual(["atEnd", "finish"]);
  });

  it("plays Pendulum Wave's chord at the realignment: every bob sounds at its turning points, the pendulums in a row", () => {
    expect(MODE_TEMPLATES.pendulum.tune).toEqual({ pwSoundOn: "extremes", pwLayout: "row" });
    const recipe = recipeById("pendulum-wave")!;
    const tpl = templateRecipeById("line-up-pendulum")!;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const own = recipe.settings(ctxOf(seed));
      const played = tpl.settings(ctxOf(seed));
      // the tune is set over the recipe's draw: every other number is the recipe's, and the bot's recipe keeps its own sound
      expect({ ...played, pwSoundOn: own.pwSoundOn, pwLayout: own.pwLayout }).toEqual(own);
      expect([own.pwSoundOn, played.pwSoundOn, played.pwLayout]).toEqual(["center", "extremes", "row"]);
    }
    for (const look of ["simple", "bot"] as const) {
      const plan = planTemplate("line-up-pendulum", 2, "reels", { copy, look });
      const moment = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec).moment!;
      // every bob at once at the realignment, the mode's accented chord (lib/physics/modes/pendulum.ts ACCENT_CHORD_FRACTION)
      expect([look, moment.accent, moment.chordMax]).toEqual([look, true, Math.min(16, plan.settings.pwCount)]);
    }
  });

  // --- templates --- (review round 2, 20) the chord the realignment plays, it plays at the release and half a cycle on too: the
  // template's hook asks the question the line answers and promises no chord
  it("asks whether the pendulums line up, never promises the chord its run plays at half a cycle too, in every language and look", () => {
    expect(MODE_TEMPLATES.pendulum.hookAsk).toBe("cliffQuestion");
    expect(templateRecipeById("line-up-pendulum")!.hookAsk).toBe("cliffQuestion");
    expect(askHookText("22 pendulums. Wait for the chord.", "Do they line up? 👇")).toBe("22 pendulums. Do they line up?");
    expect(askHookText("Wahadła: 22. Czekaj na akord.", "Ustawią się w linii? 👇")).toBe("Wahadła: 22. Ustawią się w linii?");
    expect(askHookText("22 pendulums. Wait for the chord.", "")).toBe("22 pendulums. Wait for the chord.");
    for (const locale of ["en", "pl", "es"] as const) {
      for (const look of ["simple", "bot"] as const) {
        const plan = planTemplate("line-up-pendulum", 1, "reels", { copy: COPY[locale], locale, look, search: false });
        const where = `${locale}/${look}`;
        const own = (COPY[locale].recipes as Record<string, Record<string, string>>).pendulumWave;
        expect([where, CHORD_WORDS.test(own.hook), CHORD_WORDS.test(plan.hook), plan.hook]).toEqual([where, true, false, askHookText(own.hook.replace("{count}", String(plan.settings.pwCount)), own.cliffQuestion)]);
        expect(plan.post.caption.startsWith(plan.hook), where).toBe(true);
      }
    }
    // the bot's own Pendulum Wave keeps its hook (its plans are byte-identical: see above)
    expect(planClip(recipeById("pendulum-wave")!, 1, "reels", { copy, search: false }).hook).toMatch(/Wait for the chord\.$/);
  });

  it("times Ball Drop's payoff at the last ball's last note, not the silent settle after it, and draws no words over it (the strategy its template had until AI studio step 5)", () => {
    for (const seed of [1, 2, 3]) {
      const plan = planClip(lastNoteDrop(), seed, "reels", { copy, look: "simple", ending: "resolved" });
      const horizon = plan.settings.recordingDuration + 5;
      const facts = simulateFacts(finderRequestOfSettings(plan.settings, plan.world, horizon), plan.seed, { strategy: "lastNote" }, horizon);
      const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec);
      const where = `drop-lastNote/${seed}`;
      expect([where, plan.timing.found, facts.lastSoundSec !== undefined && facts.lastSoundSec > 0, facts.finishSec > plan.payoff.atSec!]).toEqual([where, true, true, true]);
      expect(plan.payoff.atSec, where).toBeCloseTo(facts.lastSoundSec!, 6);
      expect([where, plan.payoff.text, plan.captionRoles.includes("payoff")]).toEqual([where, "", false]);
      expect([where, run.moment!.sounds > 0]).toEqual([where, true]);
    }
    // the bot's own Drop Symphony still ends on its settle and says its words (its plans are byte-identical: see above)
    const bot = planClip(recipeById("drop-symphony")!, 1, "reels", { copy });
    expect([bot.payoff.text.length > 0, bot.captionRoles.includes("payoff")]).toEqual([true, true]);
  });

  // --- templates --- (review round 2, 23) the rule, not the goal: Power Layers' own HUD counts the layers down from the first
  // frame ("layers left: 250"), while +1, Fibonacci and doubling all open on hits of a layer or two – and a cliffhanger's "One more
  // hit?" hangs on the rule
  it("keeps Power Layers' rule in the Simple hook where its HUD counts the layers, in every language; the goal stays in the post", () => {
    expect(TEMPLATE_FORMATS.smash.stakeHook && TEMPLATE_FORMATS.count.stakeHook).toBe(true);
    expect(TEMPLATE_FORMAT_IDS.filter((f) => TEMPLATE_FORMATS[f].stakeHook)).toEqual(["smash", "count"]);
    // simpleHookText keeps a stake it is given (the planner gives it only where nothing else on screen shows it)
    expect(simpleHookText("Every hit doubles the power. 700 layers to go.", [700])).toBe("700 layers to go.");
    expect(simpleHookText("Every hit adds +1 power. 700 layers to go.", [700])).toBe("700 layers to go.");
    expect(simpleHookText("Cada golpe duplica el poder. Quedan 700 capas.", [700])).toBe("Quedan 700 capas.");
    expect(simpleHookText("Every hit doubles the power. 700 layers to go.")).toBe("Every hit doubles the power.");
    // a question still comes first, and without the clip's number the rule clause stays
    expect(simpleHookText("Every hit doubles the power. Can it break 700?", [700])).toBe("Can it break 700?");
    expect(simpleHookText("Every hit doubles the power. 400 layers to go.", [700])).toBe("Every hit doubles the power.");
    expect(stakeNumbersOf({ layers: 700, sequence: "double", one: 1, text: "12" })).toEqual([700, 12]);
    for (const locale of ["en", "pl", "es"] as const) {
      for (const seed of [1, 2, 3, 4]) {
        const plan = planTemplate("smash-power-layers", seed, "reels", { copy: COPY[locale], locale, search: false, index: seed });
        const where = `${locale}/${seed}`;
        const rule = (COPY[locale].plRules as Record<string, string>)[plan.settings.plSequence];
        // the rule the run plays by, on screen in the hook; the layers on screen in the mode's own counter
        expect([where, plan.hook.includes(rule), plan.countdown.source, plan.settings.plBadge, plan.settings.plPills]).toEqual([where, true, "hud", "none", false]);
        expect(wordCount(plan.hook), where).toBeLessThanOrEqual(SIMPLE_TEXT.hookWordsMax);
        // the whole hook, the goal with it, is in the post
        expect(plan.post.caption, where).toContain(String(plan.settings.plLayers));
        // a cliffhanger's post asks the question the clip ends on ("One more hit?"), not another one
        if (plan.ending === "cliffhanger") {
          const asked = captionWordsOf(plan.settings.captions, plan.captionRoles.flatMap((r, i) => (r === "question" ? [i] : [])));
          expect([where, plan.post.question, plan.post.caption.includes(asked)]).toEqual([where, asked, true]);
        }
      }
    }
    // (the four seeds play more than one rule, and end both ways)
    const plans = [1, 2, 3, 4].map((seed) => planTemplate("smash-power-layers", seed, "reels", { copy, search: false, index: seed }));
    expect(new Set(plans.map((p) => p.settings.plSequence)).size).toBeGreaterThan(1);
    expect(new Set(plans.map((p) => p.ending))).toEqual(new Set(["resolved", "cliffhanger"]));
    // the bot's look draws the recipe's whole hook and its own post question, as before
    const bot = planTemplate("smash-power-layers", 2, "reels", { copy, search: false, look: "bot", index: 2 });
    expect(bot.hook.split(". ").length).toBe(2);
    expect(bot.post.question).toBe((COPY.en.recipes as Record<string, Record<string, string>>).powerLayers[bot.ending === "cliffhanger" ? "cliffPostQuestion" : "postQuestion"].replace("{layers}", String(bot.settings.plLayers)));
  });
});

// --- templates --- what the studio's real run showed (review round 1, 25 and 26): hooks broken mid-phrase ("15 pendulums. Wait
// for" / "the chord."), and texts over the action – Ball Drop's balls entering under the hook, Pendulum Wave's short pendulums
// swinging under it – while the bottom of the square stayed empty
describe("a Simple text reads as one phrase a line, where the run leaves the square clear", () => {
  it("breaks a text of two lines at a clause, else evenly, never leaving a one- or two-word orphan", () => {
    // the three hooks of the run, greedy before
    expect(splitCaptionLines("15 pendulums. Wait for the chord.", 1.2)).toEqual(["15 pendulums. Wait for", "the chord."]);
    expect(evenCaptionLines("15 pendulums. Wait for the chord.", 1.2)).toEqual(["15 pendulums.", "Wait for the chord."]);
    expect(evenCaptionLines("10 balls. Every peg is a note.", 1.2)).toEqual(["10 balls.", "Every peg is a note."]);
    expect(evenCaptionLines("Every hit doubles the power.", 1.2)).toEqual(["Every hit", "doubles the power."]);
    // the other plans' hooks the run split the same way
    expect(evenCaptionLines("Gerald vs 4 floors of glass.", 1.2)).toEqual(["Gerald vs 4", "floors of glass."]);
    expect(evenCaptionLines("10 rhythms. When do they all meet?", 1.2)).toEqual(["10 rhythms.", "When do they all meet?"]);
    expect(evenCaptionLines("x2 x4 x8… until it breaks.", 1.2)).toEqual(["x2 x4 x8…", "until it breaks."]);
    expect(evenCaptionLines("¿Quién gana? Elige un color.", 1.2)).toEqual(["¿Quién gana?", "Elige un color."]);
    // one line stays one line; an emoji takes a line of its own only after a whole sentence, never splitting a name from its verb
    expect(evenCaptionLines("260 layers to go.", 1.2)).toEqual(["260 layers to go."]);
    expect(evenCaptionLines("Back in line. 🎼", 1.2)).toEqual(["Back in line. 🎼"]);
    expect(evenCaptionLines("Harley Quinn wins! 🏆", 1.3)).toEqual(["Harley Quinn wins!", "🏆"]);
    expect(evenCaptionLines("Harley Quinn wins 🏆 🏆 🏆", 1.3).every((line) => /\p{L}/u.test(line))).toBe(true);
    for (const text of ["15 pendulums. Wait for the chord.", "Every hit doubles the power.", "Which colour takes the board?", "8 squares, one survivor. Pick yours now."]) {
      const lines = evenCaptionLines(text, 1.2);
      expect(lines.join(" "), text).toBe(text);
      expect(lines.length, text).toBe(splitCaptionLines(text, 1.2).length);
      if (lines.length === 2 && wordCount(text) >= 5) expect(wordCount(lines[1]), text).toBeGreaterThan(2);
    }
  });

  it("draws the Simple look's hooks so, in every language, and leaves the bot look's as they were", () => {
    for (const locale of ["en", "pl", "es"] as const) {
      // (--- templates --- review round 2, 21: Ball Drop's template is hidden; its recipe in the Simple look breaks its hook so)
      for (const id of ["drop-symphony", "line-up-pendulum"]) {
        const plan = id === "drop-symphony" ? dropPlan(1, { copy: COPY[locale], locale, search: false }) : planTemplate(id, 1, "reels", { copy: COPY[locale], locale, search: false });
        const hook = plan.settings.captions.filter((_, i) => plan.captionRoles[i] === "hook");
        const lines = hook.map((c) => c.text);
        expect([locale, id, lines]).toEqual([locale, id, evenCaptionLines(plan.hook, hook[0].style.size)]);
        // (the hook's first clause takes the first line – its number –, then what to watch: "16 pelotas." / "Cada clavo es una
        // nota." a step smaller rather than "16 pelotas. Cada" / "clavo es una nota.")
        expect([locale, id, lines.length, /[.!?:…]$/u.test(lines[0]), /\d/u.test(lines[0])]).toEqual([locale, id, 2, true, true]);
        expect([locale, id, hook[0].style.size >= 1.0]).toEqual([locale, id, true]);
      }
    }
    const bot = planTemplate("line-up-pendulum", 1, "reels", { copy, search: false, look: "bot" });
    const botLines = bot.settings.captions.filter((_, i) => bot.captionRoles[i] === "hook").map((c) => c.text);
    expect(botLines).toEqual(splitCaptionLines(bot.hook, bot.settings.captions[0].style.size));
  });

  it("puts each text of a searched plan at the edge of the square its run leaves clear: Ball Drop's and Pendulum Wave's hooks at the bottom", { timeout: 120_000 }, async () => {
    // (--- templates --- review round 2, 21: Ball Drop's template is hidden; its recipe in the Simple look is placed the same way)
    for (const id of ["drop-symphony", "line-up-pendulum"]) {
      for (const seed of [1, 2]) {
        const plan = id === "drop-symphony" ? dropPlan(seed, { episode: 3, index: seed }) : planTemplate(id, seed, "reels", { copy, episode: 3, index: seed });
        const where = `${id}/${seed}`;
        const hook = plan.captionRoles.map((r, i) => (r === "hook" ? i : -1)).filter((i) => i >= 0);
        expect([where, hook.map((i) => plan.settings.captions[i].position)]).toEqual([where, hook.map(() => "bottom")]);
        // read as before: the canvas stacks the bottom upwards, so the first line is listed last
        expect([where, captionWordsOf(plan.settings.captions, hook), inReadingOrder(plan.settings.captions, hook)]).toEqual([where, plan.hook, [...hook].reverse()]);
        // the run's track: at the top the hook would hide the balls for a second or more longer
        const track = actionTrackSync(plan.settings, plan.seed, plan.world, plan.timing.clipSec);
        const top = actionCoverSec(captionsAtEdge(plan.settings.captions, hook, "top"), hook, track, plan.timing.clipSec);
        const bottom = actionCoverSec(plan.settings.captions, hook, track, plan.timing.clipSec);
        expect([where, top - bottom >= ACTION_GAIN_SEC, bottom]).toEqual([where, true, 0]);
        // the crew reads it so: every caption in the safe zone, the drawn hook the plan's, nothing over the action left to move
        const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec);
        const clip = crewClipOfPlan(plan, { run });
        const clarity = clarityOf(clip);
        // (the recipe's own Ball Drop, resolved, ends on its silent settle, which G2 refuses – why its template is hidden – and
        // nothing else; its cliffhanger is cut before it)
        const refused = id === "drop-symphony" && plan.ending === "resolved" ? ["G2"] : [];
        expect([where, clarity.gates.filter((g) => !g.ok).map((g) => g.id), textOverActionSec(clip), drawnHookText(clip)]).toEqual([where, refused, 0, plan.hook]);
        // and the same clip with its texts back at the top owes the Simple score for the action they hide
        const atTop = captionMessagesOf(plan.captionRoles).reduce((caps, m) => captionsAtEdge(caps, m, "top"), plan.settings.captions);
        const back = crewClipOfPlan({ ...plan, settings: { ...plan.settings, captions: atTop } }, { run });
        expect([where, textOverActionSec(back)! >= ACTION_GAIN_SEC]).toEqual([where, true]);
        expect(clarityOf(back).simple.deductions.find((d) => d.id === "textOverAction")?.points, where).toBeGreaterThanOrEqual(2);
        // the link carries the placed captions
        expect(new URL(plan.shareUrl, SITE).searchParams.get("cap"), where).toBeTruthy();
      }
      await breathe();
    }
    // a plan without the search has no run to read: its texts stay at the top, the bot look's place
    const unsearched = dropPlan(1, { search: false });
    expect(unsearched.settings.captions.every((c) => c.position === "top")).toBe(true);
    // the bot look never moves a text
    const bot = planClip(recipeById("drop-symphony")!, 1, "reels", { copy, episode: 3, index: 1 });
    expect(bot.settings.captions.every((c) => c.position === "top")).toBe(true);
  });

  it("never moves a text where the mode draws something of its own along the bottom of the square", () => {
    // (balls moving in the middle of the square's third row, under the hook, the whole clip: cells 49 and 50 of the 20 × 20)
    const track: ActionTrack = { stepSec: 0.5, grid: 20, samples: Array.from({ length: 40 }, () => "1d1e") };
    expect(actionCellsOf("1d1e")).toEqual([49, 50]);
    const plan = dropPlan(1, { search: false });
    // (the hook moves to the bottom where the bottom is free)
    expect(placeSimpleTexts(plan.settings.captions, plan.captionRoles, track, plan.settings, 20).filter((c) => c.position === "bottom").length).toBeGreaterThan(0);
    for (const s of [{ ...plan.settings, mode: "fightLeague" as const }, { ...plan.settings, mode: "multipliers" as const }, { ...plan.settings, loopHud: true }, { ...plan.settings, mode: "classic" as const, ringTimer: true }]) {
      expect(bottomEdgeFree(s), `${s.mode} ${s.loopHud}`).toBe(false);
      expect(placeSimpleTexts(plan.settings.captions, plan.captionRoles, track, s, 20)).toEqual(plan.settings.captions);
    }
  });

  it("keeps the action track small and exact: cells of the square in base 36, read back as written", () => {
    const plan = planTemplate("line-up-pendulum", 1, "reels", { copy, search: false });
    const track = actionTrackSync(plan.settings, plan.seed, plan.world, 5);
    expect(isActionTrack(track)).toBe(true);
    expect([track.stepSec, track.grid, track.samples.length]).toEqual([ACTION_STEP_SEC, ACTION_GRID, 10]);
    for (const sample of track.samples) {
      const cells = actionCellsOf(sample);
      expect(cells.every((c, k) => Number.isInteger(c) && c >= 0 && c < ACTION_GRID * ACTION_GRID && (k === 0 || c > cells[k - 1]))).toBe(true);
    }
    // the pendulums hang from a bar near the top: every bob moves in the upper half of the square, none at its bottom
    const rows = track.samples.flatMap((s) => actionCellsOf(s).map((c) => Math.floor(c / ACTION_GRID)));
    expect(rows.length).toBeGreaterThan(0);
    expect(Math.max(...rows)).toBeLessThan(ACTION_GRID * 0.6);
    // the same seed, the same track; a malformed sample reads as none
    expect(actionTrackSync(plan.settings, plan.seed, plan.world, 5)).toEqual(track);
    expect([actionCellsOf("0"), actionCellsOf("zz!x")]).toEqual([[], []]);
    expect(actionUnder(track, 0, { left: 0, top: 0, right: 1, bottom: 1 })).toBe(actionCellsOf(track.samples[0]).length > 0);
  });
});

// --- templates --- (AI studio step 2, its foundations) the two strategies no playbook recipe uses (lib/bot/outcomeStrategy.ts), a
// binding's own settings with its outcome's context flag on, and the shrink-only experimental table – each strategy proven on one
// binding the planner plans while it is not yet offered
describe("the outcome and atEnd strategies, a binding's own settings and the experimental table", () => {
  /**
   * The experimental table as this release has it: 19 of the 32 bindings without a recipe. Shrink only – a binding leaves the table
   * (and may leave this list) when its planning acceptance passes; one that joins the table fails here.
   */
  // (--- templates --- AI studio step 3: five of group A's trial bindings left it, planned on 3 of 4 seeds on every platform and
  // watched; Paint stays, its run ending at its fill, Spiral Glass, its own question drawn over the spiral, and the Journey, its
  // own banners, mini-map and clock)
  // (--- templates --- AI studio step 4: seven of group B left it, planned on 3 of 4 seeds on every platform and watched; Merge Ring
  // stays, with its own question under the ring)
  // (--- templates --- AI studio step 4b: the Journey and Spiral Glass left it, their own overlays switched off in the Simple look)
  // (--- templates --- AI studio step 5: nine of group C left it, planned on 3 of 4 seeds on every platform and watched; Beat Runner
  // stays, its first note 1.5 s in, and Beat Drop and the Sound Vortex, a HUD and a title of their own under the hook)
  const EXPERIMENTAL_PINNED: readonly ModeId[] = ["paint", "mergeRing", "paddle", "beatDrop", "runner", "vortex", "lines", "drawingMachine", "illusion", "blueprint"];
  /** A seeded context as the planner hands a recipe one. */
  const ctxOf = (seed: number, payoffTarget = 12.75): RecipeContext => ({ rng: seededRandom(seed), bucket: "short", ending: "resolved", payoffTarget, roster: SERIES_ROSTER, planSeed: seed });

  it("keeps the experimental table shrink-only: hidden, never ready, with its reason; an outcome only its own search finds keeps a binding in it", () => {
    const table = Object.keys(EXPERIMENTAL) as ModeId[];
    for (const mode of table) expect(EXPERIMENTAL_PINNED, `${mode} joined the experimental table`).toContain(mode);
    for (const b of BINDINGS) {
      const reason = EXPERIMENTAL[b.mode];
      if (reason === undefined) {
        expect([b.mode, b.tier === "experimental"]).toEqual([b.mode, false]);
        continue;
      }
      expect([b.mode, b.tier, b.ready, reason.length > 20]).toEqual([b.mode, "experimental", false, true]);
      for (const v of b.variants) {
        expect([v.id, templateById(v.id)!.ready, templateRecipeById(v.id)]).toEqual([v.id, false, undefined]);
        expect(() => planTemplate(v.id, 1, "reels", { copy, search: false }), v.id).toThrow(/ready template/);
      }
    }
    expect(BINDINGS.filter((b) => b.tier === "proven").every((b) => EXPERIMENTAL[b.mode] === undefined)).toBe(true);
    expect(readyTemplates("all").every((t) => EXPERIMENTAL[t.mode] === undefined)).toBe(true);
    // the outcomes the finder searches over settings, not seeds: each bound one has a seed's moment, read off a run of its own (---
    // templates --- AI studio step 3: Brick Smash's first smash and Perfect Fit's first box full; step 5: Chord Stars' close, Focus
    // Shot's convergence, Beat Machines' phrase and the vortex's last ring, their settings drawn as the finder would search them)
    const ownSearch = BINDINGS.filter((b) => !strategyCanPlan(b));
    expect(ownSearch.map((b) => b.mode)).toEqual([]);
    for (const mode of ["beatMachine", "ellipseFoci", "starChords", "vortex"] as const) expect([mode, outcomeStrategyPlans(MODE_TEMPLATES[mode].outcome), OWN_RUN_MOMENTS[MODE_TEMPLATES[mode].outcome!] !== undefined]).toEqual([mode, true, true]);
    // every other bound outcome has its seed's moment: the finder's own run's, or a run of its own
    for (const b of BINDINGS.filter((x) => x.strategy === "outcome" && strategyCanPlan(x))) expect([b.mode, OUTCOME_MOMENTS[b.outcome!] !== undefined || OWN_RUN_MOMENTS[b.outcome!] !== undefined]).toEqual([b.mode, true]);
    expect(Object.keys(OWN_RUN_MOMENTS).sort()).toEqual(["bricks-cleared-by", "converge-on-beat", "most-on-floor", "no-tube-conflict", "ring-on-bar", "star-set"]);
    // no playbook recipe times its payoff with a template's own strategy
    for (const r of RECIPES) expect(["lastNote", "outcome", "atEnd"], r.id).not.toContain(r.strategy);
  });

  it("switches on the context flag every bound outcome needs: each outcome is there to find on its binding's own settings, never on the defaults alone", () => {
    const FLAG_MODES: Record<OutcomeFlag, ModeId> = { growFinish: "grow", dpFan: "doublePendulum", bmMarbles: "beatMachine", vortexRings: "vortex", pfPento: "perfectFit", ringEscape: "classic", colourSortSettles: "colourSort" };
    for (const [flag, mode] of Object.entries(FLAG_MODES) as [OutcomeFlag, ModeId][]) {
      const on = outcomeContextOfSettings({ ...defaultSettings(mode), ...OUTCOME_FLAG_SETTINGS[flag] } as SimulatorSettings);
      expect([flag, outcomeFlagHolds(flag, on)]).toEqual([flag, true]);
    }
    // the ones the defaults leave off
    for (const flag of ["growFinish", "dpFan", "vortexRings", "ringEscape"] as const) expect([flag, outcomeFlagHolds(flag, outcomeContextOfSettings(defaultSettings(FLAG_MODES[flag])))]).toEqual([flag, false]);
    expect(outcomeFlagHolds("colourSortSettles", outcomeContextOfSettings({ ...defaultSettings("colourSort"), csRule: "bothWaysNotOwn" }))).toBe(false);
    const bound = BINDINGS.filter((b) => b.outcome);
    expect(bound.length).toBe(15);
    // (--- templates --- AI studio step 3: and the variants that play an outcome of their own – Classic's ring-at, Grow's fills-by)
    const variantsBound = BINDINGS.flatMap((b) => b.variants.filter((v) => v.own?.outcome).map((v) => variantBinding(b, v)));
    expect(variantsBound.map((b) => [b.mode, b.outcome, b.needs])).toEqual([["classic", "ring-at", "ringEscape"], ["grow", "fills-by", "growFinish"]]);
    for (const b of [...bound, ...variantsBound]) {
      for (const seed of [1, 2, 3, 4]) {
        const s = { ...defaultSettings(b.mode), ...ownSettingsOf(b)(ctxOf(seed)) } as SimulatorSettings;
        const context = outcomeContextOfSettings(s);
        expect([b.mode, seed, availableOutcomes(b.mode, context).includes(b.outcome!)]).toEqual([b.mode, seed, true]);
        if (b.needs) expect([b.mode, outcomeFlagHolds(b.needs, context)]).toEqual([b.mode, true]);
      }
    }
    // (the chaos fan's split, Grow's fill and the ring waves' bar line are not there on the defaults)
    expect(availableOutcomes("doublePendulum", outcomeContextOfSettings(defaultSettings("doublePendulum")))).not.toContain("diverges-at");
    expect(availableOutcomes("vortex", outcomeContextOfSettings(defaultSettings("vortex")))).not.toContain("ring-on-bar");
  });

  it("lays a binding's own settings out in order: its seeded generator (else its patch), its outcome's flag on top, its tune, an atEnd clip's length, its mode", () => {
    // (--- templates --- AI studio step 5: the chaos fan draws its own settings now; without its generator its patch lays them out)
    const fan = { ...MODE_TEMPLATES.doublePendulum, generate: undefined, patch: { dpFan: false, dpFanCount: 9 } };
    expect(ownSettingsOf(fan)(ctxOf(1))).toEqual({ dpFan: true, dpFanCount: 9, mode: "doublePendulum" });
    // (--- templates --- AI studio step 4: the Wave Tank's atEnd binding, the conveyor's ends on its own run's end now)
    const drawn = { ...MODE_TEMPLATES.waveTank, patch: { wtSpacing: 99 }, generate: (ctx: RecipeContext) => ({ wtSpacing: 20 + 10 * Math.floor(ctx.rng() * 3) }) };
    const a = ownSettingsOf(drawn)(ctxOf(5, 17));
    expect(a).toEqual(ownSettingsOf(drawn)(ctxOf(5, 17)));
    expect([a.mode, a.recordingDuration, [20, 30, 40].includes(a.wtSpacing as number)]).toEqual(["waveTank", 20, true]);
    // (--- templates --- AI studio step 3: Shatter draws its own settings now; --- AI studio step 4: the Maze too; step 5: Spinning
    // Hoops too, Beat Runner has neither)
    expect(ownSettingsOf({ ...MODE_TEMPLATES.runner, tune: { ballSpeed: 450 } })(ctxOf(1))).toEqual({ ballSpeed: 450, mode: "runner" });
    // the defaults, where a binding has neither
    expect(ownSettingsOf(MODE_TEMPLATES.runner)(ctxOf(1))).toEqual({ mode: "runner" });
    // a seeded generator draws under its tune: the tune's value wins, every other number is the draw's
    const shatter = ownSettingsOf(MODE_TEMPLATES.shatter)(ctxOf(1));
    expect(ownSettingsOf({ ...MODE_TEMPLATES.shatter, tune: { ballSpeed: 450 } })(ctxOf(1))).toEqual({ ...shatter, ballSpeed: 450 });
  });

  it("adapts a binding without a recipe: its own settings inside RANGES and canonical, its mode, its strategy and outcome, its format's family and copy key", () => {
    const own = allTemplates().filter((t) => t.binding.variants.find((v) => v.id === t.id)!.recipe === null);
    // (the 32 bindings without a recipe and – --- templates --- AI studio step 3 – two variants of proven ones that play their own way)
    expect(own.length).toBe(32 + OWN_VARIANTS.length);
    for (const t of own) {
      const b = variantBinding(t.binding, t.binding.variants.find((v) => v.id === t.id));
      const r = plannedRecipe(t);
      expect([t.id, r === null]).toEqual([t.id, !strategyCanPlan(b)]);
      expect([t.id, t.family]).toEqual([t.id, t.binding.family ?? t.format.family]);
      if (!r) continue;
      expect([r.id, r.modes, r.strategy, r.outcome, r.copyKey, r.family, r.wraps]).toEqual([t.id, [t.mode], b.strategy, b.outcome, t.format.copyKey, t.family, undefined]);
      expect([t.id, r.endings!.every((e) => t.format.endings.includes(e))]).toEqual([t.id, true]);
      if (r.strategy === "atEnd") expect([t.id, r.endings, r.buckets]).toEqual([t.id, ["resolved"], AT_END_BUCKETS]);
      for (const bucket of LENGTH_BUCKETS) {
        for (const seed of [1, 2]) {
          const plan = planClip(r, seed * 7919 + bucket.length, "reels", { copy, bucket, search: false, look: "simple", template: t.id });
          const s = plan.settings;
          const where = `${t.id}/${bucket}/${seed}`;
          expect(rangeViolations(s), where).toEqual([]);
          expect([where, s.mode, plan.template, plan.recipe]).toEqual([where, t.mode, t.id, t.id]);
          expect(sameSettings(presetToSettings(s), s), where).toBe(true);
          for (const c of s.captions) expect(sanitizeCaption(c), where).toEqual(c);
          if (b.needs) expect([where, outcomeFlagHolds(b.needs, outcomeContextOfSettings(s))]).toEqual([where, true]);
        }
      }
    }
    // a wrapped recipe's template adapts as before, whatever is offered: the same plan as the offered template's
    const classic = plannedRecipe(templateById("get-out-classic")!)!;
    expect(JSON.stringify(planClip(classic, 3, "reels", { copy, search: false, look: "simple", template: "get-out-classic" }))).toBe(JSON.stringify(planTemplate("get-out-classic", 3, "reels", { copy, search: false })));
    expect(plannedRecipe(templateById("who-wins-race")!)!.wraps).toBe("square-race");
  });

  it("proves the outcome strategy on Shatter's binding (escapes-at): the payoff is the run's first escape, inside the band or 0.5-1 s after the cut, on 3 of 4 plan seeds", async () => {
    const t = templateById("get-out-shatter")!;
    // (--- templates --- AI studio step 3: offered now, cut before its escape – the run ends with it; the strategy is proven on both
    // endings here, the template's recipe asked for the resolved one too)
    expect([t.ready, t.binding.tier, templateRecipeById(t.id)?.endings]).toEqual([true, "trial", ["cliffhanger"]]);
    const r = { ...plannedRecipe(t)!, endings: ["resolved", "cliffhanger"] as const };
    expect([r.strategy, r.outcome, r.endings]).toEqual(["outcome", "escapes-at", ["resolved", "cliffhanger"]]);
    let found = 0;
    const endings = new Set<string>();
    for (const seed of [1, 2, 3, 4]) {
      const options = { copy, look: "simple" as const, template: t.id, episode: 3, index: seed };
      const plan = planClip(r, seed, "shorts", options);
      const where = `shatter/${seed}`;
      expect(JSON.stringify(planClip(r, seed, "shorts", options)), where).toBe(JSON.stringify(plan));
      // the finder's own run of the seed, followed over its whole horizon: its first escape is the payoff
      const horizon = 25;
      const request = finderRequestOfSettings(plan.settings, plan.world, horizon);
      const run = simulateOutcomeRun(plan.seed, request, strategyOutcome("escapes-at", horizon));
      expect([where, run.firstEscapeMs >= 0]).toEqual([where, true]);
      expect(plan.payoff.atSec, where).toBeCloseTo(run.firstEscapeMs / 1000, 9);
      // the score's run reads the same moment (lib/insights/score.ts: the strategy with its outcome)
      const facts = simulateFacts(request, plan.seed, { strategy: "outcome", outcome: "escapes-at" }, horizon);
      expect([where, facts.outcomeRun!.kind, facts.firstEscapeSec]).toEqual([where, "escapes-at", run.firstEscapeMs / 1000]);
      expect(payoffSecOf(r, plan.settings, facts), where).toBeCloseTo(plan.payoff.atSec!, 9);
      if (!plan.timing.found) continue;
      found++;
      endings.add(plan.ending);
      if (plan.ending === "resolved") {
        expect([where, plan.payoff.position! >= PAYOFF_BAND.from - 1e-9 && plan.payoff.position! <= PAYOFF_BAND.accept + 1e-9]).toEqual([where, true]);
      } else {
        // a cut clip ends before the escape, 0.5-1 s before it
        expect([where, plan.payoff.cutGapSec! >= CLIFF_GAP_SEC.min - 1e-9 && plan.payoff.cutGapSec! <= CLIFF_GAP_SEC.max + 1e-9, plan.payoff.atSec! > plan.timing.recordingDuration]).toEqual([where, true, true]);
      }
      await breathe();
    }
    expect(found).toBeGreaterThanOrEqual(3);
    expect(endings).toEqual(new Set(["resolved", "cliffhanger"]));
    // the finder is asked for the outcome around the payoff target, as far either way as the bucket's payoffs reach
    const w = payoffWindow(10, "short", "resolved");
    const reach = bucketPayoffSec("short", "resolved");
    expect([w.atSec, w.atSec - w.toleranceSec <= reach.fromSec + 1e-9, w.atSec + w.toleranceSec >= reach.toSec - 1e-9]).toEqual([10, true, true]);
    expect(strategyOutcome("escapes-at", 20, w)).toEqual({ kind: "escapes-at", clipSec: 20, atSec: 10, toleranceSec: w.toleranceSec });
    expect(strategyOutcome("sorted-by", 20, w)).toEqual({ kind: "sorted-by", clipSec: 20, atSec: 10 + w.toleranceSec });
    expect(strategyOutcome("winner", 20, w)).toEqual({ kind: "winner", clipSec: 20 });
    // a winner's moment: a battle's verdict at its end, else the team out first
    expect(OUTCOME_MOMENTS.winner!.ms({ mode: "territory", durationMs: 30000, finished: true, firstEscapeMs: -1, teams: [] })).toBe(30000);
    expect(OUTCOME_MOMENTS.winner!.ms({ mode: "classic", durationMs: 30000, finished: true, firstEscapeMs: 8000, teams: [] })).toBe(8000);
  });

  it("proves the atEnd strategy on Lines' binding (planned, not yet offered: --- templates --- AI studio step 4, the conveyor ends on its own): the payoff is the clip's last 1.5 s, resolved, in the short and standard lengths", () => {
    const t = templateById("reveal-lines")!;
    expect([t.ready, t.binding.tier, templateRecipeById(t.id)]).toEqual([false, "experimental", undefined]);
    const r = plannedRecipe(t)!;
    expect([r.strategy, r.endings, r.buckets]).toEqual(["atEnd", ["resolved"], ["short", "standard"]]);
    for (const platform of ["reels", "shorts"] as const) {
      for (const seed of [1, 2, 3, 4]) {
        const plan = planClip(r, seed, platform, { copy, look: "simple", template: t.id, episode: 3, index: seed, ending: seed % 2 ? "cliffhanger" : "auto" });
        const where = `lines/${platform}/${seed}`;
        expect([where, plan.ending, plan.timing.found, AT_END_BUCKETS.includes(plan.bucket)]).toEqual([where, "resolved", true, true]);
        expect([where, plan.timing.clipSec, plan.settings.recordingDuration]).toEqual([where, plan.timing.recordingDuration, plan.timing.recordingDuration]);
        expect(plan.payoff.atSec, where).toBeCloseTo(plan.timing.recordingDuration - AT_END_SEC, 9);
        expect([where, plan.payoff.position! >= PAYOFF_BAND.from - 1e-9 && plan.payoff.position! <= PAYOFF_BAND.accept + 1e-9]).toEqual([where, true]);
        // analytic: one seed a settings draw, the run followed to its first sound only
        expect(plan.timing.seedsTested, where).toBeLessThanOrEqual(3);
        const facts = simulateFacts(finderRequestOfSettings(plan.settings, plan.world, 20), plan.seed, { strategy: "atEnd" }, 20);
        expect([where, facts.finishSec, payoffSecOf(r, plan.settings, facts)]).toEqual([where, -1, plan.payoff.atSec]);
      }
    }
    // a long clip is never asked of it: its payoff would come at 97.5 % and later, past the band
    expect(planClip(r, 1, "reels", { copy, bucket: "long", search: false, look: "simple", template: t.id }).bucket).not.toBe("long");
    const s = defaultSettings("lines");
    expect(clipTiming(r, { ...s, recordingDuration: 60 }, null, "resolved", "long")).toMatchObject({ payoffSec: 58.5, clipSec: 60, accepted: false });
    expect(clipTiming(r, { ...s, recordingDuration: 15 }, null, "resolved", "short")).toMatchObject({ payoffSec: 13.5, clipSec: 15, accepted: true });
    expect(clipTiming(r, { ...s, recordingDuration: 15 }, null, "cliffhanger", "short").accepted).toBe(false);
    // the clip's length comes from the payoff target: the clip it is 85 % of, whole seconds, the recording's least at least
    expect([atEndRecordingSec(12.75), atEndRecordingSec(17), atEndRecordingSec(1)]).toEqual([15, 20, RANGES.recordingDuration.min]);
  });
});

// --- templates --- (AI studio step 3) group A: the get-out, smash and fill bindings with their own settings, Classic's one ring and
// Grow's fill that ends the run, and Glass Smash's hook kept clear of the mode's own STAGE banners (the studio's first known gap)
describe("group A: Shatter, Color Match, Target, Brick Smash, Perfect Fit and Classic's one ring", () => {
  const GROUP_A = ["get-out-shatter", "get-out-color-match", "smash-target", "smash-brick-rebuild", "fill-perfect-fit", "get-out-classic-ring"];

  it("offers every one of them, in its format's words, its outcome there to find on its own settings; the same inputs plan the same JSON (one platform a seed, rotating)", async () => {
    for (const id of GROUP_A) {
      const t = templateById(id)!;
      const r = templateRecipeById(id)!;
      expect([id, t.ready, r.formatCopy, r.wraps]).toEqual([id, true, true, undefined]);
      const b = variantBinding(t.binding, t.binding.variants.find((v) => v.id === id));
      const platforms = platformsOf(id);
      for (const seed of [1, 2, 3, 4]) {
        const platform = platforms[(seed - 1) % platforms.length];
        const options = { copy, episode: 3, index: seed };
        const plan = planTemplate(id, seed, platform, options);
        const where = `${id}/${platform}/${seed}`;
        expect(JSON.stringify(planTemplate(id, seed, platform, options)), where).toBe(JSON.stringify(plan));
        expect(rangeViolations(plan.settings), where).toEqual([]);
        if (b.outcome) expect([where, availableOutcomes(t.mode, outcomeContextOfSettings(plan.settings)).includes(b.outcome)]).toEqual([where, true]);
      }
      await breathe();
    }
    // the bot's own plans are untouched: no template of group A is a recipe, and none plays a recipe's mode but Classic's ring
    expect(GROUP_A.filter((id) => RECIPES.some((r) => r.modes.includes(templateById(id)!.mode)))).toEqual(["get-out-classic-ring"]);
  });

  it("reads each payoff where the run shows it: the box full and Journey's HOME as the claim's facts, Spiral Glass's clear 2 s before its run's end", () => {
    expect(FILL_OUTCOMES).toEqual(["fills-by", "most-on-floor"]);
    // Perfect Fit: the first box full is the payoff and the fill the crew's claim reads
    const fit = planTemplate("fill-perfect-fit", 1, "reels", { copy, episode: 3, index: 1 });
    const horizon = fit.timing.clipSec + 2;
    const facts = simulateFacts(finderRequestOfSettings(fit.settings, fit.world, horizon), fit.seed, { strategy: "outcome", outcome: "most-on-floor" }, horizon);
    expect([facts.fillSec > 0, facts.fillSec]).toEqual([true, facts.outcomeRun!.atSec]);
    expect(fit.payoff.atSec).toBeCloseTo(facts.fillSec, 9);
    // Journey (its own overlay off in the Simple look): HOME, then 1.8 s of celebration before its run ends (Glass Smash's), so a resolved clip shows it
    const home = planClip(plannedRecipe(templateById("get-out-journey")!)!, 1, "reels", { copy, look: "simple", template: "get-out-journey", episode: 3, index: 1, ending: "resolved" });
    const jh = home.timing.clipSec + 3;
    const journey = simulateFacts(finderRequestOfSettings(home.settings, home.world, jh), home.seed, { strategy: "finish" }, jh);
    expect([home.ending, journey.homeSec > 0, journey.finishSec - journey.homeSec > 1.5]).toEqual(["resolved", true, true]);
    expect(home.payoff.atSec).toBeCloseTo(journey.homeSec, 9);
    // Spiral Glass (its own overlay off in the Simple look): GLASS CLEARED 2 s before the run finishes
    const spiral = planClip(plannedRecipe(templateById("smash-spiral-glass")!)!, 1, "reels", { copy, look: "simple", template: "smash-spiral-glass", episode: 3, index: 1, ending: "resolved" });
    const sh = spiral.timing.clipSec + 3;
    const sg = simulateFacts(finderRequestOfSettings(spiral.settings, spiral.world, sh), spiral.seed, { strategy: "finish" }, sh);
    expect(spiral.payoff.atSec).toBeCloseTo(sg.finishSec - 2, 9);
    // a run of its own reads Brick Smash's first smash (bricks-cleared-by) and loops on: no end of its own
    const brick = planTemplate("smash-brick-rebuild", 1, "reels", { copy, episode: 3, index: 1 });
    const own = outcomeRunOf(finderRequestOfSettings(brick.settings, brick.world, brick.timing.clipSec + 2), brick.seed, "bricks-cleared-by", brick.timing.clipSec + 2);
    expect([own.facts.atSec > 0, own.facts.endSec, own.summary.finished]).toEqual([true, null, false]);
  });

  it("keeps Paint experimental and Grow's fill that ends its run hidden, with their reasons: the run ends at the fill, so a resolved clip shows it for the recorder's 0.5 s (G2)", () => {
    expect(EXPERIMENTAL.paint).toMatch(/95 %.*0\.5 s.*G2/);
    // (--- templates --- AI studio step 4b: the two hidden after watching their render left the table once a setting switched off
    // what they draw of their own, which the Simple look does: tests below, "the overlay switches")
    expect([EXPERIMENTAL.spiralGlass, EXPERIMENTAL.journey]).toEqual([undefined, undefined]);
    const grow = templateById("fill-grow-fills")!;
    expect([grow.ready, grow.binding.ready, grow.binding.variants.find((v) => v.id === grow.id)!.hidden]).toEqual([false, true, expect.stringMatching(/0\.5 s.*G2/)]);
    // the reasons still hold (when they no longer do, they may be shown): every plan fails G2, timed by the fill that ends the run
    for (const id of ["fill-paint", "fill-grow-fills"]) {
      const r = plannedRecipe(templateById(id)!)!;
      for (const seed of [1, 2]) {
        const plan = planClip(r, seed, "reels", { copy, look: "simple", template: id, episode: 3, index: seed });
        const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec);
        const g2 = clarityOf(crewClipOfPlan(plan, { run })).gates.find((g) => g.id === "G2")!;
        expect([id, seed, plan.ending, g2.ok]).toEqual([id, seed, "resolved", false]);
      }
    }
  });

  it("keeps Glass Smash's hook clear of its STAGE banners: the hook takes the bottom, and the crew's G5 fails a text drawn over a banner", () => {
    for (const seed of [1, 2]) {
      const plan = planTemplate("get-out-glass", seed, "reels", { copy, episode: 3, index: seed });
      const where = `glass/${seed}`;
      const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec);
      const track = run.action!;
      // the run's track keeps the banners it shows: STAGE 1 from the first frame, the next as each stage begins
      expect([where, isActionTrack(track), track.banners?.length, actionCellsOf(track.banners![0]).length > 0]).toEqual([where, true, track.samples.length, true]);
      const hook = plan.captionRoles.flatMap((r, i) => (r === "hook" ? [i] : []));
      expect([where, hook.map((i) => plan.settings.captions[i].position)]).toEqual([where, hook.map(() => "bottom")]);
      expect([where, bannerCoverSec(plan.settings.captions, hook, track, plan.timing.clipSec)]).toEqual([where, 0]);
      const clip = crewClipOfPlan(plan, { run });
      expect([where, clarityOf(clip).gates.find((g) => g.id === "G5")!.problems]).toEqual([where, []]);
      // the same clip with its hook back at the top: two texts stacked, which G5 fails
      const atTop = crewClipOfPlan({ ...plan, settings: { ...plan.settings, captions: captionsAtEdge(plan.settings.captions, hook, "top") } }, { run });
      expect([where, bannerCoverSec(atTop.captions, hook, track, plan.timing.clipSec) >= 1]).toEqual([where, true]);
      expect([where, clarityOf(atTop).gates.find((g) => g.id === "G5")!.problems]).toEqual([where, ["readableOverBanner"]]);
    }
    // only the modes that draw a banner of their own text keep the banners: every other mode's track is as it was
    expect([...BANNER_MODES]).toEqual(["glass", "journey"]);
    const pendulum = planTemplate("line-up-pendulum", 1, "reels", { copy, search: false });
    expect("banners" in actionTrackSync(pendulum.settings, pendulum.seed, pendulum.world, 3)).toBe(false);
    expect([isActionTrack({ stepSec: 0.5, grid: 20, samples: [""], banners: [1] }), isActionTrack({ stepSec: 0.5, grid: 20, samples: [""], banners: [""] })]).toEqual([false, true]);
  });
});

// --- templates --- (AI studio step 4) group B: the count, who-wins and aim bindings with their own settings, each timed by its run's
// own moment, and Merge Ring and the square race kept hidden with what was measured
describe("group B: the conveyor, the Maze, Territory, Land Claim, Bullseye and Bouncing Shapes", () => {
  const GROUP_B = ["count-conveyor", "who-wins-maze", "who-wins-territory", "who-wins-land-claim", "aim-bullseye", "aim-box"];

  it("offers every one of them, in its format's words or a hook of its own, its outcome there to find on its own settings; the same inputs plan the same JSON (one platform a seed, rotating)", async () => {
    expect(GROUP_B.map((id) => templateById(id)!.mode)).toEqual([...GROUP_B_READY]);
    for (const id of GROUP_B) {
      const t = templateById(id)!;
      const r = templateRecipeById(id)!;
      expect([id, t.ready, t.binding.tier, r.formatCopy, r.wraps]).toEqual([id, true, "trial", true, undefined]);
      const platforms = platformsOf(id);
      for (const seed of [1, 2, 3, 4]) {
        const platform = platforms[(seed - 1) % platforms.length];
        const options = { copy, episode: 3, index: seed };
        const plan = planTemplate(id, seed, platform, options);
        const where = `${id}/${platform}/${seed}`;
        expect(JSON.stringify(planTemplate(id, seed, platform, options)), where).toBe(JSON.stringify(plan));
        expect(rangeViolations(plan.settings), where).toEqual([]);
        if (t.binding.outcome) expect([where, availableOutcomes(t.mode, outcomeContextOfSettings(plan.settings)).includes(t.binding.outcome)]).toEqual([where, true]);
      }
      await breathe();
    }
    // the who-wins ones stay in the battle family, out of the default menus as the daily bot's battles
    expect(GROUP_B.filter((id) => templateById(id)!.family === "battle")).toEqual(["who-wins-maze", "who-wins-territory", "who-wins-land-claim"]);
    expect(readyTemplates().map((t) => t.id).filter((id) => GROUP_B.includes(id)).sort()).toEqual(["aim-box", "aim-bullseye", "count-conveyor"]);
    // the bot's own plans are untouched: no mode of group B is a recipe's (the maze race plays Classic)
    expect(GROUP_B.filter((id) => RECIPES.some((r) => r.modes.includes(templateById(id)!.mode)))).toEqual([]);
  });

  it("times each by its run's own moment: the first bullseye, the first shape at zero, GAME OVER and the last ball out, and the maze's first one out", () => {
    expect([...MARK_MODES]).toEqual(["bullseye", "box", "mergeRing", "paddle", "conveyor"]);
    // the run's end after its mark (s): GAME OVER and the last ball out end the run; a bullseye and a shape at zero leave it going on
    const holds: Record<string, number | null> = { "aim-bullseye": null, "aim-box": null, "aim-paddle": 2.2, "count-conveyor": 1.5 };
    for (const [id, hold] of Object.entries(holds)) {
      // Paddle's template is hidden (its own HUD under the hook): its plan comes from its binding's recipe, as the tests above
      const plan = templateById(id)!.ready ? planTemplate(id, 2, "reels", { copy, episode: 3, index: 2, ending: "resolved" }) : planClip(plannedRecipe(templateById(id)!)!, 2, "reels", { copy, look: "simple", template: id, episode: 3, index: 2, ending: "resolved" });
      const horizon = plan.timing.clipSec + 4;
      const facts = simulateFacts(finderRequestOfSettings(plan.settings, plan.world, horizon), plan.seed, { strategy: "finish" }, horizon);
      expect([id, plan.ending, (facts.markSec ?? -1) > 0]).toEqual([id, "resolved", true]);
      expect(plan.payoff.atSec, id).toBeCloseTo(facts.markSec!, 9);
      if (hold !== null) expect(facts.finishSec - facts.markSec!, id).toBeCloseTo(hold, 1);
      else expect([id, facts.finishSec < 0 || facts.finishSec > plan.timing.clipSec]).toEqual([id, true]);
    }
    // the mark is read only where a finish binding plays a mark mode: every other run's facts are as they were
    expect("markSec" in simulateFacts(finderRequestOfSettings(defaultSettings("classic"), undefined, 3), 1, { strategy: "finish" }, 3)).toBe(false);
    expect("markSec" in simulateFacts(finderRequestOfSettings(defaultSettings("box"), undefined, 3), 1, { strategy: "atEnd" }, 3)).toBe(false);
    // the Maze: its winner is the first ball out, named the moment it leaves – the finder's own run of a winner reads the run's end
    expect(Object.keys(OWN_RUN_MODE_MOMENTS)).toEqual(["maze"]);
    const maze = planTemplate("who-wins-maze", 1, "reels", { copy, episode: 3, index: 1, ending: "resolved" });
    const own = outcomeRunOf(finderRequestOfSettings(maze.settings, maze.world, maze.timing.clipSec + 2), maze.seed, "winner", maze.timing.clipSec + 2);
    expect([own.facts.winner >= 0, own.facts.atSec]).toEqual([true, maze.payoff.atSec]);
    const run = runSync(maze.settings, maze.seed, maze.world, maze.recipe, maze.timing.clipSec, maze.payoff.atSec);
    // a ball without a roster goes by its colour, as the maze's banner names it ("AQUA ESCAPED"), in the plan and the crew's run alike
    expect(maze.payoff.winner).toMatch(/^[A-Z]+$/);
    expect(crewClipOfPlan(maze, { run }).payoff.winner).toBe(maze.payoff.winner);
    expect(clarityOf(crewClipOfPlan(maze, { run })).gates.find((g) => g.id === "G4")!.problems).toEqual([]);
  });

  it("cuts Territory and Land Claim before their verdict, which comes as their run ends and their banner shows for 0.5 s", () => {
    for (const id of ["who-wins-territory", "who-wins-land-claim"]) {
      expect([id, templateRecipeById(id)!.endings]).toEqual([id, ["cliffhanger"]]);
      const plan = planTemplate(id, 1, "shorts", { copy, episode: 3, index: 1 });
      expect([id, plan.ending, plan.timing.found, plan.payoff.cutGapSec! >= CLIFF_GAP_SEC.min - 1e-9 && plan.payoff.cutGapSec! <= CLIFF_GAP_SEC.max + 1e-9]).toEqual([id, "cliffhanger", true, true]);
    }
    // Territory's countdown is on its 5 s step, at or after the payoff target: the verdict comes as it ends
    const t = planTemplate("who-wins-territory", 2, "reels", { copy, episode: 3, index: 2 });
    expect(t.settings.tyDuration % 5).toBe(0);
    expect(t.payoff.atSec).toBeCloseTo(t.settings.tyDuration, 6);
  });

  it("keeps Merge Ring and Paddle Keep-Up experimental, though they plan (Merge Ring's own question, Paddle's score under the hook), and the square race hidden: no seed opens its gate within the first second", () => {
    expect(EXPERIMENTAL.mergeRing).toMatch(/Will it merge into its final form\?.*watched/);
    expect(EXPERIMENTAL.paddle).toMatch(/score.*modeTopHud.*watched/);
    const paddle = planClip(plannedRecipe(templateById("aim-paddle")!)!, 1, "shorts", { copy, look: "simple", template: "aim-paddle", episode: 3, index: 1 });
    const paddleRun = runSync(paddle.settings, paddle.seed, paddle.world, paddle.recipe, paddle.timing.clipSec, paddle.payoff.atSec);
    expect([paddle.hook, paddle.timing.found, clarityOf(crewClipOfPlan(paddle, { run: paddleRun })).pass, paddle.settings.captions.find((_, i) => paddle.captionRoles[i] === "hook")?.position]).toEqual(["How long can it last?", true, true, "top"]);
    const merge = plannedRecipe(templateById("count-merge-ring")!)!;
    const plan = planClip(merge, 1, "reels", { copy, look: "simple", template: "count-merge-ring", episode: 3, index: 1 });
    const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec);
    expect([plan.hook, plan.timing.found, clarityOf(crewClipOfPlan(plan, { run })).pass]).toEqual(["How far can it merge?", true, true]);
    // the square race: its 3-2-1-GO opens the gate at 1.8 s on every seed the search may try (24 a plan), so its template stays hidden
    const race = recipeById("square-race")!;
    for (const planSeed of [1, 2]) {
      const p = planClip(race, planSeed, "reels", { copy, look: "simple", search: false });
      const request = finderRequestOfSettings(p.settings, p.world, 3);
      for (let i = 0; i < 24; i++) expect([planSeed, i, simulateFacts(request, 1000 * planSeed + i, { strategy: "finish" }, 2.5).firstImpactSec]).toEqual([planSeed, i, expect.toSatisfy((x: number) => x < 0 || x >= 1.8 - 1e-9)]);
    }
  });

  it("speaks with a hook of its own where its format's three do not say what its run does: ViralBot.ownHooks in en, pl and es", () => {
    const own = allTemplates().map((t) => variantBinding(t.binding, t.binding.variants.find((v) => v.id === t.id)).hookKey as string | undefined).filter((k): k is string => !!k && k.startsWith(OWN_HOOK_FIELD));
    // (--- templates --- AI studio step 4b: and Spiral Glass's, the question its own overlay asked; step 5: the chaos fan's, the plan's hook b)
    expect(own.sort()).toEqual(["own.box", "own.doublePendulum", "own.mergeRing", "own.spiralGlass"]);
    for (const locale of ["en", "pl", "es"] as const) {
      const hooks = (COPY[locale] as unknown as { ownHooks: Record<string, string> }).ownHooks;
      expect([locale, Object.keys(hooks)]).toEqual([locale, ["mergeRing", "box", "spiralGlass", "doublePendulum"]]);
      for (const [key, text] of Object.entries(hooks)) {
        const where = `${locale} ${key}: "${text}"`;
        expect([where, wordCount(text) <= SIMPLE_TEXT.hookWordsMax, [...text].length <= (locale === "en" ? 42 : 52), simpleHookText(text) === text, evenCaptionLines(text, 1.2).length <= 2]).toEqual([where, true, true, true, true]);
      }
    }
    expect(planTemplate("aim-box", 1, "reels", { copy: COPY.pl, locale: "pl", search: false }).hook).toBe("Zatrzyma się na zerze.");
  });
});

// --- templates --- (AI studio step 4) the studio's known gap "Two endings at once": a mode that draws its own ending
describe("one ending: a mode's own end banner", () => {
  it("draws no payoff words of the Simple look's own beside a mode's end banner, and keeps the bot look's as they were", () => {
    const simple = planTemplate("smash-power-layers", 1, "reels", { copy, episode: 3, index: 1 });
    const bot = planTemplate("smash-power-layers", 1, "reels", { copy, episode: 3, index: 1, look: "bot" });
    expect([simple.ending, simple.captionRoles.includes("payoff"), simple.payoff.text]).toEqual(["resolved", false, ""]);
    expect([bot.captionRoles.includes("payoff"), bot.payoff.text.length > 0]).toEqual([true, true]);
    // where the mode draws none, the Simple look draws its words (Classic's escape)
    const classic = planTemplate("get-out-classic", 1, "reels", { copy, episode: 3, index: 1, ending: "resolved" });
    expect([classic.captionRoles.includes("payoff"), classic.payoff.text.length > 0]).toEqual([true, true]);
    // the Simple score and the screen view see the banner from the payoff on; the clip ends on words to read (no dead air)
    const run = runSync(simple.settings, simple.seed, simple.world, simple.recipe, simple.timing.clipSec, simple.payoff.atSec);
    const clip = crewClipOfPlan(simple, { run });
    const banner = overlaysOf(clip).filter((o) => o.kind === "banner");
    expect(banner.map((o) => [o.start, o.end, o.words])).toEqual([[simple.payoff.atSec, simple.timing.clipSec, "a FREEDOM! banner with the hits and the time"]]);
    expect(screenView(clip).text).toContain("drawn on screen at the end");
    expect(clarityOf(clip).gates.find((g) => g.id === "G2")!.problems).toEqual([]);
  });

  it("times a banner from the payoff or before the run's end, never in a clip cut before the payoff, one for two that come and go together", () => {
    const s = (mode: SimulatorSettings["mode"]) => ({ ...defaultSettings(mode) }) as SimulatorSettings;
    expect(endBannersIn(s("powerLayers"), { ending: "resolved", payoffSec: 10, clipSec: 12, runEndSec: 11.8 }).map((b) => [b.start, b.end])).toEqual([[10, 12]]);
    expect(endBannersIn(s("powerLayers"), { ending: "cliffhanger", payoffSec: 10, clipSec: 9, runEndSec: null })).toEqual([]);
    expect(endBannersIn(s("paddle"), { ending: "resolved", payoffSec: 10, clipSec: 12.7, runEndSec: 12.2 }).map((b) => [b.start, b.end])).toEqual([[10, 12.7]]);
    expect(endBannersIn(s("paddle"), { ending: "resolved", payoffSec: 10, clipSec: 11.5, runEndSec: null })).toEqual([]);
    // Bullseye's callout leaves, its final banner stays; a roster's banner at the same end as the mode's own is one
    expect(endBannersIn(s("bullseye"), { ending: "resolved", payoffSec: 5, clipSec: 30.5, runEndSec: 30 }).map((b) => [b.start, b.end])).toEqual([[5, 6.5], [27.5, 30.5]]);
    expect(endBannersIn({ ...s("territory"), teams: SERIES_ROSTER.slice(0, 2).map((r) => ({ ...r })) } as SimulatorSettings, { ending: "resolved", payoffSec: 20, clipSec: 21, runEndSec: 20 })).toHaveLength(1);
    // Classic draws none (its escape has no banner)
    expect(endBannersIn(s("classic"), { ending: "resolved", payoffSec: 10, clipSec: 12, runEndSec: 11 })).toEqual([]);
    // in a stranger's words: no word of the intent, no claim's (the screen view holds no intent: tests/crewDossier.test.ts)
    for (const b of MODE_END_BANNERS) expect([b.mode, b.words.length > 10, /payoff|template|intent|idea/i.test(b.words), CLAIMS.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(b.words))]).toEqual([b.mode, true, false, []]);
  });

  it("matches the engine: the banner shows where the rule says on the ready templates' plans (Power Layers' FREEDOM!, Ball Drop's SETTLED!)", () => {
    const freed = planTemplate("smash-power-layers", 2, "shorts", { copy, episode: 3, index: 2, ending: "resolved" });
    const run = runSync(freed.settings, freed.seed, freed.world, freed.recipe, freed.timing.clipSec, freed.payoff.atSec);
    const shown = endBannersShown(crewClipOfPlan(freed, { run }));
    expect(shown.map((b) => b.start)).toEqual([freed.payoff.atSec]);
    // Ball Drop's recipe in the Simple look (its template is hidden): SETTLED! as its run ends, a second after its payoff
    const drop = dropPlan(2, { ending: "resolved" });
    const dropRun = runSync(drop.settings, drop.seed, drop.world, drop.recipe, drop.timing.clipSec, drop.payoff.atSec);
    const settled = endBannersShown(crewClipOfPlan(drop, { run: dropRun }));
    expect([settled.length, settled[0]?.start]).toEqual([1, dropRun.finishSec]);
    expect([drop.captionRoles.includes("payoff"), drop.payoff.text]).toEqual([false, ""]);
  });
});

// --- templates --- (AI studio step 4b) the two step 3 hid for what they draw of their own, ready since a setting switches it off:
// the Journey (its stage banners, mini-map, clock and HOME! card: journeyHud) and Spiral Glass (its question over the spiral, its
// title, tiles left and progress ring: sgHud), both HUD flags the Simple look turns off as the others
describe("the overlay switches: the Journey and Spiral Glass in the Simple look", () => {
  const OVERLAY = [["get-out-journey", "journeyHud"], ["smash-spiral-glass", "sgHud"]] as const;

  it("offers both, resolved only, their overlay off in the Simple look and on in the bot look; the same inputs plan the same JSON (one platform a seed, rotating)", async () => {
    expect(OVERLAY.map(([id]) => templateById(id)!.mode)).toEqual([...OVERLAY_READY]);
    for (const [id, flag] of OVERLAY) {
      const t = templateById(id)!;
      const r = templateRecipeById(id)!;
      expect([id, t.ready, t.binding.tier, r.formatCopy, r.wraps, r.endings]).toEqual([id, true, "trial", true, undefined, ["resolved"]]);
      const platforms = platformsOf(id);
      expect(platforms).toEqual([...BOT_PLATFORMS]);
      for (const seed of [1, 2, 3, 4]) {
        const platform = platforms[(seed - 1) % platforms.length];
        const options = { copy, episode: 3, index: seed };
        const plan = planTemplate(id, seed, platform, options);
        const where = `${id}/${platform}/${seed}`;
        expect(JSON.stringify(planTemplate(id, seed, platform, options)), where).toBe(JSON.stringify(plan));
        expect(rangeViolations(plan.settings), where).toEqual([]);
        expect([where, plan.ending, plan.settings[flag], hudsOn(plan.settings).filter((h) => h.flag)]).toEqual([where, "resolved", false, []]);
        // the bot look keeps the mode's overlay, as every link, preset and the daily bot do
        expect([where, planTemplate(id, seed, platform, { ...options, look: "bot", search: false }).settings[flag]]).toEqual([where, true]);
      }
      await breathe();
    }
    // neither is in the battle family: both are offered by default
    expect(readyTemplates().map((t) => t.id).filter((id) => OVERLAY.some(([o]) => o === id)).sort()).toEqual(["get-out-journey", "smash-spiral-glass"]);
  });

  it("says HOME where the Journey's card did: its hook b and its own payoff words, in en, pl and es", () => {
    const binding = MODE_TEMPLATES.journey;
    expect([binding.hookKey, binding.payoffKey, binding.endings]).toEqual(["hookB", `${OWN_PAYOFF_FIELD}journey`, ["resolved"]]);
    for (const locale of ["en", "pl", "es"] as const) {
      const words = (COPY[locale] as unknown as { ownPayoffs: Record<string, string> }).ownPayoffs;
      expect([locale, Object.keys(words)]).toEqual([locale, ["journey"]]);
      const plan = planTemplate("get-out-journey", 1, "reels", { copy: COPY[locale], locale, episode: 3, index: 1 });
      const where = `${locale}: "${plan.payoff.text}"`;
      // its own words, drawn whole (one clause), as the clip's one ending: no HOME! card beside them with the overlay off
      expect([where, plan.payoff.text, simplePayoffText(words.journey), plan.captionRoles.includes("payoff")]).toEqual([where, words.journey, words.journey, true]);
      expect(endBannersIn(plan.settings, { ending: "resolved", payoffSec: plan.payoff.atSec, clipSec: plan.timing.clipSec, runEndSec: null })).toEqual([]);
      expect([where, wordCount(plan.hook) <= SIMPLE_TEXT.hookWordsMax, plan.hook.includes("Gerald")]).toEqual([where, true, true]);
    }
    expect(planTemplate("get-out-journey", 1, "reels", { copy, episode: 3, index: 1 }).hook).toBe("Will Gerald make it home?");
    // the bot look keeps its HOME! card, and its own payoff words beside it as before
    const bot = planTemplate("get-out-journey", 1, "reels", { copy, episode: 3, index: 1, look: "bot" });
    expect([bot.payoff.text, endBannersIn(bot.settings, { ending: "resolved", payoffSec: bot.payoff.atSec, clipSec: bot.timing.clipSec, runEndSec: null }).length]).toEqual(["Home! 🏠", 1]);
  });

  it("asks the question Spiral Glass's overlay asked, in en, pl and es, and ends on its GLASS CLEARED with no words beside it", () => {
    const messages = { en, pl, es } as const;
    expect([MODE_TEMPLATES.spiralGlass.hookKey, MODE_TEMPLATES.spiralGlass.endings]).toEqual([`${OWN_HOOK_FIELD}spiralGlass`, ["resolved"]]);
    for (const locale of ["en", "pl", "es"] as const) {
      const plan = planTemplate("smash-spiral-glass", 2, "reels", { copy: COPY[locale], locale, episode: 3, index: 2 });
      const where = `${locale}: "${plan.hook}"`;
      expect([where, plan.hook]).toEqual([where, messages[locale].SpiralGlass.caption]);
      const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec);
      const clip = crewClipOfPlan(plan, { run });
      expect([where, plan.captionRoles.includes("payoff"), plan.payoff.text, endBannersShown(clip).map((b) => b.banner.words)]).toEqual([where, false, "", [expect.stringContaining("GLASS CLEARED")]]);
    }
  });

  it("keeps no stage banner on the Journey's action track with its overlay off, so its hook takes the top, clear of nothing it would cover", () => {
    const plan = planTemplate("get-out-journey", 1, "reels", { copy, episode: 3, index: 1 });
    expect([modeBannersDrawn(plan.settings), "banners" in actionTrackSync(plan.settings, plan.seed, plan.world, 4)]).toEqual([false, false]);
    const bot = planTemplate("get-out-journey", 1, "reels", { copy, episode: 3, index: 1, look: "bot" });
    expect([modeBannersDrawn(bot.settings), "banners" in actionTrackSync(bot.settings, bot.seed, bot.world, 4)]).toEqual([true, true]);
    const hook = plan.captionRoles.flatMap((r, i) => (r === "hook" ? [i] : []));
    expect(hook.map((i) => plan.settings.captions[i].position)).toEqual(hook.map(() => "top"));
  });
});

// --- templates --- (AI studio step 5) group C: the line-up and on-the-beat bindings with their own settings, each timed by its run's
// own moment or the clip's end, every one its mode's own notes the music; Beat Runner kept hidden with what was measured
describe("group C: line up and on the beat", () => {
  const GROUP_C = ["line-up-star-chords", "line-up-ellipse-foci", "line-up-hoops", "line-up-orb-grid", "line-up-colour-sort", "line-up-double-pendulum", "on-the-beat-beat-machine", "on-the-beat-collide", "on-the-beat-wave-tank"];
  /** A hidden group C template's plan from its binding's recipe, as the tests above plan Paddle Keep-Up's. */
  const hiddenPlanOf = (id: string, seed = 1) => planClip(plannedRecipe(templateById(id)!)!, seed, "reels", { copy, look: "simple", template: id, episode: 3, index: seed });
  /** A group C template's plan on reels (Shorts for Chord Stars, short only), resolved. */
  const planOf = (id: string, seed = 1) => planTemplate(id, seed, platformsOf(id).includes("reels") && id !== "line-up-star-chords" ? "reels" : "shorts", { copy, episode: 3, index: seed });

  it("offers every one of them in its format's words or a hook of its own, its mode's notes the music, its outcome there to find on its own settings; the same inputs plan the same JSON (one platform a seed, rotating)", async () => {
    expect(GROUP_C.map((id) => templateById(id)!.mode)).toEqual([...GROUP_C_READY]);
    for (const id of GROUP_C) {
      const t = templateById(id)!;
      const r = templateRecipeById(id)!;
      expect([id, t.ready, t.binding.tier, r.formatCopy, r.wraps, r.musicFirst, r.endings]).toEqual([id, true, "trial", true, undefined, true, ["resolved"]]);
      const platforms = platformsOf(id);
      for (const seed of [1, 2, 3, 4]) {
        const platform = platforms[(seed - 1) % platforms.length];
        const options = { copy, episode: 3, index: seed };
        const plan = planTemplate(id, seed, platform, options);
        const where = `${id}/${platform}/${seed}`;
        expect(JSON.stringify(planTemplate(id, seed, platform, options)), where).toBe(JSON.stringify(plan));
        expect(rangeViolations(plan.settings), where).toEqual([]);
        // the mode's own notes are the melody: none on top, and the checklist's sound item counts them
        expect([where, plan.melodyId, reason(plan, "sound").points]).toEqual([where, null, 10]);
        if (t.binding.outcome) expect([where, availableOutcomes(t.mode, outcomeContextOfSettings(plan.settings)).includes(t.binding.outcome)]).toEqual([where, true]);
      }
      await breathe();
    }
    // none is in the battle family: every one is offered by default, and none plays a recipe's mode
    expect(readyTemplates().map((x) => x.id).filter((id) => GROUP_C.includes(id)).sort()).toEqual([...GROUP_C].sort());
    expect(GROUP_C.filter((id) => RECIPES.some((r) => r.modes.includes(templateById(id)!.mode)))).toEqual([]);
    // the chaos fan says what it does in its own hook, in en, pl and es (the plan's hook b)
    for (const locale of ["en", "pl", "es"] as const) {
      const plan = planTemplate("line-up-double-pendulum", 1, "reels", { copy: COPY[locale], locale, search: false });
      expect([locale, plan.hook]).toEqual([locale, (COPY[locale] as unknown as { ownHooks: Record<string, string> }).ownHooks.doublePendulum]);
    }
    expect(planTemplate("line-up-double-pendulum", 1, "reels", { copy, search: false }).hook).toBe("Same start. Watch them split.");
  });

  it("reads each payoff off its run: the stars' close on its loop's seam, the volley's landing, every bead up, the orbs in phase, the sort, the split", () => {
    // Chord Stars: every star closes 85 % in, and the clip ends on its loop's seam (the hold and the fade after the close)
    const stars = planOf("line-up-star-chords");
    const s = stars.settings;
    expect([stars.payoff.atSec, stars.timing.clipSec, stars.payoff.position! >= PAYOFF_BAND.from && stars.payoff.position! <= PAYOFF_BAND.to]).toEqual([expect.closeTo(s.scCycle, 1), expect.closeTo(s.scCycle + s.scHold + s.scFade, 6), true]);
    // (a star of as many points as the drawing has seconds: the first bounce inside G1's first second)
    expect(stars.timing.firstImpactSec!).toBeLessThanOrEqual(1);
    // Focus Shot: its transit whole bars of its bed (2 s at 120 bpm), the volley landing on the other focus at once at the payoff,
    // two passes a loop so its seam comes after the clip; short clips only, whose transit stays on its slider (20 s at most)
    expect(templateRecipeById("line-up-ellipse-foci")!.buckets).toEqual(["short"]);
    const foci = planOf("line-up-ellipse-foci");
    expect([foci.settings.efTransit % 2, foci.settings.efPasses, foci.payoff.atSec]).toEqual([0, 2, expect.closeTo(foci.settings.efTransit, 1)]);
    expect(foci.timing.clipSec).toBeLessThan(2 * foci.settings.efTransit);
    // Spinning Hoops, Bouncing Orbs, Colour Sort and the chaos fan: the finder's own run of the seed reads each moment
    for (const [id, outcome] of [["line-up-hoops", "all-up-by"], ["line-up-orb-grid", "resolves-at"], ["line-up-colour-sort", "sorted-by"], ["line-up-double-pendulum", "diverges-at"]] as const) {
      const plan = planOf(id);
      const horizon = plan.timing.clipSec + 2;
      const facts = simulateFacts(finderRequestOfSettings(plan.settings, plan.world, horizon), plan.seed, { strategy: "outcome", outcome }, horizon);
      expect([id, plan.timing.found, facts.outcomeRun!.kind, facts.outcomeRun!.matched]).toEqual([id, true, outcome, true]);
      expect(plan.payoff.atSec, id).toBeCloseTo(facts.outcomeRun!.atSec, 9);
    }
    // Bouncing Orbs land in phase at their cycle, with the field's accented chord
    const orbs = planOf("line-up-orb-grid");
    expect(orbs.payoff.atSec).toBeCloseTo(orbs.settings.ogCycle, 1);
    expect(runSync(orbs.settings, orbs.seed, orbs.world, orbs.recipe, orbs.timing.clipSec, orbs.payoff.atSec).moment!.accent).toBe(true);
    // the chaos fan plays forward for the whole clip: it splits once and never comes back together in it
    const fan = planOf("line-up-double-pendulum");
    expect([fan.settings.dpFan, fan.settings.dpForwardSec >= fan.timing.clipSec]).toEqual([true, true]);
  });

  it("reads each beat off its run: Beat Machines' phrase with no spare marble over one loop, the vortex's last ring on a bar line, the clip's end where the rest play on", () => {
    // Beat Machines: one loop a clip, ending on its seam; the seed's phrase needs no spare marble, the payoff one of its notes
    const bm = planOf("on-the-beat-beat-machine");
    const request = finderRequestOfSettings(bm.settings, bm.world, bm.timing.clipSec + 2);
    const machine = outcomeRunOf(request, bm.seed, "no-tube-conflict", bm.timing.clipSec + 2);
    expect([bm.settings.bmLoopBeats / 2, bm.timing.clipSec, machine.facts.matched, machine.facts.seam]).toEqual([bm.timing.recordingDuration, bm.timing.recordingDuration, true, true]);
    expect(machine.facts.atSec).toBeCloseTo(bm.payoff.atSec!, 9);
    // a seed whose phrase needs a spare has no moment: the search moves on
    let spare = -1;
    for (let seed = 1; seed < 40 && spare < 0; seed++) if (outcomeRunOf(request, seed, "no-tube-conflict", 30).facts.atSec < 0) spare = seed;
    expect(spare).toBeGreaterThan(0);
    // the vortex (hidden: its own title): its last ring swallowed at the payoff, on a bar line of its 120 bpm bed (within the
    // finder's 20 ms), the run's end a second later
    const vx = hiddenPlanOf("on-the-beat-vortex");
    const ring = outcomeRunOf(finderRequestOfSettings(vx.settings, vx.world, vx.timing.clipSec + 2), vx.seed, "ring-on-bar", vx.timing.clipSec + 2);
    expect([vx.settings.vxRelease, ring.facts.matched, ring.facts.endSec! - ring.facts.atSec]).toEqual(["rings", true, expect.closeTo(1, 1)]);
    expect(Math.abs(vx.payoff.atSec! / 2 - Math.round(vx.payoff.atSec! / 2)) * 2).toBeLessThanOrEqual(0.02 + 1e-9);
    // Collision Playground and the Wave Tank play on – and Beat Drop (hidden: its own HUD) to its recording's end: the clip's last
    // 1.5 s are the payoff, and the beat is heard there
    for (const id of ["on-the-beat-beat-drop", "on-the-beat-collide", "on-the-beat-wave-tank"]) {
      const plan = id === "on-the-beat-beat-drop" ? hiddenPlanOf(id) : planOf(id);
      const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec);
      const clip = crewClipOfPlan(plan, { run });
      // (Beat Drop's run ends with its recording, a moment after the clip's payoff: its facts read no finish while it is hidden,
      // as the score reads a mode without a ready template by its own run)
      expect([id, plan.payoff.atSec, run.moment!.sounds > 0, claimSeen(clip), clarityOf(clip).pass]).toEqual([id, plan.timing.recordingDuration - AT_END_SEC, true, true, true]);
    }
  });

  it("sees the beat claim where the run plays notes at the clip's own payoff, never where it is silent or read around another second", () => {
    const plan = planOf("on-the-beat-collide");
    const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec);
    expect(claimSeen(crewClipOfPlan(plan, { run }))).toBe(true);
    expect(claimSeen(crewClipOfPlan(plan, { run: { ...run, moment: { ...run.moment!, sounds: 0, notes: 0 } } }))).toBe(false);
    expect(claimSeen(crewClipOfPlan(plan, { run: { ...run, moment: { ...run.moment!, atSec: run.moment!.atSec - 1 } } }))).toBe(false);
    // a run read without its moment (the bot's own, runSync without the payoff's second) shows it where it sounds before the
    // payoff, and never where it is silent
    expect(claimSeen(crewClipOfPlan(plan, { run: { ...run, moment: undefined } }))).toBe(true);
    expect(claimSeen(crewClipOfPlan(plan, { run: { ...run, moment: undefined, firstImpactSec: -1 } }))).toBe(false);
    expect(claimSeen(crewClipOfPlan(plan, { run: { ...run, moment: undefined, firstImpactSec: plan.payoff.atSec! + 0.5 } }))).toBe(false);
    // a run that ends on its own shows it as before (Ball Drop's recipe settles)
    const settle = dropPlan(1, { ending: "resolved" });
    expect(claimSeen(crewClipOfPlan(settle, { run: runSync(settle.settings, settle.seed, settle.world, settle.recipe, settle.timing.clipSec) }))).toBe(true);
  });

  it("keeps Beat Drop and the Sound Vortex experimental, though they plan: a HUD and a title of their own under the hook (watched)", () => {
    expect(EXPERIMENTAL.beatDrop).toMatch(/HUD of its own.*no setting switches off.*watched/);
    expect(EXPERIMENTAL.vortex).toMatch(/title of its own.*no setting switches off.*watched/);
    for (const id of ["on-the-beat-beat-drop", "on-the-beat-vortex"]) {
      const plan = hiddenPlanOf(id);
      const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec);
      expect([id, plan.timing.found, clarityOf(crewClipOfPlan(plan, { run })).pass, plan.captionRoles.includes("hook")]).toEqual([id, true, true, true]);
      expect(() => planTemplate(id, 1, "reels", { copy, search: false }), id).toThrow(/ready template/);
    }
  });

  it("keeps Beat Runner experimental, with its reason: its first note comes 1.5 s in, after a second of running, on every plan", () => {
    expect(EXPERIMENTAL.runner).toMatch(/LEAD_IN_SEC.*1\.5 s.*G1/);
    const runner = plannedRecipe(templateById("on-the-beat-runner")!)!;
    for (const seed of [1, 2]) {
      const plan = planClip(runner, seed, "reels", { copy, look: "simple", template: "on-the-beat-runner", episode: 3, index: seed });
      const run = runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec);
      expect([seed, plan.timing.firstImpactSec! > 1, clarityOf(crewClipOfPlan(plan, { run })).gates.filter((g) => !g.ok).map((g) => g.id)]).toEqual([seed, true, expect.arrayContaining(["G1"])]);
    }
  });
});
