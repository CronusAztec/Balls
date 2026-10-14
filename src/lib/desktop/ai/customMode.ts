import type { SimulatorSettings } from "@/lib/settings";
import type { AgentTask } from "./agent";
import type { JsonSchema } from "./jsonSchema";
import { relevantAssistantSettings } from "./settingsFilter";
import { changesSchema, describeSetting, patchFromChanges, validateSettingsPatch, MAX_PATCH_KEYS, type SettingChange } from "./settingsPatch";
import { languageName } from "./studio";
import { plainText } from "@/lib/physics/modes/fightLeagueCustom";

/*
 * --- custom-content --- A mode the player makes with the app's AI: a base mode of the simulator plus the settings that turn it
 * into the idea (`mode` is one of the settings). Nothing new runs – the mode is built from the mechanics the app already has –
 * so it is checked and applied exactly like the settings assistant's changes (settingsPatch.ts) and kept on the device as a
 * name, a sentence and that patch.
 */

export const MODE_NAME_MAX = 28;
export const MODE_DESCRIPTION_MAX = 160;
/** At most this many custom modes are kept. */
export const MAX_CUSTOM_MODES = 24;

export interface CustomModeSpec {
  id: string;
  name: string;
  description: string;
  /** The settings it sets, `mode` among them (checked against the page when it is applied). */
  patch: Record<string, number | boolean | string>;
  createdAt: string;
}

export interface CustomModeResult {
  name: string;
  description: string;
  changes: SettingChange[];
  summary: string;
}

export const CUSTOM_MODE_FINAL: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 2, maxLength: MODE_NAME_MAX },
    description: { type: "string", minLength: 8, maxLength: MODE_DESCRIPTION_MAX },
    changes: { type: "array", minItems: 1 },
    summary: { type: "string", maxLength: 300 },
  },
  required: ["name", "description", "changes", "summary"],
  additionalProperties: false,
};

export function customModeTask(request: string, current: SimulatorSettings, locale: string): AgentTask<CustomModeResult> {
  const relevant = relevantAssistantSettings(current, request);
  const system = [
    "You design a NEW game mode for JumpingBallsLive, a ball-physics simulator, from the mechanics it already has. A mode is one base mode (the setting \"mode\") plus the settings that make the idea happen.",
    "Answer with: a short catchy name, one sentence that says how it plays, and the changes – one {\"setting\", \"value\"} per setting, \"mode\" first. Use only the settings below, numbers within their bounds (\"from N, no upper limit\" means any value from N up).",
    `Write the name, the sentence and the summary in ${languageName(locale)}.`,
    "Settings (name (type) = current value — meaning):",
    relevant.map(([key, d]) => describeSetting(key, current, d)).join("\n"),
  ].join("\n");
  return {
    system,
    user: request,
    tools: [],
    name: "mode",
    finalHint: '{"name":"<2-4 words>","description":"<one sentence>","changes":[{"setting":"mode","value":"<a base mode>"},{"setting":"<a setting from the list>","value":<its value>}, …],"summary":"<one short sentence>"}',
    final: { ...CUSTOM_MODE_FINAL, properties: { ...CUSTOM_MODE_FINAL.properties, changes: { ...changesSchema(current, relevant), maxItems: MAX_PATCH_KEYS } } },
    normaliseFinal: (raw) => {
      if (!raw || typeof raw !== "object") return raw;
      const r = raw as Record<string, unknown>;
      return { ...r, name: plainText(r.name, MODE_NAME_MAX), description: plainText(r.description, MODE_DESCRIPTION_MAX) };
    },
    checkFinal: (result) => {
      const patch = patchFromChanges(result.changes);
      if (typeof patch.mode !== "string") return ['the changes must set "mode" (the base mode)'];
      const checked = validateSettingsPatch(current, patch);
      return checked.ok ? [] : checked.errors;
    },
    maxSteps: 5,
    temperature: 0.4,
    maxTokens: 700,
  };
}

/** The spec a valid answer becomes (the patch as the page checked it, snapped to the settings' steps). */
export function customModeFrom(result: CustomModeResult, current: SimulatorSettings, takenIds: ReadonlySet<string>): CustomModeSpec | null {
  const checked = validateSettingsPatch(current, patchFromChanges(result.changes));
  if (!checked.ok) return null;
  const name = plainText(result.name, MODE_NAME_MAX);
  const description = plainText(result.description, MODE_DESCRIPTION_MAX);
  if (name.length < 2 || description.length < 8) return null;
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "mode";
  let id = `mymode-${slug}`;
  for (let i = 2; takenIds.has(id); i++) id = `mymode-${slug}-${i}`;
  return { id, name, description, patch: checked.patch as Record<string, number | boolean | string>, createdAt: new Date().toISOString() };
}

/** A stored list of modes, repaired: wrongly shaped entries dropped, text cleaned, duplicates and the limit enforced. */
export function sanitizeCustomModes(raw: unknown): CustomModeSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomModeSpec[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_CUSTOM_MODES) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = plainText(r.name, MODE_NAME_MAX);
    const description = plainText(r.description, MODE_DESCRIPTION_MAX);
    const id = typeof r.id === "string" && /^mymode-[a-z0-9-]{1,30}$/.test(r.id) ? r.id : "";
    if (!id || seen.has(id) || name.length < 2 || !r.patch || typeof r.patch !== "object" || Array.isArray(r.patch)) continue;
    const patch: Record<string, number | boolean | string> = {};
    for (const [k, v] of Object.entries(r.patch as Record<string, unknown>)) {
      if (Object.keys(patch).length >= MAX_PATCH_KEYS) break;
      if (/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k) && (typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean" || (typeof v === "string" && v.length <= 200))) patch[k] = v as number | boolean | string;
    }
    if (typeof patch.mode !== "string") continue;
    seen.add(id);
    out.push({ id, name, description, patch, createdAt: typeof r.createdAt === "string" ? r.createdAt.slice(0, 40) : "" });
  }
  return out;
}
