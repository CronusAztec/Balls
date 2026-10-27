import { BLUEPRINT_CATALOG_IDS, catalogBlueprint, isBlueprintCatalogId } from "@/lib/blueprint/catalog";
import { BLUEPRINT_CODE_MAX_CHARS, BLUEPRINT_CODE_PREFIX, BLUEPRINT_LINK_KEYS, blueprintCodeFormat, blueprintDigest, decodeBlueprint } from "@/lib/blueprint/codec";
import { BLUEPRINT_MAX_SUBSTEPS } from "@/lib/blueprint/limits";
import { applyBlueprintParams, formatParamValues, paramBounds, parseParamValues } from "@/lib/blueprint/params";
import { sanitizeBlueprint, type BlueprintNumberBound } from "@/lib/blueprint/sanitize";
import type { Blueprint } from "@/lib/blueprint/schema";
import { BlueprintRun, mulberry32 } from "@/lib/blueprint/runtime/run";
import { attachBlueprintView, createBlueprintView, refreshBlueprintView, type BlueprintView } from "@/lib/blueprint/runtime/view";
import type { Ball, GameMode, ModeContext } from "../types";

/**
 * Mode Lab ("blueprint" mode, feature blueprint): a game mode described as data. A Blueprint (lib/blueprint/, the language
 * v1 – docs/agents/BLUEPRINTS.md) is a validated JSON spec of an arena, bodies, tiles, obstacles, spawners, rules ("when a
 * ball breaks a tile, spawn a ball there") and a finish; this mode plays any of them through one sandboxed interpreter
 * (lib/blueprint/runtime/), so a new mechanic never touches the engine, the canvas or the page again.
 *
 * A thin adapter: `init()` resolves the spec – a catalog entry (`blPreset`, link key `blp`) or a spec from a link or a share
 * code (`blSpec`, `bls`, the `b1.` code), with the values of the sliders it declares (`blParams`, `blv`) – always sanitized
 * and validated before it is compiled, then starts a BlueprintRun; every GameMode hook forwards to the run. The balls are
 * the engine's (it moves, trails, draws and records them; bounce math applies), with the engine's gravity off and its pair
 * pass skipped: the world resolves the arena, the obstacles, the tiles and the pairs itself (`ballsPassThrough`,
 * `ballsMayRest`). The physics callbacks only record events; the rules run once a step, in onPostUpdate.
 *
 * Sandbox: every number of work is bounded by the Blueprint ceilings of lib/uncap.ts (400 balls, 600 tiles, 48 obstacles,
 * 16 rules, a 180 s timeout, 6,000 bytes of spec; events, firings, spawns and sounds per step), so a stranger's link can
 * never freeze a tab; nothing throws out of the engine (a rule that fails ends the run 1 s later with reason "fault").
 * Randomness: the run's own Mulberry32, seeded once from ctx.random(), so a seed replays exactly. The run's result holds
 * for END_HOLD_SEC under the end banner before `isFinished()`.
 */

/* ------------------------------------------------------------------ settings */

export interface BlueprintSettings {
  /** The catalog entry played when there is no spec of a link (lib/blueprint/catalog). */
  preset: string;
  /** A Blueprint from a link or a share code: its `b1.` code ("" = the catalog entry). */
  spec: string;
  /** The values of the spec's sliders (`params`), comma-separated, an empty place keeping the spec's own ("" = none). */
  params: string;
}

export const DEFAULT_BLUEPRINT_SETTINGS: BlueprintSettings = { preset: "hatchery", spec: "", params: "" };

/** --- review fix (blueprint) --- The catalog's ids (`blPreset`'s values), for the app AI's settings schema. */
export const BLUEPRINT_PRESET_IDS: readonly string[] = BLUEPRINT_CATALOG_IDS;

/**
 * --- unlimited-sizes --- The bound the language holds each of a game's sliders to (lib/blueprint `paramBounds()`, read with
 * the sliders at `params` – the link's `blv` – where a bound depends on the other sliders), for the app AI's prompt (its Mode
 * Lab note says it before the slider's comfort range): only Mode Lab's own files read lib/blueprint.
 */
export function blueprintParamBounds(bp: Blueprint, params = ""): BlueprintNumberBound[] {
  return paramBounds(bp, parseParamValues(params));
}
/** --- review fix (blueprint) --- The longest `blSpec` a link, a project file or the render queue keeps (the codec's limit). */
export const BLUEPRINT_SPEC_MAX_CHARS = BLUEPRINT_CODE_MAX_CHARS;

