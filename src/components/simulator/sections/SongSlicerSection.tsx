"use client";

import { useState } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, type Matcher, type Translate } from "../ControlPrimitives";
import { formatSongTime, sliceCount } from "@/lib/audio/slicer";
import { RANGES, type SimulatorSettings } from "@/lib/settings";

import { IconClose, IconUpload, IconWave } from "@/components/ui/icons"; // --- site-redesign ---
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
        <div className="space-y-3 border-t border-line pt-3">
          <label className="text-sm font-medium text-ink-2">
            {t("sliceSong")}
            <Tooltip text={t("sliceSongTip")} />
          </label>
          <p className="text-xs text-ink-3 leading-relaxed">{t("sliceSongDesc")}</p>
          {songName ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-2/60 rounded-lg border border-line-strong/60" data-testid="slice-song-file">
              <IconWave size={18} className="text-ink-3" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink truncate" title={songName}>
                  {songName}
                </p>
                <p className="text-xs text-ink-3 font-mono">{t("sliceSongInfo", { duration: formatSongTime(songDuration), slices })}</p>
              </div>
              <button type="button" onClick={onClear} aria-label={t("sliceRemoveSong")} title={t("sliceRemoveSong")} className="text-ink-3 hover:text-danger transition-colors text-sm cursor-pointer px-1">
                <IconClose size={14} />
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
                drag ? `bg-accent/10 border-accent text-accent scale-[1.02]` : "bg-surface-2 border-line-strong text-ink-2 hover:bg-surface-3 hover:border-ink-3"
              } ${loading ? "opacity-60 pointer-events-none" : ""}`}
            >
              <IconUpload size={20} className={drag ? "text-accent" : "text-ink-3"} />
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
            <div className="flex items-center gap-2 text-sm text-ink-2" role="status">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              {t("sliceLoadingSong")}
            </div>
          )}
          <Toggle t={t} labelKey="sliceEnabled" tipKey="sliceEnabledTip" value={s.sliceSong} onChange={(v) => update({ sliceSong: v })} caseStyle="title" />
          {s.sliceSong && !songName && !loading && <p className="text-xs text-warn/90">{t("sliceNoSong")}</p>}
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="sliceLength" tipKey="sliceLengthTip" value={s.sliceMs} range={RANGES.sliceMs} onChange={(v) => update({ sliceMs: v })} display={`${s.sliceMs} ms`} />
      <Searchable search={search} matches={matches} labelKey="sliceLoop">
        <Toggle t={t} labelKey="sliceLoop" tipKey="sliceLoopTip" value={s.sliceLoop} onChange={(v) => update({ sliceLoop: v })} caseStyle="title" />
      </Searchable>
      {showAdvanced && (
        <Slider t={t} search={search} matches={matches} labelKey="sliceFade" tipKey="sliceFadeTip" value={s.sliceFadeMs} range={RANGES.sliceFadeMs} onChange={(v) => update({ sliceFadeMs: v })} display={`${s.sliceFadeMs} ms`} />
      )}
    </>
  );
}
