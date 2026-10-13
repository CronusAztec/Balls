import { buildCustomFighters, MAX_CUSTOM_FIGHTERS, type CustomFighterSpec } from "@/lib/physics/modes/fightLeagueCustom";
import type { FlFighterRow } from "@/lib/physics/modes/fightLeagueRoster";
import { sanitizeCustomModes, MAX_CUSTOM_MODES, type CustomModeSpec } from "./ai/customMode";

/*
 * --- custom-content --- The player's own fighters and modes, as the app keeps them: one JSON document in the app's data folder
 * (desktop/src/main.ts: `custom.load` / `custom.save`, a crash-safe file like the render journal), nothing sent anywhere.
 * Whatever is read is rebuilt through the same builders that made it, so a damaged or hand-edited file can cost entries but
 * never put an out-of-bounds fighter or a malformed mode into the app.
 */

export const CUSTOM_CONTENT_VERSION = 1;

export interface CustomContent {
  version: typeof CUSTOM_CONTENT_VERSION;
  fighters: CustomFighterSpec[];
  modes: CustomModeSpec[];
}

export const EMPTY_CONTENT: CustomContent = { version: CUSTOM_CONTENT_VERSION, fighters: [], modes: [] };

/** The document as it is to be used and written back, and the fighters' rows for the roster. */
export function resolveCustomContent(raw: unknown): { content: CustomContent; rows: FlFighterRow[] } {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const built = buildCustomFighters(Array.isArray(r.fighters) ? r.fighters.slice(0, MAX_CUSTOM_FIGHTERS * 2) : []);
  const modes = sanitizeCustomModes(Array.isArray(r.modes) ? r.modes.slice(0, MAX_CUSTOM_MODES * 2) : []);
  return { content: { version: CUSTOM_CONTENT_VERSION, fighters: built.specs, modes }, rows: built.rows };
}
