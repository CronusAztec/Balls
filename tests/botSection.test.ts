import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import es from "../messages/es.json";
import pl from "../messages/pl.json";
import type { BotCopy } from "@/lib/bot/copy";
import { BOT_PLAN_VERSION, planDay, planDaySteps, planTemplate, resolveBucket, templateDaySlots, dayIndexOf, type ClipPlan } from "@/lib/bot/planner";
import { botLookLine, chosenTemplate, defaultBotOptions, endingSelect, lengthSelect, lookSwitched, panelLengthAndEnding, panelLook, panelPlanChoice, parseBotOptions, parseBotState, platformSwitched, storedTemplate, templateChoices, templateSwitched } from "@/lib/bot/store";
import { allTemplates, clarityJudges, endingsAlternate, readyTemplates, templateById, templatePlayOf, templateRecipeById } from "@/lib/bot/templates";
import { BOT_PLATFORMS, ENDING_CHOICES, LENGTH_BUCKETS, PLATFORMS, recipeBucket } from "@/lib/bot/playbook";
import { scheduleMarkdown } from "@/lib/bot/output";
import { planClarity, planClarityOf } from "@/lib/bot/clarityLines";
import { clarityOf, GATES } from "@/lib/crew/clarity";
import { crewClipOfPlan } from "@/lib/crew/clip";
import { payoffMomentSteps, payoffMomentSync, runOf, runSync } from "@/lib/insights/score";
import { parseArgs, templateRefusal } from "../scripts/viral-bot.mjs";

/**
 * --- bot-templates --- The website Bot section's Template choice and Simple switch (sections/BotSection.tsx, useViralBot.ts):
 * Auto plans the rotation exactly as before and a template its own clips, deterministically; the options keep only what differs
 * from the defaults, so a stored state of an older release – its options and its version-1 plan – loads as it was; the clarity
 * lines of "Why this clip" are the studio's for the same plan, their run followed in slices; every line a plan can show has its
 * words in en, pl and es; and the CLI plans a template's clips in a dry run only.
 */

const copy = en.ViralBot as unknown as BotCopy;
const world = { width: 800, height: 450 };
const DATE = "2026-10-29";
const json = (v: unknown) => JSON.stringify(v);
const noPause = { pause: () => Promise.resolve(), now: () => 0 };

