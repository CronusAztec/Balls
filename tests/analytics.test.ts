import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTRIBUTION_PARAMS, ATTRIBUTION_MAX_LENGTH, carriesClaim, preservedParams, withAttribution, withoutAttribution } from "@/lib/analytics/attribution";
import { CTA_IDS, EVENTS, MARKUP_EVENTS, MAX_PROP_LENGTH, PROP_VALUES, QUEUE_LIMIT, createTracker, sanitizeProps, trackingAllowed, type EventName, type TrackEnv, type Tracker } from "@/lib/analytics/track";
import { PRO_FEATURES } from "@/lib/billing/guard";
import { PLAN_IDS, PLANS, PROVIDERS } from "@/lib/billing/config";
import { PUBLISH_PLATFORMS } from "@/lib/publish/platforms";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";

/**
 * --- analytics --- The optional statistics service: its gates (no request at all behind one), the props that may be sent, the order
 * services are tried in, the queue, the markup click listener, the README table against the code, every event used in src/
 * against EVENTS, and the ad link's campaign names through the studio's address-bar mirror.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const URL_OK = "https://stats.example.com/js/script.js";

/** A browser window as far as the gates and the services look at it. */
function fakeWindow(over: Record<string, unknown> = {}, navigator: Record<string, unknown> = {}): Window {
  return { location: { protocol: "https:", hostname: "jumpingballslive.com" }, navigator: { ...navigator }, ...over } as unknown as Window;
}
const envOf = (win: Window | undefined, scriptUrl = URL_OK): TrackEnv => ({ win, scriptUrl });
type Call = [string, ...unknown[]];

/** A window with Plausible, Umami, Rybbit and a dataLayer, each recording its calls in one list. */
function allServices(): { win: Window; calls: Call[] } {
  const calls: Call[] = [];
  const win = fakeWindow({
    plausible: (...args: unknown[]) => calls.push(["plausible", ...args]),
    umami: { track: (...args: unknown[]) => calls.push(["umami", ...args]) },
    rybbit: { event: (...args: unknown[]) => calls.push(["rybbit", ...args]) },
    dataLayer: Object.assign([] as unknown[], { push: (...args: unknown[]) => calls.push(["dataLayer", ...args]) }),
  });
  return { win, calls };
}

describe("attribution: the ad link's campaign names", () => {
  it("lists the UTM names and the ad platforms' click ids, in lower case, once each", () => {
    expect([...ATTRIBUTION_PARAMS]).toEqual(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "gclid", "gbraid", "wbraid", "fbclid", "ttclid", "msclkid", "twclid", "rdt_cid"]);
    expect(new Set(ATTRIBUTION_PARAMS).size).toBe(ATTRIBUTION_PARAMS.length);
  });

  it("keeps only the allow-listed pairs, from a string with or without the question mark or from URLSearchParams", () => {
    const search = "?mode=shatter&seed=123&utm_source=tiktok&c=abc&gclid=Cj0K&foo=bar&utm_term=&daily=1";
    expect(preservedParams(search).toString()).toBe("utm_source=tiktok&gclid=Cj0K");
    expect(preservedParams(search.slice(1)).toString()).toBe("utm_source=tiktok&gclid=Cj0K");
    expect(preservedParams(new URLSearchParams(search)).toString()).toBe("utm_source=tiktok&gclid=Cj0K");
    expect(preservedParams("").toString()).toBe("");
    expect(preservedParams(null).toString()).toBe("");
  });

  it("drops a value too long to be a campaign value instead of cutting it", () => {
    const long = "x".repeat(ATTRIBUTION_MAX_LENGTH + 1);
    expect(preservedParams(`utm_source=${long}&gclid=ok`).toString()).toBe("gclid=ok");
    expect(preservedParams(`utm_source=${"x".repeat(ATTRIBUTION_MAX_LENGTH)}`).get("utm_source")).toHaveLength(ATTRIBUTION_MAX_LENGTH);
  });

  it("every allow-listed name survives the studio's settings mirror, and the seed handling is unchanged", () => {
    const values = new Map(ATTRIBUTION_PARAMS.map((name, i) => [name, `v${i}_${name}`]));
    const all = ATTRIBUTION_PARAMS.map((name) => `${name}=${values.get(name)}`).join("&");
    for (const name of ATTRIBUTION_PARAMS) {
      // the address the mirror finds: the ad link's name next to the settings, a seed, a share code and a daily marker
      const search = `?mode=shatter&seed=123&c=abc&daily=1&${name}=${values.get(name)}`;
      const settings = settingsFromSearchParams(new URLSearchParams(search));
      const mirrored = withAttribution(settingsToSearchParams(settings), search);
      expect(mirrored.get(name), name).toBe(values.get(name));
      expect(mirrored.get("mode"), name).toBe("shatter");
      // as before: the seed, the share code and the daily marker are read once and not written back
      expect(mirrored.has("seed"), name).toBe(false);
      expect(mirrored.has("c"), name).toBe(false);
      expect(mirrored.has("daily"), name).toBe(false);
    }
    const everything = withAttribution(settingsToSearchParams(settingsFromSearchParams(new URLSearchParams(`mode=classic&${all}`))), `?mode=classic&${all}`);
    for (const name of ATTRIBUTION_PARAMS) expect(everything.get(name), name).toBe(values.get(name));
    // a second pass over its own result (the mirror runs on every settings change) changes nothing
    const again = withAttribution(settingsToSearchParams(defaultSettings("classic")), `?${everything.toString()}`);
    expect(again.toString()).toBe(everything.toString());
  });

  it("never replaces a pair of the settings, and no settings key is an attribution name", () => {
    expect(withAttribution(new URLSearchParams("mode=classic&gclid=mine"), "?gclid=theirs").get("gclid")).toBe("mine");
    const settingsSource = read("src/lib/settings.ts");
    for (const name of ATTRIBUTION_PARAMS) expect(settingsSource, name).not.toContain(`"${name}"`);
  });

  it("is what the studio's mirror calls, next to the debug switch it already kept", () => {
    const studio = read("src/components/simulator/Simulator.tsx");
    expect(studio).toContain("withAttribution(params, window.location.search)");
    expect(studio).toContain('params.set("flDbg", "1")');
    expect(studio).not.toMatch(/replaceState\(null, "", `\$\{window\.location\.pathname\}\?\$\{params\.toString\(\)\}`\)/);
  });

  it("is taken off the long link a visitor shares, and only the campaign names", () => {
    expect(withoutAttribution("https://jumpingballslive.com/en/simulator/?mode=shatter&utm_source=tiktok&gclid=abc&g=500")).toBe("https://jumpingballslive.com/en/simulator/?mode=shatter&g=500");
    expect(withoutAttribution("https://jumpingballslive.com/en/simulator/?utm_source=tiktok")).toBe("https://jumpingballslive.com/en/simulator/");
    expect(withoutAttribution("not a url")).toBe("not a url");
    expect(read("src/components/simulator/shareLinks.tsx")).toContain("withoutAttribution(window.location.href)");
  });
});

