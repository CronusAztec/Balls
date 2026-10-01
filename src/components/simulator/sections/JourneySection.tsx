"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Searchable, Slider, offBtn, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import Tooltip from "../Tooltip";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import {
  JOURNEY_SIZES,
  JOURNEY_TRAVEL_KINDS,
  MAX_JOURNEY_TEXT,
  JOURNEY_TEXT_CEILING, // --- uncap-all ---
  addJourneyStage,
  moveJourneyStage,
  parseJourneyStages,
  removeJourneyStage,
  resizeJourneyStage,
  sanitizeJourneyStages,
  type JourneyStageKind,
} from "@/lib/physics/journey/sequence";
import { STAGE_COLORS } from "@/lib/physics/journey/stage";
import { JOURNEY_STAGE_CEILING } from "@/lib/uncap"; // --- uncap-all ---

export interface JourneySectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const JOURNEY_KEYS = ["journeyStages", "journeyStagesCode", "journeyAutoStages"];

const SIZE_KEYS = { s: "journeySizeSmall", m: "journeySizeMedium", l: "journeySizeLarge" } as const;
const iconBtn = "w-7 h-7 rounded-md text-xs font-bold transition-colors cursor-pointer bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed";

/**
 * "Journey" controls (feature gerald-journey), shown in the Mode row while the Journey is the mode (and in the Ball
 * section while the settings search is in use): the stage list top-down – each stage with its size (small, medium,
 * large), arrows to move it up or down and a button to remove it, HOME fixed at the bottom – an "add stage" picker, the
 * compact stage code (`rings,pegs-l,glass-s,home`, the URL's `js`) to paste or copy, and the Random Stages slider that
 * replaces the list with a seeded random journey of that many stages. The values live in SimulatorSettings;
 * Simulator.tsx forwards them to the engine (lib/physics/modes/journey.ts) and restarts the run when they change.
 */
