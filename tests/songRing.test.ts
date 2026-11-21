import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BAND_MAX,
  BAND_MIN,
  DEFAULT_SONG_RING_SETTINGS,
  END_HOLD_MS,
  LIGHT_DING_LEVEL,
  LIGHT_DING_OCTAVES,
  LIGHT_TICK_HZ,
  MAX_SPARKS,
  NOTE_PULSE_MS,
  PLAN_LAST_AT,
  PLAN_WAIT,
  REWIND_MS,
  RING_AT,
  SCATTER,
  SONG_RING_RANGES,
  SONG_RING_SONGS,
  SONG_RING_TUNES,
  SURPRISE_TUNES,
  TICK_COOLDOWN_MS,
  TICK_HZ,
  TIMEOUT_MS,
  TUNED_SIDE,
  aimDelta,
  angleOf,
  buildSongRingLayout,
  buildSongRingTiles,
  defaultSongRingFields,
  earliestHit,
  hitBudget,
  isSongRingSong,
  latestHit,
  resolveSongRingFields,
  resolveSongRingSettings,
  songRingModeDefaults,
  songRingSettingsOf,
  songRingTuneOf,
  tileAt,
  tileHue,
  turnOf,
  wrapAngle,
  wrapPi,
  type SongRingSettings,
} from "@/lib/physics/modes/songRing";
import { CHORD_FLASH_MS, DEFAULT_SONG_RING_LABELS, SONG_RING_DATA_KEYS, SongRingDataset, SongRingLayer, completeSeconds, fade, tileHeight } from "@/components/simulator/songRingRenderer";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { RANGES, defaultSettings, engineSettingKeys, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, fixedRunDurationSec, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings } from "@/lib/bot/finderRequest";
import { MEMORY_CEILINGS } from "@/lib/uncap";
import { BOUNCE_MATH_BALL_MODES, BOUNCE_MATH_BREAK_MODES, BOUNCE_MATH_COLLIDE_MODES, BOUNCE_MATH_PASS_MODES } from "@/lib/physics/bounceMathRuntime";
import { SETTING_OPTIONS, assistantSettings } from "@/lib/desktop/ai/settingsPatch";
import { HERO_MOMENTS } from "@/lib/thumbnails/heroMoments";
import { midiToFrequency } from "@/lib/audio/scales";
import { loopPlayOptions } from "@/lib/audio/loopEvents";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { fakeGraph } from "./fakeAudio";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_SEARCH_WORDS, modeSearchWords } from "@/lib/modeSearch";
import { MODE_SHELVES, MODE_SINCE, modesOnShelf } from "@/lib/siteDesign";
import fs from "fs";
import path from "path";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/**
 * Song Ring (feature song-ring): the settings / URL / presets, the tunes as data, the ring's geometry (the layout scaled to
 * the world, the tiles of a tune, angles and turns, the rebound that lands on a target), the plan in hits, the mode in the
 * engine (the ball held inside the wall at the mode's speed, a tile lit by the first hit on it, the playhead playing what
 * is lit in the tune's order, the soft tick of a hit, the finale – the impact, the wind-on, the phrase whole over its bass
 * and kicks, the chord, the hold –, the help's nudges, the timeout, determinism, the same run in every world size, a
 * resize), the finder and the renderer.
 */

const config: PhysicsConfig = {
  width: 800,
  height: 600,
  gravity: 300,
  bounce: 1,
  damping: 0,
  ballSpeed: 400,
  rotationSpeed: 1,
  wallCount: 7,
  gapSize: 0.4,
  ballColor: "#ffffff",
  ballRadius: 8,
  audioIntensity: 0,
};

const modeSettings: ModeSettings = {
  bouncierEnabled: false,
  countdownTotal: 10,
  countdownRandom: false,
  colorMatchColorCount: 7,
  accumulationTimerMax: 4000,
  spikesEnabled: false,
  spikeCount: 6,
  multiplySpawnCount: 3,
  shatterSegmentsPerWall: 18,
  shatterHpPerSegment: 1,
  growRate: 5,
  portalCount: 3,
  twoBalls: false,
  drop: {},
  box: {},
};

const STEP = 1000 / 60;
const TWO_PI = Math.PI * 2;

function songEngine(songRing: Partial<SongRingSettings> = {}, seed = 7, cfg: PhysicsConfig = config) {
  return createEngineForSettings(cfg, "songRing", { ...modeSettings, songRing }, seed);
}

interface Timed {
  t: number;
  ev: SoundEvent;
}

/** Runs until the run finishes (or `maxSec`), collecting every sound event with its simulation time. */
function run(engine: PhysicsEngine, maxSec = 120, onStep?: (engine: PhysicsEngine) => void): { events: Timed[]; finishedAt: number } {
  const events: Timed[] = [];
  for (let i = 1; i <= maxSec * 60; i++) {
    engine.update(STEP, 0);
    onStep?.(engine);
    const t = engine.getElapsedMs() / 1000;
    for (const ev of engine.consumeSoundEvents()) events.push({ t, ev });
    if (engine.isSimulationFinished()) return { events, finishedAt: t };
  }
  return { events, finishedAt: -1 };
}

/** How far a ball's edge reaches past the wall (px; 0 or less: inside). */
function worstOutside(engine: PhysicsEngine): number {
  const L = engine.getSongRingView().layout!;
  let worst = -Infinity;
  for (const b of engine.getBalls()) worst = Math.max(worst, Math.hypot(b.x - L.cx, b.y - L.cy) + b.radius - L.radius);
  return worst;
}

const plucks = (events: Timed[]) => events.filter(({ ev }) => ev.loop === "pluck");
const kinds = (events: Timed[], loop: string) => events.filter(({ ev }) => ev.loop === loop);

/* ------------------------------------------------------------------ settings */

