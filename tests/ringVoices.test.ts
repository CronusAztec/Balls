import { describe, expect, it } from "vitest";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { RING_CHORD_HZ, classicToneHz } from "@/lib/physics/ringEscape";
import { wallHitFrequency } from "@/lib/audio/sampler";
import { COLOUR_WRAP, colourChordHz, colourNoteHz, countdownSeekHz, countdownStepHz, freezeThumpHz, icePlinkHz, timerPluckHz } from "@/lib/physics/ringVoices";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { ModeId, SoundEvent } from "@/lib/physics/types";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { ringVoiceEvent } from "@/lib/audio/loopEvents"; // --- ring-voices --- (review fix B2)
import { playSoundEvent } from "@/lib/recording/fastRender";
import { MOMENT_AFTER_SEC, MOMENT_BEFORE_SEC, payoffMomentSync } from "@/lib/insights/score";
import { COLOR_MATCH_COLORS, colorMatchColor, colorMatchColorOf } from "@/lib/physics/modes/colorMatch";
import { clipStartSettings, isBareStudioVisit } from "@/lib/clipPacing";
import { createEngineForSettings } from "@/lib/simulation/finder";

/*
 * --- ring-voices --- The single-ring escape modes' own voices (lib/physics/ringVoices.ts and the modes' hooks): Countdown's
 * ladder that climbs with every number and lands on the last one, Color Match's note per colour and triad per match,
 * Accumulation's plucks that climb with its timer – instead of the engine's one 800 Hz blip and one arpeggio. Sound only: the
 * runs themselves are pinned by the BASELINE of tests/extras.test.ts, which this change leaves alone; and an event for an
 * event: the modes swap the sound a bounce or a break makes, never how many events there are.
 */

const C5 = 523.251;
const C7 = 2093.005;

interface Logged {
  atMs: number;
  event: SoundEvent;
}

function engineOf(mode: ModeId, seed: number, patch: Partial<SimulatorSettings> = {}): PhysicsEngine {
  const request = finderRequestOfSettings({ ...defaultSettings(mode), ...patch }, { width: 800, height: 450 }, 120);
  return createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
}

/** Runs `engine` to its end (or `maxSec`) and returns every sound event with the simulation time it was sent at. */
function runOf(engine: PhysicsEngine, maxSec = 120): { log: Logged[]; endMs: number; finished: boolean } {
  const log: Logged[] = [];
  let t = 0;
  while (t < 1000 * maxSec && !engine.isSimulationFinished()) {
    engine.update(1000 / 60, 0);
    t += 1000 / 60;
    for (const event of engine.consumeSoundEvents()) log.push({ atMs: t, event });
  }
  return { log, endMs: t, finished: engine.isSimulationFinished() };
}

