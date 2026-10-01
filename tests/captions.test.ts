import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import es from "../messages/es.json";
import pl from "../messages/pl.json";
import {
  CAPTION_ANSWER_HOLD_MS,
  CAPTION_ENTER_SEC,
  CAPTION_EXIT_SEC,
  CAPTION_RANGES,
  CAPTION_REVEAL_SEC,
  CAPTION_TYPES,
  CAPTION_MARGIN,
  CaptionTracker,
  MAX_CAPTIONS,
  MAX_CAPTION_ANSWER_LENGTH,
  MAX_CAPTION_TEXT_LENGTH,
  SLIDE_DISTANCE,
  animateCaption,
  captionCarryOver,
  captionClock,
  captionPhase,
  captionRenderOptions,
  captionStackStarts,
  countdownPulse,
  countdownSeconds,
  countdownText,
  defaultCaption,
  edgeTextBounds,
  edgeTextDistance,
  edgeTextFontSize,
  emptyEdgeTextLines,
  exportEdgeTextLines,
  fillLabel,
  formatClock,
  holdsForAnswer,
  isOpenEnded,
  liveEdgeTextLines,
  parseCaptions,
  phaseVisible,
  progressFraction,
  progressLabel,
  questionReveal,
  resolveCaptions,
  sanitizeCaption,
  serializeCaptions,
  wallCounterText,
  wrapCaptionText,
  type Caption,
  type CaptionBounds,
  type CaptionEngineView,
} from "@/lib/captions";
import { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig } from "@/lib/physics/types";
import { recordingTextLayout } from "@/lib/recording/recorder";
import { RANGES, RESOLUTIONS, defaultSettings, presetToSettings, resolutionToSize, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";

/**
 * Animated captions (lib/captions.ts): the settings (defaults, validation, the compact URL form, presets), the
 * timing and animation maths, the texts (countdown, wall counter, progress, question), the word wrap and the
 * tracker that reads a run from the engine – without touching it.
 */

const caption = (patch: Partial<Caption> = {}): Caption => ({ ...defaultCaption("text", { text: "Hello" }), ...patch });

describe("caption settings", () => {
  it("has no captions by default and leaves them out of links", () => {
    for (const mode of ["classic", "shatter", "drop"] as const) expect(defaultSettings(mode).captions).toEqual([]);
    expect(settingsToSearchParams(defaultSettings("classic")).has("cap")).toBe(false);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic")).captions).toEqual([]);
  });

  it("gives every type a default look", () => {
    for (const type of CAPTION_TYPES) {
      const c = defaultCaption(type);
      expect(sanitizeCaption(c)).toEqual(c);
      expect(c.answer).toBe("");
      expect(isOpenEnded(c)).toBe(true);
    }
    expect(defaultCaption("question", { text: "Q?", answer: "A!" })).toMatchObject({ text: "Q?", answer: "A!" });
    // Only a question keeps an answer.
    expect(defaultCaption("text", { text: "T", answer: "A" }).answer).toBe("");
  });

  it("spreads its slider ranges into RANGES", () => {
    expect(RANGES.captionStart).toEqual(CAPTION_RANGES.captionStart);
    expect(RANGES.captionEnd).toEqual(CAPTION_RANGES.captionEnd);
    expect(RANGES.captionSize).toEqual(CAPTION_RANGES.captionSize);
  });

  it("round-trips every type through the compact URL form", () => {
    const captions: Caption[] = [
      { ...defaultCaption("countdown"), text: "[time] left", position: "bottom", start: 1.5, end: 20, animation: "slide", style: { size: 1.4, color: "#ff3366", background: "#112233" } },
      { ...defaultCaption("wallCounter"), text: "Ring [n] of [total]" },
      { ...defaultCaption("progress"), position: "center", animation: "pop", style: { size: 0.5, color: "#00ff00", background: "" } },
      { ...defaultCaption("question"), text: "Will it escape, really?", answer: "YES* 100%" },
      { ...defaultCaption("text"), text: "Emoji 🔥 and, commas * stars % percent", start: 3, end: 3 },
    ];
    const text = serializeCaptions(captions);
    expect(parseCaptions(text)).toEqual(captions);
    const s = { ...defaultSettings("classic"), captions };
    const params = settingsToSearchParams(s);
    expect(params.get("cap")).toBe(text);
    const back = settingsFromSearchParams(new URLSearchParams(params.toString()));
    expect(back.captions).toEqual(captions);
    expect(back).toEqual(s);
  });

  it("writes a compact form: short codes, no '#', trailing empty texts left out", () => {
    expect(serializeCaptions([defaultCaption("countdown")])).toBe("cd*t*0*0*p*1.2*ffffff*000000");
    expect(serializeCaptions([defaultCaption("text")])).toBe("tx*b*0*0*f*1*ffffff*");
    expect(serializeCaptions([defaultCaption("question", { text: "Q", answer: "A" })])).toBe("q*t*0*0*p*1.3*ffffff*000000*Q*A");
  });

  it("reads bad links safely: unknown types skipped, bad fields fall back, numbers clamped, at most eight", () => {
    const parsed = parseCaptions("zz*t*0*0*p,cd*x*-5*999*?*9*nothex*alsobad,q,tx*c*2.3*abc*s*0.74*ABC*def*  Hi  there  ");
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({ ...defaultCaption("countdown"), start: 0, end: 999, style: { size: 9, color: "#ffffff", background: "#000000" } }); // --- uncap-all --- (no maximum)
    expect(parsed[1]).toEqual(defaultCaption("question"));
    expect(parsed[2]).toMatchObject({ type: "text", position: "center", start: 2.5, end: 0, animation: "slide", text: "Hi there", style: { size: 0.7, color: "#aabbcc", background: "#ddeeff" } });
    expect(parseCaptions(Array.from({ length: 12 }, () => "tx*b*0*0*f*1*ffffff**x").join(","))).toHaveLength(MAX_CAPTIONS);
    expect(parseCaptions("")).toEqual([]);
    expect(parseCaptions(null)).toEqual([]);
  });

  it("sanitises texts: control characters, whitespace and length", () => {
    const c = sanitizeCaption({ type: "question", text: `  a\n\tb${"x".repeat(200)}`, answer: "y".repeat(100) })!;
    expect(c.text.startsWith("a b")).toBe(true);
    expect(Array.from(c.text)).toHaveLength(MAX_CAPTION_TEXT_LENGTH);
    expect(c.answer).toHaveLength(MAX_CAPTION_ANSWER_LENGTH);
    expect(sanitizeCaption({ type: "nope" })).toBeNull();
    expect(sanitizeCaption(null)).toBeNull();
    expect(resolveCaptions("not a list")).toEqual([]);
    expect(resolveCaptions([{ type: "text", text: "ok" }, { type: 5 }, "x"])).toHaveLength(1);
  });

  it("validates the captions of a preset and keeps them through a save", () => {
    const captions = [defaultCaption("question", { text: "Q?", answer: "A!" }), defaultCaption("progress")];
    const saved = JSON.parse(JSON.stringify({ ...defaultSettings("shatter"), captions })) as Partial<SimulatorSettings>;
    expect(presetToSettings(saved).captions).toEqual(captions);
    const bad = { mode: "classic", captions: [{ type: "countdown", start: "x", end: -3, animation: "spin", position: "left", style: { size: 99, color: "red", background: 7 } }, { type: "bogus" }] } as unknown as Partial<SimulatorSettings>;
    expect(presetToSettings(bad).captions).toEqual([{ ...defaultCaption("countdown"), style: { size: 99, color: "#ffffff", background: "#000000" } }]); // --- uncap-all --- (no maximum)
    // A preset saved before captions existed has none.
    expect(presetToSettings({ mode: "classic" }).captions).toEqual([]);
  });

  it("carries the captions over a mode change as a copy", () => {
    const captions = [defaultCaption("countdown")];
    const kept = captionCarryOver({ captions });
    expect(kept.captions).toEqual(captions);
    expect(kept.captions[0]).not.toBe(captions[0]);
    expect(kept.captions[0].style).not.toBe(captions[0].style);
  });

  it("names every caption control in every language", () => {
    const keys = Object.keys(en.Controls).filter((k) => k.startsWith("caption"));
    expect(keys.length).toBeGreaterThan(40);
    for (const messages of [pl, es]) {
      const controls = messages.Controls as Record<string, string>;
      for (const key of keys) expect(typeof controls[key]).toBe("string");
      const sim = messages.Simulator as Record<string, string>;
      expect(sim.canvasCaptionWall).toContain("[n]");
      expect(sim.canvasCaptionWall).toContain("[total]");
    }
  });

  it("gives the canvas the resolved captions and the clip length, or nothing", () => {
    expect(captionRenderOptions({ captions: [], recordingDuration: 30 })).toBeNull();
    const o = captionRenderOptions({ captions: [{ ...caption(), text: "  hi  " }], recordingDuration: 45 })!;
    expect(o.clipSec).toBe(45);
    expect(o.captions[0].text).toBe("hi");
    expect(captionRenderOptions({ captions: [caption()], recordingDuration: NaN })!.clipSec).toBe(30);
  });
});

describe("caption timing", () => {
  it("is hidden before its start, enters, holds and leaves by its end", () => {
    const c = caption({ start: 2, end: 6 });
    const at = (t: number) => captionPhase(c, t, -1);
    expect(phaseVisible(at(0))).toBe(false);
    expect(phaseVisible(at(1.99))).toBe(false);
    expect(at(2).enter).toBe(0);
    expect(at(2 + CAPTION_ENTER_SEC / 2).enter).toBeCloseTo(0.5);
    expect(at(2 + CAPTION_ENTER_SEC).enter).toBeCloseTo(1);
    expect(at(3).enter).toBe(1);
    expect(at(4).exit).toBe(1);
    expect(at(6 - CAPTION_EXIT_SEC / 2).exit).toBeCloseTo(0.5);
    expect(phaseVisible(at(5.99))).toBe(true);
    expect(phaseVisible(at(6))).toBe(false);
    expect(phaseVisible(at(100))).toBe(false);
  });

  it("stays until the end of the run with an end of 0 or one not after the start", () => {
    for (const end of [0, 1, 2]) {
      const c = caption({ start: 2, end });
      expect(isOpenEnded(c)).toBe(true);
      expect(phaseVisible(captionPhase(c, 1000, -1))).toBe(true);
      expect(captionPhase(c, 1000, -1).exit).toBe(1);
    }
  });

  it("splits a short window between the entrance and the exit", () => {
    const c = caption({ start: 1, end: 1.5 });
    expect(captionPhase(c, 1.25, -1).enter).toBe(1);
    expect(captionPhase(c, 1.25, -1).exit).toBe(1);
    expect(captionPhase(c, 1.125, -1).enter).toBeCloseTo(0.5);
    expect(captionPhase(c, 1.375, -1).exit).toBeCloseTo(0.5);
  });

  it("reveals a question's answer from the escape or finish on, and only with an answer", () => {
    const q = defaultCaption("question", { text: "Will it escape?", answer: "YES!" });
    expect(questionReveal(q, 10, -1)).toBe(0);
    expect(questionReveal(q, 4.9, 5)).toBe(0);
    expect(questionReveal(q, 5 + CAPTION_REVEAL_SEC / 2, 5)).toBeCloseTo(0.5);
    expect(questionReveal(q, 50, 5)).toBe(1);
    expect(questionReveal({ ...q, answer: "  " }, 50, 5)).toBe(0);
    expect(questionReveal({ ...q, type: "text" }, 50, 5)).toBe(0);
    // A reveal before the caption's start waits for it.
    expect(questionReveal({ ...q, start: 8 }, 7, 5)).toBe(0);
    expect(questionReveal({ ...q, start: 8 }, 8 + CAPTION_REVEAL_SEC, 5)).toBe(1);
  });

  it("holds a finished run's end screen until the answer has been seen", () => {
    expect(holdsForAnswer(true, true, 0)).toBe(true);
    expect(holdsForAnswer(true, true, CAPTION_ANSWER_HOLD_MS - 1)).toBe(true);
    expect(holdsForAnswer(true, true, CAPTION_ANSWER_HOLD_MS)).toBe(false);
    // Not finished yet (Classic reveals at the escape, long before), or nothing revealed: no hold.
    expect(holdsForAnswer(true, false, 0)).toBe(false);
    expect(holdsForAnswer(false, true, 0)).toBe(false);
  });

  it("keeps a revealed question on screen, and brings a closed one back with its answer", () => {
    const q = { ...defaultCaption("question", { text: "Q", answer: "A" }), start: 0, end: 4 };
    // Revealed inside its window: it no longer leaves at the end.
    expect(phaseVisible(captionPhase(q, 10, 3))).toBe(true);
    expect(captionPhase(q, 10, 3).enter).toBe(1);
    // Revealed after the window closed: it re-enters with the answer.
    expect(phaseVisible(captionPhase(q, 5, -1))).toBe(false);
    expect(phaseVisible(captionPhase(q, 6, 6))).toBe(false);
    expect(captionPhase(q, 6 + CAPTION_REVEAL_SEC / 2, 6).enter).toBeCloseTo(0.5);
    expect(phaseVisible(captionPhase(q, 7, 6))).toBe(true);
  });
});

describe("caption animations", () => {
  const phase = (enter: number, exit = 1) => ({ enter, exit, reveal: 0 });

  it("fades the opacity in and out", () => {
    expect(animateCaption("fade", "top", phase(0)).alpha).toBe(0);
    expect(animateCaption("fade", "top", phase(1)).alpha).toBe(1);
    const mid = animateCaption("fade", "top", phase(0.5));
    expect(mid.alpha).toBeGreaterThan(0.5);
    expect(mid.dy).toBe(0);
    expect(mid.scale).toBe(1);
    expect(animateCaption("fade", "top", phase(1, 0.5)).alpha).toBeCloseTo(mid.alpha);
  });

  it("slides in from the caption's edge of the frame", () => {
    expect(animateCaption("slide", "top", phase(0)).dy).toBeCloseTo(-SLIDE_DISTANCE);
    expect(animateCaption("slide", "bottom", phase(0)).dy).toBeCloseTo(SLIDE_DISTANCE);
    expect(animateCaption("slide", "center", phase(0)).dy).toBeGreaterThan(0);
    expect(animateCaption("slide", "top", phase(1)).dy).toBeCloseTo(0);
    const leaving = animateCaption("slide", "top", phase(1, 0.5)).dy;
    expect(leaving).toBeLessThan(0);
    expect(leaving).toBeGreaterThan(-SLIDE_DISTANCE);
  });

  it("pops in past full size and shrinks on the way out", () => {
    let peak = 0;
    for (let x = 0; x <= 1; x += 0.05) peak = Math.max(peak, animateCaption("pop", "top", phase(x)).scale);
    expect(peak).toBeGreaterThan(1.05);
    expect(animateCaption("pop", "top", phase(1)).scale).toBeCloseTo(1);
    expect(animateCaption("pop", "top", phase(1, 0.5)).scale).toBeCloseTo(0.8);
    expect(animateCaption("pop", "top", phase(1, 0)).alpha).toBe(0);
  });

  it("takes room in its stack as it enters, so the others make way smoothly", () => {
    const rooms = [0, 0.25, 0.5, 0.75, 1].map((x) => animateCaption("fade", "top", phase(x)).room);
    expect(rooms[0]).toBe(0);
    expect(rooms[4]).toBe(1);
    for (let i = 1; i < rooms.length; i++) expect(rooms[i]).toBeGreaterThan(rooms[i - 1]);
  });

  it("reuses the output object (no allocation per frame)", () => {
    const out = { alpha: 0, dy: 0, scale: 1, room: 0 };
    expect(animateCaption("pop", "bottom", phase(0.3), out)).toBe(out);
    const p = { enter: 0, exit: 0, reveal: 0 };
    expect(captionPhase(caption(), 1, -1, p)).toBe(p);
  });
});

describe("caption texts", () => {
  it("counts down whole seconds to the end of the clip", () => {
    expect(countdownSeconds(30, 0)).toBe(30);
    expect(countdownSeconds(30, 0.01)).toBe(30);
    expect(countdownSeconds(30, 1)).toBe(29);
    expect(countdownSeconds(30, 29.5)).toBe(1);
    expect(countdownSeconds(30, 30)).toBe(0);
    expect(countdownSeconds(30, 45)).toBe(0);
    expect(formatClock(27)).toBe("0:27");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(720)).toBe("12:00");
    expect(countdownText({ text: "" }, 30, 3.2)).toBe("0:27");
    expect(countdownText({ text: "[time] left" }, 90, 0)).toBe("1:30 left");
    expect(countdownText({ text: "Time left:" }, 10, 0)).toBe("Time left: 0:10");
  });

  it("pulses the countdown on every tick of its last seconds", () => {
    expect(countdownPulse(30, 10)).toBe(1);
    expect(countdownPulse(30, 26)).toBeCloseTo(1.2);
    expect(countdownPulse(30, 26.1)).toBeGreaterThan(1);
    expect(countdownPulse(30, 26.5)).toBe(1);
    expect(countdownPulse(30, 31)).toBe(1);
  });

  it("fills labels, or puts them in front of the value", () => {
    expect(fillLabel("", { n: "1" }, "v")).toBe("v");
    expect(fillLabel("Ring [n]", { n: "3" }, "v")).toBe("Ring 3");
    expect(fillLabel("Rings", { n: "3" }, "3/7")).toBe("Rings 3/7");
    expect(fillLabel("[unknown] x", { n: "3" }, "v")).toBe("[unknown] x v");
  });

  it("shows walls broken over walls in play, and nothing without rings", () => {
    const label = en.Simulator.canvasCaptionWall;
    expect(wallCounterText({ text: "" }, 3, 10, label)).toBe("Wall 3/10");
    expect(wallCounterText({ text: "" }, 12, 10, label)).toBe("Wall 10/10");
    expect(wallCounterText({ text: "" }, 0, 7, pl.Simulator.canvasCaptionWall)).toBe("Ściana 0/7");
    expect(wallCounterText({ text: "Ring [n] of [total]" }, 2, 7, label)).toBe("Ring 2 of 7");
    expect(wallCounterText({ text: "Broken:" }, 2, 7, label)).toBe("Broken: 2/7");
    expect(wallCounterText({ text: "" }, 0, 0, label)).toBeNull();
  });

  it("measures the progress over the clip length", () => {
    expect(progressFraction(30, 0)).toBe(0);
    expect(progressFraction(30, 15)).toBe(0.5);
    expect(progressFraction(30, 60)).toBe(1);
    expect(progressFraction(0, 5)).toBe(0);
    expect(progressLabel({ text: "" }, 0.5)).toBe("");
    expect(progressLabel({ text: "Progress [pct]" }, 0.426)).toBe("Progress 43%");
    expect(progressLabel({ text: "Almost there" }, 0.9)).toBe("Almost there");
  });

  it("wraps long texts onto at most three lines and cuts the rest", () => {
    const measure = (s: string) => s.length * 10;
    expect(wrapCaptionText("", measure, 100)).toEqual([]);
    expect(wrapCaptionText("short one", measure, 100)).toEqual(["short one"]);
    expect(wrapCaptionText("aaaa bbbb cccc", measure, 100)).toEqual(["aaaa bbbb", "cccc"]);
    const lines = wrapCaptionText("one two three four five six seven eight nine ten eleven twelve", measure, 100);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(100);
    expect(lines[2].endsWith("…")).toBe(true);
    // A word wider than the line gets a line of its own.
    expect(wrapCaptionText("tiny supercalifragilistic end", measure, 100)).toEqual(["tiny", "supercalifragilistic", "end"]);
  });
});

