"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { DP_STRING_LAYOUTS, type DpStringLayout } from "@/lib/physics/modes/doublePendulum";

export interface DoublePendulumSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const DOUBLE_PENDULUM_KEYS = [
  "dpSegments",
  "dpCount",
  "dpSpar",
  "dpRandomStart",
  "dpAngle1",
  "dpAngle2",
  "dpAngle3",
  "dpLength1",
  "dpLength2",
  "dpLength3",
  "dpMass1",
  "dpMass2",
  "dpMass3",
  "dpGravity",
  "dpDamping",
  "dpTrailSeconds",
  "dpStrings",
  "dpStringLayout",
  "dpOctaves",
  "dpEndless",
];

const LAYOUT_OPTIONS: Record<DpStringLayout, { icon: string; labelKey: string }> = {
  vertical: { icon: "🎼", labelKey: "dpStringLayoutVertical" },
  radial: { icon: "✳️", labelKey: "dpStringLayoutRadial" },
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`;

/** Percent of its speed the pendulum keeps losing per second for a per-step velocity loss `d` (60 steps a second). */
export function dampingPerSecond(d: number): number {
  return 1 - Math.pow(1 - d, 60);
}

function GroupTitle({ children }: { children: string }) {
  return <p className="pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">{children}</p>;
}

/**
 * "Double pendulum" controls of the Double Pendulum mode, shown in the Mode row while the mode is active (and in the
 * Ball section while the settings search is in use): the rig (arms, pendulums, sparring), the start (seeded or three
 * angles), the physics (arm lengths, bob masses, gravity, friction), the look and the harp (trail, strings, layout,
 * octaves) and the end of the run. The values live in SimulatorSettings like everything else; Simulator.tsx forwards
 * them to the engine (see lib/physics/modes/doublePendulum.ts), restarting the rig when the swing changes.
 */
export default function DoublePendulumSection({ t, search, matches, settings: s, update }: DoublePendulumSectionProps) {
  const triple = s.dpSegments >= 3;
  const showThird = triple || !!search;
  const showAngles = !s.dpRandomStart || !!search;
  const pct = (v: number) => `${Math.round(100 * v)}%`;
  const deg = (v: number) => `${v}°`;
  const damping = s.dpDamping > 0 ? `${Math.max(1, Math.round(100 * dampingPerSecond(s.dpDamping)))}%/s` : t("dpOff");
  return (
    <div className="space-y-3 pt-2" data-testid="double-pendulum">
      {!search && <p className="text-xs text-zinc-500 leading-relaxed">{t("dpDesc")}</p>}
      {!search && <GroupTitle>{t("dpGroupRig")}</GroupTitle>}
      <Searchable search={search} matches={matches} labelKey="dpSegments">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">
            {t("dpSegments")}
            <Tooltip text={t("dpSegmentsTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("dpSegments")}>
            {[2, 3].map((n) => (
              <button type="button" key={n} onClick={() => update({ dpSegments: n })} aria-pressed={s.dpSegments === n} className={pick(s.dpSegments === n)}>
                {t(n === 2 ? "dpSegmentsDouble" : "dpSegmentsTriple")}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="dpCount" tipKey="dpCountTip" value={s.dpSpar ? 2 : s.dpCount} range={RANGES.dpCount} onChange={(v) => update({ dpCount: v })} display={s.dpSpar ? t("dpSparCount") : String(s.dpCount)} left="1" right="4" disabled={s.dpSpar} />
      <Searchable search={search} matches={matches} labelKey="dpSpar">
        <Toggle t={t} labelKey="dpSpar" tipKey="dpSparTip" value={s.dpSpar} onChange={(v) => update({ dpSpar: v })} />
      </Searchable>
      {!search && <GroupTitle>{t("dpGroupStart")}</GroupTitle>}
      <Searchable search={search} matches={matches} labelKey="dpRandomStart">
        <Toggle t={t} labelKey="dpRandomStart" tipKey="dpRandomStartTip" value={s.dpRandomStart} onChange={(v) => update({ dpRandomStart: v })} />
      </Searchable>
      {showAngles && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="dpAngle1" tipKey="dpAngleTip" value={s.dpAngle1} range={RANGES.dpAngle1} onChange={(v) => update({ dpAngle1: v })} display={deg(s.dpAngle1)} left="↺" right="↻" />
          <Slider t={t} search={search} matches={matches} labelKey="dpAngle2" tipKey="dpAngleTip" value={s.dpAngle2} range={RANGES.dpAngle2} onChange={(v) => update({ dpAngle2: v })} display={deg(s.dpAngle2)} left="↺" right="↻" />
          {showThird && <Slider t={t} search={search} matches={matches} labelKey="dpAngle3" tipKey="dpAngleTip" value={s.dpAngle3} range={RANGES.dpAngle3} onChange={(v) => update({ dpAngle3: v })} display={deg(s.dpAngle3)} left="↺" right="↻" />}
        </>
      )}
      {!search && <GroupTitle>{t("dpGroupPhysics")}</GroupTitle>}
      <Slider t={t} search={search} matches={matches} labelKey="dpLength1" tipKey="dpLengthTip" value={s.dpLength1} range={RANGES.dpLength1} onChange={(v) => update({ dpLength1: v })} display={pct(s.dpLength1)} left="—" right="———" />
      <Slider t={t} search={search} matches={matches} labelKey="dpLength2" tipKey="dpLengthTip" value={s.dpLength2} range={RANGES.dpLength2} onChange={(v) => update({ dpLength2: v })} display={pct(s.dpLength2)} left="—" right="———" />
      {showThird && <Slider t={t} search={search} matches={matches} labelKey="dpLength3" tipKey="dpLengthTip" value={s.dpLength3} range={RANGES.dpLength3} onChange={(v) => update({ dpLength3: v })} display={pct(s.dpLength3)} left="—" right="———" />}
      <Slider t={t} search={search} matches={matches} labelKey="dpMass1" tipKey="dpMassTip" value={s.dpMass1} range={RANGES.dpMass1} onChange={(v) => update({ dpMass1: v })} display={s.dpMass1.toFixed(1)} left="🪶" right="🪨" />
      <Slider t={t} search={search} matches={matches} labelKey="dpMass2" tipKey="dpMassTip" value={s.dpMass2} range={RANGES.dpMass2} onChange={(v) => update({ dpMass2: v })} display={s.dpMass2.toFixed(1)} left="🪶" right="🪨" />
      {showThird && <Slider t={t} search={search} matches={matches} labelKey="dpMass3" tipKey="dpMassTip" value={s.dpMass3} range={RANGES.dpMass3} onChange={(v) => update({ dpMass3: v })} display={s.dpMass3.toFixed(1)} left="🪶" right="🪨" />}
      <Slider t={t} search={search} matches={matches} labelKey="dpGravity" tipKey="dpGravityTip" value={s.dpGravity} range={RANGES.dpGravity} onChange={(v) => update({ dpGravity: v })} display={`×${s.dpGravity.toFixed(2)}`} left="🎈" right="🪨" />
      <Slider t={t} search={search} matches={matches} labelKey="dpDamping" tipKey="dpDampingTip" value={s.dpDamping} range={RANGES.dpDamping} onChange={(v) => update({ dpDamping: v })} display={damping} left="∞" right="🛑" />
      {!search && <GroupTitle>{t("dpGroupHarp")}</GroupTitle>}
      <Slider t={t} search={search} matches={matches} labelKey="dpTrailSeconds" tipKey="dpTrailSecondsTip" value={s.dpTrailSeconds} range={RANGES.dpTrailSeconds} onChange={(v) => update({ dpTrailSeconds: v })} display={s.dpTrailSeconds > 0 ? `${s.dpTrailSeconds}s` : t("dpOff")} left="•" right="〰️" />
      <Slider t={t} search={search} matches={matches} labelKey="dpStrings" tipKey="dpStringsTip" value={s.dpStrings} range={RANGES.dpStrings} onChange={(v) => update({ dpStrings: v })} display={s.dpStrings > 0 ? String(s.dpStrings) : t("dpOff")} left="🔇" right="🎼" />
      {(s.dpStrings > 0 || !!search) && (
        <>
          <Searchable search={search} matches={matches} labelKey="dpStringLayout">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">
                {t("dpStringLayout")}
                <Tooltip text={t("dpStringLayoutTip")} />
              </label>
              <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("dpStringLayout")}>
                {DP_STRING_LAYOUTS.map((layout) => (
                  <button type="button" key={layout} onClick={() => update({ dpStringLayout: layout })} aria-pressed={s.dpStringLayout === layout} className={pick(s.dpStringLayout === layout)}>
                    <span aria-hidden="true">{LAYOUT_OPTIONS[layout].icon}</span> {t(LAYOUT_OPTIONS[layout].labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </Searchable>
          <Slider t={t} search={search} matches={matches} labelKey="dpOctaves" tipKey="dpOctavesTip" value={s.dpOctaves} range={RANGES.dpOctaves} onChange={(v) => update({ dpOctaves: v })} display={String(s.dpOctaves)} left="🎵" right="🎶" />
        </>
      )}
      {!search && <GroupTitle>{t("dpGroupRun")}</GroupTitle>}
      <Searchable search={search} matches={matches} labelKey="dpEndless">
        <div className="space-y-1">
          <Toggle t={t} labelKey="dpEndless" tipKey="dpEndlessTip" value={s.dpEndless} onChange={(v) => update({ dpEndless: v })} />
          <p className="text-[11px] text-zinc-500" data-testid="dp-run-length">
            {s.dpEndless ? t("dpRunEndless") : t("dpRunLength", { duration: s.recordingDuration })}
          </p>
        </div>
      </Searchable>
    </div>
  );
}
