import { describe, expect, it } from "vitest";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { DROP_ARP_STEP_MS, DROP_CYCLE_LEVEL, DROP_CYCLE_STEP_MS, DROP_LOCK_LEVEL, DROP_LOCK_MS, DROP_SETTLED_HZ, dropArpAtMs, dropArpChordAtMs, dropBallColor, dropCycleAtMs, dropHitFrequency } from "@/lib/physics/modes/drop";
import { DROP_CHORD_RING_MS, DROP_FINALE_RING_GROW, DROP_FINALE_RING_WIDTH, dropBannerAt, dropLitAlpha, drawDropFinale, drawDropLit, DROP_LIT_FRESH_MS } from "@/components/simulator/dropRenderer";
import { fakeCanvas } from "./fakeCanvas";
import type { SoundEvent } from "@/lib/physics/types";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder";

/*
 * --- drop-lights --- (Lane E, E6) Ball Drop lights up and ends on a finale (lib/physics/modes/drop.ts, components/simulator/
 * dropRenderer.ts): every ball takes its note's colour on a plain board, every peg and bar a ball hits keeps a glow in that
 * ball's colour, a ball that comes to rest clicks into place once, the board then plays the balls' notes low to high round and
 * round until SETTLED!, and from SETTLED! once more, fast, into the completion chord. All of it sound and drawing: the run, its
 * length and its fingerprint are the same.
 */

const WORLD = { width: 800, height: 450 };

function engineOf(seed: number, patch: Record<string, unknown> = {}): PhysicsEngine {
  const s = { ...defaultSettings("drop"), ...patch } as ReturnType<typeof defaultSettings>;
  const f = finderRequestOfSettings(s, WORLD, 60);
  return createEngineForSettings(f.physicsConfig, f.mode, f.modeSettings, seed) as PhysicsEngine;
}

/** Runs to the settle and 2 s past it: every sound with its simulation ms. */
function runToEnd(e: PhysicsEngine): { ms: number; ev: SoundEvent }[] {
  const out: { ms: number; ev: SoundEvent }[] = [];
  let settled = -1;
  for (let frame = 0; frame < 60 * 60; frame++) {
    e.update(1000 / 60, 0);
    for (const ev of e.consumeSoundEvents()) out.push({ ms: e.getElapsedMs(), ev });
    if (settled < 0 && e.isSimulationFinished()) settled = e.getElapsedMs();
    if (settled >= 0 && e.getElapsedMs() > settled + 2000) break;
  }
  return out;
}

describe("Ball Drop's colours and lights", () => {
  it("colours a ball on a plain board by its note, low red to high violet, and keeps a colour the visitor chose", () => {
    const big = dropBallColor(1.375, 0.5, "#FFFFFF");
    const mid = dropBallColor(1, 0.5, "#ffffff");
    const small = dropBallColor(0.625, 0.5, undefined);
    for (const c of [big, mid, small]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set([big, mid, small]).size).toBe(3);
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (60 * h + 360) % 360;
    };
    expect(hue(big)).toBeLessThan(30); // the biggest ball, the lowest note: red
    expect(hue(small)).toBeGreaterThan(240); // the smallest, the highest: violet
    expect(dropBallColor(1.2, 0.5, "#fff0f3")).toBe("#fff0f3"); // the Marimba Pachinko card's own colour
    // on the page: the balls of a plain run wear their note's colour, and a colour change paints them back the same way
    const e = engineOf(1);
    for (let i = 0; i < 120; i++) e.update(1000 / 60, 0);
    const balls = e.getBalls();
    expect(balls.length).toBeGreaterThan(2);
    for (const b of balls) expect(b.color).toBe(dropBallColor(b.radiusScale ?? 1, 0.5, "#FFFFFF"));
    e.setConfig({ ballColor: "#22c55e" });
    for (const b of e.getBalls()) expect(b.color).toBe("#22c55e");
    e.setConfig({ ballColor: "#FFFFFF" });
    for (const b of e.getBalls()) expect(b.color).toBe(dropBallColor(b.radiusScale ?? 1, 0.5, "#FFFFFF"));
  });

  it("lights every peg and bar a ball hits in that ball's colour, never the walls, and keeps it lit", () => {
    const e = engineOf(2);
    for (let i = 0; i < 60 * 6; i++) e.update(1000 / 60, 0);
    const v = e.getDropView();
    expect(v.wallCount).toBe(3);
    const lit = [...v.litMs].map((ms, i) => ({ ms, i })).filter((x) => x.ms >= 0);
    expect(lit.length).toBeGreaterThan(10);
    for (const { i } of lit) {
      expect(i).toBeGreaterThanOrEqual(v.wallCount);
      expect(v.litColor[i]).toMatch(/^#[0-9a-f]{6}$/);
    }
    // a fresh hit glows bright, then settles to its lasting glow, which never goes out
    expect(dropLitAlpha(0)).toBeGreaterThan(dropLitAlpha(DROP_LIT_FRESH_MS));
    expect(dropLitAlpha(DROP_LIT_FRESH_MS)).toBe(dropLitAlpha(60_000));
    expect(dropLitAlpha(60_000)).toBeGreaterThan(0);
    expect(dropLitAlpha(-1)).toBe(0);
  });

  it("puts SETTLED! in the strip above the first row of pegs", () => {
    const e = engineOf(1);
    const layout = e.getDropLayout()!;
    const at = dropBannerAt(layout, e.getDropView().wallCount, WORLD.width, WORLD.height)!;
    const side = Math.min(WORLD.width, WORLD.height);
    const firstRowTop = Math.min(...layout.obstacles.slice(3).map((o) => (o.kind === "circle" ? o.y - o.radius : o.y)));
    // the middle of the strip between the square's top margin and the first row (above the board's middle third)
    expect(at * side).toBeCloseTo((0.02 * side + firstRowTop) / 2, 6);
    expect(at).toBeLessThan(0.15);
  });
});

