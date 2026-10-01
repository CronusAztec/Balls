"use client";

import Tooltip from "../Tooltip";
import { Searchable, onBtn, selectClass, sliderStyle, type Matcher, type Translate } from "../ControlPrimitives";
import type { ControlSection } from "../Controls";
import type { SimulatorSettings } from "@/lib/settings";
import { MODE_IDS, isModeId, type ModeId } from "@/lib/physics/types";
import { IconClose, IconRestart } from "@/components/ui/icons"; // --- site-redesign ---
import {
  ARENA_COUNTS,
  ARENA_LAYOUTS,
  DEFAULT_ARENA_LABELS,
  MAX_ARENA_LABEL,
  SOUND_ARENAS,
  SPLIT_SCREEN_RANGES,
  patchArena,
  resolvedArenas,
  type ArenaLayout,
  type ArenaOverride,
  type SoundArena,
} from "@/lib/splitScreen";
import NumberField from "../NumberField"; // --- uncap-all --- a number field next to every numeric control
import { rulesForRange } from "../unlimitedSlider"; // --- uncap-all ---

export interface ArenasSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  onReset: (section: ControlSection) => void;
  /** The modes' names, as the Mode picker shows them. */
  modeNames: Record<ModeId, string>;
}

/** Search keys of the Arenas & Split Screen section (SECTION_KEYS.arenas in Controls.tsx). */
export const SPLIT_SCREEN_KEYS = ["splitArenaCount", "splitLayout", "splitSound", "splitArenas", "splitArenaLabel", "splitArenaMode", "splitArenaSeed", "splitArenaGravity", "splitArenaBallSpeed", "splitArenaBallColor"];
const EDITOR_KEYS = SPLIT_SCREEN_KEYS.slice(3);

const LAYOUT_LABELS: Record<ArenaLayout, { key: string }> = { row: { key: "splitLayoutRow" }, grid: { key: "splitLayoutGrid" } };
const SOUND_LABELS: Record<SoundArena, { key: string }> = { first: { key: "splitSoundFirst" }, all: { key: "splitSoundAll" } };

