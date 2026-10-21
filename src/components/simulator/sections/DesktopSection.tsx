"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useCustomContent } from "../desktop/useCustomContent"; // --- custom-content ---
import { useAutopilot } from "../desktop/useAutopilot"; // --- social-autopilot --- the proposal queue, the settings and the 15-minute trigger (it only proposes)
import GpuPanel from "../desktop/GpuPanel";
import QueuePanel from "../desktop/QueuePanel";
import AiPanel from "../desktop/AiPanel";
import LibraryPanel, { type LibrarySuggestCut } from "../desktop/LibraryPanel";
import { suggestCut } from "../desktop/aiCut"; // --- ai-cut --- the local AI proposes a cut for a Library clip
import { beatsOfLibraryItem } from "@/lib/clipEdit/propose"; // --- ai-cut ---
import { loadClipEdit, parseClipEdit } from "@/lib/clipEdit/spec"; // --- ai-cut ---
import AccountsPanel from "../desktop/AccountsPanel"; // --- social-postiz --- the Postiz key and channels
import PostizPostCard, { type CardPrefill } from "../desktop/PostizPostCard"; // --- social-postiz --- phase 2: the approval card and the Posts tab
import PostsPanel from "../desktop/PostsPanel";
import WhatsNew from "../desktop/WhatsNew"; // --- changelog ---
import { errorText, ghostBtn, primaryBtn } from "../desktop/ui"; // --- desktop-autorelease --- (the update banner's buttons)
import { registerDesktopPublishTargets } from "@/lib/publish/desktopTargets"; // --- desktop-exe --- the Library's Publish buttons
import type { PublishPlatform } from "@/lib/publish/platforms";

import { IconClose } from "@/components/ui/icons"; // --- site-redesign ---
/*
 * --- desktop-exe --- The Desktop group of the simulator: shown only inside the Windows app (where the preload script put
 * `window.desktop`), under the simulator – GPU, Render queue, AI studio and Library. It also answers the app's menu, tray and
 * shortcuts, and opens media dropped on the window, picked in the native dialogs or passed to the app with the page's own
 * upload handlers. On the website it renders nothing and changes nothing.
 */

export const DESKTOP_TABS = ["gpu", "queue", "ai", "library", "accounts" /* --- social-postiz --- */, "posts" /* --- social-postiz --- phase 2: what became of the posts ("queue" is the render queue) */] as const;
export type DesktopTab = (typeof DESKTOP_TABS)[number];
const TAB_ICONS: Record<DesktopTab, string> = { gpu: "🖥️", queue: "🎞️", ai: "🤖", library: "📚", accounts: "📣", posts: "📬" };
/** --- desktop-exe --- The Publish platforms by their own names (the same in every language). */
const PLATFORM_NAMES: Record<PublishPlatform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };

export default function DesktopSection({ page }: { page: DesktopPageHooks }) {
  const [bridge, setBridge] = useState<DesktopApi | null>(null);
  useEffect(() => setBridge(getDesktop()), []);
  if (!bridge) return null;
  return (
    <>
      <DesktopStudio bridge={bridge} page={page} />
      <WhatsNew /* --- changelog --- the notice after an update (fixed on the screen, so it takes no place in the grid) */ />
    </>
  );
}

