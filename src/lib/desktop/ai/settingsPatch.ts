import { RANGES, RESOLUTIONS, bouncinessPatch, defaultSettings, presetToSettings, unlimitedSettingKeys, type SimulatorSettings } from "@/lib/settings";
import { BOUNCIER_ON, BOUNCINESS_OFF } from "@/lib/uncap"; // --- uncap-all --- the numeric Bounciness
import { parseUnlimitedValue, unlimitedBounds } from "@/lib/unlimited"; // --- unlimited ---
import { BALL_INTERACTIONS, MODE_IDS, WALL_BREAK_STYLES, isModeId } from "@/lib/physics/types";
import { PARTICLE_STYLES } from "@/lib/physics/particleStyles";
import { THEME_IDS } from "@/lib/themes";
import { INSTRUMENT_IDS } from "@/lib/audio/instruments";
import { QUANTIZE_GRIDS, SCALE_IDS } from "@/lib/audio/scales";
import { HIT_SOUND_MODES } from "@/lib/audio/sampler";
import { FACE_STYLES } from "@/lib/character/character";
import type { JsonSchema } from "./jsonSchema";

/*
 * --- desktop-exe --- The AI settings assistant's side of the settings: what it may change and how a patch it proposes is
 * checked before the page applies it (with undo). A patch must name known settings with values of the right type, numbers
 * inside their `RANGES` (snapped to the step), known options for the enumerated ones and colours as #rrggbb; the list and
 * shape settings (teams, obstacles, captions, keyframes, arenas) and the uploads are out of its reach. The final word is
 * the settings loader's: a value that `presetToSettings()` does not keep is refused, so a patch can never put the page in a
 * state a preset or a link could not.
 */

type Settings = Record<string, unknown>;

/** Settings the assistant may not touch: lists, uploads and the per-arena overrides. */
export const PATCH_EXCLUDED = new Set(["teams", "obstacles", "captions", "keyframes", "arenas", "wallBreakSound", "hitSampleId", "beatMarkers", "journeyStages", "bdKinds", "pickupTypes", "mpGateMix", "prCustom"]);
/** At most this many settings in one patch. */
export const MAX_PATCH_KEYS = 40;

/** Options of the enumerated settings (the prompt lists them, errors quote them). */
export const SETTING_OPTIONS: Record<string, readonly (string | number)[]> = {
  mode: MODE_IDS,
  ballInteraction: BALL_INTERACTIONS,
  wallBreakStyle: WALL_BREAK_STYLES,
  particleStyle: PARTICLE_STYLES,
  themeId: ["", ...THEME_IDS],
  instrument: INSTRUMENT_IDS,
  melodyInstrument: INSTRUMENT_IDS,
  scale: SCALE_IDS,
  quantizeGrid: QUANTIZE_GRIDS,
  hitSoundMode: HIT_SOUND_MODES,
  recordingResolution: RESOLUTIONS,
  ballFace: FACE_STYLES,
  rainbowWallMode: ["pulse", "gradient"],
  backgroundType: ["solid", "gradient"],
  fastExportFps: [30, 60],
};

const TEXT_KEYS = new Set(["topText", "bottomText", "watermarkText", "ballName", "rcCupTitle"]);
const HEX = /^#[0-9a-fA-F]{6}$/;
const isColorKey = (key: string) => /Colou?r2?$/.test(key) || key === "circleColor" || key === "lineColor";

