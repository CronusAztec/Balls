import { MODE_IDS, isModeId, type ModeId } from "@/lib/physics/types";
import { MODE_CATEGORIES } from "@/lib/modes";
import { RANGES, defaultSettings, engineSettingKeys, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { SETTING_OPTIONS, assistantSettings } from "@/lib/desktop/ai/settingsPatch";
import { jsonView, type JsonValue } from "./jsonView";

/*
 * --- agent-cli --- `npm run agent -- modes`: the mode catalog as an agent needs it – every MODE_ID with its family
 * (MODE_CATEGORIES), its English name and card line (messages/en.json Modes.*), its settings prefix and, for one mode, every
 * field of its block with the default, the slider range (RANGES; the uncap rule lets links go past the maximum) and the
 * share-link key. Everything is read from the code the site runs, nothing is a second table:
 *  - the prefix: the app AI's mode block (settingsPatch.ts assistantSettings(), which follows MODE_PREFIXES) – the leading
 *    lower-case run its keys share;
 *  - the link key of a field: the parameter settingsToSearchParams() writes when only that field leaves the mode's default.
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
}

export interface ModeDetail extends ModeSummary {
  description: string | null;
  fieldList: ModeField[];
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
function urlKeyOf(defaults: SimulatorSettings, key: string, baseParams: URLSearchParams): string | null {
  const value = (defaults as unknown as Record<string, unknown>)[key];
  const other = perturbed(key, value);
  if (other === null || other === undefined) return null;
  const params = settingsToSearchParams({ ...defaults, [key]: other } as SimulatorSettings);
  const changed = [...params.keys()].filter((k) => params.get(k) !== baseParams.get(k));
  return changed.length === 1 ? changed[0] : changed.length > 1 ? changed.join(",") : null;
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
export function modeDetail(mode: string, messages: EnMessages): ModeDetail | null {
  if (!isModeId(mode)) return null;
  const defaults = defaultSettings(mode);
  const base = settingsToSearchParams(defaults);
  const engine = new Set(engineSettingKeys(mode));
  const fieldList = modeFieldKeys(defaults).keys.map((key) => ({
    key,
    default: jsonView((defaults as unknown as Record<string, unknown>)[key]).value,
    range: rangeOf(key),
    url: urlKeyOf(defaults, key, base),
    engine: engine.has(key),
  }));
  return { ...summaryOf(mode, messages), description: modeText(messages, mode, "description"), fieldList };
}
