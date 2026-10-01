"use client";

import { useState } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, sliderStyle, type Matcher, type Translate } from "../ControlPrimitives";
import { PAINT_BEAT_SOURCES } from "@/lib/physics/picturePaint";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import NumberField from "../NumberField"; // --- uncap-all --- a number field next to every numeric control
import { rulesForRange } from "../unlimitedSlider"; // --- uncap-all ---

/** The picture uploaded in this session (a data: URL kept in memory, like the custom ball image). */
export interface PaintPictureInfo {
  name: string;
  url: string;
}

/** What the page knows about the beat of the loaded song, for the "detected BPM" readout. */
export interface PaintBeatInfo {
  /** Tempo detected in the loaded song, or null while none is known. */
  bpm: number | null;
  /** A beat analysis is still running. */
  analyzing: boolean;
  /** A song is loaded (music bed or song slicer), so a beat can be detected at all. */
  hasSong: boolean;
  /** Which loaded song the grid comes from. */
  source: "music" | "slicer" | null;
}

export interface PicturePaintSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  showAdvanced: boolean;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  picture: PaintPictureInfo | null;
  onUpload: (file: File) => void;
  onRemove: () => void;
  beat: PaintBeatInfo;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.visual in Controls.tsx). */
export const PICTURE_PAINT_KEYS = ["picturePaint", "paintGhost", "paintBrush", "paintBeatSync", "paintBeatSource", "paintBeatPulse", "paintGuided", "paintPace"];

/**
 * "Picture Paint" block of the Paint mode: upload a picture (kept in memory), the ghost preview
 * and brush size, beat sync with its source (the detected beat of the loaded song or the manual
 * BPM) and pulse strength, guided coverage and pacing. The reveal itself lives in Canvas.tsx, the
 * motion in lib/physics/modes/paint.ts and the beat detection in lib/audio/beats.ts; this
 * component only edits the settings and hands the file up.
 */