describe("the Template choice and the Simple switch plan as asked", () => {
  it("keeps Auto exactly the rotation: no template asked plans what the planner planned before", () => {
    const options = { copy, locale: "en" as const, family: "all" as const, bucket: "auto" as const, ending: "auto" as const, world, search: false };
    const before = planDay(DATE, "reels", 3, options);
    expect(json(planDay(DATE, "reels", 3, { ...options, template: undefined }))).toBe(json(before));
    expect(json(planDay(DATE, "reels", 3, { ...options, template: "" }))).toBe(json(before));
    for (const clip of before.clips) {
      expect("template" in clip).toBe(false);
      expect("look" in clip).toBe(false);
    }
  });

  it("plans a template's clips at their own places' seeds, in the look asked for, the same for the same request", () => {
    const id = "get-out-classic";
    const base = { copy, locale: "en" as const, world, maxSeeds: 4, salt: "a" };
    const simple = planDay(DATE, "reels", 3, { ...base, template: id, look: "simple" });
    expect(simple.version).toBe(BOT_PLAN_VERSION);
    expect(simple.clips).toHaveLength(3);
    const seeds = templateDaySlots(dayIndexOf(DATE), 3, id, "a").map((s) => s.planSeed);
    expect(simple.clips.map((c) => c.planSeed)).toEqual(seeds);
    expect(new Set(seeds).size).toBe(3);
    simple.clips.forEach((c, i) => {
      expect(c.recipe).toBe(id);
      expect(c.template).toBe(id);
      expect(c.look).toBe("simple");
      expect(c.index).toBe(i + 1);
      expect(c.date).toBe(DATE);
    });
    expect(json(planDay(DATE, "reels", 3, { ...base, template: id, look: "simple" }))).toBe(json(simple));
    // another salt ("Plan clips" again): other seeds; the bot look: the template's clips without the Simple look
    expect(templateDaySlots(dayIndexOf(DATE), 3, id, "b").map((s) => s.planSeed)).not.toEqual(seeds);
    const bot = planDay(DATE, "reels", 1, { ...base, template: id, look: "bot", search: false });
    expect(bot.clips[0].template).toBe(id);
    expect("look" in bot.clips[0]).toBe(false);
    // the planner yields between seeds, as the page's slices need, with the clip it is on
    const steps = [...(function* () {
      const g = planDaySteps(DATE, "reels", 2, { ...base, template: id, look: "simple" });
      for (let n = g.next(); !n.done; n = g.next()) yield n.value;
    })()];
    expect(steps.length).toBeGreaterThan(1);
    expect(steps.every((s) => s.clips === 2 && (s.clip === 1 || s.clip === 2))).toBe(true);
  });

  it("refuses a template that is not ready, as planTemplate does", () => {
    const hidden = allTemplates().find((t) => !t.ready)!;
    expect(hidden).toBeDefined();
    expect(() => planDay(DATE, "reels", 1, { copy, template: hidden.id, search: false })).toThrow(/Not a ready template/);
    expect(() => planDay(DATE, "reels", 1, { copy, template: "no-such-template", search: false })).toThrow(/Not a ready template/);
  });

  it("lists the battle family's templates only under All series and Battle, where the bot offers them", () => {
    const battle = readyTemplates("battle");
    expect(battle.length).toBeGreaterThan(0);
    const ids = (family: Parameters<typeof templateChoices>[0]) => templateChoices(family).map((t) => t.id);
    for (const t of battle) {
      expect(ids("all")).toContain(t.id);
      expect(ids("battle")).toContain(t.id);
      expect(ids("escape")).not.toContain(t.id);
      expect(ids("rhythm")).not.toContain(t.id);
      expect(chosenTemplate({ family: "escape", template: t.id })).toBeUndefined();
      expect(chosenTemplate({ family: "all", template: t.id })).toBe(t.id);
    }
    expect(templateChoices("all").every((t) => t.ready)).toBe(true);
    expect(templateChoices("all")).toHaveLength(readyTemplates("all").length);
  });

  // --- bot-templates --- (studio round 1, 5) the empty state had promised "the one the CLI and the scheduled job make", which plan
  // the day's rotation in the bot look only (and without the battle family unless asked): with the switch on, Today's plan is the
  // same day's clips drawn in the Simple look, so the copy says that instead
  it("plans Today's plan as its words say: the day's own clips, the same all day, in the look the switch picks", () => {
    const today = { copy, locale: "en" as const, family: "all" as const, bucket: "auto" as const, ending: "auto" as const, world, maxSeeds: 3 };
    const bot = planDay(DATE, "reels", 2, today);
    const simple = planDay(DATE, "reels", 2, { ...today, look: "simple" });
    expect(json(planDay(DATE, "reels", 2, today))).toBe(json(bot));
    expect(simple.clips.map((c) => [c.recipe, c.planSeed, c.seed])).toEqual(bot.clips.map((c) => [c.recipe, c.planSeed, c.seed]));
    expect(simple.clips.map((c) => c.look)).toEqual(["simple", "simple"]);
    expect(bot.clips.map((c) => c.look)).toEqual([undefined, undefined]);
    for (const m of [en, pl, es]) expect(m.ViralBot.empty).not.toMatch(/CLI/);
  }, 60_000);
});