/** The settings the assistant is told about first (with a short description for the model), in prompt order. */
export const CATALOG: readonly [key: string, description: string][] = [
  ["mode", "game mode"],
  ["ballSpeed", "ball speed in px/s"],
  ["ballRadius", "ball size (radius px)"],
  ["gravity", "downward gravity; 0 = no gravity"],
  ["ballCount", "number of balls"],
  ["ballColor", "ball colour #rrggbb"],
  ["rainbowBall", "ball cycles through rainbow colours"],
  ["bounciness", "every wall bounce adds (value − 1) × the ball speed: 1 = off, 1.03 = the classic Bouncier"], // --- uncap-all --- (the old Bouncier switch follows it)
  ["ballInteraction", "what balls do when they touch"],
  ["airDrag", "air drag per step"],
  ["windX", "sideways wind (fraction of ball speed per second)"],
  ["windY", "vertical wind"],
  ["spinStrength", "spin and curved flight"],
  ["wallBounciness", "restitution at wall hits (1 = elastic)"],
  ["rotatingGravity", "degrees per second the gravity turns"],
  ["wallCount", "number of rings"],
  ["wallThickness", "ring thickness"],
  ["gapSize", "size of the gap in each ring"],
  ["rotationEnabled", "rings rotate"],
  ["rotationSpeed", "ring rotation speed"],
  ["breathingAmplitude", "rings pulse in and out"],
  ["circleColor", "ring colour #rrggbb"],
  ["rainbowWalls", "rainbow rings"],
  ["showTrails", "ball trails"],
  ["trailThickness", "trail thickness"],
  ["colorTrail", "colourful trail"],
  ["showGlow", "ball glow"],
  ["showWallGlow", "ring glow"],
  ["wallBreakStyle", "effect when a ring breaks"],
  ["particleStyle", "burst particles"],
  ["themeId", "one-click look (\"\" = none)"],
  ["cameraFollow", "camera follows the ball"],
  ["cinematicEnabled", "drama director (near misses)"],
  ["screenShake", "screen shake on hits"],
  ["cameraZoom", "camera zoom"],
  ["ballFace", "face on the ball"],
  ["ballName", "name label on the ball"],
  ["instrument", "bounce sound instrument"],
  ["melodyInstrument", "melody instrument"],
  ["scale", "musical scale of the bounces"],
  ["rootNote", "root note 0=C … 11=B"],
  ["quantizeToBeat", "snap bounce sounds to the beat"],
  ["bpm", "tempo"],
  ["recordingDuration", "clip length in seconds"],
  ["recordingResolution", "video size"],
  ["fastExportFps", "video frame rate"],
  ["topText", "text at the top of the video"],
  ["bottomText", "text at the bottom of the video"],
  ["textSize", "size of the top / bottom text"],
];

const ranges = RANGES as unknown as Record<string, { min: number; max: number; step: number } | undefined>;

// --- unlimited --- the settings that go past their slider take any valid value from their minimum up here too (as links,
// presets and project files do) – --- review fix (uncap-all) --- whatever the Wide sliders switch (`unlimited`), which only
// widens the panel's slider tracks: the slider range is a comfort range, never a limit, for the assistant as for the page
let unlimitedKeySet: ReadonlySet<string> | null = null;
/** True when `key` is uncapped: any valid value from its minimum up (none for a signed one), past its slider too. */
function liftedKey(key: string): boolean {
  unlimitedKeySet ??= new Set(unlimitedSettingKeys());
  return unlimitedKeySet.has(key);
}
// --- end unlimited ---

function snap(value: number, range: { min: number; max: number; step: number }): number {
  const steps = Math.round((value - range.min) / range.step);
  const snapped = range.min + steps * range.step;
  const decimals = (String(range.step).split(".")[1] ?? "").length;
  return Math.min(range.max, Math.max(range.min, Number(snapped.toFixed(decimals))));
}

/** A one-line description of a setting for the prompt: `ballSpeed (number 50–800, step 10) = 400 — ball speed in px/s`. */
export function describeSetting(key: string, current: SimulatorSettings, description = ""): string {
  const value = (current as unknown as Settings)[key];
  const range = ranges[key];
  const options = SETTING_OPTIONS[key];
  let type: string = Array.isArray(value) ? "list" : typeof value;
  if (options) type = `one of ${options.map((o) => JSON.stringify(o)).join("|")}`;
  else if (range && liftedKey(key)) type = `number ${describeUnlimited(key, range)}, slider ${range.min}–${range.max}, step ${range.step}`; // --- unlimited --- (--- review fix (uncap-all) --- whatever the switch)
  else if (range) type = `number ${range.min}–${range.max}, step ${range.step}`;
  else if (typeof value === "string" && isColorKey(key)) type = "colour #rrggbb";
  return `${key} (${type}) = ${JSON.stringify(value)}${description ? ` — ${description}` : ""}`;
}

/**
 * --- unlimited --- The bounds of an uncapped setting, for the prompt: `from 50, no upper limit`, `any value`. (--- uncap-all
 * --- nothing but a list index has an upper bound any more, and --- review fix (uncap-all) --- the Wide sliders switch has no
 * say in it: the slider range that follows in the prompt is a comfort range only.)
 */
function describeUnlimited(key: string, range: { min: number; max: number; step: number }): string {
  const { min, max } = unlimitedBounds(key, range);
  const from = Number.isFinite(min) ? `from ${min}` : "any value";
  return Number.isFinite(max) ? `${from} up to ${max}` : `${from}, no upper limit`;
}

/** The prefix of the settings that belong to a mode (its block of the panel), so the assistant can tune the mode on the page. */
const MODE_PREFIXES: Partial<Record<SimulatorSettings["mode"], string>> = {
  drop: "drop",
  box: "box",
  pendulum: "pw",
  polyrhythm: "pr",
  collide: "cp",
  glass: "glass",
  multipliers: "mp",
  doublePendulum: "dp",
  illusion: "il",
  stringBattle: "sb",
  powerLayers: "pl",
  race: "rc",
  battle: "bt",
  ctf: "ctf",
  runner: "runner",
  paddle: "pd",
  vortex: "vx",
  bullseye: "by",
  beatDrop: "bd",
  territory: "ty", // --- odd-territory ---
  maze: "mz", // --- odd-maze ---
  conveyor: "cv", // --- gerald-conveyor ---
  orbGrid: "og", // --- orb-grid ---
  fightLeague: "fl", // --- fight-league ---
  landClaim: "lc", // --- land-claim ---
  hoops: "hp", // --- bead-hoops ---
};

