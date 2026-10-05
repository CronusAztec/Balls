"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import NumberField from "../NumberField";
import { Searchable, Slider, Toggle, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { FL_ARENAS, FL_MATCHES, FL_RANDOM, flPanelValue, matchFighters, type FlArena, type FlMatch } from "@/lib/physics/modes/fightLeague";
import { FL_BY_ID, FL_DIVISIONS, FL_PRESETS, fightersOf } from "@/lib/physics/modes/fightLeagueRoster";
// --- fl-overhaul --- (Stage 2) the fighter picker, its random tokens and the list view behind a toggle
import FighterPicker from "./FighterPicker";
import { flRandomToken, parseFlRandom } from "@/lib/physics/modes/fightLeague";
import { FL_CONFERENCE_IDS } from "@/lib/physics/modes/fightLeagueRoster";

/** --- fl-overhaul --- The list view (the native selects) is remembered per viewer; without storage it starts off. */
const LIST_VIEW_KEY = "fl-picker-list";
function readListView(): boolean {
  try {
    return window.localStorage.getItem(LIST_VIEW_KEY) === "1";
  } catch {
    return false;
  }
}
function writeListView(on: boolean) {
  try {
    window.localStorage.setItem(LIST_VIEW_KEY, on ? "1" : "0");
  } catch {
    /* no storage: the choice lasts this visit */
  }
}

export interface FightLeagueSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the Fight League block (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const FIGHT_LEAGUE_KEYS = ["flTitle", "flPreset", "flMatch", "flFighters", "flSameDivision", "flHp", "flTimeCap", "flArena", "flHud", "flHandicaps", "flSeek", "flSuddenDeath"];

const SLOT_FIELDS = ["flFighterA", "flFighterB", "flFighterC", "flFighterD"] as const;
const SLOT_LETTERS = ["A", "B", "C", "D"] as const;
const STATS = [
  { key: "Speed", labelKey: "flStatSpeed" },
  { key: "Damage", labelKey: "flStatDamage" },
  { key: "Attack", labelKey: "flStatAttack" },
  { key: "Cast", labelKey: "flStatCast" },
] as const;
type StatField = `fl${"Speed" | "Damage" | "Attack" | "Cast"}${"A" | "B" | "C" | "D"}`;

const MATCH_LABELS: Record<FlMatch, string> = { "1v1": "flMatch1v1", "2v2": "flMatch2v2", ffa3: "flMatchFfa3", ffa4: "flMatchFfa4" };
const ARENA_LABELS: Record<FlArena, string> = { square: "flArenaSquare", circle: "flArenaCircle" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** The preset whose fighters and match the settings hold (null: a custom matchup). */
function currentPreset(s: SimulatorSettings): string | null {
  for (const p of FL_PRESETS) {
    if (p.match !== s.flMatch) continue;
    const n = matchFighters(p.match);
    let same = true;
    for (let i = 0; i < n && same; i++) same = s[SLOT_FIELDS[i]] === p.fighters[i];
    if (same) return p.id;
  }
  return null;
}

/**
 * "Fight League" controls (feature fight-league), shown in the Mode row while Fight League is the mode (and in the Ball
 * section while the settings search is in use): a matchup preset, the match type (1v1, 2v2, a free-for-all of three or
 * four), the fighter of every slot – grouped by division, "random" picked by the seed – with its one-line description,
 * whether random slots stay in the first fighter's division, the HP, the time cap, the arena, the HUD and the per-slot
 * handicaps (speed, damage, attack speed and cast speed multipliers, uncapped number fields). The values live in
 * SimulatorSettings (URL keys `fl…`); Simulator.tsx forwards them to the engine (lib/physics/modes/fightLeague.ts) and
 * restarts the fight when one changes (the HUD switches live). Fighter, source and ability names are proper names: they
 * stay as they are in every language.
 */
export default function FightLeagueSection({ t, search, matches, settings: s, update }: FightLeagueSectionProps) {
  const fl = useTranslations("FightLeague");
  // --- fl-overhaul --- (Stage 2)
  const [listView, setListView] = useState(false);
  useEffect(() => {
    if (readListView()) setListView(true);
  }, []);
  const scopeLabel = (value: string): string | null => {
    const scope = parseFlRandom(value);
    if (!scope || scope.kind === "any") return null;
    return scope.kind === "division" ? fl(`division_${scope.id}`) : fl(`conference_${scope.id}`);
  };
  const slots = matchFighters(s.flMatch);
  const preset = currentPreset(s);
  const applyPreset = (id: string) => {
    const p = FL_PRESETS.find((x) => x.id === id);
    if (!p) return;
    const patch: Partial<SimulatorSettings> = { flMatch: p.match };
    for (let i = 0; i < 4; i++) patch[SLOT_FIELDS[i]] = p.fighters[i] ?? FL_RANDOM;
    update(patch);
  };
  const statValue = (stat: (typeof STATS)[number]["key"], slot: number) => s[`fl${stat}${SLOT_LETTERS[slot]}` as StatField];
  return (
    <div className="space-y-3 pt-2" data-testid="fight-league-section">
      {!search && (
        <div className="space-y-1">
          <p className="text-sm font-semibold text-ink">{t("flTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("flDesc")}</p>
        </div>
      )}
      <Searchable search={search} matches={matches} labelKey="flPreset">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-ink-2" htmlFor="fl-preset">
            {t("flPreset")}
            <Tooltip text={t("flPresetTip")} />
          </label>
          <select id="fl-preset" value={preset ?? ""} onChange={(e) => applyPreset(e.target.value)} className={`${selectClass} text-sm`} data-testid="fl-preset">
            {preset === null && <option value="">{t("flPresetCustom")}</option>}
            {FL_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="flMatch">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("flMatch")}
            <Tooltip text={t("flMatchTip")} />
          </label>
          <div className="grid grid-cols-4 gap-1" role="group" aria-label={t("flMatch")}>
            {FL_MATCHES.map((m) => (
              <button type="button" key={m} onClick={() => update({ flMatch: m })} aria-pressed={s.flMatch === m} className={pick(s.flMatch === m)} data-testid={`fl-match-${m}`}>
                {t(MATCH_LABELS[m])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="flFighters">
        <div className="space-y-3">
          {/* --- fl-overhaul --- (Stage 2) the picker chips, or the native selects behind the List view toggle */}
          <div className="flex justify-end">
            <button
              type="button"
              aria-pressed={listView}
              onClick={() => {
                writeListView(!listView);
                setListView(!listView);
              }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${listView ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
              data-testid="fl-picker-list-toggle"
            >
              {t("flPickerList")}
            </button>
          </div>
          {Array.from({ length: slots }, (_, i) => {
            const field = SLOT_FIELDS[i];
            const id = s[field];
            const row = FL_BY_ID.get(id);
            const team = s.flMatch === "2v2" ? (i < 2 ? "A+B" : "C+D") : null;
            const scope = scopeLabel(id);
            const set = (value: string) => update({ [field]: value } as Partial<SimulatorSettings>);
            return (
              <div key={field} className="space-y-1">
                <label className="text-sm font-medium text-ink-2" htmlFor={`fl-fighter-${i}`}>
                  {t("flFighterN", { slot: SLOT_LETTERS[i] })}
                  {team && <span className="ml-1 text-xs text-ink-3">· {t("flTeamOf", { team })}</span>}
                  {i === 0 && <Tooltip text={t("flFightersTip")} />}
                </label>
                {listView ? (
                  <select id={`fl-fighter-${i}`} value={id} onChange={(e) => set(e.target.value)} className={`${selectClass} text-sm`} data-testid={`fl-fighter-list-${SLOT_LETTERS[i]}`}>
                    <option value={FL_RANDOM}>{t("flRandom")}</option>
                    <optgroup label={t("flPickerGenres")}>
                      {FL_CONFERENCE_IDS.map((c) => (
                        <option key={c} value={flRandomToken(c)}>
                          {t("flPickerRandomConference", { conference: fl(`conference_${c}`) })}
                        </option>
                      ))}
                    </optgroup>
                    {FL_DIVISIONS.map((division) => (
                      <optgroup key={division} label={fl(`division_${division}`)}>
                        {division !== "wildcard" && <option value={flRandomToken(division)}>{t("flPickerRandomDivision", { division: fl(`division_${division}`) })}</option>}
                        {fightersOf(division).map((r) => (
                          <option key={r.id} value={r.id}>
                            {`${r.name} – ${r.source}`}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                ) : (
                  <FighterPicker t={t} slot={i} value={id} onChange={set} />
                )}
                <p className="text-xs text-ink-3 leading-relaxed" data-testid={`fl-fighter-desc-${SLOT_LETTERS[i]}`}>
                  {row ? fl(`fighter_${row.id}`) : scope ? t("flRandomHintScope", { group: scope }) : t(s.flSameDivision ? "flRandomHintDivision" : "flRandomHint")}
                  {row && <span className="block text-ink-2">{t("flAbility", { name: row.ability.name })}</span>}
                  {row && (
                    <span className="block text-ink-2" data-testid={`fl-fighter-role-${SLOT_LETTERS[i]}`}>
                      {t("flRole", { role: fl(`role_${row.role}`) })}
                    </span>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="flSameDivision">
        <Toggle t={t} labelKey="flSameDivision" tipKey="flSameDivisionTip" value={s.flSameDivision} onChange={(v) => update({ flSameDivision: v })} caseStyle="title" />
      </Searchable>
      {/* --- fl-overhaul --- the panel commits the value the fight runs (and the link carries): HP whole, the cap to a tenth */}
      <Slider t={t} search={search} matches={matches} labelKey="flHp" tipKey="flHpTip" value={s.flHp} range={RANGES.flHp} onChange={(v) => update({ flHp: flPanelValue("flHp", v) })} display={String(s.flHp)} />
      <Slider t={t} search={search} matches={matches} labelKey="flTimeCap" tipKey="flTimeCapTip" value={s.flTimeCap} range={RANGES.flTimeCap} onChange={(v) => update({ flTimeCap: flPanelValue("flTimeCap", v) })} display={s.flTimeCap > 0 ? `${s.flTimeCap}s` : t("flTimeCapOff")} />
      {/* --- fl-overhaul --- sudden death at the cap, and the intent steering's turn rate (0: the bounce look) */}
      <Searchable search={search} matches={matches} labelKey="flSuddenDeath">
        <Toggle t={t} labelKey="flSuddenDeath" tipKey="flSuddenDeathTip" value={s.flSuddenDeath} onChange={(v) => update({ flSuddenDeath: v })} caseStyle="title" />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="flSeek" tipKey="flSeekTip" value={s.flSeek} range={RANGES.flSeek} onChange={(v) => update({ flSeek: flPanelValue("flSeek", v) })} display={s.flSeek > 0 ? s.flSeek.toFixed(2) : t("flSeekOff")} />
      <Searchable search={search} matches={matches} labelKey="flArena">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("flArena")}
            <Tooltip text={t("flArenaTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("flArena")}>
            {FL_ARENAS.map((a) => (
              <button type="button" key={a} onClick={() => update({ flArena: a })} aria-pressed={s.flArena === a} className={pick(s.flArena === a)} data-testid={`fl-arena-${a}`}>
                {t(ARENA_LABELS[a])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="flHud">
        <Toggle t={t} labelKey="flHud" tipKey="flHudTip" value={s.flHud} onChange={(v) => update({ flHud: v })} caseStyle="title" />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="flHandicaps">
        <div className="space-y-2" data-testid="fl-handicaps">
          <label className="text-sm font-medium text-ink-2">
            {t("flHandicaps")}
            <Tooltip text={t("flHandicapsTip")} />
          </label>
          <div className="grid gap-1.5 text-xs" style={{ gridTemplateColumns: `minmax(4.5rem, auto) repeat(${slots}, minmax(0, 1fr))` }}>
            <span />
            {Array.from({ length: slots }, (_, i) => (
              <span key={i} className="text-center font-bold text-ink-3">
                {SLOT_LETTERS[i]}
              </span>
            ))}
            {STATS.map((stat) => (
              <div key={stat.key} className="contents">
                <span className="self-center text-ink-2">{t(stat.labelKey)}</span>
                {Array.from({ length: slots }, (_, i) => {
                  const key = `fl${stat.key}${SLOT_LETTERS[i]}` as StatField;
                  return <NumberField key={key} value={statValue(stat.key, i)} onCommit={(v) => update({ [key]: flPanelValue(key, v) } as Partial<SimulatorSettings>)} label={`${t(stat.labelKey)} ${SLOT_LETTERS[i]}`} range={RANGES[key]} rules={{ min: RANGES[key].min }} settingKey={key} className="w-full" />;
                })}
              </div>
            ))}
          </div>
        </div>
      </Searchable>
    </div>
  );
}