describe("settings, URL and presets", () => {
  it("defaults and ranges", () => {
    expect(DEFAULT_SONG_RING_SETTINGS).toEqual({ song: "twinkle", lapSec: 4, speed: 1.2, balls: 1, help: 0.8, live: false });
    expect(defaultSongRingFields()).toEqual({ srSong: "twinkle", srLapSec: 4, srSpeed: 1.2, srBalls: 1, srHelp: 0.8, srLive: false });
    for (const key of Object.keys(SONG_RING_RANGES) as (keyof typeof SONG_RING_RANGES)[]) expect(RANGES[key]).toEqual(SONG_RING_RANGES[key]);
    expect(RANGES.srLapSec).toMatchObject({ min: 2, max: 8, step: 0.5 });
    expect(RANGES.srBalls).toMatchObject({ min: 1, max: 6, step: 1 });
    // the mode changes no core default: its ball is the page's own
    expect(songRingModeDefaults("songRing")).toEqual({});
    expect(defaultSettings("songRing").ballRadius).toBe(8);
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(resolveSongRingFields(d)).toEqual(defaultSongRingFields());
      const params = settingsToSearchParams(d);
      for (const key of ["srt", "srl", "srv", "srb", "srh", "srn"]) expect(params.has(key)).toBe(false);
    }
  });

  it("resolve clamps onto the sliders' steps and floors, never onto a maximum, caps the balls at their ceiling and drops bad values", () => {
    expect(resolveSongRingSettings(null)).toEqual(DEFAULT_SONG_RING_SETTINGS);
    expect(resolveSongRingSettings({ song: "nope" as never, lapSec: 0, speed: -3, balls: 0, help: -1, live: "yes" as never })).toEqual({ song: "twinkle", lapSec: 2, speed: 0.4, balls: 1, help: 0, live: false });
    // (uncapped: a lap of a minute, a speed of 40 ring widths a second and a help past 1 are kept)
    expect(resolveSongRingSettings({ lapSec: 60.2, speed: 40.04, balls: 12.4, help: 3 })).toMatchObject({ lapSec: 60, speed: 40, balls: 12, help: 3 });
    expect(resolveSongRingSettings({ balls: 1e9 }).balls).toBe(MEMORY_CEILINGS.srBalls);
    expect(MEMORY_CEILINGS.srBalls).toBeGreaterThan(RANGES.srBalls.max);
    expect(resolveSongRingSettings({ lapSec: NaN, speed: Infinity, help: "x" as never })).toEqual(DEFAULT_SONG_RING_SETTINGS);
    for (const song of SONG_RING_SONGS) expect(isSongRingSong(song)).toBe(true);
    expect(isSongRingSong("Twinkle")).toBe(false);
  });

  it("round-trip through srt / srl / srv / srb / srh / srn and presets", () => {
    const s = { ...defaultSettings("songRing"), srSong: "elise" as const, srLapSec: 3, srSpeed: 1.6, srBalls: 2, srHelp: 0.35, srLive: true };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("songRing");
    expect(params.get("srt")).toBe("elise");
    expect(params.get("srl")).toBe("3");
    expect(params.get("srv")).toBe("1.6");
    expect(params.get("srb")).toBe("2");
    expect(params.get("srh")).toBe("0.35");
    expect(params.get("srn")).toBe("1");
    const back = settingsFromSearchParams(params);
    expect(back.mode).toBe("songRing");
    expect(resolveSongRingFields(back)).toEqual({ srSong: "elise", srLapSec: 3, srSpeed: 1.6, srBalls: 2, srHelp: 0.35, srLive: true });
    const bad = settingsFromSearchParams(new URLSearchParams("mode=songRing&srt=despacito&srl=abc&srv=0&srb=0&srh=-2&srn=7"));
    expect(resolveSongRingFields(bad)).toEqual({ ...defaultSongRingFields(), srSpeed: 0.4, srBalls: 1, srHelp: 0 });
    const preset = presetToSettings({ mode: "songRing", srSong: 12345, srLapSec: 1, srLive: "no", srSpeed: 9 } as unknown as Parameters<typeof presetToSettings>[0]);
    expect(resolveSongRingFields(preset)).toMatchObject({ srSong: "twinkle", srLapSec: 2, srLive: false, srSpeed: 9 });
    expect(modeSettingsOfSettings(s).songRing).toEqual({ song: "elise", lapSec: 3, speed: 1.6, balls: 2, help: 0.35, live: true });
    expect(songRingSettingsOf(s)).toEqual({ song: "elise", lapSec: 3, speed: 1.6, balls: 2, help: 0.35, live: true });
  });

  it("the mode is registered: a rhythm card right after Spiral Glass, its restart keys, a hero moment, an AI prefix with the tunes as options", () => {
    expect(MODE_IDS).toContain("songRing");
    expect(MODE_CATEGORIES.songRing).toBe("rhythm");
    expect(MODE_CARD_ORDER).toContain("songRing");
    const rhythm = modesInCategory("rhythm");
    expect(rhythm.indexOf("songRing")).toBe(rhythm.indexOf("spiralGlass") + 1);
    expect(runNeverFinishes("songRing", { drop: {}, box: {} })).toBe(false);
    expect(fixedRunDurationSec("songRing", {})).toBeNull();
    expect(engineSettingKeys("songRing")).toEqual(expect.arrayContaining(["srSong", "srLapSec", "srSpeed", "srBalls", "srHelp", "srLive"]));
    expect(engineSettingKeys("classic")).not.toContain("srSong");
    expect(HERO_MOMENTS.songRing.tint).toMatch(/^#[0-9a-f]{6}$/);
    expect(assistantSettings(defaultSettings("songRing")).map(([key]) => key)).toEqual(expect.arrayContaining(["srSong", "srLapSec", "srSpeed", "srBalls", "srHelp", "srLive"]));
    expect(assistantSettings(defaultSettings("classic")).map(([key]) => key)).not.toContain("srSong");
    expect(SETTING_OPTIONS.srSong).toEqual(SONG_RING_SONGS);
    // the site: the Music shelf (its first card), the version it ships in, and search words that name no setting of the panel
    expect(MODE_SHELVES.songRing).toBe("music");
    expect(modesOnShelf("music")[0]).toBe("songRing");
    expect(MODE_SINCE.songRing).toBe("1.18.0");
    expect(modeSearchWords("songRing", "pl")).toBe(`${MODE_SEARCH_WORDS.songRing.pl} ${MODE_SEARCH_WORDS.songRing.en} song Ring`);
    for (const words of Object.values(MODE_SEARCH_WORDS.songRing)) expect(words).not.toMatch(/\b(tune|melody|speed|balls|help|lap|notes|melodia|melodía)\b/);
    // bounce math: the bounce trigger fires (ctx.noteBounce), nothing passes, collides or breaks, and the speed is the mode's own
    for (const list of [BOUNCE_MATH_BALL_MODES, BOUNCE_MATH_PASS_MODES, BOUNCE_MATH_COLLIDE_MODES, BOUNCE_MATH_BREAK_MODES]) expect(list).not.toContain("songRing");
  });

  it("names every tune in the panel and on the end banner, in en, pl and es", () => {
    for (const messages of [en, pl, es]) {
      const controls = messages.Controls as Record<string, string>;
      const canvas = messages.SongRing as Record<string, string>;
      for (const song of SONG_RING_SONGS) expect(controls[`srSong_${song}`]?.length).toBeGreaterThan(0);
      for (const id of SURPRISE_TUNES) {
        expect(canvas[`song_${id}`]?.length).toBeGreaterThan(0);
        // (the banner's title: short enough to read across the ring)
        expect(canvas[`song_${id}`].length).toBeLessThanOrEqual(19);
      }
      expect(canvas.song_surprise).toBeUndefined();
    }
  });
});

