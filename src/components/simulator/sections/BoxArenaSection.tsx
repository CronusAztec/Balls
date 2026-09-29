"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { BOX_SHAPES, BOX_SPEED_RATIOS, type BoxShape } from "@/lib/physics/modes/box";

export interface BoxArenaSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const BOX_ARENA_KEYS = ["boxShape", "boxShapeCount", "boxSpeedRatio", "boxCountdown", "boxGrowPerHit", "boxGravity", "boxAspect"];

const SHAPE_OPTIONS: Record<BoxShape, { icon: string; labelKey: string }> = {
  square: { icon: "🟩", labelKey: "boxShapeSquare" },
  circle: { icon: "🟢", labelKey: "boxShapeCircle" },
  dvd: { icon: "📀", labelKey: "boxShapeDvd" },
};

/** Familiar names for the aspect slider's landmark values. */
const ASPECT_LABELS: [number, string][] = [
  [0.56, "9:16"],
  [0.75, "3:4"],
  [1, "1:1"],
  [1.33, "4:3"],
  [1.78, "16:9"],
];

export function formatAspect(aspect: number): string {
  for (const [value, label] of ASPECT_LABELS) if (Math.abs(aspect - value) < 0.006) return label;
  return `${aspect.toFixed(2)}:1`;
}

const pct = (v: number) => `${Math.round(100 * v)}%`;

/**
 * "Box arena" controls of the Bouncing Shapes mode, shown in the Mode row while the mode is active (and in
 * the Ball section while the settings search is in use): shape kind and count, speed ratio, countdown,
 * growth per hit, gravity and the box's aspect. The values live in SimulatorSettings like everything else;
 * Simulator.tsx forwards them to the engine (see lib/physics/modes/box.ts) and restarts the box when they change.
 */
export default function BoxArenaSection({ t, search, matches, settings: s, update }: BoxArenaSectionProps) {
  return (
    <div className="space-y-3 pt-2">
      {!search && <p className="text-xs text-zinc-500 leading-relaxed">{t("boxDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="boxShape">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">
            {t("boxShape")}
            <Tooltip text={t("boxShapeTip")} />
          </label>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("boxShape")}>
            {BOX_SHAPES.map((shape) => (
              <button
                type="button"
                key={shape}
                onClick={() => update({ boxShape: shape })}
                aria-pressed={s.boxShape === shape}
                className={`px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.boxShape === shape ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
              >
                <span aria-hidden="true">{SHAPE_OPTIONS[shape].icon}</span> {t(SHAPE_OPTIONS[shape].labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="boxShapeCount" tipKey="boxShapeCountTip" value={s.boxShapeCount} range={RANGES.boxShapeCount} onChange={(v) => update({ boxShapeCount: v })} display={String(s.boxShapeCount)} left="◽" right="🔳" />
      <Searchable search={search} matches={matches} labelKey="boxSpeedRatio">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">
            {t("boxSpeedRatio")}
            <Tooltip text={t("boxSpeedRatioTip")} />
          </label>
          <div className="grid grid-cols-4 gap-1" role="group" aria-label={t("boxSpeedRatio")}>
            {BOX_SPEED_RATIOS.map((ratio) => (
              <button
                type="button"
                key={ratio}
                onClick={() => update({ boxSpeedRatio: ratio })}
                aria-pressed={s.boxSpeedRatio === ratio}
                className={`px-1 py-1.5 rounded-lg text-xs font-medium tabular-nums transition-all cursor-pointer ${s.boxSpeedRatio === ratio ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
              >
                {ratio}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500 leading-relaxed">{t("boxSpeedRatioDesc")}</p>
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="boxCountdown" tipKey="boxCountdownTip" value={s.boxCountdown} range={RANGES.boxCountdown} onChange={(v) => update({ boxCountdown: v })} display={s.boxCountdown === 0 ? t("boxCountdownOff") : String(s.boxCountdown)} left="∞" right="99" />
      <Slider t={t} search={search} matches={matches} labelKey="boxGrowPerHit" tipKey="boxGrowPerHitTip" value={s.boxGrowPerHit} range={RANGES.boxGrowPerHit} onChange={(v) => update({ boxGrowPerHit: v })} display={`${s.boxGrowPerHit.toFixed(1)}%`} left="▫️" right="⬜" />
      <Slider t={t} search={search} matches={matches} labelKey="boxGravity" tipKey="boxGravityTip" value={s.boxGravity} range={RANGES.boxGravity} onChange={(v) => update({ boxGravity: v })} display={pct(s.boxGravity)} left="🛸" right="🪨" />
      <Slider t={t} search={search} matches={matches} labelKey="boxAspect" tipKey="boxAspectTip" value={s.boxAspect} range={RANGES.boxAspect} onChange={(v) => update({ boxAspect: v })} display={formatAspect(s.boxAspect)} left="📱" right="🖥️" />
    </div>
  );
}
