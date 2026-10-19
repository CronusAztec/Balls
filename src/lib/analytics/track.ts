// --- analytics --- track(): the few conversion events the optional statistics service counts (README "Analytics events")
/*
 * Nothing here talks to a server by itself. `track()` hands an event to whatever statistics script the build was given
 * (NEXT_PUBLIC_ANALYTICS_SCRIPT_URL: Plausible, Umami or Rybbit, loaded by components/site/Analytics.tsx) and does nothing at
 * all when there is none – so every call site is dead code until the owner sets the variable, and it never throws.
 *
 * Gates (all must hold, else `track()` returns silently and the loader injects nothing, so a visitor behind a gate makes no
 * request to the service): a browser window; a build-time script address that is an absolute http(s) URL; a page served over
 * http or https (not app:// or file://); not the Windows app (`window.desktop`); no Do Not Track (`navigator.doNotTrack`,
 * `window.doNotTrack`, `navigator.msDoNotTrack`); no Global Privacy Control (`navigator.globalPrivacyControl`); and the visitor
 * has not switched the action counts off on the privacy page (localStorage `jbl.stats.off` = "1", --- legal-audit ---).
 *
 * What may be sent is a fixed list: the event names and the props of each are in `EVENTS` (and in the README table, which a test
 * keeps equal); a prop is a short token or a number, never an email, receipt reference, licence, seed, address or free text.
 * Revenue goes to Plausible only (a revenue goal in its dashboard), and as the props `revenue` and `currency` to Umami.
 *
 * Pure of React and of the DOM except through the injected `TrackEnv`, so it is unit-tested in tests/analytics.test.ts.
 */

/** Event name → the props it may carry. Names are snake_case, at most 24 characters, the same in every language. */
export const EVENTS = {
  cta_click: ["id"],
  sim_start: ["mode", "entry"],
  clip_export: ["kind", "mode", "res", "watermark", "secs"],
  share_copy: [],
  share_open: ["kind"],
  download_click: ["kind"],
  pwa_install: ["outcome"],
  pwa_installed: [],
  unlock_open: ["feature"],
  checkout_start: ["plan", "provider", "from"],
  purchase: ["plan", "provider"],
  restore: ["via"],
  signup: [],
  channel_connected: ["platform"],
  publish_sent: ["platform", "via"],
} as const;

export type EventName = keyof typeof EVENTS;
export type TrackProps = Record<string, string | number | boolean>;
export interface Revenue {
  currency: "USD";
  amount: number;
}

/** What the gates look at: the window and the build's script address. Injected by the tests. */
export interface TrackEnv {
  win: Window | undefined;
  scriptUrl: string;
}

/** The `data-track-id` values of `cta_click` (a closed list: markup cannot invent a value). */
export const CTA_IDS = ["hero_studio", "hero_download", "hero_pricing", "nav_studio", "nav_gallery", "nav_download", "nav_pricing", "nav_cta", "gallery_try", "tiktok_cta", "footer_install"] as const;

/** Props with a closed set of values, keyed "event.prop"; any other value is dropped. (Props missing here are open: mode, res, secs, feature.) */
export const PROP_VALUES: Readonly<Record<string, readonly string[]>> = {
  "cta_click.id": CTA_IDS,
  "sim_start.entry": ["direct", "share", "daily", "gallery"],
  "clip_export.kind": ["record", "fast", "batch"],
  "clip_export.watermark": ["free", "pro"],
  "share_open.kind": ["code", "daily"],
  "download_click.kind": ["setup", "portable", "checksums"],
  "pwa_install.outcome": ["accepted", "dismissed"],
  "unlock_open.feature": ["record", "fastExport", "batch", "bot", "publish", "renderQueue", "download"], // = PRO_FEATURES (lib/billing/guard.ts, a test keeps them equal)
  "checkout_start.plan": ["monthly", "yearly"],
  "checkout_start.provider": ["stripe", "paypal", "crypto"],
  "checkout_start.from": ["page", "dialog"],
  "purchase.plan": ["monthly", "yearly"],
  "purchase.provider": ["stripe", "paypal", "crypto"],
  "restore.via": ["email_ref", "key"],
  "channel_connected.platform": ["tiktok", "instagram", "youtube"],
  "publish_sent.platform": ["tiktok", "instagram", "youtube"],
  "publish_sent.via": ["api", "share"],
};

/** The only events a click on markup may send (`data-track="…"`, the props from `data-track-<prop>`). */
export const MARKUP_EVENTS: readonly EventName[] = ["cta_click", "download_click"];

/** The privacy page's opt-out switch: with this localStorage key set to "1" nothing is counted in this browser (components/site/StatsOptOut.tsx). */
export const STATS_OFF_KEY = "jbl.stats.off";

