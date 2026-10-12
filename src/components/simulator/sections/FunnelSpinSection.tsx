"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import {
  FS_PRESET_IDS,
  FS_PRESET_LABELS,
  FS_RELEASES,
  FS_VIEWS,
  formatWaves,
  funnelSpinPresetPatch,
  funnelSpinSettingsOf,
  funnelTiming,
  parseWaves,
  wavesForRun,
  wavesTotal,
  type FsPresetId,
} from "@/lib/physics/funnelSpin";

/*
 * --- funnel-spin --- The Sound Vortex's ring release and perspective view (lib/physics/funnelSpin.ts), at the end of the Vortex
 * block of the Mode row (and in the Ball section while the settings search is in use): the presets (Ring of 24, Galaxy, Coin
 * funnel, Doubling), the release (one after another, or ring waves), the view (from above, or in perspective), the waves, their
 * interval, the spin friction, the first lap, the hole, the refill gap and the lap readout, the camera elevation and the drawn
 * depth, and a line that sums a ring run up (its marbles, its loop, the descent and the lap's spin-up). Its labels live in the
 * `Vortex` namespace of messages/*.json. Simulator.tsx hands the run to the engine: a change of the waves, the timing, the
 * friction, the first lap, the hole or the refill restarts it; the view, the camera, the depth and the readout follow live.
 */

export interface FunnelSpinSectionProps {
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (VORTEX_KEYS spreads them: SECTION_KEYS.ball and MODE_BLOCK_KEYS.vortex). */
export const FUNNEL_SPIN_KEYS = ["vxPreset", "vxRelease", "vxView", "vxWaves", "vxWaveInterval", "vxSpinFriction", "vxFirstLap", "vxHoleSize", "vxRefillGap", "vxLapReadout", "vxElevation", "vxFunnelDepth"];

const RELEASE_LABELS = { stagger: "vxReleaseStagger", rings: "vxReleaseRings" } as const;
const VIEW_LABELS = { top: "vxViewTop", perspective: "vxViewPerspective" } as const;

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** A number as the panel shows it: at most `digits` decimals, trailing zeros dropped. */
function short(value: number, digits = 2): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(digits))) : "∞";
}

/**
 * The section's translator: a key of the `Vortex` namespace (this block's labels, tips and presets), else the Controls
 * namespace's (the primitives' shared words, such as the switch's ON / OFF).
 */
function useFunnelTranslator(): Translate {
  const vt = useTranslations("Vortex");
  const controls = useTranslations("Controls");
  return useMemo(() => {
    const own = (key: string) => vt.has(key as never);
    const fn = ((key: string, values?: Record<string, string | number | Date>) => (own(key) ? vt(key as never, values as never) : controls(key as never, values as never))) as unknown as Translate;
    Object.assign(fn, {
      has: (key: string) => own(key) || controls.has(key as never),
      raw: (key: string) => (own(key) ? vt.raw(key as never) : controls.raw(key as never)),
      rich: (key: string, values?: never) => (own(key) ? vt.rich(key as never, values) : controls.rich(key as never, values)),
      markup: (key: string, values?: never) => (own(key) ? vt.markup(key as never, values) : controls.markup(key as never, values)),
    });
    return fn;
  }, [vt, controls]);
}

