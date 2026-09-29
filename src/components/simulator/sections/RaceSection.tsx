"use client";

import { useSyncExternalStore } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { MAX_CUP_TITLE_LENGTH, RACE_CAMERAS, RACE_SHAPES, type RaceCamera, type RaceShape } from "@/lib/physics/modes/race";
import { RACE_FEATURES, type RaceFeature } from "@/lib/physics/raceTrack";
import { rankCup, raceCupStore } from "@/lib/raceCup";
import { CUP_TITLE_KEYS, RACER_NAME_KEYS, raceRoster } from "@/lib/raceRoster";

export interface RaceSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const RACE_KEYS = ["rcRacers", "rcShape", "rcTrackLength", "rcLaps", "rcFeature", "rcCamera", "rcStandings", "rcMiniMap", "rcCup", "rcCupTitle", "rcCupReset", "rcWinner"];

const SHAPE_OPTIONS: Record<RaceShape, { icon: string; labelKey: string }> = {
  square: { icon: "■", labelKey: "rcShapeSquare" },
  circle: { icon: "●", labelKey: "rcShapeCircle" },
};

const CAMERA_OPTIONS: Record<RaceCamera, { icon: string; labelKey: string }> = {
  leader: { icon: "🥇", labelKey: "rcCameraLeader" },
  pack: { icon: "👥", labelKey: "rcCameraPack" },
};

