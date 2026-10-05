"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { AiCheck, AiDiagnosis, AiStatus, DesktopApi, DesktopPrefs } from "@/lib/desktop/contract";
import { Card, Chip, ghostBtn, primaryBtn } from "./ui";
import { aiErrorText } from "./useDesktopAi";

/*
 * --- desktop-ai-fix --- The AI status panel at the top of the AI tab (the owner: "the exe ai doesnt work" – and 1.0.2 had no
 * way to say why). One row per part the AI needs – Runtime, Model, Cloud provider, Network, Last error – green / amber /
 * red with the reason and its technical details, from the app's `ai:diagnose` (desktop/src/ai/diagnostics.ts): a quick
 * look when the tab opens (what the app knows already), the full checks on "Run checks" (llama.cpp started, the model
 * loaded with an 8-token test, the endpoint and Hugging Face reached). "Copy report" puts the JSON report – versions, RAM,
 * GPU, backend, model, provider (never the key), the last errors and main.log's tail – on the clipboard; "Open logs" opens
 * the log folder; "Run the model on" switches the local model between the GPU and the CPU (prefs.aiGpu). An app without
 * `ai.diagnose` (an older bridge) shows a note instead of the rows.
 */

const DOT: Record<AiCheck["level"], string> = { ok: "bg-accent", warn: "bg-warn", fail: "bg-danger", skip: "bg-surface-3" };
const TONE: Record<AiCheck["level"], string> = { ok: "text-accent", warn: "text-warn", fail: "text-danger", skip: "text-ink-3" };

