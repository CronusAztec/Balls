import type { BRIDGE_METHODS, DesktopApi, DesktopEventMap, DesktopEventName } from "./contract";

/*
 * --- old-bridge --- What the app the page runs in can do. The bridge's apiVersion stays 1 while the app gains channels, so a
 * page newer than its app (a development run serving another checkout's export, a stand-in bridge) meets a bridge without the
 * namespaces added after the first release – and one unchecked `bridge.social.key` threw on mount and took the whole simulator
 * down with it. Everything the page uses that came after Windows app 1.0.1 is a capability here, found by its methods: the
 * preload builds `window.desktop` from the app's own BRIDGE_METHODS, so a method is there exactly when that app handles its
 * channel. An event has no such mark: it rides on the capability it came with, and `onDesktop` subscribes only then (the
 * preload's `on` throws for an event its app does not know). The panels and hooks ask here, nowhere else; the contract's
 * `DesktopApi` has these members optional, so the compiler holds every use to a check.
 */

type MethodPath = keyof typeof BRIDGE_METHODS;

/** The methods of the first release's bridge (Windows app 1.0.1): every apiVersion-1 bridge has them. */
export const BASE_METHODS = [
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
] as const satisfies readonly MethodPath[];

/** The events of the first release's bridge. */
export const BASE_EVENTS = ["menu", "openFile", "aiToken", "modelProgress", "renderProgress", "update"] as const satisfies readonly DesktopEventName[];

interface CapabilitySpec {
  /** The Windows app version that brought it (what the page tells a user whose app is older). */
  since: string;
  methods: readonly MethodPath[];
  events: readonly DesktopEventName[];
}

/** Each capability: the app version that brought it, its methods and its events. A new channel joins one of these (or a new one). */
export const DESKTOP_CAPABILITIES = {
  /** The AI status panel's checks (desktop-ai-fix). */
  diagnose: { since: "1.0.3", methods: ["ai.diagnose"], events: [] },
  /** The updater's status without a check (low-findings-2). */
  updateStatus: { since: "1.1.0", methods: ["update.status"], events: [] },
  /** The player's own fighters and modes (custom-content): the AI's "New fighter" and "New mode". */
  custom: { since: "1.2.0", methods: ["custom.load", "custom.save"], events: [] },
  /** Postiz (social-postiz): Accounts, Posts, the approval card; with the proposal queue, the autopilot and the AI's "Plan posts" (social-autopilot). */
  social: {
    since: "1.4.0",
    methods: [
      "social.key.status",
      "social.key.set",
      "social.key.forget",
      "social.channels.list",
      "social.notices.list",
      "social.prepare",
      "social.post",
      "social.posts",
      "social.postDelete",
      "social.audit",
      "social.channelSettings",
      "social.slot",
      "social.queue.list",
      "social.queue.propose",
      "social.queue.approve",
      "social.queue.edit",
      "social.queue.skip",
      "social.queue.remove",
      "social.autopilot.get",
      "social.autopilot.set",
    ],
    events: ["socialProgress", "socialQueue"],
  },
} as const satisfies Record<string, CapabilitySpec>;

export type DesktopCapability = keyof typeof DESKTOP_CAPABILITIES;
export type DesktopCapabilities = Record<DesktopCapability, boolean>;
export const DESKTOP_CAPABILITY_NAMES = Object.keys(DESKTOP_CAPABILITIES) as DesktopCapability[];

/** A bridge with Postiz, the proposal queue and the autopilot (app 1.4.0 and later). */
export type SocialBridge = DesktopApi & { social: NonNullable<DesktopApi["social"]> };
/** A bridge that keeps the player's own fighters and modes (app 1.2.0 and later). */
export type CustomBridge = DesktopApi & { custom: NonNullable<DesktopApi["custom"]> };

function methodAt(bridge: unknown, path: string): unknown {
  let at: unknown = bridge;
  for (const part of path.split(".")) {
    if (at === null || (typeof at !== "object" && typeof at !== "function")) return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}

/** Whether the bridge has every method of the capability (null – the website – has none). */
export function hasCapability(bridge: DesktopApi | null | undefined, capability: DesktopCapability): boolean {
  if (!bridge) return false;
  return DESKTOP_CAPABILITIES[capability].methods.every((path) => typeof methodAt(bridge, path) === "function");
}

/** Every capability of the bridge at once. */
export function desktopCapabilities(bridge: DesktopApi | null | undefined): DesktopCapabilities {
  return Object.fromEntries(DESKTOP_CAPABILITY_NAMES.map((c) => [c, hasCapability(bridge, c)])) as DesktopCapabilities;
}

export function hasSocial(bridge: DesktopApi | null | undefined): bridge is SocialBridge {
  return hasCapability(bridge, "social");
}

export function hasCustom(bridge: DesktopApi | null | undefined): bridge is CustomBridge {
  return hasCapability(bridge, "custom");
}

/** Whether the app sends the event: one of the first release's, or one whose capability the bridge has. */
export function hasEvent(bridge: DesktopApi | null | undefined, event: DesktopEventName): boolean {
  if (!bridge) return false;
  if ((BASE_EVENTS as readonly DesktopEventName[]).includes(event)) return true;
  return DESKTOP_CAPABILITY_NAMES.some((c) => (DESKTOP_CAPABILITIES[c].events as readonly DesktopEventName[]).includes(event) && hasCapability(bridge, c));
}

const noop = () => {};

/**
 * `bridge.on` for an event the app may not send: subscribes when the app has it, and never throws (the preload's `on` throws
 * for an event its app does not know). Returns the unsubscribe, a no-op when nothing was subscribed.
 */
export function onDesktop<K extends DesktopEventName>(bridge: DesktopApi | null | undefined, event: K, listener: (payload: DesktopEventMap[K]) => void): () => void {
  if (!bridge || !hasEvent(bridge, event)) return noop;
  try {
    const off = bridge.on(event, listener);
    return typeof off === "function" ? off : noop;
  } catch {
    return noop;
  }
}
