import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { APP_TITLE, aboutAnswer, aboutButtons, aboutLabelsOf, changelogUrl, readSiteStamp, siteLabel, siteStampFrom, smokeIdentity, trayTip, windowTitle } from "../src/about";
import { MENU, MENU_LABELS } from "../src/menu";
import { ABOUT_LABELS_EN, aboutLines, aboutText, installKind, updatesMode, withoutUserName, type AboutFacts } from "@/lib/desktop/aboutText";
import { createRequire } from "module";

/* --- build-identity --- which build is this EXE: the window title, the website build read from the site's version.json,
   Help > About and its Copy details text, the Help > What's new command and the --smoke run's identity check */

// the website's collector (plain CommonJS, outside this package's type-checked files)
interface BuildInfoLike {
  siteVersion: string;
  commit: string | null;
  commitDate: string | null;
}
const { buildLabel, resolveBuildInfo, writeBuildFiles } = createRequire(import.meta.url)("../../scripts/lib/build-info.cjs") as {
  buildLabel: (info: BuildInfoLike) => string;
  resolveBuildInfo: (options: { root: string; env: Record<string, string>; run: (args: string[]) => string }) => BuildInfoLike;
  writeBuildFiles: (outDir: string, info: BuildInfoLike, options: { siteUrl: string }) => unknown;
};

const tmpDirs: string[] = [];
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "about-"));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const HEAD = "8fa8dbb" + "0123456789abcdef0123456789abcdef0";
const STAMP = { schema: 1, siteVersion: "1.10.0", build: "1.10.0+8fa8dbb", commit: HEAD, commitDate: "2026-10-14T01:57:35Z", desktopVersion: "1.3.0" };

describe("window title and tray tooltip", () => {
  it("names the app and its version, and how it runs", () => {
    expect(APP_TITLE).toBe("JumpingBallsLive");
    expect(windowTitle({ version: "1.3.0", portable: false, safeMode: false })).toBe("JumpingBallsLive 1.3.0");
    expect(windowTitle({ version: "1.3.0", portable: true, safeMode: false })).toBe("JumpingBallsLive 1.3.0 · portable");
    expect(windowTitle({ version: "1.3.0", portable: false, safeMode: true })).toBe("JumpingBallsLive 1.3.0 · safe mode");
    expect(windowTitle({ version: "1.3.0", portable: true, safeMode: true })).toBe("JumpingBallsLive 1.3.0 · portable · safe mode");
    expect(windowTitle({ version: "1.3.0", portable: true, safeMode: false }, { portable: "wersja przenośna", safeMode: "tryb awaryjny" })).toBe("JumpingBallsLive 1.3.0 · wersja przenośna");
    expect(trayTip("JumpingBallsLive", "1.3.0")).toBe("JumpingBallsLive 1.3.0");
  });

  it("is wired into the window, the tray and the log in main.ts", () => {
    const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
    expect(main).toMatch(/\btitle,\s+backgroundColor/); // the constructor's title is the computed one (\s+: a Windows checkout has CRLF line ends)
    expect(main).toContain('win.on("page-title-updated"');
    expect(main).toContain("event.preventDefault()");
    expect(main).toContain("windowTitle({ version: app.getVersion()");
    expect(main).toContain("trayTip(labels.trayTip, app.getVersion())");
    expect(main).toContain("website build");
    expect(main).toContain("portable: portableDir !== null");
  });
});

describe("the website build inside the app (version.json)", () => {
  it("reads the file postexport writes, whatever the commit's date format was", () => {
    const dir = tmpDir();
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.10.0" }));
    fs.mkdirSync(path.join(root, "desktop"));
    fs.writeFileSync(path.join(root, "desktop", "package.json"), JSON.stringify({ version: "1.3.0" }));
    const info = resolveBuildInfo({ root, env: {}, run: (args: string[]) => (args[0] === "rev-parse" ? HEAD : "2026-10-13T18:57:35-07:00") });
    writeBuildFiles(dir, info, { siteUrl: "https://jumpingballslive.com" });
    const stamp = readSiteStamp(dir);
    expect(stamp).toEqual({ siteVersion: "1.10.0", build: "1.10.0+8fa8dbb", commit: HEAD, commitShort: "8fa8dbb", commitDate: "2026-10-14T01:57:35Z", desktopVersion: "1.3.0" });
    // the website's footer and the app's About name the build with the same label
    expect(siteLabel(stamp)).toBe("v1.10.0 · 8fa8dbb · 2026-10-14");
    expect(siteLabel(stamp)).toBe(buildLabel(info));
  });

  it("is null for a missing, unreadable or foreign file (never throws)", () => {
    const dir = tmpDir();
    expect(readSiteStamp(dir)).toBeNull();
    expect(readSiteStamp(path.join(dir, "no-such-folder"))).toBeNull();
    fs.writeFileSync(path.join(dir, "version.json"), "{ not json");
    expect(readSiteStamp(dir)).toBeNull();
    expect(readSiteStamp(dir, () => "[]")).toBeNull();
    expect(
      readSiteStamp(dir, () => {
        throw new Error("EACCES");
      }),
    ).toBeNull();
    expect(siteLabel(null)).toBeNull();
  });

  it("checks the schema and the fields it uses", () => {
    expect(siteStampFrom(STAMP)).toMatchObject({ siteVersion: "1.10.0", commitShort: "8fa8dbb" });
    expect(siteStampFrom({ ...STAMP, schema: 2 })).toBeNull();
    expect(siteStampFrom({ ...STAMP, siteVersion: "" })).toBeNull();
    expect(siteStampFrom({ ...STAMP, build: 3 })).toBeNull();
    expect(siteStampFrom(null)).toBeNull();
    expect(siteStampFrom("x")).toBeNull();
    // a bad commit or date becomes null instead of being shown
    expect(siteStampFrom({ ...STAMP, commit: "8fa8dbb", commitDate: 5, desktopVersion: undefined })).toMatchObject({ commit: null, commitShort: null, commitDate: null, desktopVersion: null });
    expect(siteLabel(siteStampFrom({ ...STAMP, commit: null, commitDate: null }))).toBe("v1.10.0 · dev");
  });
});