// --- bot-templates --- (studio2 review round 1, 21) a template chosen with the switch as it came planned in the bot look, where its
// plans failed the gates it was made ready on (the Journey's Simple 9, Spiral Glass's 24): a template plans in its own Simple look
// unless the switch is turned off, and Auto keeps today's look
describe("the Simple switch shows the look the panel plans in", () => {
  const base = { copy, locale: "en" as const, bucket: "auto" as const, ending: "auto" as const, world };

  it("is off for Auto and on for a chosen template, and pressing it turns the shown look over, for both buttons", () => {
    const auto = defaultBotOptions();
    expect([panelLook(auto), panelPlanChoice(auto, true), panelPlanChoice(auto, false)]).toEqual(["bot", {}, {}]);
    const id = "get-out-journey";
    const chosen = { ...auto, ...templateSwitched(auto, id) };
    expect([panelLook(chosen), panelPlanChoice(chosen, true), panelPlanChoice(chosen, false)]).toEqual(["simple", { template: id, look: "simple" }, { look: "simple" }]);
    // turned off beside a template: the bot look, kept (it differs from the template's own); on again: the Simple look
    const off = { ...chosen, ...lookSwitched(chosen) };
    expect([off.look, panelLook(off), panelPlanChoice(off, true)]).toEqual(["bot", "bot", { template: id, look: "bot" }]);
    expect(parseBotOptions(JSON.parse(json(off)))).toMatchObject({ template: id, look: "bot" });
    expect(panelLook({ ...off, ...lookSwitched(off) })).toBe("simple");
    // back to Auto: no bot look kept beside it, so a template chosen later opens in its own look again
    const back = { ...off, ...templateSwitched(off, undefined) };
    expect([back.template, back.look, panelLook(back)]).toEqual([undefined, undefined, "bot"]);
    expect(panelLook({ ...back, ...templateSwitched(back, id) })).toBe("simple");
    // Auto with the switch on and off again: nothing kept, the rotation as before
    const on = { ...auto, ...lookSwitched(auto) };
    expect([on.look, panelLook(on), panelPlanChoice(on, true)]).toEqual(["simple", "simple", { look: "simple" }]);
    expect({ ...on, ...lookSwitched(on) }.look).toBeUndefined();
    // a template its series does not list plans Auto, in Auto's look
    expect(panelLook({ ...auto, family: "escape", template: "who-wins-fight-league" })).toBe("bot");
  });

  it("plans a template chosen with the switch as it comes at Simple 80 or more, every clarity gate passing", () => {
    for (const id of ["get-out-journey", "smash-spiral-glass", "fill-grow", "line-up-orb-grid", "lab-game-blueprint-ring-breaker"]) {
      const options = parseBotOptions({ template: id, family: "all" });
      expect([id, "look" in options, panelLook(options)]).toEqual([id, false, "simple"]);
      const [plan] = planDay(DATE, "reels", 1, { ...base, family: "all", salt: "r", ...panelPlanChoice(options, true) }).clips;
      expect([id, plan.template, plan.look]).toEqual([id, id, "simple"]);
      // the overlays the owner asked to be able to hide, off (the Journey's stage banners and map, Spiral Glass's title and ring)
      if (plan.mode === "journey") expect(plan.settings.journeyHud).toBe(false);
      if (plan.mode === "spiralGlass") expect(plan.settings.sgHud).toBe(false);
      const clarity = clarityOf(crewClipOfPlan(plan, { run: runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec) }));
      expect([id, clarity.simple.score >= 80, clarity.gates.filter((g) => !g.ok).map((g) => g.id)]).toEqual([id, true, []]);
    }
  }, 240_000);
});

