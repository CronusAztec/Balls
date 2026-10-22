"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Searchable, Slider, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { BLUEPRINT_CATALOG_IDS, checkSeed, DEFAULT_CHECK_SEEDS, formatParamValues, judgeSeeds, paramValue, parseParamValues, type PlayabilityReport, type SeedReport } from "@/lib/blueprint";
import { blueprintSettingsOf, resolveBlueprintSpec } from "@/lib/physics/modes/blueprint";

export interface BlueprintSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const BLUEPRINT_KEYS = ["blPreset"];

/**
 * "Mode Lab" controls (feature blueprint), shown in the Mode row while Mode Lab is the mode (and in the Ball section while
 * the settings search is in use): the catalog of built-in Blueprints, the sliders the playing Blueprint declares (its
 * `params`), what it is, Check playability (the same check the agent toolbox runs, one seed a frame so the page stays
 * responsive) and Copy link. A Blueprint from a link (`bls`) or a share code plays instead of the catalog entry until the
 * visitor picks one. The values live in SimulatorSettings; Simulator.tsx forwards them to the engine (lib/physics/modes/
 * blueprint.ts) and restarts the run when one changes.
 */
export default function BlueprintSection({ t, search, matches, settings: s, update }: BlueprintSectionProps) {
  const b = useTranslations("Blueprints");
  const resolved = useMemo(() => resolveBlueprintSpec(blueprintSettingsOf(s)), [s.blPreset, s.blSpec, s.blParams]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromLink = resolved.catalogId === "";
  const base = resolved.base;
  const values = parseParamValues(s.blParams);
  const catalogKey = (id: string, key: string) => (b.has(`${id}.${key}`) ? b(`${id}.${key}`) : null);
  const name = (!fromLink && catalogKey(resolved.catalogId, "name")) || base.meta.name;
  const description = (!fromLink && catalogKey(resolved.catalogId, "description")) || base.meta.description;

  // the check: one seed a frame, judged when the last one is in
  const [report, setReport] = useState<PlayabilityReport | null>(null);
  const [running, setRunning] = useState(false);
  const token = useRef(0);
  useEffect(() => {
    token.current++;
    setReport(null);
    setRunning(false);
  }, [resolved]);
  const runCheck = () => {
    const mine = ++token.current;
    const bp = resolved.blueprint;
    const seeds: SeedReport[] = [];
    setRunning(true);
    setReport(null);
    const next = (i: number) => {
      if (token.current !== mine) return;
      if (i >= DEFAULT_CHECK_SEEDS.length) {
        setReport(judgeSeeds(bp, seeds));
        setRunning(false);
        return;
      }
      seeds.push(checkSeed(bp, DEFAULT_CHECK_SEEDS[i]));
      setTimeout(() => next(i + 1), 0);
    };
    setTimeout(() => next(0), 0);
  };

  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      const params = settingsToSearchParams(s);
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?${params.toString()}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const setParam = (i: number, v: number) => {
    const next = base.params.map((_, k) => (k === i ? v : (values[k] ?? null)));
    update({ blParams: formatParamValues(next) });
  };

  const verdictLine = (r: PlayabilityReport) => {
    if (r.verdict === "playable") return t("blCheckPlayable", { seconds: r.medianFinishSec.toFixed(1), ended: r.finishedByCondition, seeds: r.seeds.length });
    if (r.verdict === "endless") return t("blCheckEndless", { seconds: Math.round(resolved.blueprint.finish.timeoutSec) });
    return t("blCheckBroken", { problems: r.feedback.length });
  };

  return (
    <div className="space-y-3 pt-2" data-testid="blueprint" data-blueprint-catalog={resolved.catalogId} data-blueprint-link={fromLink ? "1" : "0"}>
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("blTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("blDesc")}</p>
        </div>
      )}
      <Searchable search={search} matches={matches} labelKey="blPreset">
        <label className="flex items-center justify-between gap-3 text-sm font-medium text-ink-2">
          <span>{t("blPreset")}</span>
          <select
            value={fromLink ? "" : resolved.catalogId}
            onChange={(e) => update({ blPreset: e.target.value, blSpec: "", blParams: "" })}
            className={`${selectClass} !w-44 !py-1 text-sm`}
            aria-label={t("blPreset")}
            data-testid="blueprint-catalog"
          >
            {fromLink && <option value="">{t("blFromLink")}</option>}
            {BLUEPRINT_CATALOG_IDS.map((id) => (
              <option key={id} value={id}>
                {catalogKey(id, "name") ?? id}
              </option>
            ))}
          </select>
        </label>
      </Searchable>
      {!search && (
        <div className="space-y-1 rounded-lg bg-surface-2/50 border border-line-strong/40 px-2.5 py-2" data-testid="blueprint-about">
          <p className="text-sm font-semibold text-ink">{name}</p>
          {description && <p className="text-xs text-ink-2 leading-relaxed">{description}</p>}
          {fromLink && <p className="text-xs text-ink-3">{t("blLinkNote")}</p>}
          {resolved.notes.length > 0 && <p className="text-xs text-warn">{t("blRepaired", { count: resolved.notes.length })}</p>}
        </div>
      )}
      {/* the spec's own sliders (named by the spec, so the settings search leaves them out) */}
      {!search &&
        base.params.map((p, i) => {
        const label = (!fromLink && catalogKey(resolved.catalogId, `params.${p.id}`)) || p.label;
        const value = values[i] ?? paramValue(base, i);
        // a slider named by the spec: its label is the spec's (or the catalog's message), not a message key
        const paramT = Object.assign((key: string) => (key === `blParam${i}` ? label : t(key)), t) as Translate;
        const decimals = p.step >= 1 ? 0 : p.step >= 0.1 ? 1 : 2;
        return <Slider key={`${resolved.catalogId}-${p.id}`} t={paramT} search={search} matches={matches} labelKey={`blParam${i}`} value={value} range={{ min: p.min, max: p.max, step: p.step }} onChange={(v) => setParam(i, v)} display={value.toFixed(decimals)} />;
        })}
      {!search && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={runCheck} disabled={running} className="px-2 py-1 rounded-md bg-surface-2 text-ink-2 hover:bg-surface-3 disabled:opacity-40 cursor-pointer" data-testid="blueprint-check">
            {running ? t("blChecking") : t("blCheck")}
          </button>
          <button type="button" onClick={() => void copyLink()} className="px-2 py-1 rounded-md bg-surface-2 text-ink-2 hover:bg-surface-3 cursor-pointer" data-testid="blueprint-copy">
            {copied ? t("blCopied") : t("blCopyLink")}
          </button>
        </div>
      )}
      {!search && report && (
        <p className={`text-xs leading-relaxed ${report.verdict === "playable" ? "text-ink-2" : "text-warn"}`} data-testid="blueprint-verdict" data-verdict={report.verdict}>
          {verdictLine(report)}
        </p>
      )}
    </div>
  );
}