/** The settings the assistant may change on this page: the catalog, then the scalar settings of the page's mode. */
export function assistantSettings(current: SimulatorSettings): [key: string, description: string][] {
  const list: [string, string][] = CATALOG.filter(([key]) => key in current).map(([k, d]) => [k, d]);
  const prefix = MODE_PREFIXES[current.mode];
  if (prefix) {
    for (const [key, value] of Object.entries(current as unknown as Settings)) {
      if (!key.startsWith(prefix) || PATCH_EXCLUDED.has(key) || list.some(([k]) => k === key)) continue;
      if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") list.push([key, `${current.mode} setting`]);
    }
  }
  return list;
}

/** The catalog of settings for the prompt, with the page's current values. */
export function settingsCatalog(current: SimulatorSettings): string {
  return assistantSettings(current).map(([key, d]) => describeSetting(key, current, d)).join("\n");
}

/** One change the model proposes: a setting and its new value. */
export interface SettingChange {
  setting: string;
  value: number | boolean | string;
}

function valueSchema(key: string, value: unknown): JsonSchema | null {
  const options = SETTING_OPTIONS[key];
  const range = ranges[key];
  if (options) return { enum: options };
  // --- unlimited --- an uncapped setting: its minimum (none for a signed one) and its semantic end, if it has one (--- review
  // fix (uncap-all) --- whatever the switch)
  if (typeof value === "number" && range && liftedKey(key)) {
    const { min, max } = unlimitedBounds(key, range);
    return { type: "number", ...(Number.isFinite(min) ? { minimum: min } : {}), ...(Number.isFinite(max) ? { maximum: max } : {}) };
  }
  if (typeof value === "number") return range ? { type: "number", minimum: range.min, maximum: range.max } : { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "string") return { type: "string", maxLength: TEXT_KEYS.has(key) ? 200 : 100 };
  return null;
}

/**
 * The JSON schema of the changes for this page: a list of `{ setting, value }`, one alternative per setting the assistant
 * may change with its value's type (options as an enum, numbers with their range). A list rather than an object because a
 * grammar can make every entry name a real setting without making every setting mandatory – the local model's grammar is
 * built from it, so even a small model can only name real settings. `validateSettingsPatch()` still has the final word.
 */
export function changesSchema(current: SimulatorSettings, keys: readonly (readonly [string, string])[] = assistantSettings(current)): JsonSchema {
  const alternatives: JsonSchema[] = [];
  for (const [key] of keys) {
    const schema = valueSchema(key, (current as unknown as Settings)[key]); // --- unlimited --- (--- review fix (uncap-all) --- whatever the switch)
    if (schema) alternatives.push({ type: "object", properties: { setting: { const: key }, value: schema }, required: ["setting", "value"], additionalProperties: false });
  }
  return { type: "array", minItems: 1, maxItems: MAX_PATCH_KEYS, items: { oneOf: alternatives } };
}

/** The changes as a patch (a later change of the same setting wins). */
export function patchFromChanges(changes: readonly SettingChange[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const c of changes) if (c && typeof c.setting === "string") patch[c.setting] = c.value;
  return patch;
}

export type PatchCheck = { ok: true; patch: Partial<SimulatorSettings> } | { ok: false; errors: string[] };

