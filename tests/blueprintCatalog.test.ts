import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLUEPRINT_CATALOG, BLUEPRINT_CATALOG_IDS, HeadlessBlueprint, applyBlueprintParams, blueprintDigest, catalogBlueprint, numberAt, paramValue, sanitizeBlueprint, validateBlueprint, type BlueprintCatalogId } from "@/lib/blueprint";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- blueprint --- Mode Lab's catalog (src/lib/blueprint/catalog/): every built-in Blueprint is valid as written, plays to
 * a clear ending on the real runtime and replays to the fingerprint in tests/fixtures/blueprint-fingerprints.json (a moved
 * fingerprint means the game now plays differently: find out why, never re-record it to pass), its sliders point at numbers
 * of the spec and change the game, and its name, lines and slider labels exist in en, pl and es. The BASELINE of
 * tests/extras.test.ts holds the mode's default (the first entry) as the engine plays it on the page.
 */

interface CatalogFingerprint {
  digest: string;
  samples: number[][];
  reason: string | null;
  condition: number;
  steps: number;
  result: string;
  winner: number;
  spawned: number;
  escaped: number;
  tilesBroken: number;
  sounds: number;
  peakBalls: number;
}

const fixture = JSON.parse(readFileSync("tests/fixtures/blueprint-fingerprints.json", "utf8")) as { recipe: string; catalog: Record<string, CatalogFingerprint> };

/** The fixture's recipe: seed 1 headless, the first two balls every 150 steps of the first 600, then the run to its end. */
function catalogFingerprint(id: BlueprintCatalogId): CatalogFingerprint {
  const bp = catalogBlueprint(id);
  const h = new HeadlessBlueprint(bp, { seed: 1 });
  const samples: number[][] = [];
  for (let i = 1; i <= 600 && !h.finished; i++) {
    h.step();
    if (i % 150 === 0) samples.push(...h.engine.getBalls().slice(0, 2).map((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]));
  }
  const r = h.runToEnd();
  const s = h.stats;
  return { digest: blueprintDigest(bp), samples, reason: r.reason, condition: r.condition, steps: s.steps, result: r.result, winner: r.winner, spawned: s.spawned, escaped: s.escaped, tilesBroken: s.tilesBroken, sounds: s.sounds, peakBalls: s.peakBalls };
}

type Messages = { Blueprints: Record<string, { name: string; description: string; timeoutSay?: string; params?: Record<string, string> } & Record<string, unknown>> };
const LOCALES: [string, Messages][] = [
  ["en", en as unknown as Messages],
  ["pl", pl as unknown as Messages],
  ["es", es as unknown as Messages],
];

describe("blueprint catalog: the games", () => {
  it("has at least four games, each valid as written and needing no repair", () => {
    expect(BLUEPRINT_CATALOG_IDS.length).toBeGreaterThanOrEqual(4);
    for (const id of BLUEPRINT_CATALOG_IDS) {
      expect(validateBlueprint(BLUEPRINT_CATALOG[id]), id).toEqual([]);
      expect(sanitizeBlueprint(BLUEPRINT_CATALOG[id]).notes, id).toEqual([]);
    }
  });

  it("has a fingerprint for every game, and none for a game that is gone", () => {
    expect(fixture.recipe).toMatch(/seed: 1/);
    expect(Object.keys(fixture.catalog).sort()).toEqual([...BLUEPRINT_CATALOG_IDS].sort());
  });

  for (const id of BLUEPRINT_CATALOG_IDS)
    it(`${id} replays to its fingerprint and ends by its own condition, the same on a second run`, () => {
      const first = catalogFingerprint(id);
      expect(first).toEqual(fixture.catalog[id]);
      expect(first.reason).toBe("condition");
      expect(first.result.length).toBeGreaterThan(0);
      expect(catalogFingerprint(id)).toEqual(first);
    });
});

