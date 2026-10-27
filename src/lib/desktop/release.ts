/*
 * --- desktop-exe --- Where the Windows app is downloaded from: the Releases of a second, public GitHub repository that holds
 * the installers and nothing else (https://github.com/CronusAztec/jumpingballslive-windows – no source code), so the source
 * repository can be private. The desktop workflow (.github/workflows/desktop.yml, scripts/release/publish-downloads.mjs)
 * publishes every release there: the installer and the portable EXE twice – with the version in the name
 * (JumpingBallsLive-Setup-<version>.exe, what electron-updater's latest.yml points at) and under fixed names, so the download
 * links never change – and latest.yml, the feed every installed app reads (desktop/electron-builder.config.cjs).
 * ".../releases/latest/download/<name>" always names the file of the newest release. NEXT_PUBLIC_DOWNLOADS_URL (the repository
 * variable DOWNLOADS_URL) points the site at another host.
 */

/** The public repository that holds the installers (owner/name). */
export const DOWNLOADS_REPO = "CronusAztec/jumpingballslive-windows";
export const DOWNLOADS_URL = (process.env.NEXT_PUBLIC_DOWNLOADS_URL || `https://github.com/${DOWNLOADS_REPO}/releases/latest/download`).replace(/\/+$/, "");

/** The fixed names of the latest assets. */
export const SETUP_ASSET = "JumpingBallsLive-Setup.exe";
export const PORTABLE_ASSET = "JumpingBallsLive-portable.exe";

export function latestAssetUrl(name: string): string {
  return `${DOWNLOADS_URL}/${name}`;
}

/** The versioned names electron-builder gives the artifacts (desktop/electron-builder.config.cjs). */
export function versionedAssetNames(version: string): { setup: string; portable: string } {
  return { setup: `JumpingBallsLive-Setup-${version}.exe`, portable: `JumpingBallsLive-${version}-portable.exe` };
}

/**
 * --- desktop-ai-fix --- The Windows app's current version, shown on the download page. It must equal desktop/package.json's
 * (tests/desktopAiFix.test.ts checks it, and its lock file's), so a release bumps both: `npm run release:desktop` writes this
 * line, and the push that carries it also deploys the site, so the page names the version the downloads serve.
 */
export const DESKTOP_VERSION = "1.6.0";