describe("the ring modes' pitches", () => {
  it("climbs Countdown's ladder one pentatonic degree a hit and lands the last hit on the tonic, two octaves up", () => {
    expect(countdownStepHz(0)).toBeCloseTo(C7, 1);
    const ladder = [6, 5, 4, 3, 2, 1, 0].map(countdownStepHz);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
    // a pentatonic step is a major second or a minor third: never a leap
    for (let i = 1; i < ladder.length; i++) expect(ladder[i] / ladder[i - 1]).toBeLessThan(1.2);
    // a long countdown waits on C5 and starts to climb when ten are left
    expect(countdownStepHz(24)).toBeCloseTo(C5, 1);
    expect(countdownStepHz(10)).toBeCloseTo(C5, 1);
    expect(countdownStepHz(9)).toBeGreaterThan(countdownStepHz(10));
    // what is no count plays the top, never NaN
    expect(countdownStepHz(Number.NaN)).toBeCloseTo(C7, 1);
    expect(countdownStepHz(-3)).toBeCloseTo(C7, 1);
  });

  it("plays every other Countdown bounce an octave under the step the run is waiting for", () => {
    for (const left of [7, 4, 2, 1]) expect(countdownSeekHz(left)).toBeCloseTo(countdownStepHz(left - 1) / 2, 6);
    expect(countdownSeekHz(1)).toBeCloseTo(C7 / 2, 1);
  });

  it("gives every colour its own note, the cycle of colours a rising scale, and a match its triad", () => {
    const notes = [0, 1, 2, 3, 4, 5, 6].map(colourNoteHz);
    expect(notes[0]).toBeCloseTo(261.626, 1); // C4
    for (let i = 1; i < notes.length; i++) expect(notes[i]).toBeGreaterThan(notes[i - 1]);
    expect(colourNoteHz(COLOUR_WRAP)).toBeCloseTo(notes[0], 6); // a hundred colours stay in register
    const triad = colourChordHz(2);
    expect(triad[0]).toBeCloseTo(colourNoteHz(2), 6);
    expect(triad[1]).toBeCloseTo(colourNoteHz(4), 6);
    expect(triad[2]).toBeCloseTo(colourNoteHz(6), 6);
  });

  it("raises a ball's plucks as its timer runs down, and thumps lower for every ball frozen", () => {
    const plucks = [3000, 2400, 1800, 1200, 600, 100].map((left) => timerPluckHz(left, 3000));
    for (let i = 1; i < plucks.length; i++) expect(plucks[i]).toBeGreaterThanOrEqual(plucks[i - 1]);
    expect(plucks[plucks.length - 1]).toBeGreaterThan(1.5 * plucks[0]);
    expect(timerPluckHz(0, 0)).toBe(timerPluckHz(5, 0)); // no timer: its first note
    for (let n = 1; n <= 12; n++) expect(freezeThumpHz(n)).toBeLessThan(freezeThumpHz(n - 1));
    expect(freezeThumpHz(500)).toBe(freezeThumpHz(12)); // never under G1
    expect(icePlinkHz(0)).toBeGreaterThan(1500);
  });
});

describe("Countdown's voice", () => {
  it("plays a rising step for every hit, the last one accented with the chord, and never the engine's tone", () => {
    for (const seed of [3, 7, 11]) {
      const engine = engineOf("target", seed);
      const total = engine.getCountdownTotal();
      const { log, finished } = runOf(engine);
      expect(finished, `seed ${seed}`).toBe(true);
      const steps = log.filter((l) => l.event.loop === "step");
      expect(steps.length).toBe(total);
      for (const s of steps) expect([s.event.type, s.event.melody]).toEqual(["hit", false]);
      for (let i = 1; i < steps.length; i++) expect(steps[i].event.frequency!).toBeGreaterThan(steps[i - 1].event.frequency!);
      expect(steps[steps.length - 1].event.frequency!).toBeCloseTo(C7, 1);
      expect(steps.map((s) => !!s.event.accent)).toEqual([...Array(total - 1).fill(false), true]);
      // with every step the one "gap" event a right hit always sent (the camera and the finder count it): a bell on the step's
      // own note, the chord on the last one
      const breaks = log.filter((l) => l.event.type === "gap");
      expect(breaks.map((b) => b.atMs)).toEqual(steps.map((s) => s.atMs));
      expect(breaks.map((b) => b.event.loop)).toEqual([...Array(total - 1).fill("ding"), "chord"]);
      breaks.slice(0, -1).forEach((b, i) => expect(b.event.frequency).toBe(steps[i].event.frequency));
      expect(breaks[total - 1].event.frequency).toBe(RING_CHORD_HZ);
      // every other sound is the soft seek pluck: no event without a voice of the mode's own
      const others = log.filter((l) => l.event.loop !== "step" && l.event.type !== "gap");
      expect(others.length).toBeGreaterThan(total);
      for (const o of others) expect([o.event.loop, o.event.type, o.event.level]).toEqual(["pluck", "hit", 0.45]);
    }
  });

  it("pitches the search under the step it waits for: it climbs as the countdown runs down", () => {
    const engine = engineOf("target", 7);
    const { log } = runOf(engine);
    let left = engine.getCountdownTotal();
    for (const l of log) {
      if (l.event.loop === "pluck") expect(l.event.frequency!).toBeCloseTo(countdownSeekHz(left), 6);
      if (l.event.loop === "step") {
        expect(l.event.frequency!).toBeCloseTo(countdownStepHz(left - 1), 6); // the step the plucks before it were an octave under
        left--;
      }
    }
    expect(left).toBe(0);
    const plucks = log.filter((l) => l.event.loop === "pluck").map((l) => l.event.frequency!);
    expect(plucks[plucks.length - 1]).toBeGreaterThan(plucks[0]);
  });

  it("is heard: about three sounds a second and never a second of silence in a default run", () => {
    for (const seed of [1, 2, 3, 4]) {
      const { log, endMs } = runOf(engineOf("target", seed));
      const rate = log.length / (endMs / 1000);
      expect(rate, `seed ${seed}`).toBeGreaterThan(1.5);
      expect(rate, `seed ${seed}`).toBeLessThan(6);
      let quiet = log[0].atMs;
      for (let i = 1; i < log.length; i++) quiet = Math.max(quiet, log[i].atMs - log[i - 1].atMs);
      expect(quiet, `seed ${seed}`).toBeLessThan(1000);
    }
  });
});