const pick = (active: boolean) => `px-2 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;
const smallBtn = "px-2 py-1 rounded-md text-xs font-medium cursor-pointer bg-surface-2 text-ink-2 hover:bg-surface-3 border border-line-strong";

function Heading({ t, labelKey, tipKey }: { t: Translate; labelKey: string; tipKey?: string }) {
  return (
    <span className="text-sm font-medium text-ink-2 flex items-center">
      {t(labelKey)}
      {tipKey && <Tooltip text={t(tipKey)} />}
    </span>
  );
}

/** One numeric override: the shared value with an "Override" button, or a slider with "Use shared". */
function OverrideSlider({
  t,
  labelKey,
  value,
  shared,
  range,
  onChange,
  testId,
}: {
  t: Translate;
  labelKey: string;
  value: number | undefined;
  shared: number;
  range: { min: number; max: number; step: number };
  onChange: (v: number | undefined) => void;
  testId: string;
}) {
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-2">{t(labelKey)}</span>
        {value === undefined ? (
          <span className="flex items-center gap-2">
            <span className="text-xs text-ink-3">{t("splitShared", { value: shared })}</span>
            <button type="button" className={smallBtn} onClick={() => onChange(shared)}>
              {t("splitOverride")}
            </button>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="text-xs text-ink-2 tabular-nums">{value}</span>
            <button type="button" className={smallBtn} onClick={() => onChange(undefined)}>
              {t("splitUseShared")}
            </button>
          </span>
        )}
      </div>
      {value !== undefined && (
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={range.step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer"
            style={sliderStyle(value, range.min, range.max)}
            aria-label={t(labelKey)}
          />
          <NumberField value={value} onCommit={onChange} label={t(labelKey)} range={range} rules={rulesForRange(range)} settingKey={`arena:${labelKey}`} /* --- uncap-all --- */ />
        </div>
      )}
    </div>
  );
}

/**
 * The "Arenas & Split Screen" section (feature split-screen): how many arenas race (1, 2 or 4), their layout (row / grid), whose
 * bounces are heard, and a small editor per arena – its label and, optionally, its own seed, gravity, ball speed, ball
 * colour and (from the second arena on) mode. The values live in SimulatorSettings (`arenaCount`, `arenaLayout`,
 * `soundArena`, `arenas`); Simulator.tsx hands them to the runner (lib/simulation/multi.ts) and the canvas.
 */
export default function ArenasSection({ t, search, matches, settings: s, update, modeNames }: ArenasSectionProps) {
  const arenas = resolvedArenas(s);
  const setArena = (index: number, patch: Partial<ArenaOverride>) => update({ arenas: patchArena(s.arenas, index, patch) });
  const showEditor = s.arenaCount > 1 && (!search || EDITOR_KEYS.some(matches));
  return (
    <div className="space-y-4" data-testid="split-screen-section">
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("splitIntro")}</p>}
      <Searchable search={search} matches={matches} labelKey="splitArenaCount">
        <div className="space-y-2">
          <Heading t={t} labelKey="splitArenaCount" tipKey="splitArenaCountTip" />
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("splitArenaCount")}>
            {ARENA_COUNTS.map((n) => (
              <button type="button" key={n} onClick={() => update({ arenaCount: n })} aria-pressed={s.arenaCount === n} className={pick(s.arenaCount === n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="splitLayout">
        <div className="space-y-2">
          <Heading t={t} labelKey="splitLayout" tipKey="splitLayoutTip" />
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("splitLayout")}>
            {ARENA_LAYOUTS.map((id) => (
              <button type="button" key={id} disabled={s.arenaCount < 2} onClick={() => update({ arenaLayout: id })} aria-pressed={s.arenaLayout === id} className={pick(s.arenaLayout === id)}>
                {t(LAYOUT_LABELS[id].key)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="splitSound">
        <div className="space-y-2">
          <Heading t={t} labelKey="splitSound" tipKey="splitSoundTip" />
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("splitSound")}>
            {SOUND_ARENAS.map((id) => (
              <button type="button" key={id} disabled={s.arenaCount < 2} onClick={() => update({ soundArena: id })} aria-pressed={s.soundArena === id} className={pick(s.soundArena === id)}>
                {t(SOUND_LABELS[id].key)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      {showEditor && (
        <div className="space-y-3">
          {!search && <Heading t={t} labelKey="splitArenas" tipKey="splitArenasTip" />}
          {arenas.map((arena, i) => {
            const color = arena.ballColor ?? s.ballColor;
            return (
              <div key={i} className="rounded-xl border border-line-strong/60 bg-surface-1/40 p-3 space-y-3" data-testid={`split-arena-${i}`}>
                <div className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-full border border-line-strong" style={{ background: color }} aria-hidden="true" />
                  <span className="text-xs font-semibold text-ink">{t("splitArenaN", { n: i + 1 })}</span>
                </div>
                <Searchable search={search} matches={matches} labelKey="splitArenaLabel">
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-ink-2">{t("splitArenaLabel")}</span>
                    <input
                      type="text"
                      value={s.arenas[i]?.label ?? ""}
                      maxLength={MAX_ARENA_LABEL}
                      placeholder={DEFAULT_ARENA_LABELS[i]}
                      onChange={(e) => setArena(i, { label: e.target.value })}
                      className="w-32 px-2 py-1 bg-surface-2 text-ink text-sm rounded-md border border-line-strong focus:border-accent-dim"
                      aria-label={`${t("splitArenaN", { n: i + 1 })} – ${t("splitArenaLabel")}`}
                    />
                  </label>
                </Searchable>
                <Searchable search={search} matches={matches} labelKey="splitArenaMode">
                  {i === 0 ? (
                    <p className="text-xs text-ink-3 leading-snug">{t("splitArenaModeFirst")}</p>
                  ) : (
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-ink-2">{t("splitArenaMode")}</span>
                      <select
                        value={arena.mode ?? ""}
                        onChange={(e) => setArena(i, { mode: isModeId(e.target.value) ? e.target.value : undefined })}
                        className={`${selectClass} !w-40 !py-1 text-sm`}
                        aria-label={`${t("splitArenaN", { n: i + 1 })} – ${t("splitArenaMode")}`}
                      >
                        <option value="">{t("splitArenaModeShared")}</option>
                        {MODE_IDS.map((id) => (
                          <option key={id} value={id}>
                            {modeNames[id]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </Searchable>
                <Searchable search={search} matches={matches} labelKey="splitArenaSeed">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-ink-2 flex items-center">
                      {t("splitArenaSeed")}
                      <Tooltip text={t("splitArenaSeedTip")} />
                    </span>
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        step={1}
                        min={SPLIT_SCREEN_RANGES.arenaSeed.min}
                        max={SPLIT_SCREEN_RANGES.arenaSeed.max}
                        value={arena.seed ?? ""}
                        placeholder={t("splitArenaSeedRandom")}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const n = Number(raw);
                          setArena(i, { seed: raw === "" || !Number.isFinite(n) ? undefined : Math.round(n) | 0 });
                        }}
                        className="w-28 px-2 py-1 bg-surface-2 text-ink text-sm rounded-md border border-line-strong focus:border-accent-dim tabular-nums"
                        aria-label={`${t("splitArenaN", { n: i + 1 })} – ${t("splitArenaSeed")}`}
                      />
                      <button type="button" className={smallBtn} title={t("splitArenaSeedDice")} aria-label={t("splitArenaSeedDice")} onClick={() => setArena(i, { seed: Math.floor(Math.random() * 0x7fffffff) })}>
                        <IconRestart size={14} />
                      </button>
                      {arena.seed !== undefined && (
                        <button type="button" className={smallBtn} title={t("splitArenaSeedClear")} aria-label={t("splitArenaSeedClear")} onClick={() => setArena(i, { seed: undefined })}>
                          <IconClose size={14} />
                        </button>
                      )}
                    </span>
                  </div>
                </Searchable>
                <Searchable search={search} matches={matches} labelKey="splitArenaGravity">
                  <OverrideSlider t={t} labelKey="splitArenaGravity" value={arena.gravity} shared={s.gravity} range={SPLIT_SCREEN_RANGES.arenaGravity} onChange={(v) => setArena(i, { gravity: v })} testId={`split-arena-${i}-gravity`} />
                </Searchable>
                <Searchable search={search} matches={matches} labelKey="splitArenaBallSpeed">
                  <OverrideSlider t={t} labelKey="splitArenaBallSpeed" value={arena.ballSpeed} shared={s.ballSpeed} range={SPLIT_SCREEN_RANGES.arenaBallSpeed} onChange={(v) => setArena(i, { ballSpeed: v })} testId={`split-arena-${i}-speed`} />
                </Searchable>
                <Searchable search={search} matches={matches} labelKey="splitArenaBallColor">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-ink-2">{t("splitArenaBallColor")}</span>
                    <span className="flex items-center gap-2">
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => setArena(i, { ballColor: e.target.value.toLowerCase() })}
                        className="w-10 h-7 bg-surface-2 rounded-md cursor-pointer border border-line-strong"
                        aria-label={`${t("splitArenaN", { n: i + 1 })} – ${t("splitArenaBallColor")}`}
                      />
                      {arena.ballColor !== undefined ? (
                        <button type="button" className={smallBtn} onClick={() => setArena(i, { ballColor: undefined })}>
                          {t("splitUseShared")}
                        </button>
                      ) : (
                        <span className="text-xs text-ink-3">{t("splitSharedColor")}</span>
                      )}
                    </span>
                  </div>
                </Searchable>
              </div>
            );
          })}
        </div>
      )}
      {!search && s.arenaCount > 1 && (
        <div className="space-y-1.5 text-xs leading-snug text-ink-3" data-testid="split-notes">
          <p>{t("splitRaceNote")}</p>
          <p>{t("splitFinderNote")}</p>
          <p className="text-warn/80">{t("splitFastExportNote")}</p>
        </div>
      )}
      {!search && s.arenaCount < 2 && <p className="text-xs text-ink-3">{t("splitSingleNote")}</p>}
    </div>
  );
}
