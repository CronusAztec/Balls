"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Searchable, Slider, type Matcher, type Translate } from "../ControlPrimitives";
import { settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { BLUEPRINT_CATALOG_IDS, checkSeed, DEFAULT_CHECK_SEEDS, formatParamValues, judgeSeeds, paramValue, parseParamValues, sayPhrase, summarizeBlueprint, type PlayabilityReport, type SeedReport, type SummaryPhrase } from "@/lib/blueprint";
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
 * the settings search is in use): the catalog of built-in Blueprints – each game with its one-line pitch –, the sliders the
 * playing Blueprint declares (its `params`), what it is, "How it plays" (its arena, start, rules and ending in the page's
 * language: lib/blueprint/summary.ts), Check playability (the same check the agent toolbox runs, one seed a frame so the
 * page stays responsive) and Copy link. A Blueprint from a link (`bls`) or a share code plays instead of the catalog entry
 * until the visitor picks one. The values live in SimulatorSettings; Simulator.tsx forwards them to the engine (lib/physics/
 * modes/blueprint.ts) and restarts the run when one changes.
 */
export default function BlueprintSection({ t, search, matches, settings: s, update }: BlueprintSectionProps) {
  const b = useTranslations("Blueprints");
  const how = useTranslations("Blueprint.how");
  const locale = useLocale();
  const resolved = useMemo(() => resolveBlueprintSpec(blueprintSettingsOf(s)), [s.blPreset, s.blSpec, s.blParams]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromLink = resolved.catalogId === "";
  const base = resolved.base;
  const values = parseParamValues(s.blParams);
  const catalogKey = (id: string, key: string) => (b.has(`${id}.${key}`) ? b(`${id}.${key}`) : null);
  const name = (!fromLink && catalogKey(resolved.catalogId, "name")) || base.meta.name;
  const description = (!fromLink && catalogKey(resolved.catalogId, "description")) || base.meta.description;

  // --- How it plays: the summary of the spec being played (the sliders applied), in the page's language; a catalog game's
  // variables are called by its HUD's own words
  const summary = useMemo(() => {
    const bp = resolved.blueprint;
    const id = resolved.catalogId;
    const varName = (v: string) => {
      const i = bp.hud.findIndex((h) => h.show === v);
      return (id && i >= 0 && b.has(`${id}.hud${i}`) ? b(`${id}.hud${i}`) : null) ?? (i >= 0 && bp.hud[i].label ? bp.hud[i].label : v);
    };
    const nf = new Intl.NumberFormat(locale);
    const say = (ph: SummaryPhrase) => sayPhrase(ph, (key, v) => how(key, v), (n) => nf.format(n));
    return summarizeBlueprint(bp, { varName }).map((line) => ({ head: say(line.head), body: line.parts.map(say).join(", ") }));
  }, [resolved, b, how, locale]);

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

  const selected = fromLink ? "" : resolved.catalogId;
  const gamesLabel = useId();
  const gameButton = "w-full text-left px-2.5 py-1.5 rounded-lg transition-all cursor-pointer bg-surface-2/60 hover:bg-surface-3/70";

  return (
    <div className="space-y-3 pt-2" data-testid="blueprint" data-blueprint-catalog={resolved.catalogId} data-blueprint-link={fromLink ? "1" : "0"}>
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("blTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("blDesc")}</p>
        </div>
      )}
      {/* --- the catalog: every game with its one-line pitch (a game of a link sits on top while it plays) */}
      <Searchable search={search} matches={matches} labelKey="blPreset">
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-ink-2" id={gamesLabel}>
            {t("blPreset")}
          </p>
          <div role="group" aria-labelledby={gamesLabel} className="grid gap-1" data-testid="blueprint-catalog" data-value={selected}>
            {fromLink && (
              <div className={`${gameButton} ring-2 ring-accent cursor-default`} aria-current="true" data-testid="blueprint-game-link">
                <span className="block text-sm font-semibold text-accent leading-tight">{base.meta.name || t("blFromLink")}</span>
                <span className="block text-xs text-ink-3 leading-snug">{t("blFromLink")}</span>
              </div>
            )}
            {BLUEPRINT_CATALOG_IDS.map((id) => {
              const on = id === selected;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => !on && update({ blPreset: id, blSpec: "", blParams: "" })}
                  className={`${gameButton} ${on ? "ring-2 ring-accent" : "ring-1 ring-transparent"}`}
                  data-testid={`blueprint-game-${id}`}
                >
                  <span className={`block text-sm leading-tight ${on ? "font-semibold text-accent" : "font-medium text-ink"}`}>{catalogKey(id, "name") ?? id}</span>
                  <span className="block text-xs text-ink-3 leading-snug">{catalogKey(id, "line") ?? ""}</span>
                </button>
              );
            })}
          </div>
        </div>
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
      {/* --- How it plays: the arena, the start, every rule and the ending, in plain words */}
      {!search && (
        <div className="space-y-1" data-testid="blueprint-how">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("blHow")}</p>
          <ul className="space-y-1">
            {summary.map((line, i) => (
              <li key={i} className="text-xs text-ink-2 leading-relaxed">
                <span className="font-semibold text-ink">{line.head}:</span> {line.body}
              </li>
            ))}
          </ul>
        </div>
      )}
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