export default function JourneySection({ t, search, matches, settings: s, update }: JourneySectionProps) {
  const names = useTranslations("Journey");
  const stages = parseJourneyStages(s.journeyStages);
  const auto = s.journeyAutoStages > 0;
  const [addKind, setAddKind] = useState<JourneyStageKind>("rings");
  // The code field edits a draft of the list; it follows the setting whenever the list changes elsewhere.
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null);
  const code = draft && draft.base === s.journeyStages ? draft.text : s.journeyStages;
  const setStages = (text: string) => update({ journeyStages: sanitizeJourneyStages(text) });
  const commitCode = () => {
    const clean = sanitizeJourneyStages(code.slice(0, Math.max(MAX_JOURNEY_TEXT, JOURNEY_TEXT_CEILING))); // --- uncap-all ---
    setDraft(null);
    if (clean !== s.journeyStages) update({ journeyStages: clean });
  };
  const last = stages.length - 1;
  return (
    <div className="space-y-3 pt-2" data-testid="journey">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{t("journeyTitle")}</p>
          <p className="text-xs text-zinc-500 leading-relaxed">{t("journeyDesc")}</p>
        </div>
      )}
      <Slider
        t={t}
        search={search}
        matches={matches}
        labelKey="journeyAutoStages"
        tipKey="journeyAutoStagesTip"
        value={s.journeyAutoStages}
        range={RANGES.journeyAutoStages}
        onChange={(v) => update({ journeyAutoStages: v })}
        display={auto ? String(s.journeyAutoStages) : t("journeyAutoOff")}
        left="📋"
        right="🎲"
      />
      {!auto && (
        <Searchable search={search} matches={matches} labelKey="journeyStages">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">
              {t("journeyStages")}
              <Tooltip text={t("journeyStagesTip")} />
            </label>
            <ol className="space-y-1.5" data-testid="journey-stages">
              {stages.map((stage, i) => {
                const home = i === last;
                return (
                  <li key={`${i}-${stage.kind}`} className="flex items-center gap-1.5 bg-zinc-800/50 rounded-lg px-2 py-1.5" data-stage={stage.kind} data-size={stage.size}>
                    <span className="text-[11px] tabular-nums text-zinc-500 w-4 text-right">{i + 1}</span>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STAGE_COLORS[stage.kind] }} aria-hidden="true" />
                    <span className="text-xs font-semibold text-zinc-200 flex-1 truncate">{names(`stage_${stage.kind}`)}</span>
                    <span className="flex gap-0.5" role="group" aria-label={t("journeySize")}>
                      {JOURNEY_SIZES.map((size) => (
                        <button
                          key={size}
                          type="button"
                          title={t(SIZE_KEYS[size])}
                          aria-label={`${names(`stage_${stage.kind}`)} ${i + 1}: ${t(SIZE_KEYS[size])}`}
                          aria-pressed={stage.size === size}
                          onClick={() => setStages(resizeJourneyStage(s.journeyStages, i, size))}
                          className={`w-6 h-6 rounded text-[10px] font-bold uppercase transition-colors cursor-pointer ${stage.size === size ? onBtn : offBtn}`}
                        >
                          {size}
                        </button>
                      ))}
                    </span>
                    {!home ? (
                      <>
                        <button type="button" className={iconBtn} disabled={i === 0} aria-label={`${t("journeyMoveUp")} ${i + 1}`} title={t("journeyMoveUp")} onClick={() => setStages(moveJourneyStage(s.journeyStages, i, -1))}>
                          ↑
                        </button>
                        <button type="button" className={iconBtn} disabled={i >= last - 1} aria-label={`${t("journeyMoveDown")} ${i + 1}`} title={t("journeyMoveDown")} onClick={() => setStages(moveJourneyStage(s.journeyStages, i, 1))}>
                          ↓
                        </button>
                        <button type="button" className={iconBtn} aria-label={`${t("journeyRemove")} ${i + 1}`} title={t("journeyRemove")} onClick={() => setStages(removeJourneyStage(s.journeyStages, i))}>
                          ✕
                        </button>
                      </>
                    ) : (
                      <span className="w-[5.6rem] text-[10px] text-zinc-500 text-center">{t("journeyHomeLast")}</span>
                    )}
                  </li>
                );
              })}
            </ol>
            <div className="flex gap-2">
              <select className={selectClass} value={addKind} onChange={(e) => setAddKind(e.target.value as JourneyStageKind)} aria-label={t("journeyAddKind")}>
                {JOURNEY_TRAVEL_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {names(`stage_${kind}`)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={last >= JOURNEY_STAGE_CEILING /* --- uncap-all --- */}
                onClick={() => setStages(addJourneyStage(s.journeyStages, addKind))}
                className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${onBtn}`}
              >
                + {t("journeyAdd")}
              </button>
            </div>
          </div>
        </Searchable>
      )}
      {!auto && (
        <Searchable search={search} matches={matches} labelKey="journeyStagesCode">
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-300" htmlFor="journey-code">
              {t("journeyStagesCode")}
              <Tooltip text={t("journeyStagesCodeTip")} />
            </label>
            <input
              id="journey-code"
              type="text"
              value={code}
              maxLength={Math.max(MAX_JOURNEY_TEXT, JOURNEY_TEXT_CEILING) /* --- uncap-all --- */}
              spellCheck={false}
              onChange={(e) => setDraft({ base: s.journeyStages, text: e.target.value })}
              onBlur={commitCode}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCode();
              }}
              aria-label={t("journeyStagesCode")}
              className="w-full px-3 py-2 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-cyan-600 focus:outline-none font-mono text-xs"
            />
          </div>
        </Searchable>
      )}
      {!search && (
        <p className="text-xs text-zinc-400 leading-relaxed" data-testid="journey-run">
          {auto ? t("journeyRunAuto", { count: s.journeyAutoStages }) : t("journeyRunInfo", { count: last })}
        </p>
      )}
    </div>
  );
}
