import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { recipeById, RECIPES } from "@/lib/bot/playbook";
import { inSafeZone, captionBoxAt, planClip, type ClipPlan, type RunFacts } from "@/lib/bot/planner";
import { BOT_FRAME } from "@/lib/bot/playbook";
import { drawnHookOf, runSync } from "@/lib/insights/score";
import { validateSettingsPatch } from "@/lib/desktop/ai/settingsPatch";
import {
  CLUTTER_KEYS,
  FIX_BOUNDS,
  applyCompiledFix,
  clarityOf,
  clutterOn,
  compileFixes,
  crewClipOfPlan,
  crowding,
  drawnHookText,
  factNumbersOf,
  hookCaptionsOf,
  offValueOf,
  overlaysOf,
  playbookOf,
  shownSecOf,
  type CrewClip,
  type FixAction,
} from "@/lib/crew";

/*
 * --- crew --- The fix compiler (lib/crew/fixes.ts, C3 of the AI studio plan): each of the nine fixes yields a checked change –
 * a settings patch the AI assistant's validator takes, captions rebuilt by the planner's own caption builder, or what the seed
 * search must find – and refuses what it cannot do: a hook with a number the clip does not have, a hook outside the safe zone
 * or past its bounds, a payoff outside 66–90 %, an ending or a length the recipe or the platform does not take, an effect that
 * is off already. A rewritten hook is the drawn one (drawnHookOf), a fix's look and text part re-applies to the clip the seed
 * search returns, and the Playbook score a fixed clip gets is the one scoreClip gives its fields.
 */

const copy = (en as unknown as { ViralBot: Parameters<typeof planClip>[3]["copy"] }).ViralBot;
const runOf = (plan: ClipPlan): RunFacts => runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec);
const withRun = (plan: ClipPlan): CrewClip => crewClipOfPlan(plan, { run: runOf(plan) });

const resolvedPlan = planClip(recipeById("ring-escape")!, 2, "reels", { copy, ending: "resolved", episode: 3 });
const cliffPlan = planClip(recipeById("ring-escape")!, 1, "reels", { copy, ending: "cliffhanger", episode: 3 });
/** Today's bot look: busy (wall glow, colour trail, shake, confetti, the series label on top). */
const busy = withRun(resolvedPlan);
const cliff = withRun(cliffPlan);
const fix = (action: FixAction["action"], extra: Record<string, unknown> = {}) => ({ action, ...extra }) as FixAction;
const apply = (clip: CrewClip, actions: FixAction[]) => {
  const compiled = compileFixes(clip, actions);
  expect(compiled.errors).toEqual([]);
  return { compiled, clip: applyCompiledFix(clip, compiled)! };
};
const roles = (clip: CrewClip, role: string) => clip.captions.filter((_, i) => clip.captionRoles[i] === role);

