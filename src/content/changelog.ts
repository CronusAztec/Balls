import data from "./changelog.json";
import { SITE_NAME } from "@/lib/site";
import type { Locale } from "@/i18n/routing";
import type { ModeId } from "@/lib/physics/types";
import { appReleaseId, releaseId, siteReleaseId, type ChangeProduct } from "./changelogId";

/*
 * --- changelog --- What changed, newest first: the /changelog page, CHANGELOG.md (scripts/changelog.mjs), the release notes of
 * the Windows app's GitHub releases and the app's "What's new" notice all read this one file (JSON, so a Node script can read
 * it too). A release is one product at one version: the website ("site", versions of the root package.json) or the Windows
 * app ("app", versions of desktop/package.json), with a date, a short headline and items tagged New, Improved or Fixed. Text
 * is written in every language (LocalizedText, like the gallery's) as plain text: the only placeholder is {siteName}. `id` is
 * the page anchor and a CSS-safe slug: "<product>-<version with dashes>", e.g. "app-1-3-0". The newest "app" release must be
 * DESKTOP_VERSION and the newest "site" release the package.json version: tests/changelog.test.ts checks the shape, the
 * order, every language and those two; tests/copyStyle.test.ts holds the text to docs/COPY-STYLE.md.
 * --- site-nav --- An item that announces modes names them in `modes` (their ids, in the order its sentence does): the
 * page then offers "Try it" links that open each one in the studio. CHANGELOG.md and the release notes do not read it.
 */

export { appReleaseId, releaseId, siteReleaseId };
export type { ChangeProduct };

export const CHANGE_KINDS = ["new", "improved", "fixed"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export const CHANGE_PRODUCTS = ["site", "app"] as const;
export type LocalizedText = Record<Locale, string>;

export interface ChangeItem {
  kind: ChangeKind;
  text: LocalizedText;
  /** --- site-nav --- The modes this item announces, each named in its English text: the page links them to the studio. */
  modes?: readonly ModeId[];
}

export interface ChangelogRelease {
  id: string;
  product: ChangeProduct;
  /** x.y.z: the website's (root package.json) or the Windows app's (desktop/package.json). */
  version: string;
  /** YYYY-MM-DD, UTC. */
  date: string;
  /** One short line (at most 60 characters) that says what the release is about. */
  headline: LocalizedText;
  items: readonly ChangeItem[];
}

export const CHANGELOG: readonly ChangelogRelease[] = data.releases as unknown as readonly ChangelogRelease[];

/** The newest release of a product. */
export function latestRelease(product: ChangeProduct): ChangelogRelease | undefined {
  return CHANGELOG.find((r) => r.product === product);
}

/** The text of an entry with its {siteName} placeholder filled in (the only placeholder; everything else is plain text). */
export function entryText(text: string): string {
  return text.replaceAll("{siteName}", SITE_NAME);
}

const DATE_LOCALES: Record<string, string> = { en: "en-GB", pl: "pl-PL", es: "es-ES" };

/** "2026-10-13" as a long date in the page's language (en-GB: the house spelling), always the UTC day. */
export function formatChangelogDate(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(DATE_LOCALES[locale] ?? "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
}
