import { describe, expect, it } from "vitest";
import { PORTAL_COUNT_CHOICES, PORTAL_MAX_PAIRS, PORTAL_NOTES_HZ, PORTAL_THUD_HZ, PORTAL_USES_CHOICES, PORTAL_ZIP_SEC } from "@/lib/physics/modes/portal";
import type { SoundEvent } from "@/lib/physics/types";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { clipStartSettings } from "@/lib/clipPacing";
import { ringVoiceEvent } from "@/lib/audio/loopEvents";
import { BEAM_MS, CRUMBLE_MS, WASH_SWELL_MS, drawPortalGhost, drawPortals, lastLivePair, washSwell } from "@/components/simulator/portalRenderer";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- portal-charges --- Portal's portals a phone sees and hears (lib/physics/modes/portal.ts, components/simulator/portalRenderer.ts):
 * a jump zips up from its portal's own note, a burnt-out portal thuds, the arpeggio is the escape's alone; the jump breaks the
 * ball's trail and is drawn as a beam between the twins; every portal shows its charges as pips; the run itself is untouched.
 */

const WORLD = { width: 450, height: 450 } as const;
function engineOf(seed: number, patch: Partial<SimulatorSettings> = {}) {
  const s = { ...defaultSettings("portal"), ...patch } as SimulatorSettings;
  return createEngineForSettings(physicsConfigOfSettings(s, WORLD as never), "portal", modeSettingsOfSettings(s), seed);
}

/** Runs a seed to its escape (or 40 s), logging the sounds and the trail's length right after each jump. */
function runToEnd(seed: number) {
  const e = engineOf(seed);
  const log: { t: number; e: SoundEvent }[] = [];
  const trailAfterJump: number[] = [];
  let jumps = 0;
  for (let k = 0; k < 40 * 60 && !e.isSimulationFinished(); k++) {
    e.update(1000 / 60, 0);
    for (const ev of e.consumeSoundEvents()) log.push({ t: e.getElapsedMs() / 1000, e: ev });
    if (e.getPortalTeleportCount() > jumps) {
      jumps = e.getPortalTeleportCount();
      trailAfterJump.push(e.getBalls()[0].trail.length);
    }
  }
  return { e, log, trailAfterJump };
}

describe("Portal: its own sounds and the jump (portal-charges)", () => {
  it("zips up from the portal's note on a jump, thuds on a burn-out and keeps the arpeggio for the escape", () => {
    const { e, log, trailAfterJump } = runToEnd(3);
    expect(e.hasPortalEscaped()).toBe(true);
    const zips = log.filter((x) => x.e.loop === "glide");
    expect(zips).toHaveLength(e.getPortalTeleportCount());
    for (const z of zips) {
      expect(PORTAL_NOTES_HZ).toContain(z.e.frequency);
      expect([z.e.type, z.e.loopTo, z.e.loopSec, z.e.ringVoice]).toEqual(["gap", 2 * z.e.frequency!, PORTAL_ZIP_SEC, "contact"]);
      // a visitor's own sound plays the plain break a jump always was
      expect(ringVoiceEvent(z.e, true)).toEqual({ type: "gap", wallIndex: 0 });
    }
    // the jumps on the last portal used are its own note
    const jump = e.getPortalLastJump();
    expect(zips[zips.length - 1].e.frequency).toBe(PORTAL_NOTES_HZ[jump.portal]);
    const thuds = log.filter((x) => x.e.loop === "land");
    const burnt = e.getPortals().filter((p) => p.exhausted);
    expect(thuds).toHaveLength(burnt.length);
    expect(thuds.every((x) => x.e.frequency === PORTAL_THUD_HZ && x.e.ringVoice === "extra")).toBe(true);
    for (const p of burnt) expect(p.burnMs).toBeGreaterThan(0);
    // the arpeggio: the plain breaks are the escape's alone (the ball through the exit, then out of the ring), none before it
    const plain = log.filter((x) => x.e.type === "gap" && !x.e.loop);
    expect(plain.length).toBeGreaterThanOrEqual(1);
    expect(plain.every((x) => x.t > zips[zips.length - 1].t && e.getElapsedMs() / 1000 - x.t < 0.5)).toBe(true);
    expect(plain[plain.length - 1].t).toBeCloseTo(e.getElapsedMs() / 1000, 6);
    expect(e.getPortalEscapedMs()).toBeCloseTo(e.getElapsedMs(), 6);
    // a bounce off the ring plucks the key under it (a contact); the engine's plain hit is heard only under a jump's zip
    const plucks = log.filter((x) => x.e.loop === "pluck");
    expect(plucks.length).toBeGreaterThan(5);
    expect(plucks.every((x) => x.e.ringVoice === "contact" && x.e.melody === false)).toBe(true);
    const zipAt = new Set(zips.map((z) => z.t));
    expect(log.filter((x) => x.e.type === "hit" && !x.e.loop).every((x) => zipAt.has(x.t))).toBe(true);
    // the trail is broken at every jump: no streak across the ring
    expect(trailAfterJump.length).toBe(e.getPortalTeleportCount());
    expect(trailAfterJump.every((n) => n <= 1)).toBe(true);
  });

  it("replays a seed and keeps every jump where it was (the sounds and the drawing only)", () => {
    const a = engineOf(5);
    const b = engineOf(5);
    for (let k = 0; k < 20 * 60; k++) {
      a.update(1000 / 60, 0);
      b.update(1000 / 60, 0);
      expect(b.consumeSoundEvents()).toEqual(a.consumeSoundEvents());
    }
    expect(b.getBalls().map((x) => [x.x, x.y])).toEqual(a.getBalls().map((x) => [x.x, x.y]));
    expect(b.getPortalTeleportCount()).toBe(a.getPortalTeleportCount());
  });
});

