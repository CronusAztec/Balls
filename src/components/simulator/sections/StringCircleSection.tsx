"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { CAPTION_WINNER_TOKEN, MAX_CAPTIONS, defaultCaption } from "@/lib/captions";
import { rosterPatch } from "@/lib/teams";
import { SC_ARENAS, SC_PRESET_IDS, SC_STRING_CEILING, SC_TITLE_LENGTH, circleLineup, isScPresetId, sanitizeScTitle, stringCirclePresetPatch, type ScArena, type ScPresetId } from "@/lib/physics/modes/stringCircle";

export interface StringCircleSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** --- string-circle --- Search keys of the controls rendered here (StringBattleSection adds them to its own, so the search box and the palette find them). */
export const STRING_CIRCLE_KEYS = ["scPreset", "scArena", "scRate", "scCut", "scTitle", "scHud", "scCaption"];

const ARENA_OPTIONS: Record<ScArena, { icon: string; labelKey: string }> = {
  circle: { icon: "●", labelKey: "scArenaCircle" },
  hexagon: { icon: "⬢", labelKey: "scArenaHexagon" },
};

const PRESET_LABELS: Record<ScPresetId, string> = {
  indiaUsa: "scPresetIndiaUsa",
  countries4: "scPresetCountries4",
  mega12: "scPresetMega12",
  hexagon6: "scPresetHexagon6",
  classic5: "scPresetClassic5",
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/**
 * --- string-circle --- The String Battle's circle style (lib/physics/modes/stringCircle.ts), shown in the String Battle block
 * while the style is "circle" (and while the settings search is in use): the built-in presets (country fights), the arena
 * (circle / hexagon), the strings a ball anchors a second, the strings cut per life, the title line, the standings strip and a
 * "Which flag wins?" caption. The values live in SimulatorSettings; Simulator.tsx restarts the battle when one of the fight's
 * changes (the title and the strip follow live). A team roster – its Country picker fills an entry with a country – names,
 * colours and flags the first balls; the balls past it play the line-up's countries, named by their codes.
 */
export default function StringCircleSection({ t, search, matches, settings: s, update }: StringCircleSectionProps) {
  const countries = useTranslations("Countries");
  const titleId = useId();
  const applyPreset = (id: ScPresetId) => {
    const { teams, ...rest } = stringCirclePresetPatch(id, (code, english) => (countries.has(code) ? countries(code) : english));
    update({ ...rest, ...rosterPatch(teams) });
  };
  const fromRoster = Math.min(s.teams.length, s.sbBalls);
  const lineup = circleLineup(s.teams.slice(0, fromRoster), Math.min(s.sbBalls, fromRoster + 8))
    .slice(fromRoster)
    .map((l) => l.code);
  const hasCaption = s.captions.some((c) => c.type === "question" && c.answer.toLowerCase().includes(CAPTION_WINNER_TOKEN));
  return (
    <div className="space-y-3 pt-2" data-testid="string-circle-section">
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("scDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="scPreset">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("scPreset")}
            <Tooltip text={t("scPresetTip")} />
          </label>
          <select
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (isScPresetId(id)) applyPreset(id);
            }}
            aria-label={t("scPreset")}
            className={`${selectClass} text-sm py-1.5`}
            data-testid="sc-preset"
          >
            <option value="">{t("scPresetChoose")}</option>
            {SC_PRESET_IDS.map((id) => (
              <option key={id} value={id}>
                {t(PRESET_LABELS[id])}
              </option>
            ))}
          </select>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="scArena">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("scArena")}
            <Tooltip text={t("scArenaTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("scArena")} data-testid="sc-arena">
            {SC_ARENAS.map((arena) => (
              <button type="button" key={arena} onClick={() => update({ sbArena: arena })} aria-pressed={s.sbArena === arena} className={pick(s.sbArena === arena)} data-arena={arena}>
                <span aria-hidden="true">{ARENA_OPTIONS[arena].icon}</span> {t(ARENA_OPTIONS[arena].labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="scRate" tipKey="scRateTip" value={s.sbRate} range={RANGES.sbRate} onChange={(v) => update({ sbRate: v })} display={t("scRateValue", { n: s.sbRate })} />
      <Slider t={t} search={search} matches={matches} labelKey="scCut" tipKey="scCutTip" value={s.sbCut} range={RANGES.sbCut} onChange={(v) => update({ sbCut: v })} display={String(s.sbCut)} />
      {!search && (
        <p className="text-xs text-ink-3 leading-relaxed" data-testid="sc-lineup-note">
          {lineup.length > 0 ? t("scLineupNote", { codes: lineup.join(" · "), max: SC_STRING_CEILING.toLocaleString() }) : t("scRosterNote", { max: SC_STRING_CEILING.toLocaleString() })}
        </p>
      )}
      <Searchable search={search} matches={matches} labelKey="scTitle">
        <div className="space-y-2">
          <label htmlFor={titleId} className="text-sm font-medium text-ink-2">
            {t("scTitle")}
            <Tooltip text={t("scTitleTip")} />
          </label>
          <input
            id={titleId}
            type="text"
            value={s.sbTitle}
            maxLength={2 * SC_TITLE_LENGTH}
            placeholder={t("scTitlePlaceholder")}
            onChange={(e) => update({ sbTitle: sanitizeScTitle(e.target.value) })}
            className="w-full px-3 py-2 bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim placeholder:text-ink-3 text-sm"
            data-testid="sc-title"
          />
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="scHud">
        <Toggle t={t} labelKey="scHud" tipKey="scHudTip" value={s.sbHud} onChange={(v) => update({ sbHud: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="scCaption">
        <div className="space-y-1.5">
          <button
            type="button"
            disabled={hasCaption || s.captions.length >= MAX_CAPTIONS}
            onClick={() => update({ captions: [...s.captions, defaultCaption("question", { text: t("scCaptionQuestion"), answer: CAPTION_WINNER_TOKEN })] })}
            className="w-full px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-surface-2 text-accent border border-dashed border-accent/40 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="sc-caption"
          >
            ＋ {t("scCaption")}
          </button>
          {!search && <p className="text-xs text-ink-3 leading-relaxed">{hasCaption ? t("scCaptionAdded") : t("scCaptionNote")}</p>}
        </div>
      </Searchable>
    </div>
  );
}
