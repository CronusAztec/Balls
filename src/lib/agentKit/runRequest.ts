import { isModeId, type ModeId } from "@/lib/physics/types";
import { linkParams, linkSeed, resolveLinkSettings } from "@/lib/recording/batch";
import { defaultSettings, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";

/*
 * --- agent-cli --- The run a tool call names: a share link (long, a `?c=` short link, or just its query string – read, never
 * fetched) or a mode's defaults, and its seed (the call's `seed`, else the link's `seed=`, else DEFAULT_SEED). The settings
 * come from the site's own link reader (settingsFromSearchParams through resolveLinkSettings), so any link replays as the
 * page would load it.
 */

export const DEFAULT_SEED = 1;

export interface RunRequest {
  link?: string;
  mode?: string;
  seed?: number;
}

export type ResolvedRun = { ok: true; settings: SimulatorSettings; seed: number; mode: ModeId; query: string } | { ok: false; error: string };

/** A link as the batch reader takes it: a bare query string ("mode=classic&g=300") gets its "?". */
export function normaliseLink(link: string): string {
  const text = link.trim();
  return !text.includes("?") && !/^[a-z]+:\/\//i.test(text) && text.includes("=") ? `?${text}` : text;
}

export async function resolveRun(request: RunRequest): Promise<ResolvedRun> {
  if (request.link !== undefined && request.mode !== undefined) return { ok: false, error: "Give link or mode, not both" };
  let settings: SimulatorSettings;
  let linkSeedValue: number | null = null;
  if (request.link !== undefined) {
    const link = normaliseLink(request.link);
    if (!linkParams(link)) return { ok: false, error: "The link names no mode (mode=…) and no share code (c=…)" };
    const r = await resolveLinkSettings(link);
    if (!r.ok) return { ok: false, error: `The link could not be read (${r.error})` };
    settings = r.settings;
    linkSeedValue = linkSeed(link);
  } else {
    const mode = request.mode ?? "classic";
    if (!isModeId(mode)) return { ok: false, error: `Unknown mode "${mode}" (see the modes tool)` };
    settings = defaultSettings(mode);
  }
  const seed = request.seed ?? linkSeedValue ?? DEFAULT_SEED;
  const params = settingsToSearchParams(settings);
  params.set("seed", String(seed));
  return { ok: true, settings, seed, mode: settings.mode, query: params.toString() };
}
