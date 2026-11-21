import { describe, expect, it } from "vitest";
import { PORTAL_NOTES_HZ, PORTAL_THUD_HZ, PORTAL_ZIP_SEC } from "@/lib/physics/modes/portal";
import type { SoundEvent } from "@/lib/physics/types";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { ringVoiceEvent } from "@/lib/audio/loopEvents";
import { BEAM_MS, CRUMBLE_MS, drawPortalGhost, drawPortals } from "@/components/simulator/portalRenderer";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- portal-charges --- Portal's portals a phone sees and hears (lib/physics/modes/portal.ts, components/simulator/portalRenderer.ts):
 * a jump zips up from its portal's own note, a burnt-out portal thuds, the arpeggio is the escape's alone; the jump breaks the
 * ball's trail and is drawn as a beam between the twins; every portal shows its charges as pips; the run itself is untouched.
 */

const WORLD = { width: 450, height: 450 } as const;
function engineOf(seed: number) {
  const s = defaultSettings("portal") as SimulatorSettings;
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
