"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { CAPTION_WINNER_TOKEN, MAX_CAPTIONS, defaultCaption } from "@/lib/captions";
import { rosterPatch } from "@/lib/teams";
import { MAX_TEAMS } from "@/lib/physics/ballStats";
import {
  LC_ARENAS,
  LC_BLOCK_CEILING,
  LC_PALETTE,
  LC_PRESET_IDS,
  LC_RULES,
  LC_TITLE_LENGTH,
  isLcPresetId,
  landClaimClipSec,
  landClaimPresetPatch,
  sanitizeLcTitle,
  type LcArena,
  type LcPresetId,
  type LcRule,
} from "@/lib/physics/modes/landClaim";

export interface LandClaimSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const LAND_CLAIM_KEYS = ["lcPreset", "lcRule", "lcArena", "lcTeams", "lcBalls", "lcCols", "lcRows", "lcEvery", "lcDuration", "lcTitle", "lcHud", "lcCaption"];

const RULE_OPTIONS: Record<LcRule, { icon: string; labelKey: string; hintKey: string }> = {
  knock: { icon: "💥", labelKey: "lcRuleKnock", hintKey: "lcHintKnock" },
  claim: { icon: "🎨", labelKey: "lcRuleClaim", hintKey: "lcHintClaim" },
  steal: { icon: "🔁", labelKey: "lcRuleSteal", hintKey: "lcHintSteal" },
};

const ARENA_OPTIONS: Record<LcArena, { icon: string; labelKey: string }> = {
  square: { icon: "■", labelKey: "lcArenaSquare" },
  hexagon: { icon: "⬢", labelKey: "lcArenaHexagon" },
  circle: { icon: "●", labelKey: "lcArenaCircle" },
};