/* ------------------------------------------------------------------ the tunes */

describe("the tunes", () => {
  it("are two-bar phrases of seven to nine notes in a singable register, each with its bass and its chord", () => {
    expect(Object.keys(SONG_RING_TUNES)).toEqual([...SURPRISE_TUNES]);
    expect([...SONG_RING_SONGS]).toEqual([...SURPRISE_TUNES, "surprise"]);
    for (const id of SURPRISE_TUNES) {
      const tune = SONG_RING_TUNES[id];
      expect(tune.id).toBe(id);
      expect(tune.notes.length).toBeGreaterThanOrEqual(7);
      expect(tune.notes.length).toBeLessThanOrEqual(9);
      const slots = tune.notes.reduce((sum, [, len]) => sum + len, 0);
      for (const [midi, len] of tune.notes) {
        expect(midi).toBeGreaterThanOrEqual(67);
        expect(midi).toBeLessThanOrEqual(84);
        expect(Number.isInteger(len) && len >= 1).toBe(true);
      }
      for (const [slot, midi] of tune.bass) {
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(slots);
        expect(midi).toBeGreaterThanOrEqual(36);
        expect(midi).toBeLessThanOrEqual(60);
      }
      expect(tune.root).toBeGreaterThanOrEqual(40);
      expect(tune.root).toBeLessThanOrEqual(52);
    }
    // the melodies themselves, note for note
    expect(SONG_RING_TUNES.twinkle.notes.map(([m]) => m)).toEqual([72, 72, 79, 79, 81, 81, 79]);
    expect(SONG_RING_TUNES.ode.notes.map(([m]) => m)).toEqual([76, 76, 77, 79, 79, 77, 76, 74]);
    expect(SONG_RING_TUNES.elise.notes.map(([m]) => m)).toEqual([76, 75, 76, 75, 76, 71, 74, 72, 69]);
    expect(SONG_RING_TUNES.jacques.notes.map(([m]) => m)).toEqual([72, 74, 76, 72, 72, 74, 76, 72]);
    expect(SONG_RING_TUNES.mountain.notes.map(([m]) => m)).toEqual([71, 73, 74, 76, 78, 74, 78]);
    expect([SONG_RING_TUNES.elise.minor, SONG_RING_TUNES.mountain.minor, SONG_RING_TUNES.twinkle.minor]).toEqual([true, true, false]);
  });

  it("a named tune is itself; surprise draws one of the five from the seed", () => {
    expect(songRingTuneOf("ode", 0.99).id).toBe("ode");
    expect(SURPRISE_TUNES.map((_, i) => songRingTuneOf("surprise", (i + 0.5) / SURPRISE_TUNES.length).id)).toEqual([...SURPRISE_TUNES]);
    expect(songRingTuneOf("surprise", 0).id).toBe("twinkle");
    expect(songRingTuneOf("surprise", 1).id).toBe("mountain");
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) seen.add(songEngine({ song: "surprise" }, seed).getSongRingView().song);
    expect([...seen].sort()).toEqual([...SURPRISE_TUNES].sort());
  });
});

/* ------------------------------------------------------------------ geometry */

describe("the ring's geometry", () => {
  it("lays the ring out in the centred square and scales the ball with it", () => {
    const phone = buildSongRingLayout(450, 450, 8);
    expect(phone).toMatchObject({ side: 450, left: 0, top: 0, cx: 225, cy: 225, ballRadius: 8, requestedRadius: 8 });
    expect(phone.radius).toBeCloseTo(RING_AT * 450, 9);
    expect(phone.reach).toBeCloseTo(phone.radius - 8, 9);
    expect(phone.bandMin).toBeCloseTo(BAND_MIN * 450, 9);
    expect(phone.bandMax).toBeCloseTo(BAND_MAX * 450, 9);
    // the highest tile stays inside the square a clip records
    expect(phone.radius + phone.bandMax).toBeLessThan(225);
    const wide = buildSongRingLayout(800, 450, 8);
    expect(wide).toMatchObject({ side: 450, left: 175, top: 0, cx: 400, cy: 225, ballRadius: 8 });
    const finder = buildSongRingLayout(800, 600, 8);
    expect(finder.ballRadius).toBeCloseTo((8 * 600) / TUNED_SIDE, 9);
    expect(finder.ballRadius / finder.radius).toBeCloseTo(phone.ballRadius / phone.radius, 12);
    // a huge Ball Size still flies: at most a third of the ring
    expect(buildSongRingLayout(450, 450, 4000).ballRadius).toBeCloseTo(phone.radius / 3, 9);
  });

  it("turns a tune into tiles as long as its notes, levelled by pitch", () => {
    const t = buildSongRingTiles(SONG_RING_TUNES.twinkle);
    expect(t.count).toBe(7);
    expect(t.slots).toBe(8);
    expect(Array.from(t.start)).toEqual([0, 1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8, 6 / 8]);
    expect(Array.from(t.end)).toEqual([1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8, 6 / 8, 1]);
    expect(Array.from(t.level)).toEqual([0, 0, 7 / 9, 7 / 9, 1, 1, 7 / 9]);
    const e = buildSongRingTiles(SONG_RING_TUNES.elise);
    expect(e.slots).toBe(12);
    expect(e.end[8] - e.start[8]).toBeCloseTo(4 / 12, 12);
    for (const [turn, tile] of [[0, 0], [0.124, 0], [0.125, 1], [0.76, 6], [0.9999, 6], [1.3, 2], [-0.1, 6]] as const) expect(tileAt(t, turn)).toBe(tile);
    // the lowest note violet, the highest pink, the hues in between running through the spectrum
    expect(tileHue(0)).toBe(265);
    expect(tileHue(1)).toBe(340);
    expect(tileHue(0.5)).toBeCloseTo(122.5, 9);
  });

  it("maps angles to turns, clockwise from the top, and aims a rebound at a point of the wall", () => {
    expect(turnOf(-Math.PI / 2)).toBeCloseTo(0, 12);
    expect(turnOf(0)).toBeCloseTo(0.25, 12);
    expect(turnOf(Math.PI / 2)).toBeCloseTo(0.5, 12);
    expect(turnOf(Math.PI)).toBeCloseTo(0.75, 12);
    for (const turn of [0, 0.1, 0.5, 0.99]) expect(turnOf(angleOf(turn))).toBeCloseTo(turn, 12);
    expect(wrapAngle(-0.1)).toBeCloseTo(TWO_PI - 0.1, 12);
    expect(wrapPi(TWO_PI - 0.1)).toBeCloseTo(-0.1, 12);
    // a rebound turned `delta` off the inward normal lands 180° + 2 delta round the ring
    for (const theta of [0, 1, -2.5]) {
      for (const delta of [-1, -0.3, 0, 0.4, 1.04]) {
        const landing = theta + Math.PI + 2 * delta;
        expect(aimDelta(theta, landing)).toBeCloseTo(delta, 9);
        // …which is where the straight flight from the hit point meets the unit circle again
        const dir = theta + Math.PI + delta;
        const t = 2 * Math.cos(delta);
        expect(Math.atan2(Math.sin(theta) + t * Math.sin(dir), Math.cos(theta) + t * Math.cos(dir))).toBeCloseTo(wrapPi(landing), 9);
      }
    }
    // straight across needs no turn, a point 60° round the ring from the hit cannot be reached inside the scatter
    expect(aimDelta(0, Math.PI)).toBeCloseTo(0, 12);
    expect(Math.abs(aimDelta(0, Math.PI / 3))).toBeGreaterThan(SCATTER - 1e-9);
  });

  it("plans the notes in hits: early ones close together, the last one late, each with a window to arrive in", () => {
    expect(hitBudget(7)).toBeCloseTo(21.45, 9);
    expect(hitBudget(9)).toBeCloseTo(24.15, 9);
    for (const n of [7, 8, 9]) {
      let before = -1;
      for (let j = 1; j <= n; j++) {
        expect(earliestHit(j, n)).toBeGreaterThan(before);
        expect(latestHit(j, n) - earliestHit(j, n)).toBeCloseTo(PLAN_WAIT * hitBudget(n), 9);
        // the gaps between two notes only grow
        if (j > 1) expect(earliestHit(j, n) - earliestHit(j - 1, n)).toBeGreaterThan(j > 2 ? earliestHit(j - 1, n) - earliestHit(j - 2, n) : 0);
        before = earliestHit(j, n);
      }
      expect(earliestHit(n, n)).toBeCloseTo(PLAN_LAST_AT * hitBudget(n), 9);
      expect(earliestHit(1, n)).toBeLessThan(1);
    }
  });
});