describe("Portal: the portals drawn (portal-charges)", () => {
  it("draws each portal's charges, a jump's beam, a burnt-out pair crumbling and the ghosted ring after the escape", () => {
    const { e } = runToEnd(3);
    const portals = e.getPortals();
    const jump = e.getPortalLastJump();
    const o = { cx: 225, cy: 225, radius: e.getCircularWalls()[0].radius, nowMs: jump.ms + 10, wallThickness: 3 };
    const ctx = fakeCanvas(450, 450).getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
    drawPortals(ctx, portals, jump, o);
    const live = portals.filter((p) => !p.exhausted);
    // the pips: a filled one per charge left on both mouths of every live portal (with the swirls' fills and the beam's)
    const left = live.reduce((n, p) => n + 2 * (p.maxUses - p.uses), 0);
    expect(ctx.calls.filter((c) => c.name === "fill").length).toBeGreaterThanOrEqual(left + 2 * 2 * live.length);
    // the beam: a line from the mouth the ball went in at to its twin, drawn only for BEAM_MS
    const late = fakeCanvas(450, 450).getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
    drawPortals(late, portals, jump, { ...o, nowMs: jump.ms + BEAM_MS + CRUMBLE_MS + 1 });
    expect(late.calls.filter((c) => c.name === "lineTo").length).toBeLessThan(ctx.calls.filter((c) => c.name === "lineTo").length);
    // after the escape: the ring in arcs between the open exits
    const ghost = fakeCanvas(450, 450).getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
    drawPortalGhost(ghost, portals, o, "#ffffff");
    const burnt = portals.filter((p) => p.exhausted).length;
    expect(ghost.calls.filter((c) => c.name === "arc").length).toBe(2 * burnt + 2 * live.length);
  });
});

