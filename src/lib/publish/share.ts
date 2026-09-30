import { UPLOAD_PAGES, type PublishPlatform } from "./platforms";

/*
 * --- social-publish --- Path C, the quick share that needs no set-up. On a phone the Web Share API hands the video file
 * itself to the system share sheet, which lists the installed TikTok, Instagram and YouTube apps (the caption goes to the
 * clipboard first, since most apps drop the shared text). On a desktop – no app to share to – the clip downloads, the
 * caption and hashtags go to the clipboard and the platform's upload page opens in a new tab. Everything the browser gives
 * is injected, so the tests run it with a fake navigator and document.
 */

export interface ShareNavigator {
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean } | null;
  canShare?: (data: { files?: File[]; text?: string; title?: string }) => boolean;
  share?: (data: { files?: File[]; text?: string; title?: string }) => Promise<void>;
  clipboard?: { writeText?: (text: string) => Promise<void> } | null;
}

export interface ShareEnv {
  navigator?: ShareNavigator | null;
  document?: Pick<Document, "createElement" | "body"> | null;
  open?: ((url: string, target?: string) => unknown) | null;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

/** A phone or tablet (the share sheet lists apps there): the UA-CH mobile flag, a mobile UA or an iPad posing as a Mac. */
export function isPhoneLike(nav: ShareNavigator | null | undefined): boolean {
  if (!nav) return false;
  if (nav.userAgentData && typeof nav.userAgentData.mobile === "boolean" && nav.userAgentData.mobile) return true;
  const ua = nav.userAgent ?? "";
  if (/Android|iPhone|iPad|iPod|Mobile|Mobi/i.test(ua)) return true;
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

/** The browser can share this file through the system sheet. */
export function canShareFile(nav: ShareNavigator | null | undefined, file: File): boolean {
  if (!nav || typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** Copies text to the clipboard; false when the browser refuses. */
export async function copyText(nav: ShareNavigator | null | undefined, text: string): Promise<boolean> {
  try {
    if (!nav?.clipboard?.writeText) return false;
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Downloads a blob under a file name (a temporary link). */
export function downloadBlob(env: ShareEnv, blob: Blob, fileName: string): boolean {
  const doc = env.document;
  const create = env.createObjectURL ?? (typeof URL !== "undefined" && URL.createObjectURL ? (b: Blob) => URL.createObjectURL(b) : null);
  if (!doc || !create) return false;
  const url = create(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  const revoke = env.revokeObjectURL ?? (typeof URL !== "undefined" && URL.revokeObjectURL ? (u: string) => URL.revokeObjectURL(u) : null);
  if (revoke) setTimeout(() => revoke(url), 10000);
  return true;
}

export type QuickShareResult =
  | { method: "share"; outcome: "shared" | "cancelled" | "failed"; copied: boolean; error?: string }
  | { method: "desktop"; copied: boolean; downloaded: boolean; opened: boolean; url: string };

export interface QuickShareInput {
  platform: PublishPlatform;
  file: File;
  /** The caption with its hashtags (YouTube: title, blank line, description). */
  text: string;
  title?: string;
  env: ShareEnv;
  /** Use the share sheet on any device that can share the file (default: phones and tablets only). */
  preferShare?: boolean;
}

/** Shares a clip to a platform: the share sheet on a phone, else download + clipboard + the upload page. */
export async function quickShare(input: QuickShareInput): Promise<QuickShareResult> {
  const nav = input.env.navigator ?? null;
  if ((input.preferShare || isPhoneLike(nav)) && canShareFile(nav, input.file)) {
    // The clipboard first (most apps drop shared text); not awaited, so the share keeps the click's user activation.
    const copying = copyText(nav, input.text);
    try {
      await nav!.share!({ files: [input.file], title: input.title || undefined, text: input.text || undefined });
      return { method: "share", outcome: "shared", copied: await copying };
    } catch (err) {
      const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
      if (name === "AbortError") return { method: "share", outcome: "cancelled", copied: await copying };
      return { method: "share", outcome: "failed", copied: await copying, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const url = UPLOAD_PAGES[input.platform];
  // The clipboard first, while this page still has the focus (the new tab takes it), then the tab – still within the click's
  // user activation, for pop-up blockers – and the download.
  const copying = copyText(nav, input.text);
  let opened = false;
  try {
    // Not "noopener" in the features (open() then returns null even when the tab opened): the opener is cut by hand.
    const tab = input.env.open?.(url, "_blank") as { opener?: unknown } | null | undefined;
    opened = !!tab;
    if (tab) {
      try {
        tab.opener = null;
      } catch {
        /* cross-origin already */
      }
    }
  } catch {
    opened = false;
  }
  const downloaded = downloadBlob(input.env, input.file, input.file.name);
  const copied = await copying;
  return { method: "desktop", copied, downloaded, opened, url };
}

/** The text the quick share copies for a platform: YouTube's title over its description, else the caption. */
export function shareText(platform: PublishPlatform, post: { title: string; text: string }): string {
  return platform === "youtube" && post.title ? `${post.title}\n\n${post.text}` : post.text;
}