// --- bot-templates --- (studio2 review round 2, 1-3 and 5) Fight League's bracket, long only, was offered and planned on Shorts
// (86 s clips failing G7 under a Playbook 87); beside a chosen template the Length and Ending selects were ignored without a word
// (34 of the 45 ready templates cannot be long, 34 end one way) under a note that said the endings alternate; and a clip in the bot
// look asked to turn on a Simple switch that was on already
describe("the panel offers only what a chosen template plays", () => {
  const BRACKET = "who-wins-fight-league-bracket";
  const auto = defaultBotOptions();

  it("lists on a platform only the templates that plan a length it takes, and goes back to Auto when the platform leaves one out", () => {
    expect(templatePlayOf(BRACKET)).toMatchObject({ buckets: ["long"], platforms: ["reels", "tiktok"] });
    for (const platform of BOT_PLATFORMS) {
      const offered = templateChoices("all", platform);
      expect(offered.length, platform).toBeGreaterThan(0);
      // every template offered on a platform plans a bucket that platform takes, whatever its Length select shows
      for (const t of offered) {
        const recipe = templateRecipeById(t.id)!;
        const lengths = lengthSelect({ ...auto, platform, template: t.id });
        expect([t.id, platform, lengths.options.length > 0]).toEqual([t.id, platform, true]);
        for (const bucket of lengths.options) expect([t.id, platform, bucket, PLATFORMS[platform].buckets.includes(recipeBucket(recipe, resolveBucket(platform, bucket)))]).toEqual([t.id, platform, bucket, true]);
      }
      // and none that does not: the bracket only where its long clips fit
      const left = readyTemplates("all").filter((t) => !offered.includes(t));
      expect([platform, left.map((t) => t.id)]).toEqual([platform, platform === "shorts" ? [BRACKET] : []]);
    }
    // the bracket chosen on Reels: offered and planned there; on Shorts it plans Auto, the rotation in today's look
    const reels = { ...auto, family: "all" as const, ...templateSwitched(auto, BRACKET) };
    expect([chosenTemplate(reels), panelPlanChoice(reels, true)]).toEqual([BRACKET, { template: BRACKET, look: "simple" }]);
    const shorts = { ...reels, platform: "shorts" as const };
    expect([chosenTemplate(shorts), panelLook(shorts), panelPlanChoice(shorts, true)]).toEqual([undefined, "bot", {}]);
    // pressing Shorts drops the choice back to Auto, a "bot" look beside it too; another template keeps its choice
    expect(platformSwitched(reels, "shorts")).toEqual({ platform: "shorts", template: undefined, look: undefined });
    expect(platformSwitched({ ...reels, ...lookSwitched(reels) }, "shorts")).toEqual({ platform: "shorts", template: undefined, look: undefined });
    expect(platformSwitched(reels, "tiktok")).toEqual({ platform: "tiktok" });
    const journey = { ...auto, ...templateSwitched(auto, "get-out-journey") };
    expect(platformSwitched(journey, "shorts")).toEqual({ platform: "shorts" });
    expect(platformSwitched(auto, "shorts")).toEqual({ platform: "shorts" });
  });

  it("plans on every platform a bucket it takes for each template it offers there (no seed search: the bucket is the plan's own)", () => {
    for (const platform of BOT_PLATFORMS) {
      for (const t of templateChoices("all", platform)) {
        const plan = planTemplate(t.id, 1, platform, { copy, locale: "en", world, bucket: "auto", ending: "auto", search: false });
        expect([t.id, platform, PLATFORMS[platform].buckets.includes(plan.bucket)]).toEqual([t.id, platform, true]);
      }
    }
  }, 60_000);

  it("offers in the Length and Ending selects only what a chosen template plays, shows what it plans, and plans what it shows", () => {
    // Auto: every length and ending, as stored
    expect(lengthSelect({ ...auto, bucket: "long" })).toEqual({ options: ["auto", ...LENGTH_BUCKETS], value: "long", fixed: false });
    expect(endingSelect({ ...auto, ending: "cliffhanger" })).toEqual({ options: ENDING_CHOICES, value: "cliffhanger", fixed: false });
    expect(panelLengthAndEnding({ ...auto, bucket: "long", ending: "cliffhanger" })).toEqual({ bucket: "long", ending: "cliffhanger" });
    // the review's case: the Journey (short and standard, resolved only) asked for a long cliffhanger on Reels
    const journey = { ...auto, ...templateSwitched(auto, "get-out-journey"), bucket: "long" as const, ending: "cliffhanger" as const };
    expect(lengthSelect(journey)).toEqual({ options: ["auto", "short", "standard"], value: "standard", fixed: false });
    expect(endingSelect(journey)).toEqual({ options: ["resolved"], value: "resolved", fixed: true });
    expect(panelLengthAndEnding(journey)).toEqual({ bucket: "standard", ending: "resolved" });
    // on Shorts the Journey's lengths are Shorts' own (a stored long shows the nearest it plays, as the planner picks it) and Auto
    // shows Shorts' own short; Shatter ends on a cliffhanger only; Auto stays Auto where it is offered
    expect(lengthSelect({ ...journey, platform: "shorts" })).toEqual({ options: ["auto", "short", "standard"], value: "standard", fixed: false });
    expect(lengthSelect({ ...journey, platform: "shorts", bucket: "auto" })).toEqual({ options: ["auto", "short", "standard"], value: "auto", fixed: false });
    const shatter = { ...auto, ...templateSwitched(auto, "get-out-shatter") };
    expect(endingSelect(shatter)).toEqual({ options: ["cliffhanger"], value: "cliffhanger", fixed: true });
    expect(panelLengthAndEnding(shatter)).toEqual({ bucket: lengthSelect(shatter).value, ending: "auto" });
    // every ready template, every length and ending its selects offer on Reels: the plan's own is the one shown
    for (const t of templateChoices("all", "reels")) {
      const play = templatePlayOf(t.id)!;
      for (const bucket of lengthSelect({ ...auto, template: t.id }).options) {
        for (const ending of endingSelect({ ...auto, template: t.id }).options) {
          const o = { ...auto, template: t.id, bucket, ending };
          const asked = panelLengthAndEnding(o);
          const plan = planTemplate(t.id, 2, "reels", { copy, locale: "en", world, bucket: asked.bucket, ending: asked.ending, search: false });
          const where = `${t.id}/${bucket}/${ending}`;
          expect([where, plan.bucket]).toEqual([where, lengthSelect(o).value === "auto" ? recipeBucket(templateRecipeById(t.id)!, resolveBucket("reels", "auto")) : lengthSelect(o).value]);
          if (ending !== "auto") expect([where, plan.ending]).toEqual([where, ending]);
          expect([where, play.endings.includes(plan.ending)]).toEqual([where, true]);
        }
      }
    }
  }, 60_000);

  it("says the endings alternate only where they do: under the plan and in the posting schedule", () => {
    const options = { copy, locale: "en" as const, family: "all" as const, world, search: false };
    const rotation = planDay(DATE, "reels", 2, { ...options, bucket: "auto", ending: "auto" }).clips;
    const resolved = planDay(DATE, "reels", 2, { ...options, bucket: "auto", ending: "resolved" }).clips;
    const journey = planDay(DATE, "reels", 2, { ...options, bucket: "auto", ending: "auto", template: "get-out-journey", look: "simple" }).clips;
    const both = readyTemplates("all").find((t) => (templatePlayOf(t.id)?.endings.length ?? 0) > 1)!;
    const alternating = planDay(DATE, "reels", 2, { ...options, bucket: "auto", ending: "auto", template: both.id, look: "simple" }).clips;
    expect([endingsAlternate(rotation), endingsAlternate(resolved), endingsAlternate(journey), endingsAlternate(alternating), endingsAlternate([])]).toEqual([true, false, false, true, true]);
    const intro = (clips: ClipPlan[]) => scheduleMarkdown(clips, copy, { date: DATE, platform: "reels" }).split("\n")[2];
    expect(intro(rotation)).toMatch(/Endings alternate/);
    expect(intro(journey)).not.toMatch(/alternate/);
    expect(intro(journey)).toContain(DATE);
    for (const m of [en, pl, es]) {
      const v = m.ViralBot as unknown as { notes: string; notesTrial: string; templateFits: string; schedule: { intro: string; introPlain: string } };
      expect(v.notes.endsWith(v.notesTrial.slice(1)), "notesTrial is the notes' second half").toBe(true);
      expect(v.schedule.intro.startsWith(v.schedule.introPlain)).toBe(true);
      expect(v.templateFits.length).toBeGreaterThan(20);
    }
  }, 60_000);

  it("asks to plan again, not to turn on a switch that is on already, for a clip in the bot look", () => {
    const bot = { look: undefined };
    expect(botLookLine(bot, auto)).toBe("crew.botLook");
    expect(botLookLine({ look: "bot" }, { ...auto, ...lookSwitched(auto) })).toBe("crew.botLookPlanAgain");
    expect(botLookLine(bot, { ...auto, ...templateSwitched(auto, "get-out-journey") })).toBe("crew.botLookPlanAgain");
    // a clip in the Simple look gets the clarity lines, whatever the switch shows
    expect(botLookLine({ look: "simple" }, auto)).toBeNull();
    expect(botLookLine({ look: "simple" }, { ...auto, ...lookSwitched(auto) })).toBeNull();
    for (const m of [en, pl, es]) {
      const crew = (m.ViralBot as unknown as { crew: { botLook: string; botLookPlanAgain: string } }).crew;
      expect(crew.botLookPlanAgain.length).toBeGreaterThan(40);
      expect(crew.botLookPlanAgain).not.toMatch(/[{}()]/);
      expect(crew.botLookPlanAgain).not.toBe(crew.botLook);
    }
  });
});

