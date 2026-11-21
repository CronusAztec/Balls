import type { ModeId } from "@/lib/physics/types";
import { hashString } from "./planner";
import type { BotPlatform } from "./playbook";
import { readyTemplates, templateById, templatePlayOf, type TemplateInfo } from "./templates";

/*
 * --- make-clip --- "Make me a clip": the studio's one press into the clip planner (the Mode block's starter area, the ready
 * screen and a studio address with `?make=1`). It plans one clip of a ready template (templates.ts) with the planner's own search
 * (useViralBot.ts makeClip: planTemplateSteps, the template's Simple look) and opens it: its settings, its hook, its melody, its
 * seed pinned and the clip length its run needs. This file picks the template: one of the current mode's, those that end
 * resolved first; a mode without one gets a ready template of another mode, from the series the daily bot plans (no battle
 * family: its third-party names are an opt-in). "Another" is the next turn: the mode's next template, a new plan seed.
 */

/** The studio address's switch: `?make=1` makes a clip as the page opens. */
export const MAKE_PARAM = "make";

/** The ending a made clip asks for: the run's payoff inside the clip, where the template plays it (else its own: resolveEnding). */
export const MAKE_CLIP_ENDING = "resolved" as const;

/** The templates a press can plan on `platform`: the ready ones that plan a length it takes, those that end resolved first. */
function playable(templates: readonly TemplateInfo[], platform: BotPlatform): string[] {
  const fits = templates.filter((t) => templatePlayOf(t.id)?.platforms.includes(platform) === true);
  const resolved = (t: TemplateInfo) => templatePlayOf(t.id)?.endings.includes(MAKE_CLIP_ENDING) === true;
  return [...fits.filter(resolved), ...fits.filter((t) => !resolved(t))].map((t) => t.id);
}

/** The templates a press plans from for `mode`: the mode's own (`own`), else the default series' that end resolved. */
export function makeClipTemplates(mode: ModeId, platform: BotPlatform): { own: boolean; ids: string[] } {
  const own = playable(
    readyTemplates("all").filter((t) => t.mode === mode),
    platform,
  );
  if (own.length > 0) return { own: true, ids: own };
  const others = playable(readyTemplates("default"), platform);
  const resolved = others.filter((id) => templatePlayOf(id)?.endings.includes(MAKE_CLIP_ENDING) === true);
  return { own: false, ids: resolved.length > 0 ? resolved : others };
}

export interface MakeClipPick {
  template: string;
  /** The template's mode: the page's own, or another one's when the page's has no template. */
  mode: ModeId;
  /** The planner's seed for this press (the same mode, turn and salt give the same clip). */
  planSeed: number;
  own: boolean;
}

/**
 * The template and the plan seed of press number `turn` (0 first, then each "Another") for `mode`; `salt` is the page's own
 * (a fresh one per visit), so visits get different clips and a press is the same within one. Null: no template plans there.
 */
export function makeClipPick(mode: ModeId, platform: BotPlatform, turn: number, salt: string): MakeClipPick | null {
  const { own, ids } = makeClipTemplates(mode, platform);
  if (ids.length === 0) return null;
  const at = Math.max(0, Math.floor(turn));
  // (the mode's own templates in their order, the best first; another mode's from a place of the visit's own)
  const start = own ? 0 : hashString(`make|${salt}`) % ids.length;
  const template = ids[(start + at) % ids.length];
  const info = templateById(template);
  if (!info) return null;
  return { template, mode: info.mode, planSeed: hashString(`make|${template}|${salt}|${at}`), own };
}

/** Whether a studio address asks for a clip as the page opens (`?make=1`). */
export function wantsMadeClip(search: string): boolean {
  return new URLSearchParams(search).get(MAKE_PARAM) === "1";
}
