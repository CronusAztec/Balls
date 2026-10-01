"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { DesktopApi, DesktopInfo, DesktopPrefs, LibraryItem, MediaKind, UpdateStatus } from "@/lib/desktop/contract";
import { getDesktop, pickedToFile } from "@/lib/desktop/bridge";
import { setHardwarePreferred } from "@/lib/desktop/gpuEncode";
import { mediaKindOfName } from "@/lib/desktop/mediaKinds";
import { aiClipSource, presetForPlatform, seedSource } from "@/lib/desktop/queueSources";
import { expandBatch } from "@/lib/desktop/renderQueue";
import { linkJobSettings, linkSeed, resolveLinkSettings } from "@/lib/recording/batch";
import { resolveFastExportFps } from "@/lib/recording/fastRenderPlan";
import type { MakeVideosResult } from "@/lib/desktop/ai/studio";
import type { ClipPlan } from "@/lib/bot/planner";
import type { DesktopPageHooks } from "../desktop/pageHooks";
import { useRenderQueue } from "../desktop/useRenderQueue";
import { useDesktopAi } from "../desktop/useDesktopAi";
import GpuPanel from "../desktop/GpuPanel";
import QueuePanel from "../desktop/QueuePanel";
import AiPanel from "../desktop/AiPanel";
import LibraryPanel from "../desktop/LibraryPanel";
import { errorText } from "../desktop/ui";

/*
 * --- desktop-exe --- The Desktop group of the simulator: shown only inside the Windows app (where the preload script put
 * `window.desktop`), under the simulator – GPU, Render queue, AI studio and Library. It also answers the app's menu, tray and
 * shortcuts, and opens media dropped on the window, picked in the native dialogs or passed to the app with the page's own
 * upload handlers. On the website it renders nothing and changes nothing.
 */

export const DESKTOP_TABS = ["gpu", "queue", "ai", "library"] as const;
export type DesktopTab = (typeof DESKTOP_TABS)[number];
const TAB_ICONS: Record<DesktopTab, string> = { gpu: "🖥️", queue: "🎞️", ai: "🤖", library: "📚" };

export default function DesktopSection({ page }: { page: DesktopPageHooks }) {
  const [bridge, setBridge] = useState<DesktopApi | null>(null);
  useEffect(() => setBridge(getDesktop()), []);
  if (!bridge) return null;
  return <DesktopStudio bridge={bridge} page={page} />;
}