/* ------------------------------------------------------------------ the mode */

describe("the mode in the engine", () => {
  it("starts with one ball in the middle of a dark ring, the playhead at the top, and no engine rings or obstacles", () => {
    const engine = songEngine({}, 3);
    const v = engine.getSongRingView();
    expect(engine.isSongRingMode()).toBe(true);
    expect(engine.getCircularWalls()).toEqual([]);
    expect(engine.getObstacles()).toEqual([]);
    expect(engine.getBalls().length).toBe(1);
    const ball = engine.getBalls()[0];
    expect([ball.x, ball.y]).toEqual([400, 300]);
    expect(ball.gravityScale).toBe(0);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(1.2 * 2 * RING_AT * 600, 6);
    expect(v).toMatchObject({ song: "twinkle", total: 7, lit: 0, hits: 0, notes: 0, head: 0, phase: "collect", completeMs: -1, chordMs: -1, finished: false });
    expect(Array.from(v.litMs)).toEqual(new Array(7).fill(-1));
    expect(engine.getSongRingProgress()).toMatchObject({ lit: 0, total: 7, complete: false, finished: false });
    // more balls leave the centre evenly spread, each in its own colour
    const three = songEngine({ balls: 3 }, 3);
    const dirs = three.getBalls().map((b) => Math.atan2(b.vy, b.vx));
    expect(wrapAngle(dirs[1] - dirs[0])).toBeCloseTo(TWO_PI / 3, 9);
    expect(wrapAngle(dirs[2] - dirs[1])).toBeCloseTo(TWO_PI / 3, 9);
    expect(new Set(three.getBalls().map((b) => b.color)).size).toBe(3);
  });

  it("holds the ball inside the wall at the mode's speed, weightless, whatever the page's gravity", () => {
    const engine = songEngine({}, 5, { ...config, gravity: 2000 });
    const speed = 1.2 * 2 * RING_AT * 600;
    let worst = -Infinity;
    run(engine, 12, (e) => {
      worst = Math.max(worst, worstOutside(e));
      const b = e.getBalls()[0];
      expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(speed, 6);
    });
    expect(worst).toBeLessThanOrEqual(1e-6);
    expect(engine.getSongRingView().hits).toBeGreaterThan(10);
    // a ball as fast as forty ring widths a second never leaves the ring either (the engine plans its sub-steps)
    const fast = songEngine({ speed: 40 }, 5);
    run(fast, 3, (e) => expect(worstOutside(e)).toBeLessThanOrEqual(1e-6));
    expect(fast.getSongRingView().finished).toBe(false);
  });

  it("lights the tile a ball hits, ticks softly on every hit and brighter on the one that lights", () => {
    const engine = songEngine({ help: 0 }, 4);
    const v = engine.getSongRingView();
    let lit = 0;
    const seen: { t: number; ticks: SoundEvent[] }[] = [];
    for (let i = 0; i < 60 * 8 && v.phase === "collect"; i++) {
      const hits = v.hits;
      engine.update(STEP, 0);
      const sounds = engine.consumeSoundEvents();
      const ticks = sounds.filter((ev) => ev.orb === "click");
      const dings = sounds.filter((ev) => ev.loop === "ding");
      // the hit that lights a tile rings one ding, always on the tune's root three octaves up (C6 for Twinkle), never a note of the phrase
      expect(dings.map((ev) => [ev.frequency, ev.level, ev.melody])).toEqual(v.lit > lit ? [[midiToFrequency(48 + 12 * LIGHT_DING_OCTAVES), LIGHT_DING_LEVEL, false]] : []);
      if (v.hits > hits) {
        seen.push({ t: engine.getElapsedMs(), ticks });
        // the tile under the ball is the one that took the hit, and it is lit from then on
        const ball = engine.getBalls()[0];
        const L = v.layout!;
        const tile = Array.from(v.hitMs).indexOf(Math.max(...Array.from(v.hitMs)));
        expect(v.litMs[tile]).toBeGreaterThanOrEqual(0);
        expect(tileAt(v.tiles, turnOf(Math.atan2(ball.y - L.cy, ball.x - L.cx)))).toBeGreaterThanOrEqual(0);
        expect(ticks.length).toBe(1);
        expect(ticks[0].melody).toBe(false);
        expect(ticks[0].frequency).toBe(v.lit > lit ? LIGHT_TICK_HZ : TICK_HZ);
        lit = v.lit;
      }
    }
    expect(seen.length).toBeGreaterThan(6);
    expect(lit).toBeGreaterThanOrEqual(4);
    expect(lit).toBe(Array.from(v.litMs).filter((ms) => ms >= 0).length);
  });

  it("the playhead plays what is lit, in the tune's order, each note where its tile starts on the lap", () => {
    const engine = songEngine({}, 9);
    const v = engine.getSongRingView();
    const lapMs = 4000;
    const { events } = run(engine, 60, (e) => {
      const view = e.getSongRingView();
      if (view.phase === "collect") expect(view.head).toBeCloseTo((e.getElapsedMs() / lapMs) % 1, 9);
    });
    const collected = plucks(events).filter(({ t }) => t * 1000 <= v.completeMs);
    expect(collected.length).toBeGreaterThan(8);
    for (const { t, ev } of collected) {
      // which tile sounded: the one whose start the playhead had just crossed
      const turn = ((t * 1000) / lapMs) % 1;
      const tile = tileAt(v.tiles, turn);
      expect(ev.frequency).toBeCloseTo(midiToFrequency(v.tiles.midi[tile]), 9);
      expect(((turn - v.tiles.start[tile]) * lapMs) / STEP).toBeLessThan(1.001);
      // …and it was lit before the playhead reached it
      expect(v.litMs[tile]).toBeLessThan(t * 1000);
      expect(ev.melody).toBe(false);
      expect(ev.loopBright).toBeUndefined();
    }
    expect(v.notes).toBe(plucks(events).length);
  });

  it("keeps the tune's own pitches whatever scale the page plays in: every pitched event is exact, and the tone generator does not snap it", async () => {
    const { events } = run(songEngine({ song: "elise" }, 5), 80);
    const pitched = events.filter(({ ev }) => ev.loop === "pluck" || ev.loop === "chime" || ev.loop === "chord" || ev.loop === "bed");
    expect(pitched.length).toBeGreaterThan(20);
    for (const { ev } of pitched) expect([ev.loop, ev.loopExact, loopPlayOptions(ev).exact]).toEqual([ev.loop, true, true]);
    // (a mode that does not ask keeps the scale's snap: no key at all)
    expect("exact" in loopPlayOptions({ type: "hit", wallIndex: 0, loop: "pluck", frequency: 450 })).toBe(false);
    // the viral bot's pages play in D pentatonic: Für Elise's D sharp stays a D sharp there
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    try {
      const tone = new ToneGenerator();
      await tone.start();
      tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, scale: "pentatonic", rootNote: 2 });
      const dSharp = midiToFrequency(75);
      graph.ctx.currentTime = 1;
      tone.playLoop("pluck", dSharp, 1);
      expect(graph.oscillators.find((o) => o.startAt === 1)!.frequency).not.toBeCloseTo(dSharp, 3);
      graph.ctx.currentTime = 2;
      tone.playLoop("pluck", dSharp, 1, { exact: true });
      expect(graph.oscillators.find((o) => o.startAt === 2)!.frequency).toBe(dSharp);
      graph.ctx.currentTime = 3;
      tone.playLoop("chime", 2 * dSharp, 1, { exact: true });
      expect(graph.oscillators.find((o) => o.startAt === 3)!.frequency).toBe(2 * dSharp);
      // the chord on the tune's own root (A2, which D pentatonic holds, and C3, which it does not)
      graph.ctx.currentTime = 4;
      tone.playLoop("chord", midiToFrequency(48), 1, { exact: true });
      expect(graph.oscillators.filter((o) => o.startAt >= 4 && o.startAt < 4.5).some((o) => Math.abs(o.frequency - midiToFrequency(48)) < 1e-6)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Live notes: the hit that lights a tile plays its note at once; off, only the playhead sings", () => {
    for (const live of [false, true]) {
      const engine = songEngine({ live }, 4);
      const v = engine.getSongRingView();
      let extra = 0;
      for (let i = 0; i < 60 * 30 && v.phase === "collect"; i++) {
        const lit = v.lit;
        const notes = v.notes;
        engine.update(STEP, 0);
        const sounds = engine.consumeSoundEvents();
        const sung = sounds.filter((ev) => ev.loop === "pluck").length;
        expect(sung - (v.notes - notes)).toBe(live ? v.lit - lit : 0);
        // (the tile's own note takes the ding's place)
        expect(sounds.filter((ev) => ev.loop === "ding").length).toBe(live ? 0 : v.lit - lit);
        extra += sung - (v.notes - notes);
      }
      expect(extra).toBe(live ? 7 : 0);
    }
  });

  it("the finale: the impact and the riser at the last tile, the wind-on, the phrase whole with its chimes, kicks and bass, the chord, the hold", () => {
    const engine = songEngine({}, 2);
    const v = engine.getSongRingView();
    const phases: string[] = [];
    const { events, finishedAt } = run(engine, 60, (e) => {
      const p = e.getSongRingView().phase;
      if (phases.at(-1) !== p) phases.push(p);
    });
    expect(phases).toEqual(["collect", "rewind", "finale", "chord"]);
    expect(finishedAt).toBeGreaterThan(0);
    expect(v.lit).toBe(7);
    expect(v.finaleMs).toBeCloseTo(v.completeMs + REWIND_MS, 6);
    expect(v.chordMs - v.finaleMs).toBeGreaterThanOrEqual(4000 - 1e-6);
    expect(v.chordMs - v.finaleMs).toBeLessThan(4000 + STEP + 1e-6);
    expect(v.finishedMs - v.chordMs).toBeGreaterThanOrEqual(END_HOLD_MS - 1e-6);
    expect(v.finishedMs - v.chordMs).toBeLessThan(END_HOLD_MS + STEP + 1e-6);
    expect(finishedAt * 1000).toBeCloseTo(v.finishedMs, 6);
    expect(engine.getSongRingProgress()).toMatchObject({ complete: true, chord: true, timeout: false, finished: true });
    const at = (ms: number) => (e: Timed) => Math.abs(e.t * 1000 - ms) < STEP + 1e-6;
    // the last tile: one impact and one riser as long as the wind-on
    expect(kinds(events, "impact").length).toBe(1);
    expect(kinds(events, "impact").every(at(v.completeMs))).toBe(true);
    expect(kinds(events, "riser").map(({ ev }) => ev.loopSec)).toEqual([REWIND_MS / 1000]);
    // nothing sings while the playhead winds on
    expect(plucks(events).filter(({ t }) => t * 1000 > v.completeMs + STEP && t * 1000 < v.finaleMs - STEP)).toEqual([]);
    // the phrase whole: every note once, in order, bright, with its chime an octave up, each where its tile starts
    const finale = plucks(events).filter(({ t }) => t * 1000 >= v.finaleMs - 1e-6);
    expect(finale.map(({ ev }) => ev.frequency)).toEqual(SONG_RING_TUNES.twinkle.notes.map(([m]) => midiToFrequency(m)));
    expect(finale.every(({ ev }) => ev.loopBright === true)).toBe(true);
    finale.forEach(({ t }, i) => expect(t * 1000 - (v.finaleMs + v.tiles.start[i] * 4000)).toBeLessThan(STEP + 1e-6));
    expect(kinds(events, "chime").map(({ ev }) => ev.frequency)).toEqual(SONG_RING_TUNES.twinkle.notes.map(([m]) => 2 * midiToFrequency(m)));
    // a kick every other slot, the bed under them from the first note to the chord, the bass on its slots
    expect(kinds(events, "kick").length).toBe(4);
    expect(kinds(events, "bed").length).toBe(1);
    expect(kinds(events, "bedStop").length).toBe(1);
    expect(kinds(events, "bass").map(({ ev }) => ev.frequency)).toEqual(SONG_RING_TUNES.twinkle.bass.map(([, m]) => midiToFrequency(m)));
    // the chord: once, on the tune's root, and nothing ticks after it
    expect(kinds(events, "chord").map(({ ev }) => [ev.frequency, ev.loopMinor])).toEqual([[midiToFrequency(48), false]]);
    expect(kinds(events, "chord").every(at(v.chordMs))).toBe(true);
    expect(events.filter(({ t, ev }) => t * 1000 > v.chordMs + STEP && ev.orb === "click")).toEqual([]);
    // the finale is louder and denser than anything before it
    const rate = (from: number, to: number) => events.filter(({ t }) => t * 1000 >= from && t * 1000 < to).length / ((to - from) / 1000);
    expect(rate(v.finaleMs, v.chordMs)).toBeGreaterThan(1.3 * rate(0, v.completeMs));
    // a minor tune ends on a minor chord
    const elise = songEngine({ song: "elise" }, 2);
    const minor = run(elise, 80).events;
    expect(kinds(minor, "chord").map(({ ev }) => [ev.frequency, ev.loopMinor])).toEqual([[midiToFrequency(45), true]]);
  });

  it("the help keeps a run on its plan: no note hangs, none comes in a rush, and a nudged rebound still leaves inside the scatter", { timeout: 60_000 }, () => {
    const complete = (help: number, seed: number) => {
      const engine = songEngine({ help }, seed);
      const v = engine.getSongRingView();
      const lights: number[] = [];
      let lit = 0;
      let worstTurn = 0;
      let before = { hits: 0, x: 0, y: 0, vx: 0, vy: 0 };
      run(engine, 200, (e) => {
        const view = e.getSongRingView();
        const ball = e.getBalls()[0];
        if (view.hits > before.hits && view.phase === "collect") {
          // the rebound's turn off the inward normal, read from the ball just after the hit
          const L = view.layout!;
          const inward = Math.atan2(L.cy - ball.y, L.cx - ball.x);
          const out = Math.atan2(ball.vy, ball.vx);
          worstTurn = Math.max(worstTurn, Math.abs(wrapPi(out - inward)));
        }
        before = { hits: view.hits, x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy };
        while (lit < view.lit) {
          lit++;
          lights.push(e.getElapsedMs() / 1000);
        }
      });
      return { completeSec: v.completeMs / 1000, lights, nudges: v.nudges, hits: v.hits, worstTurn, finished: v.finished, timeout: v.timeoutMs >= 0 };
    };
    const helped = Array.from({ length: 40 }, (_, i) => complete(1, i + 1));
    const chance = Array.from({ length: 40 }, (_, i) => complete(0, i + 1));
    for (const r of helped) {
      expect(r.finished && !r.timeout).toBe(true);
      // the last note inside a window of a few seconds, the run about 20 s
      expect(r.completeSec).toBeGreaterThan(10);
      expect(r.completeSec).toBeLessThan(18);
      for (let j = 1; j < r.lights.length; j++) expect(r.lights[j] - r.lights[j - 1]).toBeLessThan(8);
      expect(r.nudges).toBeGreaterThan(0);
      // (read a sub-step or more after the hit, the ball has left the wall: the turn is within the scatter plus that slack)
      expect(r.worstTurn).toBeLessThan(SCATTER + 0.2);
    }
    for (const r of chance) expect(r.nudges).toBe(0);
    const spread = (rows: { completeSec: number }[]) => Math.max(...rows.map((r) => r.completeSec)) - Math.min(...rows.map((r) => r.completeSec));
    expect(spread(chance)).toBeGreaterThan(2 * spread(helped));
    expect(Math.max(...chance.map((r) => r.completeSec))).toBeGreaterThan(18);
    expect(Math.min(...chance.map((r) => r.completeSec))).toBeLessThan(10);
    // the default (0.8): every run of these seeds ends between 14 and 25 s
    for (let seed = 1; seed <= 40; seed++) {
      const r = complete(0.8, seed);
      expect(r.completeSec + (REWIND_MS + 4000 + END_HOLD_MS) / 1000).toBeGreaterThan(14);
      expect(r.completeSec + (REWIND_MS + 4000 + END_HOLD_MS) / 1000).toBeLessThan(25);
    }
  });

  it("a crowd of balls ticks at most nine times a second, and its sparks stay inside their pool", () => {
    const engine = songEngine({ balls: 200, speed: 3 }, 1);
    const { events, finishedAt } = run(engine, 30, (e) => expect(e.getSongRingView().sparkCount).toBeLessThanOrEqual(MAX_SPARKS));
    expect(finishedAt).toBeGreaterThan(0);
    expect(engine.getBalls().length).toBe(200);
    const soft = events.filter(({ ev }) => ev.orb === "click" && ev.frequency === TICK_HZ).map(({ t }) => t * 1000);
    for (let i = 1; i < soft.length; i++) expect(soft[i] - soft[i - 1]).toBeGreaterThanOrEqual(TICK_COOLDOWN_MS - 1e-6);
    expect(engine.getSongRingView().hits).toBeGreaterThan(1000);
  });

  it("TIMEOUT: a run whose ball cannot reach the wall in five minutes ends there", () => {
    // (wind against a ball that is put back at the mode's speed every sub-step cannot stop it; a ball taken away can)
    const engine = songEngine({}, 3);
    engine.getBalls().length = 0;
    const steps = Math.ceil(TIMEOUT_MS / STEP);
    for (let i = 0; i < steps + 2 && !engine.isSimulationFinished(); i++) engine.update(STEP, 0);
    const v = engine.getSongRingView();
    expect(v.finished).toBe(true);
    expect(v.phase).toBe("timeout");
    expect(v.timeoutMs).toBeGreaterThanOrEqual(TIMEOUT_MS - 1e-6);
    expect(v.chordMs).toBe(-1);
    expect(engine.getSongRingProgress()).toMatchObject({ timeout: true, chord: false, finished: true });
  });

  it("replays exactly for a seed and differs between seeds", () => {
    const snapshot = (e: PhysicsEngine) => e.getBalls().map((b) => [b.id, Math.round(b.x * 1000), Math.round(b.y * 1000)]);
    const a = songEngine({}, 11);
    const b = songEngine({}, 11);
    const c = songEngine({}, 12);
    const ra = run(a, 12);
    const rb = run(b, 12);
    const rc = run(c, 12);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(Array.from(a.getSongRingView().litMs)).toEqual(Array.from(b.getSongRingView().litMs));
    expect(ra.events.map(({ t, ev }) => [t, ev.loop ?? ev.orb, ev.frequency])).toEqual(rb.events.map(({ t, ev }) => [t, ev.loop ?? ev.orb, ev.frequency]));
    expect(snapshot(a)).not.toEqual(snapshot(c));
    expect(Array.from(a.getSongRingView().litMs)).not.toEqual(Array.from(c.getSongRingView().litMs));
    expect(ra.events.length).toBeGreaterThan(0);
    expect(rc.events.length).toBeGreaterThan(0);
    // a restart replays the same run on the same engine, from every field reset
    run(a, 60);
    a.initMode("songRing");
    expect(a.getSongRingView()).toMatchObject({ lit: 0, hits: 0, notes: 0, nudges: 0, phase: "collect", completeMs: -1, finaleMs: -1, chordMs: -1, finished: false, sparkCount: 0 });
    const again = run(a, 12);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(again.events.map(({ t, ev }) => [t, ev.loop ?? ev.orb, ev.frequency])).toEqual(rb.events.map(({ t, ev }) => [t, ev.loop ?? ev.orb, ev.frequency]));
  });

  it("plays the same run in every world size: a phone's square, a laptop's frame and the finder's", () => {
    const story = (width: number, height: number) => {
      const engine = songEngine({}, 21, { ...config, width, height });
      const { events, finishedAt } = run(engine, 60);
      const v = engine.getSongRingView();
      return { finishedAt, lit: Array.from(v.litMs), hits: v.hits, nudges: v.nudges, sounds: events.map(({ t, ev }) => [t, ev.loop ?? ev.orb, ev.frequency]) };
    };
    const phone = story(450, 450);
    expect(phone.finishedAt).toBeGreaterThan(0);
    expect(story(800, 450)).toEqual(phone);
    expect(story(800, 600)).toEqual(phone);
  });

  it("a canvas resize mid-run rebuilds the ring and keeps every ball at its place and on its course", () => {
    const engine = songEngine({ balls: 2 }, 6);
    run(engine, 3);
    const v = engine.getSongRingView();
    const L0 = v.layout!;
    const before = engine.getBalls().map((b) => ({ id: b.id, u: (b.x - L0.cx) / L0.side, w: (b.y - L0.cy) / L0.side, dir: Math.atan2(b.vy, b.vx) }));
    const lit = Array.from(v.litMs);
    engine.setConfig({ width: 450, height: 450 });
    const L = v.layout!;
    expect(L.side).toBe(450);
    expect(Array.from(v.litMs)).toEqual(lit);
    for (const b of engine.getBalls()) {
      const was = before.find((x) => x.id === b.id)!;
      expect((b.x - L.cx) / L.side).toBeCloseTo(was.u, 9);
      expect((b.y - L.cy) / L.side).toBeCloseTo(was.w, 9);
      expect(Math.atan2(b.vy, b.vx)).toBeCloseTo(was.dir, 9);
      expect(b.radius).toBeCloseTo(L.ballRadius, 9);
    }
    run(engine, 4, (e) => expect(worstOutside(e)).toBeLessThanOrEqual(1e-6));
    // a live Ball Size change refits the balls
    engine.setConfig({ ballRadius: 20 });
    engine.update(STEP, 0);
    expect(v.layout!.ballRadius).toBeCloseTo(20, 9);
    for (const b of engine.getBalls()) expect(b.radius).toBeCloseTo(20, 9);
    run(engine, 2, (e) => expect(worstOutside(e)).toBeLessThanOrEqual(1e-6));
  });
});

