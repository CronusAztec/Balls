import { parseFlRecipe, type FlHz, type FlLayer, type FlRecipe } from "./flSynth";

/*
 * --- low-findings-2 --- The machine-checkable part of flRecipes.ts' AVOID-LIST: the source gestures a row could reproduce by its
 * shape alone, found in its parsed layers (the rest of the list – samples, voices, melodies – cannot be written in the notation
 * or is a review matter). A row of every table must pass (tests/fightLeagueSound.test.ts):
 *
 *  - **jump**: a chip tone (square or pulse) swept up by a fifth and a half or more (×2.5) in 80–250 ms – the plumber's jump.
 *    A quicker zip (a ricochet's 50 ms), a smaller rise (a chirp's octave) or a slow riser (400 ms) is not that gesture.
 *  - **rev**: a buzzy tone (saw, square or pulse) swept up and repeated, each repeat higher – the hedgehog's spin-dash rev.
 *  - **coin**: two chip tones a rising fourth apart (×4/3) in the coin's register (B5–E6, 900–1450 Hz), the second after the first.
 */

/** A recipe's avoid-list problems (empty: none), F, R and H at `typical`. */
export function flAvoidListProblems(recipe: FlRecipe | string, typical: { F: number; R: number; H: number } = { F: 330, R: 523.25, H: 440 }): string[] {
  const r = typeof recipe === "string" ? parseFlRecipe(recipe) : recipe;
  const hz = (h: FlHz) => (h.ref === "" ? h.k : typical[h.ref] * h.k);
  const chip = (l: FlLayer) => l.src === "sqr" || l.src === "p25" || l.src === "p12";
  const buzzy = (l: FlLayer) => chip(l) || l.src === "saw";
  const out: string[] = [];
  for (const l of r.layers) {
    const g = l.glide;
    if (!g || !g.f1) continue;
    const rise = hz(g.f1) / Math.max(1e-9, hz(g.f0));
    if (chip(l) && rise >= 2.5 && g.ms >= 80 && g.ms <= 250) out.push(`jump: a chip tone swept ×${rise.toFixed(2)} over ${g.ms} ms`);
    if (buzzy(l) && rise > 1 && l.rep && l.rep.n >= 2 && l.rep.pitch > 1) out.push(`rev: a buzzy sweep repeated ${l.rep.n} times, each ×${l.rep.pitch} higher`);
  }
  const notes = r.layers.filter((l) => chip(l) && (!l.glide || !l.glide.f1));
  for (const a of notes) {
    for (const b of notes) {
      if (a === b || !(b.at > a.at)) continue;
      const fa = hz(a.glide ? a.glide.f0 : { ref: "", k: 0 });
      const fb = hz(b.glide ? b.glide.f0 : { ref: "", k: 0 });
      if (fa >= 900 && fb <= 1450 && Math.abs(fb / Math.max(1e-9, fa) - 4 / 3) < 0.02) out.push(`coin: ${fa.toFixed(0)} → ${fb.toFixed(0)} Hz, a rising fourth`);
    }
  }
  return out;
}
