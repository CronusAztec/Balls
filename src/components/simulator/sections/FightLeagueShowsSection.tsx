"use client";

import { useState } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { flPanelValue, flShowKind } from "@/lib/physics/modes/fightLeague";
import { FL_BY_ID, FL_DIVISIONS, FL_PRESETS, FL_PRESET_FORMATS, fightersOf, type FlPresetFormat } from "@/lib/physics/modes/fightLeagueRoster";
import { FL_SEEDINGS, flBestOfGames, flClockText, flShowClipEstimateSec, sanitizeFlEntrants, type FlSeeding } from "@/lib/physics/modes/fightLeagueShow";
import { MiniBall } from "./FighterPicker";
import { flCurrentPreset, flPresetPatch } from "./fightLeaguePresetMatch";

/*
 * --- fl-overhaul --- (Stage 5) The Fight League block's shows and gallery (rendered inside FightLeagueSection):
 *
 *  - the preset gallery: format chips (all, duel, series, team, free-for-all, bracket, boss rush, rework; data-testid
 *    fl-preset-format-<format>) over a scrolling row of cards (mini balls in the fighters' colours and the label;
 *    fl-preset-card-<id>), and "Surprise me" (fl-surprise: a division and two of its fighters – the page's own random
 *    number, fine here: it writes concrete ids, and the run itself stays the seed's);
 *  - the show settings by format: Best of (a series on 1v1 / 2v2 / 3v3, a bracket's final), a bracket's entrants, size and
 *    seeding, a boss rush's challengers, waves, the boss's HP and its heal, the interlude's card, and the clip's expected
 *    length (no fast-forward: a presentation rate is out of scope);
 *  - the VS card's win chance (simulated) switch.
 *
 * Every value lives in SimulatorSettings (URL keys flBo, flE, flBr, flSd, flBw, flBoss, flBh, flCard, flOd); the numbers are
 * uncapped number fields with comfort ranges (`FIGHT_LEAGUE_RANGES`), committed through `flPanelValue()` (a series' length
 * rounds up to an odd one, counts to whole numbers).
 */

/** Search keys of the shows' controls (FIGHT_LEAGUE_KEYS adds them). */
export const FIGHT_LEAGUE_SHOW_KEYS = ["flPresetGallery", "flSurprise", "flShows", "flBestOf", "flEntrants", "flBracketSize", "flSeeding", "flBossWaves", "flBossHp", "flBossHeal", "flCardSec", "flOdds"];

const SEEDING_LABELS: Record<FlSeeding, string> = { rating: "flSeedingRating", random: "flSeedingRandom", listed: "flSeedingListed" };

