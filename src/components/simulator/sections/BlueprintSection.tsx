"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Searchable, Slider, type Matcher, type Translate } from "../ControlPrimitives";
import { settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { BLUEPRINT_CATALOG_IDS, PlayabilityRun, formatParamValues, paramUnit, paramValue, parseParamValues, sayPhrase, summarizeBlueprint, type Blueprint, type CheckProblem, type ParamUnit, type PlayabilityReport, type SummaryPhrase } from "@/lib/blueprint";
import { blueprintSettingsOf, resolveBlueprintSpec, type ResolvedBlueprint } from "@/lib/physics/modes/blueprint";

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
 * language: lib/blueprint/summary.ts), Check playability (the same check the agent toolbox runs) and Copy link. A Blueprint
 * from a link (`bls`) or a share code plays instead of the catalog entry until the visitor picks one. The values live in
 * SimulatorSettings; Simulator.tsx forwards them to the engine (lib/physics/modes/blueprint.ts) and restarts the run when one
 * changes.
 *
 * --- review fix (blueprint) --- The check runs in slices of CHECK_SLICE_MS (lib/blueprint/check.ts PlayabilityRun: a seed is
 * stepped until the slice's time is up, then the page yields), so a heavy link never blocks the tab; its progress (the run it
 * is on) is a live region, and a second press of its button (Stop), a new spec, a second game or leaving Mode Lab cancels
 * it. Its verdict is a live region in the visitor's language: the seconds formatted for the
 * locale, the first problem in plain words. A link whose game cannot be read (cut short) or that needs a newer site says
 * so (blueprintLinkNotice()), and no built-in game shows as picked. The sliders show their unit; Copy link says so when it
 * worked and offers the link to select by hand when the clipboard refuses.
 */

/** How long one slice of the check may run before the page yields (ms): well under a frame's budget at 60 fps. */
export const CHECK_SLICE_MS = 12;

/** What the panel says about a link's game: cut short, a newer site's link format, a game that needs a newer site, or nothing. */
export type BlueprintLinkNotice = "unreadable" | "newerFormat" | "newer" | null;

/**
 * --- review fix (blueprint) --- The panel's line about the game a link brought, and how many values were fixed on load. A
 * link that could not be read plays a built-in game: cut short ("unreadable") or of a later format that only a newer site
 * reads ("newerFormat"). A game that reads but needs a newer site (a newer spec format, a feature this site does not know)
 * plays without what it needs ("newer"). The link's own notes – the one that it could not be read, one for each newer need –
 * are said in words, never counted among the values fixed.
 */
export function blueprintLinkNotice(r: Pick<ResolvedBlueprint, "notes" | "newer" | "unreadable">): { notice: BlueprintLinkNotice; fixed: number } {
  const notice: BlueprintLinkNotice = r.unreadable ? (r.newer.length > 0 ? "newerFormat" : "unreadable") : r.newer.length > 0 ? "newer" : null;
  const said = r.unreadable ? 1 : r.newer.length;
  return { notice, fixed: Math.max(0, r.notes.length - said) };
}

/**
 * --- review fix (blueprint) --- Check playability's verdict in the visitor's words (Controls.blCheck*): playable – the median
 * finish in seconds as the locale writes them (Intl.NumberFormat: "20,3" in Polish and Spanish), on how many of the runs it
 * ended –, endless – the limit every run reached –, or not playable yet with its first problem in plain words
 * (Blueprint.problem.<code>: what goes wrong and what to change) and how many more there are. `t` says a Controls key,
 * `problem` a problem's sentence ("" when it has none).
 */
export function blueprintVerdictLine(r: PlayabilityReport, timeoutSec: number, locale: string, t: (key: string, values?: Record<string, string | number>) => string, problem: (code: CheckProblem) => string): string {
  if (r.verdict === "playable") {
    const seconds = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(r.medianFinishSec);
    return t("blCheckPlayable", { seconds, ended: r.finishedByCondition, runs: r.seeds.length });
  }
  if (r.verdict === "endless") return t("blCheckEndless", { seconds: Math.round(timeoutSec) });
  const first = r.problems[0];
  const line = t("blCheckBroken", { problem: first ? problem(first) : "" });
  return r.problems.length > 1 ? `${line} ${t("blCheckMore", { count: r.problems.length - 1 })}` : line;
}