describe("Color Match's voice", () => {
  it("plays the colour the ball turns on every bounce, a triad on a match and the chord when the ring opens", () => {
    for (const seed of [2, 5]) {
      const engine = engineOf("colorMatch", seed);
      const segments = engine.getColorMatchSegments().length;
      const colours = engine.getColorMatchColorCount();
      const { log, finished } = runOf(engine);
      expect(finished, `seed ${seed}`).toBe(true);
      // every event is a pluck, a match's accent or the last chord: the engine's tone and arpeggio are gone
      for (const l of log) expect(["pluck", "impact", "chord"], `seed ${seed}`).toContain(l.event.loop);
      // a match is the "hit" and the "gap" event it always sent (the camera, the finder and the teams' counts read them): the
      // colour's own note, bright, with its triad struck over it – the last one with the chord as the ring opens
      const matches = log.filter((l) => l.event.type === "gap");
      expect(matches.length).toBe(segments);
      matches.forEach((m, i) => {
        const note = log.filter((l) => l.atMs === m.atMs && l.event.type === "hit");
        expect(note.length).toBe(1);
        expect([note[0].event.loop, note[0].event.loopBright]).toEqual(["pluck", true]);
        if (i === matches.length - 1) return;
        expect(m.event.loop).toBe("impact");
        const chord = m.event.chord!;
        expect(chord.length).toBe(3);
        expect(chord[0]).toBe(note[0].event.frequency);
        expect(chord[1]).toBeGreaterThan(chord[0]);
        expect(chord[2]).toBeGreaterThan(chord[1]);
      });
      const last = matches[matches.length - 1];
      expect([last.event.loop, last.event.frequency]).toEqual(["chord", RING_CHORD_HZ]);
      expect(log.filter((l) => l.event.loop === "chord").length).toBe(1);
      // one "hit" a bounce, never two: the modes swap the sound an event makes, not how many there are
      const hitsAt = new Map<number, number>();
      for (const l of log) if (l.event.type === "hit") hitsAt.set(l.atMs, (hitsAt.get(l.atMs) ?? 0) + 1);
      expect(Math.max(...hitsAt.values())).toBe(1);
      // a bounce that turns the ball plays one of the colours' notes
      const notes = new Set(Array.from({ length: colours }, (_, k) => Math.round(colourNoteHz(k))));
      const turns = log.filter((l) => l.event.loop === "pluck" && l.event.level === 0.6);
      expect(turns.length).toBeGreaterThan(0);
      for (const t of turns) expect(notes.has(Math.round(t.event.frequency!))).toBe(true);
      // every segment says when it broke, for the canvas' burst
      for (const seg of engine.getColorMatchSegments()) expect(seg.brokenMs).toBeGreaterThan(0);
    }
  });

  it("starts every segment unbroken, with no time of its break", () => {
    const engine = engineOf("colorMatch", 9);
    engine.update(1000 / 60, 0);
    for (const seg of engine.getColorMatchSegments()) expect([seg.broken, seg.brokenMs]).toEqual([false, -1]);
  });
});