function DesktopStudio({ bridge, page }: { bridge: DesktopApi; page: DesktopPageHooks }) {
  const t = useTranslations("Desktop");
  // --- ai-cut --- the Clip editor's words the queue's cut step and the AI's hook examples use (its own namespace, not Desktop's)
  const editor = useTranslations("ClipEditor");
  const cutCard = useMemo(() => ({ title: editor("cardTitle"), note: editor("cardNote") }), [editor]);
  const hookIdeas = useMemo(() => (["escape", "winner", "wait", "count"] as const).map((k) => editor(`ideas.${k}`)), [editor]);
  const pageRef = useRef(page);
  pageRef.current = page;
  const rootRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<DesktopTab>("queue");
  const [prefs, setPrefs] = useState<DesktopPrefs | null>(null);
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [updateLater, setUpdateLater] = useState<string | null>(null); // --- desktop-autorelease --- the version "Later" hid
  // --- social-postiz --- phase 2: whether a Postiz key is stored (the Library's "Post with Postiz" needs one) and the open card
  const [postizConfigured, setPostizConfigured] = useState(false);
  const [postizCard, setPostizCard] = useState<{ item: LibraryItem; prefill?: CardPrefill } | null>(null);

  useEffect(() => {
    bridge.prefs
      .get()
      .then((p) => {
        setPrefs(p);
        setHardwarePreferred(p.preferHardware);
      })
      .catch((err: unknown) => setNotice(errorText(err)));
    bridge.info().then(setInfo).catch(() => {});
    // --- low-findings-2 --- the updater's status as it is, never a check: the app's own quiet schedule checks 8 s after launch
    // (a manual check at every start made an offline start show "error" and doubled the quiet one); the events keep it fresh
    bridge.update.status?.().then(setUpdate).catch(() => {});
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
  // --- social-postiz --- the key's status, read again whenever the tab changes (a key saved or forgotten in Accounts)
  useEffect(() => {
    let gone = false;
    bridge.social.key
      .status()
      .then((s) => !gone && setPostizConfigured(s.configured))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [bridge, tab]);

  // --- ai-cut --- a job that carries a cut is cut after it is saved; a cut that fails is said here, the clip itself is in the Library
  const queue = useRenderQueue(bridge, pageRef, prefs?.outputFolder ?? "", refreshLibrary, {
    card: cutCard,
    onFailed: (job, error) => setNotice(t("jobCutFailed", { name: job.name, error })),
    // a saved cut is said too, with the free run's mark named as the editor names it (a cut stamps the frames again)
    onCut: (job, result) => setNotice(result.watermarked ? `${t("jobCutSaved", { name: job.name })} ${editor("watermarked")}` : t("jobCutSaved", { name: job.name })),
  });
  const addAiClips = useCallback(
    (result: MakeVideosResult, plans: ClipPlan[], options: { start: boolean }) => {
      const base = loadClipEdit(); // --- ai-cut --- the user's remembered spec: its address goes on every cut of this run
      const specs = result.clips.flatMap((clip) => {
        const plan = plans.find((p) => p.id === clip.planId);
        if (!plan) return [];
        return expandBatch([aiClipSource(clip, plan, base)], { resolutions: ["1080x1920"], fps: [60], codecs: ["h264"], presets: [presetForPlatform(clip.platform)] });
      });
      const added = queue.add(specs);
      // --- ai-cut --- one click from the prompt to the files: the queue starts when the panel asked for it
      if (options.start && added > 0) {
        queue.start();
        setNotice(t("aiStartedNotice", { count: added }));
      } else setNotice(t("aiQueuedNotice", { count: added }));
    },
    [queue, t],
  );
  const reloadPrefs = useCallback(() => {
    bridge.prefs.get().then(setPrefs).catch(() => {});
  }, [bridge]);
  const custom = useCustomContent(bridge); // --- custom-content --- the player's own fighters (they join the roster here) and modes
  const ai = useDesktopAi(bridge, pageRef, addAiClips, reloadPrefs, custom);
  // --- social-autopilot --- the trigger runs while the Desktop group is shown (whichever tab), only when the AI can answer and
  // no studio job is on; its proposals go to the queue, where the Posts tab's "Review and approve" opens the card
  const aiRef = useRef(ai);
  aiRef.current = ai;
  const autopilot = useAutopilot(bridge, page.locale, useCallback(() => !!aiRef.current.status?.ready && !aiRef.current.running, []));
  // --- ai-cut --- "Suggest with AI" in the Library's Clip editor: the clip's beats as far as a Library item knows them, the
  // user's current spec as the base, the editor's hook ideas as examples (offered only while the app's AI is ready)
  const suggestLibraryCut = useCallback<LibrarySuggestCut>((item, input) => suggestCut(bridge, pageRef.current.locale, beatsOfLibraryItem(item, input.durationSec), parseClipEdit(input.current), hookIdeas, input.request ?? "", input.signal), [bridge, hookIdeas]);

  // --- desktop-exe --- the Publish feature's paths as the Library's one-click targets (lib/publish/desktopTargets.ts):
  // the accounts ticked in the Publish block, and the quick share of the clip's platform
  useEffect(
    () =>
      registerDesktopPublishTargets(
        {
          accounts: t("libTargetAccounts"),
          share: (platform) => t("libTargetShare", { platform: PLATFORM_NAMES[platform] }),
          noAccounts: t("libPublishNoAccounts"),
          someFailed: (failed, total) => t("libPublishSomeFailed", { failed, total }),
          busy: t("libPublishBusy"),
          shared: (platform, copied) => t(copied ? "libShared" : "libSharedNoCopy", { platform: PLATFORM_NAMES[platform] }),
        },
        {
          showPublish: () => document.querySelector("[data-publish]")?.scrollIntoView({ behavior: "smooth", block: "center" }),
          reveal: (item) => void bridge.library.reveal(item.id).catch(() => {}),
          navigator: typeof navigator !== "undefined" ? navigator : null,
          openUrl: (url) => void window.open(url, "_blank"),
          // --- social-postiz --- phase 2: "Post with Postiz" opens the approval card (only while a key is stored)
          postiz: {
            configured: postizConfigured,
            label: t("postizTargetLabel"),
            button: t("postizPostButton"),
            opened: t("postizCardOpened"),
            onOpenPostizCard: (item) => {
              setPostizCard({ item });
              setTimeout(() => document.querySelector("[data-testid=postiz-post-card]")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
            },
          },
        },
      ),
    [bridge, t, postizConfigured],
  );

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
        const clip = { ...seedSource(settings, linkSeed(item.meta.link) ?? item.meta.seed, { kind: "link", link: item.meta.link }), name: item.fileName.replace(/\.[^.]+$/, ""), meta: { title: item.meta.title, platform: item.meta.platform, hook: item.meta.hook, caption: item.meta.caption, hashtags: item.meta.hashtags, link: item.meta.link }, cut: item.meta.queueJobId?.endsWith("-cut") ? null : (item.meta.cut ?? null) /* --- ai-cut --- a master's re-render makes its cut again; a cut file's re-render is the master alone */ };
        const codec = item.encoder?.startsWith("hevc") || item.encoder === "libx265" ? "hevc" : item.encoder?.startsWith("av1") || item.encoder?.includes("av1") ? "av1" : "h264";
        queue.add(expandBatch([clip], { resolutions: [settings.recordingResolution], fps: [resolveFastExportFps(settings.fastExportFps) >= 60 ? 60 : 30] /* the render queue renders 30 or 60 fps; uncap-all lets the page export any rate */, codecs: [codec], presets: [presetForPlatform(item.meta.platform)] }));
        show("queue");
      } catch (err) {
        setNotice(errorText(err));
      }
    },
    [queue, show, t],
  );

  // --- desktop-autorelease --- no restart while a clip renders or encodes (the update then installs when the app quits)
  // --- ai-cut --- a cut in progress counts: its job is done already, but a restart now would lose the cut
  const rendering = queue.state.jobs.some((j) => j.status === "rendering" || j.status === "encoding") || queue.cutting !== null;

  if (!prefs) return null;
  return (
    <section ref={rootRef} className="lg:col-span-3 bg-bg/70 border border-line rounded-xl p-3 sm:p-4 space-y-4 scroll-mt-4" data-desktop-group="" data-desktop-tab={tab} aria-label={t("groupTitle")}>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-base font-extrabold text-ink flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-accent shadow-[0_0_10px_#93d119]" />
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
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${tab === id ? "bg-accent/15 border-accent/70 text-accent" : "bg-surface-1 border-line text-ink-2 hover:text-ink"}`}
            >
              <span className="mr-1">{TAB_ICONS[id]}</span>
              {t(`tab.${id}`)}
              {id === "queue" && (rendering || queue.state.jobs.some((j) => j.status === "queued")) && <span className="ml-1.5 text-xs text-accent-strong">●</span>}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex gap-1.5">
          {(["song", "video", "project"] as const).map((kind) => (
            <button key={kind} type="button" onClick={() => pick(kind)} className="px-2.5 py-1 rounded-lg text-xs bg-surface-1 border border-line text-ink-2 hover:text-ink cursor-pointer">
              {t(`open.${kind}`)}
            </button>
          ))}
        </div>
      </div>
      {/* --- desktop-autorelease --- an update is downloaded: Restart and update / Later (hidden for this version until the next launch) */}
      {update?.state === "ready" && update.version && updateLater !== update.version && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink bg-accent/10 border border-accent-dim/60 rounded-lg px-3 py-2" data-testid="desktop-update-banner" role="status">
          <span className="flex-1">{t("update.ready", { version: update.version, progress: 100 })}</span>
          <button type="button" className={primaryBtn} disabled={rendering} onClick={() => void bridge.update.install()} data-testid="desktop-update-restart">
            {t("appRestartUpdate")}
          </button>
          <button type="button" className={ghostBtn} onClick={() => setUpdateLater(update.version)} data-testid="desktop-update-later">
            {t("updateLater")}
          </button>
          {rendering && <span className="basis-full text-ink-3">{t("updateWaitRender")}</span>}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 text-xs text-ink-2 bg-surface-1 border border-line rounded-lg px-3 py-2" data-testid="desktop-notice">
          <span className="flex-1">{notice}</span>
          <button type="button" className="text-ink-3 hover:text-ink-2 cursor-pointer" onClick={() => setNotice(null)} aria-label={t("dismiss")}>
            <IconClose size={14} />
          </button>
        </div>
      )}
      {/* --- social-postiz --- the approval card, above whatever tab is open (it stays while the user looks at the Library or the Posts tab) */}
      {postizCard && <PostizPostCard key={`${postizCard.item.id}:${postizCard.prefill?.queueItemId ?? (postizCard.prefill ? "retry" : "new")}`} bridge={bridge} item={postizCard.item} prefill={postizCard.prefill} onClose={() => setPostizCard(null)} />}
      {tab === "gpu" && <GpuPanel bridge={bridge} prefs={prefs} info={info} update={update} onPrefs={changePrefs} />}
      {tab === "queue" && <QueuePanel bridge={bridge} queue={queue} page={page} folder={prefs.outputFolder} onFolder={(outputFolder) => changePrefs({ outputFolder })} />}
      {tab === "ai" && <AiPanel ai={ai} custom={custom} prefs={prefs} page={page} onQueueTab={() => show("queue")} bridge={bridge} /* --- desktop-ai-fix --- (the AI status panel) */ />}
      {tab === "library" && <LibraryPanel bridge={bridge} items={library} onRefresh={refreshLibrary} onRerender={(item) => void rerender(item)} onSuggestCut={ai.status?.ready ? suggestLibraryCut : undefined /* --- ai-cut --- */} />}
      {tab === "accounts" && <AccountsPanel bridge={bridge} /* --- social-postiz --- */ />}
      {tab === "posts" && (
        <PostsPanel
          bridge={bridge}
          onRetry={(item, prefill) => setPostizCard({ item, prefill })}
          onAccounts={() => show("accounts")}
          /* --- social-postiz --- phase 2 */
          autopilot={autopilot}
          onReview={(item, prefill) => {
            setPostizCard({ item, prefill });
            setTimeout(() => document.querySelector("[data-testid=postiz-post-card]")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
          }}
          /* --- social-autopilot --- phases 3–4: the Proposed group and the Autopilot card */
        />
      )}
    </section>
  );
}