describe("the look and labels: a patch the settings validator takes", () => {
  it("simplifyLook calms the look and leaves the run alone (no cinematic, no physics)", () => {
    const { compiled, clip } = apply(busy, [fix("simplifyLook")]);
    expect(validateSettingsPatch(busy.settings, compiled.patch).ok).toBe(true);
    expect(Object.keys(compiled.patch).sort()).toEqual(["colorTrail", "screenShake", "showWallGlow", "wallBreakStyle"]);
    expect(compiled.patch).not.toHaveProperty("cinematicEnabled");
    expect(compiled.finder).toBeNull();
    expect(clarityOf(clip).simple.score).toBeGreaterThan(clarityOf(busy).simple.score);
    expect([clip.run, clip.timing, clip.payoff]).toEqual([busy.run, busy.timing, busy.payoff]);
    // a calm look already: nothing to do
    const again = compileFixes(clip, [fix("simplifyLook")]);
    expect([again.ok, again.errors]).toEqual([false, ["simplifyLook: the look is calm already"]]);
  });

  it("simplifyLook switches off the HUDs the clip does not keep", () => {
    const loop: CrewClip = { ...busy, settings: { ...busy.settings, loopHud: true } };
    expect(compileFixes(loop, [fix("simplifyLook")]).patch).toMatchObject({ loopHud: false });
    expect(compileFixes(loop, [fix("simplifyLook")], { simple: { keepHuds: ["loopHud"] } }).patch).not.toHaveProperty("loopHud");
  });

  it("turnOff switches one clutter key off; an effect off already, or anything else, is refused", () => {
    const { compiled, clip } = apply(busy, [fix("turnOff", { key: "colorTrail" })]);
    expect(compiled.patch).toEqual({ colorTrail: false });
    expect(clip.settings.colorTrail).toBe(false);
    expect(compileFixes(clip, [fix("turnOff", { key: "colorTrail" })]).errors).toEqual(["turnOff: colorTrail is off already"]);
    expect(compileFixes(busy, [fix("turnOff", { key: "gravity" })]).errors).toEqual(["turnOff: gravity is not an effect, HUD or label"]);
    expect(apply(busy, [fix("turnOff", { key: "topText" })]).compiled.patch).toEqual({ topText: "" });
    // every key that is on has its off value, and the validator takes it
    for (const key of clutterOn(busy.settings)) {
      expect([key, CLUTTER_KEYS.includes(key)]).toEqual([key, true]);
      expect([key, validateSettingsPatch(busy.settings, { [key]: offValueOf(key, busy.settings) }).ok]).toEqual([key, true]);
    }
  });

  it("turnOff of the cinematic camera, which moves the run, asks the seed search to run it again", () => {
    expect(busy.settings.cinematicEnabled).toBe(true);
    const compiled = compileFixes(busy, [fix("turnOff", { key: "cinematicEnabled" })]);
    expect(compiled.ok).toBe(true);
    expect(compiled.finder).toEqual({ ending: busy.ending, bucket: busy.bucket, targetPos: null, firstImpactMaxSec: null, settings: { cinematicEnabled: false }, actions: ["turnOff"] });
  });
});

describe("the text", () => {
  it("oneTextAtATime: no series line, the counter after the hook and gone at the payoff, one message at a time", () => {
    const { compiled, clip } = apply(busy, [fix("oneTextAtATime")]);
    expect(compiled.patch).toEqual({ topText: "" });
    const hookEnd = Math.max(...roles(busy, "hook").map((c) => c.end));
    const payoff = Math.min(...roles(busy, "payoff").map((c) => c.start));
    const counter = roles(clip, "countdown")[0];
    expect([counter.start, counter.end]).toEqual([hookEnd, payoff]);
    expect(crowding(overlaysOf(clip), shownSecOf(clip)).most).toBe(1);
    expect(clarityOf(clip).simple.score).toBeGreaterThan(clarityOf(busy).simple.score);
    expect(compileFixes(clip, [fix("oneTextAtATime")]).errors).toEqual(["oneTextAtATime: one text at a time already"]);
  });

  it("oneTextAtATime drops a counter caption beside a HUD that counts down", () => {
    const hudCounts: CrewClip = { ...busy, settings: { ...busy.settings, mode: "powerLayers" } };
    const { clip } = apply(hudCounts, [fix("oneTextAtATime")]);
    expect(roles(clip, "countdown")).toEqual([]);
  });

  it("dropCountdownCaption removes the counter caption, and is refused without one", () => {
    const { clip } = apply(busy, [fix("dropCountdownCaption")]);
    expect(roles(clip, "countdown")).toEqual([]);
    expect(clip.captions.length).toBe(busy.captions.length - roles(busy, "countdown").length);
    expect(compileFixes(clip, [fix("dropCountdownCaption")]).errors).toEqual(["dropCountdownCaption: no countdown caption"]);
  });

  it("rewriteHook draws the new hook through the planner's caption builder: it is the drawn hook and the clip's meta hook", () => {
    const n = busy.timing.recordingDuration;
    const text = `Out in ${n} seconds?`;
    const { compiled, clip } = apply(busy, [fix("rewriteHook", { text })]);
    expect(compiled.hook).toBe(text);
    expect(clip.hook).toBe(text);
    expect(drawnHookText(clip)).toBe(text);
    expect(drawnHookOf(clip.settings, clip.timing.clipSec)).toBe(text);
    const hookEnd = Math.max(...roles(busy, "hook").map((c) => c.end));
    expect(roles(clip, "hook")).toEqual(hookCaptionsOf(text, hookEnd, busy.timing.recordingDuration));
    // every line in the safe zone, the rest of the captions as they were
    clip.captions.forEach((_, i) => {
      if (clip.captionRoles[i] !== "hook") return;
      const box = captionBoxAt(clip.captions, i, 0.1, BOT_FRAME, !!clip.topText.trim(), false);
      expect(!!box && inSafeZone(box)).toBe(true);
    });
    expect(clip.captions.filter((_, i) => clip.captionRoles[i] !== "hook")).toEqual(busy.captions.filter((_, i) => busy.captionRoles[i] !== "hook"));
    expect(clarityOf(clip).gates.find((g) => g.id === "G4")!.ok).toBe(true);
  });

  it("rewriteHook refuses a number the clip does not have, a hook past 7 words or 42 characters, and one outside the safe zone", () => {
    expect(factNumbersOf(busy)).not.toContain(99);
    expect(compileFixes(busy, [fix("rewriteHook", { text: "Out in 99 seconds?" })]).errors[0]).toMatch(/^rewriteHook: 99 is not a number this clip has/);
    expect(compileFixes(busy, [fix("rewriteHook", { text: "one two three four five six seven eight" })]).errors).toEqual(["rewriteHook: at most 7 words (got 8)"]);
    expect(compileFixes(busy, [fix("rewriteHook", { text: "x".repeat(FIX_BOUNDS.hookChars + 5) })]).errors).toContain(`rewriteHook: at most ${FIX_BOUNDS.hookChars} characters`);
    expect(compileFixes(busy, [fix("rewriteHook", { text: "W".repeat(FIX_BOUNDS.hookChars) })]).errors).toEqual(["rewriteHook: a line of it falls outside the safe zone"]);
    expect(compileFixes(busy, [fix("rewriteHook", { text: "   " })]).errors).toEqual(["rewriteHook: an empty hook"]);
  });
});