describe("Ball Drop's finale", () => {
  it("clicks each ball into place once as it comes to rest, then plays the notes round until SETTLED!, then once more fast into the chord", () => {
    for (const seed of [1, 7]) {
      const e = engineOf(seed);
      const sounds = runToEnd(e);
      const v = e.getDropView();
      const n = e.getBalls().length;
      expect(v.settledMs).toBeGreaterThan(0);
      const extra = sounds.filter((x) => x.ev.ringVoice === "extra");
      // every extra sound is a note of the balls or the chord, and nothing of the run's contacts follows the settle
      expect(sounds.filter((x) => x.ms > v.settledMs && x.ev.ringVoice !== "extra")).toEqual([]);
      // the clicks: one per ball, at its own pitch, softly, before the settle
      const clicks = extra.filter((x) => x.ev.level === DROP_LOCK_LEVEL);
      expect(clicks).toHaveLength(n);
      expect(v.lockMs.size).toBe(n);
      for (const c of clicks) expect(c.ms).toBeLessThanOrEqual(v.settledMs);
      expect(clicks.map((c) => c.ev.frequency).sort()).toEqual(e.getBalls().map((b) => dropHitFrequency(b.radius)).sort());
      // the cycle: from the last click, the notes low to high, DROP_CYCLE_STEP_MS apart, up to the settle
      const order = v.arpHz;
      expect(order).toHaveLength(n);
      for (let k = 1; k < n; k++) expect(order[k]).toBeGreaterThanOrEqual(order[k - 1]);
      const cycle = extra.filter((x) => x.ev.level === DROP_CYCLE_LEVEL);
      if (v.cycleFromMs >= 0) {
        expect(cycle.length).toBe(v.cyclePlayed);
        cycle.forEach((x, j) => {
          expect(x.ev.frequency).toBe(order[j % n]);
          expect(x.ms).toBeLessThanOrEqual(v.settledMs);
          expect(x.ms - v.cycleFromMs).toBeGreaterThanOrEqual(dropCycleAtMs(j) - 1e-6);
          expect(x.ms - v.cycleFromMs).toBeLessThan(dropCycleAtMs(j) + 1000 / 60 + 1e-6);
        });
      }
      // the finale: every ball's note once more from the settle, DROP_ARP_STEP_MS apart, the last accented, then the chord
      const finale = extra.filter((x) => x.ev.level === undefined && x.ev.loop !== "chord");
      expect(finale.map((x) => x.ev.frequency)).toEqual(order);
      finale.forEach((x, k) => {
        expect(x.ms - v.settledMs).toBeGreaterThanOrEqual(dropArpAtMs(k) - 1e-6);
        expect(x.ms - v.settledMs).toBeLessThan(dropArpAtMs(k) + 1000 / 60 + 1e-6);
      });
      expect(finale[n - 1].ev.accent).toBe(true);
      const chord = extra.filter((x) => x.ev.loop === "chord");
      expect(chord.map((x) => x.ev.frequency)).toEqual([DROP_SETTLED_HZ]);
      expect(chord[0].ms - v.settledMs).toBeGreaterThanOrEqual(dropArpChordAtMs(n) - 1e-6);
      // the chord rings well inside the 2 s the clip holds after SETTLED! (the canvas' hold and the recorder's stop)
      expect(dropArpChordAtMs(n)).toBeLessThan(1200);
      // never more than about a second and a half without a sound from the first hit to the chord
      let last = sounds[0].ms;
      let gap = 0;
      for (const x of sounds) {
        if (x.ms > chord[0].ms) break;
        gap = Math.max(gap, x.ms - last);
        last = x.ms;
      }
      expect(gap).toBeLessThan(1500);
    }
    expect(DROP_ARP_STEP_MS).toBeLessThan(DROP_CYCLE_STEP_MS);
    expect(DROP_LOCK_MS).toBeLessThan(1000);
  }, 60_000);

  it("leaves the run itself as it was: the same settle on every seed", () => {
    // the settle times of the default board before the finale existed (the start look, the laptop world)
    const before: Record<number, number> = { 1: 14.55, 2: 16.58, 3: 14.55, 7: 14.55, 9: 13.53 };
    for (const [seed, sec] of Object.entries(before)) {
      const e = engineOf(Number(seed));
      for (let frame = 0; frame < 60 * 40 && !e.isSimulationFinished(); frame++) e.update(1000 / 60, 0);
      expect([seed, Math.round(e.getElapsedMs() / 10) / 100]).toEqual([seed, sec]);
    }
  }, 60_000);
});

