/*
 * --- desktop-exe --- Where the Windows app is downloaded from: the downloads host, https://downloads.jumpingballslive.com, a
 * Cloudflare R2 bucket that the desktop workflow (.github/workflows/desktop.yml, scripts/release/publish-downloads.mjs) fills on
 * every release. It holds the installer and the portable EXE twice – with the version in the name
 * (JumpingBallsLive-Setup-<version>.exe, what electron-updater's latest.yml points at) and under fixed names, so the download
 * links never change – and latest.yml, the feed every installed app reads (desktop/electron-builder.config.cjs). GitHub plays no
 * part in downloads or updates, so the repository can be private. NEXT_PUBLIC_DOWNLOADS_URL (the repository variable
 * DOWNLOADS_URL) points the site at another host.
 */

export const DOWNLOADS_URL = (process.env.NEXT_PUBLIC_DOWNLOADS_URL || "https://downloads.jumpingballslive.com").replace(/\/+$/, "");

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
export const DESKTOP_VERSION = "1.0.3";
