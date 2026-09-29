"use client";

import { Slider, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { WOBBLE_MODES } from "@/lib/physics/wobble";
import type { ModeId } from "@/lib/physics/types";

/** Search keys of the control rendered here (added to SECTION_KEYS.visual in Controls.tsx so the search box finds it). */
export const WALL_WOBBLE_KEYS = ["wallWobble"];

/** The modes with circular walls a ball hits: the ten ring modes and the Circle Illusion. */
export function hasWobblyWalls(mode: ModeId): boolean {
  return WOBBLE_MODES.includes(mode);
}

/**
 * The Wobbly Walls slider of the Visual section (feature jdm-illusions; project.jdm "Bouncy Circle"): 0 keeps perfect
 * circles, above that every circular wall bulges where a ball hits it and the bulge travels round the wall and dies away
 * (render-only – lib/physics/wobble.ts). Shown in the modes with circular walls, and whenever the search box is in use.
 */
export default function WallWobbleSection({ t, search, matches, settings: s, update }: { t: Translate; search: string; matches: Matcher; settings: SimulatorSettings; update: (patch: Partial<SimulatorSettings>) => void }) {
  if (!hasWobblyWalls(s.mode) && !search) return null;
  return (
    <Slider
      t={t}
      search={search}
      matches={matches}
      labelKey="wallWobble"
      tipKey="wallWobbleTip"
      value={s.wallWobble}
      range={RANGES.wallWobble}
      onChange={(v) => update({ wallWobble: v })}
      display={s.wallWobble === 0 ? t("wallWobbleOff") : `${Math.round(100 * s.wallWobble)}%`}
      left="⭕"
      right="🫧"
    />
  );
}
