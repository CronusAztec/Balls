"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import {
  EF_LAUNCHES,
  EF_MAX_RUN_ECCENTRICITY,
  EF_ORIENTATIONS,
  EF_PRESET_IDS,
  EF_PRESET_LABELS,
  EF_RESETS,
  EF_SKINS,
  bedBpm,
  efLoopSeconds,
  ellipseFociPresetPatch,
  type EfLaunch,
  type EfOrientation,
  type EfPresetId,
  type EfReset,
  type EfSkin,
} from "@/lib/physics/ellipseFoci";

/*
 * --- ellipse-foci --- The Focus Shot controls (lib/physics/ellipseFoci.ts), in the Mode row while the mode is active (and in the
 * Ball section while the settings search is in use): the presets, the volley (balls, spread, start angle, launch focus), the
 * pool (eccentricity, size, orientation), the timing (transit, passes per loop, what happens at a convergence), the look (skin,
 * comet trails, the paths overlay), the groove bed and the HUD's pass counter. Simulator.tsx hands the run to the engine (a
 * change of the volley, the pool or the timing restarts it; the look, the bed and the counter follow live) and Find Simulation
 * puts the convergences on the beat or finds the start angle of the longest collapse.
 */

export interface EllipseFociSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const ELLIPSE_FOCI_KEYS = ["efPreset", "efCount", "efEccentricity", "efSize", "efTransit", "efPasses", "efSpread", "efAim", "efLaunch", "efOrientation", "efTrail", "efReset", "efSkin", "efPaths", "efBed", "efCounter"];

const RESET_LABELS: Record<EfReset, string> = { refire: "efResetRefire", collapse: "efResetCollapse", every: "efResetEvery" };
const RESET_HINTS: Record<EfReset, string> = { refire: "efResetRefireHint", collapse: "efResetCollapseHint", every: "efResetEveryHint" };
const SKIN_LABELS: Record<EfSkin, string> = { table: "efSkinTable", neon: "efSkinNeon", minimal: "efSkinMinimal" };
const ORIENTATION_LABELS: Record<EfOrientation, string> = { vertical: "efOrientationVertical", horizontal: "efOrientationHorizontal" };
/** The launch focus by the pool's orientation: top / bottom standing, left / right lying down. */
const LAUNCH_LABELS: Record<EfOrientation, Record<EfLaunch, string>> = {
  vertical: { top: "efLaunchTop", bottom: "efLaunchBottom" },
  horizontal: { top: "efLaunchLeft", bottom: "efLaunchRight" },
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** A number as the panel shows it: at most `digits` decimals, trailing zeros dropped. */
function short(value: number, digits = 2): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(digits))) : "–";
}