describe("caption tracker", () => {
  const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
  const modeSettings: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
  const STEP = 1000 / 60;

  it("follows a Classic run: the clock, the walls broken, the escape and the reveal", () => {
    const engine = createEngineForSettings(config, "classic", modeSettings, 12345);
    const tracker = new CaptionTracker();
    let walls = 0;
    let revealAt = -1;
    for (let i = 0; i < 60 * 120 && !engine.isSimulationFinished(); i++) {
      engine.update(STEP, 0);
      const s = tracker.update(engine);
      expect(s.wallsBroken).toBeGreaterThanOrEqual(walls); // never counts down within a run
      walls = s.wallsBroken;
      if (s.revealAtSec >= 0 && revealAt < 0) {
        revealAt = s.revealAtSec;
        expect(s.escaped || s.finished).toBe(true);
      }
    }
    const s = tracker.state;
    expect(engine.isSimulationFinished()).toBe(true);
    expect(s.wallsTotal).toBe(7);
    expect(s.wallsBroken).toBe(7);
    expect(s.escaped).toBe(true);
    expect(s.finished).toBe(true);
    expect(s.timeSec).toBeCloseTo(engine.getElapsedMs() / 1000);
    // Classic's run only ends once the ball is far off-screen: the answer came with the escape, before the finish.
    expect(revealAt).toBeGreaterThan(0);
    expect(revealAt).toBeLessThan(s.timeSec);
    // A restart (a new stats generation) starts the tracker over.
    engine.initMode("classic");
    const fresh = tracker.update(engine);
    expect(fresh).toMatchObject({ wallsBroken: 0, escaped: false, finished: false, revealAtSec: -1 });
  });

  it("counts nothing in a mode without rings and skips the escape scan when no question needs it", () => {
    const engine = createEngineForSettings(config, "drop", modeSettings, 7);
    const tracker = new CaptionTracker();
    for (let i = 0; i < 120; i++) engine.update(STEP, 0);
    expect(tracker.update(engine).wallsTotal).toBe(0);
    let scans = 0;
    const view: CaptionEngineView = {
      getElapsedMs: () => 1000,
      isSimulationFinished: () => false,
      getCircularWalls: () => [1, 2, 3],
      getBrokenWalls: () => new Set([0]),
      getBalls: () => [{ id: 1 }],
      hasBallEscaped: () => {
        scans++;
        return true;
      },
      getStatsGeneration: () => 1,
      isShatterMode: () => false,
      getShatterSegments: () => [],
    };
    const t2 = new CaptionTracker();
    expect(t2.update(view, false)).toMatchObject({ escaped: false, revealAtSec: -1, wallsBroken: 1, wallsTotal: 3 });
    expect(scans).toBe(0);
    expect(t2.update(view, true)).toMatchObject({ escaped: true, revealAtSec: 1 });
    expect(scans).toBe(1);
    t2.update(view, true);
    expect(scans).toBe(1); // latched
  });

  it("only reads the engine: a seeded run is identical with and without the tracker", () => {
    const trace = (withTracker: boolean) => {
      const engine = createEngineForSettings(config, "shatter", modeSettings, 99);
      const tracker = new CaptionTracker();
      const out: number[] = [];
      for (let i = 0; i < 600; i++) {
        engine.update(STEP, 0);
        if (withTracker) tracker.update(engine);
        const b = engine.getBalls()[0];
        if (b) out.push(b.x, b.y);
      }
      return out;
    };
    expect(trace(true)).toEqual(trace(false));
  });

  it("works with the real engine type", () => {
    const view: CaptionEngineView = new PhysicsEngine({ ...config });
    expect(new CaptionTracker().update(view).timeSec).toBe(0);
  });

  it("counts every Shatter wall the ball broke through: all of them at the escape", () => {
    for (const seed of [1, 7, 99, 2024, 4242, 12345]) {
      const engine = createEngineForSettings(config, "shatter", modeSettings, seed);
      const tracker = new CaptionTracker();
      let atEscape = -1;
      let midRun = false;
      for (let i = 0; i < 60 * 180 && !engine.isSimulationFinished(); i++) {
        engine.update(STEP, 0);
        const s = tracker.update(engine);
        if (s.wallsBroken > 0 && s.wallsBroken < s.wallsTotal) midRun = true;
        if (s.escaped && atEscape < 0) {
          atEscape = s.wallsBroken;
          // Shatter itself only calls a wall broken once every one of its segments is gone.
          expect(engine.getBrokenWalls().size).toBeLessThan(s.wallsTotal);
        }
      }
      expect(tracker.state.escaped).toBe(true);
      expect(tracker.state.wallsTotal).toBe(7);
      expect(atEscape).toBe(7);
      expect(tracker.state.wallsBroken).toBe(7);
      expect(midRun).toBe(true); // it counts up wall by wall
    }
  });

  it("reads Shatter's segments only in Shatter: a wall with a destroyed segment is broken, and the count never drops", () => {
    let shatter = true;
    let segments = [[{ hp: 1 }, { hp: 0 }], [{ hp: 1 }, { hp: 1 }], [{ hp: 0 }, { hp: 0 }]];
    const view: CaptionEngineView = {
      getElapsedMs: () => 500,
      isSimulationFinished: () => false,
      getCircularWalls: () => [1, 2, 3],
      getBrokenWalls: () => new Set([2]),
      getBalls: () => [],
      hasBallEscaped: () => false,
      getStatsGeneration: () => 3,
      isShatterMode: () => shatter,
      getShatterSegments: () => segments,
    };
    const tracker = new CaptionTracker();
    expect(tracker.update(view).wallsBroken).toBe(2);
    segments = [[{ hp: 1 }, { hp: 1 }], [{ hp: 1 }, { hp: 1 }], [{ hp: 1 }, { hp: 1 }]]; // a rebuilt board: the most seen stays
    expect(tracker.update(view).wallsBroken).toBe(2);
    shatter = false; // another mode's leftover segments are not read
    const other = new CaptionTracker();
    segments = [[{ hp: 0 }], [{ hp: 0 }], [{ hp: 0 }]];
    expect(other.update(view).wallsBroken).toBe(1);
  });
});

