import path from "path";

/*
 * --- desktop-exe --- Where the app finds its files. Packaged, the site's export and the playbook sit in the app's
 * resources (electron-builder extraResources); from a checkout (`electron .` in desktop/) they are the repository's own
 * out/ and docs/. The data folder is Electron's userData (%APPDATA%\JumpingBallsLive on Windows) – next to the EXE for the
 * portable build, so a USB stick carries its models and library with it.
 */

export interface AppLocations {
  /** The site's static export (index.html of every page, _next/static…). */
  siteRoot: string;
  playbook: string;
  /** Models, library index, render journal, thumbnails, logs. */
  dataDir: string;
  modelsDir: string;
  thumbsDir: string;
  logsDir: string;
  journalFile: string;
  libraryFile: string;
}

export function appLocations(options: { packaged: boolean; resourcesPath: string; appPath: string; userData: string; portableDir?: string | null }): AppLocations {
  const siteRoot = options.packaged ? path.join(options.resourcesPath, "site") : path.resolve(options.appPath, "..", "out");
  const playbook = options.packaged ? path.join(options.resourcesPath, "playbook", "virality-playbook.md") : path.resolve(options.appPath, "..", "docs", "virality-playbook.md");
  const dataDir = options.portableDir ? path.join(options.portableDir, "JumpingBallsLive-data") : options.userData;
  return {
    siteRoot,
    playbook,
    dataDir,
    modelsDir: path.join(dataDir, "models"),
    thumbsDir: path.join(dataDir, "thumbnails"),
    logsDir: path.join(dataDir, "logs"),
    journalFile: path.join(dataDir, "render-journal.json"),
    libraryFile: path.join(dataDir, "library.json"),
  };
}
