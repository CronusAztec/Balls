import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import es from "../messages/es.json";
import pl from "../messages/pl.json";
import type { BotCopy } from "@/lib/bot/copy";
import { BOT_PLAN_VERSION, planDay, planDaySteps, templateDaySlots, dayIndexOf, type ClipPlan } from "@/lib/bot/planner";
import { chosenTemplate, defaultBotOptions, lookSwitched, panelLook, panelPlanChoice, parseBotOptions, parseBotState, storedTemplate, templateChoices, templateSwitched } from "@/lib/bot/store";
import { allTemplates, clarityJudges, readyTemplates, templateById } from "@/lib/bot/templates";
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
