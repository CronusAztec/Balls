"use client";

import { useMemo } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import {
  OG_ARRANGEMENTS,
  OG_DISTRIBUTIONS,
  OG_FLOORS,
  OG_MATERIALS,
  OG_PALETTES,
  OG_PROPERTIES,
  OG_RELEASES,
  OG_SOUNDS,
  ORB_GRID_PRESETS,
  orbGridPresetFields,
  orbGridSettingsOf,
  orbGridSummary,
  orbRhythmSummary,
  type OgArrangement,
  type OgDistribution,
  type OgFloor,
  type OgMaterial,
  type OgPalette,
  type OgProperty,
  type OgRelease,
  type OgSound,
  type OrbGridFields,
  type OrbGridPreset,
} from "@/lib/physics/modes/orbGrid";
import OrbRhythmSection, { ORB_RHYTHM_KEYS, OrbModelSwitch } from "./OrbRhythmSection"; // --- orb-rhythm --- the model switch, the rhythm and the metronome

export interface OrbGridSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the Bouncing Orbs block (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const ORB_GRID_KEYS = ["ogColumns", "ogRows", "ogArrangement", "ogVaried", "ogDistribution", "ogSpread", "ogRelease", "ogStagger", "ogDropHeight", "ogOrbSize", "ogBounciness", "ogResolve", "ogElevation", "ogRotation", "ogOrbit", "ogFloor", "ogMaterial", "ogPalette", "ogHud", "ogSound", ...ORB_RHYTHM_KEYS /* --- orb-rhythm --- */];

/** The option labels (Controls namespace). */
const ARRANGEMENT_LABELS: Record<OgArrangement, string> = { grid: "ogArrGrid", disc: "ogArrDisc", octagons: "ogArrOctagons", hex: "ogArrHex" };
const PROPERTY_LABELS: Record<OgProperty, string> = { bounciness: "ogPropBounciness", height: "ogPropHeight", delay: "ogPropDelay", size: "ogPropSize", gravity: "ogPropGravity", period: "ogPropPeriod" };
const DISTRIBUTION_LABELS: Record<OgDistribution, string> = { varied: "ogDistVaried", corner: "ogDistCorner", centre: "ogDistCentre", rows: "ogDistRows", columns: "ogDistColumns", spiral: "ogDistSpiral", ripple: "ogDistRipple", checker: "ogDistChecker" };
const RELEASE_LABELS: Record<OgRelease, string> = { together: "ogRelTogether", "outside-in": "ogRelOutsideIn", "inside-out": "ogRelInsideOut", "row-by-row": "ogRelRowByRow", random: "ogRelRandom" };
const FLOOR_LABELS: Record<OgFloor, string> = { slab: "ogFloorSlab", plate: "ogFloorPlate", grid: "ogFloorGrid", none: "ogFloorNone" };
const MATERIAL_LABELS: Record<OgMaterial, string> = { glossy: "ogMatGlossy", metallic: "ogMatMetallic", matte: "ogMatMatte", glass: "ogMatGlass" };
const PALETTE_LABELS: Record<OgPalette, string> = { height: "ogPalHeight", rings: "ogPalRings", rows: "ogPalRows", ball: "ogPalBall", "rainbow-field": "ogPalRainbowField" };
const SOUND_LABELS: Record<OgSound, string> = { notes: "ogSndNotes", sleep: "ogSndSleep", music: "ogSndMusic", metal: "ogSndMetal", silent: "ogSndSilent" };

/** An option's translation key (a plain string for the typed translator). */
const labelOf = <T extends string>(labels: Record<T, string>, id: T): string => labels[id];

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** A row of option buttons (a few short options). */
function OptionButtons<T extends string>({ t, labelKey, tipKey, options, labels, value, onChange, testId, cols }: { t: Translate; labelKey: string; tipKey: string; options: readonly T[]; labels: Record<T, string>; value: T; onChange: (v: T) => void; testId: string; cols: number }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-ink-2">
        {t(labelKey)}
        <Tooltip text={t(tipKey)} />
      </label>
      <div className={`grid gap-1 ${cols === 5 ? "grid-cols-5" : cols === 3 ? "grid-cols-3" : "grid-cols-4"}`} role="group" aria-label={t(labelKey)}>
        {options.map((id) => (
          <button type="button" key={id} onClick={() => onChange(id)} aria-pressed={value === id} className={pick(value === id)} data-testid={`${testId}-${id}`}>
            {t(labelOf(labels, id))}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A select of options (the longer lists). */
function OptionSelect<T extends string>({ t, labelKey, tipKey, options, labels, value, onChange, testId }: { t: Translate; labelKey: string; tipKey: string; options: readonly T[]; labels: Record<T, string>; value: T; onChange: (v: T) => void; testId: string }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-ink-2" htmlFor={testId}>
        {t(labelKey)}
        <Tooltip text={t(tipKey)} />
      </label>
      <select id={testId} value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={t(labelKey)} className={`${selectClass} text-sm`} data-testid={testId}>
        {options.map((id) => (
          <option key={id} value={id}>
            {t(labelOf(labels, id))}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * "Bouncing Orbs" controls (feature orb-grid), shown in the Mode row while Bouncing Orbs is the mode (and in the Ball section
 * while the settings search is in use): the field (columns, rows, arrangement), the variation (the varied property, its
 * distribution and spread, the release order and stagger, the drop height, orb size, bounciness and the resolve tuning), the
 * look (material, palette, camera, floor, the HUD line) and the sound, with a line that sums the run up for Find Simulation.
 * The values live in SimulatorSettings; Simulator.tsx forwards them to the engine (lib/physics/modes/orbGrid.ts) and restarts
 * the run when a field of the physics changes (the look and the sound follow live). Every number has its number field and no
 * maximum.
 */
export default function OrbGridSection({ t, search, matches, settings: s, update }: OrbGridSectionProps) {
  // The summary plans the field once per change of the physics (pure; the seed's tempo aside).
  const summary = useMemo(
    () => orbGridSummary(orbGridSettingsOf(s), s.gravity),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.ogColumns, s.ogRows, s.ogArrangement, s.ogVaried, s.ogDistribution, s.ogSpread, s.ogRelease, s.ogStagger, s.ogDropHeight, s.ogOrbSize, s.ogBounciness, s.ogResolve, s.gravity],
  );
  const runParts = [t("ogRunOrbs", { orbs: summary.count })];
  // --- orb-rhythm --- a rhythm field: its groups and bounces a cycle, how often it is in phase, the metronome's bars and tempo
  const rhythm = s.ogModel === "rhythm";
  const rs = useMemo(
    () => (rhythm ? orbRhythmSummary(orbGridSettingsOf(s), s.gravity) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rhythm, s.ogColumns, s.ogRows, s.ogArrangement, s.ogSpread, s.ogDropHeight, s.ogPoly, s.ogGroup, s.ogCycle, s.ogRhythm, s.ogSteps, s.ogBpm, s.ogBeats, s.ogBars, s.ogMetro, s.ogClick, s.ogEq, s.quantizeToBeat, s.bpm, s.gravity],
  );
  if (rs) {
    runParts.push(t("ogRunGroups", { groups: rs.groups }));
    runParts.push(rs.minCount === rs.maxCount ? t("ogRunCount", { count: rs.minCount }) : t("ogRunCounts", { min: rs.minCount, max: rs.maxCount }));
    runParts.push(Number.isFinite(rs.periodSec) ? t("ogRunPhase", { seconds: rs.periodSec.toFixed(1) }) : t("ogRunNeverPhase"));
    if (rs.metroOn) runParts.push(t("ogRunMetro", { bars: rs.bars, bpm: Math.round(rs.bpm * 10) / 10 }));
  } else {
    // --- end orb-rhythm ---
    runParts.push(Number.isFinite(summary.settleSec) ? t("ogRunSettles", { seconds: summary.settleSec.toFixed(1) }) : t("ogRunNever"));
    if (summary.resolveSec > 0) runParts.push(t("ogRunResolve", { seconds: summary.resolveSec.toFixed(1) }));
  } // --- orb-rhythm ---
  const decay = !rhythm || !!search; // --- orb-rhythm --- (the decay model's own controls)
  return (
    <div className="space-y-3 pt-2" data-testid="orb-grid">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("ogTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("ogDesc")}</p>
        </div>
      )}
      <OrbModelSwitch t={t} search={search} matches={matches} settings={s} update={update} /* --- orb-rhythm --- */ />
      {!search && <p className="text-xs font-bold uppercase tracking-wider text-ink-3 pt-1">{t("ogFieldHeading")}</p>}
      <Slider t={t} search={search} matches={matches} labelKey="ogColumns" tipKey="ogColumnsTip" value={s.ogColumns} range={RANGES.ogColumns} onChange={(v) => update({ ogColumns: v })} display={String(s.ogColumns)} />
      <Slider t={t} search={search} matches={matches} labelKey="ogRows" tipKey="ogRowsTip" value={s.ogRows} range={RANGES.ogRows} onChange={(v) => update({ ogRows: v })} display={String(s.ogRows)} />
      {summary.full && (
        <p className="text-xs text-warn" data-testid="orb-grid-full">
          {t("ogFull", { count: summary.count, requested: summary.requested })}
        </p>
      )}
      <Searchable search={search} matches={matches} labelKey="ogArrangement">
        <OptionButtons t={t} labelKey="ogArrangement" tipKey="ogArrangementTip" options={OG_ARRANGEMENTS} labels={ARRANGEMENT_LABELS} value={s.ogArrangement} onChange={(v) => update({ ogArrangement: v })} testId="orb-grid-arrangement" cols={4} />
      </Searchable>
      {(rhythm || !!search) && <OrbRhythmSection t={t} search={search} matches={matches} settings={s} update={update} /* --- orb-rhythm --- */ />}
      {decay && ( /* --- orb-rhythm --- the variation: the decay model's */
      <>
      {!search && <p className="text-xs font-bold uppercase tracking-wider text-ink-3 pt-1">{t("ogVariationHeading")}</p>}
      <Searchable search={search} matches={matches} labelKey="ogVaried">
        <OptionSelect t={t} labelKey="ogVaried" tipKey="ogVariedTip" options={OG_PROPERTIES} labels={PROPERTY_LABELS} value={s.ogVaried} onChange={(v) => update({ ogVaried: v })} testId="orb-grid-varied" />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="ogDistribution">
        <OptionSelect t={t} labelKey="ogDistribution" tipKey="ogDistributionTip" options={OG_DISTRIBUTIONS} labels={DISTRIBUTION_LABELS} value={s.ogDistribution} onChange={(v) => update({ ogDistribution: v })} testId="orb-grid-distribution" />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="ogSpread" tipKey="ogSpreadTip" value={s.ogSpread} range={RANGES.ogSpread} onChange={(v) => update({ ogSpread: v })} display={`${Math.round(100 * s.ogSpread)}%`} />
      <Searchable search={search} matches={matches} labelKey="ogRelease">
        <OptionSelect t={t} labelKey="ogRelease" tipKey="ogReleaseTip" options={OG_RELEASES} labels={RELEASE_LABELS} value={s.ogRelease} onChange={(v) => update({ ogRelease: v })} testId="orb-grid-release" />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="ogStagger" tipKey="ogStaggerTip" value={s.ogStagger} range={RANGES.ogStagger} onChange={(v) => update({ ogStagger: v })} display={`${s.ogStagger.toFixed(2)}s`} />
      <Slider t={t} search={search} matches={matches} labelKey="ogDropHeight" tipKey="ogDropHeightTip" value={s.ogDropHeight} range={RANGES.ogDropHeight} onChange={(v) => update({ ogDropHeight: v })} display={s.ogDropHeight.toFixed(2)} />
      <Slider t={t} search={search} matches={matches} labelKey="ogOrbSize" tipKey="ogOrbSizeTip" value={s.ogOrbSize} range={RANGES.ogOrbSize} onChange={(v) => update({ ogOrbSize: v })} display={`${Math.round(100 * s.ogOrbSize)}%`} />
      <Slider t={t} search={search} matches={matches} labelKey="ogBounciness" tipKey="ogBouncinessTip" value={s.ogBounciness} range={RANGES.ogBounciness} onChange={(v) => update({ ogBounciness: v })} display={s.ogBounciness.toFixed(3)} />
      <Searchable search={search} matches={matches} labelKey="ogResolve">
        <Toggle t={t} labelKey="ogResolve" tipKey="ogResolveTip" value={s.ogResolve} onChange={(v) => update({ ogResolve: v })} />
      </Searchable>
      </>
      )}
      {!search && <p className="text-xs font-bold uppercase tracking-wider text-ink-3 pt-1">{t("ogLookHeading")}</p>}
      <Searchable search={search} matches={matches} labelKey="ogMaterial">
        <OptionButtons t={t} labelKey="ogMaterial" tipKey="ogMaterialTip" options={OG_MATERIALS} labels={MATERIAL_LABELS} value={s.ogMaterial} onChange={(v) => update({ ogMaterial: v })} testId="orb-grid-material" cols={4} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="ogPalette">
        <OptionSelect t={t} labelKey="ogPalette" tipKey="ogPaletteTip" options={OG_PALETTES} labels={PALETTE_LABELS} value={s.ogPalette} onChange={(v) => update({ ogPalette: v })} testId="orb-grid-palette" />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="ogElevation" tipKey="ogElevationTip" value={s.ogElevation} range={RANGES.ogElevation} onChange={(v) => update({ ogElevation: v })} display={`${Math.round(s.ogElevation)}°`} />
      <Slider t={t} search={search} matches={matches} labelKey="ogRotation" tipKey="ogRotationTip" value={s.ogRotation} range={RANGES.ogRotation} onChange={(v) => update({ ogRotation: v })} display={`${Math.round(s.ogRotation)}°`} />
      <Searchable search={search} matches={matches} labelKey="ogOrbit">
        <Toggle t={t} labelKey="ogOrbit" tipKey="ogOrbitTip" value={s.ogOrbit} onChange={(v) => update({ ogOrbit: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="ogFloor">
        <OptionButtons t={t} labelKey="ogFloor" tipKey="ogFloorTip" options={OG_FLOORS} labels={FLOOR_LABELS} value={s.ogFloor} onChange={(v) => update({ ogFloor: v })} testId="orb-grid-floor" cols={4} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="ogHud">
        <Toggle t={t} labelKey="ogHud" tipKey="ogHudTip" value={s.ogHud} onChange={(v) => update({ ogHud: v })} />
      </Searchable>
      {!search && <p className="text-xs font-bold uppercase tracking-wider text-ink-3 pt-1">{t("ogSoundHeading")}</p>}
      <Searchable search={search} matches={matches} labelKey="ogSound">
        <OptionButtons t={t} labelKey="ogSound" tipKey="ogSoundTip" options={OG_SOUNDS} labels={SOUND_LABELS} value={s.ogSound} onChange={(v) => update({ ogSound: v })} testId="orb-grid-sound" cols={5} />
      </Searchable>
      {!search && (
        <p className="text-xs text-ink-2 leading-relaxed tabular-nums" data-testid="orb-grid-run">
          {runParts.join(" · ")}
        </p>
      )}
    </div>
  );
}

/** Whether the settings hold `preset`'s whole field (its button shows pressed). */
export function orbGridPresetActive(preset: OrbGridPreset, settings: Partial<OrbGridFields>): boolean {
  const fields = orbGridPresetFields(preset);
  return (Object.keys(fields) as (keyof OrbGridFields)[]).every((key) => settings[key] === fields[key]);
}

/**
 * The Bouncing Orbs presets of the Presets group (feature orb-grid), after the account's most-liked clips: one click switches to
 * Bouncing Orbs (from its defaults, like a mode card) and loads the preset's field, look and sound.
 */
export function OrbGridPresets({ t, settings, onPick }: { t: Translate; settings: SimulatorSettings; onPick: (fields: OrbGridFields) => void }) {
  return (
    <div className="space-y-2" data-testid="orb-grid-presets">
      <p className="text-xs font-bold uppercase tracking-wider text-ink-2">
        {t("ogPresetsTitle")}
        <Tooltip text={t("ogPresetsTip")} />
      </p>
      <div className="grid grid-cols-2 gap-1">
        {ORB_GRID_PRESETS.map((preset) => {
          const active = settings.mode === "orbGrid" && orbGridPresetActive(preset, settings);
          return (
            <button type="button" key={preset.id} onClick={() => onPick(orbGridPresetFields(preset))} aria-pressed={active} className={pick(active)} data-testid={`og-preset-${preset.id}`}>
              {t(preset.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
