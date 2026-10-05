"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { AiStatus, CloudConfigInput, DesktopApi, ModelEntry, ModelProgressEvent } from "@/lib/desktop/contract";
import type { SimulatorSettings } from "@/lib/settings";
import type { BotPlatform } from "@/lib/bot/playbook";
import { runAgent, type AgentEvent, type AgentTask } from "@/lib/desktop/ai/agent";
import { bridgeChatModel } from "@/lib/desktop/ai/bridgeModel";
import { selectPlaybookContext } from "@/lib/desktop/ai/playbookContext";
import { changedKeys, patchFromChanges, validateSettingsPatch } from "@/lib/desktop/ai/settingsPatch";
import { PlanStore, copyTask, ideasTask, makeVideosTask, settingsTask, type CopyResult, type IdeasResult, type MakeVideosResult, type SettingsResult } from "@/lib/desktop/ai/studio";
import type { ClipPlan } from "@/lib/bot/planner";
import type { DesktopPageHooks } from "./pageHooks";
import { studioPorts } from "./studioPorts";
import { messageOf, stripIpcPrefix } from "@/lib/desktop/errors"; // --- desktop-ai-fix --- the IPC prefix gone wherever it sits

/*
 * --- desktop-exe --- The AI panel's state: the model manager (catalog, downloads with progress, a picked GGUF, the cloud
 * provider), and the four studio jobs run through the tool-call loop on the app's model – streaming into the panel, with
 * Stop. Results are only applied once valid: planned clips go to the render queue, a settings patch is applied with an
 * Undo (the page's settings before it, back through the preset loader).
 *
 * --- desktop-ai-fix --- The run's progress for the panel ("Reading the request… N s" until the first token of a turn, then
 * "Writing… N s") and a timing line per turn; errors without Electron's IPC prefix wherever it sits; and the CPU / GPU
 * choice (prefs.aiGpu) for the status panel.
 */

export const AI_TASKS = ["videos", "copy", "settings", "ideas"] as const;
export type AiTaskKind = (typeof AI_TASKS)[number];

export type AiResult =
  | { kind: "videos"; result: MakeVideosResult; plans: ClipPlan[] }
  | { kind: "copy"; result: CopyResult }
  | { kind: "settings"; result: SettingsResult; changed: string[] }
  | { kind: "ideas"; result: IdeasResult };

export interface AiLogLine {
  kind: "tool" | "result" | "invalid" | "error" | "progress" | "turn" | "timing";
  text: string;
  /** --- desktop-ai-fix --- A finished turn's timing (kind "timing"): seconds to the first token and in all. */
  timing?: { step: number; firstSec: number | null; totalSec: number };
}

/** --- desktop-ai-fix --- The model turn in progress: when it started and when its first token came (null: not yet). */
export interface AiTurnProgress {
  step: number;
  startedAt: number;
  firstTokenAt: number | null;
}

/** --- desktop-ai-fix --- An error from the bridge without Electron's "Error invoking remote method …" prefix. */
export function aiErrorText(err: unknown): string {
  return stripIpcPrefix(messageOf(err));
}

export interface DesktopAiApi {
  status: AiStatus | null;
  models: ModelEntry[];
  progress: Record<string, ModelProgressEvent>;
  task: AiTaskKind;
  setTask: (task: AiTaskKind) => void;
  running: boolean;
  stream: string;
  log: AiLogLine[];
  result: AiResult | null;
  error: string | null;
  undo: SimulatorSettings | null;
  run: (prompt: string, options: { platforms: BotPlatform[]; existing: string }) => void;
  stop: () => void;
  undoSettings: () => void;
  refresh: () => void;
  download: (id: string) => void;
  cancelDownload: (id: string) => void;
  select: (id: string) => void;
  remove: (id: string) => void;
  importModel: () => void;
  setCloud: (config: CloudConfigInput) => Promise<void>;
  clearKey: () => void;
  useProvider: (provider: "local" | "cloud") => void;
  message: string | null;
  /** --- desktop-ai-fix --- The turn in progress and the clock the panel's progress line counts with. */
  turn: AiTurnProgress | null;
  now: number;
  /** --- desktop-ai-fix --- Run the local model on the GPU when one works ("auto") or on the CPU only ("off"). */
  setGpu: (mode: "auto" | "off") => void;
}

