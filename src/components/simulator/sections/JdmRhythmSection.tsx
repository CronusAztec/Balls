"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import type { PaintBeatInfo } from "./PicturePaintSection";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { RUNNER_BEAT_SOURCES, RUNNER_MIXES, buildRunnerCourse, runnerSettingsOf, type RunnerBeatSource, type RunnerMix } from "@/lib/physics/modes/runner";

/**
 * The Mode-row blocks of feature jdm-rhythm-runner: "Beat runner" (auto jump, obstacles, speed, jump height, density,
 * the obstacle mix, the beat source with what it follows right now, and a line that sums the run up) and "Paddle
 * keep-up" (auto controller, skill, misses allowed, platform width, spin, speed-up). The values live in SimulatorSettings;
 * Simulator.tsx forwards them to the engine (lib/physics/modes/runner.ts, paddle.ts) and restarts the run when one changes.
 */

export interface JdmRhythmSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  /** The loaded song's detected beat (Picture Paint's detector): what a "song" beat source follows. */
  beat?: PaintBeatInfo | null;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const RUNNER_KEYS = ["rrAutoJump", "rrObstacles", "rrSpeed", "rrJump", "rrDensity", "rrMix", "rrBeatSource"];
export const PADDLE_KEYS = ["pdAuto", "pdSkill", "pdMisses", "pdWidth", "pdSpin", "pdSpeedUp"];
export const JDM_RHYTHM_KEYS = [...RUNNER_KEYS, ...PADDLE_KEYS];

