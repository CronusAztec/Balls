"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import type { PaintBeatInfo } from "./PicturePaintSection";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { BEAT_DROP_COLOR_MODES, BEAT_DROP_SOUNDS, beatDropRunInfo, beatDropSettingsOf, parseBeatDropKinds, toggleBeatDropKind, type BeatDropColorMode, type BeatDropSound } from "@/lib/physics/modes/beatDrop";
import { BEAT_DROP_KINDS, BEAT_DROP_SCROLLS, type BeatDropPadKind, type BeatDropScroll } from "@/lib/simulation/beatDropPlan";
import type { BeatSourceKind } from "@/lib/simulation/beatSource"; // --- video-beats ---

export interface BeatDropSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  /** The loaded song's detected beat (Picture Paint's detector): the beat Beat Drop lands on while there is one. */
  beat?: PaintBeatInfo | null;
  /**
   * --- video-beats --- The beat source in effect (the Sound section's "Beats from a video" picker, after its fallbacks):
   * an imported video's beats or the hand-placed markers reach Beat Drop as that grid, and the beat line names them.
   */
  beatSource?: BeatSourceKind;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const BEAT_DROP_KEYS = ["bdKinds", "bdDrift", "bdScroll", "bdBounceHeight", "bdAnticipation", "bdSound", "bdColorMode", "bdTrail"];

const KIND_OPTIONS: Record<BeatDropPadKind, { labelKey: string }> = {
  plank: { labelKey: "bdKindPlank" },
  block: { labelKey: "bdKindBlock" },
  spring: { labelKey: "bdKindSpring" },
  wedge: { labelKey: "bdKindWedge" },
  spinner: { labelKey: "bdKindSpinner" },
  drum: { labelKey: "bdKindDrum" },
};
const SCROLL_OPTIONS: Record<BeatDropScroll, { labelKey: string }> = {
  endless: { labelKey: "bdScrollEndless" },
  arena: { labelKey: "bdScrollArena" },
};
const SOUND_OPTIONS: Record<BeatDropSound, { labelKey: string }> = {
  drums: { labelKey: "bdSoundDrums" },
  melody: { labelKey: "bdSoundMelody" },
  both: { labelKey: "bdSoundBoth" },
};
const COLOR_OPTIONS: Record<BeatDropColorMode, { labelKey: string }> = {
  pad: { labelKey: "bdColorPad" },
  rainbow: { labelKey: "bdColorRainbow" },
  team: { labelKey: "bdColorTeam" },
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/**
 * "Beat Drop" controls (feature beat-drop), shown in the Mode row while Beat Drop is the mode (and in the Ball section while
 * the settings search is in use): the obstructions in the mix, the drift, the scrolling (endless or arena), the bounce
 * height, how early the obstructions fly in, what a landing plays, the pad colours and the trail – with a line on the beat
 * the run follows and one that sums the run up (the landings the clip covers, and that it cannot fail, so Find Simulation
 * only picks a seed). The values live in SimulatorSettings; Simulator.tsx forwards them to the engine (see
 * lib/physics/modes/beatDrop.ts) and re-plans – restarts – the run when the mix, drift, scroll, bounce, anticipation or
 * the beat changes (sound, colours, trail and the scale follow live).
 */
export default function BeatDropSection({ t, search, matches, settings: s, update, beat, beatSource }: BeatDropSectionProps) {
  const kinds = parseBeatDropKinds(s.bdKinds);
  const followsSong = !!beat?.bpm;
  const info = !search ? beatDropRunInfo({ ...beatDropSettingsOf(s), bpm: followsSong ? beat!.bpm! : s.bpm }) : null;
  const gridKey = beatSource === "media" ? "bdBeatMedia" : beatSource === "manual" ? "bdBeatMarkers" : "bdBeatSong"; // --- video-beats ---
  // (a song still being analysed is only waited for when the picked source is not the BPM)
  const beatLine = followsSong ? t(gridKey, { bpm: Math.round(beat!.bpm!) }) : beat?.analyzing && s.beatSource !== "bpm" ? t("bdBeatAnalyzing") : t("bdBeatBpm", { bpm: s.bpm });
  return (
    <div className="space-y-3 pt-2" data-testid="beat-drop">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("bdTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("bdDesc")}</p>
        </div>
      )}
      <Searchable search={search} matches={matches} labelKey="bdKinds">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("bdKinds")}
            <Tooltip text={t("bdKindsTip")} />
          </label>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("bdKinds")}>
            {BEAT_DROP_KINDS.map((id) => {
              const on = kinds.includes(id);
              return (
                <button type="button" key={id} onClick={() => update({ bdKinds: toggleBeatDropKind(s.bdKinds, id) })} aria-pressed={on} className={pick(on)}>
                  {t(KIND_OPTIONS[id].labelKey)}
                </button>
              );
            })}
          </div>
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="bdDrift" tipKey="bdDriftTip" value={s.bdDrift} range={RANGES.bdDrift} onChange={(v) => update({ bdDrift: v })} display={`${Math.round(100 * s.bdDrift)}%`} />
      <Searchable search={search} matches={matches} labelKey="bdScroll">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("bdScroll")}
            <Tooltip text={t("bdScrollTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("bdScroll")}>
            {BEAT_DROP_SCROLLS.map((id) => (
              <button type="button" key={id} onClick={() => update({ bdScroll: id })} aria-pressed={s.bdScroll === id} className={pick(s.bdScroll === id)}>
                {t(SCROLL_OPTIONS[id].labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="bdBounceHeight" tipKey="bdBounceHeightTip" value={s.bdBounceHeight} range={RANGES.bdBounceHeight} onChange={(v) => update({ bdBounceHeight: v })} display={`${Math.round(100 * s.bdBounceHeight)}%`} />
      <Slider t={t} search={search} matches={matches} labelKey="bdAnticipation" tipKey="bdAnticipationTip" value={s.bdAnticipation} range={RANGES.bdAnticipation} onChange={(v) => update({ bdAnticipation: v })} display={t("bdBeats", { value: s.bdAnticipation.toFixed(2) })} />
      <Searchable search={search} matches={matches} labelKey="bdSound">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("bdSound")}
            <Tooltip text={t("bdSoundTip")} />
          </label>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("bdSound")}>
            {BEAT_DROP_SOUNDS.map((id) => (
              <button type="button" key={id} onClick={() => update({ bdSound: id })} aria-pressed={s.bdSound === id} className={pick(s.bdSound === id)}>
                {t(SOUND_OPTIONS[id].labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="bdColorMode">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("bdColorMode")}
            <Tooltip text={t("bdColorModeTip")} />
          </label>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("bdColorMode")}>
            {BEAT_DROP_COLOR_MODES.map((id) => (
              <button type="button" key={id} onClick={() => update({ bdColorMode: id })} aria-pressed={s.bdColorMode === id} className={pick(s.bdColorMode === id)}>
                {t(COLOR_OPTIONS[id].labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="bdTrail">
        <Toggle t={t} labelKey="bdTrail" tipKey="bdTrailTip" value={s.bdTrail} onChange={(v) => update({ bdTrail: v })} />
      </Searchable>
      {!search && (
        <p className="text-xs text-ink-3 leading-relaxed tabular-nums" data-testid="beat-drop-beat">
          {beatLine}
        </p>
      )}
      {info && (
        <p className="text-xs text-ink-2 leading-relaxed tabular-nums" data-testid="beat-drop-run">
          {t("bdRunInfo", { beats: info.beats, bpm: Math.round(info.bpm), seconds: info.seconds.toFixed(1), clip: s.recordingDuration })}
        </p>
      )}
    </div>
  );
}