describe("the seed and the length: what the seed search must find", () => {
  it("retimePayoff stays within 66-90 % and never on a cliffhanger", () => {
    expect(compileFixes(busy, [fix("retimePayoff", { targetPos: 0.8 })]).finder).toMatchObject({ targetPos: 0.8, actions: ["retimePayoff"] });
    expect(compileFixes(busy, [fix("retimePayoff", { targetPos: 0.66 })]).ok).toBe(true);
    expect(compileFixes(busy, [fix("retimePayoff", { targetPos: 0.9 })]).ok).toBe(true);
    for (const targetPos of [0.5, 0.65, 0.91, 1]) expect([targetPos, compileFixes(busy, [fix("retimePayoff", { targetPos })]).ok]).toEqual([targetPos, false]);
    expect(compileFixes(cliff, [fix("retimePayoff", { targetPos: 0.85 })]).errors).toEqual(["retimePayoff: a cliffhanger's payoff comes after its cut"]);
    // (with the switch to a resolved ending in the same round it may)
    expect(compileFixes(cliff, [fix("switchEnding", { ending: "resolved" }), fix("retimePayoff", { targetPos: 0.85 })]).finder).toMatchObject({ ending: "resolved", targetPos: 0.85 });
  });

  it("reseedEarlyMotion asks for a first impact within the first second", () => {
    expect(compileFixes(busy, [fix("reseedEarlyMotion")]).finder).toEqual({ ending: busy.ending, bucket: busy.bucket, targetPos: null, firstImpactMaxSec: 1, settings: {}, actions: ["reseedEarlyMotion"] });
  });

  it("switchEnding and changeLength take only what the recipe and the platform take", () => {
    expect(compileFixes(busy, [fix("switchEnding", { ending: "cliffhanger" })]).finder).toMatchObject({ ending: "cliffhanger" });
    expect(compileFixes(busy, [fix("switchEnding", { ending: "resolved" })]).errors).toEqual(["switchEnding: the clip is resolved already"]);
    const territory = crewClipOfPlan(planClip(recipeById("territory")!, 1, "reels", { copy, ending: "resolved", search: false }));
    expect(recipeById("territory")!.endings).toEqual(["resolved"]);
    expect(compileFixes({ ...territory, ending: "resolved" }, [fix("switchEnding", { ending: "cliffhanger" })]).errors).toEqual(["switchEnding: territory takes only resolved"]);
    expect(compileFixes(busy, [fix("changeLength", { bucket: "short" })]).finder).toMatchObject({ bucket: "short" });
    expect(compileFixes(busy, [fix("changeLength", { bucket: busy.bucket })]).ok).toBe(false);
    expect(compileFixes({ ...busy, platform: "shorts", bucket: "short" }, [fix("changeLength", { bucket: "long" })]).errors).toEqual(["changeLength: shorts takes short, standard"]);
  });
});

