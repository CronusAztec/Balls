import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import { BRIDGE_METHODS, DESKTOP_API_VERSION, EVENT_CHANNELS, type DesktopApi, type DesktopEventName } from "@/lib/desktop/contract";
import { BASE_EVENTS, BASE_METHODS, DESKTOP_CAPABILITIES, DESKTOP_CAPABILITY_NAMES, desktopCapabilities, hasCapability, hasCustom, hasEvent, hasSocial, onDesktop, type DesktopCapabilities } from "@/lib/desktop/capabilities";
import { AI_TASKS, aiTasksFor } from "@/components/simulator/desktop/useDesktopAi";
import NeedsNewerApp from "@/components/simulator/desktop/NeedsNewerApp";

(globalThis as { React?: unknown }).React = React; // (vitest compiles .tsx with the classic JSX runtime)

/*
 * --- old-bridge --- The page in an app older than itself: the bridge keeps apiVersion 1 while the app gains channels, so the
 * page asks lib/desktop/capabilities.ts what the app can do. These bridges are built the way the preload builds them
 * (desktop/src/preload.ts buildBridge: one function per method of the app's BRIDGE_METHODS, nested by its dotted path, and an
 * `on` that throws for an event the app does not know), from the method tables of the released apps.
 */

/** BRIDGE_METHODS of the first release, Windows app 1.0.1 (b75f63b). */
const APP_1_0_1 = [
  "info",
  "openLogs",
  "prefs.get",
  "prefs.set",
  "gpu.status",
  "gpu.probeEncoders",
  "gpu.benchmark",
  "dialogs.pickFolder",
  "dialogs.pickMedia",
  "render.save",
  "render.cancel",
  "journal.load",
  "journal.save",
  "library.list",
  "library.remove",
  "library.reveal",
  "library.open",
  "library.openFolder",
  "library.read",
  "ai.status",
  "ai.models",
  "ai.downloadModel",
  "ai.cancelDownload",
  "ai.importModel",
  "ai.selectModel",
  "ai.removeModel",
  "ai.chat",
  "ai.cancel",
  "ai.setCloud",
  "ai.clearCloudKey",
  "ai.playbook",
  "update.check",
  "update.install",
];
const EVENTS_1_0_1 = ["menu", "openFile", "aiToken", "modelProgress", "renderProgress", "update"];

/** The released apps' tables: each adds to the one before (3d95b2e, ffdb8ff, 7ea732e; 1.4.0 is the current table). */
const RELEASES: { version: string; methods: string[]; events: string[]; caps: DesktopCapabilities }[] = [
  { version: "1.0.1", methods: APP_1_0_1, events: EVENTS_1_0_1, caps: { diagnose: false, updateStatus: false, custom: false, social: false } },
  { version: "1.0.3", methods: [...APP_1_0_1, "ai.diagnose"], events: EVENTS_1_0_1, caps: { diagnose: true, updateStatus: false, custom: false, social: false } },
  { version: "1.1.0", methods: [...APP_1_0_1, "ai.diagnose", "update.status"], events: EVENTS_1_0_1, caps: { diagnose: true, updateStatus: true, custom: false, social: false } },
  { version: "1.2.0", methods: [...APP_1_0_1, "ai.diagnose", "update.status", "custom.load", "custom.save"], events: EVENTS_1_0_1, caps: { diagnose: true, updateStatus: true, custom: true, social: false } },
  { version: "1.4.0", methods: Object.keys(BRIDGE_METHODS), events: Object.keys(EVENT_CHANNELS), caps: { diagnose: true, updateStatus: true, custom: true, social: true } },
];

function bridgeOf(methods: readonly string[], events: readonly string[]) {
  const subscribed: string[] = [];
  const api: Record<string, unknown> = { apiVersion: DESKTOP_API_VERSION };
  for (const path of methods) {
    const parts = path.split(".");
    let target = api;
    for (const part of parts.slice(0, -1)) target = (target[part] ??= {}) as Record<string, unknown>;
    target[parts[parts.length - 1]] = async () => null;
  }
  api.log = () => {};
  api.on = (event: string) => {
    if (!events.includes(event)) throw new Error(`Unknown desktop event ${event}`);
    subscribed.push(event);
    return () => void subscribed.splice(subscribed.indexOf(event), 1);
  };
  return { bridge: api as unknown as DesktopApi, subscribed };
}
const release = (version: string) => {
  const r = RELEASES.find((x) => x.version === version)!;
  return bridgeOf(r.methods, r.events);
};