export default function EllipseFociSection({ t, search, matches, settings: s, update }: EllipseFociSectionProps) {
  const loopSec = efLoopSeconds(s.efReset, s.efPasses, s.efTransit);
  const bpm = bedBpm(s.efTransit);
  const applyPreset = (id: EfPresetId) => update(ellipseFociPresetPatch(id));
  return (
    <div className="space-y-3 pt-2" data-testid="ellipse-foci-section" data-ef-reset={s.efReset} data-ef-skin={s.efSkin} data-ef-loop={loopSec === null ? "" : short(loopSec, 3)} data-ef-bpm={short(bpm, 2)}>
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("efDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="efPreset">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("efPreset")}
            <Tooltip text={t("efPresetTip")} />
          </span>
          <div className="grid grid-cols-2 gap-1.5" data-testid="ef-presets">
            {EF_PRESET_IDS.map((id) => (
              <button key={id} type="button" onClick={() => applyPreset(id)} className={pick(false)} data-ef-preset={id}>
                {t(EF_PRESET_LABELS[id])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="efCount" tipKey="efCountTip" value={s.efCount} range={RANGES.efCount} onChange={(v) => update({ efCount: v })} display={String(s.efCount)} />
      <Slider t={t} search={search} matches={matches} labelKey="efEccentricity" tipKey="efEccentricityTip" value={s.efEccentricity} range={RANGES.efEccentricity} onChange={(v) => update({ efEccentricity: v })} display={s.efEccentricity.toFixed(2)} />
      {!search && s.efEccentricity > EF_MAX_RUN_ECCENTRICITY && (
        <p className="text-xs text-warn" data-testid="ef-flat-note">
          {t("efFlatNote", { max: EF_MAX_RUN_ECCENTRICITY })}
        </p>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="efSize" tipKey="efSizeTip" value={s.efSize} range={RANGES.efSize} onChange={(v) => update({ efSize: v })} display={`${short(s.efSize, 1)}%`} />
      <Slider t={t} search={search} matches={matches} labelKey="efTransit" tipKey="efTransitTip" value={s.efTransit} range={RANGES.efTransit} onChange={(v) => update({ efTransit: v })} display={`${short(s.efTransit, 2)}s`} />
      <Slider t={t} search={search} matches={matches} labelKey="efPasses" tipKey="efPassesTip" value={s.efPasses} range={RANGES.efPasses} onChange={(v) => update({ efPasses: v })} display={String(s.efPasses)} />
      {!search && (
        <p className="text-xs text-ink-3 leading-relaxed" data-testid="ef-loop-note">
          {loopSec === null ? t("efLoopNoteCollapse", { transit: short(s.efTransit, 2), bpm: short(bpm, 1) }) : t("efLoopNote", { transit: short(s.efTransit, 2), bpm: short(bpm, 1), loop: short(loopSec, 2) })}
        </p>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="efSpread" tipKey="efSpreadTip" value={s.efSpread} range={RANGES.efSpread} onChange={(v) => update({ efSpread: v })} display={`${short(s.efSpread, 1)}°`} />
      <Slider t={t} search={search} matches={matches} labelKey="efAim" tipKey="efAimTip" value={s.efAim} range={RANGES.efAim} onChange={(v) => update({ efAim: v })} display={`${short(s.efAim, 1)}°`} />
      <ButtonRow t={t} search={search} matches={matches} labelKey="efLaunch" tipKey="efLaunchTip" values={EF_LAUNCHES} labels={LAUNCH_LABELS[s.efOrientation]} value={s.efLaunch} onChange={(efLaunch) => update({ efLaunch })} />
      <ButtonRow t={t} search={search} matches={matches} labelKey="efOrientation" tipKey="efOrientationTip" values={EF_ORIENTATIONS} labels={ORIENTATION_LABELS} value={s.efOrientation} onChange={(efOrientation) => update({ efOrientation })} />
      <ButtonRow t={t} search={search} matches={matches} labelKey="efReset" tipKey="efResetTip" values={EF_RESETS} labels={RESET_LABELS} value={s.efReset} onChange={(efReset) => update({ efReset })} hint={search ? undefined : t(RESET_HINTS[s.efReset])} />
      <ButtonRow t={t} search={search} matches={matches} labelKey="efSkin" tipKey="efSkinTip" values={EF_SKINS} labels={SKIN_LABELS} value={s.efSkin} onChange={(efSkin) => update({ efSkin })} />
      <Slider t={t} search={search} matches={matches} labelKey="efTrail" tipKey="efTrailTip" value={s.efTrail} range={RANGES.efTrail} onChange={(v) => update({ efTrail: v })} display={`${short(s.efTrail, 2)}s`} />
      <Searchable search={search} matches={matches} labelKey="efPaths">
        <Toggle t={t} labelKey="efPaths" tipKey="efPathsTip" value={s.efPaths} onChange={(v) => update({ efPaths: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="efBed">
        <Toggle t={t} labelKey="efBed" tipKey="efBedTip" value={s.efBed} onChange={(v) => update({ efBed: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="efCounter">
        <Toggle t={t} labelKey="efCounter" tipKey="efCounterTip" value={s.efCounter} onChange={(v) => update({ efCounter: v, ...(v ? { loopHud: true } : {}) })} />
      </Searchable>
    </div>
  );
}

/** One of the section's option rows (a labelled group of buttons, the active one pressed; an optional hint under it). */
function ButtonRow<V extends string>({ t, search, matches, labelKey, tipKey, values, labels, value, onChange, hint }: { t: Translate; search: string; matches: Matcher; labelKey: string; tipKey: string; values: readonly V[]; labels: Record<V, string>; value: V; onChange: (v: V) => void; hint?: string }) {
  return (
    <Searchable search={search} matches={matches} labelKey={labelKey}>
      <div className="space-y-1.5">
        <span className="text-sm font-medium text-ink-2 flex items-center">
          {t(labelKey)}
          <Tooltip text={t(tipKey)} />
        </span>
        <div className={`grid gap-1 ${values.length > 2 ? "grid-cols-3" : "grid-cols-2"}`} role="group" aria-label={t(labelKey)}>
          {values.map((v) => (
            <button type="button" key={v} onClick={() => onChange(v)} aria-pressed={value === v} className={pick(value === v)} data-ef-option={`${labelKey}:${v}`}>
              {t(String(labels[v]))}
            </button>
          ))}
        </div>
        {hint && <p className="text-xs text-ink-3 leading-relaxed">{hint}</p>}
      </div>
    </Searchable>
  );
}
