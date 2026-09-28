"use client";

import { useState } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, type Matcher, type Translate } from "../ControlPrimitives";
import { formatSongTime, sliceCount } from "@/lib/audio/slicer";
import { RANGES, type SimulatorSettings } from "@/lib/settings";

export interface SongSlicerSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  showAdvanced: boolean;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  /** Name of the song decoded in this session, or null when none is loaded. */
  songName: string | null;
  /** Length of the decoded song in seconds (0 without a song). */
  songDuration: number;
  loading: boolean;
  onUpload: (file: File) => void;
  onClear: () => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.sound in Controls.tsx). */
export const SONG_SLICER_KEYS = ["sliceSong", "sliceEnabled", "sliceLength", "sliceLoop", "sliceFade"];

/**
 * "Song slicer" block of the Sound section: upload any audio file and every bounce plays
 * the next slice of it. The decoded song lives in the ToneGenerator (see Simulator.tsx);
 * this component only shows the file, the slice settings and the drop zone.
 */
export default function SongSlicerSection({ t, search, matches, showAdvanced, settings: s, update, songName, songDuration, loading, onUpload, onClear }: SongSlicerSectionProps) {
  const [drag, setDrag] = useState(false);
  const slices = sliceCount(songDuration, s.sliceMs / 1000);

  return (
    <>
      <Searchable search={search} matches={matches} labelKey="sliceSong">
        <div className="space-y-3 border-t border-zinc-800 pt-3">
          <label className="text-sm font-medium text-zinc-300">
            🎵 {t("sliceSong")}
            <Tooltip text={t("sliceSongTip")} />
          </label>
          <p className="text-xs text-zinc-500 leading-relaxed">{t("sliceSongDesc")}</p>
          {songName ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/60 rounded-lg border border-zinc-700/60" data-testid="slice-song-file">
              <span className="text-lg" aria-hidden="true">
                🎵
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 truncate" title={songName}>
                  {songName}
                </p>
                <p className="text-[11px] text-zinc-500 font-mono">{t("sliceSongInfo", { duration: formatSongTime(songDuration), slices })}</p>
              </div>
              <button type="button" onClick={onClear} aria-label={t("sliceRemoveSong")} title={t("sliceRemoveSong")} className="text-zinc-500 hover:text-red-400 transition-colors text-sm cursor-pointer px-1">
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
              } ${loading ? "opacity-60 pointer-events-none" : ""}`}
            >
              <span className="text-lg">{drag ? "📥" : "📁"}</span>
              <span className="font-semibold">{drag ? t("dropSongHere") : t("chooseSongFile")}</span>
              <input
                id="slice-song-input"
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
              {t("sliceLoadingSong")}
            </div>
          )}
          <Toggle t={t} labelKey="sliceEnabled" tipKey="sliceEnabledTip" value={s.sliceSong} onChange={(v) => update({ sliceSong: v })} caseStyle="title" />
          {s.sliceSong && !songName && !loading && <p className="text-[11px] text-amber-500/90">{t("sliceNoSong")}</p>}
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="sliceLength" tipKey="sliceLengthTip" value={s.sliceMs} range={RANGES.sliceMs} onChange={(v) => update({ sliceMs: v })} display={`${s.sliceMs} ms`} left="⚡" right="🎶" />
      <Searchable search={search} matches={matches} labelKey="sliceLoop">
        <Toggle t={t} labelKey="sliceLoop" tipKey="sliceLoopTip" value={s.sliceLoop} onChange={(v) => update({ sliceLoop: v })} caseStyle="title" />
      </Searchable>
      {showAdvanced && (
        <Slider t={t} search={search} matches={matches} labelKey="sliceFade" tipKey="sliceFadeTip" value={s.sliceFadeMs} range={RANGES.sliceFadeMs} onChange={(v) => update({ sliceFadeMs: v })} display={`${s.sliceFadeMs} ms`} />
      )}
    </>
  );
}
