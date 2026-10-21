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
import type { UpdateStatus } from "@/lib/desktop/contract";
import { UPDATE_LATEST_NOTE_MS, updateButtonModel } from "@/lib/desktop/updateButton";
import { UpdateButtonView, type UpdateButtonViewProps } from "@/components/simulator/desktop/UpdateButton";
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
      expect(disabled(tag(html, B)), state).toBe(true);
      expect(tag(html, B)).toContain('aria-busy="true"');
    }
    for (const state of ["idle", "none", "error"] as const) {
      const m = updateButtonModel(status(state));
      expect(m.kind === "install", state).toBe(false);
      expect(disabled(tag(render({ status: status(state) }), B)), state).toBe(false);
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
    expect(calls).toEqual(["install", "check", "check"]);
  });

  it("keeps Restart and update disabled while a clip renders, with the existing wait note", () => {
    const ready = status("ready", { version: "1.5.0", progress: 1 });
    expect(updateButtonModel(ready, { rendering: true })).toMatchObject({ kind: "install", enabled: false, note: "waitRender" });
    const html = render({ status: ready, rendering: true });
    expect(disabled(tag(html, B))).toBe(true);
    expect(tag(html, B)).toContain(`title="${en.Desktop.updateWaitRender}"`);
    expect(text(html, "desktop-update-note")).toBe(en.Desktop.updateWaitRender);
    // the update banner shows the same note while it is open: the top bar then keeps it in the tooltip only
    const quiet = render({ status: ready, rendering: true, waitHint: false });
    expect(disabled(tag(quiet, B))).toBe(true);
    expect(tag(quiet, "desktop-update-note")).toBe("");
  });

  it("does not let a second click start a second check while the first is asked for", () => {
    expect(updateButtonModel(status("idle"), { asking: true })).toMatchObject({ kind: "check", enabled: false });
    expect(updateButtonModel(null, { asking: true }).enabled).toBe(false);
    expect(updateButtonModel(status("error"), { asking: true })).toMatchObject({ kind: "retry", enabled: false });
    expect(disabled(tag(render({ status: status("idle"), asking: true }), B))).toBe(true);
    // the component itself: one check until the answer comes back
    const component = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "UpdateButton.tsx"), "utf8");
    expect(component).toMatch(/if \(asking\) return;\s+setAsking\(true\);\s+bridge\.update\s+\.check\(\)/);
    expect(component).toContain(".finally(() => setAsking(false))");
  });

  it("says when the app is up to date, for a moment after a check", () => {
    expect(UPDATE_LATEST_NOTE_MS).toBeGreaterThanOrEqual(3000);
    expect(UPDATE_LATEST_NOTE_MS).toBeLessThanOrEqual(10_000);
    const html = render({ status: status("none"), justChecked: true });
    expect(text(html, "desktop-update-note")).toBe("You have the latest version");
    expect(text(html, B)).toBe(en.Desktop.appCheckUpdates);
    expect(disabled(tag(html, B))).toBe(false);
    expect(tag(render({ status: status("none") }), "desktop-update-note")).toBe("");
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
    expect(top).toContain("<UpdateButton bridge={bridge} update={update} rendering={rendering} waitHint={!updateBanner} />");
    expect(top.indexOf("<UpdateButton")).toBeLessThan(top.indexOf("pick(kind)"));
    expect(section.slice(section.indexOf('{tab === "gpu"'))).not.toContain("<UpdateButton");
    // the GPU panel's App card keeps its own buttons, under the same rules
    const gpu = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "GpuPanel.tsx"), "utf8");
    expect(gpu).toMatch(/disabled=\{rendering\}[^>]*onClick=\{\(\) => void bridge\.update\.install\(\)\}/);
    expect(section).toContain("rendering={rendering} onPrefs={changePrefs}");
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
