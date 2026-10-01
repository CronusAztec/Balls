import type { LibraryItem } from "@/lib/desktop/contract";
import { registerPublishTarget, type PublishClip as LibraryClip } from "@/lib/desktop/publish";
import { emptyDraft, type PublishDraft } from "./caption";
import { offerPublishClip } from "./clips";
import { getPublishController, sendPlan, type PublishController } from "./controller";
import { PUBLISH_PLATFORMS, type PublishPlatform } from "./platforms";
import type { ShareEnv, ShareNavigator } from "./share";

/*
 * --- desktop-exe --- The Publish feature's paths as one-click targets of the Windows app's Library (the extension point in
 * lib/desktop/publish.ts), registered by the Desktop group while it is shown:
 *
 *  - "Publish to your accounts": the Library clip joins the Publish block's clips with its post copy (title, caption,
 *    hashtags) as the draft, and goes to every account ticked there – the relay's TikTok, Instagram and YouTube accounts –
 *    in one click (`sendSelected()`), with the block's own limits, visibility and per-account results. With nothing ticked
 *    the clip waits in the block and the Library says where to tick accounts.
 *  - "Publish to TikTok / Instagram / YouTube (quick share)": the quick share without set-up, for the platform the clip was
 *    rendered for – the caption goes to the clipboard and the platform's upload page opens in the browser; the file is
 *    already in the output folder, which opens next to it (no second download).
 *
 * The AI studio's "Copy for Publish" results go into the draft of the clip on show in the block (`applyCopyToPublish()`).
 * Direct YouTube sign-in (Google Identity Services) needs a web origin Google accepts, which app:// is not: inside the app
 * the Publish block offers YouTube through the relay and the quick share.
 */

/** The Publish platform of a clip's platform preset (the queue's tiktok / reels / shorts; anything else: TikTok). */
export function publishPlatformOf(preset: string | null | undefined): PublishPlatform {
  if (preset === "reels" || preset === "instagram") return "instagram";
  if (preset === "shorts" || preset === "youtube") return "youtube";
  return "tiktok";
}

/** The Publish draft of a Library clip: its title, caption and hashtags shared by every platform. */
export function draftOfLibraryClip(clip: Pick<LibraryClip, "title" | "caption" | "hashtags">): PublishDraft {
  return { ...emptyDraft(), title: clip.title.trim(), caption: clip.caption.trim(), hashtags: clip.hashtags.filter(Boolean).join(" ") };
}

/** The Publish clip each Library item became (by the item's id), so a second click does not add the file again. */
const stagedClips = new Map<string, string>();

/**
 * Puts a Library clip into the Publish block – the clip on show, with its post copy as its draft – and returns its id. A
 * Library item already there (a second click, a share after a send) is shown again as it is: its draft keeps what was
 * written into it meanwhile (an edit in the block, the AI's "Use in Publish").
 */
export function stageLibraryClip(controller: PublishController, clip: LibraryClip): string {
  controller.start();
  const staged = stagedClips.get(clip.item.id);
  if (staged && controller.getSnapshot().clips.some((c) => c.id === staged)) {
    controller.selectClip(staged);
    if (!controller.getSnapshot().drafts[staged]) controller.setDraft(staged, draftOfLibraryClip(clip));
    return staged;
  }
  const offered = offerPublishClip({ blob: clip.file, name: clip.file.name, source: "file", durationSec: clip.item.durationSec, mode: clip.item.meta.mode || null, seed: Number.isFinite(clip.item.meta.seed) ? clip.item.meta.seed : null });
  stagedClips.set(clip.item.id, offered.id);
  controller.selectClip(offered.id);
  controller.setDraft(offered.id, draftOfLibraryClip(clip));
  return offered.id;
}

export interface DesktopPublishLabels {
  /** The "publish" target's destination ("your accounts"). */
  accounts: string;
  /** A quick-share target's destination ("TikTok (quick share)"). */
  share: (platform: PublishPlatform) => string;
  /** Nothing ticked in the Publish block: where to go. */
  noAccounts: string;
  /** Some accounts failed or wait for a sign-in. */
  someFailed: (failed: number, total: number) => string;
  /** The quick share opened the upload page (and copied the caption, or not). */
  shared: (platform: PublishPlatform, copied: boolean) => string;
}