/* ------------------------------------------------------------------ the finder */

describe("the finder", () => {
  it("builds the mode from ModeSettings.songRing and the seed moves the run length, so a found seed keeps its promise", async () => {
    const sr = { song: "ode" as const, lapSec: 3, speed: 1.5, balls: 1, help: 0.5, live: false };
    const built = createEngineForSettings(config, "songRing", { ...modeSettings, songRing: sr }, 1);
    expect(built.getSongRingSettings()).toEqual(sr);
    expect(built.getSongRingView().total).toBe(8);
    const request: FinderRequest = { targetDurationSec: 17, toleranceSec: 1.5, maxSeeds: 40, maxSimTimeSec: 120, physicsConfig: config, mode: "songRing", modeSettings: { ...modeSettings, songRing: sr } };
    const lengths = new Set<number>();
    let hit = -1;
    let hitMs = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const ms = simulateSeed(seed, request, 120_000);
      expect(ms).toBeGreaterThan(0);
      lengths.add(Math.round(ms / 100));
      if (hit < 0 && Math.abs(ms / 1000 - 17) <= 1.5) {
        hit = seed;
        hitMs = ms;
      }
    }
    expect(lengths.size).toBeGreaterThan(2);
    if (hit > 0) {
      const replay = run(songEngine(sr, hit));
      expect(Math.abs(replay.finishedAt * 1000 - hitMs)).toBeLessThan(20);
    }
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    let result;
    try {
      result = await findSimulation(request, () => undefined);
    } finally {
      vi.unstubAllGlobals();
    }
    if (result.found) {
      expect(Math.abs(result.duration - 17)).toBeLessThanOrEqual(1.5);
      const found = run(songEngine(sr, result.seed));
      expect(Math.abs(found.finishedAt - result.duration)).toBeLessThan(0.02);
    }
  }, 120_000);
});