const MIX_OPTIONS: Record<RunnerMix, { labelKey: string }> = {
  mixed: { labelKey: "rrMixMixed" },
  spikes: { labelKey: "rrMixSpikes" },
  blocks: { labelKey: "rrMixBlocks" },
  gaps: { labelKey: "rrMixGaps" },
};
const SOURCE_OPTIONS: Record<RunnerBeatSource, { labelKey: string }> = {
  song: { labelKey: "rrBeatSong" },
  bpm: { labelKey: "rrBeatBpm" },
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** The run in numbers for the summary line: obstacles, tempo and about how long an auto run lasts (a mid seed's course). */
export function runnerRunInfo(s: SimulatorSettings, beat?: PaintBeatInfo | null): { obstacles: number; bpm: number; seconds: number } {
  const followsSong = s.runnerBeatSource === "song" && beat?.bpm;
  const bpm = followsSong ? beat!.bpm! : s.bpm;
  const course = buildRunnerCourse({ ...runnerSettingsOf(s), bpm }, s.gravity, () => 0.5);
  return { obstacles: s.runnerObstacles, bpm: Math.round(bpm), seconds: course.endSec };
}

export function RunnerSection({ t, search, matches, settings: s, update, beat }: JdmRhythmSectionProps) {
  const info = !search ? runnerRunInfo(s, beat) : null;
  const beatLine =
    s.runnerBeatSource === "bpm"
      ? t("rrBeatInfoBpm", { bpm: s.bpm })
      : beat?.bpm
        ? t("rrBeatInfoSong", { bpm: Math.round(beat.bpm) })
        : beat?.analyzing
          ? t("rrBeatAnalyzing")
          : t("rrBeatInfoNoSong", { bpm: s.bpm });
  return (
    <div className="space-y-3 pt-2" data-testid="runner-section">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("rrTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("rrDesc")}</p>
        </div>
      )}
      <Searchable search={search} matches={matches} labelKey="rrAutoJump">
        <Toggle t={t} labelKey="rrAutoJump" tipKey="rrAutoJumpTip" value={s.runnerAutoJump} onChange={(v) => update({ runnerAutoJump: v })} />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="rrObstacles" tipKey="rrObstaclesTip" value={s.runnerObstacles} range={RANGES.runnerObstacles} onChange={(v) => update({ runnerObstacles: v })} display={String(s.runnerObstacles)} />
      <Slider t={t} search={search} matches={matches} labelKey="rrSpeed" tipKey="rrSpeedTip" value={s.runnerSpeed} range={RANGES.runnerSpeed} onChange={(v) => update({ runnerSpeed: v })} display={`${s.runnerSpeed} ▪/s`} />
      <Slider t={t} search={search} matches={matches} labelKey="rrJump" tipKey="rrJumpTip" value={s.runnerJump} range={RANGES.runnerJump} onChange={(v) => update({ runnerJump: v })} display={`${s.runnerJump.toFixed(1)} ▪`} />
      <Slider t={t} search={search} matches={matches} labelKey="rrDensity" tipKey="rrDensityTip" value={s.runnerDensity} range={RANGES.runnerDensity} onChange={(v) => update({ runnerDensity: v })} display={`${Math.round(100 * s.runnerDensity)}%`} />
      <Searchable search={search} matches={matches} labelKey="rrMix">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("rrMix")}
            <Tooltip text={t("rrMixTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("rrMix")}>
            {RUNNER_MIXES.map((id) => (
              <button type="button" key={id} onClick={() => update({ runnerMix: id })} aria-pressed={s.runnerMix === id} className={pick(s.runnerMix === id)}>
                {t(MIX_OPTIONS[id].labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="rrBeatSource">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("rrBeatSource")}
            <Tooltip text={t("rrBeatSourceTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("rrBeatSource")}>
            {RUNNER_BEAT_SOURCES.map((id) => (
              <button type="button" key={id} onClick={() => update({ runnerBeatSource: id })} aria-pressed={s.runnerBeatSource === id} className={pick(s.runnerBeatSource === id)}>
                {t(SOURCE_OPTIONS[id].labelKey)}
              </button>
            ))}
          </div>
          {!search && (
            <p className="text-xs text-ink-3 leading-relaxed tabular-nums" data-testid="runner-beat">
              {beatLine}
            </p>
          )}
        </div>
      </Searchable>
      {info && (
        <p className="text-xs text-ink-2 leading-relaxed tabular-nums" data-testid="runner-run">
          {s.runnerAutoJump ? t("rrRunInfo", { obstacles: info.obstacles, bpm: info.bpm, seconds: info.seconds.toFixed(1) }) : t("rrManualInfo", { obstacles: info.obstacles })}
        </p>
      )}
    </div>
  );
}

export function PaddleSection({ t, search, matches, settings: s, update }: JdmRhythmSectionProps) {
  return (
    <div className="space-y-3 pt-2" data-testid="paddle-section">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("pdTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("pdDesc")}</p>
        </div>
      )}
      <Searchable search={search} matches={matches} labelKey="pdAuto">
        <Toggle t={t} labelKey="pdAuto" tipKey="pdAutoTip" value={s.pdAuto} onChange={(v) => update({ pdAuto: v })} />
      </Searchable>
      {(s.pdAuto || !!search) && (
        <Slider t={t} search={search} matches={matches} labelKey="pdSkill" tipKey="pdSkillTip" value={s.pdSkill} range={RANGES.pdSkill} onChange={(v) => update({ pdSkill: v })} display={`${Math.round(100 * s.pdSkill)}%`} />
      )}
      <Slider t={t} search={search} matches={matches} labelKey="pdMisses" tipKey="pdMissesTip" value={s.pdMisses} range={RANGES.pdMisses} onChange={(v) => update({ pdMisses: v })} display={String(s.pdMisses)} />
      <Slider t={t} search={search} matches={matches} labelKey="pdWidth" tipKey="pdWidthTip" value={s.pdWidth} range={RANGES.pdWidth} onChange={(v) => update({ pdWidth: v })} display={`${Math.round(100 * s.pdWidth)}%`} />
      <Slider t={t} search={search} matches={matches} labelKey="pdSpin" tipKey="pdSpinTip" value={s.pdSpin} range={RANGES.pdSpin} onChange={(v) => update({ pdSpin: v })} display={s.pdSpin.toFixed(2)} />
      <Slider t={t} search={search} matches={matches} labelKey="pdSpeedUp" tipKey="pdSpeedUpTip" value={s.pdSpeedUp} range={RANGES.pdSpeedUp} onChange={(v) => update({ pdSpeedUp: v })} display={`+${(100 * s.pdSpeedUp).toFixed(1)}%`} />
      {!search && (
        <p className="text-xs text-ink-2 leading-relaxed" data-testid="paddle-info">
          {!s.pdAuto ? t("pdInfoManual") : s.pdSkill >= 1 ? t("pdInfoPerfect") : t("pdInfoAuto", { lives: s.pdMisses + 1 })}
        </p>
      )}
    </div>
  );
}
