"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { OG_GROUPS, OG_METROS, OG_MODELS, OG_RHYTHMS, PATTERN_RHYTHMS, metronomeOn, type OgGroup, type OgMetro, type OgModel, type OgRhythm } from "@/lib/physics/modes/orbRhythm";

/**
 * --- orb-rhythm --- The Bouncing Orbs rhythm controls (feature orb-rhythm), inside the Bouncing Orbs block of the Mode row
 * (OrbGridSection.tsx renders them): the model switch at the top of the block (`OrbModelSwitch`: Rhythm – ideal bouncers
 * forever, the default – or Decay), and for the rhythm model the rhythm (the preset, the polyrhythm switch, the groups, the
 * Euclidean steps, the cycle, the tempo spread, equal heights, the bounce height, the orb size, the landing squash) and the metronome (the
 * visual style, the tempo – the beat lock's while it is on –, beats a bar, bars a cycle, the click volume, the melody).
 * Every number has its number field and no maximum. The values live in SimulatorSettings (URL keys = the field names:
 * ogModel, ogRhythm, …); Simulator.tsx restarts the run when one that moves the field changes, the rest follows live.
 */

export interface OrbRhythmSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the rhythm controls (OrbGridSection.tsx adds them to its own). */
export const ORB_RHYTHM_KEYS = ["ogModel", "ogRhythm", "ogPoly", "ogGroup", "ogSteps", "ogCycle", "ogTempoSpread", "ogEq", "ogBounceHeight", "ogSquash", "ogMetro", "ogBpm", "ogBeats", "ogBars", "ogClick", "ogMelody"];

const MODEL_LABELS: Record<OgModel, string> = { rhythm: "ogModelRhythm", decay: "ogModelDecay" };
const RHYTHM_LABELS: Record<OgRhythm, string> = { pendulum: "ogRhythmPendulum", "3-2": "ogRhythm32", "4-3": "ogRhythm43", "5-4": "ogRhythm54", "7-5": "ogRhythm75", "3-4-5": "ogRhythm345", euclid: "ogRhythmEuclid", corner: "ogRhythmCorner", centre: "ogRhythmCentre", varied: "ogRhythmVaried" };
const GROUP_LABELS: Record<OgGroup, string> = { rows: "ogGroupRows", columns: "ogGroupColumns", rings: "ogGroupRings", diagonals: "ogGroupDiagonals", checker: "ogGroupChecker", each: "ogGroupEach" };
const METRO_LABELS: Record<OgMetro, string> = { off: "ogMetroOff", bar: "ogMetroBar", ring: "ogMetroRing", dot: "ogMetroDot" };