describe("blueprint catalog: the sliders", () => {
  for (const id of BLUEPRINT_CATALOG_IDS)
    it(`${id}: every slider points at a number inside its range, and moving it changes the game`, () => {
      const bp = catalogBlueprint(id);
      expect(bp.params.length).toBeGreaterThan(0);
      bp.params.forEach((p, i) => {
        const own = paramValue(bp, i);
        expect(Number.isFinite(own), `${id}.${p.id}`).toBe(true);
        expect(own, `${id}.${p.id}`).toBeGreaterThanOrEqual(p.min);
        expect(own, `${id}.${p.id}`).toBeLessThanOrEqual(p.max);
        const other = own === p.min ? p.max : p.min;
        const values = bp.params.map((_, k) => (k === i ? other : null));
        const { blueprint, notes } = applyBlueprintParams(bp, values);
        expect(notes, `${id}.${p.id}`).toEqual([]);
        expect(numberAt(blueprint, p.at), `${id}.${p.id}`).toBe(other);
        expect(blueprintDigest(blueprint), `${id}.${p.id}`).not.toBe(blueprintDigest(bp));
      });
    });

  it("plays a slider's value in the run (Ring Breaker with three rings breaks three)", () => {
    const h = new HeadlessBlueprint(catalogBlueprint("ringBreaker"), { seed: 2, params: "3" });
    expect(h.world.ringsAlive()).toBe(3);
    expect(h.runToEnd()).toMatchObject({ reason: "condition", result: "ALL RINGS DOWN" });
  });
});

// --- review fix (blueprint) --- the two retuned games end the way a clip needs them to
describe("blueprint catalog: endings a clip can use", () => {
  it("Grow or Go has both endings, is never out in its first 6 s and loses on the bounce the ball stops fitting", () => {
    const bp = catalogBlueprint("growEscape");
    // the most a ball's radius may be to pass between the exit's two edges (round walls of 2 px at the 207 px rim)
    const R = 225 * bp.arena.size;
    const fit = R * Math.sin(((bp.arena.exits[0].widthDeg / 2) * Math.PI) / 180) - 2;
    const grow = bp.rules[0].do[0];
    const by = grow.act === "grow" && typeof grow.by === "number" ? grow.by : NaN;
    let escapes = 0;
    let early = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const h = new HeadlessBlueprint(bp, { seed });
      const r = h.runToEnd();
      expect(r.reason, `seed ${seed}`).toBe("condition");
      const ball = h.world.balls[0];
      if (r.condition === 0) {
        escapes++;
        if (r.timeSec < 6) early++;
        expect(r.result, `seed ${seed}`).toMatch(/^ESCAPED AFTER BOUNCE \d+$/);
      } else {
        expect(r.result, `seed ${seed}`).toBe("TOO BIG TO ESCAPE");
        // --- review fix (blueprint) --- (the bounce it stops fitting: one bounce smaller it still fitted)
        expect([seed, ball.r > fit, ball.r - by <= fit]).toEqual([seed, true, true]);
      }
    }
    expect(escapes).toBeGreaterThanOrEqual(6);
    expect(20 - escapes).toBeGreaterThanOrEqual(6);
    expect(early).toBe(0);
    // the loss is the world's own count of balls that still fit (count fit atMost 0), not a number of bounces
    expect(new HeadlessBlueprint(bp, { seed: 1 }).world.exitFitRadius()).toBeCloseTo(fit, 9);
    expect(bp.finish.any[1]).toMatchObject({ when: "count", what: "fit", atMost: 0, atLeast: null });
    // a 21° exit and an 8 px ball growing 1 px a bounce: it outgrows the exit on bounce 28
    expect(Math.floor((fit - bp.bodies[0].radius) / by) + 1).toBe(28);
  });

  // --- review fix (blueprint) --- TOO BIG TO ESCAPE at 23 s over a 13.6 px ball that then left through a 35 px exit (growth 0.2)
  it("Grow or Go says TOO BIG TO ESCAPE only once the ball no longer fits, and it never gets out under the banner, at every slider end", () => {
    const bp = catalogBlueprint("growEscape");
    const ids = bp.params.map((p) => p.id);
    expect(ids).toEqual(["grow", "exit", "size"]);
    const cases: (number | null)[][] = [[null, null, null], [0.2, null, null], [3, null, null], [null, 14, null], [null, 40, null], [null, null, 4], [null, null, 20], [0.2, 14, 20], [0.2, 40, 4]];
    let losses = 0;
    for (const values of cases) {
      const played = applyBlueprintParams(bp, values).blueprint;
      const fit = 225 * played.arena.size * Math.sin(((played.arena.exits[0].widthDeg / 2) * Math.PI) / 180) - 2;
      // (every starting size fits through every exit width: the loss can always happen)
      expect([values, played.bodies[0].radius <= fit]).toEqual([values, true]);
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const h = new HeadlessBlueprint(played, { seed });
        const r = h.runToEnd();
        const tag = `${values.join(",")} seed ${seed}`;
        expect([tag, r.reason]).toEqual([tag, "condition"]);
        if (r.result !== "TOO BIG TO ESCAPE") continue;
        losses++;
        expect([tag, h.world.balls[0].r > fit]).toEqual([tag, true]);
        // the clip goes on under the banner: 15 s of it, and the ball is still in the arena
        for (let i = 0; i < 15 * 60; i++) h.step();
        expect([tag, h.stats.escaped, h.world.aliveCount()]).toEqual([tag, 0, 1]);
      }
    }
    expect(losses).toBeGreaterThanOrEqual(10);
  });

  it("Ring Breaker keeps its whole swarm on screen under the end banner: the rings sit inside a solid rim", () => {
    for (const seed of [1, 2, 3]) {
      const h = new HeadlessBlueprint(catalogBlueprint("ringBreaker"), { seed });
      expect(h.runToEnd()).toMatchObject({ reason: "condition", result: "ALL RINGS DOWN" });
      const atFinish = h.world.aliveCount();
      for (let i = 0; i < 90; i++) h.step();
      expect([seed, h.world.aliveCount(), h.stats.escaped]).toEqual([seed, atFinish, 0]);
    }
  });
});