describe("the panel's stored state", () => {
  const options = { copy, locale: "en" as const, family: "all" as const, bucket: "auto" as const, ending: "auto" as const, world, search: false };

  it("loads an older release's state as it was: its options without the new ones, its version-1 plan whole", () => {
    // as this release's panel stored it before the Template choice (the bot look's plans are byte-identical: tests/bot.test.ts)
    const day = planDay(DATE, "reels", 3, options);
    const stored = JSON.parse(json({ options: { platform: "tiktok", count: 4, family: "rhythm", bucket: "short", ending: "resolved" }, plan: { date: day.date, platform: "reels", kind: "today", clips: day.clips } }));
    const state = parseBotState(stored);
    expect(Object.keys(state.options).sort()).toEqual(["bucket", "count", "ending", "family", "platform"]);
    expect(state.options).toEqual({ platform: "tiktok", count: 4, family: "rhythm", bucket: "short", ending: "resolved" });
    expect(state.plan?.kind).toBe("today");
    expect(json(state.plan?.clips)).toBe(json(day.clips));
    expect(state.plan!.clips.every((c) => c.version === 1)).toBe(true);
    expect(Object.keys(defaultBotOptions()).sort()).toEqual(["bucket", "count", "ending", "family", "platform"]);
  });

  it("keeps a template and the Simple look only while they plan, and a template plan round-trips", () => {
    const ready = readyTemplates("default")[0];
    const hidden = allTemplates().find((t) => !t.ready)!;
    expect(parseBotOptions({ template: ready.id, look: "simple" })).toMatchObject({ template: ready.id, look: "simple" });
    for (const raw of [{ template: hidden.id }, { template: "nope" }, { template: 7 }, { look: "bot" }, { look: "neon" }]) {
      const o = parseBotOptions(raw);
      expect("template" in o).toBe(false);
      expect("look" in o).toBe(false);
    }
    expect(storedTemplate(ready.id)).toBe(ready.id);
    expect(storedTemplate(hidden.id)).toBeUndefined();
    const day = planDay(DATE, "shorts", 1, { ...options, template: ready.id, look: "simple" });
    const state = parseBotState(JSON.parse(json({ options: { template: ready.id, look: "simple", family: "all" }, plan: { date: DATE, platform: "shorts", kind: "custom", clips: day.clips } })));
    expect(state.options.template).toBe(ready.id);
    expect(state.options.look).toBe("simple");
    expect(json(state.plan?.clips)).toBe(json(day.clips));
    expect(state.plan!.clips[0].template).toBe(ready.id);
  });
});

