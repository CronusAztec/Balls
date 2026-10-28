import { sanitizeCaptionText, type Caption } from "@/lib/captions";
import { BOT_FRAME, HOOK_SEC, PLATFORMS, TOP_HUD_MODES, type BotRecipe, type EndingStyle, type LengthBucket } from "@/lib/bot/playbook";
import { botRecipeById } from "@/lib/bot/templates";
import { captionBoxAt, captionsAtEdge, captionWordsOf, clipCaptions, inSafeZone, placeSimpleTexts, scoreClip, type CaptionRole, type ClipPlan, type ClipTiming, type ScoreReason } from "@/lib/bot/planner";
import { isActionTrack } from "@/lib/bot/actionTrack"; // --- templates --- (where the run moves)
import { scorePlanLike, type ScorePlan } from "@/lib/insights/score";
import { validateSettingsPatch } from "@/lib/desktop/ai/settingsPatch";
import type { SimulatorSettings } from "@/lib/settings";
import { CLARITY } from "./clarity";
import { factNumbersOf, numbersIn, type CrewClip } from "./clip";
import { defaultKeptHuds, hudCounts, hudsOn } from "./hudFlags";
import { overlaysOf, SIMPLE_TRAIL_THICKNESS, simpleScore, wordCount, type SimpleOptions } from "./simplicity";
import { CLUTTER_KEYS, FIX_ACTIONS, FIX_BOUNDS, RUN_MOVING_KEYS, type FixAction, type FixId } from "./roles";

/*
 * --- crew --- The fix compiler: the reviewer's fixes (roles.ts FIX_ACTIONS, a fixed list of nine) turned into changes the rules
 * can measure again – never anything else a model writes.
 *
 *  - Look and labels (simplifyLook, turnOff): a settings patch, checked by the AI assistant's own validator
 *    (lib/desktop/ai/settingsPatch.ts validateSettingsPatch: known settings, valid values, the settings loader's last word).
 *  - Text (oneTextAtATime, dropCountdownCaption, rewriteHook): the captions rebuilt – one text at a time, each at the edge of the
 *    square its run leaves clear where the run's action track is known (planner.ts placeSimpleTexts, as the Simple look plans
 *    it), a rewritten hook where the old one was. A new hook is drawn through the planner's own caption builder
 *    (lib/bot/planner.ts clipCaptions: the Simple look's line breaks and its hook style), its invisible format characters
 *    out (visibleText), refused when it has no word to read, more than 7 words or 42 characters, a number the clip does not
 *    have (clip.ts factNumbersOf), or a line outside the safe zone; the clip's meta hook becomes the drawn one, so the words and
 *    the picture agree (gate G4).
 *  - Seed and length (retimePayoff, reseedEarlyMotion, switchEnding, changeLength, and turnOff of a setting that moves the run,
 *    roles.ts RUN_MOVING_KEYS): a FinderNeed the caller hands to the planner's seed search – the crew runs no engine – and the
 *    look and text part is applied to the clip the search returns (applyCompiledFix).
 *
 * compileFixes checks a list of at most three on the clip (each once, a turnOff once per key) and says what it needs;
 * applyCompiledFix applies the look and text part to a clip (the original, or the one the seed search re-planned) and scores
 * it again (playbookOf: the Playbook score from the clip's own fields). Whether a fix helped is the panel's call (panel.ts: a
 * fix that makes a gate fail or lowers the pick score is reverted). Pure and deterministic: a fix replays from (clip, action).
 */

// --- crew ---

/** What a fix needs of the planner's seed search: the caller re-plans the clip with it (the crew runs no engine). */
export interface FinderNeed {
  /** The ending the new seed must play (switchEnding), else the clip's. */
  ending: EndingStyle;
  /** The length bucket (changeLength), else the clip's. */
  bucket: LengthBucket;
  /** The payoff's share of the clip (retimePayoff, 0.66–0.9), null: the planner's own band. */
  targetPos: number | null;
  /** The first impact at most this (s, reseedEarlyMotion), null: the planner's own rule. */
  firstImpactMaxSec: number | null;
  /** Settings that change the run, set before the seed is run again (turnOff of a RUN_MOVING_KEYS setting); {} for none. */
  settings: Partial<SimulatorSettings>;
  /** The fixes that need it. */
  actions: FixId[];
}

