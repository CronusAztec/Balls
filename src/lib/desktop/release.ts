/*
 * --- desktop-exe --- Where the Windows app is downloaded from: the GitHub Releases of the repository. The desktop workflow
 * (.github/workflows/desktop.yml) uploads the installer and the portable EXE twice – with the version in the name
 * (JumpingBallsLive-Setup-<version>.exe, what electron-updater's latest.yml points at) and under fixed names, so
 * …/releases/latest/download/<fixed name> always serves the newest version and the site never needs rebuilding for a
 * release.
 */

export const DESKTOP_REPO = (process.env.NEXT_PUBLIC_GITHUB_REPO || "CronusAztec/Balls").replace(/^\/+|\/+$/g, "");
export const RELEASES_URL = `https://github.com/${DESKTOP_REPO}/releases`;
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;

/** The fixed names of the latest assets. */
export const SETUP_ASSET = "JumpingBallsLive-Setup.exe";
export const PORTABLE_ASSET = "JumpingBallsLive-portable.exe";

export function latestAssetUrl(name: string): string {
  return `${LATEST_RELEASE_URL}/download/${name}`;
}

/** The versioned names electron-builder gives the artifacts (desktop/electron-builder.config.cjs). */
export function versionedAssetNames(version: string): { setup: string; portable: string } {
  return { setup: `JumpingBallsLive-Setup-${version}.exe`, portable: `JumpingBallsLive-${version}-portable.exe` };
}

/**
 * --- desktop-ai-fix --- The Windows app's current version, shown on the download page. It must equal desktop/package.json's
 * (tests/desktopAiFix.test.ts checks it, and its lock file's), so a release bumps both.
 */
export const DESKTOP_VERSION = "1.0.3";
