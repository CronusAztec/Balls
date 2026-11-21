import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../messages/en.json";
import type { Translate } from "@/components/simulator/ControlPrimitives";
import { ADVANCED_KEYS, advancedCount, paletteKeyGroups, type AdvancedShown, type ControlSection } from "@/components/simulator/Controls";
import type { PanelShown } from "@/components/simulator/panelKeys";
import MusicSection, { MUSIC_ADVANCED_KEYS } from "@/components/simulator/sections/MusicSection";
import SongSlicerSection, { SONG_SLICER_ADVANCED_KEYS } from "@/components/simulator/sections/SongSlicerSection";
import { VIDEO_BEATS_ADVANCED_KEYS } from "@/components/simulator/sections/VideoBeatsSection";
import { BALL_PHYSICS_EXTRA_KEYS, WALL_PHYSICS_EXTRA_KEYS } from "@/components/simulator/sections/PhysicsExtrasSection";
import { defaultSettings, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { searchKeyShown } from "@/components/simulator/panelKeys";
import { LAST_STUDIO_KEY, LAST_STUDIO_MAX, UNDO_LIMIT, isBareStudioQuery, pressesItself, pushUndo, readStudioQuery, rememberStudioQuery, studioQueryMode, studioQueryOf, typesText, undoPatch } from "@/lib/studioMemory";

/*
 * --- panel-basics --- The studio panel's basics: what Show Advanced Options holds back in each group and how many (the row
 * at the end of a group says it, so its count must be true), the undo history's patches, and the last studio address a
 * bare visit offers to continue from.
 */

// The components are compiled with the classic JSX transform here (tsconfig keeps JSX for Next): React must be global.
(globalThis as { React?: unknown }).React = React;

const controls = en.Controls as Record<string, string>;
const t = ((key: string, values?: Record<string, unknown>) => String(new IntlMessageFormat(controls[key] ?? key, "en").format(values as Record<string, string>))) as unknown as Translate;
const render = (child: React.ReactElement) => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, child));
/** The search keys of the cards a render shows (a search shows every control on a card of its own). */
const keysIn = (html: string) => [...html.matchAll(/data-search-key="([^"]+)"/g)].map((m) => m[1]);
const source = (file: string) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const PANEL: PanelShown = { mode: "classic", ballPicture: false, showTrails: true, glassGates: false, wobblyWalls: true, simulationFound: false, bannerText: true, arenas: false, teams: false, captions: false, videoBackground: false, videoBeats: true, batch: true, bot: true };
const ALL: AdvancedShown = { tones: true, musicTrack: true, onBeat: true, breathing: true };
const NONE: AdvancedShown = { tones: false, musicTrack: false, onBeat: false, breathing: false };