/** Slider ranges, keyed by the SimulatorSettings field names: none – a Blueprint's sliders are the spec's own (`params`). */
export const BLUEPRINT_RANGES = {} as const;

/** The Mode Lab fields of the SimulatorSettings object (URL keys blp, bls, blv). */
export interface BlueprintFields {
  blPreset: string;
  blSpec: string;
  blParams: string;
}

/** The settings keys the engine reads (Simulator restarts the run when one changes). */
export const BLUEPRINT_ENGINE_KEYS = ["blPreset", "blSpec", "blParams"] as const;

/** How long the result stays on screen under the end banner before the run counts as finished (s). */
export const END_HOLD_SEC = 1.5;

/**
 * A `b1.` code that may be a Blueprint (the decoder has the last word), or "". --- review fix (blueprint) --- A code of a later
 * format (`b2.` …) is kept too: the decoder refuses it as newer, the panel says the game needs a newer site, and a copied
 * link still carries the friend's game.
 */
function cleanCode(value: unknown): string {
  if (typeof value !== "string") return "";
  const t = value.trim();
  return blueprintCodeFormat(t) >= 1 && t.length <= BLUEPRINT_CODE_MAX_CHARS && /^[A-Za-z0-9._-]+$/.test(t) ? t : "";
}

/** Fills in the defaults: a known catalog id, a plausible code, clean slider values. */
export function resolveBlueprintSettings(config: Partial<BlueprintSettings> | null | undefined): BlueprintSettings {
  const out = { ...DEFAULT_BLUEPRINT_SETTINGS };
  if (!config) return out;
  if (isBlueprintCatalogId(config.preset)) out.preset = config.preset;
  if (config.spec !== undefined) out.spec = cleanCode(config.spec);
  if (config.params !== undefined) out.params = typeof config.params === "string" ? formatParamValues(parseParamValues(config.params)) : "";
  return out;
}