describe("desktop capabilities", () => {
  it("find what each released app's bridge offers, and nothing on the website", () => {
    for (const r of RELEASES) {
      const { bridge } = bridgeOf(r.methods, r.events);
      expect(desktopCapabilities(bridge), r.version).toEqual(r.caps);
      expect(hasSocial(bridge), r.version).toBe(r.caps.social);
      expect(hasCustom(bridge), r.version).toBe(r.caps.custom);
    }
    expect(desktopCapabilities(null)).toEqual({ diagnose: false, updateStatus: false, custom: false, social: false });
    expect(hasSocial(undefined)).toBe(false);
  });

  it("name the app version that brought each capability (the first release that has it)", () => {
    for (const c of DESKTOP_CAPABILITY_NAMES) expect(DESKTOP_CAPABILITIES[c].since, c).toBe(RELEASES.find((r) => r.caps[c])!.version);
  });

  it("take the first release's table as the base every bridge has", () => {
    expect([...BASE_METHODS].sort()).toEqual([...APP_1_0_1].sort());
    expect([...BASE_EVENTS].sort()).toEqual([...EVENTS_1_0_1].sort());
  });

  it("put every method and event of the contract either in the base or in exactly one capability", () => {
    const owners = (path: string) => DESKTOP_CAPABILITY_NAMES.filter((c) => (DESKTOP_CAPABILITIES[c].methods as readonly string[]).includes(path));
    for (const path of Object.keys(BRIDGE_METHODS)) {
      const base = (BASE_METHODS as readonly string[]).includes(path);
      expect(base ? 0 : 1, `${path}: a new channel joins a capability in lib/desktop/capabilities.ts`).toBe(owners(path).length);
    }
    const listed = DESKTOP_CAPABILITY_NAMES.flatMap((c) => DESKTOP_CAPABILITIES[c].methods as readonly string[]);
    for (const path of [...BASE_METHODS, ...listed]) expect(Object.keys(BRIDGE_METHODS), path).toContain(path);
    for (const event of Object.keys(EVENT_CHANNELS) as DesktopEventName[]) {
      const base = (BASE_EVENTS as readonly string[]).includes(event);
      const eventOwners = DESKTOP_CAPABILITY_NAMES.filter((c) => (DESKTOP_CAPABILITIES[c].events as readonly string[]).includes(event));
      expect(base ? 0 : 1, event).toBe(eventOwners.length);
    }
  });

  it("do not take part of a namespace for the whole of it", () => {
    const { bridge } = bridgeOf([...APP_1_0_1, "social.key.status", "social.channels.list", "custom.load"], EVENTS_1_0_1);
    expect(desktopCapabilities(bridge)).toEqual({ diagnose: false, updateStatus: false, custom: false, social: false });
    // a namespace that is there but not callable (a stand-in that answers every key with an object) is not a capability either
    const stub = { ...release("1.2.0").bridge, social: { key: {}, channels: {} } } as unknown as DesktopApi;
    expect(hasCapability(stub, "social")).toBe(false);
  });
});

describe("onDesktop", () => {
  it("subscribes only to the events the app sends, and never throws for one it does not", () => {
    const old = release("1.2.0");
    expect(() => old.bridge.on("socialQueue", () => {})).toThrow(/Unknown desktop event socialQueue/); // what the preload does
    expect(hasEvent(old.bridge, "socialQueue")).toBe(false);
    const off = onDesktop(old.bridge, "socialQueue", () => {});
    expect(old.subscribed).toEqual([]);
    expect(() => off()).not.toThrow();
    const offUpdate = onDesktop(old.bridge, "update", () => {});
    expect(old.subscribed).toEqual(["update"]);
    offUpdate();
    expect(old.subscribed).toEqual([]);

    const current = release("1.4.0");
    const offQueue = onDesktop(current.bridge, "socialQueue", () => {});
    expect(current.subscribed).toEqual(["socialQueue"]);
    offQueue();
    expect(current.subscribed).toEqual([]);
  });

  it("answers a no-op unsubscribe on the website and when the app's `on` throws all the same", () => {
    expect(onDesktop(null, "update", () => {})).toBeTypeOf("function");
    const throwing = { ...release("1.4.0").bridge, on: vi.fn(() => { throw new Error("gone"); }) } as unknown as DesktopApi;
    const off = onDesktop(throwing, "socialProgress", () => {});
    expect(throwing.on).toHaveBeenCalledTimes(1);
    expect(() => off()).not.toThrow();
  });
});

describe("what the Desktop group offers an older app", () => {
  it("offers only the AI jobs the app can do", () => {
    const tasks = (version: string) => aiTasksFor(desktopCapabilities(release(version).bridge));
    expect(tasks("1.0.1")).toEqual(["videos", "copy", "settings", "ideas"]);
    expect(tasks("1.1.0")).toEqual(["videos", "copy", "settings", "ideas"]);
    expect(tasks("1.2.0")).toEqual(["videos", "copy", "settings", "ideas", "fighter", "mode"]);
    expect(tasks("1.4.0")).toEqual([...AI_TASKS]);
  });

  it("says in every language which app version brings the feature", () => {
    for (const [locale, messages] of [["en", en], ["pl", pl], ["es", es]] as const) {
      const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, createElement(NeedsNewerApp, { capability: "social" })));
      expect(html, locale).toContain('data-testid="desktop-needs-update"');
      expect(html, locale).toContain('data-capability="social"');
      expect(html, locale).toContain("1.4.0");
      expect(html, locale).not.toContain("{version}");
      const d = messages.Desktop as unknown as Record<string, string>;
      expect(d.needsNewerAppTitle.length, locale).toBeGreaterThan(5);
      expect(d.groupFailed, locale).toContain("{error}");
      for (const key of ["needsNewerApp", "needsNewerAppTitle", "groupFailed"]) expect(d[key], `${locale} ${key}`).not.toMatch(/—| – |;/);
    }
  });
});
