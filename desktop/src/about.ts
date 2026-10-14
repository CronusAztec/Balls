import fs from "fs";
import path from "path";
import type { SiteStamp } from "@/lib/desktop/contract";
import { formatBuildLabel } from "@/lib/buildInfo";
import type { AboutLabels } from "@/lib/desktop/aboutText";

/*
 * --- build-identity --- Which build is this EXE? Pure helpers for the main process (desktop/tests/about.test.ts): the window title,
 * the website build inside the app (read from the export's version.json), the buttons of Help > About, the Help > What's new
 * address and the --smoke run's identity check. The text of About and "Copy details" itself is src/lib/desktop/aboutText.ts, which
 * the page shares.
 */

export const APP_TITLE = "JumpingBallsLive";

/** The words that follow the version in the window title ("JumpingBallsLive 1.3.0 · portable"). */
export interface TitleWords {
  portable: string;
  safeMode: string;
}

/**
 * The window's title: the app and its version, so a screenshot or the taskbar says which build it is. Replaces the page's own
 * <title> (main.ts keeps it with `page-title-updated`). "JumpingBallsLive 1.3.0", "… · portable", "… · safe mode".
 */
export function windowTitle({ version, portable, safeMode }: { version: string; portable: boolean; safeMode: boolean }, words: TitleWords = { portable: "portable", safeMode: "safe mode" }): string {
  return [`${APP_TITLE} ${version}`, ...(portable ? [words.portable] : []), ...(safeMode ? [words.safeMode] : [])].join(" · ");
}

/** The tray tooltip: the app's name and version. */
export function trayTip(name: string, version: string): string {
  return `${name} ${version}`;
}

const SHA = /^[0-9a-f]{40}$/;
const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** The parts of a parsed version.json the app uses, or null when it is not one (wrong schema, missing or malformed fields). */
export function siteStampFrom(raw: unknown): SiteStamp | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.schema !== 1 || !isString(o.siteVersion) || !isString(o.build)) return null;
  const commit = typeof o.commit === "string" && SHA.test(o.commit) ? o.commit : null;
  return {
    siteVersion: o.siteVersion,
    build: o.build,
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    commitDate: isString(o.commitDate) ? o.commitDate : null,
    desktopVersion: isString(o.desktopVersion) ? o.desktopVersion : null,
  };
}

/** `<siteRoot>/version.json` of the site export bundled in the app; null when it is missing or unreadable (never throws). */
export function readSiteStamp(siteRoot: string, read: (file: string) => string = (file) => fs.readFileSync(file, "utf8")): SiteStamp | null {
  try {
    return siteStampFrom(JSON.parse(read(path.join(siteRoot, "version.json"))));
  } catch {
    return null;
  }
}

/** "v1.10.0 · 8fa8dbb · 2026-10-14" – the same label the website's footer shows; null without a stamp. */
export function siteLabel(stamp: SiteStamp | null): string | null {
  return stamp ? formatBuildLabel(stamp.siteVersion, stamp.commit, stamp.commitDate) : null;
}

/** The MENU_LABELS entries Help > About's text needs, as an AboutLabels (menu.ts keys `about…`). */
export function aboutLabelsOf(l: Record<string, string>): AboutLabels {
  return {
    app: l.aboutApp,
    site: l.aboutSite,
    installer: l.aboutInstaller,
    portable: l.aboutPortable,
    development: l.aboutDevRun,
    safeMode: l.aboutSafeMode,
    updates: l.aboutUpdates,
    updatesAuto: l.aboutUpdatesAuto,
    updatesOff: l.aboutUpdatesOff,
    updatesManual: l.aboutUpdatesManual,
    data: l.aboutData,
    log: l.aboutLog,
  };
}

export type AboutAnswer = "copy" | "whats-new" | "close";

/** The About dialog's buttons, in order: Copy details (reads "Copied" after a copy), What's new, Close. */
export function aboutButtons(l: Record<string, string>, copied: boolean): string[] {
  return [copied ? l.aboutCopied : l.aboutCopy, l.whatsNew, l.aboutClose];
}

/** What a button of the About dialog does (anything but the first two closes it). */
export function aboutAnswer(response: number): AboutAnswer {
  return response === 0 ? "copy" : response === 1 ? "whats-new" : "close";
}

/** Help > What's new: the changelog page of the public site in the menu's language. */
export function changelogUrl(siteUrl: string, language: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/${language}/changelog/`;
}

/**
 * The --smoke run's identity check. A packaged run fails when the bundled site has no readable version.json (the pipeline must
 * never ship an EXE whose website build cannot be told); a version.json built for another app version is only noted (a manual
 * dispatch with a custom version legitimately differs).
 */
export function smokeIdentity({ packaged, stamp, appVersion }: { packaged: boolean; stamp: SiteStamp | null; appVersion: string }): { ok: boolean; note: string | null } {
  if (!stamp) return packaged ? { ok: false, note: "the bundled site has no readable version.json" } : { ok: true, note: "no version.json in the site export (a checkout run)" };
  if (stamp.desktopVersion && stamp.desktopVersion !== appVersion) return { ok: true, note: `version.json was built for app ${stamp.desktopVersion}, the app is ${appVersion}` };
  return { ok: true, note: null };
}