describe("gates: no request and no event behind any of them", () => {
  it("allows a plain browser on http and https with a script address", () => {
    expect(trackingAllowed(envOf(fakeWindow()))).toBe(true);
    expect(trackingAllowed(envOf(fakeWindow({ location: { protocol: "http:" } })))).toBe(true);
    expect(trackingAllowed(envOf(fakeWindow({}, { doNotTrack: "0", globalPrivacyControl: false, msDoNotTrack: "0" })))).toBe(true);
  });

  it("is off without a window, without a script address or with one that is not an absolute http(s) URL", () => {
    expect(trackingAllowed(envOf(undefined))).toBe(false);
    expect(trackingAllowed(envOf(fakeWindow(), ""))).toBe(false);
    for (const bad of ["javascript:alert(1)", "data:text/javascript,1", "/js/script.js", "script.js", "ftp://stats.example.com/s.js", "not a url", "//stats.example.com/s.js"]) {
      expect(trackingAllowed(envOf(fakeWindow(), bad)), bad).toBe(false);
    }
  });

  it("is off on pages that are not http or https: the app:// origin of the Windows app, file:// and about:", () => {
    for (const protocol of ["app:", "file:", "about:", "chrome-extension:", undefined]) expect(trackingAllowed(envOf(fakeWindow({ location: { protocol } }))), String(protocol)).toBe(false);
    expect(trackingAllowed(envOf(fakeWindow({ location: undefined })))).toBe(false);
  });

  it("is off inside the Windows app (its bridge is on window), whatever the page's address", () => {
    expect(trackingAllowed(envOf(fakeWindow({ desktop: { apiVersion: 1 } })))).toBe(false);
    expect(trackingAllowed(envOf(fakeWindow({ desktop: {} })))).toBe(false);
    expect(trackingAllowed(envOf(fakeWindow({ desktop: { apiVersion: 99 } })))).toBe(false); // a bridge of another version is still the app
  });

  it("is off for Do Not Track in every form a browser has used", () => {
    expect(trackingAllowed(envOf(fakeWindow({}, { doNotTrack: "1" })))).toBe(false);
    expect(trackingAllowed(envOf(fakeWindow({}, { doNotTrack: "yes" })))).toBe(false);
    expect(trackingAllowed(envOf(fakeWindow({ doNotTrack: "1" })))).toBe(false);
    expect(trackingAllowed(envOf(fakeWindow({}, { msDoNotTrack: "1" })))).toBe(false);
  });

  it("is off for Global Privacy Control", () => {
    expect(trackingAllowed(envOf(fakeWindow({}, { globalPrivacyControl: true })))).toBe(false);
  });

  it("never throws on a window that throws when looked at", () => {
    const hostile = new Proxy({}, { get: () => { throw new Error("no"); } }) as unknown as Window;
    expect(trackingAllowed(envOf(hostile))).toBe(false);
    const tracker = createTracker(() => envOf(hostile));
    expect(() => tracker.track("signup")).not.toThrow();
  });

  it("a tracker behind a gate sends nothing and keeps nothing waiting", () => {
    for (const [name, win] of [
      ["dnt", fakeWindow({ plausible: vi.fn() }, { doNotTrack: "1" })],
      ["gpc", fakeWindow({ plausible: vi.fn() }, { globalPrivacyControl: true })],
      ["desktop", fakeWindow({ plausible: vi.fn(), desktop: { apiVersion: 1 } })],
      ["app protocol", fakeWindow({ plausible: vi.fn(), location: { protocol: "app:" } })],
    ] as const) {
      const tracker = createTracker(() => envOf(win));
      tracker.track("sim_start", { mode: "classic", entry: "direct" });
      tracker.flush();
      expect((win as unknown as { plausible: ReturnType<typeof vi.fn> }).plausible, name).not.toHaveBeenCalled();
      expect(tracker.queued(), name).toBe(0);
    }
    const noUrl = createTracker(() => envOf(fakeWindow({ plausible: vi.fn() }), ""));
    noUrl.track("signup");
    expect(noUrl.queued()).toBe(0);
  });

  it("changes its mind with the browser: a gate that closes later stops the events at once", () => {
    const calls: Call[] = [];
    const win = fakeWindow({ plausible: (...a: unknown[]) => calls.push(["plausible", ...a]) });
    const tracker = createTracker(() => envOf(win));
    tracker.track("signup");
    (win.navigator as unknown as Record<string, unknown>).doNotTrack = "1";
    tracker.track("signup");
    expect(calls).toHaveLength(1);
  });
});

