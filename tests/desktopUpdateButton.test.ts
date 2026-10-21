import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import { UPDATE_MANUAL_NONE, type UpdateStatus } from "@/lib/desktop/contract";
import { UPDATE_LATEST_NOTE_MS, checkFoundNothing, manualCheckAnswered, pageMakesVideo, queueMakesVideo, updateButtonBusy, updateButtonModel, updateReadyKey, updateWaitKey } from "@/lib/desktop/updateButton";
import { UpdateButtonView, useUpdateCheck, type UpdateButtonViewProps } from "@/components/simulator/desktop/UpdateButton";
import GpuPanel from "@/components/simulator/desktop/GpuPanel";
import { pageUrl } from "@/lib/site";

/*
 * --- manual-update --- The Windows app's update button in the Desktop group's top bar: its label and look for every state of
 * the updater, Restart and update only once the update is downloaded and never while a clip renders, no second check while one
 * is asked for, the Download page after an error and for a build that cannot update itself, the strings in three languages,
 * and its place in the top bar (on every tab).
 */

(globalThis as { React?: unknown }).React = React; // (vitest compiles .tsx with the classic JSX runtime)

type Messages = typeof en;
const LOCALES: Record<string, Messages> = { en, pl: pl as unknown as Messages, es: es as unknown as Messages };
const DOWNLOAD = pageUrl("en", "/download");
const status = (state: UpdateStatus["state"], extra: Partial<UpdateStatus> = {}): UpdateStatus => ({ state, version: null, progress: null, message: null, ...extra });
const render = (props: Partial<UpdateButtonViewProps> & { status: UpdateStatus | null }, locale = "en") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: LOCALES[locale], timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>,
      createElement(UpdateButtonView, { downloadUrl: DOWNLOAD, onCheck: () => {}, onInstall: () => {}, ...props }),
    ),
  );
/** The rendered element that carries `data-testid`, and its text. */
const tag = (html: string, testId: string) => html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
const text = (html: string, testId: string) => html.match(new RegExp(`<([a-z]+)[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</\\1>`))?.[2].replace(/<[^>]+>/g, "") ?? "";
const disabled = (t: string) => /\sdisabled(=""|\s|>)/.test(t);
/** Busy: aria-disabled, not the native `disabled` (which drops a keyboard user's focus to the page). */
const ariaDisabled = (t: string) => t.includes('aria-disabled="true"');
const B = "desktop-update-button";