export interface CompiledFix {
  ok: boolean;
  actions: FixAction[];
  /** The checked settings patch of the look and labels (validateSettingsPatch's values); {} for none. */
  patch: Partial<SimulatorSettings>;
  /** The new hook (rewriteHook), null: unchanged. */
  hook: string | null;
  /** The seed search's part, null: none (the fix applies to the clip as it is). */
  finder: FinderNeed | null;
  errors: string[];
}

export interface FixOptions {
  /** The clip's Simple options (the HUDs its template keeps: simplifyLook leaves them on). */
  simple?: SimpleOptions;
}

const EPS = 1e-9;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** The hook's default end when it had none of its own (s): the middle of the playbook's 2–3 s. */
const HOOK_END_SEC = (HOOK_SEC.min + HOOK_SEC.max) / 2;

/**
 * The format characters a hook may not carry (Unicode Cf: zero-width spaces, word joiners, soft hyphens, bidi overrides and
 * isolates…): drawn, they show nothing, or turn the line around. A zero-width joiner between two emoji stays (it builds one).
 */
const INVISIBLE = /(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f])\u200d|\u200d(?!\p{Extended_Pictographic})|(?!\u200d)\p{Cf}/gu;
/** A text as a viewer reads it: the invisible format characters out (INVISIBLE), the spaces collapsed. */
export function visibleText(text: string): string {
  return text.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/**
 * The value that switches a clutter setting off, or null when it is off already: a flag false, the shake 0, trails thin,
 * sparks for confetti, a shatter for a confetti wall break, no Power Layers badge, an empty label line.
 */
export function offValueOf(key: string, s: SimulatorSettings): unknown {
  const value = (s as unknown as Record<string, unknown>)[key];
  switch (key) {
    case "screenShake":
      return typeof value === "number" && value > 0 ? 0 : null;
    case "trailThickness":
      return s.showTrails && typeof value === "number" && value > SIMPLE_TRAIL_THICKNESS + EPS ? SIMPLE_TRAIL_THICKNESS : null;
    case "particleStyle":
      return value === "confetti" ? "sparks" : null;
    case "wallBreakStyle":
      return value === "confetti" || value === "all" ? "shatter" : null;
    case "plBadge":
      return value !== "none" ? "none" : null;
    case "topText":
    case "bottomText":
      return typeof value === "string" && value.trim() ? "" : null;
    default:
      return value === true ? false : null;
  }
}

/** A clip with one clutter setting switched to `value` (the Top and Bottom Text in the clip's copy too). */
function withSetting(clip: CrewClip, key: string, value: unknown): CrewClip {
  return { ...clip, settings: { ...clip.settings, [key]: value }, topText: key === "topText" && typeof value === "string" ? value : clip.topText, bottomText: key === "bottomText" && typeof value === "string" ? value : clip.bottomText };
}

/** What the rules see of a clip's clutter: its Simple deductions and the messages on screen (simplicity.ts). */
function clutterSeen(clip: CrewClip, simple: SimpleOptions = {}): string {
  return JSON.stringify([simpleScore(clip, simple).deductions, overlaysOf(clip)]);
}

/**
 * The clutter keys this clip draws (what turnOff may name for it): on in its settings, and drawn – switched off, they change the
 * messages on screen or the Simple score. So a HUD flag counts only in its own modes and while its own rule shows it (hudsOn),
 * a wall effect only where the mode has ring walls, a trail effect only with trails on, a label line only with words in it.
 */
export function clutterOn(clip: CrewClip, options: FixOptions = {}): (keyof SimulatorSettings & string)[] {
  const seen = clutterSeen(clip, options.simple);
  return CLUTTER_KEYS.filter((k) => {
    const off = offValueOf(k, clip.settings);
    return off !== null && clutterSeen(withSetting(clip, k, off), options.simple) !== seen;
  });
}

/** The calm look of simplifyLook: every charged effect off, thin trails, and the HUD flags the clip does not keep. */
function simplerLook(clip: CrewClip, options: FixOptions): Partial<SimulatorSettings> {
  const s = clip.settings;
  const look: Record<string, unknown> = {};
  for (const key of ["showWallGlow", "colorTrail", "rainbowWalls", "rainbowBall", "reactiveBackground", "screenShake", "trailThickness", "particleStyle", "wallBreakStyle"]) {
    const off = offValueOf(key, s);
    if (off !== null) look[key] = off;
  }
  const kept = new Set(options.simple?.keepHuds ?? defaultKeptHuds(s, clip.countdown?.source ?? null));
  for (const h of hudsOn(s)) {
    if (!h.flag || !h.costs || kept.has(h.id)) continue;
    const off = offValueOf(h.id, s);
    if (off !== null) look[h.id] = off;
  }
  return look as Partial<SimulatorSettings>;
}

/** A clip with new captions (and their roles), the settings' copy kept in step. */
function withCaptions(clip: CrewClip, captions: Caption[], roles: CaptionRole[]): CrewClip {
  return { ...clip, captions, captionRoles: roles, settings: { ...clip.settings, captions } };
}

/** The window of the hook captions: [0, end], end their own (the latest), or HOOK_END_SEC when one of them stays on. */
function hookEndOf(clip: CrewClip): { end: number } {
  const hooks = clip.captions.filter((_, i) => clip.captionRoles[i] === "hook");
  if (hooks.length === 0) return { end: HOOK_END_SEC };
  return { end: hooks.some((c) => !(c.end > c.start)) ? HOOK_END_SEC : Math.max(...hooks.map((c) => c.end)) };
}

/**
 * The planner's hook captions of a text (clipCaptions: the Simple look's line breaks – --- templates --- at a clause, else even –,
 * two lines at most, its hook style), from 0 to `endSec`, at the top of the square or (`position`, a hook the Simple look put
 * there) at its bottom, stacked as the canvas reads that edge (planner.ts captionsAtEdge).
 */
export function hookCaptionsOf(text: string, endSec: number, recordingDuration: number, position: "top" | "bottom" = "top"): Caption[] {
  // a recipe that draws no counter and a run with no payoff: clipCaptions gives the hook lines alone
  const stub = { countdown: { kind: "walls", source: "hud" }, copyKey: "" } as unknown as BotRecipe;
  const timing: ClipTiming = { payoffSec: null, recordingDuration, clipSec: recordingDuration, position: null, cutGapSec: null, accepted: true };
  const { captions, roles } = clipCaptions(stub, {}, text, {}, timing, "resolved", endSec, "payoff", "oneLine");
  const lines = captions.filter((_, i) => roles[i] === "hook");
  return position === "bottom" ? captionsAtEdge(lines, lines.map((_, i) => i), "bottom") : lines;
}

/** --- templates --- The edge of the square a clip's hook is at (its first line's): the bottom where the Simple look put it there. */
export function hookEdgeOf(clip: Pick<CrewClip, "captions" | "captionRoles">): "top" | "bottom" {
  return clip.captions.find((_, i) => clip.captionRoles[i] === "hook")?.position === "bottom" ? "bottom" : "top";
}

/** Whether every caption in `indices` sits in the safe zone at time `t` (as the clarity check's G5 and scoreClip look). */
function captionsSafe(clip: CrewClip, indices: readonly number[], t: number): boolean {
  const topText = !!clip.topText.trim();
  const topHud = TOP_HUD_MODES.includes(clip.settings.mode);
  return indices.every((i) => {
    const box = captionBoxAt(clip.captions, i, t, BOT_FRAME, topText, topHud);
    return !box || inSafeZone(box);
  });
}

interface Applied {
  clip: CrewClip;
  patch: Record<string, unknown>;
  hook: string | null;
  need: FinderNeed | null;
  errors: string[];
}

/** The actions on a clip in order (see the header); the finder's part is collected, not run. */
function applyActions(start: CrewClip, actions: readonly FixAction[], options: FixOptions, collectNeed: boolean): Applied {
  let clip = start;
  const patch: Record<string, unknown> = {};
  let hook: string | null = null;
  let need: FinderNeed | null = null;
  const errors: string[] = [];
  const setLook = (look: Record<string, unknown>) => {
    Object.assign(patch, look);
    clip = { ...clip, settings: { ...clip.settings, ...look }, topText: typeof look.topText === "string" ? look.topText : clip.topText, bottomText: typeof look.bottomText === "string" ? look.bottomText : clip.bottomText };
  };
  const needOf = (): FinderNeed => (need ??= { ending: clip.ending, bucket: clip.bucket, targetPos: null, firstImpactMaxSec: null, settings: {}, actions: [] });
  const recipe = botRecipeById(clip.recipe) ?? null;

  for (const a of actions) {
    switch (a.action) {
      case "simplifyLook": {
        const look = simplerLook(clip, options);
        if (Object.keys(look).length === 0) errors.push("simplifyLook: the look is calm already");
        else setLook(look);
        break;
      }
      case "turnOff": {
        if (!CLUTTER_KEYS.includes(a.key as (typeof CLUTTER_KEYS)[number])) {
          errors.push(`turnOff: ${a.key} is not an effect, HUD or label`);
          break;
        }
        const off = offValueOf(a.key, clip.settings);
        if (off === null) {
          errors.push(`turnOff: ${a.key} is off already`);
          break;
        }
        // (on in the settings, but not drawn here: another mode's HUD, a wall effect without ring walls – a fix that changes nothing)
        if (clutterSeen(withSetting(clip, a.key, off), options.simple) === clutterSeen(clip, options.simple)) {
          errors.push(`turnOff: ${a.key} changes nothing on screen in this clip`);
          break;
        }
        if (RUN_MOVING_KEYS.includes(a.key)) {
          // (it moves the run: the seed is run again with it off, before the rest applies)
          if (collectNeed) {
            const n = needOf();
            n.settings = { ...n.settings, [a.key]: off };
            n.actions.push("turnOff");
          }
          clip = { ...clip, settings: { ...clip.settings, [a.key]: off } };
          patch[a.key] = off;
        } else setLook({ [a.key]: off });
        break;
      }
      case "oneTextAtATime": {
        const before = JSON.stringify([clip.captions, clip.captionRoles, clip.topText, clip.bottomText]);
        const labels: Record<string, unknown> = {};
        if (clip.topText.trim()) labels.topText = "";
        if (clip.bottomText.trim()) labels.bottomText = "";
        if (Object.keys(labels).length) setLook(labels);
        const { end: hookEnd } = hookEndOf(clip);
        const counts = hudCounts(clip.settings);
        const firstAfter = clip.captions
          .filter((c, i) => (clip.captionRoles[i] === "payoff" || clip.captionRoles[i] === "question") && c.start >= hookEnd - EPS)
          .map((c) => c.start)
          .sort((x, y) => x - y)[0];
        const captions: Caption[] = [];
        const roles: CaptionRole[] = [];
        clip.captions.forEach((c, i) => {
          const role = clip.captionRoles[i];
          if (role === "hook") {
            captions.push(c.end > c.start ? c : { ...c, end: hookEnd });
          } else if (role === "countdown") {
            // (a HUD that counts down already counts: no caption beside it)
            if (counts) return;
            const end = firstAfter !== undefined && firstAfter > hookEnd + EPS ? firstAfter : 0;
            captions.push({ ...c, start: Math.max(c.start, hookEnd), end });
          } else captions.push(c.start < hookEnd - EPS ? { ...c, start: hookEnd } : c);
          roles.push(role);
        });
        // --- templates --- (the Simple look's text plan) each text at the edge of the square its run leaves clear
        const track = clip.run?.action;
        clip = withCaptions(clip, isActionTrack(track) ? placeSimpleTexts(captions, roles, track, clip.settings, clip.timing.clipSec) : captions, roles);
        if (JSON.stringify([clip.captions, clip.captionRoles, clip.topText, clip.bottomText]) === before) errors.push("oneTextAtATime: one text at a time already");
        break;
      }
      case "dropCountdownCaption": {
        const keep = clip.captionRoles.map((r) => r !== "countdown");
        if (keep.every(Boolean)) {
          errors.push("dropCountdownCaption: no countdown caption");
          break;
        }
        clip = withCaptions(
          clip,
          clip.captions.filter((_, i) => keep[i]),
          clip.captionRoles.filter((_, i) => keep[i]),
        );
        break;
      }
      case "rewriteHook": {
        const text = visibleText(sanitizeCaptionText(a.text, FIX_BOUNDS.hookChars + 1));
        if (!text) {
          errors.push("rewriteHook: an empty hook");
          break;
        }
        if (wordCount(text) < 1) {
          errors.push("rewriteHook: no word to read (a hook needs a letter or a digit)");
          break;
        }
        if (Array.from(text).length > FIX_BOUNDS.hookChars) errors.push(`rewriteHook: at most ${FIX_BOUNDS.hookChars} characters`);
        if (wordCount(text) > FIX_BOUNDS.hookWords) errors.push(`rewriteHook: at most ${FIX_BOUNDS.hookWords} words (got ${wordCount(text)})`);
        const facts = factNumbersOf(clip);
        const untrue = numbersIn(text).filter((n) => !facts.some((f) => Math.abs(f - n) < 1e-6));
        if (untrue.length) errors.push(`rewriteHook: ${untrue[0]} is not a number this clip has (${facts.join(", ")})`);
        if (errors.some((e) => e.startsWith("rewriteHook"))) break;
        const { end } = hookEndOf(clip);
        const lines = hookCaptionsOf(text, end, clip.timing.recordingDuration, hookEdgeOf(clip)); // --- templates --- (where the hook was)
        if (captionWordsOf(lines, lines.map((_, k) => k)) !== text) {
          errors.push("rewriteHook: it does not fit in two lines");
          break;
        }
        const at = clip.captionRoles.indexOf("hook");
        const keep = clip.captionRoles.map((r) => r !== "hook");
        const restCaps = clip.captions.filter((_, i) => keep[i]);
        const restRoles = clip.captionRoles.filter((_, i) => keep[i]);
        const insert = at < 0 ? 0 : clip.captionRoles.slice(0, at).filter((r) => r !== "hook").length;
        const captions = [...restCaps.slice(0, insert), ...lines, ...restCaps.slice(insert)];
        const roles: CaptionRole[] = [...restRoles.slice(0, insert), ...lines.map(() => "hook" as const), ...restRoles.slice(insert)];
        const next = withCaptions(clip, captions, roles);
        if (!captionsSafe(next, lines.map((_, k) => insert + k), 0.1)) {
          errors.push("rewriteHook: a line of it falls outside the safe zone");
          break;
        }
        clip = { ...next, hook: text };
        hook = text;
        break;
      }
      case "retimePayoff": {
        if (!(a.targetPos >= FIX_BOUNDS.retimeFrom - EPS && a.targetPos <= FIX_BOUNDS.retimeTo + EPS)) errors.push(`retimePayoff: targetPos ${a.targetPos} is outside ${FIX_BOUNDS.retimeFrom}-${FIX_BOUNDS.retimeTo}`);
        else if (clip.ending === "cliffhanger" && !actions.some((x) => x.action === "switchEnding" && x.ending === "resolved")) errors.push("retimePayoff: a cliffhanger's payoff comes after its cut");
        else if (collectNeed) {
          const n = needOf();
          n.targetPos = a.targetPos;
          n.actions.push("retimePayoff");
        }
        break;
      }
      case "reseedEarlyMotion": {
        if (collectNeed) {
          const n = needOf();
          n.firstImpactMaxSec = CLARITY.firstImpactSec;
          n.actions.push("reseedEarlyMotion");
        }
        break;
      }
      case "switchEnding": {
        if (a.ending === start.ending) errors.push(`switchEnding: the clip is ${a.ending} already`);
        else if (recipe?.endings && !recipe.endings.includes(a.ending)) errors.push(`switchEnding: ${recipe.id} takes only ${recipe.endings.join(", ")}`);
        else if (collectNeed) {
          const n = needOf();
          n.ending = a.ending;
          n.actions.push("switchEnding");
        }
        break;
      }
      case "changeLength": {
        if (a.bucket === start.bucket) errors.push(`changeLength: the clip is ${a.bucket} already`);
        else if (!PLATFORMS[start.platform].buckets.includes(a.bucket)) errors.push(`changeLength: ${start.platform} takes ${PLATFORMS[start.platform].buckets.join(", ")}`);
        else if (recipe?.buckets && !recipe.buckets.includes(a.bucket)) errors.push(`changeLength: ${recipe.id} takes ${recipe.buckets.join(", ")}`);
        else if (collectNeed) {
          const n = needOf();
          n.bucket = a.bucket;
          n.actions.push("changeLength");
        }
        break;
      }
      default:
        errors.push(`${(a as { action: string }).action}: not a fix`);
    }
  }
  return { clip, patch, hook, need, errors };
}

/** The structural problems of a list of fixes: at most three, known actions, each once (a turnOff once per key). */
function listProblems(actions: readonly FixAction[]): string[] {
  const errors: string[] = [];
  if (actions.length > FIX_BOUNDS.maxFixes) errors.push(`at most ${FIX_BOUNDS.maxFixes} fixes`);
  actions.forEach((a, i) => {
    if (!a || typeof a !== "object" || !Object.hasOwn(FIX_ACTIONS, a.action)) errors.push(`fixes[${i}]: not a fix`);
    else if (actions.slice(0, i).some((b) => b.action === a.action && (a.action !== "turnOff" || same(a, b)))) errors.push(`${a.action}: once in a round`);
  });
  return errors;
}

/** Compiles a list of fixes on a clip (see the header): what it changes, what it needs of the seed search, or why not. */
export function compileFixes(clip: CrewClip, actions: readonly FixAction[], options: FixOptions = {}): CompiledFix {
  const problems = listProblems(actions);
  if (problems.length) return { ok: false, actions: [...actions], patch: {}, hook: null, finder: null, errors: problems };
  const applied = applyActions(clip, actions, options, true);
  const errors = [...applied.errors];
  let patch: Partial<SimulatorSettings> = {};
  if (Object.keys(applied.patch).length) {
    const checked = validateSettingsPatch(clip.settings, applied.patch);
    if (checked.ok) patch = checked.patch;
    else errors.push(...checked.errors.map((e) => `settings: ${e}`));
  }
  return { ok: errors.length === 0, actions: [...actions], patch, hook: applied.hook, finder: errors.length ? null : applied.need, errors };
}

/**
 * The look and text part of a compiled fix applied to a clip – the original when the fix needs no seed search, else the clip
 * the search re-planned – scored again; null when it no longer applies there (a hook that no longer fits, a look calm already).
 */
export function applyCompiledFix(clip: CrewClip, fix: CompiledFix, options: FixOptions = {}): CrewClip | null {
  if (!fix.ok) return null;
  // (the finder's actions were the search's job; a run-moving turnOff is in the re-planned settings already)
  const rest = fix.actions.filter((a) => !FIX_ACTIONS[a.action].finder && !(a.action === "turnOff" && RUN_MOVING_KEYS.includes(a.key) && fix.finder));
  const applied = applyActions(clip, rest, options, false);
  if (applied.errors.length) return null;
  if (Object.keys(applied.patch).length && !validateSettingsPatch(clip.settings, applied.patch).ok) return null;
  return { ...applied.clip, playbook: playbookOf(applied.clip) };
}

/**
 * The Playbook score of a clip from its own fields (scoreClip reads a plan's ScorePlan fields alone, so a plan's clip scores
 * as its plan did; a saved clip as lib/insights/score.ts scorePlanLike scores it). The melody is the clip's score's own (its
 * sound item names it), since a clip does not keep its melody id.
 */
export function playbookOf(clip: CrewClip): { score: number; reasons: ScoreReason[] } {
  const sound = clip.playbook.reasons.find((r) => r.id === "sound");
  const melody = typeof sound?.values.melody === "string" && sound.values.melody ? sound.values.melody : null;
  const plan: ScorePlan = {
    settings: { ...clip.settings, captions: clip.captions, topText: clip.topText, bottomText: clip.bottomText },
    recipe: clip.recipe ?? "",
    platform: clip.platform,
    bucket: clip.bucket,
    ending: clip.ending,
    episode: clip.episode,
    melodyId: melody,
    captionRoles: clip.captionRoles,
    countdown: clip.countdown ?? { kind: "timer", source: "hud" },
    timing: { clipSec: clip.timing.clipSec, firstImpactSec: clip.timing.firstImpactSec },
    payoff: { atSec: clip.payoff.atSec, position: clip.payoff.position, cutGapSec: clip.payoff.cutGapSec },
  };
  return clip.from === "plan" ? scoreClip(plan as unknown as ClipPlan) : scorePlanLike(plan);
}
// --- end crew ---