describe("the --smoke run's identity check", () => {
  const stamp = siteStampFrom(STAMP);
  it("fails a packaged run without a readable version.json, only notes it in a checkout run", () => {
    expect(smokeIdentity({ packaged: true, stamp: null, appVersion: "1.3.0" })).toMatchObject({ ok: false });
    expect(smokeIdentity({ packaged: false, stamp: null, appVersion: "1.3.0" })).toMatchObject({ ok: true });
  });
  it("passes a matching stamp and only notes a stamp built for another app version", () => {
    expect(smokeIdentity({ packaged: true, stamp, appVersion: "1.3.0" })).toEqual({ ok: true, note: null });
    const other = smokeIdentity({ packaged: true, stamp, appVersion: "9.9.9" });
    expect(other.ok).toBe(true);
    expect(other.note).toContain("1.3.0");
    expect(smokeIdentity({ packaged: true, stamp: siteStampFrom({ ...STAMP, desktopVersion: null }), appVersion: "9.9.9" })).toEqual({ ok: true, note: null });
  });
  it("is wired into the smoke run: siteBuild and appVersion in the result, a failure sets ok to false", () => {
    const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
    const smoke = main.slice(main.indexOf("async function runSmoke()"));
    expect(smoke).toContain("out.siteBuild = siteStamp");
    expect(smoke).toContain("out.appVersion = app.getVersion()");
    expect(smoke).toMatch(/smokeIdentity\(\{ packaged: app\.isPackaged, stamp: siteStamp/);
    expect(smoke).toMatch(/if \(!identity\.ok\) ok = false/);
  });
});

describe("Help > About", () => {
  const facts: AboutFacts = {
    name: "JumpingBallsLive",
    version: "1.3.0",
    install: "installer",
    arch: "x64",
    safeMode: false,
    siteLabel: "v1.10.0 · 8fa8dbb · 2026-10-14",
    electron: "44.5.1",
    chrome: "146.0.1",
    node: "22.12.0",
    updates: "auto",
    dataDir: "C:\\Users\\anna\\AppData\\Roaming\\JumpingBallsLive",
    logFile: "C:\\Users\\anna\\AppData\\Roaming\\JumpingBallsLive\\logs\\main.log",
  };

  it("lists the app, the website build, Electron, updates, the data folder and the log", () => {
    expect(aboutLines(facts)).toEqual([
      "App: 1.3.0 · installer · x64",
      "Website build: v1.10.0 · 8fa8dbb · 2026-10-14",
      "Electron 44.5.1 · Chromium 146.0.1 · Node 22.12.0",
      "Updates: automatic",
      "Data: C:\\Users\\anna\\AppData\\Roaming\\JumpingBallsLive",
      "Log: C:\\Users\\anna\\AppData\\Roaming\\JumpingBallsLive\\logs\\main.log",
    ]);
  });

  it("copies the same lines with the Windows user name hidden", () => {
    const text = aboutText(facts, ABOUT_LABELS_EN, { redact: true });
    expect(text.split("\n")[0]).toBe("JumpingBallsLive 1.3.0");
    expect(text).toContain("Data: C:\\Users\\~\\AppData\\Roaming\\JumpingBallsLive");
    expect(text).not.toContain("anna");
    expect(aboutText(facts)).toContain("anna");
    expect(withoutUserName("/home/anna/.config/x")).toBe("/home/~/.config/x");
    expect(withoutUserName("E:\\Portable\\JumpingBallsLive-data")).toBe("E:\\Portable\\JumpingBallsLive-data");
  });

  it("says portable, safe mode and the manual update path, and leaves the website line out when unknown", () => {
    const portable = aboutLines({ ...facts, install: "portable", safeMode: true, updates: "manual", siteLabel: null });
    expect(portable[0]).toBe("App: 1.3.0 · portable · x64 · safe mode");
    expect(portable.join("\n")).not.toContain("Website build");
    expect(portable.join("\n")).toContain("Updates: download new versions from the website");
    expect(aboutLines({ ...facts, install: "development", updates: "off" }).join("\n")).toMatch(/development run[\s\S]*Updates: off/);
    expect(installKind({ packaged: true, portable: false })).toBe("installer");
    expect(installKind({ packaged: true, portable: true })).toBe("portable");
    expect(installKind({ packaged: false, portable: false })).toBe("development");
    expect(updatesMode({ packaged: true, portable: false, autoUpdate: true })).toBe("auto");
    expect(updatesMode({ packaged: true, portable: false, autoUpdate: false })).toBe("off");
    expect(updatesMode({ packaged: false, portable: false, autoUpdate: true })).toBe("off");
    expect(updatesMode({ packaged: true, portable: true, autoUpdate: true })).toBe("manual");
  });

  it("has every label in English, Polish and Spanish", () => {
    for (const lang of ["en", "pl", "es"] as const) {
      const labels = aboutLabelsOf(MENU_LABELS[lang]);
      expect(Object.keys(labels).sort(), lang).toEqual(Object.keys(ABOUT_LABELS_EN).sort());
      for (const [key, value] of Object.entries(labels)) expect(value, `${lang}.${key}`).toBeTruthy();
      for (const key of ["whatsNew", "aboutCopy", "aboutCopied", "aboutClose"]) expect(MENU_LABELS[lang][key], `${lang}.${key}`).toBeTruthy();
      const detail = aboutLines(facts, labels).join("\n");
      expect(detail).not.toContain("undefined");
    }
    expect(aboutLines(facts, aboutLabelsOf(MENU_LABELS.pl))[3]).toBe("Aktualizacje: automatyczne");
    expect(aboutLines(facts, aboutLabelsOf(MENU_LABELS.es))[3]).toBe("Actualizaciones: automáticas");
    // and none of the new native texts breaks the copy rules: no em dash, no spaced en dash, no semicolon
    for (const lang of ["en", "pl", "es"] as const) for (const key of Object.keys(MENU_LABELS[lang]).filter((k) => /^(about|whatsNew)/.test(k))) expect(MENU_LABELS[lang][key], `${lang}.${key}`).not.toMatch(/—| – |;/);
  });

  it("has Copy details, What's new and Close, which answer by position", () => {
    expect(aboutButtons(MENU_LABELS.en, false)).toEqual(["Copy details", "What's new", "Close"]);
    expect(aboutButtons(MENU_LABELS.en, true)).toEqual(["Copied", "What's new", "Close"]);
    expect(aboutButtons(MENU_LABELS.pl, false)).toEqual(["Kopiuj szczegóły", "Co nowego", "Zamknij"]);
    expect([0, 1, 2, 3, -1].map(aboutAnswer)).toEqual(["copy", "whats-new", "close", "close", "close"]);
    const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
    expect(main).toContain("clipboard.writeText(aboutText(facts, ABOUT_LABELS_EN, { redact: true }))");
    expect(main).toContain("cancelId: 2");
  });
});

describe("Help > What's new", () => {
  it("is a Help menu entry with its own command, handled by the main process", () => {
    const help = MENU.find((g) => g.id === "help")!;
    const entries = help.entries.map((e) => (e === "separator" ? "-" : e.id));
    expect(entries).toEqual(["website", "downloadPage", "whatsNew", "-", "openLogs", "checkUpdates", "about"]);
    const entry = help.entries.find((e) => e !== "separator" && e.id === "whatsNew");
    expect(entry).toMatchObject({ run: { command: "changelog" } });
    // every command in the menu has a case in main.ts
    const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
    const commands = MENU.flatMap((g) => g.entries).flatMap((e) => (e !== "separator" && "command" in e.run ? [e.run.command] : []));
    expect(commands).toContain("changelog");
    for (const command of commands) expect(main, command).toContain(`case "${command}":`);
  });

  it("opens the changelog page of the public site in the menu's language", () => {
    expect(changelogUrl("https://jumpingballslive.com", "pl")).toBe("https://jumpingballslive.com/pl/changelog/");
    expect(changelogUrl("https://jumpingballslive.com/", "es")).toBe("https://jumpingballslive.com/es/changelog/");
    const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
    expect(main).toContain("changelogUrl(SITE_URL, menuLanguage(app.getLocale()))");
  });
});