describe("the update button's states", () => {
  it("names every state of the updater", () => {
    const d = Desktop("en");
    const cases: [UpdateStatus | null, string][] = [
      [null, en.Desktop.appCheckUpdates],
      [status("idle"), en.Desktop.appCheckUpdates],
      [status("none"), en.Desktop.appCheckUpdates],
      [status("checking"), d.checking],
      [status("available", { version: "1.5.0", progress: 0 }), "Downloading 0%"],
      [status("downloading", { version: "1.5.0", progress: 0.426 }), "Downloading 43%"],
      [status("ready", { version: "1.5.0", progress: 1 }), en.Desktop.appRestartUpdate],
      [status("error", { message: "offline" }), d.retry],
      [status("disabled", { message: "portable" }), d.getLatest],
    ];
    for (const [s, label] of cases) expect(text(render({ status: s }), B), s?.state ?? "unknown").toBe(label);
    expect(d.checking).toBe("Checking…");
  });

  it("is busy while it checks and downloads, and offers Restart and update only once the update is downloaded", () => {
    for (const state of ["checking", "available", "downloading"] as const) {
      const html = render({ status: status(state, { progress: 0.5 }) });
      // --- manual-update --- busy keeps the focus: aria-disabled, never the native disabled
      expect(ariaDisabled(tag(html, B)), state).toBe(true);
      expect(disabled(tag(html, B)), state).toBe(false);
      expect(tag(html, B)).toContain('aria-busy="true"');
      expect(updateButtonBusy(updateButtonModel(status(state)))).toBe(true);
    }
    for (const state of ["idle", "none", "error"] as const) {
      const m = updateButtonModel(status(state));
      expect(m.kind === "install", state).toBe(false);
      expect(disabled(tag(render({ status: status(state) }), B)), state).toBe(false);
      expect(ariaDisabled(tag(render({ status: status(state) }), B)), state).toBe(false);
    }
    const ready = status("ready", { version: "1.5.0", progress: 1 });
    expect(updateButtonModel(ready)).toMatchObject({ kind: "install", enabled: true, note: null });
    const html = render({ status: ready });
    expect(tag(html, B)).toContain('data-update-kind="install"');
    expect(disabled(tag(html, B))).toBe(false);
    expect(tag(html, B)).toContain(`title="${en.Desktop.update.ready.replace("{version}", "1.5.0")}"`);
  });

  it("calls install on Restart and update and check on every other button", () => {
    const calls: string[] = [];
    // the click handler the view puts on its button (markup has no handlers, so it is read from the element the view returns)
    const click = (s: UpdateStatus) => {
      const root = viewWithIntl(() => UpdateButtonView({ status: s, downloadUrl: DOWNLOAD, onCheck: () => calls.push("check"), onInstall: () => calls.push("install") }) as React.ReactElement<{ children: React.ReactNode }>);
      const button = React.Children.toArray(root.props.children)[0] as React.ReactElement<{ onClick?: () => void }>;
      button.props.onClick?.();
    };
    click(status("ready", { version: "1.5.0", progress: 1 }));
    click(status("idle"));
    click(status("error", { message: "boom" }));
    // a busy button keeps its focus and ignores the click
    click(status("checking"));
    click(status("downloading", { progress: 0.4 }));
    expect(calls).toEqual(["install", "check", "check"]);
  });

  it("keeps Restart and update unclickable while a clip renders, with the existing wait note", () => {
    const ready = status("ready", { version: "1.5.0", progress: 1 });
    expect(updateButtonModel(ready, { rendering: true })).toMatchObject({ kind: "install", enabled: false, note: "waitRender" });
    const html = render({ status: ready, rendering: true });
    // --- manual-update --- the download can end while a keyboard user waits on the button (Checking…, Downloading N %): the
    // same button turns into Restart and update and keeps the focus, aria-disabled and without a click, never natively disabled
    expect(updateButtonBusy(updateButtonModel(ready, { rendering: true }))).toBe(true);
    expect(ariaDisabled(tag(html, B))).toBe(true);
    expect(disabled(tag(html, B))).toBe(false);
    expect(tag(html, B)).not.toContain("aria-busy"); // waiting for a render, not working on the update
    expect(tag(html, B)).toContain(`title="${en.Desktop.updateWaitRender}"`);
    expect(text(html, "desktop-update-note")).toBe(en.Desktop.updateWaitRender);
    // the update banner shows the same note while it is open: the top bar then keeps it in the tooltip only
    const quiet = render({ status: ready, rendering: true, waitHint: false });
    expect(ariaDisabled(tag(quiet, B))).toBe(true);
    expect(disabled(tag(quiet, B))).toBe(false);
    expect(text(quiet, "desktop-update-note")).toBe("");
    // and the button has no native disabled in any state: every unclickable one passes
    for (const s of [status("idle"), status("none"), status("checking"), status("downloading", { progress: 0.2 }), ready, status("error", { message: "offline" })]) {
      for (const ctx of [{}, { rendering: true }, { asking: true }]) expect(disabled(tag(render({ status: s, ...ctx }), B)), `${s.state} ${JSON.stringify(ctx)}`).toBe(false);
    }
    // its look dims the same way under aria-disabled
    const component = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "UpdateButton.tsx"), "utf8");
    expect(component).toMatch(/install: `[^`]*aria-disabled:opacity-40`/);
  });

  // --- manual-update --- quitting installs a downloaded update only while "Update automatically" is on (desktop/src/updater.ts
  // prepareQuit()): with it off, no control may tell the user to quit for it
  it("words the wait note by the preference: off, it points at Restart and update and never at quitting", () => {
    expect(updateWaitKey(true)).toBe("updateWaitRender");
    expect(updateWaitKey(false)).toBe("updateWaitRenderManual");
    const ready = status("ready", { version: "1.5.0", progress: 1 });
    for (const locale of ["en", "pl", "es"]) {
      const d = LOCALES[locale].Desktop as Record<string, unknown>;
      const manual = String(d.updateWaitRenderManual);
      // the manual note names the button it waits for and says nothing of quitting or closing the app
      expect(manual, locale).toContain(String(d.appRestartUpdate));
      expect(manual, locale).not.toMatch(/quit|clos|zamk|cierr|cerr/i);
      expect(manual, locale).not.toMatch(/—| – |;/);
      expect(manual, locale).not.toMatch(/queue|kolejk|cola/i);
      const html = render({ status: ready, rendering: true, autoUpdate: false }, locale);
      expect(text(html, "desktop-update-note"), locale).toBe(manual);
      expect(tag(html, B), locale).toContain(`title="${manual}"`);
      // on, the note keeps the install as the app closes
      expect(text(render({ status: ready, rendering: true }, locale), "desktop-update-note"), locale).toBe(String(d.updateWaitRender));
    }
    // the section hands the preference to the top bar, the banner and the GPU tab
    const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", ...p), "utf8");
    const section = read("sections", "DesktopSection.tsx");
    expect(section).toMatch(/<UpdateButton [^>]*autoUpdate=\{prefs\.autoUpdate\}[^>]*\/>/);
    expect(section).toMatch(/\{rendering && <span id="desktop-update-wait-banner" className="basis-full text-ink-3">\{t\(updateWaitKey\(prefs\.autoUpdate\)\)\}<\/span>\}/);
    expect(read("desktop", "GpuPanel.tsx")).toMatch(/\{update\?\.state === "ready" && rendering && \(\s+<p id="desktop-update-wait-gpu" className="text-xs text-ink-3" data-testid="desktop-gpu-update-wait">\s+\{t\(updateWaitKey\(prefs\.autoUpdate\)\)\}/);
    for (const file of [section, read("desktop", "GpuPanel.tsx"), read("desktop", "UpdateButton.tsx")]) expect(file).not.toMatch(/t\("updateWaitRender"\)/);
  });

  // --- manual-update --- the "update ready" line (the banner, the GPU tab, the button's tooltip) follows the same rule: with the
  // preference off, quitting does not install, so it names Restart and update and never says to restart or quit the app
  it("words the update ready line by the preference: off, it names Restart and update", () => {
    expect(updateReadyKey(true)).toBe("update.ready");
    expect(updateReadyKey(false)).toBe("update.readyManual");
    const ready = status("ready", { version: "1.5.0", progress: 1 });
    for (const locale of ["en", "pl", "es"]) {
      const d = LOCALES[locale].Desktop as unknown as { appRestartUpdate: string; update: Record<string, string> };
      const manual = d.update.readyManual;
      expect(manual, locale).toContain("{version}");
      expect(manual, locale).toContain(d.appRestartUpdate);
      expect(manual.replace(d.appRestartUpdate, ""), locale).not.toMatch(/restart|quit|clos|uruchom|zamk|reinicia|cierr|cerr/i);
      expect(manual, locale).not.toMatch(/—| – |;/);
      expect(tag(render({ status: ready, autoUpdate: false }, locale), B), locale).toContain(`title="${manual.replace("{version}", "1.5.0")}"`);
      expect(tag(render({ status: ready }, locale), B), locale).toContain(`title="${d.update.ready.replace("{version}", "1.5.0")}"`);
    }
    expect(Object.keys(pl.Desktop.update).sort()).toEqual(Object.keys(en.Desktop.update).sort());
    expect(Object.keys(es.Desktop.update).sort()).toEqual(Object.keys(en.Desktop.update).sort());
    const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", ...p), "utf8");
    expect(read("sections", "DesktopSection.tsx")).toContain("{t(updateReadyKey(prefs.autoUpdate), { version: update.version, progress: 100 })}");
    expect(read("desktop", "GpuPanel.tsx")).toContain('t(update.state === "ready" ? updateReadyKey(prefs.autoUpdate) : `update.${update.state}`,');
    for (const file of [read("sections", "DesktopSection.tsx"), read("desktop", "GpuPanel.tsx"), read("desktop", "UpdateButton.tsx")]) expect(file).not.toMatch(/t\("update\.ready"/);
  });

  // --- manual-update --- the page's own fast export, Record video and batch are no queue jobs: a restart would lose them too
  it("waits for the page's own fast export, recording or batch, not for Find Simulation or the engine", () => {
    const idle = { recording: false, fastExport: { status: "idle" }, batchRun: { status: "idle" } };
    expect(pageMakesVideo(idle)).toBe(false);
    expect(pageMakesVideo({ ...idle, recording: true })).toBe(true);
    expect(pageMakesVideo({ ...idle, fastExport: { status: "running" } })).toBe(true);
    for (const status of ["running", "stopping"]) expect(pageMakesVideo({ ...idle, batchRun: { status } }), status).toBe(true);
    for (const status of ["done", "error", "cancelled", "fallback"]) expect(pageMakesVideo({ ...idle, fastExport: { status } }), status).toBe(false);
    for (const status of ["finished", "stopped"]) expect(pageMakesVideo({ ...idle, batchRun: { status } }), status).toBe(false);
    // the page hands its recording flag over; the section counts the page's work in the gate of every update control
    const page = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "Simulator.tsx"), "utf8");
    expect(page).toMatch(/const desktopPage: DesktopPageHooks = \{[\s\S]*?recording: isRecording,/);
    const section = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "sections", "DesktopSection.tsx"), "utf8");
    expect(section).toMatch(/const rendering = queueRendering \|\| pageMakesVideo\(page\);/);
    // the queue tab's dot stays the queue's own
    expect(section).toMatch(/id === "queue" && \(queueRendering \|\| queue\.state\.jobs\.some/);
    // the wait note names no queue: the work may be the page's
    for (const locale of ["en", "pl", "es"]) expect(LOCALES[locale].Desktop.updateWaitRender, locale).not.toMatch(/queue|kolejk|cola/i);
  });

  it("does not let a second click start a second check while the first is asked for", () => {
    expect(updateButtonModel(status("idle"), { asking: true })).toMatchObject({ kind: "check", enabled: false });
    expect(updateButtonModel(null, { asking: true }).enabled).toBe(false);
    expect(updateButtonModel(status("error"), { asking: true })).toMatchObject({ kind: "retry", enabled: false });
    // --- manual-update --- Try again while still offline: the updater answers with the same "offline" at once, so the note
    // empties while the click is asked and fills again with the answer, and the live region says it again
    const offline = status("error", { message: "offline" });
    expect(updateButtonModel(offline, { asking: true })).toMatchObject({ kind: "retry", enabled: false, note: null, downloadLink: true });
    expect(text(render({ status: offline, asking: true }), "desktop-update-note")).toBe("");
    expect(tag(render({ status: offline, asking: true }), "desktop-update-note")).toContain('aria-live="polite"');
    expect(text(render({ status: offline }), "desktop-update-note")).toBe("You are offline");
    expect(updateButtonModel(status("error", { message: "HttpError: 502" }), { asking: true }).note).toBeNull();
    const asked = tag(render({ status: status("idle"), asking: true }), B);
    expect(ariaDisabled(asked)).toBe(true);
    expect(disabled(asked)).toBe(false);
    expect(updateButtonBusy(updateButtonModel(status("idle"), { asking: true }), true)).toBe(true);
    // the component itself: one check until the answer comes back (the Desktop group's, shared with the GPU tab)
    const component = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "UpdateButton.tsx"), "utf8");
    expect(component).toMatch(/if \(asking\) return;\s+setJustChecked\(false\);\s+onCheck\(\);/);
  });

  // --- manual-update --- one manual check for every control: a second click anywhere while it is asked starts nothing
  it("asks one check at a time, whichever control asked", async () => {
    let calls = 0;
    let answer: () => void = () => {};
    const bridge = { update: { check: () => ((calls += 1), new Promise<void>((resolve) => (answer = resolve))) } } as unknown as Parameters<typeof useUpdateCheck>[0];
    const { check } = viewWithIntl(() => useUpdateCheck(bridge));
    check();
    check();
    expect(calls).toBe(1);
    answer();
    await new Promise((r) => setTimeout(r, 0));
    check();
    expect(calls).toBe(2);
  });

  // --- manual-update --- the GPU tab's Check for updates pressed again while offline: the updater answers the same "offline"
  // at once, with no "checking" between. The check is the Desktop group's, shared with the top bar: while it is asked the top
  // bar's live region and the GPU tab's Updates row empty, so the answer is shown and said again
  it("answers the GPU tab's Check for updates again while offline, through the top bar's live region", () => {
    const offline = status("error", { message: "offline" });
    const prefs = { ffmpegPath: "", autoUpdate: true, closeToTray: false, encoderOverride: "", preferHardware: true } as unknown as React.ComponentProps<typeof GpuPanel>["prefs"];
    const bridge = {} as React.ComponentProps<typeof GpuPanel>["bridge"];
    const gpu = (updateAsking: boolean) =>
      renderToStaticMarkup(
        createElement(
          NextIntlClientProvider,
          { locale: "en", messages: en, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>,
          createElement(GpuPanel, { bridge, prefs, info: null, update: offline, updateAsking, onCheckUpdates: () => {}, onPrefs: () => {} }),
        ),
      );
    const row = (html: string) => html.match(/<dd[^>]*data-testid="desktop-update"[^>]*>([^<]*)<\/dd>/)?.[1];
    const button = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?Check for updates<\/button>/)?.[0] ?? "";
    expect(row(gpu(false))?.replace(/&#x27;/g, "'")).toBe(en.Desktop.update.error);
    expect(ariaDisabled(button(gpu(false)))).toBe(false);
    expect(row(gpu(true))).toBe("…");
    expect(ariaDisabled(button(gpu(true)))).toBe(true);
    // the top bar's note empties too while that check is asked, and says "You are offline" again once it is answered
    expect(text(render({ status: offline, asking: true }), "desktop-update-note")).toBe("");
    expect(text(render({ status: offline }), "desktop-update-note")).toBe("You are offline");
    // the GPU tab's button runs the shared check
    const onCheckUpdates = () => {};
    const found: React.ReactElement<{ onClick?: unknown; children?: React.ReactNode }>[] = [];
    const walk = (node: React.ReactNode) =>
      React.Children.forEach(node, (child) => {
        if (!React.isValidElement(child)) return;
        const el = child as React.ReactElement<{ onClick?: unknown; children?: React.ReactNode }>;
        if (el.type === "button" && React.Children.toArray(el.props.children).includes(en.Desktop.appCheckUpdates)) found.push(el);
        walk(el.props.children);
      });
    walk(viewWithIntl(() => GpuPanel({ bridge, prefs, info: null, update: offline, updateAsking: false, onCheckUpdates, onPrefs: () => {} })));
    expect(found).toHaveLength(1);
    expect(found[0].props.onClick).toBe(onCheckUpdates);
    // both controls are handed the one check
    const section = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "sections", "DesktopSection.tsx"), "utf8");
    expect(section).toContain("const updateCheck = useUpdateCheck(bridge);");
    expect(section).toContain("asking={updateCheck.asking} onCheck={updateCheck.check} />");
    expect(section).toContain("updateAsking={updateCheck.asking} onCheckUpdates={updateCheck.check}");
  });

  // --- manual-update --- an update already downloaded leaves nothing to check: the updater answers a check with the same
  // "ready" and no change, so the GPU tab's Check for updates waits (aria-disabled, no click) and names the Updates row, which
  // says how to install it, as its description. Nothing is pressed that answers with silence.
  it("keeps the GPU tab's Check for updates waiting once an update is downloaded, described by the Updates row", () => {
    const bridge = {} as React.ComponentProps<typeof GpuPanel>["bridge"];
    const ready = status("ready", { version: "1.4.0" });
    for (const [locale, autoUpdate] of [["en", true], ["en", false], ["pl", false], ["es", true]] as const) {
      const prefs = { ffmpegPath: "", autoUpdate, closeToTray: false, encoderOverride: "", preferHardware: true } as unknown as React.ComponentProps<typeof GpuPanel>["prefs"];
      const messages = LOCALES[locale];
      const html = renderToStaticMarkup(
        createElement(
          NextIntlClientProvider,
          { locale, messages, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>,
          createElement(GpuPanel, { bridge, prefs, info: null, update: ready, updateAsking: false, onCheckUpdates: () => {}, onPrefs: () => {} }),
        ),
      );
      const label = messages.Desktop.appCheckUpdates;
      const button = html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? "";
      expect(button, locale).not.toBe("");
      expect(ariaDisabled(button), locale).toBe(true);
      expect(disabled(button), locale).toBe(false); // the focus stays on it
      expect(button, locale).toContain('aria-describedby="desktop-update-row"');
      const row = html.match(/<dd id="desktop-update-row"[^>]*>([^<]*)<\/dd>/)?.[1];
      const line = (autoUpdate ? messages.Desktop.update.ready : messages.Desktop.update.readyManual).replace("{version}", "1.4.0");
      expect(row, locale).toBe(line);
    }
    // the click does nothing while it waits
    const prefs = { ffmpegPath: "", autoUpdate: false, closeToTray: false, encoderOverride: "", preferHardware: true } as unknown as React.ComponentProps<typeof GpuPanel>["prefs"];
    const found: React.ReactElement<{ onClick?: unknown; children?: React.ReactNode }>[] = [];
    const walk = (node: React.ReactNode) =>
      React.Children.forEach(node, (child) => {
        if (!React.isValidElement(child)) return;
        const el = child as React.ReactElement<{ onClick?: unknown; children?: React.ReactNode }>;
        if (el.type === "button" && React.Children.toArray(el.props.children).includes(en.Desktop.appCheckUpdates)) found.push(el);
        walk(el.props.children);
      });
    walk(viewWithIntl(() => GpuPanel({ bridge, prefs, info: null, update: ready, updateAsking: false, onCheckUpdates: () => {}, onPrefs: () => {} })));
    expect(found).toHaveLength(1);
    expect(found[0].props.onClick).toBeUndefined();
    // any other state leaves it with no description
    for (const state of ["none", "error", "checking"] as const) {
      const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, createElement(GpuPanel, { bridge, prefs, info: null, update: status(state), updateAsking: false, onCheckUpdates: () => {}, onPrefs: () => {} })));
      expect(html.match(/<button[^>]*>Check for updates<\/button>/)?.[0], state).not.toContain("aria-describedby");
    }
  });

  // --- manual-update --- between two queue jobs nothing renders for a moment: the wait must not end and start again per clip
  it("keeps waiting between two queue jobs, and stops when the queue does", () => {
    const job = (status: string) => ({ status });
    expect(queueMakesVideo({ running: true, jobs: [job("done"), job("queued")] }, null)).toBe(true);
    expect(queueMakesVideo({ running: true, jobs: [job("rendering"), job("queued")] }, null)).toBe(true);
    expect(queueMakesVideo({ running: false, jobs: [job("encoding")] }, null)).toBe(true);
    expect(queueMakesVideo({ running: false, jobs: [job("done")] }, { jobId: "a", progress: 0.4 })).toBe(true);
    // paused with jobs left, or run to its end: nothing is being made
    expect(queueMakesVideo({ running: false, jobs: [job("done"), job("queued")] }, null)).toBe(false);
    expect(queueMakesVideo({ running: true, jobs: [job("done"), job("failed"), job("cancelled")] }, null)).toBe(false);
    expect(queueMakesVideo({ running: false, jobs: [] }, null)).toBe(false);
    // the wait note stays, so its live region says it once for the whole run
    const ready = status("ready", { version: "1.5.0", progress: 1 });
    expect(updateButtonModel(ready, { rendering: queueMakesVideo({ running: true, jobs: [job("done"), job("queued")] }, null) }).note).toBe("waitRender");
    const section = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "sections", "DesktopSection.tsx"), "utf8");
    expect(section).toContain("const queueRendering = queueMakesVideo(queue.state, queue.cutting);");
  });

  it("says when the app is up to date, for a moment after a check", () => {
    expect(UPDATE_LATEST_NOTE_MS).toBeGreaterThanOrEqual(3000);
    expect(UPDATE_LATEST_NOTE_MS).toBeLessThanOrEqual(10_000);
    const html = render({ status: status("none"), justChecked: true });
    expect(text(html, "desktop-update-note")).toBe("You have the latest version");
    expect(text(html, B)).toBe(en.Desktop.appCheckUpdates);
    expect(disabled(tag(html, B))).toBe(false);
    expect(text(render({ status: status("none") }), "desktop-update-note")).toBe("");
  });

  // --- manual-update --- the quiet schedule passes through "checking" too, and puts a failed check back to the "none" it found
  // (desktop/tests/app.test.ts: none, checking, none): only the "none" the updater marks as a manual check's answer says
  // "latest", whichever control asked (this button, the Help menu, the GPU tab), on whatever tab is open
  it("says it for every manual check, the Help menu's included, and never for the schedule's", () => {
    expect(UPDATE_MANUAL_NONE).toBe("manual");
    expect(checkFoundNothing(status("none", { message: UPDATE_MANUAL_NONE }))).toBe(true);
    for (const s of [status("none"), status("checking"), status("available", { progress: 0 }), status("downloading", { progress: 0.2 }), status("ready", { progress: 1 }), status("error", { message: "offline" }), status("error", { message: UPDATE_MANUAL_NONE }), status("idle"), status("disabled"), null, undefined]) expect(checkFoundNothing(s), `${s?.state ?? String(s)} ${s?.message ?? ""}`).toBe(false);
    // a "none" the page did not ask for (the schedule's, a failed quiet check put back) shows no note
    for (const s of [status("checking"), status("none")]) expect(text(render({ status: s }), "desktop-update-note")).toBe("");
    const component = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "UpdateButton.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // no watching the status for a bare change from "checking" to "none": the note follows the updater's mark on the status
    expect(component).not.toMatch(/prevState|before === "checking"|state !== "none"/);
    expect(component).toMatch(/useEffect\(\(\) => \{\s+const previous = seen\.current;\s+seen\.current = update;\s+if \(!manualCheckAnswered\(previous, update\)\) return;\s+setJustChecked\(true\);\s+const timer = setTimeout\(\(\) => setJustChecked\(false\), UPDATE_LATEST_NOTE_MS\);\s+return \(\) => \{\s+clearTimeout\(timer\);\s+setJustChecked\(false\);\s+\};\s+\}, \[update\]\);/);
    expect(component).toMatch(/const seen = useRef<UpdateStatus \| null>\(null\);/);
    expect(component.match(/setJustChecked\(true\)/g)).toHaveLength(1);
    // the click only asks: its answer comes back as the same marked status
    expect(component).toMatch(/bridge\.update\s+\.check\(\)\s+\.catch\(\(\) => \{\}\)\s+\.finally\(\(\) => \{\s+askingRef\.current = false;\s+setAsking\(false\);\s+\}\);/);
  });

  // --- manual-update --- the updater keeps a manual check's marked "none" until the next check, maybe hours later: the page
  // reads it again on every mount (a reload, a language switch, coming back to the simulator), and that is no answer to say
  it("says it only for an answer that arrives while the button is there, never for the old one a mount reads back", () => {
    const marked = status("none", { message: UPDATE_MANUAL_NONE });
    /** The statuses the button gets one after another, from its mount: whether each one shows the note (the effect's rule). */
    const notes = (...seq: (UpdateStatus | null)[]) => {
      let seen: UpdateStatus | null = null;
      return seq.map((next) => {
        const previous = seen;
        seen = next;
        return manualCheckAnswered(previous, next);
      });
    };
    // mounted with the old marked status in hand, or with nothing yet and then the old status: no note
    expect(notes(marked)).toEqual([false]);
    expect(notes(null, marked)).toEqual([false, false]);
    // a check while it is there: "checking" first, then the answer says "latest" (the menu's check the same way)
    expect(notes(marked, status("checking"), status("none"), marked)).toEqual([false, false, false, true]);
    expect(notes(null, status("idle"), status("checking"), marked)).toEqual([false, false, false, true]);
    // the same answer again (an unrelated re-read) is no new answer
    expect(notes(status("checking"), marked, marked)).toEqual([false, true, false]);
    // the schedule's "none" and an error never say it
    expect(notes(status("checking"), status("none"), status("checking"), status("error", { message: "offline" }))).toEqual([false, false, false, false]);
  });

  // --- manual-update --- the live region is mounted before its text: one inserted already filled is often not read out
  it("keeps the note's live region mounted, only its text changes", () => {
    for (const s of [status("idle"), status("checking"), status("downloading", { progress: 0.3 }), status("none"), null]) {
      const html = render({ status: s });
      const note = tag(html, "desktop-update-note");
      expect(note, s?.state ?? "null").toContain('role="status"');
      expect(note).toContain('aria-live="polite"');
      expect(note).not.toContain("data-note=");
      expect(text(html, "desktop-update-note")).toBe("");
    }
    const latest = tag(render({ status: status("none"), justChecked: true }), "desktop-update-note");
    expect(latest).toContain('role="status"');
    expect(latest).toContain('data-note="latest"');
  });

  it("offers Try again and the Download page after an error", () => {
    for (const [message, note] of [
      ["offline", "You are offline"],
      ["net::ERR_CONNECTION_RESET", "Update check failed"],
    ] as const) {
      const html = render({ status: status("error", { message }) });
      expect(text(html, B)).toBe("Try again");
      expect(disabled(tag(html, B))).toBe(false);
      expect(text(html, "desktop-update-note")).toBe(note);
      expect(tag(html, "desktop-update-note")).toContain(`title="${message}"`);
      const link = tag(html, "desktop-update-download");
      expect(link).toContain(`href="${DOWNLOAD}"`);
      expect(link).toContain('target="_blank"'); // the app opens it in the system browser (main.ts setWindowOpenHandler)
      expect(text(html, "desktop-update-download")).toBe("Download page");
    }
    expect(DOWNLOAD).toMatch(/\/en\/download\/$/);
  });

  it("says honestly that the portable app and a development run do not update themselves, and links the Download page", () => {
    for (const [message, note] of [
      ["portable", "The portable app does not update itself"],
      ["development build", "This build does not update itself"],
      ["off", "This build does not update itself"],
    ] as const) {
      const s = status("disabled", { message });
      expect(updateButtonModel(s)).toMatchObject({ kind: "unsupported", downloadLink: true });
      const html = render({ status: s });
      const control = tag(html, B);
      expect(control.startsWith("<a "), message).toBe(true); // a link, never a check button that would do nothing
      expect(control).toContain(`href="${DOWNLOAD}"`);
      expect(control).toContain('target="_blank"');
      expect(html).not.toContain("<button");
      expect(text(html, B)).toBe("Get the latest version");
      expect(text(html, "desktop-update-note")).toBe(note);
      expect(tag(html, "desktop-update-download")).toBe(""); // the control is the link already
    }
  });

  it("reads in Polish and Spanish", () => {
    for (const locale of ["pl", "es"]) {
      const d = Desktop(locale);
      expect(text(render({ status: status("downloading", { progress: 0.5 }) }, locale), B)).toBe(d.downloading.replace("{progress}", "50"));
      expect(text(render({ status: status("none"), justChecked: true }, locale), "desktop-update-note")).toBe(d.latest);
      expect(text(render({ status: status("disabled", { message: "portable" }) }, locale), "desktop-update-note")).toBe(d.portable);
      expect(text(render({ status: status("error", { message: "offline" }) }, locale), "desktop-update-download")).toBe(d.website);
    }
  });
});

describe("the update button's strings", () => {
  it("are in every language, translated, without dashes or semicolons", () => {
    const keys = Object.keys(Desktop("en")).sort();
    expect(keys).toEqual(["checking", "devBuild", "downloading", "failed", "getLatest", "latest", "offline", "portable", "retry", "website"]);
    for (const locale of ["pl", "es"]) {
      const d = Desktop(locale);
      expect(Object.keys(d).sort(), locale).toEqual(keys);
      for (const key of keys) if (key !== "downloading") expect(d[key], `${locale}.${key}`).not.toBe(Desktop("en")[key]);
      expect(d.downloading).toContain("{progress}");
    }
    for (const locale of ["en", "pl", "es"]) for (const [key, value] of Object.entries(Desktop(locale))) expect(value, `${locale}.${key}`).not.toMatch(/—| – |;/);
  });
});

describe("the update button's place", () => {
  it("sits in the Desktop group's top bar, outside the tabs, with the live status and the render rule", () => {
    const section = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "sections", "DesktopSection.tsx"), "utf8");
    const top = section.slice(section.indexOf('role="tablist"'), section.indexOf("desktop-update-banner"));
    expect(top).toContain("<UpdateButton bridge={bridge} update={update} rendering={rendering} waitHint={!updateBanner} autoUpdate={prefs.autoUpdate} asking={updateCheck.asking} onCheck={updateCheck.check} />");
    expect(top.indexOf("<UpdateButton")).toBeLessThan(top.indexOf("pick(kind)"));
    expect(section.slice(section.indexOf('{tab === "gpu"'))).not.toContain("<UpdateButton");
    // the GPU panel's App card keeps its own buttons, under the same rules
    const gpu = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "GpuPanel.tsx"), "utf8");
    // --- manual-update --- its Restart and update, and the banner's, wait for a render the top bar's way: aria-disabled and no
    // click, never the native disabled (a keyboard user waiting on it keeps the focus), the wait note a visible line it names
    for (const [file, id] of [[gpu, "desktop-update-wait-gpu"], [section, "desktop-update-wait-banner"]] as const) {
      expect(file).toMatch(new RegExp(`className=\\{primaryBtn\\} aria-disabled=\\{rendering \\|\\| undefined\\} aria-describedby=\\{rendering \\? "${id}" : undefined\\} onClick=\\{rendering \\? undefined : \\(\\) => void bridge\\.update\\.install\\(\\)\\}`));
      expect(file).not.toMatch(/disabled=\{rendering\}/);
    }
    // its Check for updates keeps a keyboard user's focus while busy too: aria-disabled and no click, native disabled only for a build that cannot update
    expect(gpu).toMatch(/const updateBusy = updateAsking \|\| update\?\.state === "checking" \|\| update\?\.state === "available" \|\| update\?\.state === "downloading" \|\| updateReady;/);
    expect(gpu).toMatch(/disabled=\{update\?\.state === "disabled"\} aria-disabled=\{updateBusy \|\| undefined\} aria-describedby=\{updateReady \? "desktop-update-row" : undefined\} onClick=\{updateBusy \? undefined : onCheckUpdates\}/);
    expect(fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "ui.tsx"), "utf8")).toMatch(/export const btn = "[^"]*aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"/);
    expect(section).toContain("rendering={rendering} updateAsking={updateCheck.asking} onCheckUpdates={updateCheck.check} onPrefs={changePrefs}");
  });
});

function Desktop(locale: string): Record<string, string> {
  return (LOCALES[locale].Desktop as unknown as { updateButton: Record<string, string> }).updateButton;
}

/** Calls a view inside an intl context so its hooks resolve (for reading the click handlers of the element it returns). */
function viewWithIntl<T>(fn: () => T): T {
  let out: T | undefined;
  const Probe = () => {
    out = fn();
    return null;
  };
  renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, createElement(Probe)));
  return out as T;
}
