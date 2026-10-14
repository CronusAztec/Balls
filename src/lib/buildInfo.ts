/**
 * --- build-identity --- Which build is this page? The release version, the commit and the commit date of the build that produced
 * it, inlined at build time (next.config.ts sets NEXT_PUBLIC_BUILD_* from scripts/lib/build-info.cjs, which formats the same
 * strings: tests/buildInfo.test.ts compares the two). Literal `process.env.X` reads only – Next inlines nothing else – with
 * fallbacks for vitest, where nothing is inlined. The date is the ISO day (no toLocale*): the footer is prerendered, a
 * locale-dependent date would not match the hydrated page. This is the build the page was LOADED from; /version.json is what is live.
 */
export const BUILD_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION || "0.0.0-dev";
/** The full 40-character commit ("" when the build could not read git). */
export const BUILD_COMMIT = process.env.NEXT_PUBLIC_BUILD_COMMIT || "";
/** The commit's date in UTC, "2026-10-14T01:57:35Z" ("" when unknown). */
export const BUILD_COMMIT_DATE = process.env.NEXT_PUBLIC_BUILD_COMMIT_DATE || "";
export const BUILD_SHORT = BUILD_COMMIT.slice(0, 7);
export const BUILD_DAY = BUILD_COMMIT_DATE.slice(0, 10);

const SEP = " · ";

/** `v1.10.0 · 8fa8dbb · 2026-10-14`, `v1.10.0 · 8fa8dbb` without a date, `v1.10.0 · dev` without a commit. */
export function formatBuildLabel(version: string, commit: string | null | undefined, commitDate?: string | null): string {
  if (!commit) return `v${version}${SEP}dev`;
  return [`v${version}`, commit.slice(0, 7), commitDate ? commitDate.slice(0, 10) : ""].filter(Boolean).join(SEP);
}

/** `1.10.0+8fa8dbb` (semver build metadata), `1.10.0+dev` without a commit. */
export function formatBuildId(version: string, commit: string | null | undefined): string {
  return `${version}+${commit ? commit.slice(0, 7) : "dev"}`;
}

/** The footer's stamp and the Windows app's "Website build" row. */
export const buildLabel = (): string => formatBuildLabel(BUILD_VERSION, BUILD_COMMIT, BUILD_COMMIT_DATE);

/** The compact id (the `jbl-build` meta tag and the X-Build header carry the same string). */
export const buildId = (): string => formatBuildId(BUILD_VERSION, BUILD_COMMIT);