// --- drop-chord-flash --- (Lane E, E6 review) the finale was heard more than seen: thin rings 1.6 radii out round balls about 2 % of
// the frame, and at the chord the frame looked as it did a second before
describe("Ball Drop's chord, seen", () => {
  /** One draw call's record: what was filled or stroked, at which opacity and line width, and every arc's radius. */
  function recorder() {
    const canvas = fakeCanvas(WORLD.width, WORLD.height);
    const ctx = canvas.ctx;
    const fills: number[] = [];
    const strokes: { alpha: number; width: number }[] = [];
    const arcs: number[] = [];
    const fill = ctx.fill as (...a: unknown[]) => void;
    ctx.fill = (...a: unknown[]) => {
      fills.push(ctx.globalAlpha);
      return fill(...a);
    };
    const stroke = ctx.stroke as (...a: unknown[]) => void;
    ctx.stroke = (...a: unknown[]) => {
      strokes.push({ alpha: ctx.globalAlpha, width: ctx.lineWidth });
      return stroke(...a);
    };
    const arc = ctx.arc as (...a: unknown[]) => void;
    ctx.arc = (...a: unknown[]) => {
      arcs.push(a[2] as number);
      return arc(...a);
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, strokes, arcs };
  }

  it("flashes the whole lit board back to its fresh glow at the chord, and every ball rings with it", () => {
    const e = engineOf(7);
    runToEnd(e);
    const v = e.getDropView();
    const n = v.arpIds.length;
    expect(v.chordPlayed).toBe(true);
    expect(v.chordMs - v.settledMs).toBeGreaterThanOrEqual(dropArpChordAtMs(n) - 1e-6);
    expect(v.chordMs - v.settledMs).toBeLessThan(dropArpChordAtMs(n) + 1000 / 60 + 1e-6);
    const obstacles = e.getDropLayout()!.obstacles;
    const lit = [...v.litMs].filter((ms, i) => i >= v.wallCount && i < obstacles.length && ms >= 0).length;
    expect(lit).toBeGreaterThan(10);
    // the outermost glow layer of every lit peg and bar: its lasting opacity just before the chord (most of them), the fresh one at it (all)
    const outerAt = (timeMs: number) => {
      const r = recorder();
      drawDropLit(r.ctx, { ...v, timeMs }, obstacles, 4);
      return [...r.fills, ...r.strokes.map((x) => x.alpha)].filter((_, i) => i % 3 === 0);
    };
    const lasting = 0.12;
    const fresh = Math.min(1, (lasting * dropLitAlpha(0)) / dropLitAlpha(60_000));
    const before = outerAt(v.chordMs - 1);
    const at = outerAt(v.chordMs);
    expect(before.filter((a) => Math.abs(a - lasting) < 1e-9).length).toBeGreaterThan(lit / 2);
    expect(at).toHaveLength(lit);
    for (const a of at) expect(a).toBeCloseTo(fresh, 9);
    // every ball rings at the chord, growing several ball widths out with a burst of sparks
    const balls = e.getBalls();
    const mid = recorder();
    drawDropFinale(mid.ctx, { ...v, timeMs: v.chordMs + DROP_CHORD_RING_MS / 2 }, balls);
    for (const b of balls) expect(mid.arcs.some((r) => Math.abs(r - b.radius * (1.2 + DROP_FINALE_RING_GROW / 2)) < 1e-6)).toBe(true);
    const gone = recorder();
    drawDropFinale(gone.ctx, { ...v, timeMs: v.chordMs + DROP_CHORD_RING_MS + 1 }, balls);
    expect(gone.arcs).toEqual([]);
  }, 60_000);

  it("rings each ball's note of the finale several ball widths out, thick, three times the old ring's reach", () => {
    // the old ring grew 1.6 radii past 1.2 and was 0.35 radii thick: the new one's reach × thickness, at least three times that
    expect((1.2 + DROP_FINALE_RING_GROW) * DROP_FINALE_RING_WIDTH).toBeGreaterThanOrEqual(3 * (1.2 + 1.6) * 0.35);
    expect(DROP_FINALE_RING_WIDTH).toBeGreaterThanOrEqual(0.5);
    const e = engineOf(1);
    runToEnd(e);
    const v = e.getDropView();
    const ball = e.getBalls().find((b) => b.id === v.arpIds[0])!;
    // the lowest ball's note, half way through its flash (before the chord's own ring)
    const r = recorder();
    drawDropFinale(r.ctx, { ...v, chordMs: -1, timeMs: v.settledMs + dropArpAtMs(0) + 210 }, [ball]);
    expect(Math.max(...r.arcs)).toBeCloseTo(ball.radius * (1.2 + DROP_FINALE_RING_GROW * 0.5), 6);
    // its burst: eight sparks in one stroke beside the ring's
    expect(r.strokes.length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