describe("blueprint catalog: three locales", () => {
  for (const id of BLUEPRINT_CATALOG_IDS)
    it(`${id}: its name, description, HUD labels, ending lines and slider labels exist in en, pl and es`, () => {
      const bp = catalogBlueprint(id);
      for (const [locale, messages] of LOCALES) {
        const m = messages.Blueprints[id];
        expect(m, `${locale}.${id}`).toBeDefined();
        expect(m.name.length, `${locale}.${id}.name`).toBeGreaterThan(0);
        expect(m.description.length, `${locale}.${id}.description`).toBeGreaterThan(0);
        bp.hud.forEach((_, i) => expect(typeof m[`hud${i}`], `${locale}.${id}.hud${i}`).toBe("string"));
        expect(m[`hud${bp.hud.length}`], `${locale}.${id}.hud${bp.hud.length}`).toBeUndefined();
        bp.finish.any.forEach((c, i) => expect(typeof m[`say${i}`], `${locale}.${id}.say${i}`).toBe(c.say ? "string" : "undefined"));
        expect(typeof m.timeoutSay === "string", `${locale}.${id}.timeoutSay`).toBe(Boolean(bp.finish.timeoutSay));
        for (const p of bp.params) expect(typeof m.params?.[p.id], `${locale}.${id}.params.${p.id}`).toBe("string");
      }
    });
});