describe("the clarity lines of Why this clip", () => {
  const plans: ClipPlan[] = [
    ...planDay(DATE, "reels", 2, { copy, locale: "en", family: "all", world, maxSeeds: 3 }).clips,
    ...planDay(DATE, "tiktok", 2, { copy, locale: "en", family: "all", world, maxSeeds: 3, look: "simple" }).clips,
    ...planDay(DATE, "shorts", 1, { copy, locale: "en", world, maxSeeds: 3, template: "get-out-classic", look: "simple" }).clips,
  ];

  it("follows runSync's run in slices: the same facts, the payoff's moment and the action track included", async () => {
    for (const p of plans.slice(0, 3)) {
      const sync = runSync(p.settings, p.seed, p.world, p.recipe, p.timing.clipSec, p.payoff.atSec);
      const sliced = await runOf(p.settings, p.seed, { ...noPause, world: p.world, recipe: p.recipe, clipSec: p.timing.clipSec, payoffSec: p.payoff.atSec });
      expect(json(sliced)).toBe(json(sync));
      if (p.payoff.atSec !== null) expect(sliced?.moment).toBeDefined();
    }
    const p = plans[0];
    const steps = payoffMomentSteps(p.settings, p.seed, p.world, p.timing.clipSec * 0.8, p.timing.clipSec);
    let yields = 0;
    let next = steps.next();
    for (; !next.done; next = steps.next()) yields++;
    expect(yields).toBeGreaterThan(0);
    expect(json(next.value)).toBe(json(payoffMomentSync(p.settings, p.seed, p.world, p.timing.clipSec * 0.8, p.timing.clipSec)));
    // aborted: nothing
    expect(await planClarity(p, { ...noPause, signal: { aborted: true } })).toBeNull();
  });

  it("are the studio's lines for the same plan: its Simple score, its band and its seven gates before a render", async () => {
    for (const p of plans) {
      const run = runSync(p.settings, p.seed, p.world, p.recipe, p.timing.clipSec, p.payoff.atSec);
      const studio = clarityOf(crewClipOfPlan(p, { run }));
      const lines = (await planClarity(p, noPause))!;
      expect(lines).toEqual(planClarityOf(p, run));
      expect(lines.simple).toBe(studio.simple.score);
      expect(lines.band).toBe(studio.simple.band);
      expect(lines.pass).toBe(studio.pass);
      expect(lines.gates.map((g) => g.id)).toEqual(GATES.slice(0, 7).map((g) => g.id));
      expect(lines.gates.map((g) => [g.ok, g.key])).toEqual(studio.gates.map((g) => [g.ok, g.key]));
    }
    // a Simple template clip reads Simple
    const simple = planClarityOf(plans[4], runSync(plans[4].settings, plans[4].seed, plans[4].world, plans[4].recipe, plans[4].timing.clipSec, plans[4].payoff.atSec));
    expect(simple.simple).toBeGreaterThanOrEqual(80);
    expect(simple.band).toBe("simple");
  }, 60_000);

  // --- bot-templates --- (studio round 1, 3) the default look's clips had shown a green 96-100 with every checklist line ticked and,
  // under it, "Simple score 30-56/100 · Busy" with G6 (and G5's seven words) crossed out: two verdicts at once
  it("judge only a clip in the Simple look, whose rules they are: a clip in the bot's own look gets one neutral line, in en, pl and es", () => {
    expect(plans.map((p) => clarityJudges(p))).toEqual([false, false, true, true, true]);
    expect(clarityJudges({})).toBe(false);
    expect(clarityJudges({ look: "bot" })).toBe(false);
    // (why: the bot's look is busy by design, so its clips would fail the Simple look's G6, or G5, beside their checklist's ticks)
    for (const p of plans.slice(0, 2)) {
      const lines = planClarityOf(p, runSync(p.settings, p.seed, p.world, p.recipe, p.timing.clipSec, p.payoff.atSec));
      expect([p.id, lines.band, lines.gates.some((g) => !g.ok && (g.id === "G5" || g.id === "G6"))]).toEqual([p.id, "busy", true]);
      expect(p.score).toBeGreaterThanOrEqual(75);
    }
    const line = (m: unknown) => (m as { ViralBot: { crew: { botLook?: string; simple: string } } }).ViralBot.crew.botLook ?? "";
    for (const m of [en, pl, es]) {
      expect(line(m).length).toBeGreaterThan(40);
      expect(line(m)).not.toMatch(/[{}()]/);
    }
  }, 60_000);

  it("say every gate and every verdict a plan can show in en, pl and es, with the same arguments", () => {
    const crew = (m: unknown) => (m as { ViralBot: { crew: Record<string, Record<string, string>> } }).ViralBot.crew;
    const args = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
    for (const g of GATES.slice(0, 7)) for (const m of [en, pl, es]) expect(crew(m).gates[g.name], `${g.name}`).toBeTruthy();
    for (const band of ["simple", "aBitBusy", "busy"]) for (const m of [en, pl, es]) expect(crew(m).bands[band]).toBeTruthy();
    // every verdict key the clarity check writes (its source), but a render's (G8, the measured first motion)
    const source = fs.readFileSync(path.join(__dirname, "../src/lib/crew/clarity.ts"), "utf8");
    const verdicts = new Set([...source.matchAll(/key: "([A-Z][A-Za-z]+)"/g)].map((x) => x[1]));
    const renderOnly = new Set(["Lagged", "WatermarkLocal", "MeasuredLate", "None"]);
    const problems = Object.keys(crew(en).problems);
    for (const v of verdicts) {
      if (renderOnly.has(v)) continue;
      expect(problems.some((k) => GATES.some((g) => k === `${g.name}${v}`)), v).toBe(true);
    }
    for (const key of problems) {
      expect(GATES.some((g) => key.startsWith(g.name)), key).toBe(true);
      for (const m of [pl, es]) {
        expect(crew(m).problems[key], key).toBeTruthy();
        expect(args(crew(m).problems[key]), key).toEqual(args(crew(en).problems[key]));
      }
    }
    // and what the plans above show
    for (const p of plans) {
      const lines = planClarityOf(p, runSync(p.settings, p.seed, p.world, p.recipe, p.timing.clipSec, p.payoff.atSec));
      for (const g of lines.gates.filter((x) => !x.ok)) expect(problems, g.key).toContain(g.key);
    }
  }, 60_000);
});