describe("Accumulation's voice", () => {
  /** A default run that freezes at least three balls in 14 s (the first seed of 40 that does), with its sound events. */
  function freezingRun(patch: Partial<SimulatorSettings> = {}): { log: Logged[]; engine: PhysicsEngine } {
    for (let seed = 1; seed <= 40; seed++) {
      const engine = engineOf("accumulation", seed, patch);
      const log: Logged[] = [];
      let t = 0;
      while (t < 14000 && !engine.isSimulationFinished()) {
        engine.update(1000 / 60, 0);
        t += 1000 / 60;
        for (const event of engine.consumeSoundEvents()) log.push({ atMs: t, event });
      }
      if (engine.getFrozenBalls().length >= 3 && !engine.isSimulationFinished()) return { log, engine };
    }
    throw new Error("no seed of 40 froze three balls in 14 s");
  }

  it("plucks every bounce higher as the ball's timer runs down, and starts low again with the next ball", () => {
    const { log, engine } = freezingRun();
    const timerMs = engine.getAccumulationTimerMax();
    // every sound is the mode's own: a pluck off the ring, a plink off a frozen ball, or a freeze's thump
    for (const l of log) expect([l.event.type, l.event.loop === "pluck" || l.event.loop === "land"], `at ${l.atMs}`).toEqual(["hit", true]);
    const ring = log.filter((l) => l.event.loop === "pluck" && !l.event.loopBright);
    expect(ring.length).toBeGreaterThan(8);
    // inside one ball's life the pitch never falls, and it is the timer's own note
    for (let life = 0; life < 3; life++) {
      const notes = ring.filter((l) => Math.floor((l.atMs - 1) / timerMs) === life).map((l) => l.event.frequency!);
      for (let i = 1; i < notes.length; i++) expect(notes[i], `life ${life}`).toBeGreaterThanOrEqual(notes[i - 1]);
    }
    const early = ring.filter((l) => l.atMs < 0.3 * timerMs).map((l) => l.event.frequency!);
    const late = ring.filter((l) => l.atMs > 0.75 * timerMs && l.atMs < timerMs).map((l) => l.event.frequency!);
    if (early.length > 0 && late.length > 0) expect(Math.min(...late)).toBeGreaterThan(Math.max(...early));
    for (const l of ring.filter((x) => x.atMs < timerMs)) expect(l.event.frequency!).toBeCloseTo(timerPluckHz(timerMs - l.atMs, timerMs), 6);
    // a timer's freeze is heard: one thump per frozen ball, at the step it froze, a step lower each time, the crack over it
    const thumps = log.filter((l) => l.event.loop === "land");
    expect(thumps.length).toBe(engine.getFrozenBalls().length);
    thumps.forEach((t, n) => {
      expect(t.event.frequency!).toBeCloseTo(freezeThumpHz(n), 9);
      expect(log.some((l) => l.atMs === t.atMs && l.event.loop === "pluck" && l.event.loopBright && l.event.frequency === icePlinkHz(n))).toBe(true);
    });
    // every frozen ball knows when it froze, for the canvas' frost burst – the step its thump sounds
    // (a timer's freeze: a frame's time may pass a timer's end, so ball n froze within n + 1 frames of n + 1 timers)
    engine.getFrozenBalls().forEach((b, n) => {
      expect(Math.abs(b.atMs - (n + 1) * timerMs)).toBeLessThan(17 * (n + 2));
      expect(Math.abs(thumps[n].atMs - b.atMs)).toBeLessThan(17);
    });
  });

  it("thumps and cracks where a spike freezes a ball, plinks off the ice and resolves the way out on the chord", () => {
    const spiked = freezingRun({ spikesEnabled: true, spikeCount: 12 });
    const thumps = spiked.log.filter((l) => l.event.loop === "land");
    expect(thumps.length).toBeGreaterThan(0);
    thumps.forEach((t) => expect(spiked.log.some((l) => l.atMs === t.atMs && l.event.loop === "pluck" && l.event.loopBright)).toBe(true));
    for (let i = 1; i < thumps.length; i++) expect(thumps[i].event.frequency!).toBeLessThan(thumps[i - 1].event.frequency!);
    // an escape (the first seed of 12 that gets out): one "gap" event, the completion chord
    for (let seed = 1; seed <= 12; seed++) {
      const run = runOf(engineOf("accumulation", seed), 40);
      if (!run.finished) continue;
      const gaps = run.log.filter((l) => l.event.type === "gap");
      expect(gaps.length).toBe(1);
      expect([gaps[0].event.loop, gaps[0].event.frequency]).toEqual(["chord", RING_CHORD_HZ]);
      return;
    }
    throw new Error("no seed of 12 got out in 40 s");
  });

  it("starts over clean: a new run has no frozen balls and a full timer", () => {
    const engine = engineOf("accumulation", 3);
    for (let i = 0; i < 400; i++) engine.update(1000 / 60, 0);
    expect(engine.getFrozenBalls().length).toBeGreaterThan(0);
    engine.setSeed(3);
    engine.initAccumulation();
    expect(engine.getFrozenBalls().length).toBe(0);
    expect(engine.getAccumulationTimer()).toBe(engine.getAccumulationTimerMax());
  });
});