function DesktopStudio({ bridge, page }: { bridge: DesktopApi; page: DesktopPageHooks }) {
  const t = useTranslations("Desktop");
  const pageRef = useRef(page);
  pageRef.current = page;
  const rootRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<DesktopTab>("queue");
  const [prefs, setPrefs] = useState<DesktopPrefs | null>(null);
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    bridge.prefs
      .get()
      .then((p) => {
        setPrefs(p);
        setHardwarePreferred(p.preferHardware);
      })
      .catch((err: unknown) => setNotice(errorText(err)));
    bridge.info().then(setInfo).catch(() => {});
    bridge.update.check().then(setUpdate).catch(() => {});
    return bridge.on("update", setUpdate);
  }, [bridge]);
  const changePrefs = useCallback(
    (patch: Partial<DesktopPrefs>) => {
      bridge.prefs
        .set(patch)
        .then((p) => {
          setPrefs(p);
          setHardwarePreferred(p.preferHardware);
        })
        .catch((err: unknown) => setNotice(errorText(err)));
    },
    [bridge],
  );
  const refreshLibrary = useCallback(() => {
    bridge.library.list().then(setLibrary).catch(() => {});
  }, [bridge]);

  const queue = useRenderQueue(bridge, pageRef, prefs?.outputFolder ?? "", refreshLibrary);
  const addAiClips = useCallback(
    (result: MakeVideosResult, plans: ClipPlan[]) => {
      const specs = result.clips.flatMap((clip) => {
        const plan = plans.find((p) => p.id === clip.planId);
        if (!plan) return [];
        return expandBatch([aiClipSource(clip, plan)], { resolutions: ["1080x1920"], fps: [60], codecs: ["h264"], presets: [presetForPlatform(clip.platform)] });
      });
      const added = queue.add(specs);
      setNotice(t("aiQueuedNotice", { count: added }));
    },
    [queue, t],
  );
  const reloadPrefs = useCallback(() => {
    bridge.prefs.get().then(setPrefs).catch(() => {});
  }, [bridge]);
  const ai = useDesktopAi(bridge, pageRef, addAiClips, reloadPrefs);

  const show = useCallback((next: DesktopTab) => {
    setTab(next);
    setTimeout(() => rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, []);

  /** A file from a dialog, a drop or the command line goes where the page's own upload of that kind goes. */
  const openFile = useCallback(
    (file: File, kind: MediaKind | "model" | "unknown") => {
      const media = pageRef.current.media;
      if (kind === "song") media.song(file);
      else if (kind === "video") media.video(file);
      else if (kind === "midi") media.midi(file);
      else if (kind === "image") media.image(file);
      else if (kind === "project") media.project(file);
      else if (kind === "model") {
        show("ai");
        setNotice(t("dropModelHint"));
        return;
      } else {
        setNotice(t("dropUnknown", { name: file.name }));
        return;
      }
      setNotice(t("opened", { name: file.name }));
    },
    [show, t],
  );
  const pick = useCallback(
    (kind: MediaKind) => {
      bridge.dialogs
        .pickMedia(kind)
        .then((picked) => picked && openFile(pickedToFile(picked), picked.kind))
        .catch((err: unknown) => setNotice(errorText(err)));
    },
    [bridge, openFile],
  );

  // The app's menu, tray and shortcuts.
  useEffect(
    () =>
      bridge.on("menu", (action) => {
        const actions = pageRef.current.actions;
        if (action === "gpu" || action === "queue" || action === "ai" || action === "library") show(action);
        else if (action === "open-song") pick("song");
        else if (action === "open-video") pick("video");
        else if (action === "open-project") pick("project");
        else if (action === "start") actions.startPause();
        else if (action === "restart") actions.restart();
        else if (action === "fast-export") actions.fastExport();
        else if (action === "record") actions.record();
        else if (action === "find") actions.find();
      }),
    [bridge, show, pick],
  );
  // Files passed to the app (a second start, "Open with").
  useEffect(() => bridge.on("openFile", (picked) => openFile(pickedToFile(picked), picked.kind)), [bridge, openFile]);
  // Media dropped anywhere on the window that no drop zone of the panel took.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (e.defaultPrevented) return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      for (const file of files.slice(0, 4)) openFile(file, mediaKindOfName(file.name));
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [openFile]);

  const rerender = useCallback(
    async (item: LibraryItem) => {
      try {
        const r = await resolveLinkSettings(item.meta.link);
        if (!r.ok) throw new Error(t("libRerenderFailed"));
        const settings = linkJobSettings(r.settings, pageRef.current.settings);
        const clip = { ...seedSource(settings, linkSeed(item.meta.link) ?? item.meta.seed, { kind: "link", link: item.meta.link }), name: item.fileName.replace(/\.[^.]+$/, ""), meta: { title: item.meta.title, platform: item.meta.platform, hook: item.meta.hook, caption: item.meta.caption, hashtags: item.meta.hashtags, link: item.meta.link } };
        const codec = item.encoder?.startsWith("hevc") || item.encoder === "libx265" ? "hevc" : item.encoder?.startsWith("av1") || item.encoder?.includes("av1") ? "av1" : "h264";
        queue.add(expandBatch([clip], { resolutions: [settings.recordingResolution], fps: [resolveFastExportFps(settings.fastExportFps)], codecs: [codec], presets: [presetForPlatform(item.meta.platform)] }));
        show("queue");
      } catch (err) {
        setNotice(errorText(err));
      }
    },
    [queue, show, t],
  );

  if (!prefs) return null;
  return (
    <section ref={rootRef} className="lg:col-span-3 bg-zinc-950/70 border border-zinc-800 rounded-xl p-3 sm:p-4 space-y-4 scroll-mt-4" data-desktop-group="" data-desktop-tab={tab} aria-label={t("groupTitle")}>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-base font-extrabold text-white flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#93d119] shadow-[0_0_10px_#93d119]" />
          {t("groupTitle")}
        </h2>
        <nav className="flex gap-1.5 flex-wrap" role="tablist" aria-label={t("groupTitle")}>
          {DESKTOP_TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              data-testid={`desktop-tab-${id}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${tab === id ? "bg-[#93d119]/15 border-[#93d119]/70 text-[#b0f02a]" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"}`}
            >
              <span className="mr-1">{TAB_ICONS[id]}</span>
              {t(`tab.${id}`)}
              {id === "queue" && queue.state.jobs.some((j) => j.status === "queued" || j.status === "rendering" || j.status === "encoding") && <span className="ml-1.5 text-[10px] text-cyan-300">●</span>}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex gap-1.5">
          {(["song", "video", "project"] as const).map((kind) => (
            <button key={kind} type="button" onClick={() => pick(kind)} className="px-2.5 py-1 rounded-lg text-[11px] bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer">
              {t(`open.${kind}`)}
            </button>
          ))}
        </div>
      </div>
      {notice && (
        <div className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2" data-testid="desktop-notice">
          <span className="flex-1">{notice}</span>
          <button type="button" className="text-zinc-500 hover:text-zinc-300 cursor-pointer" onClick={() => setNotice(null)} aria-label={t("dismiss")}>
            ✕
          </button>
        </div>
      )}
      {tab === "gpu" && <GpuPanel bridge={bridge} prefs={prefs} info={info} update={update} onPrefs={changePrefs} />}
      {tab === "queue" && <QueuePanel bridge={bridge} queue={queue} page={page} folder={prefs.outputFolder} onFolder={(outputFolder) => changePrefs({ outputFolder })} />}
      {tab === "ai" && <AiPanel ai={ai} prefs={prefs} page={page} onQueueTab={() => show("queue")} />}
      {tab === "library" && <LibraryPanel bridge={bridge} items={library} onRefresh={refreshLibrary} onRerender={(item) => void rerender(item)} />}
    </section>
  );
}
