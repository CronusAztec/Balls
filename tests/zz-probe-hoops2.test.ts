import { it } from "vitest";
import { DEFAULT_HOOPS_SETTINGS, hoopsSchedule, resolveHoopsSettings } from "@/lib/physics/modes/hoops";
it("probe", () => {
  const out: string[] = [];
  for (let a100 = 10; a100 <= 20; a100++) for (let b100 = 103; b100 <= 110; b100++) for (let up2 = 36; up2 <= 50; up2++) for (const down of [2.5, 3, 3.5, 4]) for (let h10 = 5; h10 <= 20; h10++) {
    const s = resolveHoopsSettings({ ...DEFAULT_HOOPS_SETTINGS, omegaStart: a100 / 100, omegaEnd: b100 / 100, rampSec: up2 / 2, returnSec: down, holdSec: h10 / 10 });
    const sc = hoopsSchedule(s);
    const steps = sc.cycle * 10;
    if (Math.abs(steps - Math.round(steps)) < 1e-7) out.push(`${a100/100} ${b100/100} ${up2/2} ${down} ${h10/10} cycle=${sc.cycle.toFixed(6)} hold=${sc.hold.toFixed(3)}`);
  }
  console.log(out.length + "\n" + out.filter(l => / 0\.13 /.test(" " + l) || true).slice(0, 400).join("\n"));
});