describe("Classic's voice", () => {
  it("stays what it was by default, with the ring sounds a switch away: a pluck per bounce, a rising step per ring, the chord at the way out", () => {
    // (the bot's ring recipes run Classic on the page's defaults, and their measured runs are the crew's eval corpus)
    expect(defaultSettings("classic").ringSound).toBe(false);
    const engine = engineOf("classic", 5, { ringSound: true });
    const rings = engine.getCircularWalls().length;
    const { log, finished } = runOf(engine);
    expect(finished).toBe(true);
    const steps = log.filter((l) => l.event.loop === "step");
    expect(steps.length).toBe(rings);
    for (let i = 1; i < steps.length; i++) expect(steps[i].event.frequency!).toBeGreaterThan(steps[i - 1].event.frequency!);
    expect(log.filter((l) => l.event.loop === "chord").length).toBe(1);
    const bounces = log.filter((l) => l.event.type === "hit" && l.event.loop !== "step" && l.event.loop !== "chord");
    for (const b of bounces) expect(b.event.loop).toBe("pluck");
  });
});

describe("Classic's plain tone (--- ring-looks ---)", () => {
  it("counts the engine's wall tone from the outermost ring in: the innermost ring low, the way out high", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => classicToneHz(i, 7))).toEqual([6, 5, 4, 3, 2, 1, 0].map(wallHitFrequency));
    expect(classicToneHz(0, 7)).toBe(320);
    expect(classicToneHz(6, 7)).toBe(800);
    expect(classicToneHz(0, 1)).toBe(800);
    // a hundred rings: the outer seven climb, the inner ones rest on the tone's floor; nonsense stays in range
    expect(classicToneHz(99, 100)).toBe(800);
    expect(classicToneHz(0, 100)).toBe(300);
    for (const [i, n] of [[-3, 7], [50, 7], [Number.NaN, 7], [2, 0], [2, Number.NaN]]) expect(classicToneHz(i, n)).toBeGreaterThanOrEqual(300);
  });

  it("plays one plain hit per bounce as before, a melody's note on it, its pitch climbing ring by ring towards the way out", () => {
    const engine = engineOf("classic", 5, { gapSize: 1, ballSpeed: 500 });
    const rings = engine.getCircularWalls().length;
    const { log, finished } = runOf(engine, 60);
    expect(finished).toBe(true);
    const hits = log.filter((l) => l.event.type === "hit");
    expect(hits.length).toBeGreaterThan(20);
    for (const { event } of hits) {
      expect(event.loop).toBeUndefined();
      expect(event.melody).toBeUndefined(); // still a note of a loaded melody
      expect(event.frequency).toBe(classicToneHz(event.wallIndex, rings));
    }
    // the ring the ball is in rises as the rings break: the run's first bounces low, its last ones high
    const first = hits[0].event.frequency!;
    const last = hits[hits.length - 1].event.frequency!;
    expect(last).toBeGreaterThan(first);
    for (let i = 1; i < hits.length; i++) if (hits[i].event.wallIndex > hits[i - 1].event.wallIndex) expect(hits[i].event.frequency!).toBeGreaterThan(hits[i - 1].event.frequency!);
  });
});

