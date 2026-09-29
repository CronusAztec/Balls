"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { SB_PALETTE, SB_RULES, SB_STYLES, type SbRule, type SbStyle } from "@/lib/physics/modes/stringBattle";

export interface StringBattleSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const STRING_BATTLE_KEYS = ["sbRule", "sbStyle", "sbBalls", "sbLives", "sbMaxStrings", "sbDuration", "sbFinaleSpeed", "sbWobble", "sbBadge", "sbHud"];

const RULE_OPTIONS: Record<SbRule, { icon: string; labelKey: string; hintKey: string }> = {
  cut: { icon: "✂️", labelKey: "sbRuleCut", hintKey: "sbHintCut" },
  touch: { icon: "⚡", labelKey: "sbRuleTouch", hintKey: "sbHintTouch" },
  collide: { icon: "💥", labelKey: "sbRuleCollide", hintKey: "sbHintCollide" },
};

const STYLE_OPTIONS: Record<SbStyle, { icon: string; labelKey: string; hintKey: string }> = {
  web: { icon: "🕸️", labelKey: "sbStyleWeb", hintKey: "sbHintWeb" },
  neon: { icon: "🌈", labelKey: "sbStyleNeon", hintKey: "sbHintNeon" },
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`;

/**
 * "String Battle" controls (feature odd-string-battle), shown in the Mode row while the mode is active (and in the Ball
 * section while the settings search is in use): the combat rule (cut / touch / collide), the style (web / neon), the
 * balls, their lives and threads, the clip limit, the finale's top speed, the neon ring's wobble, the warning badge and
 * the HUD. The values live in SimulatorSettings; Simulator.tsx forwards them to the engine (see
 * lib/physics/modes/stringBattle.ts) and restarts the battle when a rule of the fight changes (the style, wobble, badge
 * and HUD follow live). A team roster (Teams & Scoreboard) gives the first balls its colours and names.
 */
export default function StringBattleSection({ t, search, matches, settings: s, update }: StringBattleSectionProps) {
  const all = !!search;
  const rosterBalls = Math.min(s.teams.length, s.sbBalls);
  return (
    <div className="space-y-3 pt-2" data-testid="string-battle-section">
      {!search && <p className="text-xs text-zinc-500 leading-relaxed">{t("sbDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="sbRule">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">
            {t("sbRule")}
            <Tooltip text={t("sbRuleTip")} />
          </label>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("sbRule")}>
            {SB_RULES.map((id) => (
              <button type="button" key={id} onClick={() => update({ sbRule: id })} aria-pressed={s.sbRule === id} className={pick(s.sbRule === id)}>
                <span aria-hidden="true">{RULE_OPTIONS[id].icon}</span> {t(RULE_OPTIONS[id].labelKey)}
              </button>
            ))}
          </div>
          {!search && (
            <p className="text-[11px] text-zinc-500 leading-relaxed" data-testid="string-battle-rule-hint">
              {t(RULE_OPTIONS[s.sbRule].hintKey)}
            </p>
          )}
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="sbStyle">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">
            {t("sbStyle")}
            <Tooltip text={t("sbStyleTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("sbStyle")}>
            {SB_STYLES.map((id) => (
              <button type="button" key={id} onClick={() => update({ sbStyle: id })} aria-pressed={s.sbStyle === id} className={pick(s.sbStyle === id)}>
                <span aria-hidden="true">{STYLE_OPTIONS[id].icon}</span> {t(STYLE_OPTIONS[id].labelKey)}
              </button>
            ))}
          </div>
          {!search && <p className="text-[11px] text-zinc-500 leading-relaxed">{t(STYLE_OPTIONS[s.sbStyle].hintKey)}</p>}
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="sbBalls" tipKey="sbBallsTip" value={s.sbBalls} range={RANGES.sbBalls} onChange={(v) => update({ sbBalls: v })} display={String(s.sbBalls)} left="⚔️" right="🏟️" />
      {!search && (
        <p className="text-[11px] text-zinc-500 leading-relaxed" data-testid="string-battle-palette">
          {rosterBalls > 0 ? t("sbRosterNote", { count: rosterBalls, balls: s.sbBalls }) : t("sbPaletteNote", { names: SB_PALETTE.slice(0, s.sbBalls).map((p) => p.name).join(" · ") })}
        </p>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="sbLives" tipKey="sbLivesTip" value={s.sbLives} range={RANGES.sbLives} onChange={(v) => update({ sbLives: v })} display={String(s.sbLives)} left="💔" right="❤️" />
      <Slider t={t} search={search} matches={matches} labelKey="sbMaxStrings" tipKey="sbMaxStringsTip" value={s.sbMaxStrings} range={RANGES.sbMaxStrings} onChange={(v) => update({ sbMaxStrings: v })} display={String(s.sbMaxStrings)} left="╱" right="🕸️" />
      <Slider t={t} search={search} matches={matches} labelKey="sbDuration" tipKey="sbDurationTip" value={s.sbDuration} range={RANGES.sbDuration} onChange={(v) => update({ sbDuration: v })} display={s.sbDuration === 0 ? t("sbDurationOff") : `${s.sbDuration}s`} left="∞" right="⏱️" />
      <Slider t={t} search={search} matches={matches} labelKey="sbFinaleSpeed" tipKey="sbFinaleSpeedTip" value={s.sbFinaleSpeed} range={RANGES.sbFinaleSpeed} onChange={(v) => update({ sbFinaleSpeed: v })} display={`${s.sbFinaleSpeed.toFixed(1)}×`} left="🐢" right="🔥" />
      {(s.sbStyle === "neon" || all) && (
        <Slider t={t} search={search} matches={matches} labelKey="sbWobble" tipKey="sbWobbleTip" value={s.sbWobble} range={RANGES.sbWobble} onChange={(v) => update({ sbWobble: v })} display={s.sbWobble === 0 ? t("sbWobbleOff") : `${Math.round(100 * s.sbWobble)}%`} left="◯" right="〰️" />
      )}
      <Searchable search={search} matches={matches} labelKey="sbBadge">
        <Toggle t={t} labelKey="sbBadge" tipKey="sbBadgeTip" value={s.sbBadge} onChange={(v) => update({ sbBadge: v })} />
      </Searchable>
      {(s.sbStyle === "web" || all) && (
        <Searchable search={search} matches={matches} labelKey="sbHud">
          <Toggle t={t} labelKey="sbHud" tipKey="sbHudTip" value={s.sbHud} onChange={(v) => update({ sbHud: v })} />
        </Searchable>
      )}
    </div>
  );
}