describe("caption clip clock and layout", () => {
  it("counts the countdown and the progress bar on the clip while recording, on the run otherwise", () => {
    const cd = defaultCaption("countdown");
    // Live preview: the run's clock.
    expect(captionClock(4.5, -1)).toBe(4.5);
    expect(countdownText(cd, 30, captionClock(4.5, -1))).toBe("0:26");
    // Record pressed 4.5 s into a running run (or at 8×, or in slow motion): 0.6 s into the clip it is still 0:30 and 2 %,
    // not 0:25 and 17 % – the recorder stops after 30 s of real time.
    const clip = captionClock(5.1, 0.6);
    expect(clip).toBe(0.6);
    expect(countdownText(cd, 30, clip)).toBe("0:30");
    expect(Math.round(100 * progressFraction(30, clip))).toBe(2);
    // The clip's last second: 0:01, full bar only at its end – where the run clock (34.5 s) had been at 0:00 for 4.5 s.
    expect(countdownText(cd, 30, captionClock(33.9, 29.4))).toBe("0:01");
    expect(progressFraction(30, captionClock(34.5, 30))).toBe(1);
    expect(countdownPulse(30, captionClock(40, 29))).toBeCloseTo(1.2, 9);
    expect(countdownText(cd, 30, captionClock(26, 0))).toBe("0:30");
  });

  const bounds = (): CaptionBounds => ({ insetTop: 0, insetBottom: 0, topMin: 0, bottomMax: Infinity });

  it("keeps the stacks where they were without a Top / Bottom Text", () => {
    const b = bounds();
    edgeTextBounds(emptyEdgeTextLines(), 0, b);
    expect(b).toEqual({ insetTop: 0, insetBottom: 0, topMin: 0, bottomMax: Infinity });
    const starts = captionStackStarts(800, 600, b, { top: 0, bottom: 0 });
    expect(starts.top).toBeCloseTo(CAPTION_MARGIN * 600, 9);
    expect(starts.bottom).toBeCloseTo(600 - CAPTION_MARGIN * 600, 9);
    // The scoreboard alone still pushes the top stack down.
    edgeTextBounds(emptyEdgeTextLines(), 120, b);
    expect(b.topMin).toBe(120);
    expect(captionStackStarts(800, 600, b, { top: 0, bottom: 0 }).top).toBeCloseTo(120 + 0.5 * CAPTION_MARGIN * 600, 9);
  });

  /** A text line's glyphs reach about half a font size around its centre: the stacks must start beyond that. */
  function expectClear(width: number, height: number, lines: ReturnType<typeof emptyEdgeTextLines>, b: CaptionBounds, label: string) {
    edgeTextBounds(lines, 0, b);
    const starts = captionStackStarts(width, height, b, { top: 0, bottom: 0 });
    expect(starts.top, `${label}: top stack below the Top Text`).toBeGreaterThan(lines.topY + 0.5 * lines.fontSize);
    expect(starts.bottom, `${label}: bottom stack above the Bottom Text`).toBeLessThan(lines.bottomY - 0.5 * lines.fontSize);
  }

  it("starts the top stack below the Top Text and the bottom stack above the Bottom Text, live", () => {
    for (const [w, h] of [
      [790, 444],
      [800, 800],
      [400, 700],
      [1200, 900],
      [360, 640],
      [250, 250],
    ]) {
      for (const textSize of [0.5, 1, 1.5, 2, 3]) {
        const side = Math.min(w, h);
        const arena = (side / 2) * 0.85;
        const lines = liveEdgeTextLines(side, h / 2, arena, textSize, true, true, emptyEdgeTextLines());
        expect(lines.fontSize).toBeCloseTo(edgeTextFontSize(side, textSize), 12);
        expect(lines.topY).toBeCloseTo(h / 2 - edgeTextDistance(arena, lines.fontSize), 9);
        const live = (w - side) / 2 < 170;
        expectClear(w, h, lines, { ...bounds(), insetTop: live ? 52 : 0, insetBottom: live ? 56 : 0 }, `live ${w}×${h} text ${textSize}`);
      }
    }
    // The review's case: 790×444, "CAN IT ESCAPE?" over a countdown pill – the pill now starts below the line.
    const lines = liveEdgeTextLines(444, 222, 188.7, 1, true, false, emptyEdgeTextLines());
    const b = edgeTextBounds(lines, 0, { ...bounds(), insetTop: 52, insetBottom: 56 });
    expect(b.bottomMax).toBe(Infinity);
    expect(captionStackStarts(790, 444, b, { top: 0, bottom: 0 }).top).toBeGreaterThan(lines.topY + 0.5 * lines.fontSize);
  });

  it("keeps clear of the lines the recorder draws into every export frame while recording", () => {
    for (const res of RESOLUTIONS) {
      const { width: W, height: H } = resolutionToSize(res);
      for (const [w, h] of [
        [790, 444],
        [800, 800],
        [400, 700],
      ]) {
        for (const textSize of [0.5, 1, 2, 3]) {
          const side = Math.min(w, h);
          const layout = recordingTextLayout(W, H, textSize);
          const lines = exportEdgeTextLines(layout, W, H, side, h / 2 - side / 2, true, true, emptyEdgeTextLines());
          expectClear(w, h, lines, bounds(), `export ${res} of ${w}×${h}, text ${textSize}`);
          // The same in export pixels: the first caption's edge, mapped into the frame, is clear of the drawn line.
          const square = Math.min(W, H);
          const k = square / side;
          const starts = captionStackStarts(w, h, edgeTextBounds(lines, 0, bounds()), { top: 0, bottom: 0 });
          const toFrame = (y: number) => (H - square) / 2 + (y - (h / 2 - side / 2)) * k;
          expect(toFrame(starts.top)).toBeGreaterThan(layout.topY + 0.5 * layout.fontSize);
          expect(toFrame(starts.bottom)).toBeLessThan(layout.bottomY - 0.5 * layout.fontSize);
        }
      }
    }
    // A 1080×1920 export: 4 % of the square, the lines 0.6 font sizes outside the ring.
    const portrait = recordingTextLayout(1080, 1920, 1);
    expect(portrait.fontSize).toBeCloseTo(43.2, 9);
    expect(portrait.topY).toBeCloseTo(960 - 459 - 0.6 * 43.2, 9);
    expect(portrait.bottomY).toBeCloseTo(960 + 459 + 0.6 * 43.2, 9);
  });
});
