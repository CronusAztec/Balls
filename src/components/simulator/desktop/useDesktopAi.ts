"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { AiStatus, CloudConfigInput, DesktopApi, ModelEntry, ModelProgressEvent } from "@/lib/desktop/contract";
import type { SimulatorSettings } from "@/lib/settings";
import type { BotPlatform } from "@/lib/bot/playbook";
import { runAgent, type AgentEvent, type AgentTask } from "@/lib/desktop/ai/agent";
import { bridgeChatModel } from "@/lib/desktop/ai/bridgeModel";
import { TRENDING_CHARS, selectPlaybookContext, trendingContext } from "@/lib/desktop/ai/playbookContext";
import { changedKeys, patchFromChanges, validateSettingsPatch } from "@/lib/desktop/ai/settingsPatch";
import { customFighterTask, fighterFromAnswer } from "@/lib/desktop/ai/customFighter";
import { customModeFrom, customModeTask, type CustomModeResult, type CustomModeSpec } from "@/lib/desktop/ai/customMode";
import { MAX_CUSTOM_FIGHTERS, buildCustomFighter } from "@/lib/physics/modes/fightLeagueCustom";
import { balanceCustomFighter } from "@/lib/simulation/flBalance";
import { FL_BY_ID, type FlFighterRow } from "@/lib/physics/modes/fightLeagueRoster";
import type { CustomContentApi } from "./useCustomContent";
import { IDEAS_RESEARCH_CHARS, PlanStore, copyTask, ideasTask, makeVideosTask, settingsTask, type CopyResult, type IdeasResult, type MakeVideosResult, type SettingsResult } from "@/lib/desktop/ai/studio";
import type { ClipPlan } from "@/lib/bot/planner";
import type { DesktopPageHooks } from "./pageHooks";
import { studioPorts } from "./studioPorts";
import { messageOf, stripIpcPrefix } from "@/lib/desktop/errors"; // --- desktop-ai-fix --- the IPC prefix gone wherever it sits
// --- social-autopilot --- the "plan" job: proposals for the Posts tab's queue (never a post)
import { committedTrends, runPlanner } from "@/lib/desktop/ai/planRun"; // --- trends --- (the committed summary, loaded on first use)
import type { PlanResult } from "@/lib/desktop/ai/plan";
import type { PostizChannel, SocialProposalInput } from "@/lib/desktop/contract";
import { desktopCapabilities, hasCustom, hasSocial, type DesktopCapabilities } from "@/lib/desktop/capabilities"; // --- old-bridge ---

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

export const AI_TASKS = ["videos", "copy", "settings", "ideas", "fighter", "mode", "plan" /* --- social-autopilot --- proposals for the Posts tab */] as const; // --- custom-content --- (fighter, mode: the player's own, kept on this computer)
export type AiTaskKind = (typeof AI_TASKS)[number];

/**
 * --- old-bridge --- The jobs the app the page runs in can do: "New fighter" and "New mode" keep what they make in the app
 * (custom content, app 1.2.0), "Plan posts" reads Postiz and fills the proposal queue (app 1.4.0). An older app is not offered
 * them (the model would run for minutes and the result could not be kept).
 */
export function aiTasksFor(caps: Pick<DesktopCapabilities, "custom" | "social">): AiTaskKind[] {
  return AI_TASKS.filter((k) => (k === "fighter" || k === "mode" ? caps.custom : k === "plan" ? caps.social : true));
}

export type AiResult =
  | { kind: "videos"; result: MakeVideosResult; plans: ClipPlan[]; started: boolean /* --- ai-cut --- whether this run started the queue */ }
  | { kind: "copy"; result: CopyResult }
  | { kind: "settings"; result: SettingsResult; changed: string[] }
  | { kind: "ideas"; result: IdeasResult }
  // --- custom-content --- a fighter saved (and the numbers the builder had to bring inside the limits), a mode saved and applied
  | { kind: "fighter"; row: FlFighterRow; notes: string[]; winRate: number | null }
  | { kind: "mode"; spec: CustomModeSpec; result: CustomModeResult; changed: string[] }
  // --- social-autopilot --- the planner's proposals (queued only when the user presses "Send to Posts tab"; posted only from the card)
  | { kind: "plan"; result: PlanResult; proposals: SocialProposalInput[]; channels: PostizChannel[]; sent: boolean };

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
  /** --- old-bridge --- The jobs this app can do (aiTasksFor), in AI_TASKS order. */
  tasks: readonly AiTaskKind[];
  running: boolean;
  stream: string;
  log: AiLogLine[];
  result: AiResult | null;
  error: string | null;
  undo: SimulatorSettings | null;
  /** --- ai-cut --- `cut`: Make videos also answers a TikTok cut per clip (the queue cuts it after the render). */
  run: (prompt: string, options: { platforms: BotPlatform[]; existing: string; cut?: boolean; start?: boolean /* --- ai-cut --- the queue starts right away */ }) => void;
  stop: () => void;
  undoSettings: () => void;
  /** --- custom-content --- Applies a saved mode to the page (with Undo); an error text when it no longer fits, else null. */
  applyMode: (spec: CustomModeSpec) => string | null;
  /** --- custom-content --- Puts a fighter in slot A of the Ball Fight League (switching to that mode), with Undo. */
  fightWith: (id: string) => void;
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
  /** --- social-autopilot --- Puts the plan's proposals in the queue (as the AI's); the Posts tab shows them for review. */
  sendToQueue: () => Promise<void>;
}

