"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { PL_BADGES, PL_SEQUENCES, bouncePeriodSec, buildPowerPlan, resolvePowerLayersSettings, runFinishSec, sequencePowers, type PlBadge, type PlSequence } from "@/lib/physics/modes/powerLayers";

export interface PowerLayersSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const POWER_LAYERS_KEYS = ["plLayers", "plSequence", "plDrift", "plSpeed", "plBadge", "plPills"];

const SEQUENCE_OPTIONS: Record<PlSequence, { labelKey: string }> = {
  double: { labelKey: "plSeqDouble" },
  fibonacci: { labelKey: "plSeqFibonacci" },
  primes: { labelKey: "plSeqPrimes" },
  plusOne: { labelKey: "plSeqPlusOne" },
  random: { labelKey: "plSeqRandom" },
};

const BADGE_LABELS: Record<PlBadge, string> = { sound: "plBadgeSound", warning: "plBadgeWarning", both: "plBadgeBoth", none: "plBadgeNone" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** The run in numbers for the summary line: hits and seconds (null for chaos, whose hit count the seed decides). */
export function powerLayersRunInfo(s: SimulatorSettings): { hits: number; seconds: number; period: number } | null {
  // --- unlimited --- the run the engine plays: the layers at most at their memory-safety ceiling
  const pl = resolvePowerLayersSettings({ layers: s.plLayers, speed: s.plSpeed, sequence: s.plSequence });
  const period = bouncePeriodSec(pl.speed);
  if (pl.sequence === "random") return null;
  const hits = buildPowerPlan(pl.layers, pl.sequence).powers.length;
  return { hits, seconds: runFinishSec(hits, period), period };
}

/**
 * "Power layers" controls (feature odd-power-layers), shown in the Mode row while the mode is active (and in the Ball
 * section while the settings search is in use): the layers of the stack, the power sequence (with its first powers as
 * a hint), the drift, the bounce speed, the corner badge and the rule pills, and a line that sums the run up. The
 * values live in SimulatorSettings; Simulator.tsx forwards them to the engine (see lib/physics/modes/powerLayers.ts)
 * and restarts the run when the stack or the flight changes (the badge and the pills follow live).
 */
export default function PowerLayersSection({ t, search, matches, settings: s, update }: PowerLayersSectionProps) {
  const info = powerLayersRunInfo(s);
  const first = sequencePowers(s.plSequence, 6, () => 0.5);
  return (
    <div className="space-y-3 pt-2" data-testid="power-layers">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("plTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("plDesc")}</p>
        </div>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="plLayers" tipKey="plLayersTip" value={s.plLayers} range={RANGES.plLayers} onChange={(v) => update({ plLayers: v })} display={String(s.plLayers)} />
      <Searchable search={search} matches={matches} labelKey="plSequence">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("plSequence")}
            <Tooltip text={t("plSequenceTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("plSequence")}>
            {PL_SEQUENCES.map((id) => (
              <button type="button" key={id} onClick={() => update({ plSequence: id })} aria-pressed={s.plSequence === id} className={pick(s.plSequence === id)}>
                {t(SEQUENCE_OPTIONS[id].labelKey)}
              </button>
            ))}
          </div>
          {!search && (
            <p className="text-xs text-ink-3 leading-relaxed tabular-nums" data-testid="power-layers-sequence">
              {s.plSequence === "random" ? t("plHintRandom") : t("plHintPowers", { powers: first.join(", ") })}
            </p>
          )}
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="plDrift" tipKey="plDriftTip" value={s.plDrift} range={RANGES.plDrift} onChange={(v) => update({ plDrift: v })} display={s.plDrift.toFixed(2)} />
      <Slider t={t} search={search} matches={matches} labelKey="plSpeed" tipKey="plSpeedTip" value={s.plSpeed} range={RANGES.plSpeed} onChange={(v) => update({ plSpeed: v })} display={`${s.plSpeed.toFixed(2)}×`} />
      <Searchable search={search} matches={matches} labelKey="plBadge">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2" htmlFor="power-layers-badge">
            {t("plBadge")}
            <Tooltip text={t("plBadgeTip")} />
          </label>
          <select id="power-layers-badge" value={s.plBadge} onChange={(e) => update({ plBadge: e.target.value as PlBadge })} className={selectClass}>
            {PL_BADGES.map((id) => (
              <option key={id} value={id}>
                {t(BADGE_LABELS[id])}
              </option>
            ))}
          </select>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="plPills">
        <Toggle t={t} labelKey="plPills" tipKey="plPillsTip" value={s.plPills} onChange={(v) => update({ plPills: v })} />
      </Searchable>
      {!search && (
        <p className="text-xs text-ink-2 leading-relaxed tabular-nums" data-testid="power-layers-run">
          {info ? t("plRunInfo", { hits: info.hits, period: info.period.toFixed(2), seconds: info.seconds.toFixed(1) }) : t("plRunChaos", { period: bouncePeriodSec(s.plSpeed).toFixed(2) })}
        </p>
      )}
    </div>
  );
}