describe("the props that may be sent", () => {
  it("lists events in snake_case, at most 24 characters, each with its own props", () => {
    for (const [name, props] of Object.entries(EVENTS)) {
      expect(name, name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(name.length, name).toBeLessThanOrEqual(24);
      expect(new Set(props).size, name).toBe(props.length);
    }
    expect(Object.keys(EVENTS)).toHaveLength(15);
  });

  it("keeps only the event's own props", () => {
    expect(sanitizeProps("sim_start", { mode: "classic", entry: "direct", seed: 123, email: "a@b.co" })).toEqual({ mode: "classic", entry: "direct" });
    expect(sanitizeProps("share_copy", { mode: "classic" })).toEqual({});
    expect(sanitizeProps("signup")).toEqual({});
    expect(sanitizeProps("sim_start", null)).toEqual({});
    expect(sanitizeProps("sim_start", undefined)).toEqual({});
    expect(sanitizeProps("nope" as EventName, { mode: "x" })).toEqual({});
    expect(sanitizeProps("sim_start", JSON.parse('{"__proto__": {"mode": "x"}}'))).toEqual({});
  });

  it("drops anything that looks like an email, an account session, a licence, an address or free text", () => {
    for (const bad of ["me@example.com", "x@y", "jbs_4f9a8c1e2b", "JBS_abc", "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.sig", "https://example.com/?a=1", "http:x", "//host/path", "two words", "tab\tseparated", "new\nline", "   "]) {
      expect(sanitizeProps("sim_start", { mode: bad }), JSON.stringify(bad)).toEqual({});
    }
  });

  it("cuts a long token at 32 characters and trims", () => {
    expect(sanitizeProps("sim_start", { mode: "a".repeat(80) }).mode).toBe("a".repeat(MAX_PROP_LENGTH));
    expect(sanitizeProps("sim_start", { mode: "  classic  " }).mode).toBe("classic");
    expect(MAX_PROP_LENGTH).toBe(32);
  });

  it("takes only a value of a closed set where the prop has one", () => {
    expect(sanitizeProps("sim_start", { mode: "classic", entry: "elsewhere" })).toEqual({ mode: "classic" });
    expect(sanitizeProps("cta_click", { id: "hero_studio" })).toEqual({ id: "hero_studio" });
    expect(sanitizeProps("cta_click", { id: "<script>" })).toEqual({});
    expect(sanitizeProps("cta_click", { id: "made_up_button" })).toEqual({});
    expect(sanitizeProps("checkout_start", { plan: "yearly", provider: "crypto", from: "dialog" })).toEqual({ plan: "yearly", provider: "crypto", from: "dialog" });
    expect(sanitizeProps("checkout_start", { plan: "lifetime", provider: "cash", from: "mail" })).toEqual({});
    expect(sanitizeProps("unlock_open", { feature: "fastExport" })).toEqual({ feature: "fastExport" });
    expect(sanitizeProps("unlock_open", { feature: "somethingElse" })).toEqual({});
  });

  it("takes finite numbers and booleans, and drops NaN, infinity, objects and arrays", () => {
    expect(sanitizeProps("clip_export", { kind: "fast", secs: 30 })).toEqual({ kind: "fast", secs: 30 });
    expect(sanitizeProps("clip_export", { secs: 12.3456 }).secs).toBe(12.35);
    expect(sanitizeProps("clip_export", { secs: Number.NaN })).toEqual({});
    expect(sanitizeProps("clip_export", { secs: Number.POSITIVE_INFINITY })).toEqual({});
    expect(sanitizeProps("clip_export", { secs: { n: 1 } as unknown as number })).toEqual({});
    expect(sanitizeProps("clip_export", { secs: [1] as unknown as number })).toEqual({});
    expect(sanitizeProps("clip_export", { mode: true })).toEqual({ mode: true });
  });

  it("closed sets equal the code's own lists", () => {
    expect([...PROP_VALUES["unlock_open.feature"]]).toEqual([...PRO_FEATURES]);
    for (const key of ["checkout_start.plan", "purchase.plan"]) expect([...PROP_VALUES[key]], key).toEqual([...PLAN_IDS]);
    for (const key of ["checkout_start.provider", "purchase.provider"]) expect([...PROP_VALUES[key]], key).toEqual([...PROVIDERS]);
    for (const key of ["channel_connected.platform", "publish_sent.platform"]) expect([...PROP_VALUES[key]], key).toEqual([...PUBLISH_PLATFORMS]);
    // every closed set belongs to a real event and prop
    for (const key of Object.keys(PROP_VALUES)) {
      const [event, prop] = key.split(".");
      expect((EVENTS as Record<string, readonly string[]>)[event], key).toContain(prop);
    }
  });
});

describe("dispatch: the first service that is there takes the event", () => {
  const sim = { mode: "classic", entry: "direct" } as const;

  it("Plausible first, with props and revenue as its own options", () => {
    const { win, calls } = allServices();
    createTracker(() => envOf(win)).track("purchase", { plan: "yearly", provider: "stripe" }, { currency: "USD", amount: 49 });
    expect(calls).toEqual([["plausible", "purchase", { props: { plan: "yearly", provider: "stripe" }, revenue: { currency: "USD", amount: 49 } }]]);
  });

  it("sends no options at all for an event without props", () => {
    const { win, calls } = allServices();
    createTracker(() => envOf(win)).track("signup");
    expect(calls).toEqual([["plausible", "signup", undefined]]);
  });

  it("Umami second, revenue as the props revenue and currency", () => {
    const { win, calls } = allServices();
    delete (win as unknown as Record<string, unknown>).plausible;
    const tracker = createTracker(() => envOf(win));
    tracker.track("sim_start", sim);
    tracker.track("purchase", { plan: "monthly", provider: "crypto" }, { currency: "USD", amount: 6.99 });
    tracker.track("signup");
    expect(calls).toEqual([
      ["umami", "sim_start", { mode: "classic", entry: "direct" }],
      ["umami", "purchase", { plan: "monthly", provider: "crypto", revenue: 6.99, currency: "USD" }],
      ["umami", "signup", undefined],
    ]);
  });

  it("Rybbit third, without revenue", () => {
    const { win, calls } = allServices();
    delete (win as unknown as Record<string, unknown>).plausible;
    delete (win as unknown as Record<string, unknown>).umami;
    createTracker(() => envOf(win)).track("purchase", { plan: "monthly", provider: "stripe" }, { currency: "USD", amount: 6.99 });
    expect(calls).toEqual([["rybbit", "purchase", { plan: "monthly", provider: "stripe" }]]);
  });

  it("a page's own dataLayer last, never created here", () => {
    const { win, calls } = allServices();
    for (const key of ["plausible", "umami", "rybbit"]) delete (win as unknown as Record<string, unknown>)[key];
    createTracker(() => envOf(win)).track("sim_start", sim);
    expect(calls).toEqual([["dataLayer", { event: "sim_start", mode: "classic", entry: "direct" }]]);
    const bare = fakeWindow();
    const tracker = createTracker(() => envOf(bare));
    tracker.flush();
    tracker.track("sim_start", sim);
    expect((bare as unknown as Record<string, unknown>).dataLayer).toBeUndefined();
  });

  it("sends revenue only for a positive USD amount, rounded to cents", () => {
    const { win, calls } = allServices();
    const tracker = createTracker(() => envOf(win));
    tracker.track("purchase", { plan: "yearly", provider: "stripe" }, { currency: "USD", amount: 48.999 });
    tracker.track("purchase", { plan: "yearly", provider: "stripe" }, { currency: "EUR" as "USD", amount: 49 });
    tracker.track("purchase", { plan: "yearly", provider: "stripe" }, { currency: "USD", amount: -5 });
    tracker.track("purchase", { plan: "yearly", provider: "stripe" }, { currency: "USD", amount: Number.NaN });
    expect(calls.map((c) => (c[2] as { revenue?: unknown }).revenue)).toEqual([{ currency: "USD", amount: 49 }, undefined, undefined, undefined]);
  });

  it("ignores an event that is not in EVENTS", () => {
    const { win, calls } = allServices();
    createTracker(() => envOf(win)).track("page_view" as EventName);
    expect(calls).toEqual([]);
  });

  it("sanitises on the way: nothing outside the list reaches a service", () => {
    const { win, calls } = allServices();
    createTracker(() => envOf(win)).track("sim_start", { mode: "classic", entry: "direct", seed: 7, email: "a@b.co" } as never);
    expect(calls).toEqual([["plausible", "sim_start", { props: { mode: "classic", entry: "direct" } }]]);
  });

  it("a service that throws never breaks the caller", () => {
    const win = fakeWindow({ plausible: () => { throw new Error("blocked"); } });
    expect(() => createTracker(() => envOf(win)).track("signup")).not.toThrow();
  });
});

describe("the queue: events wait for the script", () => {
  function laterWindow() {
    const calls: Call[] = [];
    const win = fakeWindow();
    return { win, calls, install: () => ((win as unknown as Record<string, unknown>).plausible = (...a: unknown[]) => calls.push(["plausible", ...a])) };
  }

  it("holds events until the script has loaded, then sends them in order", () => {
    const { win, calls, install } = laterWindow();
    const tracker = createTracker(() => envOf(win));
    tracker.track("sim_start", { mode: "classic", entry: "direct" });
    tracker.track("share_copy");
    expect(tracker.queued()).toBe(2);
    expect(calls).toEqual([]);
    install();
    tracker.flush();
    expect(tracker.queued()).toBe(0);
    expect(calls.map((c) => c[1])).toEqual(["sim_start", "share_copy"]);
  });

  it("sends at once when the service is already there, after what waited", () => {
    const { win, calls, install } = laterWindow();
    const tracker = createTracker(() => envOf(win));
    tracker.track("signup");
    install();
    tracker.track("share_copy");
    expect(calls.map((c) => c[1])).toEqual(["signup", "share_copy"]);
    expect(tracker.queued()).toBe(0);
  });

  it(`keeps at most ${QUEUE_LIMIT} events: the oldest go first`, () => {
    const { win, calls, install } = laterWindow();
    const tracker = createTracker(() => envOf(win));
    for (let i = 0; i < QUEUE_LIMIT + 5; i++) tracker.track("clip_export", { kind: "fast", secs: i });
    expect(tracker.queued()).toBe(QUEUE_LIMIT);
    install();
    tracker.flush();
    expect(calls).toHaveLength(QUEUE_LIMIT);
    expect((calls[0][2] as { props: { secs: number } }).props.secs).toBe(5);
    expect((calls[QUEUE_LIMIT - 1][2] as { props: { secs: number } }).props.secs).toBe(QUEUE_LIMIT + 4);
  });

  it("drops what waited when the script never comes (a blocker, offline) and sends nothing after", () => {
    const { win, calls, install } = laterWindow();
    const tracker = createTracker(() => envOf(win));
    tracker.track("signup");
    tracker.drop();
    expect(tracker.queued()).toBe(0);
    install();
    tracker.track("signup");
    tracker.flush();
    expect(calls).toEqual([]);
  });

  it("forgets the events of a script that loaded but offers no service, and sends nothing more", () => {
    const { win } = laterWindow();
    const tracker = createTracker(() => envOf(win));
    tracker.track("signup");
    tracker.flush();
    expect(tracker.queued()).toBe(0);
    tracker.track("signup");
    expect(tracker.queued()).toBe(0);
  });

  it("forgets the queue when a gate closed while it waited", () => {
    const { win, calls, install } = laterWindow();
    const nav = (win as unknown as { navigator: Record<string, unknown> }).navigator;
    const tracker = createTracker(() => envOf(win));
    tracker.track("signup");
    nav.globalPrivacyControl = true;
    install();
    tracker.flush();
    expect(calls).toEqual([]);
    expect(tracker.queued()).toBe(0);
  });
});

describe("markup events: one delegated click listener", () => {
  type Listener = (event: Event) => void;
  function fakeDocument() {
    const listeners: { type: string; fn: Listener; capture: unknown }[] = [];
    const doc = {
      addEventListener: (type: string, fn: Listener, capture?: unknown) => listeners.push({ type, fn, capture }),
      removeEventListener: (type: string, fn: Listener) => {
        const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    } as unknown as Document;
    return { doc, listeners, click: (target: unknown) => listeners.filter((l) => l.type === "click").forEach((l) => l.fn({ target } as unknown as Event)) };
  }
  /** An element with attributes whose closest("[data-track]") is itself (or null for an element without the attribute). */
  const element = (attrs: Record<string, string>) => {
    const el: { getAttribute: (n: string) => string | null; closest: (s: string) => unknown } = {
      getAttribute: (n) => (n in attrs ? attrs[n] : null),
      closest: (s) => (s === "[data-track]" && "data-track" in attrs ? el : null),
    };
    return el;
  };

  function setup(extra?: (name: EventName, props: Record<string, unknown>) => void) {
    const { win, calls } = allServices();
    const tracker: Tracker = createTracker(() => envOf(win), extra);
    const dom = fakeDocument();
    const unbind = tracker.bindClicks(dom.doc);
    return { calls, dom, unbind, tracker };
  }

  it("sends cta_click with the id from data-track-id, from a click anywhere inside the element", () => {
    const { calls, dom } = setup();
    const button = element({ "data-track": "cta_click", "data-track-id": "hero_studio" });
    dom.click({ closest: (s: string) => button.closest(s) }); // the icon inside the button
    expect(calls).toEqual([["plausible", "cta_click", { props: { id: "hero_studio" } }]]);
  });

  it("sends download_click with the kind", () => {
    const { calls, dom } = setup();
    dom.click(element({ "data-track": "download_click", "data-track-kind": "portable" }));
    expect(calls).toEqual([["plausible", "download_click", { props: { kind: "portable" } }]]);
  });

  it("listens in the capture phase, once, and the unbind removes it", () => {
    const { dom, unbind, calls } = setup();
    expect(dom.listeners).toHaveLength(1);
    expect(dom.listeners[0].capture).toBe(true);
    unbind();
    expect(dom.listeners).toHaveLength(0);
    dom.click(element({ "data-track": "cta_click", "data-track-id": "hero_studio" }));
    expect(calls).toEqual([]);
  });

  it("ignores a click outside any data-track element, an event markup may not send and an id that is not on the list", () => {
    const { calls, dom } = setup();
    dom.click(element({}));
    dom.click(null);
    dom.click({});
    dom.click(element({ "data-track": "purchase", "data-track-plan": "yearly" }));
    dom.click(element({ "data-track": "signup" }));
    dom.click(element({ "data-track": "cta_click", "data-track-id": "not_a_button" }));
    dom.click(element({ "data-track": "cta_click" }));
    expect(calls).toEqual([]);
    expect([...MARKUP_EVENTS]).toEqual(["cta_click", "download_click"]);
  });

  it("tells the page which button was clicked (the gallery's Try it sets the entry of the next sim_start)", () => {
    const seen: string[] = [];
    const { dom } = setup((name, props) => seen.push(`${name}:${String(props.id)}`));
    dom.click(element({ "data-track": "cta_click", "data-track-id": "gallery_try" }));
    expect(seen).toEqual(["cta_click:gallery_try"]);
  });
});

describe("the page's own tracker, with a script address built in", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function load(win: Window | undefined, url: string) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_SCRIPT_URL", url);
    if (win) vi.stubGlobal("window", win);
    const track = await import("@/lib/analytics/track");
    const events = await import("@/lib/analytics/events");
    return { ...track, ...events };
  }

  it("does nothing at all when the build has no script address, even with a service on the page", async () => {
    const { win, calls } = allServices();
    const m = await load(win, "");
    m.track("signup");
    m.flushTrackQueue();
    m.trackSimStart("classic", false);
    expect(calls).toEqual([]);
    expect(m.ANALYTICS_SCRIPT_URL).toBe("");
  });

  it("sends through the service once the build has an address", async () => {
    const { win, calls } = allServices();
    const m = await load(win, URL_OK);
    m.track("signup");
    expect(calls).toEqual([["plausible", "signup", undefined]]);
  });

  it("sim_start goes once per page load, with the entry the visit came by", async () => {
    const { win, calls } = allServices();
    const m = await load(win, URL_OK);
    m.noteEntry("gallery");
    m.trackSimStart("shatter", false);
    m.trackSimStart("classic", false);
    expect(calls).toEqual([["plausible", "sim_start", { props: { mode: "shatter", entry: "gallery" } }]]);
  });

  it("a daily link is entry daily, a decoded share link entry share, nothing noted is direct", async () => {
    let run = allServices();
    let m = await load(run.win, URL_OK);
    m.trackSimStart("classic", true);
    expect(run.calls[0][2]).toEqual({ props: { mode: "classic", entry: "daily" } });
    run = allServices();
    m = await load(run.win, URL_OK);
    m.trackShareOpen("code");
    m.trackSimStart("classic", false);
    expect(run.calls.map((c) => c[2])).toEqual([{ props: { kind: "code" } }, { props: { mode: "classic", entry: "share" } }]);
    run = allServices();
    m = await load(run.win, URL_OK);
    m.trackSimStart("classic", false);
    expect(run.calls[0][2]).toEqual({ props: { mode: "classic", entry: "direct" } });
  });

  it("clip_export says free until a licence is installed, and adds only what is known", async () => {
    const { win, calls } = allServices();
    const m = await load(win, URL_OK);
    m.trackClipExport({ kind: "record", mode: "classic", res: "1080x1920", secs: 29.6 });
    m.trackClipExport({ kind: "batch", secs: 0 });
    m.trackClipExport({ kind: "fast", watermark: "pro" });
    expect(calls.map((c) => c[2])).toEqual([
      { props: { kind: "record", watermark: "free", mode: "classic", res: "1080x1920", secs: 30 } },
      { props: { kind: "batch", watermark: "free" } },
      { props: { kind: "fast", watermark: "pro" } },
    ]);
  });

  it("purchase carries the plan's list price in USD, once per receipt reference, and never the reference", async () => {
    const { win, calls } = allServices();
    const m = await load(win, URL_OK);
    m.trackPurchase("ref_abc123", "yearly", "stripe");
    m.trackPurchase("ref_abc123", "yearly", "stripe");
    m.trackPurchase("ref_def456", "monthly", "crypto");
    expect(calls).toEqual([
      ["plausible", "purchase", { props: { plan: "yearly", provider: "stripe" }, revenue: { currency: "USD", amount: PLANS.yearly.usd } }],
      ["plausible", "purchase", { props: { plan: "monthly", provider: "crypto" }, revenue: { currency: "USD", amount: PLANS.monthly.usd } }],
    ]);
    expect(JSON.stringify(calls)).not.toContain("ref_");
  });

  it("the delegated listener of the page's tracker keeps the gallery entry", async () => {
    const { win, calls } = allServices();
    const m = await load(win, URL_OK);
    const handlers: ((e: Event) => void)[] = [];
    const doc = { addEventListener: (_t: string, fn: (e: Event) => void) => handlers.push(fn), removeEventListener: () => undefined } as unknown as Document;
    m.bindTrackClicks(doc);
    const el = { getAttribute: (n: string) => ({ "data-track": "cta_click", "data-track-id": "gallery_try" })[n] ?? null, closest: () => el };
    handlers[0]({ target: el } as unknown as Event);
    m.trackSimStart("classic", false);
    expect(calls.map((c) => c[2])).toEqual([{ props: { id: "gallery_try" } }, { props: { mode: "classic", entry: "gallery" } }]);
  });
});

