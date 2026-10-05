/*
 * --- loop-foundation --- The page settings of the loop contract and the loop HUD (lib/loop/loopContract.ts, lib/loop/hud.ts):
 *
 * - **Export whole loops** (`exportWholeLoops`, URL `wl`): a recording of a mode that reports a seamless cycle (`cycleSeconds()`
 *   – Grow's fill and loop) is cut at the end of its last whole cycle, so the clip loops without a seam. On by default; it does
 *   nothing in a mode that does not loop, so every old run records exactly as before.
 * - **Loop HUD** (`loopHud`, URL `lh`): a bold lowercase title, an optional grey subtitle under a thin rule and at most one amber
 *   counter, drawn into the pixels (the recordings carry it). Off by default; the title and the subtitle default to the mode's
 *   own translated words (`loopHudTitle` / `loopHudSubtitle` = "", URL `lht` / `lhs`).
 */

export interface LoopFields {
  exportWholeLoops: boolean;
  loopHud: boolean;
  loopHudTitle: string;
  loopHudSubtitle: string;
}

/** The most characters of the HUD's title and subtitle a link, a preset or a project file keeps (the page's other texts' limit). */
export const LOOP_HUD_TEXT_MAX = 60;

export const DEFAULT_LOOP_FIELDS: Readonly<LoopFields> = { exportWholeLoops: true, loopHud: false, loopHudTitle: "", loopHudSubtitle: "" };

export function defaultLoopFields(): LoopFields {
  return { ...DEFAULT_LOOP_FIELDS };
}

/** A HUD text as stored: one line (no control characters), at most LOOP_HUD_TEXT_MAX characters, trimmed. */
export function cleanHudText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, LOOP_HUD_TEXT_MAX).trim();
}

/** Validates the fields (links, presets and project files alike): real booleans, clean texts. */
export function resolveLoopFields(source: Partial<Record<keyof LoopFields, unknown>> | null | undefined): LoopFields {
  const s = source ?? {};
  const d = DEFAULT_LOOP_FIELDS;
  return {
    exportWholeLoops: typeof s.exportWholeLoops === "boolean" ? s.exportWholeLoops : d.exportWholeLoops,
    loopHud: typeof s.loopHud === "boolean" ? s.loopHud : d.loopHud,
    loopHudTitle: cleanHudText(s.loopHudTitle),
    loopHudSubtitle: cleanHudText(s.loopHudSubtitle),
  };
}

/** Writes the fields that differ from `base`: wl, lh, lht, lhs. */
export function writeLoopParams(settings: LoopFields, base: LoopFields, params: URLSearchParams) {
  if (settings.exportWholeLoops !== base.exportWholeLoops) params.set("wl", settings.exportWholeLoops ? "1" : "0");
  if (settings.loopHud !== base.loopHud) params.set("lh", settings.loopHud ? "1" : "0");
  if (settings.loopHudTitle !== base.loopHudTitle) params.set("lht", settings.loopHudTitle);
  if (settings.loopHudSubtitle !== base.loopHudSubtitle) params.set("lhs", settings.loopHudSubtitle);
}

/** Reads the fields from a link into `settings` (an unknown value keeps the default). */
export function readLoopParams(params: URLSearchParams, settings: LoopFields) {
  const next: Partial<Record<keyof LoopFields, unknown>> = { ...settings };
  const bool = (key: string, field: "exportWholeLoops" | "loopHud") => {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  };
  bool("wl", "exportWholeLoops");
  bool("lh", "loopHud");
  const title = params.get("lht");
  if (title !== null) next.loopHudTitle = title;
  const subtitle = params.get("lhs");
  if (subtitle !== null) next.loopHudSubtitle = subtitle;
  Object.assign(settings, resolveLoopFields(next));
}