export default function FunnelSpinSection({ search, matches, settings: s, update }: FunnelSpinSectionProps) {
  const t = useFunnelTranslator();
  const rings = s.vxRelease === "rings";
  const perspective = s.vxView === "perspective";
  const timing = funnelTiming(funnelSpinSettingsOf(s));
  const runWaves = wavesForRun(parseWaves(s.vxWaves));
  const typedTotal = wavesTotal(parseWaves(s.vxWaves));
  const applyPreset = (id: FsPresetId) => update(funnelSpinPresetPatch(id));
  return (
    <div
      className="space-y-3 pt-2"
      data-testid="funnel-spin-section"
      data-fs-release={s.vxRelease}
      data-fs-view={s.vxView}
      data-fs-marbles={timing.marbles}
      data-fs-cycle={Number.isFinite(timing.cycleSec) ? short(timing.cycleSec, 3) : ""}
      data-fs-descent={Number.isFinite(timing.descentSec) ? short(timing.descentSec, 3) : ""}
    >
      {!search && (
        <div className="space-y-1 border-t border-line pt-3">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("vxFunnelTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("vxFunnelDesc")}</p>
        </div>
      )}
      <Searchable search={search} matches={matches} labelKey="vxPreset">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("vxPreset")}
            <Tooltip text={t("vxPresetTip")} />
          </span>
          <div className="grid grid-cols-2 gap-1.5" data-testid="fs-presets">
            {FS_PRESET_IDS.map((id) => (
              <button key={id} type="button" onClick={() => applyPreset(id)} className={pick(false)} data-fs-preset={id}>
                {t(FS_PRESET_LABELS[id])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <ButtonRow search={search} matches={matches} labelKey="vxRelease" tipKey="vxReleaseTip" values={FS_RELEASES} labels={RELEASE_LABELS} value={s.vxRelease} onChange={(vxRelease) => update({ vxRelease })} />
      <ButtonRow search={search} matches={matches} labelKey="vxView" tipKey="vxViewTip" values={FS_VIEWS} labels={VIEW_LABELS} value={s.vxView} onChange={(vxView) => update({ vxView })} />
      {(rings || !!search) && (
        <>
          <WavesField search={search} matches={matches} value={s.vxWaves} onChange={(vxWaves) => update({ vxWaves })} />
          {!search && typedTotal > wavesTotal(runWaves) && (
            <p className="text-xs text-warn" data-testid="fs-waves-ceiling">
              {t("vxWavesCeiling", { count: wavesTotal(runWaves) })}
            </p>
          )}
          <Slider t={t} search={search} matches={matches} labelKey="vxWaveInterval" tipKey="vxWaveIntervalTip" value={s.vxWaveInterval} range={RANGES.vxWaveInterval} onChange={(v) => update({ vxWaveInterval: v })} display={`${short(s.vxWaveInterval)}s`} />
          <Slider t={t} search={search} matches={matches} labelKey="vxSpinFriction" tipKey="vxSpinFrictionTip" value={s.vxSpinFriction} range={RANGES.vxSpinFriction} onChange={(v) => update({ vxSpinFriction: v })} display={short(s.vxSpinFriction, 4)} />
          <Slider t={t} search={search} matches={matches} labelKey="vxFirstLap" tipKey="vxFirstLapTip" value={s.vxFirstLap} range={RANGES.vxFirstLap} onChange={(v) => update({ vxFirstLap: v })} display={`${short(s.vxFirstLap)}s`} />
          <Slider t={t} search={search} matches={matches} labelKey="vxHoleSize" tipKey="vxHoleSizeTip" value={s.vxHoleSize} range={RANGES.vxHoleSize} onChange={(v) => update({ vxHoleSize: v })} display={`${short(s.vxHoleSize, 1)}%`} />
          <Slider t={t} search={search} matches={matches} labelKey="vxRefillGap" tipKey="vxRefillGapTip" value={s.vxRefillGap} range={RANGES.vxRefillGap} onChange={(v) => update({ vxRefillGap: v })} display={`${short(s.vxRefillGap)}s`} />
          <Searchable search={search} matches={matches} labelKey="vxLapReadout">
            <Toggle t={t} labelKey="vxLapReadout" tipKey="vxLapReadoutTip" value={s.vxLapReadout} onChange={(v) => update({ vxLapReadout: v, ...(v ? { loopHud: true } : {}) })} />
          </Searchable>
          {!search && (
            <p className="text-xs text-ink-2 leading-relaxed tabular-nums" data-testid="fs-run-info">
              {Number.isFinite(timing.cycleSec)
                ? t("vxRingInfo", { marbles: timing.marbles, waves: timing.waves, descent: short(timing.descentSec, 1), cycle: short(timing.cycleSec, 1), first: short(timing.firstLapSec, 2), last: short(timing.lastLapSec, 2), gain: short(timing.lapGain, 1) })
                : t("vxRingInfoFrictionless", { marbles: timing.marbles })}
            </p>
          )}
        </>
      )}
      {(perspective || !!search) && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="vxElevation" tipKey="vxElevationTip" value={s.vxElevation} range={RANGES.vxElevation} onChange={(v) => update({ vxElevation: v })} display={`${short(s.vxElevation, 1)}°`} />
          <Slider t={t} search={search} matches={matches} labelKey="vxFunnelDepth" tipKey="vxFunnelDepthTip" value={s.vxFunnelDepth} range={RANGES.vxFunnelDepth} onChange={(v) => update({ vxFunnelDepth: v })} display={short(s.vxFunnelDepth)} />
        </>
      )}
    </div>
  );
}

/** One of the section's option rows (a labelled group of buttons, the active one pressed). */
function ButtonRow<V extends string>({ search, matches, labelKey, tipKey, values, labels, value, onChange }: { search: string; matches: Matcher; labelKey: string; tipKey: string; values: readonly V[]; labels: Record<V, string>; value: V; onChange: (v: V) => void }) {
  const t = useTranslations("Vortex");
  return (
    <Searchable search={search} matches={matches} labelKey={labelKey}>
      <div className="space-y-1.5">
        <span className="text-sm font-medium text-ink-2 flex items-center">
          {t(labelKey)}
          <Tooltip text={t(tipKey)} />
        </span>
        <div className="grid grid-cols-2 gap-1" role="group" aria-label={t(labelKey)}>
          {values.map((v) => (
            <button type="button" key={v} onClick={() => onChange(v)} aria-pressed={value === v} className={pick(value === v)} data-fs-option={`${labelKey}:${v}`}>
              {t(String(labels[v]))}
            </button>
          ))}
        </div>
      </div>
    </Searchable>
  );
}

/** The waves ("6, 12, 24"): typed freely, committed on Enter or when the field loses focus; ×2 adds a wave twice the last, − drops the last. */
function WavesField({ search, matches, value, onChange }: { search: string; matches: Matcher; value: string; onChange: (v: string) => void }) {
  const t = useTranslations("Vortex");
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    setDraft(null);
    const next = formatWaves(parseWaves(text));
    if (next !== value) onChange(next);
  };
  const waves = parseWaves(value);
  return (
    <Searchable search={search} matches={matches} labelKey="vxWaves">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-ink-2 flex items-center" htmlFor="fs-waves">
          {t("vxWaves")}
          <Tooltip text={t("vxWavesTip")} />
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id="fs-waves"
            type="text"
            inputMode="numeric"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink num"
            value={draft ?? value}
            aria-label={t("vxWaves")}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
            }}
            data-testid="fs-waves"
          />
          <button type="button" className={pick(false) + " px-2"} onClick={() => onChange(formatWaves([...waves, 2 * waves[waves.length - 1]]))} title={t("vxWavesDouble")} aria-label={t("vxWavesDouble")} data-fs-waves="double">
            ×2
          </button>
          <button type="button" className={pick(false) + " px-2"} onClick={() => onChange(formatWaves(waves.length > 1 ? waves.slice(0, -1) : waves))} title={t("vxWavesDrop")} aria-label={t("vxWavesDrop")} data-fs-waves="drop" disabled={waves.length <= 1}>
            −
          </button>
        </div>
      </div>
    </Searchable>
  );
}