describe("Show Advanced Options: what each group holds back", () => {
  it("lists keys of the group's own controls, each once, and never gravity, the top text or the bottom text", () => {
    const seen = new Set<string>();
    for (const [group, keys] of Object.entries(ADVANCED_KEYS)) {
      const own = paletteKeyGroups(PANEL, [group as ControlSection], false)[1].keys;
      for (const key of keys) {
        expect(own, `${group}: ${key}`).toContain(key);
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
    for (const key of ["gravity", "topText", "bottomText", "ballSpeed", "ballSize", "ballColor", "videoDuration"]) expect(seen.has(key), key).toBe(false);
  });

  it("is the table every gate of the panel reads: no gate of Controls.tsx bypasses it", () => {
    const code = source("src/components/simulator/Controls.tsx");
    // (the switch itself, and the blocks that gate their own controls, take `showAdvanced`; every other gate is shows(key))
    expect(code).not.toMatch(/showAdvanced\s*&&/);
    expect(code).not.toMatch(/&&\s*showAdvanced\b/);
    expect(code).not.toMatch(/showAdvanced\s*\?/);
    const passed = [...code.matchAll(/<(\w+)[^>]*?showAdvanced=\{showAdvanced\}/g)].map((m) => m[1]).sort();
    expect(passed).toEqual(["MusicSection", "PicturePaintSection", "SongSlicerSection", "VideoBeatsSection"]);
    const flat = new Set(Object.values(ADVANCED_KEYS).flat());
    const gated = [...code.matchAll(/shows\(("(\w+)"|(\w+)\[0\])\)/g)].map((m) => m[2] ?? (m[3] === "BALL_PHYSICS_EXTRA_KEYS" ? BALL_PHYSICS_EXTRA_KEYS[0] : m[3] === "WALL_PHYSICS_EXTRA_KEYS" ? WALL_PHYSICS_EXTRA_KEYS[0] : m[3]));
    expect(gated.length).toBeGreaterThanOrEqual(12);
    for (const key of gated) expect(flat.has(key), key).toBe(true);
    // every key the panel's own gates hold back has its gate (a block's keys behind its first one's)
    const blocks = new Set([...BALL_PHYSICS_EXTRA_KEYS, ...WALL_PHYSICS_EXTRA_KEYS, "forcedWinner", ...MUSIC_ADVANCED_KEYS, ...SONG_SLICER_ADVANCED_KEYS, ...VIDEO_BEATS_ADVANCED_KEYS]);
    for (const key of flat) if (!blocks.has(key)) expect(gated, key).toContain(key);
  });

  it("matches what the Sound group's blocks hold back themselves", () => {
    const s = defaultSettings("classic");
    const all = () => true;
    const music = (showAdvanced: boolean) =>
      keysIn(render(createElement(MusicSection, { t, search: "x", matches: all, showAdvanced, settings: s, update: () => {}, track: { name: "bed.wav", duration: 30 } as never, loading: false, playing: false, getDuckGain: () => 1, onUpload: () => {}, onRemove: () => {} })));
    const slicer = (showAdvanced: boolean) => keysIn(render(createElement(SongSlicerSection, { t, search: "x", matches: all, showAdvanced, settings: s, update: () => {}, songName: "song.wav", songDuration: 20, loading: false, onUpload: () => {}, onClear: () => {} })));
    const held = (on: string[], off: string[]) => on.filter((key) => !off.includes(key));
    expect(held(music(true), music(false))).toEqual([...MUSIC_ADVANCED_KEYS]);
    expect(held(slicer(true), slicer(false))).toEqual([...SONG_SLICER_ADVANCED_KEYS]);
    // (the beats block needs the page's beat source to render: its one gate is read from its code)
    const beats = source("src/components/simulator/sections/VideoBeatsSection.tsx");
    const gates = [...beats.matchAll(/showAdvanced && \(\s*<Slider[^>]*?labelKey="(\w+)"/g)].map((m) => m[1]);
    expect(gates).toEqual([...VIDEO_BEATS_ADVANCED_KEYS]);
    expect(beats.match(/showAdvanced/g)?.length).toBe(3); // (the prop's type, its parameter and the one gate)
  });

  it("counts what the switch would add right now, group by group", () => {
    expect(advancedCount("ball", PANEL, NONE)).toBe(3 + BALL_PHYSICS_EXTRA_KEYS.length); // Full-physics balls, Bounciness, the ball's picture, the physics extras
    expect(advancedCount("wall", PANEL, NONE)).toBe(2 + WALL_PHYSICS_EXTRA_KEYS.length - 1); // thickness, gap size, wall bounciness, breathing (its speed waits for it)
    expect(advancedCount("wall", PANEL, ALL)).toBe(2 + WALL_PHYSICS_EXTRA_KEYS.length);
    expect(advancedCount("visual", PANEL, NONE)).toBe(4); // cinematic, never escape, forced winner, trail thickness
    expect(advancedCount("visual", { ...PANEL, showTrails: false }, NONE)).toBe(3);
    expect(advancedCount("sound", PANEL, NONE)).toBe(2); // the slice fade, the wall-break import
    expect(advancedCount("sound", PANEL, ALL)).toBe(6);
    expect(advancedCount("sound", { ...PANEL, videoBeats: false }, ALL)).toBe(5);
    expect(advancedCount("recording", PANEL, NONE)).toBe(2);
    expect(advancedCount("recording", { ...PANEL, bannerText: false }, NONE)).toBe(1);
    for (const group of ["teams", "obstacles", "captions", "timeline", "arenas"] as const) expect(advancedCount(group, PANEL, ALL), group).toBe(0);
    // a mode without rings holds back no wall thickness or gap size
    expect(advancedCount("wall", { ...PANEL, mode: "fightLeague" }, NONE)).toBe(WALL_PHYSICS_EXTRA_KEYS.length - 1);
  });
});

// --- review fix (panel-basics) --- a group heads the search results only for a match that shows a control
describe("the search results' groups", () => {
  it("count a match only where its control shows: never Text Size without a text, the arena editor with one arena or another mode's block", () => {
    expect(searchKeyShown("textSize", PANEL, false)).toBe(true);
    expect(searchKeyShown("textSize", { ...PANEL, bannerText: false }, false)).toBe(false);
    expect(searchKeyShown("videoDuration", { ...PANEL, simulationFound: true }, false)).toBe(false);
    expect(searchKeyShown("ballColor", PANEL, false)).toBe(true);
    // the mode's own block shows among the results, another mode's never
    const own = paletteKeyGroups({ ...PANEL, mode: "pendulum" }, [], false)[0].keys;
    expect(own.length).toBeGreaterThan(0);
    for (const key of own) {
      expect(searchKeyShown(key, { ...PANEL, mode: "pendulum" }, false), key).toBe(true);
      expect(searchKeyShown(key, PANEL, false), key).toBe(false);
    }
    // an alias shows what it names: Two Balls is the Ball Count slider, where the mode has one
    expect(searchKeyShown("twoBalls", { ...PANEL, mode: "classic" }, false)).toBe(searchKeyShown("ballCount", { ...PANEL, mode: "classic" }, false));
  });
});

describe("the undo history", () => {
  const base = defaultSettings("classic");
  it("restores every changed field but the mode, and nothing across modes", () => {
    const changed: SimulatorSettings = { ...base, ballSpeed: base.ballSpeed + 3, topText: "Will it escape?", teams: [...base.teams] };
    expect(undoPatch(base, changed)).toEqual({ ballSpeed: base.ballSpeed, topText: base.topText });
    expect(undoPatch(base, { ...base })).toBeNull();
    expect(undoPatch(base, defaultSettings("drop"))).toBeNull();
  });
  it("keeps at most UNDO_LIMIT snapshots, dropping the oldest", () => {
    let history: SimulatorSettings[] = [];
    for (let i = 0; i < UNDO_LIMIT + 5; i++) history = pushUndo(history, { ...base, ballSpeed: i });
    expect(history).toHaveLength(UNDO_LIMIT);
    expect(history[0].ballSpeed).toBe(5);
    expect(history[UNDO_LIMIT - 1].ballSpeed).toBe(UNDO_LIMIT + 4);
  });
  it("leaves Ctrl/Cmd+Z to a field that types text, not to a slider or a button", () => {
    const el = (tagName: string, type?: string, editable = false) => ({ tagName, type, isContentEditable: editable, closest: () => null }) as unknown as EventTarget;
    expect(typesText(el("INPUT", "text"))).toBe(true);
    expect(typesText(el("INPUT", "number"))).toBe(true);
    expect(typesText(el("INPUT"))).toBe(true);
    expect(typesText(el("TEXTAREA"))).toBe(true);
    expect(typesText(el("DIV", undefined, true))).toBe(true);
    expect(typesText(el("INPUT", "range"))).toBe(false);
    expect(typesText(el("INPUT", "checkbox"))).toBe(false);
    expect(typesText(el("BUTTON"))).toBe(false);
    expect(typesText(null)).toBe(false);
  });
  // --- studio-play --- the page's Space (start, pause, resume) leaves a focused control's own Space to it
  it("leaves Space to a focused button, link or switch, and takes it anywhere else", () => {
    const at = (match: boolean) => ({ closest: (sel: string) => (match && /button/.test(sel) ? {} : null) }) as unknown as EventTarget;
    expect(pressesItself(at(true))).toBe(true);
    expect(pressesItself(at(false))).toBe(false);
    expect(pressesItself(null)).toBe(false);
    expect(pressesItself({} as EventTarget)).toBe(false);
  });
});

describe("continue where you left off", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps only a query with a mode, without the campaign's attribution, short enough", () => {
    expect(studioQueryOf("?mode=pendulum&r=40")).toBe("?mode=pendulum&r=40");
    expect(studioQueryOf("mode=classic")).toBe("?mode=classic");
    expect(studioQueryOf("?mode=classic&utm_source=tiktok&gclid=abc&r=12")).toBe("?mode=classic&r=12");
    for (const bad of [null, undefined, "", "?", "?r=40", `?mode=classic&x=${"a".repeat(LAST_STUDIO_MAX)}`]) expect(studioQueryOf(bad), String(bad)).toBeNull();
    expect(studioQueryMode("?mode=fightLeague&r=2")).toBe("fightLeague");
    expect(studioQueryMode("?r=2")).toBeNull();
  });
  it("remembers in this browser's storage only, never wipes it with a bare address, and works without one", () => {
    expect(readStudioQuery()).toBeNull(); // (Node has no window)
    expect(() => rememberStudioQuery("?mode=classic")).not.toThrow();
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) } });
    rememberStudioQuery("?mode=pendulum&r=40");
    rememberStudioQuery("");
    rememberStudioQuery("?r=1");
    expect(readStudioQuery()).toBe("?mode=pendulum&r=40");
    expect([...store.keys()]).toEqual([LAST_STUDIO_KEY]);
    store.set(LAST_STUDIO_KEY, "not a query");
    expect(readStudioQuery()).toBeNull();
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
    expect(readStudioQuery()).toBeNull();
    expect(() => rememberStudioQuery("?mode=classic")).not.toThrow();
  });
  // --- review fix (panel-basics) --- the address a bare arrival writes (?mode=classic), met again after a reload or Back
  it("never remembers or offers the address a bare arrival writes, and keeps any other", () => {
    expect(isBareStudioQuery("?mode=classic")).toBe(true);
    expect(isBareStudioQuery(`?${settingsToSearchParams(defaultSettings()).toString()}`)).toBe(true);
    for (const kept of ["?mode=classic&r=12", "?mode=pendulum", "?mode=classic&seed=7"]) expect(isBareStudioQuery(kept), kept).toBe(false);
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) } });
    rememberStudioQuery("?mode=race&r=20");
    rememberStudioQuery("?mode=classic");
    rememberStudioQuery("?mode=classic&utm_source=tiktok");
    expect(readStudioQuery()).toBe("?mode=race&r=20");
    store.set(LAST_STUDIO_KEY, "?mode=classic");
    expect(readStudioQuery()).toBeNull();
  });
});