// --- ring-voices --- (review fix B2) the visitor's own sound, the extras the crew does not count, Color Match's spread hues
describe("a visitor's own sound (review fix B2)", () => {
  /** A fake tone generator: what the fast export's dispatcher asks of it. */
  function sink(own: boolean) {
    const calls: string[] = [];
    const audio = {
      hasOwnSound: () => own,
      playLoop: (kind: string) => calls.push(`loop:${kind}`),
      playWallHit: (_w: number, frequency?: number, _a?: boolean, _c?: unknown, _l?: number, melody = true) => calls.push(`hit:${frequency === undefined ? "plain" : "pitched"}:${melody ? "melody" : "accompaniment"}`),
      playGapPass: () => calls.push("gap"),
      playMultiplier: () => calls.push("multiplier"),
      playInteraction: () => calls.push("interaction"),
    };
    return { calls, audio: audio as unknown as Parameters<typeof playSoundEvent>[0] };
  }

  it("plays a Countdown bounce as a plain hit with the melody's note, and a right hit still breaks with the face's reaction", () => {
    const { log } = runOf(engineOf("target", 7), 30);
    const events = log.map((l) => l.event);
    expect(events.length).toBeGreaterThan(10);
    expect(events.every((e) => e.ringVoice === "contact")).toBe(true);
    const own = sink(true);
    let breaks = 0;
    for (const ev of events) playSoundEvent(own.audio, ev, () => breaks++);
    // event for event: a bounce is a plain hit that uses up a melody note (the song slicer and the sample take it there), a
    // right hit's break the plain break, the wall-break clip and the face's wide eyes
    expect(own.calls.filter((c) => c.startsWith("loop:"))).toEqual([]);
    expect(own.calls.filter((c) => c.startsWith("hit:")).every((c) => c === "hit:plain:melody")).toBe(true);
    expect(own.calls.filter((c) => c.startsWith("hit:")).length).toBe(events.filter((e) => e.type === "hit").length);
    expect(own.calls.filter((c) => c === "gap").length).toBe(events.filter((e) => e.type === "gap").length);
    expect(breaks).toBe(events.filter((e) => e.type === "gap").length);
    expect(breaks).toBeGreaterThan(0);
    // without a sound of the visitor's own: the mode's voices, as before
    const plain = sink(false);
    for (const ev of events) playSoundEvent(plain.audio, ev, () => {});
    expect(plain.calls.every((c) => c.startsWith("loop:"))).toBe(true);
    expect(plain.calls.length).toBe(events.length);
  });

  it("leaves Accumulation's freeze out under a visitor's own sound, and the crew's measured moment never counts it", () => {
    const { log } = runOf(engineOf("accumulation", 3), 30);
    const extras = log.filter((l) => l.event.ringVoice === "extra");
    expect(extras.length).toBeGreaterThanOrEqual(2); // a timer's freeze: the thump and the crack, both extra
    expect(ringVoiceEvent(extras[0].event, true)).toBeNull();
    expect(ringVoiceEvent(extras[0].event, false)).toBe(extras[0].event);
    const contact = log.find((l) => l.event.ringVoice === "contact")!.event;
    expect(ringVoiceEvent(contact, true)).toEqual({ type: contact.type, wallIndex: contact.wallIndex });
    const unmarked: SoundEvent = { type: "hit", wallIndex: 0 };
    expect(ringVoiceEvent(unmarked, true)).toBe(unmarked);
    // the moment around the first freeze counts the bounces alone
    const at = extras[0].atMs / 1000;
    const moment = payoffMomentSync(defaultSettings("accumulation"), 3, { width: 800, height: 450 }, at);
    const around = log.filter((l) => l.atMs / 1000 >= at - MOMENT_BEFORE_SEC - 1e-9 && l.atMs / 1000 <= at + MOMENT_AFTER_SEC + 1e-9);
    expect(moment.sounds).toBe(around.filter((l) => l.event.ringVoice !== "extra").length);
    expect(around.some((l) => l.event.ringVoice === "extra")).toBe(true);
  });
});