// --- review fix (blueprint) --- Mode Lab says what the visitor sees, in the visitor's language (docs/COPY-STYLE.md)
describe("blueprint catalog: the visitor's words", () => {
  type Node = string | { [key: string]: Node };
  /** Every string of Mode Lab a visitor reads, by its key: the card, the heading, the panel, the canvas and every game's own. */
  const modeLabCopy = (messages: unknown): [string, string][] => {
    const m = messages as { Controls: Record<string, Node>; Blueprint: Node; Blueprints: Node; Modes: Record<string, Node>; Headings: Record<string, Node> };
    const out: [string, string][] = [];
    const walk = (node: Node | undefined, key: string) => {
      if (typeof node === "string") out.push([key, node]);
      else if (node) for (const [k, v] of Object.entries(node)) walk(v, `${key}.${k}`);
    };
    for (const [k, v] of Object.entries(m.Controls)) if (k === "modeBlueprint" || /^bl[A-Z]/.test(k)) walk(v, `Controls.${k}`);
    walk(m.Blueprint, "Blueprint");
    walk(m.Blueprints, "Blueprints");
    walk(m.Modes.blueprint, "Modes.blueprint");
    walk(m.Headings.modesLab, "Headings.modesLab");
    return out;
  };

  it("never names the format a game is written in, nor seeds, in any language: a game, its rules, a shared game link", () => {
    const offenders: string[] = [];
    for (const [locale, messages] of LOCALES) {
      const copy = modeLabCopy(messages);
      expect(copy.length, locale).toBeGreaterThan(100);
      for (const [key, text] of copy) if (/blueprint|\bseeds?\b|seed[óa]|semill|ziarn/i.test(text)) offenders.push(`${locale} ${key}: ${text}`);
    }
    expect(offenders).toEqual([]);
  });

  // --- review fix (blueprint) --- a race through pegs (never a race of pegs), the gold team, a winning colour with its article
  it("names the peg race as a race through pegs, and says a winning colour as Spanish does, with its article", () => {
    expect([en.Blueprints.plinkoRace.name, pl.Blueprints.plinkoRace.name, es.Blueprints.plinkoRace.name]).toEqual(["Peg Race", "Wyścig przez kołki", "Carrera entre clavos"]);
    // the colours are the teams' names, said as nouns: "el dorado" wins, not "oro" (gold the metal)
    expect(Object.values(es.Blueprint.team)).toEqual(["ROJO", "AZUL", "VERDE", "DORADO", "MORADO", "CIAN"]);
    const lines: string[] = [];
    for (const id of BLUEPRINT_CATALOG_IDS)
      for (const [key, text] of Object.entries(es.Blueprints[id] as Record<string, unknown>))
        if (typeof text === "string" && text.includes("[winner]")) {
          lines.push(key);
          expect([id, key, /(^|¡|\s)EL \[winner\]/.test(text)]).toEqual([id, key, true]);
        }
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it("introduces Mode Lab in at most three sentences, each naming at most three things", () => {
    for (const [locale, messages] of LOCALES) {
      const intro = (messages as unknown as { Controls: { blDesc: string } }).Controls.blDesc;
      const sentences = intro.split(/(?<=[.!?])\s+/);
      expect(sentences.length, `${locale}: ${intro}`).toBeLessThanOrEqual(3);
      // a list of more than three things has three commas or more ("an arena, its balls and the rules that make them break, merge, multiply or race")
      for (const s of sentences) expect([locale, s, (s.match(/,/g) ?? []).length <= 2]).toEqual([locale, s, true]);
    }
  });

  it("describes each game without a number its sliders change, so the description holds at every slider value", () => {
    // the number words a default slider value could be said as (2 to 12)
    const WORDS: Record<string, Record<number, string[]>> = {
      en: { 2: ["two"], 3: ["three"], 4: ["four"], 5: ["five"], 6: ["six"], 7: ["seven"], 8: ["eight"], 9: ["nine"], 10: ["ten"], 11: ["eleven"], 12: ["twelve"] },
      pl: { 2: ["dwa", "dwie", "dwóch", "dwu", "dwoma"], 3: ["trzy", "trzech"], 4: ["cztery", "czterech"], 5: ["pięć", "pięciu"], 6: ["sześć", "sześciu"], 7: ["siedem", "siedmiu"], 8: ["osiem", "ośmiu"], 9: ["dziewięć", "dziewięciu"], 10: ["dziesięć", "dziesięciu"], 11: ["jedenaście"], 12: ["dwanaście"] },
      es: { 2: ["dos"], 3: ["tres"], 4: ["cuatro"], 5: ["cinco"], 6: ["seis"], 7: ["siete"], 8: ["ocho"], 9: ["nueve"], 10: ["diez"], 11: ["once"], 12: ["doce"] },
    };
    const offenders: string[] = [];
    for (const id of BLUEPRINT_CATALOG_IDS) {
      const bp = catalogBlueprint(id);
      const defaults = bp.params.map((_, i) => paramValue(bp, i));
      for (const [locale, messages] of LOCALES) {
        const m = messages.Blueprints[id];
        for (const key of ["description", "line"]) {
          const text = String(m[key] ?? "");
          if (/\d/.test(text)) offenders.push(`${locale} ${id}.${key} has a number: ${text}`);
          for (const v of defaults)
            for (const word of WORDS[locale][v] ?? []) if (new RegExp(`(?<!\\p{L})${word}(?!\\p{L})`, "iu").test(text)) offenders.push(`${locale} ${id}.${key} says "${word}" (a slider starts at ${v}): ${text}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // --- review fix (blueprint) --- "1 RINGS LEFT", "QUEDAN 1 ANILLOS": a count filled into a line before the noun it counts
  it("never writes a count right before the noun it counts, so a result line reads right for one as for many", () => {
    /** The first letters of a word, so a plural, a genitive or a case ending still matches (PIERŚCIENI ~ pierścienie). */
    const stem = (word: string) => word.toLocaleLowerCase("pl").slice(0, 5);
    const offenders: string[] = [];
    const checkLine = (where: string, line: string, nouns: Set<string>) => {
      // a count placeholder ([rings] in a message, {rings} in a spec) and the word right after it (a full stop ends it: "PO 4. ODBICIU")
      for (const m of line.matchAll(/[[{]([a-z][a-z0-9]*)[\]}] +(\p{L}+)/gu)) {
        if (m[1] === "winner" || m[1] === "time") continue;
        if (nouns.has(stem(m[2]))) offenders.push(`${where}: ${line}`);
      }
    };
    for (const id of BLUEPRINT_CATALOG_IDS) {
      const bp = catalogBlueprint(id);
      // the counted things are what the HUD calls them (its labels), in each language
      const nounsOf = (labels: string[]) => new Set(labels.flatMap((l) => l.split(/\s+/)).map(stem));
      const own = nounsOf(bp.hud.map((h) => h.label));
      [...bp.finish.any.map((c) => c.say), bp.finish.timeoutSay].forEach((line) => checkLine(`${id} (spec)`, line, own));
      for (const [locale, messages] of LOCALES) {
        const m = messages.Blueprints[id];
        const nouns = nounsOf(bp.hud.map((_, i) => String(m[`hud${i}`])));
        for (const key of ["say0", "say1", "say2", "timeoutSay"]) if (typeof m[key] === "string") checkLine(`${locale} ${id}.${key}`, m[key] as string, nouns);
      }
    }
    expect(offenders).toEqual([]);
    // the line that broke it, now a label with its count after it
    expect([en.Blueprints.ringBreaker.timeoutSay, pl.Blueprints.ringBreaker.timeoutSay, es.Blueprints.ringBreaker.timeoutSay, catalogBlueprint("ringBreaker").finish.timeoutSay]).toEqual(["RINGS LEFT: [rings]", "ZOSTAŁO PIERŚCIENI: [rings]", "ANILLOS EN PIE: [rings]", "RINGS LEFT: {rings}"]);
  });
});