/* ------------------------------------------------------------------ the renderer */

describe("the renderer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fades an effect out over its length and stands every tile by its pitch", () => {
    expect(fade(0, 400)).toBe(1);
    expect(fade(100, 400)).toBeCloseTo(0.75, 12);
    expect(fade(400, 400)).toBe(0);
    expect(fade(-1, 400)).toBe(0);
    expect(fade(Infinity, 400)).toBe(0);
    const v = songEngine({}, 3).getSongRingView();
    const L = v.layout!;
    expect(tileHeight(v, 0)).toBeCloseTo(L.bandMin, 9);
    expect(tileHeight(v, 4)).toBeCloseTo(L.bandMax, 9);
    expect(tileHeight(v, 2)).toBeGreaterThan(tileHeight(v, 0));
    expect(tileHeight({ layout: null, tiles: v.tiles }, 2)).toBe(0);
    expect(completeSeconds({ completeMs: 14_230 })).toBe("14.2");
    expect(completeSeconds({ completeMs: -1 })).toBe("0.0");
    expect(CHORD_FLASH_MS).toBeGreaterThan(0);
  });

  it("draws the world, the effects and the overlay with the canvas calls and nothing else, and the tune's name only from the chord on", () => {
    const calls: string[] = [];
    const texts: string[] = [];
    const gradient = { addColorStop: () => undefined };
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, prop) => {
        if (typeof prop !== "string") return undefined;
        return (...args: unknown[]) => {
          calls.push(`${prop}(${args.length})`);
          if (prop === "fillText") texts.push(String(args[0]));
          if (prop === "createRadialGradient" || prop === "createLinearGradient") return gradient;
          if (prop === "measureText") return { width: 80 };
          return undefined;
        };
      },
      set: () => true,
    });
    const engine = songEngine({}, 3);
    run(engine, 6);
    const v = engine.getSongRingView();
    expect(v.lit).toBeGreaterThan(1);
    expect(v.lit).toBeLessThan(7);
    const layer = new SongRingLayer();
    const opts = { wallAlpha: () => "#fff", wallThickness: 2, showWallGlow: true };
    layer.drawWorld(ctx, v, opts);
    expect(calls[0]).toBe("save(0)");
    expect(calls.at(-1)).toBe("restore(0)");
    // the glow, the floor, every tile and the hub are filled; the staff, every dark tile's edge, the wall and the playhead stroked
    expect(calls.filter((c) => c === "fill(0)").length).toBeGreaterThanOrEqual(v.total + 3);
    expect(calls.filter((c) => c === "stroke(0)").length).toBeGreaterThanOrEqual(3 + (v.total - v.lit) + 2);
    // the gradients are built once and kept – the glow's, the floor's, and a wedge's per hue and pulse level of the lit tiles –: a
    // second frame of the same state on the same context builds none
    const wedges = new Set<number>();
    for (let i = 0; i < v.total; i++) if (v.litMs[i] >= 0) wedges.add(Math.round(tileHue(v.tiles.level[i])) * 8 + Math.round(7 * fade(v.timeMs - v.playMs[i], NOTE_PULSE_MS)));
    expect(wedges.size).toBeGreaterThan(0);
    expect(calls.filter((c) => c === "createRadialGradient(6)").length).toBe(2 + wedges.size);
    calls.length = 0;
    layer.drawWorld(ctx, v, opts);
    expect(calls.filter((c) => c === "createRadialGradient(6)").length).toBe(0);
    // …and another ring (a resize) drops them
    calls.length = 0;
    layer.drawWorld(ctx, { ...v, layout: { ...v.layout!, radius: v.layout!.radius + 1 } }, opts);
    expect(calls.filter((c) => c === "createRadialGradient(6)").length).toBe(2 + wedges.size);
    calls.length = 0;
    layer.drawEffects(ctx, v);
    expect(calls[0]).toBe("save(0)");
    expect(calls.at(-1)).toBe("restore(0)");
    calls.length = 0;
    layer.drawOverlay(ctx, v, DEFAULT_SONG_RING_LABELS);
    expect(calls[0]).toBe("save(0)");
    expect(calls.at(-1)).toBe("restore(0)");
    expect(texts).toEqual([`${v.lit}/7`, "NAME THE TUNE"]);
    expect(layer.hudBox.w).toBeGreaterThan(0);
    // once the chord has fallen the middle is the canvas' end banner's: the layer draws no count there, and reports no box
    run(engine, 60);
    expect(v.chordMs).toBeGreaterThan(0);
    calls.length = 0;
    texts.length = 0;
    layer.drawWorld(ctx, v, opts);
    layer.drawEffects(ctx, v);
    layer.drawOverlay(ctx, v, DEFAULT_SONG_RING_LABELS);
    expect(texts).toEqual([]);
    expect(layer.hudBox.w).toBe(0);
    const blocks: number[][] = [];
    layer.noteHud({ block: (...box: number[]) => blocks.push(box) } as never);
    expect(blocks).toEqual([]);
    // the canvas names the tune through its shared end banner, only from the chord (or says TIME'S UP)
    const canvas = fs.readFileSync(path.join(process.cwd(), "src/components/simulator/Canvas.tsx"), "utf8");
    expect(canvas).toContain("if (songRingView.chordMs >= 0) bigBanner(SR.song(songRingView.song), SR.doneSub(songRingView.total, completeSeconds(songRingView)),");
    expect(canvas).toContain("else bigBanner(SR.timeoutTitle, SR.timeoutSub(songRingView.lit, songRingView.total),");
    expect(canvas.match(/SR\.song\(/g)?.length).toBe(1);
    // nothing drawn without a layout
    calls.length = 0;
    layer.drawWorld(ctx, { ...v, layout: null }, opts);
    layer.drawEffects(ctx, { ...v, layout: null });
    layer.drawOverlay(ctx, { ...v, layout: null }, DEFAULT_SONG_RING_LABELS);
    expect(calls.length).toBe(0);
    // the labels: a name per tune for the banner, never one for the seed's pick
    expect(SURPRISE_TUNES.map((id) => DEFAULT_SONG_RING_LABELS.song(id))).toEqual(["TWINKLE TWINKLE", "ODE TO JOY", "FÜR ELISE", "FRÈRE JACQUES", "MOUNTAIN KING"]);
    expect(DEFAULT_SONG_RING_LABELS.doneSub(7, "14.2")).toBe("7 notes in 14.2 s");
    expect(DEFAULT_SONG_RING_LABELS.timeoutSub(5, 7)).toBe("5 of 7 notes");
  });

  it("the dataset writes every key, in order, and names the tune only once the chord has", () => {
    const engine = songEngine({}, 3);
    run(engine, 2);
    const v = engine.getSongRingView();
    const writes: [string, string][] = [];
    new SongRingDataset().write(v, (k, val) => writes.push([k, val]));
    expect(writes.map(([k]) => k)).toEqual(SONG_RING_DATA_KEYS);
    const value = (key: string) => writes.find(([k]) => k === key)![1];
    expect(value("songTotal")).toBe("7");
    expect(value("songPhase")).toBe("collect");
    expect(value("songFinishedMs")).toBe("-1");
    expect(value("songTune")).toBe("");
    run(engine, 60);
    writes.length = 0;
    new SongRingDataset().write(v, (k, val) => writes.push([k, val]));
    expect([value("songLit"), value("songChord"), value("songFinished"), value("songTune")]).toEqual(["7", "1", "1", "twinkle"]);
  });
});
