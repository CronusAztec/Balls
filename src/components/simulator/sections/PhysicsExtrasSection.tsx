"use client";

import Tooltip from "../Tooltip";
import { Slider, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";

export interface PhysicsExtrasProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the "Advanced physics" group of the Ball section (added to SECTION_KEYS.ball in Controls.tsx). */
export const BALL_PHYSICS_EXTRA_KEYS = ["airDrag", "windX", "windY", "spinStrength", "rotatingGravity"];
/** Search keys of the "Advanced physics" group of the Wall section (added to SECTION_KEYS.wall in Controls.tsx). */
export const WALL_PHYSICS_EXTRA_KEYS = ["wallBounciness", "breathingWalls", "breathingSpeed"];

/** Group heading; hidden while the settings search is in use (the sliders are found on their own). */
function GroupTitle({ t, search }: { t: Translate; search: string }) {
  if (search) return null;
  return (
    <div className="space-y-1 border-t border-line pt-3">
      <label className="text-sm font-medium text-ink-2">
        {t("advancedPhysics")}
        <Tooltip text={t("advancedPhysicsTip")} />
      </label>
      <p className="text-xs text-ink-3 leading-relaxed">{t("advancedPhysicsDesc")}</p>
    </div>
  );
}

const signed = (v: number, digits: number) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
const pct = (v: number) => `${Math.round(100 * v)}%`;

/**
 * "Advanced physics" group of the Ball & Physics section: air drag, wind, spin and rotating
 * gravity. The values live in SimulatorSettings like everything else; Simulator.tsx forwards
 * them to the engine (see lib/physics/extras.ts). Shown with the advanced-options toggle.
 */
export function BallPhysicsExtras({ t, search, matches, settings: s, update }: PhysicsExtrasProps) {
  return (
    <>
      <GroupTitle t={t} search={search} />
      <Slider t={t} search={search} matches={matches} labelKey="airDrag" tipKey="airDragTip" value={s.airDrag} range={RANGES.airDrag} onChange={(v) => update({ airDrag: v })} display={`${(100 * s.airDrag).toFixed(1)}%`} />
      <Slider t={t} search={search} matches={matches} labelKey="windX" tipKey="windXTip" value={s.windX} range={RANGES.windX} onChange={(v) => update({ windX: v })} display={signed(s.windX, 2)} />
      <Slider t={t} search={search} matches={matches} labelKey="windY" tipKey="windYTip" value={s.windY} range={RANGES.windY} onChange={(v) => update({ windY: v })} display={signed(s.windY, 2)} />
      <Slider t={t} search={search} matches={matches} labelKey="spinStrength" tipKey="spinStrengthTip" value={s.spinStrength} range={RANGES.spinStrength} onChange={(v) => update({ spinStrength: v })} display={pct(s.spinStrength)} />
      <Slider t={t} search={search} matches={matches} labelKey="rotatingGravity" tipKey="rotatingGravityTip" value={s.rotatingGravity} range={RANGES.rotatingGravity} onChange={(v) => update({ rotatingGravity: v })} display={`${s.rotatingGravity}°/s`} />
    </>
  );
}

/**
 * "Advanced physics" group of the Wall Settings section: wall bounciness (restitution) and
 * breathing walls (amplitude + speed). Shown with the advanced-options toggle.
 */
export function WallPhysicsExtras({ t, search, matches, settings: s, update }: PhysicsExtrasProps) {
  return (
    <>
      <GroupTitle t={t} search={search} />
      <Slider t={t} search={search} matches={matches} labelKey="wallBounciness" tipKey="wallBouncinessTip" value={s.wallBounciness} range={RANGES.wallBounciness} onChange={(v) => update({ wallBounciness: v })} display={pct(s.wallBounciness)} />
      <Slider t={t} search={search} matches={matches} labelKey="breathingWalls" tipKey="breathingWallsTip" value={s.breathingAmplitude} range={RANGES.breathingAmplitude} onChange={(v) => update({ breathingAmplitude: v })} display={pct(s.breathingAmplitude)} />
      {(s.breathingAmplitude > 0 || !!search) && (
        <Slider t={t} search={search} matches={matches} labelKey="breathingSpeed" tipKey="breathingSpeedTip" value={s.breathingSpeed} range={RANGES.breathingSpeed} onChange={(v) => update({ breathingSpeed: v })} display={`${s.breathingSpeed.toFixed(1)} Hz`} />
      )}
    </>
  );
}