describe("Color Match's colours (review fix B2)", () => {
  it("spreads a few colours round the wheel – red, green and blue for three – and leaves seven as the palette", () => {
    expect([0, 1, 2].map((i) => colorMatchColorOf(i, 3).color)).toEqual([COLOR_MATCH_COLORS[0].color, COLOR_MATCH_COLORS[3].color, COLOR_MATCH_COLORS[4].color]);
    expect([0, 1].map((i) => colorMatchColorOf(i, 2).color)).toEqual([COLOR_MATCH_COLORS[0].color, COLOR_MATCH_COLORS[4].color]);
    for (const count of [2, 3, 4, 5, 6]) {
      const hues = Array.from({ length: count }, (_, i) => colorMatchColorOf(i, count).hue);
      expect(new Set(hues).size).toBe(count);
      // no two neighbours closer than 60° on the wheel up to five colours
      if (count <= 5) for (let i = 1; i < count; i++) expect(hues[i] - hues[i - 1]).toBeGreaterThanOrEqual(60);
    }
    for (let i = 0; i < 9; i++) expect(colorMatchColorOf(i, 7)).toEqual(colorMatchColor(i));
  });

  it("paints the default ring and ball in those colours, the logic by index as before", () => {
    const engine = engineOf("colorMatch", 7);
    const segments = engine.getColorMatchSegments();
    expect(new Set(segments.map((s) => s.color))).toEqual(new Set(["#ef4444", "#22c55e", "#3b82f6"]));
    for (const s of segments) expect(s.color).toBe(colorMatchColorOf(s.colorIndex, 3).color);
    expect(["#ef4444", "#22c55e", "#3b82f6"]).toContain(engine.getColorMatchBallColor());
  });
});

describe("the page's start look (review fix B2)", () => {
  it("starts a bare studio visit and a mode picked on the page in Classic's Ring Ladder pace and Accumulation's quicker timer, never a link", () => {
    expect(clipStartSettings("classic")).toEqual({ gapSize: 1, ballSpeed: 500, screenShake: 0.3, showGlow: true, wallBreakStyle: "all", ringSound: true });
    expect(clipStartSettings("accumulation")).toEqual({ accumulationTime: 3, gapSize: 0.35, ballSpeed: 450, showGlow: true });
    expect(clipStartSettings("target")).toEqual({});
    // the link base is what it was: the start look is written into the page's own link
    const start = { ...defaultSettings("classic"), ...clipStartSettings("classic") } as SimulatorSettings;
    expect(settingsToSearchParams(start).toString()).toBe("mode=classic&s=500&gap=1&shake=0.3&glow=1&wbreak=all&resn=1");
    expect(settingsFromSearchParams(settingsToSearchParams(start))).toMatchObject(clipStartSettings("classic"));
    const bare = (q: string) => isBareStudioVisit(new URLSearchParams(q), settingsToSearchParams(settingsFromSearchParams(new URLSearchParams(q))).toString());
    expect(bare("")).toBe(true);
    expect(bare("utm_source=tiktok&lang=pl")).toBe(true);
    for (const q of ["mode=classic", "seed=12", "daily=2026-11-21", "c=q1bKzU9JVbJSSs5JLC7OTFbSUSpSstI1rQUA", "s=500", "gap=0.4&wc=3"]) expect(bare(q), q).toBe(false);
  });

  it("ends inside the clip: Classic's start look is out by 27 s on most seeds, where the link base never is", () => {
    let start = 0;
    let base = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const paced = runOf(engineOf("classic", seed, clipStartSettings("classic")), 27);
      if (paced.finished) start++;
      if (runOf(engineOf("classic", seed), 27).finished) base++;
    }
    expect(base).toBe(0);
    expect(start).toBeGreaterThanOrEqual(5);
  });
});