export function useDesktopAi(bridge: DesktopApi | null, pageRef: MutableRefObject<DesktopPageHooks>, onClips: (result: MakeVideosResult, plans: ClipPlan[]) => void, onPrefsChanged: () => void): DesktopAiApi {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [progress, setProgress] = useState<Record<string, ModelProgressEvent>>({});
  const [task, setTask] = useState<AiTaskKind>("videos");
  const [running, setRunning] = useState(false);
  const [stream, setStream] = useState("");
  const [log, setLog] = useState<AiLogLine[]>([]);
  const [result, setResult] = useState<AiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<SimulatorSettings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // --- desktop-ai-fix --- the turn in progress and a clock that ticks while a run is on
  const [turn, setTurn] = useState<AiTurnProgress | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const turnRef = useRef<AiTurnProgress | null>(null);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const abortRef = useRef<AbortController | null>(null);
  const playbookRef = useRef<string | null>(null);
  const model = useMemo(() => (bridge ? bridgeChatModel(bridge) : null), [bridge]);

  const refresh = useCallback(() => {
    if (!bridge) return;
    void bridge.ai.status().then(setStatus).catch(() => {});
    void bridge.ai.models().then(setModels).catch(() => {});
  }, [bridge]);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (!bridge) return;
    return bridge.on("modelProgress", (e) => {
      setProgress((p) => ({ ...p, [e.id]: e }));
      if (e.state === "ready" || e.error) refresh();
      if (e.error && e.error !== "cancelled") setMessage(e.error);
    });
  }, [bridge, refresh]);

  const stop = useCallback(() => abortRef.current?.abort(), []);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    (prompt: string, options: { platforms: BotPlatform[]; existing: string }) => {
      if (!bridge || !model || running) return;
      const page = pageRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setStream("");
      setLog([]);
      setResult(null);
      setError(null);
      setMessage(null);
      // --- desktop-ai-fix --- a timing line for each finished turn
      const finishTurn = () => {
        const t = turnRef.current;
        if (!t) return;
        turnRef.current = null;
        setTurn(null); // (a tool that runs next shows its own progress lines)
        const end = Date.now();
        setLog((l) => [...l, { kind: "timing", text: "", timing: { step: t.step, firstSec: t.firstTokenAt === null ? null : Math.round((t.firstTokenAt - t.startedAt) / 100) / 10, totalSec: Math.round((end - t.startedAt) / 100) / 10 } }]);
      };
      const onEvent = (e: AgentEvent) => {
        if (e.type === "token" && turnRef.current && turnRef.current.firstTokenAt === null) {
          turnRef.current = { ...turnRef.current, firstTokenAt: Date.now() };
          setTurn(turnRef.current);
        }
        if (e.type === "turn") {
          finishTurn();
          turnRef.current = { step: e.step, startedAt: Date.now(), firstTokenAt: null };
          setTurn(turnRef.current);
          setNow(Date.now());
        } else if (e.type === "invalid" || e.type === "tool" || e.type === "final") finishTurn();
        if (e.type === "token") setStream((s) => (s.length > 20000 ? s.slice(-15000) : s) + e.text);
        else if (e.type === "turn") setStream((s) => (s ? `${s}\n\n` : s));
        else if (e.type === "tool") setLog((l) => [...l, { kind: "tool", text: `${e.name}(${JSON.stringify(e.args)})` }]);
        else if (e.type === "toolResult") setLog((l) => [...l, { kind: "result", text: `${e.name} ✓` }]);
        else if (e.type === "toolError") setLog((l) => [...l, { kind: "error", text: `${e.name}: ${e.error}` }]);
        else if (e.type === "invalid") setLog((l) => [...l, { kind: "invalid", text: e.errors.slice(0, 3).join(" · ") }]);
        else if (e.type === "progress") setLog((l) => (l.length && l[l.length - 1].kind === "progress" ? [...l.slice(0, -1), { kind: "progress", text: e.text }] : [...l, { kind: "progress", text: e.text }]));
      };
      void (async () => {
        try {
          const platform = options.platforms[0] ?? "reels";
          if (task === "videos") {
            const store = new PlanStore();
            const ports = studioPorts({ copy: page.copy, locale: page.locale, getWorld: page.getWorld });
            const out = await runAgent(model, makeVideosTask(prompt, { copy: page.copy, locale: page.locale, platform, store, ports }), { onEvent, signal: controller.signal });
            if (!out.ok) throw new Error(out.error);
            const plans = out.result.clips.map((c) => store.get(c.planId)).filter((p): p is ClipPlan => !!p);
            setResult({ kind: "videos", result: out.result, plans });
            onClips(out.result, plans);
          } else if (task === "copy") {
            const out = await runAgent(model, copyTask(prompt, { locale: page.locale, platforms: options.platforms.length ? options.platforms : ["tiktok", "reels", "shorts"], settings: page.settings, existing: options.existing }), { onEvent, signal: controller.signal });
            if (!out.ok) throw new Error(out.error);
            setResult({ kind: "copy", result: out.result });
          } else if (task === "settings") {
            const before = page.settings;
            const t: AgentTask<SettingsResult> = settingsTask(prompt, before, page.locale);
            const out = await runAgent(model, t, { onEvent, signal: controller.signal });
            if (!out.ok) throw new Error(out.error);
            // Checked again against the page as it is now (checkFinal validated it), then applied with an undo.
            const checked = validateSettingsPatch(pageRef.current.settings, patchFromChanges(out.result.changes));
            if (!checked.ok) throw new Error(checked.errors.join("; "));
            const changed = changedKeys(pageRef.current.settings, checked.patch);
            setUndo(pageRef.current.settings);
            const { mode, ...rest } = checked.patch;
            if (mode && mode !== pageRef.current.settings.mode) {
              pageRef.current.changeMode(mode);
              setTimeout(() => pageRef.current.update(rest), 0);
            } else pageRef.current.update(rest);
            setResult({ kind: "settings", result: out.result, changed });
          } else {
            if (playbookRef.current === null) playbookRef.current = await bridge.ai.playbook();
            const context = selectPlaybookContext(playbookRef.current, prompt, 4500);
            const out = await runAgent(model, ideasTask(prompt, { copy: page.copy, locale: page.locale, playbook: context }), { onEvent, signal: controller.signal });
            if (!out.ok) throw new Error(out.error);
            setResult({ kind: "ideas", result: out.result });
          }
        } catch (err) {
          if (!controller.signal.aborted) setError(aiErrorText(err)); // --- desktop-ai-fix --- (the prefix anywhere, not only at the start)
        } finally {
          finishTurn();
          setTurn(null);
          abortRef.current = null;
          setRunning(false);
          refresh();
        }
      })();
    },
    [bridge, model, running, task, pageRef, onClips, refresh],
  );

  const undoSettings = useCallback(() => {
    if (!undo) return;
    pageRef.current.applySettings(undo);
    setUndo(null);
  }, [undo, pageRef]);

  const wrap = useCallback(
    (fn: () => Promise<unknown>) => {
      setMessage(null);
      fn()
        .catch((err: unknown) => setMessage(aiErrorText(err))) // --- desktop-ai-fix ---
        .finally(() => {
          refresh();
          onPrefsChanged();
        });
    },
    [refresh, onPrefsChanged],
  );

  return {
    status,
    models,
    progress,
    task,
    setTask,
    running,
    stream,
    log,
    result,
    error,
    undo,
    run,
    stop,
    undoSettings,
    refresh,
    download: (id) => bridge && wrap(() => bridge.ai.downloadModel(id).then(setModels)),
    cancelDownload: (id) => bridge && wrap(() => bridge.ai.cancelDownload(id)),
    select: (id) => bridge && wrap(async () => {
      await bridge.ai.selectModel(id);
      await bridge.prefs.set({ aiProvider: "local" });
    }),
    remove: (id) => bridge && wrap(() => bridge.ai.removeModel(id).then(setModels)),
    importModel: () => bridge && wrap(() => bridge.ai.importModel().then(setModels)),
    setCloud: async (config) => {
      if (!bridge) return;
      setMessage(null);
      try {
        setStatus(await bridge.ai.setCloud(config));
        onPrefsChanged();
      } catch (err) {
        setMessage(aiErrorText(err)); // --- desktop-ai-fix ---
      }
    },
    clearKey: () => bridge && wrap(() => bridge.ai.clearCloudKey().then(setStatus)),
    useProvider: (provider) => bridge && wrap(() => bridge.prefs.set({ aiProvider: provider })),
    message,
    // --- desktop-ai-fix ---
    turn,
    now,
    setGpu: (mode) => bridge && wrap(() => bridge.prefs.set({ aiGpu: mode })),
  };
}