export function useDesktopAi(bridge: DesktopApi | null, pageRef: MutableRefObject<DesktopPageHooks>, onClips: (result: MakeVideosResult, plans: ClipPlan[], options: { start: boolean } /* --- ai-cut --- */) => boolean /* --- ai-cut --- the queue started */, onPrefsChanged: () => void, custom?: CustomContentApi, pendingCuts?: () => readonly string[] /* --- ai-cut --- the queue's cuts still being made */): DesktopAiApi {
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
  const tasks = useMemo(() => aiTasksFor(desktopCapabilities(bridge)), [bridge]); // --- old-bridge ---

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
      // --- review fix (desktop-ai-fix) --- the app selects a finished download (when the selected model is not ready) before
      // this event, so the page's copy of the app's preferences follows it too (the AI status panel looks again)
      if (e.state === "ready") onPrefsChanged();
      if (e.error && e.error !== "cancelled") setMessage(e.error);
    });
  }, [bridge, refresh, onPrefsChanged]);

  const stop = useCallback(() => abortRef.current?.abort(), []);
  useEffect(() => () => abortRef.current?.abort(), []);

  /** --- custom-content --- Checks a saved patch against the page as it is now and applies it with an Undo (the settings assistant's way); the keys it changed. */
  const applyPatch = useCallback(
    (patch: Record<string, unknown>): string[] => {
      const page = pageRef.current;
      const checked = validateSettingsPatch(page.settings, patch);
      if (!checked.ok) throw new Error(checked.errors.join("; "));
      const changed = changedKeys(page.settings, checked.patch);
      setUndo(page.settings);
      const { mode, ...rest } = checked.patch;
      if (mode && mode !== page.settings.mode) {
        page.changeMode(mode);
        setTimeout(() => pageRef.current.update(rest), 0);
      } else page.update(rest);
      return changed;
    },
    [pageRef],
  );

  const fightWith = useCallback(
    (id: string) => {
      const p = pageRef.current;
      setUndo(p.settings);
      if (p.settings.mode !== "fightLeague") {
        p.changeMode("fightLeague");
        setTimeout(() => pageRef.current.update({ flFighterA: id }), 0);
      } else p.update({ flFighterA: id });
    },
    [pageRef],
  );

  const applyMode = useCallback(
    (spec: CustomModeSpec): string | null => {
      try {
        applyPatch(spec.patch);
        return null;
      } catch (err) {
        return aiErrorText(err);
      }
    },
    [applyPatch],
  );

  const run = useCallback(
    (prompt: string, options: { platforms: BotPlatform[]; existing: string; cut?: boolean; start?: boolean }) => {
      if (!bridge || !model || running || !tasks.includes(task)) return; // --- old-bridge --- (a job this app cannot do is not offered)
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
            const out = await runAgent(model, makeVideosTask(prompt, { copy: page.copy, locale: page.locale, platform, store, ports, cut: options.cut === true /* --- ai-cut --- */, trending: trendingContext(await committedTrends(), TRENDING_CHARS.videos) /* --- trends --- */ }), { onEvent, signal: controller.signal });
            if (!out.ok) throw new Error(out.error);
            const plans = out.result.clips.map((c) => store.get(c.planId)).filter((p): p is ClipPlan => !!p);
            // --- ai-cut --- (one click: the queue starts when asked; the result keeps whether it did, for the clips card)
            const started = onClips(out.result, plans, { start: options.start === true });
            setResult({ kind: "videos", result: out.result, plans, started });
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
          } else if (task === "fighter") {
            if (!custom || !hasCustom(bridge)) throw new Error("This computer cannot keep custom fighters here."); // --- old-bridge --- (the app keeps them since 1.2.0)
            if (custom.content.fighters.length >= MAX_CUSTOM_FIGHTERS) throw new Error(`You have ${MAX_CUSTOM_FIGHTERS} custom fighters: delete one to make another.`);
            const taken = new Set(FL_BY_ID.keys());
            const out = await runAgent(model, customFighterTask(prompt, page.locale, taken), { onEvent, signal: controller.signal });
            if (!out.ok) throw new Error(out.error);
            const built = fighterFromAnswer(out.result, taken);
            if (!built.ok) throw new Error(built.errors.join("; "));
            // test fights against built-in fighters set its damage, attack speed and cast speed (simulation/flBalance.ts)
            setLog((l) => [...l, { kind: "progress", text: "Balancing…" }]);
            const balanced = await balanceCustomFighter(built.spec, {
              signal: controller.signal,
              onProgress: (done, total) => setLog((l) => (l.length && l[l.length - 1].kind === "progress" ? [...l.slice(0, -1), { kind: "progress", text: `Balancing… ${done}/${total}` }] : [...l, { kind: "progress", text: `Balancing… ${done}/${total}` }])),
            });
            const final = buildCustomFighter(balanced.spec, taken);
            if (!final.ok) throw new Error(final.errors.join("; "));
            if (!(await custom.addFighter(final.spec))) throw new Error("The fighter could not be saved on this computer.");
            setResult({ kind: "fighter", row: final.row, notes: built.notes, winRate: balanced.after });
          } else if (task === "mode") {
            if (!custom || !hasCustom(bridge)) throw new Error("This computer cannot keep custom modes here.");
            const before = pageRef.current.settings;
            const out = await runAgent(model, customModeTask(prompt, before, page.locale), { onEvent, signal: controller.signal });
            if (!out.ok) throw new Error(out.error);
            const spec = customModeFrom(out.result, pageRef.current.settings, new Set(custom.content.modes.map((m) => m.id)));
            if (!spec) throw new Error("The mode did not pass the settings check.");
            if (!(await custom.addMode(spec))) throw new Error("The mode could not be saved on this computer (or you have reached the limit).");
            const changed = applyPatch(spec.patch);
            setResult({ kind: "mode", spec, result: out.result, changed });
          } else if (task === "plan") {
            // --- social-autopilot --- the plan job: proposals only (the user sends them to the queue, and approves each on the card)
            if (!hasSocial(bridge)) throw new Error("This version of the app cannot plan posts. Update it first."); // --- old-bridge --- (app 1.4.0)
            if (playbookRef.current === null) playbookRef.current = await bridge.ai.playbook();
            const out = await runPlanner(bridge, model, { locale: page.locale, playbook: playbookRef.current, onEvent, signal: controller.signal, ignoreBudget: true, pendingCuts: pendingCuts?.() });
            if (!out.ok) {
              if (out.reason === "model") throw new Error(out.error);
              throw new Error(out.reason === "noChannels" ? "Tick at least one channel in the Autopilot card of the Posts tab first." : out.reason === "noClips" ? "Every clip in the Library is posted or proposed already. Render a new one first." : "Today's proposals are all made.");
            }
            setResult({ kind: "plan", result: out.result, proposals: out.proposals, channels: out.channels, sent: false });
          } else {
            if (playbookRef.current === null) playbookRef.current = await bridge.ai.playbook();
            // --- trends --- what is trending takes its share of the 4,500-character research budget, the playbook the rest
            const trending = trendingContext(await committedTrends(), TRENDING_CHARS.ideas);
            const context = selectPlaybookContext(playbookRef.current, prompt, IDEAS_RESEARCH_CHARS - trending.length);
            const out = await runAgent(model, ideasTask(prompt, { copy: page.copy, locale: page.locale, playbook: context, trending }), { onEvent, signal: controller.signal });
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
    [bridge, model, running, task, tasks, pageRef, onClips, refresh, custom, applyPatch, pendingCuts],
  );

  // --- social-autopilot --- "Send to Posts tab": the proposals become `proposed` items (by the AI); nothing is posted
  const sendToQueue = useCallback(async () => {
    const r = result;
    if (!hasSocial(bridge) || !r || r.kind !== "plan" || r.sent || r.proposals.length === 0) return; // --- old-bridge ---
    setMessage(null);
    try {
      await bridge.social.queue.propose(r.proposals.slice(0, 5), "ai");
      setResult({ ...r, sent: true });
    } catch (err) {
      setError(aiErrorText(err));
    }
  }, [bridge, result]);

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
    tasks, // --- old-bridge ---
    running,
    stream,
    log,
    result,
    error,
    undo,
    run,
    stop,
    undoSettings,
    applyMode,
    fightWith,
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
    sendToQueue, // --- social-autopilot ---
  };
}
