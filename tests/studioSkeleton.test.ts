import vm from "vm";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { STUDIO_LOAD_TIMEOUT_MS, STUDIO_RELOAD_KEY, skeletonScript } from "@/components/simulator/studio/StudioSkeleton";
import { MODE_IDS } from "@/lib/physics/types";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- studio-first-open --- The studio skeleton's inline script (StudioSkeleton.tsx), run in a small fake page: it puts in
 * the poster and the name of the mode the address names, reloads the page once when a script of the studio fails to load,
 * says "The studio did not load" after a second failure or when nothing has taken over 15 s after the scripts arrived, and
 * keeps nothing once the studio has taken over.
 */

const NAMES: Record<string, string> = { classic: "Classic", maze: "Maze Escape", fightLeague: "Fight League" };

function page(search: string, opts: { stored?: string | null; scripts?: { src: string; loaded: boolean; status?: number }[]; storage?: "throws"; head?: (src: string) => Promise<{ status: number }> } = {}) {
  const attrs = new Map<string, string>();
  const img = { src: "", attrs: new Map<string, string>(), setAttribute(k: string, v: string) { this.attrs.set(k, v); } };
  const name = { textContent: "" };
  // the Reload button's click is taken on the window in the capture phase: a click whose target is the button (or inside it)
  class FakeNode {}
  const button = Object.assign(new FakeNode(), { contains: (n: unknown) => n === button || n === label });
  const label = new FakeNode();
  const elsewhere = new FakeNode();
  const root = {
    isConnected: true,
    hasAttribute: (k: string) => k === "data-studio-skeleton" || attrs.has(k),
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    querySelector: (sel: string) => (sel === "[data-skeleton-poster]" ? img : sel === "[data-skeleton-name]" ? name : sel === "[data-skeleton-reload]" ? button : null),
  };
  const store = new Map<string, string>();
  if (opts.stored) store.set(STUDIO_RELOAD_KEY, opts.stored);
  const scripts = opts.scripts ?? [{ src: "http://x/_next/static/chunks/page.js", loaded: true }];
  const listeners: Record<string, (e: unknown) => void> = {};
  const captured: Record<string, boolean> = {};
  const heads: string[] = [];
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; every: number; f: () => void }>();
  let reloads = 0;
  const throwing = () => {
    throw new Error("no storage");
  };
  const sandbox = {
    document: { currentScript: { parentNode: root }, querySelectorAll: () => scripts.map((s) => ({ src: s.src })) },
    location: { search, reload: () => reloads++ },
    URLSearchParams,
    Object,
    Node: FakeNode,
    ...(opts.head ? { fetch: (src: string, init: { method?: string }) => (heads.push(`${init.method} ${src}`), opts.head!(src)) } : {}),
    addEventListener: (type: string, f: (e: unknown) => void, capture?: boolean) => (listeners[type] = f, (captured[type] = capture === true)),
    sessionStorage: opts.storage === "throws" ? { getItem: throwing, setItem: throwing, removeItem: throwing } : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    performance: { now: () => now, getEntriesByName: (src: string) => scripts.filter((s) => s.src === src && s.loaded).map((s) => ({ responseStatus: s.status ?? 200 })) },
    setTimeout: (f: () => void, ms: number) => (timers.set(nextId, { at: now + ms, every: 0, f }), nextId++),
    setInterval: (f: () => void, ms: number) => (timers.set(nextId, { at: now + ms, every: ms, f }), nextId++),
    clearTimeout: (id: number) => timers.delete(id),
    clearInterval: (id: number) => timers.delete(id),
  };
  vm.runInNewContext(skeletonScript(NAMES, "/base"), sandbox);
  return {
    img,
    name,
    root,
    store,
    scripts,
    failed: () => attrs.has("data-failed"),
    reloads: () => reloads,
    heads,
    click: (on: "button" | "label" | "elsewhere") => listeners.click?.({ target: on === "button" ? button : on === "label" ? label : elsewhere }),
    captured,
    fire: (type: string, event: unknown) => listeners[type]?.(event),
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, t] = due;
        now = t.at;
        if (t.every) t.at += t.every;
        else timers.delete(id);
        t.f();
      }
      now = end;
    },
  };
}

const scriptError = (src: string) => ({ target: { src } });