const PRESET_LABELS: Record<LcPresetId, string> = {
  countries4: "lcPresetCountries4",
  domination: "lcPresetDomination",
  steal: "lcPresetSteal",
  hexagon6: "lcPresetHexagon6",
  claim2v2: "lcPresetClaim2v2",
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/**
 * "Land Claim" controls (feature land-claim), shown in the Mode row while the mode is active (and in the Ball section while
 * the settings search is in use): the built-in presets, the rule (knock / claim / steal), the arena (square / hexagon /
 * circle), the competitors and their balls, the wall's columns and rows, how often a knocked block adds a ball, the duration,
 * the title line, the HUD and a "Who claims the most?" caption. The values live in SimulatorSettings; Simulator.tsx forwards
 * them to the engine (lib/physics/modes/landClaim.ts) and restarts the battle when a rule of the fight changes (the title and
 * the HUD follow live). A team roster (Teams & Scoreboard – its Country picker fills an entry with a country) names and
 * colours the first competitors and gives them their flags.
 */
export default function LandClaimSection({ t, search, matches, settings: s, update }: LandClaimSectionProps) {
  const countries = useTranslations("Countries");
  const titleId = useId();
  const applyPreset = (id: LcPresetId) => {
    const { teams, ...rest } = landClaimPresetPatch(id, (code, english) => (countries.has(code) ? countries(code) : english));
    update({ ...rest, ...rosterPatch(teams) });
  };
  const fromRoster = Math.min(s.teams.length, s.lcTeams, MAX_TEAMS);
  const blocks = s.lcCols * s.lcRows;
  const hasCaption = s.captions.some((c) => c.type === "question" && c.answer.toLowerCase().includes(CAPTION_WINNER_TOKEN));
  return (
    <div className="space-y-3 pt-2" data-testid="land-claim-section">
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("lcDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="lcPreset">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("lcPreset")}
            <Tooltip text={t("lcPresetTip")} />
          </label>
          <select
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (isLcPresetId(id)) applyPreset(id);
            }}
            aria-label={t("lcPreset")}
            className={`${selectClass} text-sm py-1.5`}
            data-testid="lc-preset"
          >
            <option value="">{t("lcPresetChoose")}</option>
            {LC_PRESET_IDS.map((id) => (
              <option key={id} value={id}>
                {t(PRESET_LABELS[id])}
              </option>
            ))}
          </select>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="lcRule">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("lcRule")}
            <Tooltip text={t("lcRuleTip")} />
          </label>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("lcRule")} data-testid="lc-rule">
            {LC_RULES.map((rule) => (
              <button type="button" key={rule} onClick={() => update({ lcRule: rule })} aria-pressed={s.lcRule === rule} className={pick(s.lcRule === rule)} data-rule={rule}>
                <span aria-hidden="true">{RULE_OPTIONS[rule].icon}</span> {t(RULE_OPTIONS[rule].labelKey)}
              </button>
            ))}
          </div>
          {!search && <p className="text-xs text-ink-3 leading-relaxed">{t(RULE_OPTIONS[s.lcRule].hintKey)}</p>}
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="lcArena">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("lcArena")}
            <Tooltip text={t("lcArenaTip")} />
          </label>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("lcArena")} data-testid="lc-arena">
            {LC_ARENAS.map((arena) => (
              <button type="button" key={arena} onClick={() => update({ lcArena: arena })} aria-pressed={s.lcArena === arena} className={pick(s.lcArena === arena)} data-arena={arena}>
                <span aria-hidden="true">{ARENA_OPTIONS[arena].icon}</span> {t(ARENA_OPTIONS[arena].labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="lcTeams" tipKey="lcTeamsTip" value={s.lcTeams} range={RANGES.lcTeams} onChange={(v) => update({ lcTeams: v })} display={String(s.lcTeams)} />
      {!search && (
        <p className="text-xs text-ink-3 leading-relaxed" data-testid="lc-teams-note">
          {fromRoster > 0 ? t("lcRosterNote", { count: fromRoster, teams: s.lcTeams }) : t("lcPaletteNote", { names: LC_PALETTE.slice(0, Math.min(4, Math.max(2, s.lcTeams))).map((p) => p.name).join(" · ") })}
        </p>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="lcBalls" tipKey="lcBallsTip" value={s.lcBalls} range={RANGES.lcBalls} onChange={(v) => update({ lcBalls: v })} display={t("lcBallsEach", { count: s.lcBalls })} />
      <Slider t={t} search={search} matches={matches} labelKey="lcCols" tipKey="lcColsTip" value={s.lcCols} range={RANGES.lcCols} onChange={(v) => update({ lcCols: v })} display={String(s.lcCols)} />
      <Slider t={t} search={search} matches={matches} labelKey="lcRows" tipKey="lcRowsTip" value={s.lcRows} range={RANGES.lcRows} onChange={(v) => update({ lcRows: v })} display={t("lcBlocksTotal", { count: blocks })} />
      {!search && blocks > LC_BLOCK_CEILING && (
        <p className="text-xs text-warn" data-testid="lc-block-ceiling">
          {t("lcBlockCeiling", { max: LC_BLOCK_CEILING.toLocaleString(), rows: Math.max(1, Math.floor(LC_BLOCK_CEILING / Math.max(1, s.lcCols))) })}
        </p>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="lcEvery" tipKey="lcEveryTip" value={s.lcEvery} range={RANGES.lcEvery} onChange={(v) => update({ lcEvery: v })} display={s.lcEvery > 0 ? t("lcEveryN", { n: s.lcEvery }) : t("lcEveryOff")} />
      <Slider
        t={t}
        search={search}
        matches={matches}
        labelKey="lcDuration"
        tipKey="lcDurationTip"
        value={s.lcDuration}
        range={RANGES.lcDuration}
        // The clip follows the duration, so a recording covers the verdict and its banner.
        onChange={(v) => update({ lcDuration: v, recordingDuration: landClaimClipSec(v) })}
        display={`${s.lcDuration}s`}
      />
      <Searchable search={search} matches={matches} labelKey="lcTitle">
        <div className="space-y-2">
          <label htmlFor={titleId} className="text-sm font-medium text-ink-2">
            {t("lcTitle")}
            <Tooltip text={t("lcTitleTip")} />
          </label>
          <input
            id={titleId}
            type="text"
            value={s.lcTitle}
            maxLength={2 * LC_TITLE_LENGTH}
            placeholder={t("lcTitlePlaceholder")}
            onChange={(e) => update({ lcTitle: sanitizeLcTitle(e.target.value) })}
            className="w-full px-3 py-2 bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim placeholder:text-ink-3 text-sm"
            data-testid="lc-title"
          />
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="lcHud">
        <Toggle t={t} labelKey="lcHud" tipKey="lcHudTip" value={s.lcHud} onChange={(v) => update({ lcHud: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="lcCaption">
        <div className="space-y-1.5">
          <button
            type="button"
            disabled={hasCaption || s.captions.length >= MAX_CAPTIONS}
            onClick={() => update({ captions: [...s.captions, defaultCaption("question", { text: t("lcCaptionQuestion"), answer: CAPTION_WINNER_TOKEN })] })}
            className="w-full px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-surface-2 text-accent border border-dashed border-accent/40 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="lc-caption"
          >
            ＋ {t("lcCaption")}
          </button>
          {!search && <p className="text-xs text-ink-3 leading-relaxed">{hasCaption ? t("lcCaptionAdded") : t("lcCaptionNote")}</p>}
        </div>
      </Searchable>
      {!search && <p className="text-xs text-ink-3 leading-relaxed" data-testid="lc-rig-note">{t("lcRigNote")}</p>}
    </div>
  );
}
