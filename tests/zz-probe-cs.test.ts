import { it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig } from "@/lib/physics/types";
const config: PhysicsConfig = { width: 450, height: 800, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
it("probe", { timeout: 600_000 }, () => {
  const variants = JSON.parse(process.env.CS_VARIANTS ?? "[]");
  for (const [name, patch] of variants) {
    const times: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const e = new PhysicsEngine(config);
      e.setColourSortSettings(patch);
      e.setSeed(seed);
      e.initMode("colourSort");
      const v = e.getColourSortView();
      let i = 0;
      for (; i < 90 * 60 && v.completions < 1; i++) e.update(1000 / 60, 0);
      times.push(v.firstEnd === "sorted" ? v.firstSortSec : -v.firstEndSec);
    }
    times.sort((a, b) => a - b);
    console.log(name, times.map((t) => t.toFixed(1)).join(" "));
  }
});