export default function AiStatusPanel({ bridge, prefs, status, onGpu }: { bridge: DesktopApi; prefs: DesktopPrefs; status: AiStatus | null; onGpu: (mode: "auto" | "off") => void }) {
  const tx = useTranslations("DesktopAiFix");
  const td = useTranslations("Desktop");
  const [diagnosis, setDiagnosis] = useState<AiDiagnosis | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const available = typeof bridge.ai.diagnose === "function";

  const diagnose = useCallback(
    async (deep: boolean, setupChanged = false): Promise<AiDiagnosis | null> => {
      if (typeof bridge.ai.diagnose !== "function") return null;
      if (deep) setChecking(true);
      setError(null);
      try {
        const d = await bridge.ai.diagnose({ deep });
        // A quick look after the full checks only refreshes the last error (the other rows keep what was tested) – unless
        // the setup changed: --- review fix (desktop-ai-fix) --- the full checks tested the old one ("not downloaded yet"
        // stayed up after the download finished and was selected).
        setDiagnosis((prev) => (prev?.deep && !d.deep && !setupChanged ? { ...prev, checks: prev.checks.map((c) => (c.id === "lastError" ? (d.checks.find((x) => x.id === "lastError") ?? c) : c)) } : d));
        return d;
      } catch (err) {
        setError(aiErrorText(err));
        return null;
      } finally {
        if (deep) setChecking(false);
      }
    },
    [bridge],
  );

  // The quick look: when the tab opens, and again when a run fails (the last error changes) or the setup does – the CPU / GPU
  // choice, the provider, the selected model and (--- review fix (desktop-ai-fix) ---) whether it is ready: a finished
  // download (selected by the app before its "ready" event) changed nothing the panel watched.
  const lastErrorKey = JSON.stringify(status?.lastError ?? null);
  const setupKey = JSON.stringify([prefs.aiGpu, prefs.localModel, prefs.aiProvider, status?.local.model ?? null, status?.ready ?? null]);
  const setupRef = useRef(setupKey);
  useEffect(() => {
    const setupChanged = setupRef.current !== setupKey;
    setupRef.current = setupKey;
    void diagnose(false, setupChanged);
  }, [diagnose, lastErrorKey, setupKey]);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const copyReport = async () => {
    const d = diagnosis ?? (await diagnose(false));
    if (!d) return;
    const text = JSON.stringify(d.report, null, 2);
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
    setCopied(ok ? "ok" : "failed");
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 5000);
  };

  const reason = (c: AiCheck): string => {
    const params: Record<string, string | number> = { ...c.params };
    if (c.id === "lastError") {
      const task = String(params.task ?? "");
      params.task = td.has(`aiTask.${task}`) ? td(`aiTask.${task}`) : task;
      const at = new Date(String(params.at ?? ""));
      if (!Number.isNaN(at.getTime())) params.at = at.toLocaleTimeString();
    }
    const key = `check.${c.code}`;
    return tx.has(key) ? tx(key, params) : c.code;
  };

  return (
    <Card
      title={tx("statusTitle")}
      testId="ai-status"
      actions={
        <>
          <button type="button" className={primaryBtn} onClick={() => void diagnose(true)} disabled={!available || checking} data-testid="ai-run-checks">
            {checking ? tx("checking") : tx("runChecks")}
          </button>
          <button type="button" className={ghostBtn} onClick={() => void copyReport()} disabled={!available} data-testid="ai-copy-report">
            {tx("copyReport")}
          </button>
          <button type="button" className={ghostBtn} onClick={() => void bridge.openLogs()} data-testid="ai-open-logs">
            {tx("openLogs")}
          </button>
        </>
      }
    >
      <p className="text-xs text-ink-3">{tx("statusHint")}</p>
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-xs text-ink-2">{tx("runOn")}</span>
        <Chip on={prefs.aiGpu !== "off"} onClick={() => onGpu("auto")} testId="ai-gpu-auto">
          {tx("runOnAuto")}
        </Chip>
        <Chip on={prefs.aiGpu === "off"} onClick={() => onGpu("off")} testId="ai-gpu-off">
          {tx("runOnCpu")}
        </Chip>
        <span className="text-xs text-ink-3">{tx("runOnHint")}</span>
      </div>
      {!available && <p className="text-xs text-warn">{tx("notAvailable")}</p>}
      {diagnosis && (
        <ul className="divide-y divide-line border border-line rounded-lg" data-testid="ai-checks" data-deep={diagnosis.deep ? "1" : "0"}>
          {diagnosis.checks.map((c) => (
            <li key={c.id} className="px-3 py-2 text-xs space-y-1" data-ai-check={c.id} data-level={c.level}>
              <div className="flex items-start gap-2">
                <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${DOT[c.level]}`} aria-hidden="true" />
                <span className="font-semibold text-ink w-28 shrink-0">{tx(`row.${c.id}`)}</span>
                <span className={`w-20 shrink-0 font-medium ${TONE[c.level]}`}>{tx(`level.${c.level}`)}</span>
                <span className="text-ink-2 flex-1 break-words" data-testid={`ai-check-${c.id}`}>
                  {reason(c)}
                </span>
              </div>
              {c.details.length > 0 && (
                <details className="pl-[8.5rem] text-ink-3">
                  <summary className="cursor-pointer">{tx("details")}</summary>
                  <ul className="mt-1 space-y-0.5 font-mono break-all">
                    {c.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {diagnosis && <p className="text-xs text-ink-3">{diagnosis.deep ? tx("checkedAt", { time: new Date(diagnosis.at).toLocaleTimeString() }) : tx("quickNote")}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
      {copied && (
        <p className={`text-xs ${copied === "ok" ? "text-accent" : "text-warn"}`} data-testid="ai-report-copied">
          {copied === "ok" ? tx("reportCopied") : tx("copyFailed")}
        </p>
      )}
      {diagnosis && (
        <details className="text-xs text-ink-3" open={copied === "failed"}>
          <summary className="cursor-pointer">{tx("report")}</summary>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all bg-black/40 rounded-lg p-2 font-mono select-all" data-testid="ai-report">
            {JSON.stringify(diagnosis.report, null, 2)}
          </pre>
        </details>
      )}
    </Card>
  );
}