/** Checks (and normalises: numbers snapped to their step) a settings patch the model proposed against the page's settings. */
export function validateSettingsPatch(current: SimulatorSettings, raw: unknown): PatchCheck {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["patch must be an object of setting → value"] };
  const entries = Object.entries(raw as Settings);
  if (entries.length === 0) return { ok: false, errors: ["patch is empty: name at least one setting"] };
  if (entries.length > MAX_PATCH_KEYS) return { ok: false, errors: [`patch changes ${entries.length} settings; at most ${MAX_PATCH_KEYS}`] };
  const mode = isModeId((raw as Settings).mode) ? ((raw as Settings).mode as SimulatorSettings["mode"]) : current.mode;
  const defaults = defaultSettings(mode) as unknown as Settings;
  const patch: Settings = {};
  for (const [key, value] of entries) {
    if (!(key in defaults)) {
      errors.push(`"${key}" is not a setting`);
      continue;
    }
    if (PATCH_EXCLUDED.has(key)) {
      errors.push(`"${key}" cannot be changed here`);
      continue;
    }
    const fallback = defaults[key];
    const options = SETTING_OPTIONS[key];
    if (options) {
      if (!options.includes(value as string | number)) {
        errors.push(`"${key}" must be one of ${options.map((o) => JSON.stringify(o)).join(", ")}`);
        continue;
      }
      patch[key] = value;
      continue;
    }
    if (Array.isArray(fallback)) {
      const colorList = key === "backgroundColors" || key === "trailColors";
      if (!colorList || !Array.isArray(value) || !value.every((v) => typeof v === "string" && HEX.test(v)) || value.length > 2 || (key === "backgroundColors" && value.length !== 2)) {
        errors.push(colorList ? `"${key}" must be a list of ${key === "backgroundColors" ? "2" : "0–2"} #rrggbb colours` : `"${key}" cannot be changed here`);
        continue;
      }
      patch[key] = value;
      continue;
    }
    if (typeof fallback === "number" || (fallback === null && typeof value === "number")) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`"${key}" must be a number`);
        continue;
      }
      const range = ranges[key];
      if (range && (value < range.min - 1e-9 || value > range.max + 1e-9)) {
        // --- unlimited --- a value past the slider is kept when it is valid (finite, from the minimum up) – --- review fix
        // (uncap-all) --- whatever the Wide sliders switch
        const lifted = liftedKey(key) ? parseUnlimitedValue(key, value, range) : null;
        if (lifted !== null) {
          patch[key] = lifted;
          continue;
        }
        errors.push(liftedKey(key) ? `"${key}" must be a number ${describeUnlimited(key, range)} (got ${value})` : `"${key}" must be between ${range.min} and ${range.max} (got ${value})`);
        continue;
      }
      patch[key] = range ? snap(value, range) : value;
      continue;
    }
    if (typeof fallback === "boolean") {
      if (typeof value !== "boolean") {
        errors.push(`"${key}" must be true or false`);
        continue;
      }
      patch[key] = value;
      continue;
    }
    if (typeof fallback === "string") {
      if (typeof value !== "string") {
        errors.push(`"${key}" must be a string`);
        continue;
      }
      if (isColorKey(key) && !HEX.test(value)) {
        errors.push(`"${key}" must be a colour like #ff3366`);
        continue;
      }
      if (value.length > (TEXT_KEYS.has(key) ? 200 : 100)) {
        errors.push(`"${key}" is too long`);
        continue;
      }
      patch[key] = value;
      continue;
    }
    errors.push(`"${key}" cannot be changed here`);
  }
  if (errors.length) return { ok: false, errors };
  // --- desktop-exe x uncap-all --- the Bouncier switch follows the numeric Bounciness (`bouncinessPatch()`): a change of the
  // Bounciness brings the switch along, and a model that still sends the old switch gets the matching Bounciness
  if (typeof patch.bouncierEnabled === "boolean" && typeof patch.bounciness !== "number") patch.bounciness = patch.bouncierEnabled ? (current.bounciness > BOUNCINESS_OFF ? current.bounciness : BOUNCIER_ON) : BOUNCINESS_OFF;
  if (typeof patch.bounciness === "number") Object.assign(patch, bouncinessPatch(patch.bounciness));
  // The settings loader has the last word: a value it does not keep is not a valid value.
  const resolved = presetToSettings({ ...current, ...patch } as Partial<SimulatorSettings>) as unknown as Settings;
  for (const [key, value] of Object.entries(patch)) {
    const kept = resolved[key];
    const same = typeof value === "number" && typeof kept === "number" ? Math.abs(kept - value) <= (ranges[key]?.step ?? 0) + 1e-9 : JSON.stringify(kept) === JSON.stringify(value);
    if (!same) errors.push(`"${key}": ${JSON.stringify(value)} is not a valid value${SETTING_OPTIONS[key] ? ` (one of ${SETTING_OPTIONS[key].join(", ")})` : ""}`);
    else patch[key] = kept;
  }
  return errors.length ? { ok: false, errors } : { ok: true, patch: patch as Partial<SimulatorSettings> };
}

/** The patch that undoes `patch` on `current` (the values it replaces). */
export function invertPatch(current: SimulatorSettings, patch: Partial<SimulatorSettings>): Partial<SimulatorSettings> {
  const undo: Settings = {};
  for (const key of Object.keys(patch)) undo[key] = (current as unknown as Settings)[key];
  return undo as Partial<SimulatorSettings>;
}

/** The keys a patch actually changes (the rest are equal to the current values). */
export function changedKeys(current: SimulatorSettings, patch: Partial<SimulatorSettings>): string[] {
  return Object.entries(patch)
    .filter(([key, value]) => JSON.stringify((current as unknown as Settings)[key]) !== JSON.stringify(value))
    .map(([key]) => key);
}