/** Picks the Mode Lab settings out of a bigger object for `engine.setBlueprintSettings()`. */
export function blueprintSettingsOf(source: BlueprintFields): BlueprintSettings {
  return { preset: source.blPreset, spec: source.blSpec, params: source.blParams };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function blueprintSettingFields(settings: BlueprintSettings): BlueprintFields {
  return { blPreset: settings.preset, blSpec: settings.spec, blParams: settings.params };
}

/** The defaults of the feature's fields. */
export function defaultBlueprintFields(): BlueprintFields {
  return blueprintSettingFields(DEFAULT_BLUEPRINT_SETTINGS);
}

/** The core settings Mode Lab overrides when it is the page's mode: none (a Blueprint sizes and colours its own balls). */
export function blueprintModeDefaults(mode: string): Record<string, never> {
  void mode;
  return {};
}

/** Validates the feature's fields (URL parameters and presets alike): a known catalog id, a plausible code, clean values. */
export function resolveBlueprintFields(source: Partial<BlueprintFields>): BlueprintFields {
  return blueprintSettingFields(resolveBlueprintSettings({ preset: source.blPreset, spec: source.blSpec, params: source.blParams }));
}

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: blp, bls and blv. */
export function writeBlueprintParams(settings: BlueprintFields, base: BlueprintFields, params: URLSearchParams) {
  if (settings.blPreset !== base.blPreset) params.set(BLUEPRINT_LINK_KEYS.preset, settings.blPreset);
  if (settings.blSpec && settings.blSpec !== base.blSpec) params.set(BLUEPRINT_LINK_KEYS.spec, settings.blSpec);
  if (settings.blParams && settings.blParams !== base.blParams) params.set("blv", settings.blParams);
}

/** Reads blp, bls and blv (a missing key keeps the value; bad values fall back). */
export function readBlueprintParams(params: URLSearchParams, settings: BlueprintFields) {
  const preset = params.get(BLUEPRINT_LINK_KEYS.preset);
  if (preset !== null && isBlueprintCatalogId(preset)) settings.blPreset = preset;
  const spec = params.get(BLUEPRINT_LINK_KEYS.spec);
  // --- review fix (blueprint) --- a link's code that cannot even be a code (cut, too long, stray characters) is kept as the
  // bare prefix: it never decodes, so the panel says the link could not be read instead of quietly playing a catalog game
  if (spec !== null) settings.blSpec = spec.trim() === "" ? "" : cleanCode(spec) || BLUEPRINT_CODE_PREFIX;
  const values = params.get("blv");
  if (values !== null) settings.blParams = formatParamValues(parseParamValues(values));
}

/* ------------------------------------------------------------------ the spec a setting plays */

/** What the settings resolve to: the spec played (sanitized, the sliders applied), where it came from and what was repaired. */
export interface ResolvedBlueprint {
  blueprint: Blueprint;
  /** The catalog id, or "" for a spec of a link. */
  catalogId: string;
  /** The spec as given, before the slider values (the panel's sliders read their defaults here). */
  base: Blueprint;
  /** What the sanitizer repaired or dropped, and why a link's spec could not be read. */
  notes: string[];
  /**
   * Features a newer version wrote (the spec plays without them), the spec's own newer format first (`v2`); or, for a link of
   * a later code format (`b2.`, unreadable here), that format.
   */
  newer: string[];
  /** --- review fix (blueprint) --- A link's Blueprint was given but could not be read (cut short, damaged): the catalog entry plays. */
  unreadable: boolean;
}

/** The spec the settings play: a link's spec when it reads, else the catalog entry; the slider values applied. Never throws. */
export function resolveBlueprintSpec(settings: BlueprintSettings): ResolvedBlueprint {
  const notes: string[] = [];
  let base: Blueprint | null = null;
  let catalogId = "";
  let newer: string[] = [];
  let unreadable = false;
  if (settings.spec) {
    const decoded = decodeBlueprint(settings.spec);
    if (decoded.ok) {
      const s = sanitizeBlueprint(decoded.raw);
      base = s.blueprint;
      notes.push(...s.notes);
      newer = s.newer;
    } else {
      unreadable = true;
      // --- review fix (blueprint) --- a later link format is a game for a newer site, not a link cut short
      if (decoded.newer) newer = [decoded.newer];
      notes.push(`$: the link's Blueprint could not be read (${decoded.error}); playing the catalog entry instead`);
    }
  }
  if (!base) {
    catalogId = isBlueprintCatalogId(settings.preset) ? settings.preset : DEFAULT_BLUEPRINT_SETTINGS.preset;
    base = catalogBlueprint(catalogId as (typeof BLUEPRINT_CATALOG_IDS)[number]);
  }
  const applied = applyBlueprintParams(base, parseParamValues(settings.params));
  notes.push(...applied.notes);
  return { blueprint: applied.blueprint, catalogId, base, notes, newer, unreadable };
}

// --- insights ---
/**
 * The game the settings play, for a clip's genes (lib/insights/genes.ts): the catalog entry (null for a link's spec) and the
 * digest of the spec played, sliders applied (lib/blueprint/codec.ts `blueprintDigest()`). Never throws. The desktop side
 * reads the language through this mode, never the language itself (tests/blueprintSchema.test.ts, "isolation and purity").
 */
export function blueprintGameOf(settings: BlueprintSettings): { catalogId: string | null; digest: string } {
  const resolved = resolveBlueprintSpec(settings);
  return { catalogId: resolved.catalogId || null, digest: blueprintDigest(resolved.blueprint) };
}

/* ------------------------------------------------------------------ the mode */

export interface BlueprintProgress {
  finished: boolean;
  reason: string | null;
  timeSec: number;
  balls: number;
  tiles: number;
  escaped: number;
}

export class BlueprintMode implements GameMode {
  readonly name = "blueprint";
  /** A Blueprint's gravity and bounciness are its own: no slow-ball boost. */
  readonly ballsMayRest = true;
  /** The world resolves the balls against each other (by mass, with the spec's bounciness): not the engine's pair pass. */
  readonly ballsPassThrough = true;
  /** --- review fix (blueprint) --- A planned step takes at most this many sub-steps (the sandbox's work ceiling); slow motion beyond. */
  readonly subStepCeiling = BLUEPRINT_MAX_SUBSTEPS;
  /** --- review fix (blueprint) --- A Blueprint sizes every ball itself: the page's Ball Size (re-sent by a theme) never resizes them. */
  readonly ownsBallSize = true;
  private settings: BlueprintSettings = { ...DEFAULT_BLUEPRINT_SETTINGS };
  private resolved: ResolvedBlueprint | null = null;
  private resolvedKey = "";
  private run: BlueprintRun | null = null;
  private readonly view: BlueprintView = createBlueprintView();
  /** Conformance tests only: firing rule i throws (fault containment). Never set by a page. */
  faultOnRule = -1;

  getSettings(): BlueprintSettings {
    return this.settings;
  }
  /** Every setting applies on the next init (the run restarts with the new spec). */
  setSettings(patch: Partial<BlueprintSettings>) {
    this.settings = resolveBlueprintSettings({ ...this.settings, ...patch });
  }
  /** The spec the settings play (cached until they change). */
  getResolved(): ResolvedBlueprint {
    const key = `${this.settings.preset}|${this.settings.spec}|${this.settings.params}`;
    if (!this.resolved || key !== this.resolvedKey) {
      this.resolved = resolveBlueprintSpec(this.settings);
      this.resolvedKey = key;
    }
    return this.resolved;
  }
  /** Live state for the canvas, the HUD and the smoke test's dataset; the same object every call. */
  getView(): BlueprintView {
    return this.view;
  }
  /** The run being played (null before the first init): the headless check reads its counts. */
  getRun(): BlueprintRun | null {
    return this.run;
  }
  getProgress(): BlueprintProgress {
    const v = this.view;
    return { finished: v.result.finished, reason: v.result.reason, timeSec: v.timeSec, balls: v.balls, tiles: v.tiles, escaped: v.escaped };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const r = this.getResolved();
    // the run's own generator, seeded once from the engine's: the cinematic director's draws never shift a Blueprint's
    const seed = Math.floor(ctx.random() * 4294967296);
    this.run = new BlueprintRun(r.blueprint, ctx, { random: mulberry32(seed), faultOnRule: this.faultOnRule });
    attachBlueprintView(this.view, this.run, r.catalogId, r.notes, r.newer);
  }

  onPreUpdate(_ctx: ModeContext, dtMs: number) {
    this.run?.preStep(dtMs);
  }

  onBallStep(_ctx: ModeContext, ball: Ball, dtSec: number) {
    this.run?.ballStep(ball, dtSec);
  }

  onPostSubStep() {
    this.run?.subStep();
  }

  onPostUpdate() {
    const run = this.run;
    if (!run) return;
    run.postStep();
    refreshBlueprintView(this.view, run);
  }

  /**
   * A resize lays the arena out for the new world and maps every ball into it (the engine scaled the positions around the
   * canvas centre per axis; that stretch is taken back first, then the arena's own scale applies to both axes).
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    const run = this.run;
    if (!sizeChanged || !run) return true;
    const w = run.world;
    const oldW = w.width;
    const oldH = w.height;
    const oldCx = w.cx;
    const oldCy = w.cy;
    const oldR = w.R;
    w.layout(ctx.config.width, ctx.config.height);
    const k = oldR > 0 ? w.R / oldR : 1;
    for (const ball of ctx.getBalls()) {
      ball.trail.length = 0;
      ball.trailIndex = 0;
      const ox = oldW / 2 + ((ball.x - w.width / 2) * oldW) / w.width;
      const oy = oldH / 2 + ((ball.y - w.height / 2) * oldH) / w.height;
      ball.x = w.cx + (ox - oldCx) * k;
      ball.y = w.cy + (oy - oldCy) * k;
      ball.vx *= k;
      ball.vy *= k;
    }
    return true;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** There are no engine rings: the arena is the world's own. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    const run = this.run;
    return !!run && run.finished && run.timeSec >= run.done.timeSec + END_HOLD_SEC - 1e-9;
  }
  getState() {
    const v = this.view;
    return { blueprint: v.bp?.meta.name ?? "", catalog: v.catalogId, finished: v.result.finished, reason: v.result.reason, result: v.result.result, timeSec: v.timeSec, balls: v.balls, tiles: v.tiles, escaped: v.escaped };
  }
  /** The fastest ball when the engine's four sub-steps are not enough for it (the engine then plans the step for it). */
  stepSpeedBound(_ctx: ModeContext, stepSec: number) {
    return this.run?.fastestBall(stepSec) ?? 0;
  }
  /** A ball split by the engine's "split" interaction: the half keeps the parent's Blueprint slots. */
  onBallSplit(_ctx: ModeContext, parent: Ball, half: Ball) {
    const run = this.run;
    const p = run?.world.byId.get(parent.id);
    if (run && p) run.world.adopt(half, p);
  }
  /** The page's Ball Color repainted every ball: back to the Blueprint's palette. */
  onBallColorChange() {
    for (const b of this.run?.world.balls ?? []) b.repaint();
  }
}
