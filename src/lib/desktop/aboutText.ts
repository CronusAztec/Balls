/*
 * --- build-identity --- The Windows app's "which build is this" text, as plain lines: Help > About shows it (desktop/src/main.ts, in
 * the menu language), its "Copy details" button and Settings > App > "Copy details" put the same lines on the clipboard (always
 * in English, so a support message reads the same whatever language the app runs in). Pure (no Electron, no DOM): the page and
 * the main process share it, desktop/tests/about.test.ts pins the format.
 */

export type InstallKind = "installer" | "portable" | "development";
export type UpdatesMode = "auto" | "onRequest" | "off" | "manual";

export interface AboutFacts {
  name: string;
  /** The installed app's version (app.getVersion()). */
  version: string;
  install: InstallKind;
  arch: string;
  safeMode: boolean;
  /** The website build inside the app, as src/lib/buildInfo.ts labels it ("v1.10.0 · 8fa8dbb · 2026-10-14"); null: not known. */
  siteLabel: string | null;
  electron: string;
  chrome: string;
  node?: string;
  updates: UpdatesMode;
  dataDir: string;
  logFile: string;
}

/** The words of the text. The English set is the clipboard's; the menu languages come from desktop/src/menu.ts. */
export interface AboutLabels {
  app: string;
  site: string;
  installer: string;
  portable: string;
  development: string;
  safeMode: string;
  updates: string;
  updatesAuto: string;
  updatesOnRequest: string;
  updatesOff: string;
  updatesManual: string;
  data: string;
  log: string;
}

export const ABOUT_LABELS_EN: AboutLabels = {
  app: "App",
  site: "Website build",
  installer: "installer",
  portable: "portable",
  development: "development run",
  safeMode: "safe mode",
  updates: "Updates",
  updatesAuto: "automatic",
  updatesOnRequest: "when you check",
  updatesOff: "off",
  updatesManual: "download new versions from the website",
  data: "Data",
  log: "Log",
};

const SEP = " \u00b7 ";

/** How the app was installed: portable EXE, installed (packaged) app, or a checkout run (`electron .`). */
export function installKind({ packaged, portable }: { packaged: boolean; portable: boolean }): InstallKind {
  return portable ? "portable" : packaged ? "installer" : "development";
}

/**
 * How the app gets new versions: the portable EXE never updates itself. --- manual-update --- The installed app updates itself
 * on its own while "Update automatically" is on, and with it off still finds, downloads and installs one when the user checks
 * (the top bar's button, Help > Check for updates, the GPU tab). A development run never updates.
 */
export function updatesMode({ packaged, portable, autoUpdate }: { packaged: boolean; portable: boolean; autoUpdate: boolean }): UpdatesMode {
  if (portable) return "manual";
  if (!packaged) return "off";
  return autoUpdate ? "auto" : "onRequest";
}

/** "C:\Users\anna\AppData\Roaming\JumpingBallsLive" -> "C:\Users\~\AppData\Roaming\JumpingBallsLive": a pasted report names no person. */
export function withoutUserName(text: string): string {
  return text.replace(/^([A-Za-z]:[\\/]Users[\\/])[^\\/]+/i, "$1~").replace(/^(\/(?:home|Users)\/)[^/]+/, "$1~");
}

/** The lines under the title. */
export function aboutLines(f: AboutFacts, labels: AboutLabels = ABOUT_LABELS_EN, { redact = false }: { redact?: boolean } = {}): string[] {
  const hide = redact ? withoutUserName : (s: string) => s;
  const kind = f.install === "portable" ? labels.portable : f.install === "installer" ? labels.installer : labels.development;
  const updates = f.updates === "auto" ? labels.updatesAuto : f.updates === "onRequest" ? labels.updatesOnRequest : f.updates === "manual" ? labels.updatesManual : labels.updatesOff;
  return [
    `${labels.app}: ${[f.version, kind, f.arch, ...(f.safeMode ? [labels.safeMode] : [])].join(SEP)}`,
    ...(f.siteLabel ? [`${labels.site}: ${f.siteLabel}`] : []),
    [`Electron ${f.electron}`, `Chromium ${f.chrome}`, ...(f.node ? [`Node ${f.node}`] : [])].join(SEP),
    `${labels.updates}: ${updates}`,
    `${labels.data}: ${hide(f.dataDir)}`,
    `${labels.log}: ${hide(f.logFile)}`,
  ];
}

/** The whole text: the name and version, then the lines (what "Copy details" copies; `redact` hides the Windows user name). */
export function aboutText(f: AboutFacts, labels: AboutLabels = ABOUT_LABELS_EN, options: { redact?: boolean } = {}): string {
  return [`${f.name} ${f.version}`, ...aboutLines(f, labels, options)].join("\n");
}