/** The most events waited on while the script loads; the oldest go first. */
export const QUEUE_LIMIT = 20;
/** The longest string prop kept (longer ones are cut). */
export const MAX_PROP_LENGTH = 32;

/** A value that looks like personal or secret data (an email, a URL or path, an account session `jbs_…`, a licence/JWT `eyJ…`) or like free text (a space). */
const UNSAFE_VALUE = /[@/\\\s]|^jbs_|^eyJ|https?:/i;

function cleanValue(key: string, raw: unknown): string | number | boolean | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw * 100) / 100, -1e9), 1e9) : undefined;
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text || UNSAFE_VALUE.test(text)) return undefined;
  const value = text.slice(0, MAX_PROP_LENGTH);
  const closed = PROP_VALUES[key];
  return closed && !closed.includes(value) ? undefined : value;
}

/** The props an event may send: only its own keys (EVENTS), strings as short tokens (and, where the set is closed, only a value of it), finite numbers. */
export function sanitizeProps(name: EventName, props?: TrackProps | null): TrackProps {
  const out: TrackProps = {};
  const keys: readonly string[] | undefined = Object.prototype.hasOwnProperty.call(EVENTS, name) ? EVENTS[name] : undefined;
  if (!keys || !props || typeof props !== "object") return out;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
    const value = cleanValue(`${name}.${key}`, props[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function cleanRevenue(revenue?: Revenue | null): Revenue | undefined {
  if (!revenue || revenue.currency !== "USD" || typeof revenue.amount !== "number" || !Number.isFinite(revenue.amount) || revenue.amount <= 0) return undefined;
  return { currency: "USD", amount: Math.round(Math.min(revenue.amount, 1e6) * 100) / 100 };
}

/** The statistics services' globals (and the bits of the window the gates read). */
interface VendorWindow {
  plausible?: (name: string, options?: { props?: TrackProps; revenue?: Revenue }) => void;
  umami?: { track?: (name: string, data?: TrackProps) => void };
  rybbit?: { event?: (name: string, props?: TrackProps) => void }; // the API name is from the vendor's docs, checked on install (README)
  dataLayer?: unknown;
  desktop?: unknown;
  doNotTrack?: unknown;
  navigator?: { doNotTrack?: unknown; msDoNotTrack?: unknown; globalPrivacyControl?: unknown };
  location?: { protocol?: string };
  localStorage?: { getItem?: (key: string) => unknown };
}

/** True when the visitor switched the action counts off in this browser (a storage that throws or is missing counts as not off). */
function statsOff(win: VendorWindow): boolean {
  try {
    return win.localStorage?.getItem?.(STATS_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

const isHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

/** True when every gate holds (see the file header). */
export function trackingAllowed(env: TrackEnv = defaultEnv()): boolean {
  try {
    const win = env.win as unknown as VendorWindow | undefined;
    if (!win || !env.scriptUrl || !isHttpUrl(env.scriptUrl)) return false;
    const protocol = win.location?.protocol;
    if (protocol !== "http:" && protocol !== "https:") return false;
    if (win.desktop !== undefined && win.desktop !== null) return false; // the Windows app: offline by design, never measured
    const nav = win.navigator;
    const off = (v: unknown) => v === "1" || v === 1 || v === "yes";
    if (off(nav?.doNotTrack) || off(win.doNotTrack) || off(nav?.msDoNotTrack)) return false;
    if (nav?.globalPrivacyControl === true) return false;
    if (statsOff(win)) return false; // the privacy page's switch
    return true;
  } catch {
    return false;
  }
}

interface Queued {
  name: EventName;
  props: TrackProps;
  revenue?: Revenue;
}

/** Hands one event to the first service that is there: Plausible, Umami, Rybbit, then a page's own dataLayer. True when one took it. */
function dispatch(win: VendorWindow, { name, props, revenue }: Queued): boolean {
  const hasProps = Object.keys(props).length > 0;
  try {
    if (typeof win.plausible === "function") {
      const options: { props?: TrackProps; revenue?: Revenue } = {};
      if (hasProps) options.props = props;
      if (revenue) options.revenue = revenue;
      win.plausible(name, Object.keys(options).length ? options : undefined);
      return true;
    }
    if (typeof win.umami?.track === "function") {
      win.umami.track(name, revenue ? { ...props, revenue: revenue.amount, currency: revenue.currency } : hasProps ? props : undefined);
      return true;
    }
    if (typeof win.rybbit?.event === "function") {
      win.rybbit.event(name, hasProps ? props : undefined);
      return true;
    }
    if (Array.isArray(win.dataLayer)) {
      win.dataLayer.push({ event: name, ...props }); // never created here: only a page that has a tag manager has one
      return true;
    }
  } catch {
    /* a service that throws never breaks the page */
  }
  return false;
}

const vendorPresent = (win: VendorWindow): boolean => typeof win.plausible === "function" || typeof win.umami?.track === "function" || typeof win.rybbit?.event === "function" || Array.isArray(win.dataLayer);

export interface Tracker {
  allowed(): boolean;
  track(name: EventName, props?: TrackProps, revenue?: Revenue): void;
  /** The statistics script has loaded: sends what waited, and sends everything after at once. */
  flush(): void;
  /** The script could not be loaded (blocked, offline): forget what waited and send nothing more. */
  drop(): void;
  /** One delegated click listener for `data-track` markup; returns the unbind. */
  bindClicks(doc?: Document): () => void;
  /** How many events wait for the script. */
  queued(): number;
}

/** One tracker over an environment (the page's own is the exports below; the tests make theirs). */
export function createTracker(getEnv: () => TrackEnv, onClickEntry?: (name: EventName, props: TrackProps) => void): Tracker {
  let queue: Queued[] = [];
  let loaded = false;
  let blocked = false;
  const winOf = (): VendorWindow | undefined => getEnv().win as unknown as VendorWindow | undefined;
  const drain = (win: VendorWindow) => {
    const waiting = queue;
    queue = [];
    for (const item of waiting) dispatch(win, item);
  };
  const track: Tracker["track"] = (name, props, revenue) => {
    try {
      if (blocked) return;
      const env = getEnv();
      if (!trackingAllowed(env) || !Object.prototype.hasOwnProperty.call(EVENTS, name)) return;
      const item: Queued = { name, props: sanitizeProps(name, props), revenue: cleanRevenue(revenue) };
      const win = env.win as unknown as VendorWindow;
      if (loaded || vendorPresent(win)) {
        if (queue.length) drain(win);
        dispatch(win, item);
        return;
      }
      queue.push(item);
      if (queue.length > QUEUE_LIMIT) queue.shift();
    } catch {
      /* never throws */
    }
  };
  return {
    allowed: () => trackingAllowed(getEnv()),
    track,
    flush() {
      try {
        loaded = true;
        const win = winOf();
        if (win && trackingAllowed(getEnv())) drain(win);
        else queue = [];
      } catch {
        queue = [];
      }
    },
    drop() {
      blocked = true;
      queue = [];
    },
    queued: () => queue.length,
    bindClicks(doc) {
      const target = doc ?? (typeof document === "undefined" ? undefined : document);
      if (!target) return () => undefined;
      const onClick = (event: Event) => {
        try {
          const node = event.target as Element | null;
          const el = node && typeof node.closest === "function" ? node.closest("[data-track]") : null;
          const name = el?.getAttribute("data-track") as EventName | null | undefined;
          if (!el || !name || !MARKUP_EVENTS.includes(name)) return;
          const props: TrackProps = {};
          for (const key of EVENTS[name]) {
            const value = el.getAttribute(`data-track-${key}`);
            if (value !== null) props[key] = value;
          }
          const clean = sanitizeProps(name, props);
          if (EVENTS[name].length > 0 && Object.keys(clean).length === 0) return; // an element with a missing or unlisted id is not a click worth counting
          onClickEntry?.(name, clean);
          track(name, clean);
        } catch {
          /* never throws */
        }
      };
      target.addEventListener("click", onClick, true);
      return () => target.removeEventListener("click", onClick, true);
    },
  };
}

/** The build's statistics script address ("" without one: every call below then does nothing). Inlined by Next.js at build time. */
export const ANALYTICS_SCRIPT_URL: string = process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_URL || "";

function defaultEnv(): TrackEnv {
  return { win: typeof window === "undefined" ? undefined : window, scriptUrl: ANALYTICS_SCRIPT_URL };
}

/* --- where a studio visit came from: the click that opened it (a gallery card), kept for sim_start's `entry` --- */
export type Entry = "direct" | "share" | "daily" | "gallery";
let entryHint: Entry | null = null;
/** Notes how the studio was reached (the next `sim_start` says it). */
export function noteEntry(entry: Entry): void {
  entryHint = entry;
}
/** The noted entry, once. */
export function takeEntry(): Entry | null {
  const entry = entryHint;
  entryHint = null;
  return entry;
}

const page = createTracker(defaultEnv, (name, props) => {
  if (name === "cta_click" && props.id === "gallery_try") noteEntry("gallery");
});

/** Sends one event (does nothing without a script address, or behind a gate). */
export function track(name: EventName, props?: TrackProps, revenue?: Revenue): void {
  if (!ANALYTICS_SCRIPT_URL) return;
  page.track(name, props, revenue);
}
export const flushTrackQueue = (): void => page.flush();
export const dropTrackQueue = (): void => page.drop();
export const bindTrackClicks = (doc?: Document): (() => void) => page.bindClicks(doc);
