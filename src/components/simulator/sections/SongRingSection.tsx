"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { SONG_RING_SONGS } from "@/lib/physics/modes/songRing";

export interface SongRingSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const SONG_RING_KEYS = ["srSong", "srLapSec", "srSpeed", "srBalls", "srHelp", "srLive"];

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/**
 * "Song Ring" controls (feature song-ring), shown in the Mode row while Song Ring is the mode (and in the Ball section
 * while the settings search is in use): the tune (or the seed's pick), the playhead's lap time, the ball's speed, the
 * number of balls, the help and the live notes. The values live in SimulatorSettings; Simulator.tsx forwards them to the
 * engine (see lib/physics/modes/songRing.ts) and restarts the run when one changes. The panel names the tunes; the canvas
 * names one only at the end of its run.
 */
export default function SongRingSection({ t, search, matches, settings: s, update }: SongRingSectionProps) {
  return (
    <div className="space-y-3 pt-2" data-testid="song-ring">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("srTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("srDesc")}</p>
        </div>
      )}
      <Searchable search={search} matches={matches} labelKey="srSong">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("srSong")}
            <Tooltip text={t("srSongTip")} />
          </span>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("srSong")} data-testid="song-ring-songs">
            {SONG_RING_SONGS.map((song) => (
              <button type="button" key={song} onClick={() => update({ srSong: song })} aria-pressed={s.srSong === song} className={pick(s.srSong === song)} data-sr-song={song}>
                {t(`srSong_${song}`)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="srLapSec" tipKey="srLapSecTip" value={s.srLapSec} range={RANGES.srLapSec} onChange={(v) => update({ srLapSec: v })} display={`${s.srLapSec.toFixed(1)}s`} />
      <Slider t={t} search={search} matches={matches} labelKey="srSpeed" tipKey="srSpeedTip" value={s.srSpeed} range={RANGES.srSpeed} onChange={(v) => update({ srSpeed: v })} display={`${s.srSpeed.toFixed(1)}×`} />
      <Slider t={t} search={search} matches={matches} labelKey="srBalls" tipKey="srBallsTip" value={s.srBalls} range={RANGES.srBalls} onChange={(v) => update({ srBalls: v })} display={String(s.srBalls)} />
      <Slider t={t} search={search} matches={matches} labelKey="srHelp" tipKey="srHelpTip" value={s.srHelp} range={RANGES.srHelp} onChange={(v) => update({ srHelp: v })} display={s.srHelp.toFixed(2)} />
      <Searchable search={search} matches={matches} labelKey="srLive">
        <Toggle t={t} labelKey="srLive" tipKey="srLiveTip" value={s.srLive} onChange={(v) => update({ srLive: v })} />
      </Searchable>
      {!search && (
        <p className="text-xs text-ink-2 leading-relaxed tabular-nums" data-testid="song-ring-run">
          {t("srRunInfo", { lap: s.srLapSec })}
        </p>
      )}
    </div>
  );
}
