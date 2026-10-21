import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_PREFS, resolvePrefs, restoreWindowState, sanitizePrefs } from "../src/prefs";
import { ANONYMOUS_STAGING_ID, UPDATE_INITIAL_DELAY_MS, UPDATE_INTERVAL_MS, UpdateController, type UpdaterLike, type UpdaterTimers } from "../src/updater";
import { MENU, MENU_LABELS, menuCheckAnswer, menuLanguage, updateReadyBody } from "../src/menu";
import { MEDIA_EXTENSIONS, dialogFilters, filesInArgv, mediaKindOf, mimeOf } from "../src/media";
import { Library, uniquePath } from "../src/library";
import { RenderSaver } from "../src/render";
import { bundledFfmpegPath } from "../src/ffmpeg/run";
import { JSON_GBNF, checkLocalAi, jsonGrammar } from "../src/ai/local";
import { createRequire } from "module";
import { UPDATE_MANUAL_NONE, type EncoderProbe, type RenderProgressEvent, type SaveRenderRequest, type UpdateStatus } from "@/lib/desktop/contract";

/* --- desktop-exe --- preferences, window state, the updater (never fails offline), menu, media, library and saving renders */

describe("preferences and window state", () => {
  it("keeps only valid preferences", () => {
    expect(sanitizePrefs({ preferHardware: false, aiProvider: "cloud", aiGpu: "turbo", evil: 1, outputFolder: 3 })).toEqual({ preferHardware: false, aiProvider: "cloud" });
    expect(resolvePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(resolvePrefs({ closeToTray: false }).closeToTray).toBe(false);
  });
  it("restores the window where it was, or centres it when that display is gone", () => {
    const primary = { x: 0, y: 0, width: 1920, height: 1040 };
    expect(restoreWindowState({ x: 100, y: 80, width: 1200, height: 800, maximized: true }, [primary], primary)).toEqual({ x: 100, y: 80, width: 1200, height: 800, maximized: true });
    // The second monitor it was on is unplugged.
    expect(restoreWindowState({ x: 2500, y: 80, width: 1200, height: 800 }, [primary], primary)).toEqual({ x: 360, y: 120, width: 1200, height: 800, maximized: false });
    expect(restoreWindowState({ width: 99999, height: 10 }, [primary], primary)).toMatchObject({ width: 1920, height: 600 });
    expect(restoreWindowState("garbage", [primary], primary)).toMatchObject({ width: 1440, height: 920 });
  });
});

describe("auto-update", () => {
  function fakeUpdater(check: () => Promise<unknown>): UpdaterLike & { handlers: Map<string, (...a: never[]) => void> } {
    const handlers = new Map<string, (...a: never[]) => void>();
    return { handlers, autoDownload: false, autoInstallOnAppQuit: false, logger: undefined, on: (e, l) => handlers.set(e, l), checkForUpdates: check, quitAndInstall: () => {} };
  }
  it("never throws: offline, failing or disabled", async () => {
    const seen: UpdateStatus[] = [];
    const logs: string[] = [];
    const offline = new UpdateController(fakeUpdater(async () => ({})), { enabled: true, packaged: true, portable: false, online: () => false, log: (m) => logs.push(m), emit: (s) => seen.push(s) });
    await expect(offline.check()).resolves.toMatchObject({ state: "error", message: "offline" });
    const failing = new UpdateController(fakeUpdater(async () => Promise.reject(new Error("net::ERR_NAME_NOT_RESOLVED"))), { enabled: true, packaged: true, portable: false, online: () => true, log: (m) => logs.push(m), emit: () => {} });
    await expect(failing.check()).resolves.toMatchObject({ state: "error", message: "net::ERR_NAME_NOT_RESOLVED" });
    expect(logs.some((l) => l.includes("ERR_NAME_NOT_RESOLVED"))).toBe(true);
    const portable = new UpdateController(fakeUpdater(async () => ({})), { enabled: true, packaged: true, portable: true, online: () => true, log: () => {}, emit: () => {} });
    expect(portable.status).toMatchObject({ state: "disabled", message: "portable" });
    const dev = new UpdateController(null, { enabled: true, packaged: false, portable: false, online: () => true, log: () => {}, emit: () => {} });
    await expect(dev.check()).resolves.toMatchObject({ state: "disabled" });
  });
  // --- manual-update --- electron-updater sends a random ID it keeps on the PC with every check (x-user-staging-id); the app has
  // no staged rollouts, so every install sends the same value and a check names nobody
  it("sends no ID of the install with an update check", () => {
    const u = fakeUpdater(async () => ({}));
    u.requestHeaders = { "user-agent": "jbl" };
    new UpdateController(u, { enabled: true, packaged: true, portable: false, online: () => true, log: () => {}, emit: () => {} });
    expect(u.requestHeaders).toEqual({ "user-agent": "jbl", "x-user-staging-id": ANONYMOUS_STAGING_ID });
    expect(ANONYMOUS_STAGING_ID).toBe("00000000-0000-0000-0000-000000000000");
    const bare = fakeUpdater(async () => ({}));
    new UpdateController(bare, { enabled: true, packaged: true, portable: false, online: () => true, log: () => {}, emit: () => {} });
    expect(bare.requestHeaders).toEqual({ "x-user-staging-id": ANONYMOUS_STAGING_ID });
    // electron-updater lays these headers over its own, the stored ID among them, on the latest.yml request and the download
    const lib = fs.readFileSync(path.join(__dirname, "..", "node_modules", "electron-updater", "out", "AppUpdater.js"), "utf8");
    expect(lib).toMatch(/computeFinalHeaders\(headers\) \{\s+if \(this\.requestHeaders != null\) \{\s+Object\.assign\(headers, this\.requestHeaders\);/);
    expect(lib).toMatch(/client\.setRequestHeaders\(this\.computeFinalHeaders\(\{ "x-user-staging-id": stagingUserId \}\)\);/);
  });
  it("follows electron-updater's events to 'ready'", async () => {
    const u = fakeUpdater(async () => ({}));
    const seen: UpdateStatus[] = [];
    const c = new UpdateController(u, { enabled: true, packaged: true, portable: false, online: () => true, log: () => {}, emit: (s) => seen.push(s) });
    expect(u.autoDownload).toBe(true);
    (u.handlers.get("update-available") as (i: { version: string }) => void)({ version: "1.2.0" });
    (u.handlers.get("download-progress") as (p: { percent: number }) => void)({ percent: 50 });
    (u.handlers.get("update-downloaded") as (i: { version: string }) => void)({ version: "1.2.0" });
    expect(seen.map((s) => s.state)).toEqual(["available", "downloading", "ready"]);
    expect(c.status).toMatchObject({ version: "1.2.0", progress: 1 });
  });

  // --- desktop-autorelease --- the schedule (8 s after launch, then every 4 hours) and the quiet scheduled checks
  /** Hand-written timers: they record what is scheduled; the test fires them. */
  function fakeTimers() {
    let next = 1;
    const timeouts = new Map<number, { fn: () => void; ms: number }>();
    const intervals = new Map<number, { fn: () => void; ms: number }>();
    const timers: UpdaterTimers = {
      setTimeout: (fn, ms) => (timeouts.set(next, { fn, ms }), next++),
      clearTimeout: (h) => void timeouts.delete(h as number),
      setInterval: (fn, ms) => (intervals.set(next, { fn, ms }), next++),
      clearInterval: (h) => void intervals.delete(h as number),
    };
    const fireTimeouts = () => {
      for (const [h, t] of [...timeouts]) {
        timeouts.delete(h);
        t.fn();
      }
    };
    const tick = () => [...intervals.values()].forEach((t) => t.fn());
    return { timers, timeouts, intervals, fireTimeouts, tick };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("checks 8 s after start, then every 4 hours, and stops cleanly", async () => {
    expect(UPDATE_INITIAL_DELAY_MS).toBe(8000);
    expect(UPDATE_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
    let checks = 0;
    const c = new UpdateController(fakeUpdater(async () => void checks++), { enabled: true, packaged: true, portable: false, online: () => true, log: () => {}, emit: () => {} });
    const t = fakeTimers();
    c.stop(); // before start: nothing to clear
    c.start(t.timers);
    expect([...t.timeouts.values()].map((x) => x.ms)).toEqual([UPDATE_INITIAL_DELAY_MS]);
    expect([...t.intervals.values()].map((x) => x.ms)).toEqual([UPDATE_INTERVAL_MS]);
    expect(checks).toBe(0); // nothing before the first delay
    c.start(t.timers); // a second start schedules nothing more
    expect(t.timeouts.size + t.intervals.size).toBe(2);
    t.fireTimeouts();
    await settle();
    expect(checks).toBe(1);
    t.tick();
    await settle();
    t.tick();
    await settle();
    expect(checks).toBe(3);
    c.stop();
    expect(t.timeouts.size + t.intervals.size).toBe(0);
    c.stop(); // twice is fine
    // custom delays, and the timers cleared before the first check
    const t2 = fakeTimers();
    c.start(t2.timers, { initialDelayMs: 5, intervalMs: 50 });
    expect([...t2.timeouts.values()].map((x) => x.ms)).toEqual([5]);
    expect([...t2.intervals.values()].map((x) => x.ms)).toEqual([50]);
    c.stop();
    expect(t2.timeouts.size + t2.intervals.size).toBe(0);
    // an inactive controller (portable, development build, the smoke run) or auto-update off schedules nothing
    const t3 = fakeTimers();
    for (const options of [{ portable: true, packaged: true, enabled: true }, { portable: false, packaged: false, enabled: true }, { portable: false, packaged: true, enabled: false }, { portable: false, packaged: true, enabled: true, autoUpdate: () => false }]) {
      new UpdateController(fakeUpdater(async () => void checks++), { ...options, online: () => true, log: () => {}, emit: () => {} }).start(t3.timers);
    }
    new UpdateController(null, { enabled: true, packaged: true, portable: false, online: () => true, log: () => {}, emit: () => {} }).start(t3.timers);
    expect(t3.timeouts.size + t3.intervals.size).toBe(0);
  });

  it("keeps quiet scheduled checks out of the way: offline, failing or while busy", async () => {
    const logs: string[] = [];
    const seen: UpdateStatus[] = [];
    let online = false;
    let calls = 0;
    let fail = false;
    const u = fakeUpdater(async () => {
      calls++;
      if (fail) throw new Error("net::ERR_CONNECTION_RESET");
    });
    const c = new UpdateController(u, { enabled: true, packaged: true, portable: false, online: () => online, log: (m) => logs.push(m), emit: (s) => seen.push(s) });
    // offline: logged, the status stays as it was (no "error" for a check nobody asked for)
    await expect(c.check({ quiet: true })).resolves.toMatchObject({ state: "idle" });
    expect(c.status.state).toBe("idle");
    expect(seen).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("offline");
    expect(calls).toBe(0);
    // a check or a download under way: the updater is not asked again
    online = true;
    (u.handlers.get("checking-for-update") as () => void)();
    await expect(c.check({ quiet: true })).resolves.toMatchObject({ state: "checking" });
    (u.handlers.get("download-progress") as (p: { percent: number }) => void)({ percent: 40 });
    await expect(c.check({ quiet: true })).resolves.toMatchObject({ state: "downloading" });
    expect(calls).toBe(0);
    // failing: logged, the status untouched
    (u.handlers.get("update-not-available") as () => void)();
    fail = true;
    const before = seen.length;
    await expect(c.check({ quiet: true })).resolves.toMatchObject({ state: "none" });
    expect(calls).toBe(1);
    expect(seen.length).toBe(before);
    expect(logs.some((l) => l.includes("ERR_CONNECTION_RESET"))).toBe(true);
    // a manual check still says so
    await expect(c.check()).resolves.toMatchObject({ state: "error", message: "net::ERR_CONNECTION_RESET" });
    online = false;
    await expect(c.check()).resolves.toMatchObject({ state: "error", message: "offline" });
  });

  it("leaves a downloaded update alone and hides electron-updater's own error event from a quiet check", async () => {
    const logs: string[] = [];
    const seen: UpdateStatus[] = [];
    let calls = 0;
    // electron-updater's real order on a failed check: "checking-for-update", then "error", then the promise rejects
    const u = fakeUpdater(async () => {
      calls++;
      (u.handlers.get("checking-for-update") as () => void)();
      const err = new Error("HttpError: 503");
      (u.handlers.get("error") as (e: Error) => void)(err);
      throw err;
    });
    const c = new UpdateController(u, { enabled: true, packaged: true, portable: false, online: () => true, log: (m) => logs.push(m), emit: (s) => seen.push(s) });
    (u.handlers.get("update-not-available") as () => void)();
    await expect(c.check({ quiet: true })).resolves.toMatchObject({ state: "none" });
    expect(calls).toBe(1);
    expect(seen.map((s) => s.state)).toEqual(["none", "checking", "none"]);
    expect(logs.some((l) => l.includes("503"))).toBe(true);
    // the same failure on a manual check is shown
    await expect(c.check()).resolves.toMatchObject({ state: "error", message: "HttpError: 503" });
    // an update that is available, downloading or downloaded: the schedule does not ask again (it installs on restart)
    for (const emit of [() => (u.handlers.get("update-available") as (i: { version: string }) => void)({ version: "2.0.0" }), () => (u.handlers.get("update-downloaded") as (i: { version: string }) => void)({ version: "2.0.0" })]) {
      emit();
      const state = c.status.state;
      await expect(c.check({ quiet: true })).resolves.toMatchObject({ state });
    }
    expect(c.status).toMatchObject({ state: "ready", version: "2.0.0" });
    expect(calls).toBe(2);
  });

  // --- manual-update --- the top bar's update button: a manual check works with auto-update off, one check at a time
  /** A check that waits until the test lets it finish (electron-updater's real check takes a round trip). */
  function deferredUpdater() {
    let calls = 0;
    let finish: (fail?: Error) => void = () => {};
    const u = fakeUpdater(
      () =>
        new Promise<unknown>((resolve, reject) => {
          calls++;
          (u.handlers.get("checking-for-update") as () => void)();
          finish = (fail) => (fail ? reject(fail) : resolve({}));
        }),
    );
    return { u, calls: () => calls, finish: (fail?: Error) => finish(fail) };
  }

  it("checks and downloads on a manual click with auto-update off, and schedules nothing by itself", async () => {
    let auto = false;
    const seen: UpdateStatus[] = [];
    const installs: number[] = [];
    const d = deferredUpdater();
    d.u.quitAndInstall = () => void installs.push(1);
    const c = new UpdateController(d.u, { enabled: true, autoUpdate: () => auto, packaged: true, portable: false, online: () => true, log: () => {}, emit: (s) => seen.push(s) });
    // an installed build with auto-update off is not "disabled": the button offers Check for updates, and what it finds downloads
    expect(c.active).toBe(true);
    expect(c.status.state).toBe("idle");
    expect(d.u.autoDownload).toBe(true);
    // true while the app runs: electron-updater adds its quit handler only when it is true as the download ends
    expect(d.u.autoInstallOnAppQuit).toBe(true);
    const t = fakeTimers();
    c.start(t.timers);
    expect(t.timeouts.size + t.intervals.size).toBe(0);
    // the click: checking, found, downloading, ready, then Restart and update installs
    const click = c.check();
    expect(d.calls()).toBe(1);
    expect(c.status.state).toBe("checking");
    (d.u.handlers.get("update-available") as (i: { version: string }) => void)({ version: "1.5.0" });
    d.finish();
    await expect(click).resolves.toMatchObject({ state: "available", version: "1.5.0" });
    c.install(); // not before the download is done
    expect(installs).toEqual([]);
    (d.u.handlers.get("download-progress") as (p: { percent: number }) => void)({ percent: 42 });
    expect(c.status).toMatchObject({ state: "downloading", progress: 0.42 });
    (d.u.handlers.get("update-downloaded") as (i: { version: string }) => void)({ version: "1.5.0" });
    expect(seen.map((s) => s.state)).toEqual(["checking", "available", "downloading", "ready"]);
    c.install();
    expect(installs).toEqual([1]);
    // turning auto-update on starts the quiet schedule (main.ts calls start() when the preference changes)
    auto = true;
    c.start(t.timers);
    expect([...t.timeouts.values()].map((x) => x.ms)).toEqual([UPDATE_INITIAL_DELAY_MS]);
    expect([...t.intervals.values()].map((x) => x.ms)).toEqual([UPDATE_INTERVAL_MS]);
    c.stop();
  });

  // --- manual-update --- electron-updater's quit handler installs a downloaded update silently when the app quits, if
  // autoInstallOnAppQuit is true then: with "Update automatically" off, the update a manual check downloaded waits for Restart
  // and update instead
  it("installs a downloaded update on quit only while auto-update is on, as it is at quit time", async () => {
    let auto = false;
    const d = deferredUpdater();
    const c = new UpdateController(d.u, { enabled: true, autoUpdate: () => auto, packaged: true, portable: false, online: () => true, log: () => {}, emit: () => {} });
    const click = c.check();
    (d.u.handlers.get("update-available") as (i: { version: string }) => void)({ version: "1.5.0" });
    d.finish();
    await click;
    // the download ends with the flag still true, so electron-updater registers its quit handler
    expect(d.u.autoInstallOnAppQuit).toBe(true);
    (d.u.handlers.get("update-downloaded") as (i: { version: string }) => void)({ version: "1.5.0" });
    expect(c.status.state).toBe("ready");
    // the user picks Later and closes the app: before-quit turns the install off, the handler reads it and leaves it
    c.prepareQuit();
    expect(d.u.autoInstallOnAppQuit).toBe(false);
    // the preference turned on before the quit: the update installs as the app closes
    auto = true;
    c.prepareQuit();
    expect(d.u.autoInstallOnAppQuit).toBe(true);
    // a build that cannot update has no updater to tell
    const portable = fakeUpdater(async () => ({}));
    portable.autoInstallOnAppQuit = true;
    new UpdateController(portable, { enabled: true, autoUpdate: () => false, packaged: true, portable: true, online: () => true, log: () => {}, emit: () => {} }).prepareQuit();
    expect(portable.autoInstallOnAppQuit).toBe(true);
    // main.ts asks for it at quit, next to the schedule's stop
    const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
    expect(main).toMatch(/app\.on\("before-quit", \(event\) => \{\s+updater\.stop\(\);[^\n]*\n\s+updater\.prepareQuit\(\);/);
  });

  it("runs one check at a time: a double click, the menu during the schedule's check, and a click during a download", async () => {
    const seen: UpdateStatus[] = [];
    const d = deferredUpdater();
    const c = new UpdateController(d.u, { enabled: true, autoUpdate: () => false, packaged: true, portable: false, online: () => true, log: () => {}, emit: (s) => seen.push(s) });
    // a double click: one check, both clicks get its answer
    const first = c.check();
    const second = c.check();
    expect(d.calls()).toBe(1);
    // the schedule while it runs: not asked again
    await expect(c.check({ quiet: true })).resolves.toMatchObject({ state: "checking" });
    expect(d.calls()).toBe(1);
    (d.u.handlers.get("update-not-available") as () => void)();
    d.finish();
    await expect(first).resolves.toMatchObject({ state: "none" });
    await expect(second).resolves.toMatchObject({ state: "none" });
    // once it is over, the next click checks again
    const again = c.check();
    expect(d.calls()).toBe(2);
    (d.u.handlers.get("update-not-available") as () => void)();
    d.finish();
    await again;
    // a click during the schedule's check joins it, and its failure is then shown like a manual check's
    const quiet = c.check({ quiet: true });
    expect(d.calls()).toBe(3);
    const joined = c.check();
    expect(d.calls()).toBe(3);
    d.finish(new Error("HttpError: 502"));
    await expect(joined).resolves.toMatchObject({ state: "error", message: "HttpError: 502" });
    await expect(quiet).resolves.toMatchObject({ state: "error" });
    // during a download, or with the update downloaded, a click leaves it alone (Restart and update is next)
    (d.u.handlers.get("update-available") as (i: { version: string }) => void)({ version: "2.0.0" });
    await expect(c.check()).resolves.toMatchObject({ state: "available" });
    (d.u.handlers.get("download-progress") as (p: { percent: number }) => void)({ percent: 10 });
    await expect(c.check()).resolves.toMatchObject({ state: "downloading" });
    (d.u.handlers.get("update-downloaded") as (i: { version: string }) => void)({ version: "2.0.0" });
    await expect(c.check()).resolves.toMatchObject({ state: "ready" });
    expect(d.calls()).toBe(3);
  });

  // --- manual-update --- the Help menu's check answers in the page like the button's: the "none" it ends in carries the mark
  it("marks the 'none' a manual check ends in, never a quiet check's, nor the status a failed quiet check puts back", async () => {
    const seen: UpdateStatus[] = [];
    const d = deferredUpdater();
    const c = new UpdateController(d.u, { enabled: true, autoUpdate: () => true, packaged: true, portable: false, online: () => true, log: () => {}, emit: (s) => seen.push(s) });
    const notFound = () => (d.u.handlers.get("update-not-available") as () => void)();
    // the menu (main.ts runCommand "check-updates") and the GPU tab call the same check() as the button
    const menu = c.check();
    notFound();
    d.finish();
    await expect(menu).resolves.toEqual({ state: "none", version: null, progress: null, message: UPDATE_MANUAL_NONE });
    expect(seen.map((s) => `${s.state}:${s.message}`)).toEqual(["checking:null", "none:null", `none:${UPDATE_MANUAL_NONE}`]);
    // the schedule's check that finds nothing: a bare "none"
    seen.length = 0;
    const quiet = c.check({ quiet: true });
    notFound();
    d.finish();
    await expect(quiet).resolves.toMatchObject({ state: "none", message: null });
    expect(seen.map((s) => `${s.state}:${s.message}`)).toEqual(["checking:null", "none:null"]);
    // a quiet check that fails after a manual one: put back to "none", without the manual check's mark
    const manual = c.check();
    notFound();
    d.finish();
    await expect(manual).resolves.toMatchObject({ message: UPDATE_MANUAL_NONE });
    seen.length = 0;
    const failing = c.check({ quiet: true });
    d.finish(new Error("HttpError: 503"));
    await expect(failing).resolves.toMatchObject({ state: "none", message: null });
    expect(seen.map((s) => `${s.state}:${s.message}`)).toEqual(["checking:null", "none:null"]);
    // the schedule's check the menu joins reports like a manual one
    const scheduled = c.check({ quiet: true });
    const joined = c.check();
    notFound();
    d.finish();
    await expect(joined).resolves.toMatchObject({ state: "none", message: UPDATE_MANUAL_NONE });
    await expect(scheduled).resolves.toMatchObject({ message: UPDATE_MANUAL_NONE });
    const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
    expect(main).toMatch(/case "check-updates": \{\s+const found = await updater\.check\(\);/);
  });

  // --- manual-update --- electron-updater resolves checkForUpdates() as soon as it finds the update and downloads afterwards:
  // a failure of the download a quiet check started is quiet too, one a manual check started or adopted is said
  it("keeps the failure of a download the schedule started out of the page, and says one the user asked for", async () => {
    const logs: string[] = [];
    const seen: UpdateStatus[] = [];
    const d = deferredUpdater();
    const c = new UpdateController(d.u, { enabled: true, autoUpdate: () => true, packaged: true, portable: false, online: () => true, log: (m) => logs.push(m), emit: (s) => seen.push(s) });
    const available = () => (d.u.handlers.get("update-available") as (i: { version: string }) => void)({ version: "1.5.0" });
    const progress = (percent: number) => (d.u.handlers.get("download-progress") as (p: { percent: number }) => void)({ percent });
    const fail = () => (d.u.handlers.get("error") as (e: Error) => void)(new Error("net::ERR_INTERNET_DISCONNECTED"));
    (d.u.handlers.get("update-not-available") as () => void)();
    // the schedule finds 1.5.0; the check returns while the download runs; the Wi-Fi drops
    const quiet = c.check({ quiet: true });
    available();
    d.finish();
    await expect(quiet).resolves.toMatchObject({ state: "available", version: "1.5.0" });
    progress(40);
    fail();
    expect(c.status).toEqual({ state: "none", version: null, progress: null, message: null });
    expect(seen.some((s) => s.state === "error")).toBe(false);
    expect(logs.some((l) => l.includes("ERR_INTERNET_DISCONNECTED"))).toBe(true);
    // the next scheduled check tries again, and its download goes through
    const again = c.check({ quiet: true });
    expect(d.calls()).toBe(2);
    available();
    d.finish();
    await again;
    (d.u.handlers.get("update-downloaded") as (i: { version: string }) => void)({ version: "1.5.0" });
    expect(c.status).toMatchObject({ state: "ready", version: "1.5.0" });
    // a download a manual check started fails out loud
    const m = new UpdateController(d.u, { enabled: true, autoUpdate: () => true, packaged: true, portable: false, online: () => true, log: () => {}, emit: () => {} });
    const click = m.check();
    available();
    d.finish();
    await click;
    fail();
    expect(m.status).toMatchObject({ state: "error", message: "net::ERR_INTERNET_DISCONNECTED" });
    // and so does the schedule's once the user asks for it by hand (the menu during the download)
    const q = new UpdateController(d.u, { enabled: true, autoUpdate: () => true, packaged: true, portable: false, online: () => true, log: () => {}, emit: () => {} });
    const scheduled = q.check({ quiet: true });
    available();
    d.finish();
    await scheduled;
    progress(10);
    await expect(q.check()).resolves.toMatchObject({ state: "downloading" });
    fail();
    expect(q.status).toMatchObject({ state: "error", message: "net::ERR_INTERNET_DISCONNECTED" });
  });

  it("says which builds cannot update themselves and never checks there", async () => {
    let calls = 0;
    const make = (o: { enabled: boolean; packaged: boolean; portable: boolean }, updater: UpdaterLike | null = fakeUpdater(async () => void calls++)) =>
      new UpdateController(updater, { ...o, autoUpdate: () => true, online: () => true, log: () => {}, emit: () => {} });
    const portable = make({ enabled: true, packaged: true, portable: true });
    const dev = make({ enabled: true, packaged: false, portable: false }, null);
    const smoke = make({ enabled: false, packaged: true, portable: false });
    expect(portable.status).toMatchObject({ state: "disabled", message: "portable" });
    expect(dev.status).toMatchObject({ state: "disabled", message: "development build" });
    expect(smoke.status).toMatchObject({ state: "disabled", message: "off" });
    for (const c of [portable, dev, smoke]) {
      expect(c.active).toBe(false);
      await expect(c.check()).resolves.toMatchObject({ state: "disabled" });
      c.install();
    }
    expect(calls).toBe(0);
  });

  it("is wired in main.ts: every installed build may check by hand, the preference drives the schedule", () => {
    const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
    expect(main).toContain("enabled: !SMOKE,");
    expect(main).toContain("autoUpdate: () => prefs().autoUpdate,");
    expect(main).toMatch(/before\.autoUpdate !== after\.autoUpdate[\s\S]{0,120}updater\.start\(\);[\s\S]{0,40}updater\.stop\(\);/);
    expect(main).toContain("[IPC.updateCheck]: () => updater.check(),");
    expect(main).toMatch(/case "check-updates": \{\s+const found = await updater\.check\(\);/);
  });

  // --- manual-update --- with "Update automatically" off prepareQuit() keeps a downloaded update from installing on quit, so the
  // notification names Restart and update instead; Help > Check for updates answers in a box, where the user is
  it("words the ready notification by the preference and answers the Help menu's check in a box of its own", async () => {
    const pages = Object.fromEntries((["en", "pl", "es"] as const).map((l) => [l, JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", `${l}.json`), "utf8")) as { Desktop: Record<string, string> }]));
    for (const lang of ["en", "pl", "es"] as const) {
      const l = MENU_LABELS[lang];
      expect(updateReadyBody(l, "1.5.0", true), lang).toBe(l.updateReadyBody.replace("{version}", "1.5.0"));
      const manual = updateReadyBody(l, "1.5.0", false);
      expect(manual, lang).toContain("1.5.0");
      // the page's own label of the button, and no word of restarting or closing the app for it
      expect(manual, lang).toContain(pages[lang].Desktop.appRestartUpdate);
      expect(manual, lang).not.toMatch(/restart the app|quit|close|uruchom aplikację|zamknij|reinicia la aplicación|cierra/i);
      expect(manual, lang).not.toMatch(/—| – |;/);
      for (const key of ["updateLatest", "updateFailed", "updateOffline", "updateDownloading", "updateDownloaded", "updatePortable", "updateDevBuild"]) {
        expect(l[key], `${lang}.${key}`).toMatch(/^\S.*\.$/);
        expect(l[key], `${lang}.${key}`).not.toMatch(/—| – |;/);
      }
      // the downloaded line names the page's own button, works with the preference on or off, and never says to quit for it
      expect(l.updateDownloaded, lang).toContain(pages[lang].Desktop.appRestartUpdate);
      expect(l.updateDownloaded, lang).not.toMatch(/restart the app|quit|close|uruchom aplikację|zamknij|reinicia la aplicación|cierra/i);
      for (const key of ["updateDownloading", "updateDownloaded"]) expect(l[key], `${lang}.${key}`).toContain(" {version}");
      // the two builds that do not update themselves say it as the top bar says it
      expect(l.updatePortable.startsWith(`${(pages[lang].Desktop as unknown as { updateButton: Record<string, string> }).updateButton.portable}.`), lang).toBe(true);
      expect(l.updateDevBuild.startsWith(`${(pages[lang].Desktop as unknown as { updateButton: Record<string, string> }).updateButton.devBuild}.`), lang).toBe(true);
    }
    // the rule the body follows is prepareQuit's: the same preference decides whether quitting installs
    const d = deferredUpdater();
    const c = new UpdateController(d.u, { enabled: true, autoUpdate: () => false, packaged: true, portable: false, online: () => true, log: () => {}, emit: () => {} });
    c.prepareQuit();
    expect(d.u.autoInstallOnAppQuit).toBe(false);
    const en = MENU_LABELS.en;
    expect(menuCheckAnswer({ state: "none", message: UPDATE_MANUAL_NONE }, en)).toEqual({ message: en.updateLatest });
    expect(menuCheckAnswer({ state: "error", message: "offline" }, en)).toEqual({ message: en.updateOffline });
    expect(menuCheckAnswer({ state: "error", message: "HttpError: 502" }, en)).toEqual({ message: en.updateFailed, detail: "HttpError: 502" });
    // --- manual-update --- every other outcome has its line too: a found update downloading, one downloaded and waiting, and
    // a build that does not update itself, with the Download page
    expect(menuCheckAnswer({ state: "available", version: "1.5.0", message: null }, en)).toEqual({ message: "The new version 1.5.0 is downloading. The app tells you when it is ready." });
    expect(menuCheckAnswer({ state: "downloading", version: "1.5.0", message: null }, en)).toEqual({ message: "The new version 1.5.0 is downloading. The app tells you when it is ready." });
    expect(menuCheckAnswer({ state: "available", version: null, message: null }, en)).toEqual({ message: "The new version is downloading. The app tells you when it is ready." });
    expect(menuCheckAnswer({ state: "ready", version: "1.5.0", message: null }, en)).toEqual({ message: "The new version 1.5.0 is downloaded. Press Restart and update in the app to install it." });
    expect(menuCheckAnswer({ state: "disabled", message: "portable" }, en)).toEqual({ message: en.updatePortable, download: true });
    for (const message of ["development build", "off"]) expect(menuCheckAnswer({ state: "disabled", message }, en), message).toEqual({ message: en.updateDevBuild, download: true });
    for (const lang of ["pl", "es"] as const) expect(menuCheckAnswer({ state: "ready", version: "1.5.0", message: null }, MENU_LABELS[lang])?.message, lang).toContain("1.5.0");
    // only a check that has not answered yet gets no box
    for (const state of ["checking", "idle"]) expect(menuCheckAnswer({ state, message: null }, en), state).toBeNull();
    const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
    expect(main).toMatch(/case "check-updates": \{\s+const found = await updater\.check\(\);[\s\S]{0,160}menuAsked = found\.state === "available" \|\| found\.state === "downloading";\s+await showCheckAnswer\(\);/);
    expect(main).toMatch(/const answer = menuCheckAnswer\(status, labels\);/);
    // the Download page button, and the download the menu's check found: its failure, or a "ready" no notification says, gets a box
    expect(main).toMatch(/const buttons = answer\.download \? \[labels\.downloadPage, labels\.aboutClose\] : \[labels\.aboutClose\];/);
    // (--- manual-update --- the Download page in the box's language, as the menu's own entry opens it: about.test.ts)
    expect(main).toMatch(/if \(answer\.download && response === 0\) await shell\.openExternal\(downloadPageUrl\(SITE_URL, menuLanguage\(app\.getLocale\(\)\)\)\);/);
    expect(main).toMatch(/if \(menuAsked && s\.state !== "available" && s\.state !== "downloading"\) \{\s+menuAsked = false;\s+if \(s\.state === "error" \|\| \(s\.state === "ready" && !notified\)\) void showCheckAnswer\(s\);/);
    expect(main).toContain("body: updateReadyBody(l, s.version, prefs().autoUpdate)");
  });
});

describe("menu and media", () => {
  it("has unique shortcuts and labels in every language", () => {
    const accelerators = MENU.flatMap((g) => g.entries).filter((e) => e !== "separator").map((e) => (e as { accelerator?: string }).accelerator).filter(Boolean);
    expect(new Set(accelerators).size).toBe(accelerators.length);
    const ids = [...MENU.map((g) => g.id), ...MENU.flatMap((g) => g.entries).filter((e) => e !== "separator").map((e) => (e as { id: string }).id)];
    for (const lang of ["en", "pl", "es"] as const) for (const id of ids) expect(MENU_LABELS[lang][id], `${lang}.${id}`).toBeTruthy();
    expect(Object.keys(MENU_LABELS.pl).sort()).toEqual(Object.keys(MENU_LABELS.en).sort());
    expect(Object.keys(MENU_LABELS.es).sort()).toEqual(Object.keys(MENU_LABELS.en).sort());
    // --- desktop-autorelease --- the update-ready notification (main.ts) in every language, with the version
    for (const lang of ["en", "pl", "es"] as const) {
      expect(MENU_LABELS[lang].updateReadyTitle, `${lang}.updateReadyTitle`).toBeTruthy();
      expect(MENU_LABELS[lang].updateReadyBody, `${lang}.updateReadyBody`).toContain("{version}");
    }
    expect(menuLanguage("es-MX")).toBe("es");
    // --- legal-review --- Help opens the third-party notices, which ship in the resources folder with the GPL source offer
    const help = MENU.find((g) => g.id === "help")!.entries.filter((e) => e !== "separator") as { id: string; run: { command?: string } }[];
    expect(help.find((e) => e.id === "thirdParty")?.run.command).toBe("third-party");
    const packaging = createRequire(import.meta.url)("../electron-builder.config.cjs") as { extraResources: { from: string; to: string }[] };
    expect(packaging.extraResources).toContainEqual({ from: "THIRD-PARTY-NOTICES.txt", to: "THIRD-PARTY-NOTICES.txt" });
    const notices = fs.readFileSync(path.join(__dirname, "..", "THIRD-PARTY-NOTICES.txt"), "utf8").replace(/\s+/g, " ");
    for (const term of ["GNU General Public License, version 3", "gyan.dev", "Source code offer", "three years", "Electron", "Chromium", "llama.cpp", "Llama 3.2 Community License", "Open Font License"]) expect(notices).toContain(term);
    expect(menuLanguage("fr")).toBe("en");
  });
  it("knows the media kinds and the files passed on the command line", () => {
    expect(mediaKindOf("C:/m/song.MP3")).toBe("song");
    expect(mediaKindOf("clip.webm")).toBe("video");
    expect(mediaKindOf("model.gguf")).toBe("model");
    expect(mediaKindOf("x.exe")).toBe("unknown");
    expect(mimeOf("a.wav")).toBe("audio/wav");
    expect(dialogFilters("midi")).toEqual([{ name: "midi", extensions: [...MEDIA_EXTENSIONS.midi] }]);
    const abs = path.resolve("/music/beat.wav");
    expect(filesInArgv(["app.exe", "--smoke", abs, "relative.wav", path.resolve("/x/evil.exe")])).toEqual([abs]);
    expect(bundledFfmpegPath("/opt/app/resources/app.asar/node_modules/ffmpeg-static/ffmpeg")).toBe(process.platform === "win32" ? "/opt/app/resources/app.asar/node_modules/ffmpeg-static/ffmpeg" : "/opt/app/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg");
  });
});

describe("saving renders and the library", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-render-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const meta = { title: "Glass", mode: "glass", seed: 7, link: "https://x/en/simulator/?mode=glass&seed=7", platform: "tiktok", hook: "Pip vs glass", caption: "Which floor?", hashtags: ["#physics"], queueJobId: "j1" };
  const request = (patch: Partial<SaveRenderRequest> = {}): SaveRenderRequest => ({ jobId: "j1", folder: path.join(dir, "out"), name: "glass smash", extension: "webm", data: new Uint8Array([1, 2, 3, 4]), durationSec: 10, transcode: null, meta, ...patch });
  const probe: EncoderProbe = { ffmpeg: { path: "ffmpeg", version: "7", bundled: true }, encoders: [], chosen: { h264: "h264_nvenc", hevc: null, av1: null }, error: null };

  it("saves the bytes to the output folder without a dialog and lists the clip", async () => {
    const library = new Library(path.join(dir, "library.json"), path.join(dir, "thumbs"));
    const saver = new RenderSaver({ outputFolder: () => dir, ffmpeg: () => null, probe: async () => probe, run: async () => ({ code: 0, stdout: "", stderr: "" }), library, emit: () => {}, log: () => {} });
    const first = await saver.save(request());
    const second = await saver.save(request());
    expect(first.path).toBe(path.join(dir, "out", "glass-smash.webm"));
    expect(second.path).toBe(path.join(dir, "out", "glass-smash-2.webm"));
    expect(fs.readFileSync(first.path)).toEqual(Buffer.from([1, 2, 3, 4]));
    const items = await library.list();
    expect(items.map((i) => [i.fileName, i.exists, i.meta.seed])).toEqual([
      ["glass-smash-2.webm", true, 7],
      ["glass-smash.webm", true, 7],
    ]);
    fs.rmSync(first.path);
    expect((await library.list()).find((i) => i.path === first.path)?.exists).toBe(false);
    const trashed: string[] = [];
    const left = await library.remove(items[0].id, true, async (f) => void trashed.push(f));
    expect(trashed).toEqual([second.path]);
    expect(left).toHaveLength(1);
    expect(uniquePath(dir, "a", "mp4", () => false)).toBe(path.join(dir, "a.mp4"));
  });

  it("transcodes on the chosen GPU encoder with progress, then removes the intermediate file", async () => {
    const library = new Library(path.join(dir, "library.json"), path.join(dir, "thumbs"));
    const events: RenderProgressEvent[] = [];
    const runs: string[][] = [];
    const saver = new RenderSaver({
      outputFolder: () => dir,
      ffmpeg: () => "ffmpeg",
      probe: async () => probe,
      run: async (_bin, args, options) => {
        runs.push(args);
        const out = args[args.length - 1];
        if (args.includes("-progress")) {
          options?.onProgress?.(5_000_000);
          fs.writeFileSync(out, "mp4 bytes");
          return { code: 0, stdout: "", stderr: "" };
        }
        if (args.includes("-frames:v")) {
          fs.writeFileSync(out, "jpeg");
          return { code: 0, stdout: "", stderr: "" };
        }
        return { code: 1, stdout: "", stderr: "Duration: 00:00:10.02, start\n Stream #0:0: Video: h264, yuv420p, 1080x1920, 60 fps" };
      },
      library,
      emit: (e) => events.push(e),
      log: () => {},
    });
    const saved = await saver.save(request({ transcode: { codec: "h264", width: 1080, height: 1920, fps: 60, videoKbps: 10000, maxKbps: 12000, audioKbps: 192, sampleRate: 44100 } }));
    expect(saved).toMatchObject({ path: path.join(dir, "out", "glass-smash.mp4"), encoder: "h264_nvenc", durationSec: 10.02 });
    expect(runs[0]).toContain("h264_nvenc");
    expect(events).toContainEqual({ jobId: "j1", phase: "encoding", progress: 0.5 });
    expect(fs.readdirSync(path.join(dir, "out"))).toEqual(["glass-smash.mp4"]); // the intermediate WebM is gone
    const [item] = await library.list();
    expect(item).toMatchObject({ width: 1080, height: 1920, encoder: "h264_nvenc" });
    expect(item.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("fails clearly without ffmpeg or without an encoder for the codec", async () => {
    const library = new Library(path.join(dir, "library.json"), path.join(dir, "thumbs"));
    const spec = { codec: "hevc" as const, width: 1080, height: 1920, fps: 60, videoKbps: 1, maxKbps: 1, audioKbps: 128, sampleRate: 48000 };
    const none = new RenderSaver({ outputFolder: () => dir, ffmpeg: () => null, probe: async () => probe, run: async () => ({ code: 0, stdout: "", stderr: "" }), library, emit: () => {}, log: () => {} });
    await expect(none.save(request({ transcode: spec }))).rejects.toThrow(/ffmpeg is not available/);
    const noHevc = new RenderSaver({ outputFolder: () => dir, ffmpeg: () => "ffmpeg", probe: async () => probe, run: async () => ({ code: 0, stdout: "", stderr: "" }), library, emit: () => {}, log: () => {} });
    await expect(noHevc.save(request({ transcode: spec }))).rejects.toThrow(/No working HEVC encoder/);
    expect(fs.readdirSync(path.join(dir, "out"))).toEqual([]);
  });

  // --- review fix (desktop-exe) --- a transcode that never finishes leaves no half-written MP4 that looks like a clip
  it("removes the half-written MP4 when the transcode is cancelled, times out or cannot start", async () => {
    const library = new Library(path.join(dir, "library.json"), path.join(dir, "thumbs"));
    const spec = { codec: "h264" as const, width: 1080, height: 1920, fps: 60, videoKbps: 1, maxKbps: 1, audioKbps: 128, sampleRate: 48000 };
    let started: () => void = () => {};
    const transcoding = new Promise<void>((resolve) => (started = resolve));
    const saver = new RenderSaver({
      outputFolder: () => dir,
      ffmpeg: () => "ffmpeg",
      probe: async () => probe,
      // ffmpeg writes part of the output, then the job is cancelled: the run rejects with an AbortError (as runFfmpeg does).
      run: (_bin, args, options) =>
        new Promise((_resolve, reject) => {
          fs.writeFileSync(args[args.length - 1], "half an mp4");
          options?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("ffmpeg cancelled"), { name: "AbortError" })));
          started();
        }),
      library,
      emit: () => {},
      log: () => {},
    });
    const saving = saver.save(request({ jobId: "job-1", name: "clip", transcode: spec }));
    await transcoding;
    expect(fs.readdirSync(path.join(dir, "out")).filter((f) => !f.startsWith("."))).toEqual(["clip.mp4"]);
    saver.cancel("job-1");
    await expect(saving).rejects.toThrow(/cancelled/);
    expect(fs.readdirSync(path.join(dir, "out"))).toEqual([]); // neither the partial clip nor the intermediate file
    // A timeout or a failed spawn rejects the same way: nothing is left either, and a retry saves under the clip's own name.
    const failing = new RenderSaver({ outputFolder: () => dir, ffmpeg: () => "ffmpeg", probe: async () => probe, run: async (_bin, args) => { fs.writeFileSync(args[args.length - 1], "x"); throw new Error("ffmpeg timed out"); }, library, emit: () => {}, log: () => {} });
    await expect(failing.save(request({ name: "clip", transcode: spec }))).rejects.toThrow(/timed out/);
    expect(fs.readdirSync(path.join(dir, "out"))).toEqual([]);
    expect(await library.list()).toEqual([]);
  });
});

// --- review fix (desktop-exe) --- the packaged app keeps node-llama-cpp's small llama/ files, and the smoke run checks the local AI starts
describe("packaging the local AI", () => {
  const builder = createRequire(import.meta.url)("../electron-builder.config.cjs") as { files: string[]; asarUnpack: string[] };

  it("ships llama/*.json and llama/grammars, leaving out only the source-build parts", () => {
    const llamaRules = builder.files.filter((f) => f.includes("node-llama-cpp/llama"));
    // node-llama-cpp's index reads llama/binariesGithubRelease.json while it loads: the whole folder must never be excluded.
    expect(llamaRules).not.toContain("!node_modules/node-llama-cpp/llama/**");
    expect(llamaRules.sort()).toEqual(
      ["!node_modules/node-llama-cpp/llama/gitRelease.bundle", "!node_modules/node-llama-cpp/llama/llama.cpp/**", "!node_modules/node-llama-cpp/llama/localBuilds/**", "!node_modules/node-llama-cpp/llama/xpack/**"].sort(),
    );
    for (const kept of ["binariesGithubRelease.json", "llama.cpp.info.json", "package.json", "grammars/json.gbnf"]) {
      const file = `node_modules/node-llama-cpp/llama/${kept}`;
      expect(llamaRules.some((rule) => file.startsWith(rule.slice(1).replace(/\*\*$/, ""))), file).toBe(false);
    }
  });

  it("reports the local AI ready when the module loads, its CPU backend starts and a grammar builds", async () => {
    const calls: string[] = [];
    const llama = {
      gpu: false as const,
      createGrammarForJsonSchema: async () => void calls.push("schema grammar"),
      getGrammarFor: async (t: string) => void calls.push(`grammar ${t}`),
      dispose: async () => void calls.push("dispose"),
    };
    const ok = await checkLocalAi(async () => ({ getLlama: async (o: unknown) => (calls.push(`getLlama ${JSON.stringify(o)}`), llama) }));
    expect(ok).toEqual({ ok: true, backend: "cpu", error: null });
    expect(calls).toEqual(['getLlama {"gpu":false,"build":"never"}', "schema grammar", "grammar json", "dispose"]);
  });

  it("builds the plain-JSON grammar from its own text where node-llama-cpp's grammars folder is out of reach (the asar archive)", async () => {
    const built: string[] = [];
    const llama = {
      getGrammarFor: async () => Promise.reject(new Error("Grammars folder not found")),
      createGrammar: async (o: { grammar: string }) => (built.push(o.grammar), { __grammar: true as const }),
    };
    await expect(jsonGrammar(llama)).resolves.toEqual({ __grammar: true });
    expect(built).toEqual([JSON_GBNF]);
    expect(built[0]).toMatch(/^root\s+::= object/);
    // The same text as node-llama-cpp's own json.gbnf, rule for rule (where the app's dependencies are installed).
    const ownPath = path.join(__dirname, "../node_modules/node-llama-cpp/llama/grammars/json.gbnf");
    const rules = (g: string) => g.replace(/#.*$/gm, "").replace(/\s+/g, " ").trim();
    if (fs.existsSync(ownPath)) expect(rules(JSON_GBNF)).toBe(rules(fs.readFileSync(ownPath, "utf8")));
  });

  it("fails the smoke check when the module cannot load (a package without llama/binariesGithubRelease.json)", async () => {
    const missing = await checkLocalAi(async () => {
      throw new Error("ENOENT, node_modules/node-llama-cpp/llama/binariesGithubRelease.json not found in app.asar");
    });
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/binariesGithubRelease\.json/);
    const noBackend = await checkLocalAi(async () => ({ getLlama: async () => Promise.reject(new Error("no prebuilt binary")) }));
    expect(noBackend).toEqual({ ok: false, backend: null, error: "no prebuilt binary" });
  });
});