const FEATURE_LABELS: Record<RaceFeature, string> = {
  mixed: "rcFeatureMixed",
  pegs: "rcFeaturePegs",
  funnels: "rcFeatureFunnels",
  spinners: "rcFeatureSpinners",
  swaps: "rcFeatureSwaps",
  turbo: "rcFeatureTurbo",
  bumpers: "rcFeatureBumpers",
  gates: "rcFeatureGates",
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`;

function GroupTitle({ children }: { children: string }) {
  return <p className="pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">{children}</p>;
}

/** The cup kept in this browser (lib/raceCup.ts), re-rendering when a race is scored or the cup is reset. */
export function useRaceCup() {
  return useSyncExternalStore(raceCupStore.subscribe, raceCupStore.get, () => null);
}

/** The translated default racer names (the colour names of the racer palette). */
export function defaultRacerNames(t: (key: string) => string): string[] {
  return RACER_NAME_KEYS.map((key) => t(key));
}

/** The cup's name: the title typed in, or the automatic one named after the track's featured obstacle. */
export function cupTitleOf(t: (key: string) => string, s: Pick<SimulatorSettings, "rcCupTitle" | "rcFeature">): string {
  return s.rcCupTitle.trim() || t(CUP_TITLE_KEYS[s.rcFeature]);
}

/**
 * "Race" controls of the Square Racing Grand Prix, shown in the Mode row while the mode is active (and in the Ball
 * section while the settings search is in use): the grid (racers, squares or circles – names, colours and emoji come
 * from the Teams roster), the track (length, laps, obstacle mix), the broadcast (camera, standings, mini-map), the cup
 * (points across races in this browser, its title, a reset) and the staged winner. The values live in SimulatorSettings
 * like everything else; Simulator.tsx forwards them to the engine (see lib/physics/modes/race.ts) and restarts the race
 * when the track changes.
 */
export default function RaceSection({ t, search, matches, settings: s, update }: RaceSectionProps) {
  const cup = useRaceCup();
  const roster = raceRoster(s.teams, defaultRacerNames(t));
  const cupHere = cup && cup.racers === s.rcRacers ? cup : null;
  const leader = cupHere && cupHere.races > 0 ? rankCup(cupHere)[0] : -1;
  const rigged = s.rcWinner >= 0 && s.rcWinner < s.rcRacers;
  return (
    <div className="space-y-3 pt-2" data-testid="race-section">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{t("rcTitle")}</p>
          <p className="text-xs text-zinc-500 leading-relaxed">{t("rcDesc")}</p>
        </div>
      )}
      {!search && <GroupTitle>{t("rcGroupGrid")}</GroupTitle>}
      <Slider t={t} search={search} matches={matches} labelKey="rcRacers" tipKey="rcRacersTip" value={s.rcRacers} range={RANGES.rcRacers} onChange={(v) => update({ rcRacers: v, rcWinner: s.rcWinner >= v ? -1 : s.rcWinner })} display={String(s.rcRacers)} left="2" right="16" />
      <Searchable search={search} matches={matches} labelKey="rcShape">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">
            {t("rcShape")}
            <Tooltip text={t("rcShapeTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("rcShape")}>
            {RACE_SHAPES.map((shape) => (
              <button type="button" key={shape} onClick={() => update({ rcShape: shape })} aria-pressed={s.rcShape === shape} className={pick(s.rcShape === shape)}>
                <span aria-hidden="true">{SHAPE_OPTIONS[shape].icon}</span> {t(SHAPE_OPTIONS[shape].labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      {!search && (
        <div className="flex flex-wrap gap-1" data-testid="race-roster">
          {roster.names.slice(0, s.rcRacers).map((name, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-md bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-300">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: roster.colors[i] }} />
              {roster.emoji[i] ? `${roster.emoji[i]} ` : ""}
              {name}
            </span>
          ))}
          <p className="w-full text-[11px] text-zinc-500 leading-relaxed">{t("rcRosterNote")}</p>
        </div>
      )}
      {!search && <GroupTitle>{t("rcGroupTrack")}</GroupTitle>}
      <Slider t={t} search={search} matches={matches} labelKey="rcTrackLength" tipKey="rcTrackLengthTip" value={s.rcTrackLength} range={RANGES.rcTrackLength} onChange={(v) => update({ rcTrackLength: v })} display={t("rcScreens", { count: s.rcTrackLength })} left="🏁" right="🛣️" />
      <Slider t={t} search={search} matches={matches} labelKey="rcLaps" tipKey="rcLapsTip" value={s.rcLaps} range={RANGES.rcLaps} onChange={(v) => update({ rcLaps: v })} display={String(s.rcLaps)} left="1" right="🔁" />
      <Searchable search={search} matches={matches} labelKey="rcFeature">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300" htmlFor="race-feature">
            {t("rcFeature")}
            <Tooltip text={t("rcFeatureTip")} />
          </label>
          <select id="race-feature" value={s.rcFeature} onChange={(e) => update({ rcFeature: e.target.value as RaceFeature })} className={selectClass} aria-label={t("rcFeature")}>
            {RACE_FEATURES.map((feature) => (
              <option key={feature} value={feature}>
                {t(FEATURE_LABELS[feature])}
              </option>
            ))}
          </select>
        </div>
      </Searchable>
      {!search && <GroupTitle>{t("rcGroupView")}</GroupTitle>}
      <Searchable search={search} matches={matches} labelKey="rcCamera">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">
            {t("rcCamera")}
            <Tooltip text={t("rcCameraTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("rcCamera")}>
            {RACE_CAMERAS.map((camera) => (
              <button type="button" key={camera} onClick={() => update({ rcCamera: camera })} aria-pressed={s.rcCamera === camera} className={pick(s.rcCamera === camera)}>
                <span aria-hidden="true">{CAMERA_OPTIONS[camera].icon}</span> {t(CAMERA_OPTIONS[camera].labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="rcStandings">
        <Toggle t={t} labelKey="rcStandings" tipKey="rcStandingsTip" value={s.rcStandings} onChange={(v) => update({ rcStandings: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="rcMiniMap">
        <Toggle t={t} labelKey="rcMiniMap" tipKey="rcMiniMapTip" value={s.rcMiniMap} onChange={(v) => update({ rcMiniMap: v })} />
      </Searchable>
      {!search && <GroupTitle>{t("rcGroupCup")}</GroupTitle>}
      <Searchable search={search} matches={matches} labelKey="rcCup">
        <Toggle t={t} labelKey="rcCup" tipKey="rcCupTip" value={s.rcCup} onChange={(v) => update({ rcCup: v })} />
      </Searchable>
      {(s.rcCup || !!search) && (
        <>
          <Searchable search={search} matches={matches} labelKey="rcCupTitle">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300" htmlFor="race-cup-title">
                {t("rcCupTitle")}
                <Tooltip text={t("rcCupTitleTip")} />
              </label>
              <input
                id="race-cup-title"
                type="text"
                value={s.rcCupTitle}
                maxLength={2 * MAX_CUP_TITLE_LENGTH}
                onChange={(e) => update({ rcCupTitle: Array.from(e.target.value).slice(0, MAX_CUP_TITLE_LENGTH).join("") })}
                placeholder={t(CUP_TITLE_KEYS[s.rcFeature])}
                aria-label={t("rcCupTitle")}
                className="w-full px-3 py-2 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-cyan-600 focus:outline-none placeholder-zinc-500 text-sm"
              />
            </div>
          </Searchable>
          <Searchable search={search} matches={matches} labelKey="rcCupReset">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-zinc-500 leading-relaxed" data-testid="race-cup-summary">
                {cupHere && cupHere.races > 0 && leader >= 0 ? t("rcCupSummary", { races: cupHere.races, name: roster.names[leader], points: cupHere.points[leader] }) : t("rcCupEmpty")}
              </p>
              <button type="button" onClick={() => raceCupStore.reset()} disabled={!cup} className="shrink-0 px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
                {t("rcCupReset")}
              </button>
            </div>
          </Searchable>
        </>
      )}
      {!search && <GroupTitle>{t("rcGroupRig")}</GroupTitle>}
      <Searchable search={search} matches={matches} labelKey="rcWinner">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300" htmlFor="race-winner">
            {t("rcWinner")}
            <Tooltip text={t("rcWinnerTip")} />
          </label>
          <select id="race-winner" value={rigged ? s.rcWinner : -1} onChange={(e) => update({ rcWinner: Number(e.target.value) })} className={selectClass} aria-label={t("rcWinner")}>
            <option value={-1}>{t("rcWinnerFair")}</option>
            {roster.names.slice(0, s.rcRacers).map((name, i) => (
              <option key={i} value={i}>
                {name}
              </option>
            ))}
          </select>
          {rigged && (
            <p className="text-[11px] text-amber-500/90 leading-relaxed" data-testid="race-rig-warning">
              🎭 {t("rcWinnerWarning")}
            </p>
          )}
        </div>
      </Searchable>
    </div>
  );
}
