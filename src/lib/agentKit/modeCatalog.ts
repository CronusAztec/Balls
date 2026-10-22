import { MODE_IDS, isModeId, type ModeId } from "@/lib/physics/types";
import { MODE_CATEGORIES } from "@/lib/modes";
import { RANGES, defaultSettings, engineSettingKeys, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { SETTING_OPTIONS, assistantSettings } from "@/lib/desktop/ai/settingsPatch";
import { jsonView, type JsonValue } from "./jsonView";

/*
 * --- agent-cli --- `npm run agent -- modes`: the mode catalog as an agent needs it – every MODE_ID with its family
 * (MODE_CATEGORIES), its English name and card line (messages/en.json Modes.*), its settings prefix and, for one mode, every
 * field of its block with the default, the slider range (RANGES; the uncap rule lets links go past the maximum) and the
 * share-link key. Everything is read from the code the site runs, nothing is a second table:
 *  - the prefix: the app AI's mode block (settingsPatch.ts assistantSettings(), which follows MODE_PREFIXES) – the leading
 *    lower-case run its keys share;
 *  - the link key of a field: the parameter settingsToSearchParams() writes when only that field leaves the mode's default;
 *  - whether a link keeps the field (settingsFromSearchParams() reads back the value the writer wrote: MODES.md rows 17 and
 *    18) and whether presetToSettings() resolves it (a wrong-typed value comes back as a value of the field's type: row 20).
 */

/** The English messages (messages/en.json): only `Modes.<id>.name` and `.description` are read. */
export type EnMessages = { Modes?: Record<string, unknown> };

/** A mode's message `Modes.<id>.<key>`, null when it is missing or not text. */
function modeText(messages: EnMessages, mode: string, key: "name" | "description"): string | null {
  const entry = messages.Modes?.[mode];
  const text = entry && typeof entry === "object" ? (entry as Record<string, unknown>)[key] : undefined;
  return typeof text === "string" ? text : null;
}

export interface ModeSummary {
  id: ModeId;
  family: string;
  name: string | null;
  /** The settings prefix of the mode's block (mrTiers → "mr"), null for a mode without a block of its own. */
  prefix: string | null;
  /** Fields of the mode's block (or, for a mode without one, the engine settings it adds to the core physics). */
  fields: number;
  fieldSource: "block" | "engine";
  /** Settings a run of the mode hands its engine (the core physics included). */
  engineKeys: number;
}

export interface ModeField {
  key: string;
  default: JsonValue;
  /** The slider's range (links may go past `max`: only memory ceilings cap them). */
  range: { min: number; max: number; step: number } | null;
  /** The share-link parameter, null when the field is not in links on its own. */
  url: string | null;
  /** A setting the run's engine reads (a change restarts the run), not only the picture or the sound. */
  engine: boolean;
  /** --- agent-cli --- A share link keeps the field: the link reader gives back the value the writer wrote (null: no other legal value to try). */
  roundTrip: boolean | null;
  /** --- agent-cli --- presetToSettings() resolves the field: a wrong-typed value comes back as one of the field's type (null: nothing to check). */
  resolved: boolean | null;
}

export interface ModeDetail extends ModeSummary {
  description: string | null;
  fieldList: ModeField[];
  /** --- agent-cli --- The fields a link loses (roundTrip false) or presetToSettings leaves unresolved (resolved false). */
  linkProblems: string[];
}

/** The leading lower-case run of the keys' common prefix ("mr" for mrTiers, mrInterval), null without keys. */
export function commonPrefix(keys: readonly string[]): string | null {
  if (keys.length === 0) return null;
  let p = keys[0];
  for (const k of keys) {
    let i = 0;
    while (i < p.length && i < k.length && p[i] === k[i]) i++;
    p = p.slice(0, i);
  }
  const run = /^[a-z]+/.exec(p);
  return run ? run[0] : null;
}

/** The keys of the mode's own block (the app AI's mode settings), in the settings' order. */
function modeBlockKeys(defaults: SimulatorSettings): string[] {
  return assistantSettings(defaults)
    .filter(([, description]) => description === `${defaults.mode} setting`)
    .map(([key]) => key);
}

let coreKeys: Set<string> | null = null;
/** The engine settings every mode reads (the core physics). */
function coreEngineKeys(): Set<string> {
  if (!coreKeys) {
    const [first, ...rest] = MODE_IDS.map((m) => new Set(engineSettingKeys(m)));
    coreKeys = new Set([...first].filter((k) => rest.every((s) => s.has(k))));
  }
  return coreKeys;
}

/**
 * The mode's fields: its block's (the prefixed keys), or – for a mode without a block of its own (Classic, Target, Shatter…)
 * – the engine settings only it and a few others read (its own on top of the core physics).
 */
function modeFieldKeys(defaults: SimulatorSettings): { keys: string[]; source: "block" | "engine" } {
  const block = modeBlockKeys(defaults);
  if (block.length > 0) return { keys: block, source: "block" };
  const core = coreEngineKeys();
  return { keys: engineSettingKeys(defaults.mode).filter((k) => !core.has(k) && k in defaults), source: "engine" };
}

const rangeOf = (key: string): ModeField["range"] => {
  const r = (RANGES as Record<string, { min: number; max: number; step: number } | undefined>)[key];
  return r ? { min: r.min, max: r.max, step: r.step } : null;
};

/** Another legal value of `key` (a step up, or down at the top; the other boolean; another option), null when there is none. */
function perturbed(key: string, value: unknown): unknown {
  if (typeof value === "boolean") return !value;
  if (typeof value === "number") {
    const r = rangeOf(key);
    const step = r && r.step > 0 ? r.step : 1;
    const up = value + step;
    return r && up > r.max ? value - step : up;
  }
  if (typeof value === "string") {
    const options = SETTING_OPTIONS[key];
    return options?.find((o) => o !== value) ?? null;
  }
  return null;
}

/** The share-link parameter of `key`: the one settingsToSearchParams() writes when only that field differs from the defaults. */
function urlKeyOf(defaults: SimulatorSettings, key: string, baseParams: URLSearchParams, io: LinkIo = SITE_IO): string | null {
  const value = (defaults as unknown as Record<string, unknown>)[key];
  const other = perturbed(key, value);
  if (other === null || other === undefined) return null;
  const params = io.write({ ...defaults, [key]: other } as SimulatorSettings);
  const changed = [...params.keys()].filter((k) => params.get(k) !== baseParams.get(k));
  return changed.length === 1 ? changed[0] : changed.length > 1 ? changed.join(",") : null;
}

/** The site's link writer and reader and its preset resolver (a test hands in a broken one to see what a missing reader shows). */
export interface LinkIo {
  write: (settings: SimulatorSettings) => URLSearchParams;
  read: (params: URLSearchParams) => SimulatorSettings;
  preset: (preset: Partial<SimulatorSettings>) => SimulatorSettings;
}

const SITE_IO: LinkIo = { write: settingsToSearchParams, read: settingsFromSearchParams, preset: presetToSettings };

/** Other legal values of a field to try, nearest first: one step up or down (then two, three, four), the other boolean, the other options. */
function candidates(key: string, value: unknown): unknown[] {
  if (typeof value === "number") {
    const r = rangeOf(key);
    const step = r && r.step > 0 ? r.step : 1;
    const out: number[] = [];
    for (let k = 1; k <= 4; k++) for (const v of [value + k * step, value - k * step]) if (!r || (v >= r.min && v <= r.max)) out.push(v);
    return out;
  }
  if (typeof value === "string") return (SETTING_OPTIONS[key] ?? []).filter((o) => o !== value);
  const one = perturbed(key, value);
  return one === null || one === undefined ? [] : [one];
}

/** Two values of a field alike: numbers within the links' three decimals, anything else by its JSON. */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 5e-4 + 1e-9 * Math.abs(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A value of another type than the field's, which presetToSettings() must not keep (undefined: no such check). */
function wrongTyped(value: unknown): unknown {
  if (typeof value === "number") return "not a number";
  if (typeof value === "boolean") return "not a boolean";
  if (typeof value === "string") return 12345;
  return undefined;
}

/**
 * --- agent-cli --- MODES.md's link rows for one field: does a share link keep it (the writer's value read back by the
 * reader: rows 17 and 18), and does presetToSettings() resolve it (a wrong-typed value replaced by one of the field's type:
 * row 20, the resolver every link, preset, project file and share code goes through).
 */
export function linkChecks(defaults: SimulatorSettings, key: string, io: LinkIo = SITE_IO): { roundTrip: boolean | null; resolved: boolean | null } {
  const value = (defaults as unknown as Record<string, unknown>)[key];
  // another value the field really takes: the resolver's own form of a step or a few away (a polygon of 1 side is the
  // circle, 0), not one it folds back onto the default
  let other: unknown = null;
  for (const candidate of candidates(key, value)) {
    const canonical = (io.preset({ ...defaults, [key]: candidate } as Partial<SimulatorSettings>) as unknown as Record<string, unknown>)[key];
    if (!sameValue(canonical, value)) {
      other = canonical;
      break;
    }
  }
  let roundTrip: boolean | null = null;
  if (other !== null && other !== undefined) {
    const back = io.read(io.write({ ...defaults, [key]: other } as SimulatorSettings)) as unknown as Record<string, unknown>;
    roundTrip = sameValue(back[key], other);
  }
  const wrong = wrongTyped(value);
  let resolved: boolean | null = null;
  if (wrong !== undefined) {
    const got = (io.preset({ ...defaults, [key]: wrong } as unknown as Partial<SimulatorSettings>) as unknown as Record<string, unknown>)[key];
    resolved = typeof got === typeof value && (typeof got !== "number" || Number.isFinite(got));
  }
  return { roundTrip, resolved };
}

function summaryOf(mode: ModeId, messages: EnMessages): ModeSummary {
  const defaults = defaultSettings(mode);
  const block = modeBlockKeys(defaults);
  const fields = modeFieldKeys(defaults);
  return {
    id: mode,
    family: MODE_CATEGORIES[mode],
    name: modeText(messages, mode, "name"),
    prefix: commonPrefix(block),
    fields: fields.keys.length,
    fieldSource: fields.source,
    engineKeys: engineSettingKeys(mode).length,
  };
}

/** Every mode, in MODE_IDS order. */
export function modeCatalog(messages: EnMessages): ModeSummary[] {
  return MODE_IDS.map((mode) => summaryOf(mode, messages));
}

/** One mode with its block's fields; null for an unknown id. */
export function modeDetail(mode: string, messages: EnMessages, io: LinkIo = SITE_IO): ModeDetail | null {
  if (!isModeId(mode)) return null;
  const defaults = defaultSettings(mode);
  const base = io.write(defaults);
  const engine = new Set(engineSettingKeys(mode));
  const fieldList = modeFieldKeys(defaults).keys.map((key) => ({
    key,
    default: jsonView((defaults as unknown as Record<string, unknown>)[key]).value,
    range: rangeOf(key),
    url: urlKeyOf(defaults, key, base, io),
    engine: engine.has(key),
    ...linkChecks(defaults, key, io),
  }));
  const linkProblems = fieldList.flatMap((f) => [...(f.roundTrip === false ? [`${f.key}: a share link loses it (link writer or reader)`] : []), ...(f.resolved === false ? [`${f.key}: presetToSettings() does not resolve it`] : [])]);
  return { ...summaryOf(mode, messages), description: modeText(messages, mode, "description"), fieldList, linkProblems };
}
