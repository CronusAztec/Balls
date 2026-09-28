"use client";

import { useEffect, useRef, useState } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, type Matcher, type Translate } from "../ControlPrimitives";
import { formatSongTime } from "@/lib/audio/slicer";
import { RANGES, type SimulatorSettings } from "@/lib/settings";

/** The track decoded in this session, as the panel shows it. */
export interface MusicTrackInfo {
  name: string;
  /** Track length in seconds. */
  duration: number;
}

export interface MusicSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  showAdvanced: boolean;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  /** The uploaded track (kept in memory), or null when none is loaded. */
  track: MusicTrackInfo | null;
  loading: boolean;
  /** True while the bed is sounding (it follows start / pause / restart / end of the run). */
  playing: boolean;
  /** Current gain of the duck stage, 0–1, read once per frame for the level meter. */
  getDuckGain: () => number;
  onUpload: (file: File) => void;
  onRemove: () => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.sound in Controls.tsx). */
export const MUSIC_BED_KEYS = ["musicBed", "musicVolume", "musicDucking", "musicDuckRelease", "musicLoop", "musicStartOffset"];

/**
 * Thin bar that follows the duck gain while the bed plays: it dips on every bounce and swells
 * back over the release time. Written straight to the DOM once per frame, so the panel does
 * not re-render for it.
 */
function DuckMeter({ playing, getDuckGain, label }: { playing: boolean; getDuckGain: () => number; label: string }) {
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    if (!playing) {
      bar.style.width = "0%";
      return;
    }
    let raf = 0;
    const tick = () => {
      bar.style.width = `${Math.round(Math.max(0, Math.min(1, getDuckGain())) * 100)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, getDuckGain]);
  return (
    <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden" role="img" aria-label={label} data-testid="music-duck-meter">
      <div ref={barRef} className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-[#93d119]" style={{ width: "0%" }} />
    </div>
  );
}

/**
 * "Background music" block of the Sound section: upload a track (it stays in memory), then mix
 * it under the bounce sounds with volume, sidechain ducking, release, loop and start offset.
 * The audio lives in lib/audio/musicBed.ts (owned by the ToneGenerator) and Simulator.tsx drives
 * its transport; this component only edits the settings and hands the file up.
 */
export default function MusicSection({ t, search, matches, showAdvanced, settings: s, update, track, loading, playing, getDuckGain, onUpload, onRemove }: MusicSectionProps) {
  const [drag, setDrag] = useState(false);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  // The start offset can only reach as far as the track is long; without a track the full range is shown (search mode).
  const offsetRange = { ...RANGES.musicStartOffset, max: track ? Math.max(RANGES.musicStartOffset.step, Math.floor(track.duration * 2) / 2) : RANGES.musicStartOffset.max };
  // The mix controls only matter with a track loaded, but the search box must still find them.
  const showMix = !!track || !!search;

  return (
    <>
      <Searchable search={search} matches={matches} labelKey="musicBed">
        <div className="space-y-3 border-t border-zinc-800 pt-3">
          <label className="text-sm font-medium text-zinc-300 flex items-center justify-between">
            <span>
              🎼 {t("musicBed")}
              <Tooltip text={t("musicBedTip")} />
            </span>
            {track && playing && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#93d119] animate-pulse" data-testid="music-playing">
                ♪ {t("musicPlaying")}
              </span>
            )}
          </label>
          <p className="text-xs text-zinc-500 leading-relaxed">{t("musicBedDesc")}</p>
          {track ? (
            <div className="space-y-2 px-3 py-2 bg-zinc-800/60 rounded-lg border border-zinc-700/60" data-testid="music-track">
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden="true">
                  🎼
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 truncate" title={track.name}>
                    {track.name}
                  </p>
                  <p className="text-[11px] text-zinc-500 font-mono">{formatSongTime(track.duration)}</p>
                </div>
                <button type="button" onClick={onRemove} aria-label={t("musicRemove")} title={t("musicRemove")} className="text-zinc-500 hover:text-red-400 transition-colors text-sm cursor-pointer px-1">
                  ✕
                </button>
              </div>
              <DuckMeter playing={playing} getDuckGain={getDuckGain} label={t("musicDuckMeter")} />
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
              } ${loading ? "opacity-60 pointer-events-none" : ""}`}
            >
              <span className="text-lg">{drag ? "📥" : "📁"}</span>
              <span className="font-semibold">{drag ? t("dropMusicHere") : t("chooseMusicFile")}</span>
              <input
                id="music-file-input"
                type="file"
                accept=".mp3,.ogg,.oga,.wav,.m4a,.aac,.flac,.webm,audio/*"
                className="hidden"
                disabled={loading}
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
          {loading && (
            <div className="flex items-center gap-2 text-sm text-zinc-400" role="status">
              <div className="w-4 h-4 border-2 border-[#93d119] border-t-transparent rounded-full animate-spin" />
              {t("musicLoading")}
            </div>
          )}
        </div>
      </Searchable>
      {showMix && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="musicVolume" tipKey="musicVolumeTip" value={s.musicVolume} range={RANGES.musicVolume} onChange={(v) => update({ musicVolume: v })} display={pct(s.musicVolume)} left="🔈" right="🔊" />
          <Slider t={t} search={search} matches={matches} labelKey="musicDucking" tipKey="musicDuckingTip" value={s.musicDucking} range={RANGES.musicDucking} onChange={(v) => update({ musicDucking: v })} display={pct(s.musicDucking)} left="〰️" right="📉" />
          {showAdvanced && (
            <Slider t={t} search={search} matches={matches} labelKey="musicDuckRelease" tipKey="musicDuckReleaseTip" value={s.musicDuckRelease} range={RANGES.musicDuckRelease} onChange={(v) => update({ musicDuckRelease: v })} display={`${s.musicDuckRelease} ms`} left="⚡" right="🐢" />
          )}
          <Searchable search={search} matches={matches} labelKey="musicLoop">
            <Toggle t={t} labelKey="musicLoop" tipKey="musicLoopTip" value={s.musicLoop} onChange={(v) => update({ musicLoop: v })} caseStyle="title" />
          </Searchable>
          {showAdvanced && (
            <Slider
              t={t}
              search={search}
              matches={matches}
              labelKey="musicStartOffset"
              tipKey="musicStartOffsetTip"
              value={Math.min(s.musicStartOffset, offsetRange.max)}
              range={offsetRange}
              onChange={(v) => update({ musicStartOffset: v })}
              display={`${s.musicStartOffset}s`}
              left="⏮️"
              right="⏭️"
            />
          )}
        </>
      )}
    </>
  );
}