export interface DesktopPublishOptions {
  controller?: PublishController;
  /** Shows the Publish block (the clip is waiting there). */
  showPublish?: () => void;
  /** Opens the output folder at the clip (the quick share's file). */
  reveal?: (item: LibraryItem) => void;
  /** The page's navigator (clipboard) and how a web page opens (the app sends it to the browser). */
  navigator?: ShareNavigator | null;
  openUrl?: (url: string) => void;
}

/** One click: the clip to every account ticked in the Publish block; the first published post's link, or why not. */
export async function publishToAccounts(controller: PublishController, clip: LibraryClip, labels: DesktopPublishLabels, options: DesktopPublishOptions = {}): Promise<{ url?: string; message?: string }> {
  stageLibraryClip(controller, clip);
  const plan = sendPlan(controller.getSnapshot(), Date.now());
  const ready = plan.targets.filter((t) => !plan.blocked.includes(t.platform) && !plan.publicOnly.includes(t.platform));
  if (ready.length === 0) {
    options.showPublish?.();
    throw new Error(labels.noAccounts);
  }
  await controller.sendSelected();
  const sends = controller.getSnapshot().sends;
  const failed = sends.filter((i) => i.status === "failed" || i.status === "needsAuth");
  if (failed.length > 0) {
    options.showPublish?.();
    throw new Error(labels.someFailed(failed.length, sends.length));
  }
  const link = sends.find((i) => i.link)?.link ?? undefined;
  return link ? { url: link } : {};
}

/** The quick share of a Library clip to `platform`: caption to the clipboard, the upload page in the browser, the file shown in its folder. */
export async function shareLibraryClip(controller: PublishController, clip: LibraryClip, platform: PublishPlatform, labels: DesktopPublishLabels, options: DesktopPublishOptions = {}): Promise<{ message: string }> {
  stageLibraryClip(controller, clip);
  const env: ShareEnv = {
    // A computer: no share sheet (the desktop path), and no download – the clip is a file in the output folder already.
    navigator: options.navigator ? { clipboard: options.navigator.clipboard ?? null, userAgent: "", maxTouchPoints: 0 } : null,
    document: null,
    open: (url) => {
      options.openUrl?.(url);
      return options.openUrl ? { opener: null } : null;
    },
  };
  await controller.quickShare(platform, env);
  options.reveal?.(clip.item);
  return { message: labels.shared(platform, controller.getSnapshot().share?.copied === true) };
}

/** Registers the Library's Publish targets; returns their unregistration. */
export function registerDesktopPublishTargets(labels: DesktopPublishLabels, options: DesktopPublishOptions = {}): () => void {
  const controller = options.controller ?? getPublishController();
  const offs = [
    registerPublishTarget({ id: "publish", label: labels.accounts, publish: (clip) => publishToAccounts(controller, clip, labels, options) }),
    ...PUBLISH_PLATFORMS.map((platform) =>
      registerPublishTarget({
        id: `share-${platform}`,
        label: labels.share(platform),
        available: (item) => publishPlatformOf(item.meta.platform) === platform,
        publish: (clip) => shareLibraryClip(controller, clip, platform, labels, options),
      }),
    ),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** A post the AI studio wrote for one platform preset (its "Copy for Publish" result). */
export interface AiPostCopy {
  platform: string;
  title: string;
  caption: string;
  hashtags: string[];
}

/**
 * Writes the AI's posts into the draft of the clip on show in the Publish block – each as that platform's own words (the
 * first one also as the shared words) – so a send or a quick share uses them. False when the block has no clip yet.
 */
export function applyCopyToPublish(items: readonly AiPostCopy[], controller: PublishController = getPublishController()): boolean {
  controller.start();
  const s = controller.getSnapshot();
  const clipId = s.clipId;
  if (!clipId || items.length === 0) return false;
  const draft: PublishDraft = { ...(s.drafts[clipId] ?? emptyDraft()), overrides: { ...(s.drafts[clipId]?.overrides ?? {}) } };
  const first = items[0];
  draft.title = first.title;
  draft.caption = first.caption;
  draft.hashtags = first.hashtags.join(" ");
  for (const item of items) draft.overrides[publishPlatformOf(item.platform)] = { title: item.title, caption: item.caption, hashtags: item.hashtags.join(" ") };
  controller.setDraft(clipId, draft);
  return true;
}
