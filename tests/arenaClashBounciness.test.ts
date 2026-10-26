import { describe, expect, it, vi } from "vitest";

/*
 * --- review fix (uncap-all) --- The Wall Bounciness in the arena games (Square Battle Royale, Capture the Flag): every wall
 * pass takes it as typed, the pass after a clash too, while two squares clash at most elastically (a value below 100 %
 * softens a clash). A spy on the arena maths records the restitution each call gets in a real run of the engine.
 */

const seen = { pair: [] as number[], wall: [] as number[], contacts: 0 };

vi.mock("@/lib/physics/modes/arenaGames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/physics/modes/arenaGames")>();
  return {
    ...real,
    resolveSquarePair: (...args: Parameters<typeof real.resolveSquarePair>) => {
      seen.pair.push(args[2]);
      const hit = real.resolveSquarePair(...args);
      if (hit) seen.contacts++;
      return hit;
    },
    boxWallPass: (...args: Parameters<typeof real.boxWallPass>) => {
      seen.wall.push(args[5]);
      return real.boxWallPass(...args);
    },
    circleWallPass: (...args: Parameters<typeof real.circleWallPass>) => {
      seen.wall.push(args[4]);
      return real.circleWallPass(...args);
    },
  };
});

import { settingsFromSearchParams } from "@/lib/settings";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { createEngineForSettings } from "@/lib/simulation/finder";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/** The restitutions the run of a link handed to the square pairs and to the walls, and how many clashes touched. */
function restitutions(query: string, frames = 1200, seed = 7) {
  seen.pair.length = 0;
  seen.wall.length = 0;
  seen.contacts = 0;
  const settings = settingsFromSearchParams(new URLSearchParams(query));
  const request = finderRequestOfSettings(settings);
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  for (let i = 0; i < frames; i++) engine.update(1000 / 60, 0);
  return { wallBounciness: settings.wallBounciness, pair: [...new Set(seen.pair)], wall: [...new Set(seen.wall)], contacts: seen.contacts };
}

describe("arena games: the Wall Bounciness at the walls and in a clash", () => {
  it("Capture the Flag rebounds off every wall at the typed value, after a clash too; a clash stays at most elastic", () => {
    const run = restitutions("mode=ctf&ctfn=4&wb=3");
    expect(run.wallBounciness).toBe(3);
    expect(run.contacts).toBeGreaterThan(0); // (squares touched, so the pass after a clash ran)
    expect(run.wall).toEqual([3]); // (the pass after a clash got the clash's 1)
    expect(run.pair).toEqual([1]);
  });

  it("Square Battle Royale does the same, in the box and in the circle", () => {
    for (const arena of ["box", "circle"]) {
      const run = restitutions(`mode=battle&bta=${arena}&wb=3`);
      expect([arena, run.contacts > 0, run.wall, run.pair]).toEqual([arena, true, [3], [1]]);
    }
  });

  it("a Wall Bounciness below 100 % softens the walls and a clash alike", () => {
    for (const mode of ["ctf", "battle"]) {
      const run = restitutions(`mode=${mode}&wb=0.8`);
      expect([mode, run.contacts > 0, run.wall, run.pair]).toEqual([mode, true, [0.8], [0.8]]);
    }
  });

  it("the Wall Bounciness tip names the two games whose clashes stay at most elastic, in en, pl and es", () => {
    for (const messages of [en, pl, es]) {
      const tip = messages.Controls.wallBouncinessTip;
      expect([tip.includes(messages.Modes.battle.name), tip.includes(messages.Modes.ctf.name)]).toEqual([true, true]);
    }
  });
});