export default function PicturePaintSection({ t, search, matches, settings: s, update, picture, onUpload, onRemove, beat }: PicturePaintSectionProps) {
  const [drag, setDrag] = useState(false);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  // The beat controls only matter with beat sync on, but the search box must still find them.
  const showBeatControls = s.paintBeatSync || !!search;
  const beatStatus = beat.analyzing
    ? t("paintAnalyzing")
    : beat.bpm !== null && beat.bpm > 0
      ? t("paintDetectedBpm", { bpm: Math.round(beat.bpm) })
      : beat.hasSong
        ? t("paintNoBeat")
        : t("paintNoSong");

  return (
    <>
      <Searchable search={search} matches={matches} labelKey="picturePaint">
        <div className="space-y-3">
          <label className="text-sm font-medium text-zinc-300">
            🖼️ {t("picturePaint")}
            <Tooltip text={t("picturePaintTip")} />
          </label>
          <p className="text-xs text-zinc-500 leading-relaxed">{t("picturePaintDesc")}</p>
          {picture ? (
            <div className="flex items-center gap-3 px-3 py-2 bg-zinc-800/60 rounded-lg border border-zinc-700/60" data-testid="paint-picture">
              <div
                className="flex-shrink-0 rounded-full"
                style={{ width: 40, height: 40, backgroundImage: `url(${picture.url})`, backgroundSize: "cover", backgroundPosition: "center", boxShadow: "0 0 8px rgba(147, 209, 25, 0.35)" }}
                aria-hidden="true"
              />
              <p className="flex-1 min-w-0 text-sm text-zinc-200 truncate" title={picture.name}>
                {picture.name}
              </p>
              <button type="button" onClick={onRemove} aria-label={t("paintPictureRemove")} title={t("paintPictureRemove")} className="text-zinc-500 hover:text-red-400 transition-colors text-sm cursor-pointer px-1">
                ✕
              </button>
            </div>
          ) : (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const file = e.dataTransfer.files?.[0];
                if (file) onUpload(file);
              }}
              className={`flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg font-medium transition-all text-xs cursor-pointer border border-dashed ${
                drag ? `bg-[#93d119]/10 border-[#93d119] text-[#93d119] scale-[1.02] shadow-lg` : "bg-zinc-800 border-zinc-600 text-zinc-300 hover:bg-zinc-700 hover:border-zinc-500"
              }`}
            >
              <span className="text-lg">{drag ? "📥" : "🖼️"}</span>
              <span className="font-semibold">{drag ? t("dropPictureHere") : t("choosePictureFile")}</span>
              <input
                id="paint-picture-input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onUpload(file);
                    e.target.value = "";
                  }
                }}
              />
            </label>
          )}
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="paintGhost" tipKey="paintGhostTip" value={s.paintGhost} range={RANGES.paintGhost} onChange={(v) => update({ paintGhost: v })} display={pct(s.paintGhost)} left="🌑" right="👻" />
      <Slider t={t} search={search} matches={matches} labelKey="paintBrush" tipKey="paintBrushTip" value={s.paintBrush} range={RANGES.paintBrush} onChange={(v) => update({ paintBrush: v })} display={`${s.paintBrush.toFixed(1)}×`} left="🖊️" right="🖌️" />
      <Searchable search={search} matches={matches} labelKey="paintBeatSync">
        <div className="space-y-2">
          <Toggle t={t} labelKey="paintBeatSync" tipKey="paintBeatSyncTip" value={s.paintBeatSync} onChange={(v) => update({ paintBeatSync: v })} caseStyle="title" />
          <p className="text-xs text-zinc-500 leading-relaxed">{t("paintBeatSyncDesc")}</p>
        </div>
      </Searchable>
      {showBeatControls && (
        <>
          <Searchable search={search} matches={matches} labelKey="paintBeatSource">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">{t("paintBeatSource")}</label>
              <div className="flex gap-1" role="group" aria-label={t("paintBeatSource")}>
                {PAINT_BEAT_SOURCES.map((source) => (
                  <button
                    type="button"
                    key={source}
                    onClick={() => update({ paintBeatSource: source })}
                    aria-pressed={s.paintBeatSource === source}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.paintBeatSource === source ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
                  >
                    {source === "song" ? `🎵 ${t("paintBeatSourceSong")}` : `🎚️ ${t("paintBeatSourceBpm")}`}
                  </button>
                ))}
              </div>
              <p className={`text-[11px] leading-relaxed ${beat.bpm !== null && beat.bpm > 0 && !beat.analyzing ? "text-[#93d119]" : "text-zinc-500"}`} data-testid="paint-detected-bpm" role="status">
                {beatStatus}
              </p>
              {(s.paintBeatSource === "bpm" || !!search) && (
                <>
                  <label className="text-sm font-medium text-zinc-300 flex items-center justify-between mt-1">
                    <span>{t("paintManualBpm")}</span>
                    <span className="text-zinc-500">{s.bpm}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={RANGES.bpm.min}
                      max={RANGES.bpm.max}
                      step={RANGES.bpm.step}
                      value={s.bpm}
                      onChange={(e) => update({ bpm: Number(e.target.value) })}
                      className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                      style={sliderStyle(s.bpm, RANGES.bpm.min, RANGES.bpm.max)}
                      aria-label={t("paintManualBpm")}
                    />
                    <NumberField value={s.bpm} onCommit={(v) => update({ bpm: v })} label={t("paintManualBpm")} range={RANGES.bpm} rules={rulesForRange(RANGES.bpm)} settingKey="bpm" /* --- uncap-all --- */ />
                  </div>
                </>
              )}
            </div>
          </Searchable>
          <Slider t={t} search={search} matches={matches} labelKey="paintBeatPulse" tipKey="paintBeatPulseTip" value={s.paintBeatPulse} range={RANGES.paintBeatPulse} onChange={(v) => update({ paintBeatPulse: v })} display={pct(s.paintBeatPulse)} left="〰️" right="💥" />
        </>
      )}
      <Searchable search={search} matches={matches} labelKey="paintGuided">
        <div className="space-y-1">
          <Toggle t={t} labelKey="paintGuided" tipKey="paintGuidedTip" value={s.paintGuided} onChange={(v) => update({ paintGuided: v })} caseStyle="title" />
          <p className="text-xs text-zinc-500 leading-relaxed">{t("paintGuidedDesc")}</p>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="paintPace">
        <div className="space-y-1">
          <Toggle t={t} labelKey="paintPace" tipKey="paintPaceTip" value={s.paintPaceToSong} onChange={(v) => update({ paintPaceToSong: v })} caseStyle="title" />
          <p className="text-xs text-zinc-500 leading-relaxed">{t("paintPaceDesc")}</p>
        </div>
      </Searchable>
    </>
  );
}