/**
 * --- review fix (blueprint) --- A slider's value as the panel shows it: in the page's number format, with as many decimals
 * as its step has, and in its unit (paramUnit(): "6 s", "21°", "30°/s", "0,6 px", "300 px/s"); a count shows bare. `unitText`
 * says a unit's message (Blueprint.unit.<unit>) with the number filled in.
 */
export function blueprintParamDisplay(bp: Blueprint, i: number, value: number, locale: string, unitText: (unit: Exclude<ParamUnit, "">, n: string) => string): string {
  const step = bp.params[i]?.step ?? 1;
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const n = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  const unit = paramUnit(bp, i);
  return unit ? unitText(unit, n) : n;
}

/**
 * --- review fix (blueprint) --- Copy link's outcome: "copied" when the clipboard took the link, "failed" when there is no
 * clipboard (an insecure page, an old browser) or it refused (a blocked permission), so the panel offers the link to select
 * by hand instead of doing nothing.
 */
export async function copyGameLink(link: string, clipboard: Pick<Clipboard, "writeText"> | undefined | null): Promise<"copied" | "failed"> {
  try {
    if (!clipboard?.writeText) return "failed";
    await clipboard.writeText(link);
    return "copied";
  } catch {
    return "failed";
  }
}

export default function BlueprintSection({ t, search, matches, settings: s, update }: BlueprintSectionProps) {
  const b = useTranslations("Blueprints");
  const how = useTranslations("Blueprint.how");
  const problemT = useTranslations("Blueprint.problem");
  const unitT = useTranslations("Blueprint.unit");
  const locale = useLocale();
  const resolved = useMemo(() => resolveBlueprintSpec(blueprintSettingsOf(s)), [s.blPreset, s.blSpec, s.blParams]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromLink = resolved.catalogId === "";
  // (a link's game that could not be read plays the catalog's default: it is not the visitor's pick, and the notes about it
  // are said in words below, not counted as values fixed)
  const unreadable = resolved.unreadable;
  const link = blueprintLinkNotice(resolved);
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

  // --- the check: every seed in slices of CHECK_SLICE_MS, judged when the last one is in (a new spec or leaving cancels it)
  const [report, setReport] = useState<PlayabilityReport | null>(null);
  const [running, setRunning] = useState<{ n: number; total: number } | null>(null);
  const token = useRef(0);
  useEffect(() => {
    token.current++;
    setReport(null);
    setRunning(null);
  }, [resolved]);
  useEffect(
    () => () => {
      token.current++;
    },
    [],
  );
  // (a second press while it runs stops it: a heavy game's check can take a while, and the visitor may not want to wait)
  const stopCheck = () => {
    token.current++;
    setRunning(null);
  };
  const runCheck = () => {
    const mine = ++token.current;
    const run = new PlayabilityRun(resolved.blueprint);
    const total = run.seeds.length;
    let shown = 0;
    setReport(null);
    setRunning({ n: 1, total });
    const tick = () => {
      if (token.current !== mine) return;
      const done = run.slice(CHECK_SLICE_MS, () => performance.now());
      if (done) {
        setReport(done);
        setRunning(null);
        return;
      }
      if (run.seedsDone !== shown) {
        shown = run.seedsDone;
        setRunning({ n: Math.min(shown + 1, total), total });
      }
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  };

  // --- Copy link: "Copied" in a live status line; where the clipboard refuses, the link to select by hand
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [copiedLink, setCopiedLink] = useState("");
  const copyLink = async () => {
    const params = settingsToSearchParams(s);
    const link = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    setCopiedLink(link);
    const outcome = await copyGameLink(link, typeof navigator === "undefined" ? undefined : navigator.clipboard);
    setCopy(outcome);
    if (outcome === "copied") setTimeout(() => setCopy((c) => (c === "copied" ? "idle" : c)), 1500);
  };

  const setParam = (i: number, v: number) => {
    const next = base.params.map((_, k) => (k === i ? v : (values[k] ?? null)));
    update({ blParams: formatParamValues(next) });
  };

  // the verdict: the first problem in plain words, then how many more
  const verdictLine = (r: PlayabilityReport) => blueprintVerdictLine(r, resolved.blueprint.finish.timeoutSec, locale, t, (code) => (problemT.has(code) ? problemT(code) : ""));

  const selected = fromLink || unreadable ? "" : resolved.catalogId;
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
          {link.notice === "unreadable" && (
            <p className="text-xs text-warn" data-testid="blueprint-link-unreadable">
              {t("blLinkUnreadable")}
            </p>
          )}
          {(link.notice === "newer" || link.notice === "newerFormat") && (
            <p className="text-xs text-warn" data-testid="blueprint-link-newer" data-newer={link.notice}>
              {link.notice === "newer" ? t("blLinkNewer") : t("blLinkNewerFormat")}
            </p>
          )}
          {link.fixed > 0 && (
            <p className="text-xs text-warn" data-testid="blueprint-repaired">
              {t("blRepaired", { count: link.fixed })}
            </p>
          )}
        </div>
      )}
      {/* the spec's own sliders (named by the spec, so the settings search leaves them out) */}
      {!search &&
        base.params.map((p, i) => {
          const label = (!fromLink && catalogKey(resolved.catalogId, `params.${p.id}`)) || p.label;
          const value = values[i] ?? paramValue(base, i);
          // a slider named by the spec: its label is the spec's (or the catalog's message), not a message key
          const paramT = Object.assign((key: string) => (key === `blParam${i}` ? label : t(key)), t) as Translate;
          // the value in the page's number format, with its unit (s, °, °/s, px, px/s, px/s²)
          const display = blueprintParamDisplay(base, i, value, locale, (unit, n) => unitT(unit, { n }));
          return <Slider key={`${resolved.catalogId}-${p.id}`} t={paramT} search={search} matches={matches} labelKey={`blParam${i}`} value={value} range={{ min: p.min, max: p.max, step: p.step }} onChange={(v) => setParam(i, v)} display={display} />;
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
          <button type="button" onClick={running ? stopCheck : runCheck} className="px-2 py-1 rounded-md bg-surface-2 text-ink-2 hover:bg-surface-3 cursor-pointer" data-testid="blueprint-check" data-running={running ? "1" : "0"}>
            {running ? t("blCheckStop") : t("blCheck")}
          </button>
          <button type="button" onClick={() => void copyLink()} className="px-2 py-1 rounded-md bg-surface-2 text-ink-2 hover:bg-surface-3 cursor-pointer" data-testid="blueprint-copy">
            {copy === "copied" ? t("blCopied") : t("blCopyLink")}
          </button>
          <span role="status" aria-live="polite" className="text-ink-3" data-testid="blueprint-check-progress">
            {running ? t("blCheckingRun", { n: running.n, total: running.total }) : ""}
          </span>
          <span role="status" aria-live="polite" className="sr-only" data-testid="blueprint-copy-status">
            {copy === "copied" ? t("blCopied") : copy === "failed" ? t("blCopyFailed") : ""}
          </span>
        </div>
      )}
      {!search && copy === "failed" && (
        <div className="space-y-1" data-testid="blueprint-copy-failed">
          <p className="text-xs text-warn">{t("blCopyFailed")}</p>
          <input type="text" readOnly value={copiedLink} aria-label={t("blLinkField")} onFocus={(e) => e.currentTarget.select()} className="w-full px-2 py-1 rounded-md bg-surface-2 text-xs text-ink-2 font-mono" data-testid="blueprint-link-field" />
        </div>
      )}
      {!search && (
        <div role="status" aria-live="polite" data-testid="blueprint-verdict-status">
          {report && (
            <p className={`text-xs leading-relaxed ${report.verdict === "playable" ? "text-ink-2" : "text-warn"}`} data-testid="blueprint-verdict" data-verdict={report.verdict}>
              {verdictLine(report)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