describe("the account and publish controllers send their events", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  async function withService() {
    const { win, calls } = allServices();
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_SCRIPT_URL", URL_OK);
    vi.stubGlobal("window", win);
    return { calls };
  }

  it("signup is counted when an account is made: not for a sign-in or a refusal, and it carries nothing", async () => {
    const { calls } = await withService();
    const { AccountController } = await import("@/lib/account/controller");
    const NOW = 1_800_000_000_000;
    const session = { token: "jbs_abc", expiresAt: new Date(NOW + 30 * 864e5).toISOString(), user: { id: "u_1", email: "alice@example.com", name: "Alice" } };
    const make = () => {
      const mem = new Map<string, string>();
      const fetchImpl = async (url: string) => {
        const p = new URL(url).pathname;
        if (p === "/api/health") return reply({ signup: true, platforms: {} });
        if (p === "/api/auth/signup" || p === "/api/auth/login") return reply(session, 201);
        throw new TypeError(`unexpected ${url}`);
      };
      return new AccountController({
        fetch: () => fetchImpl as never,
        storage: () => ({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) }),
        window: () => ({ dispatchEvent: () => true }) as never,
        now: () => NOW,
        envRelayUrl: "https://relay.example",
        publish: () => ({ start: () => {}, saveProfile: () => null, removeProfile: () => {}, profile: () => null }),
      });
    };
    const a = make();
    a.start();
    await flush();
    expect(await a.login("alice@example.com", "correct horse")).toBe(true);
    expect(calls).toEqual([]);
    const b = make();
    b.start();
    await flush();
    expect(await b.signup("not an email", "correct horse")).toBe(false);
    expect(await b.signup("alice@example.com", "short")).toBe(false);
    expect(calls).toEqual([]);
    expect(await b.signup("alice@example.com", "correct horse", "Alice")).toBe(true);
    expect(calls).toEqual([["plausible", "signup", undefined]]);
    expect(JSON.stringify(calls)).not.toMatch(/alice|correct horse|jbs_/);
  });

  /** A window with a popup, the message and focus events of the relay's sign-in page, and a document. */
  function popupWindow() {
    const listeners: Record<string, Set<(e: unknown) => void>> = {};
    const popup = { closed: false, location: { href: "about:blank" }, close: () => void (popup.closed = true) };
    const win = {
      document: { createElement: () => ({}) },
      location: { origin: "https://site.example" },
      open: () => popup,
      addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] ??= new Set()).add(fn),
      removeEventListener: (type: string, fn: (e: unknown) => void) => void listeners[type]?.delete(fn),
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    };
    return { win: win as unknown as Window & typeof globalThis, popup, fire: (type: string, e: unknown = {}) => [...(listeners[type] ?? [])].forEach((fn) => fn(e)) };
  }

  it("channel_connected is counted when the relay's sign-in page reports an account, once, for the platform asked", async () => {
    const { calls } = await withService();
    const { PublishController } = await import("@/lib/publish/controller");
    const { PUBLISH_STORAGE_KEY } = await import("@/lib/publish/store");
    const mem = new Map<string, string>([[PUBLISH_STORAGE_KEY, JSON.stringify({ relayProfiles: [{ id: "p1", url: "https://relay.example", key: "jbl_team", label: "Team" }], activeRelay: "p1" })]]);
    const fetchImpl = async (url: string) => {
      const p = new URL(url).pathname;
      if (p === "/api/me") return reply({ key: { id: "k1", label: "Team" }, platforms: { tiktok: true, instagram: true, youtube: false } });
      if (p === "/api/accounts") return reply({ accounts: [] });
      if (p.startsWith("/api/connect/")) return reply({ url: `https://relay.example/connect/${p.split("/").pop()}?state=s1` });
      throw new TypeError(`unexpected ${url}`);
    };
    const fw = popupWindow();
    const c = new PublishController({ fetch: () => fetchImpl as never, window: () => fw.win, storage: () => ({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) }), now: () => Date.now(), envClientId: "", envRelayUrl: "" });
    c.start();
    await vi.waitFor(() => expect(c.getSnapshot().relay.status).toBe("ok"));
    c.connectRelay("instagram");
    await vi.waitFor(() => expect(fw.popup.location.href).toContain("/connect/instagram"));
    const relay = (data: Record<string, unknown>, origin = "https://relay.example") => fw.fire("message", { origin, data: { source: "jumpingballslive-relay", ...data } });
    relay({ type: "connected", accounts: [{ id: "a_x" }] }, "https://evil.example"); // another origin: ignored
    expect(calls).toEqual([]);
    relay({ type: "error", message: "No Instagram professional account is connected" }); // a failed sign-in
    expect(calls).toEqual([]);
    c.connectRelay("tiktok");
    await vi.waitFor(() => expect(fw.popup.location.href).toContain("/connect/tiktok"));
    relay({ type: "connected", platform: "tiktok", accounts: [{ id: "a_t1" }] });
    relay({ type: "connected", platform: "tiktok", accounts: [{ id: "a_t1" }] }); // the page reported twice: counted once
    expect(calls).toEqual([["plausible", "channel_connected", { props: { platform: "tiktok" } }]]);
    c.cancelConnect();
  });

  it("publish_sent is counted for a clip the share sheet took or the upload page opened for, not for a cancelled or blocked share", async () => {
    const { calls } = await withService();
    const { PublishController } = await import("@/lib/publish/controller");
    const { offerPublishClip, resetPublishClips } = await import("@/lib/publish/clips");
    resetPublishClips();
    const win = { document: { createElement: () => ({}) }, location: { origin: "https://site.example" }, open: () => null, navigator: {} } as unknown as Window & typeof globalThis;
    const c = new PublishController({ fetch: () => (async () => { throw new TypeError("offline"); }) as never, window: () => win, storage: () => null, now: () => Date.now(), envClientId: "", envRelayUrl: "" });
    offerPublishClip({ blob: new Blob(["clip"], { type: "video/mp4" }), name: "clip", source: "fast", durationSec: 10, mode: "classic" });
    c.start();
    const clipboard = { writeText: async () => {} };
    const page = { createElement: () => ({ click: () => {} }), body: { appendChild: () => {}, removeChild: () => {} } } as unknown as Document;
    const phone = { userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile", canShare: () => true, clipboard };
    // the share sheet took it
    await c.quickShare("tiktok", { navigator: { ...phone, share: async () => {} }, document: page, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    expect(calls).toEqual([["plausible", "publish_sent", { props: { platform: "tiktok", via: "share" } }]]);
    // the visitor closed the sheet
    await c.quickShare("instagram", { navigator: { ...phone, share: async () => Promise.reject(Object.assign(new Error("closed"), { name: "AbortError" })) }, document: page, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    expect(calls).toHaveLength(1);
    // a desktop: the upload page opened and the clip downloaded
    await c.quickShare("youtube", { navigator: { clipboard }, document: page, open: () => ({}), createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(["plausible", "publish_sent", { props: { platform: "youtube", via: "share" } }]);
    // a desktop where neither happened (no tab, no document)
    await c.quickShare("tiktok", { navigator: { clipboard }, document: null, open: () => null });
    expect(calls).toHaveLength(2);
    resetPublishClips();
  });

  it("publish_sent via api is counted for a clip that was published, not for one that failed", async () => {
    const { calls } = await withService();
    const { PublishController } = await import("@/lib/publish/controller");
    const { offerPublishClip, resetPublishClips } = await import("@/lib/publish/clips");
    const { emptyDraft } = await import("@/lib/publish/caption");
    const { PUBLISH_STORAGE_KEY } = await import("@/lib/publish/store");
    resetPublishClips();
    const now = 1_700_000_000_000;
    let uploadOk = true;
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      const method = String(init.method ?? "GET").toUpperCase();
      if (method === "POST" && url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) return new Response(null, { status: 200, headers: { Location: "https://upload.example/yt" } });
      if (method === "PUT" && url === "https://upload.example/yt") return uploadOk ? reply({ id: "short1" }) : reply({ error: { message: "quota" } }, 403);
      throw new TypeError(`unexpected ${method} ${url}`);
    };
    const mem = new Map<string, string>([[PUBLISH_STORAGE_KEY, JSON.stringify({ youtubeAccounts: [{ id: "UC1", title: "Main", accessToken: "ya29.main", expiresAt: now + 3600e3, addedAt: 1 }], checked: ["yt:UC1"], visibility: "public" })]]);
    const c = new PublishController({ fetch: () => fetchImpl as never, window: () => null, storage: () => ({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) }), now: () => now, envClientId: "", envRelayUrl: "" });
    c.start();
    const clip = offerPublishClip({ blob: new Blob([new Uint8Array(512)], { type: "video/mp4" }), name: "clip", source: "fast", durationSec: 20, mode: "classic" });
    c.ensureDraft(clip.id, () => ({ ...emptyDraft(), title: "Can it escape?", caption: "Ring escape", hashtags: "#ball" }));
    uploadOk = false;
    await c.sendSelected();
    expect(calls).toEqual([]);
    uploadOk = true;
    await c.sendSelected();
    expect(calls).toEqual([["plausible", "publish_sent", { props: { platform: "youtube", via: "api" } }]]);
    resetPublishClips();
  });
});

describe("the loader: no request to any service behind a gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("react");
    vi.resetModules();
  });

  /** Runs Analytics() with its effect run at once, in a fake page; returns what the page got. */
  async function mount(win: Window, url: string, siteId?: string) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_SCRIPT_URL", url);
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_SITE_ID", siteId ?? "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://jumpingballslive.com");
    const cleanups: (void | (() => void))[] = [];
    vi.doMock("react", async (original) => ({ ...(await original<typeof import("react")>()), useEffect: (fn: () => void | (() => void)) => void cleanups.push(fn()) }));
    const added: { attrs: Record<string, string>; src: string; defer: boolean; listeners: Record<string, () => void> }[] = [];
    const clickListeners: unknown[] = [];
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", {
      head: { appendChild: (el: (typeof added)[number]) => added.push(el) },
      createElement: () => {
        const el = { attrs: {} as Record<string, string>, src: "", defer: false, listeners: {} as Record<string, () => void>, setAttribute(k: string, v: string) { el.attrs[k] = v; }, addEventListener(t: string, f: () => void) { el.listeners[t] = f; } };
        return el;
      },
      querySelector: (selector: string) => (selector.includes("data-jbl-stats") ? (added.find((a) => "data-jbl-stats" in a.attrs) ?? null) : null),
      addEventListener: (...args: unknown[]) => clickListeners.push(args),
      removeEventListener: () => undefined,
    });
    const { default: Analytics } = await import("@/components/site/Analytics");
    expect(Analytics()).toBeNull();
    return { added, clickListeners, cleanups };
  }

  it("adds the script with the service's attributes when every gate holds, and flushes the queue when it loads", async () => {
    const calls: Call[] = [];
    const win = fakeWindow();
    const { added, clickListeners } = await mount(win, URL_OK, "site-123");
    expect(added).toHaveLength(1);
    expect(added[0].src).toBe(URL_OK);
    expect(added[0].defer).toBe(true);
    expect(added[0].attrs).toMatchObject({ "data-domain": "jumpingballslive.com", "data-website-id": "site-123", "data-site-id": "site-123", "data-do-not-track": "true", "data-jbl-stats": "" });
    expect(clickListeners).toHaveLength(1);
    // an event before the script has loaded waits, and goes out when it loads
    const track = await import("@/lib/analytics/track");
    track.track("signup");
    (win as unknown as Record<string, unknown>).plausible = (...a: unknown[]) => calls.push(["plausible", ...a]);
    added[0].listeners.load();
    expect(calls).toEqual([["plausible", "signup", undefined]]);
  });

  it("adds no site id attribute when there is none", async () => {
    const { added } = await mount(fakeWindow(), URL_OK);
    expect(Object.keys(added[0].attrs)).not.toContain("data-website-id");
    expect(Object.keys(added[0].attrs)).not.toContain("data-site-id");
  });

  it("adds nothing and binds nothing without a script address", async () => {
    const { added, clickListeners } = await mount(fakeWindow(), "");
    expect(added).toEqual([]);
    expect(clickListeners).toEqual([]);
  });

  it("adds nothing and binds nothing for Do Not Track, Global Privacy Control, the Windows app and an app:// page", async () => {
    for (const win of [fakeWindow({}, { doNotTrack: "1" }), fakeWindow({}, { globalPrivacyControl: true }), fakeWindow({ desktop: { apiVersion: 1 } }), fakeWindow({ location: { protocol: "app:" } })]) {
      const { added, clickListeners } = await mount(win, URL_OK);
      expect(added).toEqual([]);
      expect(clickListeners).toEqual([]);
    }
  });

  it("holds the script back while the address carries a checkout receipt, and adds it once the page has removed it", async () => {
    expect(carriesClaim("?claim=stripe&ref=cs_test_123")).toBe(true);
    expect(carriesClaim("?utm_source=x&claim=crypto")).toBe(true);
    expect(carriesClaim("?utm_source=x&ref=producthunt")).toBe(false); // ref= alone is a campaign tag, not a receipt
    expect(carriesClaim("")).toBe(false);
    expect(carriesClaim(undefined)).toBe(false);
    const location = { protocol: "https:", hostname: "jumpingballslive.com", search: "?claim=stripe&ref=cs_test_123" };
    const timers: { fn: () => void; cleared: boolean }[] = [];
    const win = fakeWindow({
      location,
      setInterval: (fn: () => void) => timers.push({ fn, cleared: false }),
      clearInterval: () => void (timers[0].cleared = true),
    });
    const { added, cleanups } = await mount(win, URL_OK);
    expect(added).toEqual([]); // nothing was sent to the service: the address holds the receipt
    expect(timers).toHaveLength(1);
    timers[0].fn(); // still there: a pending crypto claim, a failed one
    expect(added).toEqual([]);
    location.search = ""; // the claim was settled and the page replaced the address
    timers[0].fn();
    expect(added).toHaveLength(1);
    expect(timers[0].cleared).toBe(true);
    // leaving the page stops the wait
    const stop = cleanups.find((c) => typeof c === "function") as (() => void) | undefined;
    stop?.();
  });

  it("adds nothing for an address that is not http(s)", async () => {
    const { added } = await mount(fakeWindow(), "javascript:alert(1)");
    expect(added).toEqual([]);
  });

  it("is a client component without next/script, mounted once in the locale layout", () => {
    const loader = read("src/components/site/Analytics.tsx");
    expect(loader.startsWith('"use client"')).toBe(true);
    expect(loader).not.toContain("next/script");
    expect(loader.indexOf("trackingAllowed()")).toBeLessThan(loader.indexOf("createElement"));
    expect(loader).toContain('"data-do-not-track", "true"');
    expect((read("src/app/[locale]/layout.tsx").match(/<Analytics \/>/g) ?? []).length).toBe(1);
  });
});