/** An option's translation key (a plain string for the typed translator). */
const labelOf = <T extends string>(labels: Record<T, string>, id: T): string => labels[id];

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** A row of option buttons. */
function Buttons<T extends string>({ t, labelKey, tipKey, options, labels, value, onChange, testId }: { t: Translate; labelKey: string; tipKey: string; options: readonly T[]; labels: Record<T, string>; value: T; onChange: (v: T) => void; testId: string }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-ink-2">
        {t(labelKey)}
        <Tooltip text={t(tipKey)} />
      </label>
      <div className={`grid gap-1 ${options.length === 2 ? "grid-cols-2" : "grid-cols-4"}`} role="group" aria-label={t(labelKey)}>
        {options.map((id) => (
          <button type="button" key={id} onClick={() => onChange(id)} aria-pressed={value === id} className={pick(value === id)} data-testid={`${testId}-${id}`}>
            {t(labelOf(labels, id))}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A select of options. */
function Select<T extends string>({ t, labelKey, tipKey, options, labels, value, onChange, testId }: { t: Translate; labelKey: string; tipKey: string; options: readonly T[]; labels: Record<T, string>; value: T; onChange: (v: T) => void; testId: string }) {
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

/** The model switch at the top of the Bouncing Orbs block: Rhythm (the default) or Decay. */
export function OrbModelSwitch({ t, search, matches, settings: s, update }: OrbRhythmSectionProps) {
  return (
    <Searchable search={search} matches={matches} labelKey="ogModel">
      <Buttons t={t} labelKey="ogModel" tipKey="ogModelTip" options={OG_MODELS} labels={MODEL_LABELS} value={s.ogModel} onChange={(v) => update({ ogModel: v })} testId="orb-model" />
    </Searchable>
  );
}

/** The rhythm and metronome controls of the rhythm model. */
export default function OrbRhythmSection({ t, search, matches, settings: s, update }: OrbRhythmSectionProps) {
  const metroOn = metronomeOn({ metro: s.ogMetro, click: s.ogClick });
  const synced = s.quantizeToBeat;
  const pattern = PATTERN_RHYTHMS.includes(s.ogRhythm) || !!search;
  const spread = s.ogRhythm === "corner" || s.ogRhythm === "centre" || s.ogRhythm === "varied" || !s.ogPoly || !!search;
  return (
    <div className="space-y-3" data-testid="orb-rhythm">
      {!search && <p className="text-xs font-bold uppercase tracking-wider text-ink-3 pt-1">{t("ogRhythmHeading")}</p>}
      <Searchable search={search} matches={matches} labelKey="ogRhythm">
        <Select t={t} labelKey="ogRhythm" tipKey="ogRhythmTip" options={OG_RHYTHMS} labels={RHYTHM_LABELS} value={s.ogRhythm} onChange={(v) => update({ ogRhythm: v })} testId="orb-rhythm-preset" />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="ogPoly">
        <Toggle t={t} labelKey="ogPoly" tipKey="ogPolyTip" value={s.ogPoly} onChange={(v) => update({ ogPoly: v })} />
      </Searchable>
      {pattern && (
        <Searchable search={search} matches={matches} labelKey="ogGroup">
          <Select t={t} labelKey="ogGroup" tipKey="ogGroupTip" options={OG_GROUPS} labels={GROUP_LABELS} value={s.ogGroup} onChange={(v) => update({ ogGroup: v })} testId="orb-rhythm-group" />
        </Searchable>
      )}
      {(s.ogRhythm === "euclid" || !!search) && <Slider t={t} search={search} matches={matches} labelKey="ogSteps" tipKey="ogStepsTip" value={s.ogSteps} range={RANGES.ogSteps} onChange={(v) => update({ ogSteps: v })} display={String(s.ogSteps)} />}
      {(!metroOn || !!search) && <Slider t={t} search={search} matches={matches} labelKey="ogCycle" tipKey="ogCycleTip" value={s.ogCycle} range={RANGES.ogCycle} onChange={(v) => update({ ogCycle: v })} display={`${s.ogCycle}s`} />}
      {spread && <Slider t={t} search={search} matches={matches} labelKey="ogTempoSpread" tipKey="ogTempoSpreadTip" value={s.ogSpread} range={RANGES.ogSpread} onChange={(v) => update({ ogSpread: v })} display={`${Math.round(100 * s.ogSpread)}%`} />}
      <Searchable search={search} matches={matches} labelKey="ogEq">
        <Toggle t={t} labelKey="ogEq" tipKey="ogEqTip" value={s.ogEq} onChange={(v) => update({ ogEq: v })} />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="ogBounceHeight" tipKey="ogBounceHeightTip" value={s.ogDropHeight} range={RANGES.ogDropHeight} onChange={(v) => update({ ogDropHeight: v })} display={s.ogDropHeight.toFixed(2)} />
      {/* (the orb size: the decay block's own slider shows it while searching) */}
      {!search && <Slider t={t} search={search} matches={matches} labelKey="ogOrbSize" tipKey="ogOrbSizeTip" value={s.ogOrbSize} range={RANGES.ogOrbSize} onChange={(v) => update({ ogOrbSize: v })} display={`${Math.round(100 * s.ogOrbSize)}%`} />}
      <Searchable search={search} matches={matches} labelKey="ogSquash">
        <Toggle t={t} labelKey="ogSquash" tipKey="ogSquashTip" value={s.ogSquash} onChange={(v) => update({ ogSquash: v })} />
      </Searchable>
      {!search && <p className="text-xs font-bold uppercase tracking-wider text-ink-3 pt-1">{t("ogMetroHeading")}</p>}
      <Searchable search={search} matches={matches} labelKey="ogMetro">
        <Buttons t={t} labelKey="ogMetro" tipKey="ogMetroTip" options={OG_METROS} labels={METRO_LABELS} value={s.ogMetro} onChange={(v) => update({ ogMetro: v })} testId="orb-rhythm-metro" />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="ogBpm" tipKey="ogBpmTip" value={s.ogBpm} range={RANGES.ogBpm} onChange={(v) => update({ ogBpm: v })} display={`${s.ogBpm} BPM`} disabled={synced} />
      {synced && !search && (
        <p className="text-xs text-ink-3" data-testid="orb-rhythm-synced">
          {t("ogBpmSynced", { bpm: s.bpm })}
        </p>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="ogBeats" tipKey="ogBeatsTip" value={s.ogBeats} range={RANGES.ogBeats} onChange={(v) => update({ ogBeats: v })} display={String(s.ogBeats)} />
      {(metroOn || !!search) && <Slider t={t} search={search} matches={matches} labelKey="ogBars" tipKey="ogBarsTip" value={s.ogBars} range={RANGES.ogBars} onChange={(v) => update({ ogBars: v })} display={String(s.ogBars)} />}
      <Slider t={t} search={search} matches={matches} labelKey="ogClick" tipKey="ogClickTip" value={s.ogClick} range={RANGES.ogClick} onChange={(v) => update({ ogClick: v })} display={`${Math.round(100 * s.ogClick)}%`} />
      <Searchable search={search} matches={matches} labelKey="ogMelody">
        <Toggle t={t} labelKey="ogMelody" tipKey="ogMelodyTip" value={s.ogMelody} onChange={(v) => update({ ogMelody: v })} />
      </Searchable>
    </div>
  );
}