const chip = (active: boolean) => `shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

export interface FightLeagueShowsProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** The preset gallery: format chips, a scrolling row of cards, "Surprise me". */
export function FightLeaguePresetGallery({ t, search, matches, settings: s, update }: FightLeagueShowsProps) {
  const [format, setFormat] = useState<FlPresetFormat | "all">("all");
  const current = flCurrentPreset(s);
  const shown = format === "all" ? FL_PRESETS : FL_PRESETS.filter((p) => p.format === format);
  const surprise = () => {
    // a division (Gerald's Wildcard left out) and two of its fighters – concrete ids, so the run stays the seed's
    const divisions = FL_DIVISIONS.filter((d) => d !== "wildcard" && fightersOf(d).length >= 2);
    const division = divisions[Math.floor(Math.random() * divisions.length)] ?? "marvel";
    const pool = fightersOf(division);
    const a = Math.floor(Math.random() * pool.length);
    let b = Math.floor(Math.random() * (pool.length - 1));
    if (b >= a) b++;
    update({ flMatch: "1v1", flFighterA: pool[a].id, flFighterB: pool[b].id, flBestOf: 1 });
  };
  return (
    <Searchable search={search} matches={matches} labelKey="flPresetGallery">
      <div className="space-y-2" data-testid="fl-preset-gallery">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink-2">
            {t("flPresetGallery")}
            <Tooltip text={t("flPresetGalleryTip")} />
          </p>
          <button type="button" onClick={surprise} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-surface-2 text-ink-2 hover:bg-surface-3 cursor-pointer" data-testid="fl-surprise" title={t("flSurpriseTip")}>
            {t("flSurprise")}
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1" role="group" aria-label={t("flPresetGallery")}>
          {(["all", ...FL_PRESET_FORMATS] as const).map((f) => (
            <button type="button" key={f} onClick={() => setFormat(f)} aria-pressed={format === f} className={chip(format === f)} data-testid={`fl-preset-format-${f}`}>
              {t(`flPresetFormat_${f}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 snap-x" data-testid="fl-preset-cards">
          {shown.map((p) => {
            const active = current?.id === p.id;
            const balls = p.fighters.slice(0, 6);
            return (
              <button
                type="button"
                key={p.id}
                onClick={() => update(flPresetPatch(p, s))}
                aria-pressed={active}
                className={`snap-start shrink-0 w-36 rounded-xl border p-2 text-left transition-all cursor-pointer ${active ? "border-accent bg-accent/10" : "border-line bg-surface-2 hover:bg-surface-3"}`}
                data-testid={`fl-preset-card-${p.id}`}
              >
                <span className="flex items-center gap-0.5" aria-hidden="true">
                  {balls.map((id, i) => (
                    <MiniBall key={`${id}-${i}`} row={FL_BY_ID.get(id) ?? null} size={16} />
                  ))}
                  {(p.match === "bracket" || p.match === "boss") && <span className="ml-1 text-[10px] font-bold text-ink-3">+{Math.max(0, (p.size ?? 0) - (p.match === "boss" ? 0 : balls.length))}</span>}
                </span>
                <span className="mt-1 block text-xs leading-snug text-ink-2 line-clamp-2">{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Searchable>
  );
}

/** The show settings of the match type (a series, a bracket, a boss rush), the clip's expected length and the win chance switch. */
export default function FightLeagueShowsSection({ t, search, matches, settings: s, update }: FightLeagueShowsProps) {
  const kind = flShowKind({ match: s.flMatch, bestOf: s.flBestOf });
  const seriesOn = s.flMatch === "1v1" || s.flMatch === "2v2" || s.flMatch === "3v3" || s.flMatch === "bracket";
  const pool = s.flMatch === "bracket" || s.flMatch === "boss";
  // the entrant list is typed freely and committed (sanitised: the known ids and tokens) on blur or Enter
  const [entrants, setEntrants] = useState(s.flEntrants);
  const [seen, setSeen] = useState(s.flEntrants);
  if (seen !== s.flEntrants) {
    // (a link, a preset or another arena changed the list: the field follows – state adjusted while rendering)
    setSeen(s.flEntrants);
    setEntrants(s.flEntrants);
  }
  const commitEntrants = () => {
    const clean = sanitizeFlEntrants(entrants);
    setEntrants(clean);
    if (clean !== s.flEntrants) update({ flEntrants: clean });
  };
  const num = (field: "flBestOf" | "flBracketSize" | "flBossWaves" | "flBossHp" | "flBossHeal" | "flCardSec") => (v: number) => update({ [field]: flPanelValue(field, v) } as Partial<SimulatorSettings>);
  const estimate = kind === "single" ? 0 : flShowClipEstimateSec({ kind, bestOf: s.flBestOf, bracketSize: s.flBracketSize, bossWaves: s.flBossWaves, cardSec: s.flCardSec });
  return (
    <div className="space-y-3" data-testid="fl-shows" data-fl-show-kind={kind}>
      <Searchable search={search} matches={matches} labelKey="flShows">
        <p className="pt-1 text-xs font-bold uppercase tracking-wide text-ink-3">
          {t("flShows")}
          <Tooltip text={t("flShowsTip")} />
        </p>
      </Searchable>
      {seriesOn && <Slider t={t} search={search} matches={matches} labelKey="flBestOf" tipKey="flBestOfTip" value={s.flBestOf} range={RANGES.flBestOf} onChange={num("flBestOf")} display={flBestOfGames(s.flBestOf) > 1 ? t("flBestOfN", { n: flBestOfGames(s.flBestOf) }) : t("flBestOfOne")} />}
      {pool && (
        <Searchable search={search} matches={matches} labelKey="flEntrants">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink-2" htmlFor="fl-entrants">
              {t("flEntrants")}
              <Tooltip text={t("flEntrantsTip")} />
            </label>
            <input
              id="fl-entrants"
              type="text"
              value={entrants}
              placeholder={s.flMatch === "boss" ? "random:marvel" : "random:marvel, division:dc"}
              onChange={(e) => setEntrants(e.target.value)}
              onBlur={commitEntrants}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEntrants();
              }}
              className="w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink"
              data-testid="fl-entrants"
              spellCheck={false}
            />
          </div>
        </Searchable>
      )}
      {s.flMatch === "bracket" && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="flBracketSize" tipKey="flBracketSizeTip" value={s.flBracketSize} range={RANGES.flBracketSize} onChange={num("flBracketSize")} display={String(s.flBracketSize)} />
          <Searchable search={search} matches={matches} labelKey="flSeeding">
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-2">
                {t("flSeeding")}
                <Tooltip text={t("flSeedingTip")} />
              </label>
              <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("flSeeding")}>
                {FL_SEEDINGS.map((sd) => (
                  <button type="button" key={sd} onClick={() => update({ flSeeding: sd })} aria-pressed={s.flSeeding === sd} className={`px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.flSeeding === sd ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`} data-testid={`fl-seeding-${sd}`}>
                    {t(SEEDING_LABELS[sd])}
                  </button>
                ))}
              </div>
            </div>
          </Searchable>
        </>
      )}
      {s.flMatch === "boss" && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="flBossWaves" tipKey="flBossWavesTip" value={s.flBossWaves} range={RANGES.flBossWaves} onChange={num("flBossWaves")} display={String(s.flBossWaves)} />
          <Slider t={t} search={search} matches={matches} labelKey="flBossHp" tipKey="flBossHpTip" value={s.flBossHp} range={RANGES.flBossHp} onChange={num("flBossHp")} display={`×${s.flBossHp}`} />
          <Slider t={t} search={search} matches={matches} labelKey="flBossHeal" tipKey="flBossHealTip" value={s.flBossHeal} range={RANGES.flBossHeal} onChange={num("flBossHeal")} display={`${Math.round(100 * s.flBossHeal)}%`} />
        </>
      )}
      {kind !== "single" && <Slider t={t} search={search} matches={matches} labelKey="flCardSec" tipKey="flCardSecTip" value={s.flCardSec} range={RANGES.flCardSec} onChange={num("flCardSec")} display={`${s.flCardSec}s`} />}
      {kind !== "single" && (
        <p className="text-xs text-ink-3" data-testid="fl-clip-estimate" data-sec={Math.round(estimate)}>
          {t("flClipLength", { time: flClockText(estimate) })}
        </p>
      )}
      <Searchable search={search} matches={matches} labelKey="flOdds">
        <Toggle t={t} labelKey="flOdds" tipKey="flOddsTip" value={s.flOdds} onChange={(v) => update({ flOdds: v })} caseStyle="title" />
      </Searchable>
    </div>
  );
}