describe("a round of fixes", () => {
  it("takes at most three, each once (a turnOff once per key)", () => {
    expect(compileFixes(busy, [fix("simplifyLook"), fix("oneTextAtATime"), fix("dropCountdownCaption"), fix("reseedEarlyMotion")]).errors).toEqual(["at most 3 fixes"]);
    expect(compileFixes(busy, [fix("simplifyLook"), fix("simplifyLook")]).errors).toEqual(["simplifyLook: once in a round"]);
    expect(compileFixes(busy, [fix("turnOff", { key: "colorTrail" }), fix("turnOff", { key: "colorTrail" })]).errors).toEqual(["turnOff: once in a round"]);
    expect(compileFixes(busy, [fix("turnOff", { key: "colorTrail" }), fix("turnOff", { key: "showWallGlow" })]).ok).toBe(true);
    expect(compileFixes(busy, [{ action: "makeItPop" } as unknown as FixAction]).errors).toEqual(["fixes[0]: not a fix"]);
  });

  it("composes: the calm look and one text at a time pass every gate on today's bot clip", () => {
    const { compiled, clip } = apply(busy, [fix("simplifyLook"), fix("oneTextAtATime")]);
    expect(compiled.ok).toBe(true);
    expect(clarityOf(busy).pass).toBe(false);
    expect(clarityOf(clip).pass).toBe(true);
    expect(clarityOf(clip).simple.score).toBeGreaterThanOrEqual(80);
  });

  it("re-applies its look and text to the clip the seed search returns (here: the cliffhanger the switch asked for)", () => {
    const actions = [fix("switchEnding", { ending: "cliffhanger" }), fix("simplifyLook"), fix("rewriteHook", { text: "Will it get out?" })];
    const compiled = compileFixes(busy, actions);
    expect(compiled.finder).toMatchObject({ ending: "cliffhanger", actions: ["switchEnding"] });
    const replanned = applyCompiledFix(cliff, compiled)!;
    expect(replanned.ending).toBe("cliffhanger");
    expect(replanned.settings.colorTrail).toBe(false);
    expect(drawnHookText(replanned)).toBe("Will it get out?");
    expect(roles(replanned, "question").length).toBeGreaterThan(0);
  });

  it("is deterministic: the same fix on the same clip, the same change to the byte", () => {
    const actions = [fix("simplifyLook"), fix("rewriteHook", { text: "Will it get out?" })];
    expect(JSON.stringify(applyCompiledFix(busy, compileFixes(busy, actions)))).toBe(JSON.stringify(applyCompiledFix(withRun(resolvedPlan), compileFixes(withRun(resolvedPlan), actions))));
  });
});

describe("the Playbook score of a fixed clip", () => {
  it("is scoreClip's on the clip's own fields: a plan's clip scores as its plan did, for every recipe", () => {
    for (const recipe of RECIPES) {
      for (const ending of ["resolved", "cliffhanger"] as const) {
        const plan = planClip(recipe, 1, "reels", { copy, ending, episode: 3, search: false });
        expect([recipe.id, ending, playbookOf(crewClipOfPlan(plan))]).toEqual([recipe.id, ending, { score: plan.score, reasons: plan.reasons }]);
      }
    }
  });

  it("follows the fix: without its series line the clip loses its series points, with a calm look it keeps its look points", () => {
    const { clip } = apply(busy, [fix("simplifyLook"), fix("oneTextAtATime")]);
    const item = (c: CrewClip, id: string) => c.playbook.reasons.find((r) => r.id === id)!;
    expect(item(busy, "series").points - item(clip, "series").points).toBe(4);
    expect(item(clip, "look").points).toBe(item(busy, "look").points);
    expect(clip.playbook.score).toBe(busy.playbook.score - 4);
  });
});