/** The rows of the README's "Analytics events" table: event → the prop names of its second column. */
function readmeEvents(): Map<string, string[]> {
  const readme = read("README.md");
  const start = readme.indexOf("\n### Analytics events\n");
  expect(start, "README has an 'Analytics events' section").toBeGreaterThan(-1);
  const end = readme.indexOf("\n### ", start + 5);
  const section = readme.slice(start, end === -1 ? undefined : end);
  const rows = new Map<string, string[]>();
  for (const line of section.split("\n")) {
    const m = /^\| `([a-z_]+)` \| ([^|]*) \| ([^|]+) \|$/.exec(line);
    if (m) rows.set(m[1], [...m[2].matchAll(/`([a-z_]+)`/g)].map((p) => p[1]));
  }
  return rows;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe("README 'Analytics events' against the code", () => {
  it("has a row for every event, no other, and each row lists exactly the event's props", () => {
    const rows = readmeEvents();
    expect([...rows.keys()].sort()).toEqual(Object.keys(EVENTS).sort());
    for (const [name, props] of Object.entries(EVENTS)) expect(rows.get(name), name).toEqual([...props]);
  });

  it("lists every closed value of cta_click.id in its Values line", () => {
    const readme = read("README.md");
    const values = /- \*\*Values\*\* – ([^\n]+)/.exec(readme)?.[1] ?? "";
    for (const id of CTA_IDS) expect(values, id).toContain(`\`${id}\``);
    for (const [key, list] of Object.entries(PROP_VALUES)) for (const v of list) expect(values, `${key} ${v}`).toContain(`\`${v}\``);
  });
});

describe("every event used in src/ is in EVENTS", () => {
  const files = walk("src").filter((f) => !f.endsWith(path.join("lib", "analytics", "track.ts")));
  const sources = files.map((f) => [f, read(f)] as const);

  /** All matches of a regex over src, with the file for the message. */
  const find = (re: RegExp) => sources.flatMap(([file, text]) => [...text.matchAll(re)].map((m) => ({ file, groups: m })));

  it("track('name') calls and data-track attributes name events that exist", () => {
    const used = [
      ...find(/\btrack\(\s*"([a-z_]+)"/g),
      ...find(/data-track="([a-z_]+)"/g),
      ...find(/"data-track":\s*"([a-z_]+)"/g),
    ];
    expect(used.length).toBeGreaterThan(15);
    for (const { file, groups } of used) expect(Object.keys(EVENTS), `${file}: ${groups[1]}`).toContain(groups[1]);
    // every event has at least one call site
    const names = new Set(used.map((u) => u.groups[1]));
    for (const event of Object.keys(EVENTS)) expect(names, `no call site for ${event}`).toContain(event);
  });

  it("call sites pass only the props their event lists", () => {
    const calls = find(/\btrack\(\s*"([a-z_]+)"\s*,\s*\{([^}]*)\}/g);
    expect(calls.length).toBeGreaterThan(5);
    for (const { file, groups } of calls) {
      const event = groups[1] as EventName;
      const keys = groups[2].split(",").map((part) => part.trim().split(/[:\s]/)[0]).filter((key) => key && !key.startsWith("...")); // (a spread of optional props is checked by the sanitiser)
      for (const key of keys) expect(EVENTS[event] as readonly string[], `${file}: ${event}.${key}`).toContain(key);
    }
  });

  it("every cta id and download kind in the markup is a closed value, and every id is used", () => {
    const ids = [...find(/data-track-id="([a-z_]+)"/g), ...find(/\btracked\("([a-z_]+)"\)/g), ...find(/\btrack: "([a-z_]+)"/g)].map((u) => u.groups[1]);
    for (const id of ids) expect([...CTA_IDS], id).toContain(id);
    for (const id of CTA_IDS) expect(ids, `CTA id ${id} is on no element`).toContain(id);
    const kinds = find(/data-track-kind="([a-z_]+)"/g).map((u) => u.groups[1]);
    expect(kinds.sort()).toEqual(["checksums", "portable", "setup"]);
  });

  it("no service is called outside lib/analytics/track.ts, and no vendor host is written into src", () => {
    expect(find(/\b(window\.)?(plausible|umami|rybbit)\s*[.(]/g).map((u) => u.file)).toEqual([]);
    const hosts = find(/plausible\.io|umami\.is|rybbit\.io|googletagmanager|connect\.facebook\.net|analytics\.tiktok\.com/g);
    expect(hosts.map((h) => h.file)).toEqual([]);
  });

  it("data-track elements carry only listed attributes (nothing else leaks from markup)", () => {
    const attrs = find(/data-track-([a-z]+)=/g).map((u) => u.groups[1]);
    expect(new Set(attrs)).toEqual(new Set(["id", "kind"]));
  });
});
