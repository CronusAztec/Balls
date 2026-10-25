import { describe, expect, it } from "vitest";
import { BLUEPRINT_CATALOG_IDS, DEFAULT_CHECK_SEEDS, applyBlueprintParams, catalogBlueprint, playabilityCheck, type Blueprint, type PlayabilityReport } from "@/lib/blueprint";

/*
 * --- review fix (blueprint) --- Mode Lab's sliders keep every catalog game a clip at both ends. Each slider at its min and
 * at its max, the others at their defaults, is 'playable' on the playability check's seeds and ends by its own condition on
 * every one of them, so no slider offers a value that idles to the timeout: Tier Climb's tier 10 (512 orbs of a rain of
 * 400), Ring Breaker's 15° gap (narrower than the ball at the innermost ring), Peg Race's still exit (away from the floor
 * where the balls rest), Grow or Go's bounce count (now the world's own "no ball fits"). Peg Race's narrowest and widest
 * exit at its slowest and fastest spin finish on every seed too.
 */

/** The game with slider `i` at `value` and the others at their defaults, played by the check. */
function checkAt(bp: Blueprint, i: number, value: number): PlayabilityReport {
  const { blueprint, notes } = applyBlueprintParams(
    bp,
    bp.params.map((_, k) => (k === i ? value : null)),
  );
  expect(notes).toEqual([]);
  return playabilityCheck(blueprint);
}

/** What a check says, in the form the assertions compare. */
const outcome = (r: PlayabilityReport) => ({ verdict: r.verdict, problems: r.problems, byCondition: r.finishedByCondition, ends: r.seeds.map((s) => `${s.reason} ${s.timeSec} s ${s.result}`) });

describe("blueprint catalog: every slider's ends still make a clip", () => {
  for (const id of BLUEPRINT_CATALOG_IDS) {
    const bp = catalogBlueprint(id);
    bp.params.forEach((p, i) => {
      for (const [end, value] of [["min", p.min], ["max", p.max]] as const)
        it(`${id}: ${p.id} at its ${end} (${value}) is playable and ends by its own condition on every check seed`, () => {
          const got = outcome(checkAt(bp, i, value));
          expect({ id, slider: p.id, value, verdict: got.verdict, problems: got.problems, byCondition: got.byCondition, ends: got.ends }).toEqual({
            id,
            slider: p.id,
            value,
            verdict: "playable",
            problems: [],
            byCondition: DEFAULT_CHECK_SEEDS.length,
            ends: got.ends,
          });
        });
    });
  }

  it("keeps the ranges the games end in: Tier Climb up to tier 8, Ring Breaker from a 24° gap, Peg Race's exit always turning", () => {
    const range = (id: (typeof BLUEPRINT_CATALOG_IDS)[number], slider: string) => {
      const p = catalogBlueprint(id).params.find((x) => x.id === slider);
      return p ? [p.min, p.max] : null;
    };
    // a tier-n orb takes 2^(n−1) orbs and the rain stops at 400: tier 9 (256 merged without a miss) was never reached
    expect(range("tierClimb", "target")).toEqual([6, 8]);
    expect(catalogBlueprint("tierClimb").spawners[0].maxTotal).toBe(400);
    // the innermost ring's gap must leave the ball room between its edges
    const rb = catalogBlueprint("ringBreaker");
    const inner = 225 * rb.arena.size * (rb.arena.rings?.inner ?? 0);
    const [gapMin] = range("ringBreaker", "gap") ?? [0];
    expect(2 * inner * Math.sin(((gapMin / 2) * Math.PI) / 180)).toBeGreaterThan(2 * rb.bodies[0].radius);
    expect(range("plinkoRace", "spin")?.[0]).toBeGreaterThan(0);
  });

  it("Peg Race's narrowest and widest exit, at its slowest and fastest spin, finish on every check seed", () => {
    const bp = catalogBlueprint("plinkoRace");
    const exit = bp.params.findIndex((p) => p.id === "exit");
    const spin = bp.params.findIndex((p) => p.id === "spin");
    for (const e of [bp.params[exit].min, bp.params[exit].max])
      for (const s of [bp.params[spin].min, bp.params[spin].max]) {
        const { blueprint } = applyBlueprintParams(
          bp,
          bp.params.map((_, k) => (k === exit ? e : k === spin ? s : null)),
        );
        const r = playabilityCheck(blueprint);
        expect({ exit: e, spin: s, byCondition: r.finishedByCondition, results: r.seeds.map((x) => x.reason) }).toEqual({ exit: e, spin: s, byCondition: DEFAULT_CHECK_SEEDS.length, results: DEFAULT_CHECK_SEEDS.map(() => "condition") });
      }
  });
});
