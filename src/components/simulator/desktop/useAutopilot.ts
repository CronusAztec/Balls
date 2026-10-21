"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AutopilotSettings, DesktopApi, LibraryItem, PostizChannel, SocialQueueItem } from "@/lib/desktop/contract";
import { AUTOPILOT_CHECK_MS, DEFAULT_AUTOPILOT, shouldPlanNow } from "@/lib/desktop/autopilot";
import { bridgeChatModel } from "@/lib/desktop/ai/bridgeModel";
import { runPlanner, type PlanRunOutcome } from "@/lib/desktop/ai/planRun";
import { aiErrorText } from "./useDesktopAi";

/*
 * --- social-autopilot --- The page's side of the autopilot (phase 4 of docs/SOCIAL-AUTOPILOT.md): the queue and the
 * settings as the app holds them (the `social:queue` event keeps the list fresh), the Library and the channels the Proposed
 * group shows, the user's actions (skip, remove, edit a text, change a setting, "Propose now"), and the trigger: while the
 * autopilot is on, every 15 minutes the page asks `shouldPlanNow` (the last run older than `proposeHours`, fewer than
 * `perDay` proposals today) and, when it says so and the AI can answer, runs the planner on the app's model and puts its
 * proposals in the queue as the AI's. The planner only proposes: posting happens on the approval card, nowhere else.
 * The hook lives in the Desktop group's section, so it runs whenever the group is shown, whichever tab is open.
 */

export interface AutopilotApi {
  settings: AutopilotSettings | null;
  queue: SocialQueueItem[];
  library: LibraryItem[];
  channels: PostizChannel[];
  /** A planning run is on (the trigger's or "Propose now"). */
  planning: boolean;
  /** The last run's outcome in a message key (the panel translates), with its count. */
  note: { key: "proposed" | "noClips" | "noChannels" | "dayFull" | "needsAi" | "error"; count?: number; error?: string } | null;
  busy: boolean;
  error: string | null;
  setSettings: (patch: Partial<AutopilotSettings>) => Promise<void>;
  proposeNow: () => Promise<void>;
  skip: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  editText: (id: string, channelId: string, text: string) => Promise<void>;
  refresh: () => void;
}

/** --- the first check comes a minute after the group shows, then every 15 minutes */
export const AUTOPILOT_FIRST_CHECK_MS = 60_000;

/** `pendingCuts`: the render queue's jobs whose TikTok cut is still being made (useRenderQueue), left for a later run. */
export function useAutopilot(bridge: DesktopApi | null, locale: string, canPlan: () => boolean, pendingCuts?: () => readonly string[]): AutopilotApi {
  const [settings, setSettingsState] = useState<AutopilotSettings | null>(null);
  const [queue, setQueue] = useState<SocialQueueItem[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [channels, setChannels] = useState<PostizChannel[]>([]);
  const [planning, setPlanning] = useState(false);
  const [note, setNote] = useState<AutopilotApi["note"]>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planningRef = useRef(false);
  const playbookRef = useRef<string | null>(null);
  const settingsRef = useRef<AutopilotSettings | null>(null);
  const queueRef = useRef<SocialQueueItem[]>([]);
  settingsRef.current = settings;
  queueRef.current = queue;
  const model = useMemo(() => (bridge ? bridgeChatModel(bridge) : null), [bridge]);

  const refresh = useCallback(() => {
    if (!bridge) return;
    void bridge.social.autopilot.get().then(setSettingsState).catch(() => setSettingsState(DEFAULT_AUTOPILOT));
    void bridge.social.queue.list().then(setQueue).catch(() => {});
    void bridge.library.list().then(setLibrary).catch(() => {});
    void bridge.social.channels.list().then(setChannels).catch(() => setChannels([]));
  }, [bridge]);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (!bridge) return;
    return bridge.on("socialQueue", (items) => {
      setQueue(items);
      void bridge.library.list().then(setLibrary).catch(() => {});
    });
  }, [bridge]);

  /** One planning run (the trigger's or the button's): proposals into the queue, the run's time into the settings. */
  const plan = useCallback(
    async (ignoreBudget: boolean) => {
      if (!bridge || !model || planningRef.current) return;
      const current = settingsRef.current;
      if (!current) return;
      if (!canPlan()) {
        setNote({ key: "needsAi" });
        return;
      }
      planningRef.current = true;
      setPlanning(true);
      setError(null);
      try {
        if (playbookRef.current === null) playbookRef.current = await bridge.ai.playbook().catch(() => "");
        const out: PlanRunOutcome = await runPlanner(bridge, model, { locale, playbook: playbookRef.current, settings: current, queue: queueRef.current, ignoreBudget, pendingCuts: pendingCuts?.() });
        if (out.ok) {
          if (out.proposals.length > 0) await bridge.social.queue.propose(out.proposals.slice(0, 5), "ai");
          setNote({ key: "proposed", count: out.proposals.length });
        } else if (out.reason === "model") setNote({ key: "error", error: out.error });
        else setNote({ key: out.reason });
        // the run counts, whatever it found: the next one waits `proposeHours`
        setSettingsState(await bridge.social.autopilot.set({ lastPlannedAt: new Date().toISOString() }));
      } catch (err) {
        setNote({ key: "error", error: aiErrorText(err) });
      } finally {
        planningRef.current = false;
        setPlanning(false);
      }
    },
    [bridge, model, locale, canPlan, pendingCuts],
  );

  // the trigger: a minute after the group shows, then every 15 minutes, while the autopilot is on
  useEffect(() => {
    if (!bridge || !settings?.enabled) return;
    const check = () => {
      const s = settingsRef.current;
      if (s && shouldPlanNow(s, queueRef.current, Date.now())) void plan(false);
    };
    const first = setTimeout(check, AUTOPILOT_FIRST_CHECK_MS);
    const timer = setInterval(check, AUTOPILOT_CHECK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [bridge, settings?.enabled, plan]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(aiErrorText(err));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return {
    settings,
    queue,
    library,
    channels,
    planning,
    note,
    busy,
    error,
    setSettings: (patch) => act(async () => bridge && setSettingsState(await bridge.social.autopilot.set(patch))),
    proposeNow: () => plan(true),
    skip: (id) => act(async () => bridge && setQueue(await bridge.social.queue.skip(id))),
    remove: (id) => act(async () => bridge && setQueue(await bridge.social.queue.remove(id))),
    editText: (id, channelId, text) => act(async () => bridge && setQueue(await bridge.social.queue.edit(id, { channels: [{ integrationId: channelId, text }] }))),
    refresh,
  };
}
