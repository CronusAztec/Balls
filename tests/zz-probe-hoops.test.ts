import { it } from "vitest";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import type { PhysicsConfig } from "@/lib/physics/types";
import { DEFAULT_HOOPS_SETTINGS, type HoopsSettings } from "@/lib/physics/modes/hoops";
const config: PhysicsConfig = { width: 800, height: 800, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const base: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
function measure(h: Partial<HoopsSettings>, seed: number) {
  const e = createEngineForSettings(config, "hoops", { ...base, hoops: h }, seed);
  const v = e.getHoopsView();
  const sc = v.schedule;
  const lifts: number[] = []; const plucks: number[] = [];
  const frames = Math.round(sc.cycle * 60) + 10;
  for (let i = 0; i < frames; i++) { e.update(1000/60, 0); for (const ev of e.consumeSoundEvents()) { if (ev.loop === "bar") lifts.push(e.getElapsedMs()/1000); if (ev.loop === "pluck") plucks.push(e.getElapsedMs()/1000); } }
  return { cycle: sc.cycle, first: lifts[0] / sc.cycle, allUp: v.firstAllUpMs / 1000 / sc.cycle, n: lifts.length, upEnd: sc.up / sc.cycle, holdEnd: (sc.up + sc.hold)/sc.cycle, np: plucks.length, lastPluck: sc.cycle - Math.max(...plucks) };
}
it("probe", () => {
  const variants: [string, Partial<HoopsSettings>][] = [["default", {}], ...JSON.parse(process.env.HP_VARIANTS ?? "[]")];
  for (const [name, h] of variants) {
    const rows = [];
    for (let seed = 1; seed <= 12; seed++) rows.push(measure(h, seed));
    const allUp = rows.map(r => r.allUp);
    const first = rows.map(r => r.first);
    console.log(name, "cycle", rows[0].cycle.toFixed(2), "allUp", Math.min(...allUp).toFixed(3), Math.max(...allUp).toFixed(3), "first", Math.min(...first).toFixed(3), Math.max(...first).toFixed(3), "n", rows.map(r=>r.n).join(""), "upEnd", rows[0].upEnd.toFixed(3), "holdEnd", rows[0].holdEnd.toFixed(3), "plucks", rows.map(r=>r.np).join(""), "lastPluckBeforeEnd", Math.min(...rows.map(r=>r.lastPluck)).toFixed(2), "allUpSec", (rows[0].allUp*rows[0].cycle).toFixed(2));
  }
});
