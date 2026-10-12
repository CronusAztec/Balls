import { it } from "vitest";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import type { PhysicsConfig } from "@/lib/physics/types";
import { DEFAULT_HOOPS_SETTINGS, hoopsSchedule, resolveHoopsSettings, type HoopsSettings } from "@/lib/physics/modes/hoops";
const config: PhysicsConfig = { width: 800, height: 800, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const base: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
function measure(h: Partial<HoopsSettings>, seed: number) {
  const e = createEngineForSettings(config, "hoops", { ...base, hoops: h }, seed);
  const v = e.getHoopsView();
  const sc = v.schedule;
  const bars: number[] = []; const plucks: number[] = []; let lastPluck = 0;
  const frames = Math.round(sc.cycle * 60) + 10;
  for (let i = 0; i < frames; i++) { e.update(1000/60, 0); for (const ev of e.consumeSoundEvents()) { if (ev.loop === "bar") bars.push(ev.wallIndex); if (ev.loop === "pluck") { plucks.push(ev.wallIndex); lastPluck = e.getElapsedMs()/1000; } } }
  return { cycle: sc.cycle, allUp: v.firstAllUpMs / 1000 / sc.cycle, barsOk: bars.join() === "0,1,2,3,4,5,6,7", plucksOk: plucks.join() === "7,6,5,4,3,2,1,0", margin: sc.cycle - lastPluck };
}
it("probe", { timeout: 900_000 }, () => {
  const out: string[] = [];
  for (let a100 = 8; a100 <= 20; a100++) for (let b100 = 103; b100 <= 112; b100++) for (let up2 = 36; up2 <= 52; up2++) for (const down of [3.5, 4, 4.5, 5, 5.5, 6]) for (let h10 = 5; h10 <= 15; h10 += 5) {
    const h = { omegaStart: a100 / 100, omegaEnd: b100 / 100, rampSec: up2 / 2, returnSec: down, holdSec: h10 / 10 };
    const sc = hoopsSchedule(resolveHoopsSettings({ ...DEFAULT_HOOPS_SETTINGS, ...h }));
    const tenths = sc.cycle * 10;
    if (Math.abs(tenths - Math.round(tenths)) > 1e-7 || sc.cycle > 31.5) continue;
    // payoff estimate before simulating
    const est = ((0.997 - h.omegaStart) / (h.omegaEnd - h.omegaStart)) * h.rampSec / sc.cycle;
    if (est < 0.655) continue;
    const rows = []; for (let seed = 1; seed <= 6; seed++) rows.push(measure(h, seed));
    const ok = rows.every(r => r.barsOk && r.plucksOk);
    out.push(`${JSON.stringify(h)} cycle=${sc.cycle.toFixed(2)} allUp=${Math.min(...rows.map(r=>r.allUp)).toFixed(3)}-${Math.max(...rows.map(r=>r.allUp)).toFixed(3)} order=${ok} margin=${Math.min(...rows.map(r=>r.margin)).toFixed(2)}`);
  }
  console.log(out.join("\n"));
});