describe("the studio skeleton's script", () => {
  it("shows the poster and the name of the mode the address names, Classic otherwise, and none for a share code or the daily challenge", () => {
    const maze = page("?mode=maze&seed=7");
    expect(maze.img.src).toBe("/base/modes/maze.webp");
    expect(maze.img.attrs.get("fetchpriority")).toBe("high");
    expect(maze.name.textContent).toBe("Maze Escape");
    for (const search of ["", "?mode=nope", "?mode=constructor", "?seed=12"]) {
      const p = page(search);
      expect([p.img.src, p.name.textContent], search).toEqual(["/base/modes/classic.webp", "Classic"]);
    }
    for (const search of ["?c=abc", "?daily=2026-11-21"]) {
      const p = page(search);
      expect([p.img.src, p.name.textContent], search).toEqual(["", ""]);
    }
  });

  it("reloads the page once when a studio script fails to load, then says the studio did not load", () => {
    const first = page("");
    first.fire("error", scriptError("http://x/favicon.ico"));
    first.fire("error", { target: {} });
    expect(first.reloads()).toBe(0);
    first.fire("error", scriptError("http://x/_next/static/chunks/app/page.js"));
    expect(first.reloads()).toBe(1);
    expect(first.store.get(STUDIO_RELOAD_KEY)).toBe("1");
    expect(first.failed()).toBe(false);
    // the reloaded page fails again: no second reload, the message and its Reload button
    const second = page("", { stored: "1" });
    second.fire("unhandledrejection", { reason: { name: "ChunkLoadError" } });
    expect(second.reloads()).toBe(0);
    expect(second.failed()).toBe(true);
    second.click("elsewhere");
    expect(second.reloads()).toBe(0);
    second.click("label");
    expect(second.reloads()).toBe(1);
    expect(second.captured.click).toBe(true);
    // without sessionStorage there is no automatic reload: the message straight away
    const blocked = page("", { storage: "throws" });
    blocked.fire("error", scriptError("http://x/_next/static/css/app.css"));
    expect([blocked.reloads(), blocked.failed()]).toEqual([0, true]);
    // a script that failed before the skeleton's script ran (its resource timing has the error status): the same, at once
    const early = page("", { scripts: [{ src: "http://x/_next/static/chunks/page.js", loaded: true, status: 404 }] });
    expect(early.reloads()).toBe(1);
    const earlyAgain = page("", { stored: "1", scripts: [{ src: "http://x/_next/static/chunks/page.js", loaded: true, status: 404 }] });
    expect([earlyAgain.reloads(), earlyAgain.failed()]).toEqual([0, true]);
  });

  it("says the studio did not load when nothing has taken over 15 s after the scripts arrived, and waits while they still load", async () => {
    const stuck = page("");
    stuck.advance(STUDIO_LOAD_TIMEOUT_MS - 1);
    expect(stuck.failed()).toBe(false);
    stuck.advance(1);
    expect(stuck.failed()).toBe(true);
    // a slow connection: the page chunk still loading at 15 s
    const slow = page("", { scripts: [{ src: "http://x/_next/static/chunks/page.js", loaded: false }] });
    slow.advance(30000);
    expect(slow.failed()).toBe(false);
    slow.scripts[0].loaded = true;
    slow.advance(3000);
    expect(slow.failed()).toBe(true);
    // a script that has no timing yet at 15 s is asked for with a HEAD request: unreachable, it failed before the script ran
    // (one reload); reachable, the wait goes on
    const flush = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    const gone = page("", { scripts: [{ src: "http://x/_next/static/chunks/page.js", loaded: false }], head: () => Promise.reject(new Error("offline")) });
    gone.advance(STUDIO_LOAD_TIMEOUT_MS);
    await flush();
    expect([gone.heads, gone.reloads()]).toEqual([["HEAD http://x/_next/static/chunks/page.js"], 1]);
    const missing = page("", { stored: "1", scripts: [{ src: "http://x/_next/static/chunks/page.js", loaded: false }], head: () => Promise.resolve({ status: 404 }) });
    missing.advance(STUDIO_LOAD_TIMEOUT_MS);
    await flush();
    expect([missing.reloads(), missing.failed()]).toEqual([0, true]);
    const reachable = page("", { scripts: [{ src: "http://x/_next/static/chunks/page.js", loaded: false }], head: () => Promise.resolve({ status: 200 }) });
    reachable.advance(STUDIO_LOAD_TIMEOUT_MS);
    await flush();
    reachable.advance(3000);
    await flush();
    expect([reachable.heads.length, reachable.reloads(), reachable.failed()]).toEqual([2, 0, false]);
    // ... but not for ever: a minute after the start the message shows anyway
    const never = page("", { scripts: [{ src: "http://x/_next/static/chunks/page.js", loaded: false }] });
    never.advance(62000);
    expect(never.failed()).toBe(true);
  });

  it("does nothing once the studio has taken over, and forgets the reload", () => {
    const ok = page("", { stored: "1" });
    ok.root.isConnected = false;
    ok.advance(600);
    expect(ok.store.has(STUDIO_RELOAD_KEY)).toBe(false);
    ok.fire("error", scriptError("http://x/_next/static/chunks/late.js"));
    ok.advance(60000);
    expect([ok.reloads(), ok.failed()]).toEqual([0, false]);
  });

  it("names every mode, has a poster for each, and its strings exist in every language", () => {
    for (const id of MODE_IDS) expect(fs.existsSync(path.join(__dirname, "..", "public", "modes", `${id}.webp`)), id).toBe(true);
    for (const catalog of [en, pl, es]) {
      for (const key of ["notLoaded", "reload", "noScript"] as const) expect(catalog.SimulatorPage[key].length, key).toBeGreaterThan(3);
      for (const id of MODE_IDS) expect((catalog.Modes as Record<string, { name?: string }>)[id]?.name, id).toBeTruthy();
    }
    // a name with a "<" cannot end the inline script early
    expect(skeletonScript({ classic: "</script><b>" }, "")).not.toContain("</script>");
  });
});
