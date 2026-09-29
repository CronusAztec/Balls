"use client";

import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Toggle, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { teamChoiceNames } from "../FinderOutcomeFields";
import { WINNER_MODES, forcedWinnerApplies, forcedWinnerBlockedByNeverEscape, neverEscapeApplies } from "@/lib/physics/rigged";
import type { SimulatorSettings } from "@/lib/settings";
import { effectiveBallCount } from "@/lib/teams";

export interface RiggedSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.visual in Controls.tsx). */
export const RIGGED_KEYS = ["riggedGroup", "neverEscape", "forcedWinner"];

/**
 * --- rigged --- The "Rigged outcomes" group of the Visual section (with the advanced options, under the Drama
 * Director): Never Escape and the Forced Winner – the director's hard constraints (lib/physics/rigged.ts) – with a
 * warning that they are for storytelling. The values live in SimulatorSettings (URL `ne`, `fw`) and reach the engine
 * in the physics config, so the seed finder searches with them and a found seed replays exactly.
 */
export default function RiggedSection({ t, search, matches, settings: s, update }: RiggedSectionProps) {
  const root = useTranslations();
  const count = effectiveBallCount(s);
  const names = teamChoiceNames(s, (kind, n) => root(kind === "team" ? "Rigged.teamN" : "Rigged.ballN", { n }));
  const winnerPlays = WINNER_MODES.includes(s.mode) && count >= 2;
  const winner = s.forcedWinner >= 0 && s.forcedWinner < count ? s.forcedWinner : -1;
  const body = (
    <>
      {!search && (
        <div className="space-y-1">
          <label className="text-sm font-medium text-zinc-300">
            🎭 {t("riggedGroup")}
            <Tooltip text={t("riggedGroupTip")} />
          </label>
          <p className="text-xs text-amber-500/90 leading-relaxed" data-testid="rigged-warning">
            ⚠️ {t("riggedWarning")}
          </p>
        </div>
      )}
      <Searchable search={search} matches={matches} labelKey="neverEscape">
        <div className="space-y-1">
          <Toggle t={t} labelKey="neverEscape" tipKey="neverEscapeTip" value={s.neverEscape} onChange={(v) => update({ neverEscape: v })} caseStyle="title" />
          {s.neverEscape && !neverEscapeApplies(s.mode) && <p className="text-xs text-amber-500/90">{t("neverEscapeModes")}</p>}
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="forcedWinner">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300" htmlFor="forced-winner-select">
            {t("forcedWinner")}
            <Tooltip text={t("forcedWinnerTip")} />
          </label>
          <select
            id="forced-winner-select"
            value={winner}
            disabled={!winnerPlays && winner < 0}
            onChange={(e) => update({ forcedWinner: Number(e.target.value) })}
            className={`${selectClass} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <option value={-1}>{t("forcedWinnerOff")}</option>
            {names.map((name, i) => (
              <option key={i} value={i}>
                {name}
              </option>
            ))}
          </select>
          {(!winnerPlays || (winner >= 0 && !forcedWinnerApplies(s.mode, count, winner))) && <p className="text-xs text-zinc-500 leading-relaxed">{t("forcedWinnerModes")}</p>}
          {winnerPlays && winner >= 0 && forcedWinnerBlockedByNeverEscape(s.mode, s.neverEscape) && (
            <p className="text-xs text-amber-500/90 leading-relaxed" data-testid="forced-winner-never-escape">
              {t("forcedWinnerNeverEscape")}
            </p>
          )}
        </div>
      </Searchable>
    </>
  );
  // While searching, the matching controls stand on their own like every other control of the section.
  return search ? (
    body
  ) : (
    <div className="space-y-4 pt-3 border-t border-zinc-800" data-testid="rigged-section">
      {body}
    </div>
  );
}