describe("viral-bot CLI --template and --look", () => {
  it("plans a template's clips and the look in a dry run only", () => {
    expect(parseArgs(["--dry-run", "--template", "get-out-classic", "--look", "simple"])).toMatchObject({ dryRun: true, template: "get-out-classic", look: "simple" });
    expect(parseArgs(["--dry-run", "--look=bot"])).toMatchObject({ look: "bot", template: null });
    expect(parseArgs([])).toMatchObject({ template: null, look: null });
    for (const bad of [["--template", "get-out-classic"], ["--look", "simple"], ["--dry-run", "--look", "neon"], ["--dry-run", "--template", "Get Out"], ["--plan", "--template", "get-out-classic"], ["--dry-run", "--template"]]) expect(() => parseArgs(bad), bad.join(" ")).toThrow();
  });

  // --- bot-templates --- (studio round 1, 7) a refusal's advice leads to a command the CLI takes, never to another refusal
  it("refuses --plan with --template or --look by the rotation's own message, whose advice parses", () => {
    for (const bad of [["--plan", "--template", "fill-grow"], ["--plan", "--look", "simple"], ["--plan", "--dry-run", "--template", "fill-grow"], ["--plan", "--dry-run", "--look=bot"]]) {
      expect(() => parseArgs(bad), bad.join(" ")).toThrow(/--plan only prints the rotation.*--dry-run without --plan/);
    }
    expect(() => parseArgs(["--template", "fill-grow"])).toThrow(/add --dry-run/);
    expect(parseArgs(["--dry-run", "--template", "fill-grow"])).toMatchObject({ dryRun: true, plan: false, template: "fill-grow" });
    expect(parseArgs(["--dry-run", "--look", "simple"])).toMatchObject({ dryRun: true, plan: false, look: "simple" });
  });

  it("refuses a template that is unknown, hidden, or of a series --family leaves out (the battle family only with all or battle)", () => {
    const planner = { templateById, readyTemplates };
    const battle = readyTemplates("battle")[0];
    const hidden = allTemplates().find((t) => !t.ready)!;
    expect(templateRefusal(planner, { template: null, family: "default" })).toBeNull();
    expect(templateRefusal(planner, { template: "get-out-classic", family: "default" })).toBeNull();
    expect(templateRefusal(planner, { template: battle.id, family: "default" })).toMatch(/--family all or --family battle/);
    expect(templateRefusal(planner, { template: battle.id, family: "all" })).toBeNull();
    expect(templateRefusal(planner, { template: battle.id, family: "battle" })).toBeNull();
    expect(templateRefusal(planner, { template: hidden.id, family: "all" })).toMatch(/not ready/);
    expect(templateRefusal(planner, { template: "nope", family: "all" })).toMatch(/no template nope/);
  });

  // --- bot-templates --- (studio2 review round 2, 1-3) as the website's selects: a platform, a length or an ending the template does
  // not play is refused with the ones it does, never planned as another without a word
  it("refuses a --platform none of whose lengths the template plays, and a --bucket or an --ending it does not play", () => {
    const planner = { templateById, readyTemplates, templatePlayOf };
    const bracket = "who-wins-fight-league-bracket";
    const base = { family: "all", bucket: "auto", ending: "auto" };
    expect(templateRefusal(planner, { ...base, template: bracket, platform: "shorts" })).toMatch(/plays the long length only, which --platform shorts does not take: use --platform reels or --platform tiktok\.$/);
    expect(templateRefusal(planner, { ...base, template: bracket, platform: "reels" })).toBeNull();
    expect(templateRefusal(planner, { ...base, template: "get-out-journey", platform: "reels", bucket: "long" })).toMatch(/drop --bucket or use --bucket short or --bucket standard\.$/);
    expect(templateRefusal(planner, { ...base, template: "get-out-journey", platform: "reels", ending: "cliffhanger" })).toMatch(/ends resolved only: drop --ending or use --ending resolved\.$/);
    expect(templateRefusal(planner, { ...base, template: "get-out-journey", platform: "shorts", bucket: "short", ending: "resolved" })).toBeNull();
    // every refusal's advice plans: the platforms, lengths and endings it names are the template's own
    for (const t of readyTemplates("all")) {
      const play = templatePlayOf(t.id)!;
      for (const platform of BOT_PLATFORMS) expect([t.id, platform, templateRefusal(planner, { ...base, template: t.id, platform }) === null]).toEqual([t.id, platform, play.platforms.includes(platform)]);
      for (const bucket of LENGTH_BUCKETS) expect([t.id, bucket, templateRefusal(planner, { ...base, template: t.id, platform: play.platforms[0], bucket }) === null]).toEqual([t.id, bucket, play.buckets.includes(bucket)]);
    }
    // a series --family leaves out is still said first
    expect(templateRefusal(planner, { ...base, family: "default", template: bracket, platform: "shorts" })).toMatch(/--family all or --family battle/);
  });

  it("writes a template's clips in a dry run, the very plans of the planner", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "bot-template-"));
    try {
      const env = { ...process.env, NEXT_PUBLIC_SITE_URL: "https://example.com/Balls", IG_ACCESS_TOKEN: "", IG_USER_ID: "" };
      const log = execFileSync(process.execPath, [path.join(__dirname, "../scripts/viral-bot.mjs"), "--dry-run", "--template", "get-out-classic", "--look", "simple", "--count", "2", "--max-seeds", "4", "--date", DATE, "--out", out], { cwd: path.join(__dirname, ".."), env, encoding: "utf8" });
      expect(log).toContain("of the template get-out-classic in the simple look");
      const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
      const day = planDay(DATE, "reels", 2, { copy, locale: "en", family: "default", bucket: "auto", ending: "auto", maxSeeds: 4, siteUrl: "https://example.com/Balls", template: "get-out-classic", look: "simple" });
      expect(manifest.clips.map((c: { recipe: string; seed: number }) => [c.recipe, c.seed])).toEqual(day.clips.map((c) => [c.recipe, c.seed]));
      expect(manifest.clips.every((c: { status: string }) => c.status === "planned")).toBe(true);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