// --- portal-options --- --- portal-fill --- (D3 review)
describe("Portal: Portals and Jumps per Portal, its start look and the filled arena (D3 review)", () => {
  it("lays out the pairs and the jumps a link asks for, keeps the link base's three pairs of four, and never more pairs than fit", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mode=portal&ptc=5&ptu=3"));
    expect([s.ptCount, s.ptUses]).toEqual([5, 3]);
    const link = settingsToSearchParams(s);
    expect([link.get("ptc"), link.get("ptu")]).toEqual(["5", "3"]);
    const base = settingsToSearchParams(defaultSettings("portal"));
    expect([base.has("ptc"), base.has("ptu")]).toEqual([false, false]);
    // picks, as Shatter's are: anything else is the mode's own
    for (const pick of PORTAL_COUNT_CHOICES) expect(settingsFromSearchParams(new URLSearchParams(`mode=portal&ptc=${pick}`)).ptCount).toBe(pick);
    for (const pick of PORTAL_USES_CHOICES) expect(settingsFromSearchParams(new URLSearchParams(`mode=portal&ptu=${pick}`)).ptUses).toBe(pick);
    expect(settingsFromSearchParams(new URLSearchParams("mode=portal&ptc=40&ptu=0"))).toMatchObject({ ptCount: 3, ptUses: 4 });
    expect(presetToSettings({ mode: "portal", ptCount: "many", ptUses: 2.5 } as never)).toMatchObject({ ptCount: 3, ptUses: 4 });
    expect(presetToSettings({ mode: "portal", ptCount: 8, ptUses: 1 })).toMatchObject({ ptCount: 8, ptUses: 1 });
    // the engine lays them out: five pairs of three jumps, the mouths as wide as ever
    const five = engineOf(1, { ptCount: 5, ptUses: 3 }).getPortals();
    expect(five.map((p) => [p.maxUses, p.halfWidth])).toEqual(Array.from({ length: 5 }, () => [3, 0.12]));
    // the link base: the mode's own three pairs of four (its run is the one tests/extras.test.ts pins)
    expect(engineOf(1).getPortals().map((p) => [p.maxUses, p.halfWidth])).toEqual([[4, 0.12], [4, 0.12], [4, 0.12]]);
    // the engine handed more pairs than fit round the ring (no setting offers them): PORTAL_MAX_PAIRS, the mouths narrower and apart
    const many = engineOf(1, { ptCount: 1e9 }).getPortals();
    expect(many).toHaveLength(PORTAL_MAX_PAIRS);
    expect(many[0].halfWidth).toBeLessThan(0.12);
    expect(2 * many[0].halfWidth).toBeLessThan((2 * Math.PI) / (2 * PORTAL_MAX_PAIRS));
  });

  it("starts the page on five pairs of three jumps: out inside the clip on more seeds than the link base", { timeout: 120_000 }, () => {
    expect(clipStartSettings("portal")).toEqual({ ptCount: 5, ptUses: 3 });
    const outBy27 = (patch: Partial<SimulatorSettings>) => {
      let n = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const e = engineOf(seed, patch);
        for (let k = 0; k < 27 * 60 && !e.isSimulationFinished(); k++) {
          e.update(1000 / 60, 0);
          e.consumeSoundEvents();
        }
        if (e.isSimulationFinished()) n++;
      }
      return n;
    };
    // measured when this was written: 10 of 12 (median 16.9 s), the link base 7 of 12 (median 26.3 s)
    const start = outBy27(clipStartSettings("portal"));
    expect(start).toBeGreaterThanOrEqual(9);
    expect(start).toBeGreaterThan(outBy27({}));
  });

  it("fills the arena: a wash in the last pair's colour that swells at a jump, the glowing ring, the last pair pulsing", () => {
    const { e } = runToEnd(3);
    const portals = e.getPortals();
    const jump = e.getPortalLastJump();
    expect(washSwell(jump, jump.ms)).toBe(1);
    expect(washSwell(jump, jump.ms + WASH_SWELL_MS / 2)).toBeCloseTo(0.25, 9);
    expect(washSwell(jump, jump.ms + WASH_SWELL_MS)).toBe(0);
    expect(washSwell({ ...jump, portal: -1 }, jump.ms)).toBe(0);
    const radius = e.getCircularWalls()[0].radius;
    const o = { cx: 225, cy: 225, radius, nowMs: jump.ms + 10, wallThickness: 2, gaps: [], ringStyle: "#ffffff" };
    const fresh = fakeCanvas(450, 450).getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
    drawPortals(fresh, portals, jump, o);
    const late = fakeCanvas(450, 450).getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
    drawPortals(late, portals, jump, { ...o, nowMs: jump.ms + WASH_SWELL_MS + 1 });
    const gradients = (c: typeof fresh) => c.calls.filter((x) => x.name === "createRadialGradient").length;
    // the wash in every frame, and the swell's front from the exit on top of it for WASH_SWELL_MS after a jump
    expect(gradients(late)).toBe(1);
    expect(gradients(fresh)).toBe(2);
    // a ring without exits is one whole circle from 0 (a turned full turn can stroke nothing in Chromium)
    expect(late.calls.some((x) => x.name === "arc" && x.args[2] === radius && x.args[3] === 0 && x.args[4] === 2 * Math.PI)).toBe(true);
    // the last pair standing pulses; two or more standing, or a single pair from the start, do not
    const twoLeft = portals.map((p, i) => ({ ...p, exhausted: i > 1 }));
    expect(lastLivePair(twoLeft)).toBe(-1);
    const oneLeft = portals.map((p, i) => ({ ...p, exhausted: i !== 1 }));
    expect(lastLivePair(oneLeft)).toBe(1);
    expect(lastLivePair([{ ...portals[0], exhausted: false }])).toBe(-1);
    const pulse = fakeCanvas(450, 450).getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
    drawPortals(pulse, oneLeft, jump, { ...o, nowMs: jump.ms + WASH_SWELL_MS + 1 });
    // the same pair drawn alone (no others burnt out round it) has no pulse: the pulse is its tie drawn bright (one solid line
    // between the twins) and a halo round each mouth (a fill and a stroke each)
    const solo = fakeCanvas(450, 450).getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
    drawPortals(solo, [oneLeft[1]], jump, { ...o, nowMs: jump.ms + WASH_SWELL_MS + 1 });
    const count = (c: typeof fresh, name: string) => c.calls.filter((x) => x.name === name).length;
    expect(count(pulse, "lineTo") - count(solo, "lineTo")).toBe(1);
    expect(count(pulse, "arc") - count(solo, "arc")).toBe(4);
  });
});
