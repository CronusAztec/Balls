import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import { BLUEPRINT_CATALOG_IDS, catalogBlueprint, sanitizeBlueprint } from "@/lib/blueprint";
import { SUMMARY_BIG, sayPhrase, summarizeBlueprint, summaryKeys, summaryNumberFormat, type SummaryLine } from "@/lib/blueprint/summary";
import { ACTIONS, FINISH_KINDS, TRIGGERS, WITH_RELATIONS } from "@/lib/blueprint/schema";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- blueprint --- Mode Lab's "How it plays" (lib/blueprint/summary.ts): every phrase a summary can use is a message of
 * Blueprint.how in English, Polish and Spanish; every catalog game's summary says its rules in each language with no
 * placeholder left over; a spec using every trigger, action and ending says them all; a slider's value shows in the summary.
 */

const LOCALES = { en, pl, es } as const;
type Locale = keyof typeof LOCALES;

function message(locale: Locale, key: string): string | undefined {
  let node: unknown = (LOCALES[locale] as { Blueprint: { how: unknown } }).Blueprint.how;
  for (const part of key.split(".")) node = node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
  return typeof node === "string" ? node : undefined;
}

/** The lines as the panel says them: the head, a colon, the parts joined by commas, fractions in the locale's own way. */
function say(locale: Locale, lines: SummaryLine[]): string[] {
  const fmt = (key: string, values: Record<string, string | number>) => String(new IntlMessageFormat(message(locale, key) ?? `<missing ${key}>`, locale).format(values));
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  return lines.map((l) => `${sayPhrase(l.head, fmt, num)}: ${l.parts.map((ph) => sayPhrase(ph, fmt, num)).join(", ")}`);
}

/** A spec with every trigger, every action and every ending (the vocabulary's whole range in one summary). */
const EVERYTHING = {
  v: 1,
  meta: { name: "Everything" },
  arena: { shape: "circle", gravity: { x: 0, y: 300 }, spinDegPerSec: 20, exits: [{ atDeg: 180, widthDeg: 20 }] },
  bodies: [
    { id: "red", team: 0, hp: 3 },
    { id: "blue", team: 1 },
  ],
  vars: [{ id: "score" }],
  tiles: { layout: "grid", rows: 2, cols: 6, hp: 2, hpStep: 1, style: "brick" },
  obstacles: [{ kind: "peg", x: 0, y: 0.5, r: 0.03 }, { kind: "bumper", x: 0.3, y: 0.5, r: 0.04, kick: 100 }, { kind: "bar", x: -0.3, y: 0.6, len: 0.3 }, { kind: "spinner", x: 0, y: 0.7, len: 0.3 }],
  spawners: [{ body: "red", count: 3, at: "center" }, { body: "blue", count: 2, at: "top", everySec: 2, maxTotal: 10 }],
  rules: [
    { when: "start", do: [{ act: "impulse", dir: "up", amount: 100 }] },
    { when: "timer", sec: 5, every: 2, do: [{ act: "speed", scale: 1.1 }] },
    { when: "beat", do: [{ act: "sound", voice: "hit" }] },
    { when: "bar", chance: 0.5, do: [{ act: "fx", kind: "flash" }] },
    { when: "wallHit", of: "red", cooldownSec: 1, do: [{ act: "grow", by: 2 }, { act: "var", id: "score", op: "add", value: 1 }] },
    { when: "obstacleHit", maxFires: 3, do: [{ act: "speed", scale: 0.9 }] },
    { when: "tileHit", do: [{ act: "damage", target: "tile", amount: 1 }] },
    { when: "tileBroken", do: [{ act: "spawn", body: "blue", count: 2, at: "tile" }] },
    { when: "ballHit", with: "otherTeam", do: [{ act: "team", target: "other", to: "self" }, { act: "recolor", target: "other", color: "team" }, { act: "damage", target: "other", amount: 1 }] },
    { when: "ballHit", with: "sameTier", do: [{ act: "merge" }] },
    { when: "escape", do: [{ act: "split", target: "all", into: 2 }] },
    { when: "ringPass", do: [{ act: "remove" }] },
    { when: "countReached", what: "balls", atLeast: 20, do: [{ act: "tier", target: "all", by: 1 }, { act: "var", id: "score", op: "mul", value: 2 }] },
    { when: "ballHit", with: "blue", of: "red", do: [{ act: "grow", by: -1 }, { act: "var", id: "score", op: "set", value: 0 }] },
  ],
  finish: {
    any: [{ when: "escaped", atLeast: 2 }, { when: "count", what: "score", atLeast: 30 }, { when: "teamsLeft", atMost: 1 }],
    timeoutSec: 90,
  },
} as const;

describe("blueprint summary: How it plays", () => {
  it("has every phrase it can use in every locale, with the same arguments, and every phrase compiles", () => {
    const keys = new Set<string>();
    for (const id of BLUEPRINT_CATALOG_IDS) for (const k of summaryKeys(summarizeBlueprint(catalogBlueprint(id)))) keys.add(k);
    for (const k of summaryKeys(summarizeBlueprint(sanitizeBlueprint(EVERYTHING).blueprint))) keys.add(k);
    // the vocabulary's own words: a trigger, a relation, an action or an ending without a phrase would say "<missing …>"
    expect(TRIGGERS.length + WITH_RELATIONS.length + ACTIONS.length + FINISH_KINDS.length).toBeGreaterThan(30);
    for (const key of keys) {
      for (const locale of Object.keys(LOCALES) as Locale[]) {
        const text = message(locale, key);
        expect(text, `${locale} Blueprint.how.${key}`).toBeTypeOf("string");
        expect(() => new IntlMessageFormat(text!, locale), `${locale} ${key}`).not.toThrow();
      }
    }
  });

  it("says every catalog game in English, Polish and Spanish with no placeholder left", () => {
    for (const id of BLUEPRINT_CATALOG_IDS) {
      const lines = summarizeBlueprint(catalogBlueprint(id));
      expect(lines.length, id).toBeGreaterThanOrEqual(3);
      expect(lines[0].head.key).toBe("arena");
      expect(lines[1].head.key).toBe("start");
      expect(lines[lines.length - 1].head.key).toBe("ends");
      for (const locale of Object.keys(LOCALES) as Locale[]) {
        for (const line of say(locale, lines)) {
          expect(line, `${locale} ${id}`).not.toMatch(/[{}]|<missing|undefined|NaN/);
          expect(line.length, `${locale} ${id}`).toBeLessThan(200);
        }
      }
    }
  });

  it("says the glass shell, the swarm and the ending of Glass Hatchery in plain words", () => {
    expect(say("en", summarizeBlueprint(catalogBlueprint("hatchery")))).toEqual([
      "Arena: a circle, 120 glass tiles in 6 layers, 2 to 17 hits break a tile",
      "Start: 1 ball in the centre",
      "When a ball breaks a tile: 1 new ball appears where the tile was, the ball changes colour",
      "End: when every tile is broken, or after 60 s",
    ]);
    expect(say("pl", summarizeBlueprint(catalogBlueprint("hatchery")))[2]).toBe("Gdy kulka rozbija płytkę: pojawia się 1 nowa kulka w miejscu płytki, kulka zmienia kolor");
    expect(say("es", summarizeBlueprint(catalogBlueprint("hatchery")))[3]).toBe("Final: cuando todas las losetas están rotas, o a los 60 s");
  });

  // --- review fix (blueprint) --- a tile's range of hits, and a counter with a verb that agrees, as Polish and Spanish say them
  it("says a tile's range of hits and a counter's change the way Polish and Spanish do", () => {
    expect(say("pl", summarizeBlueprint(catalogBlueprint("hatchery")))[0]).toBe("Arena: koło, 120 szklanych płytek w 6 warstwach, płytka pęka po 2–17 uderzeniach");
    expect(say("es", summarizeBlueprint(catalogBlueprint("hatchery")))[0]).toBe("Arena: un círculo, 120 losetas de cristal en 6 capas, de 2 a 17 golpes rompen una loseta");
    const all = (locale: Locale) => say(locale, summarizeBlueprint(sanitizeBlueprint(EVERYTHING).blueprint)).join("\n");
    // a counter named by a plural noun ("odbicia", "rebotes") takes the verb of "the counter", never one of its own
    expect(all("pl")).toContain("licznik „score” rośnie o 1");
    expect(all("pl")).toContain("licznik „score” mnoży się przez 2");
    expect(all("pl")).toContain("gdy 2 kulki uciekną lub licznik „score” dojdzie do 30");
    expect(all("es")).toContain("el contador «score» sube 1");
    expect(all("es")).toContain("cuando escapan 2 bolas o el contador «score» llega a 30");
  });

  it("names the faster and the slower ball of a collision, joins the endings with or and says who wins", () => {
    const conquer = say("en", summarizeBlueprint(catalogBlueprint("conquer")));
    expect(conquer[1]).toBe("Start: 24 balls in random spots, 4 teams");
    expect(conquer).toContain("When balls of two teams touch: the slower ball joins the faster one's team");
    expect(conquer).toContain("Every 6 s: every ball speeds up");
    expect(conquer[conquer.length - 1]).toBe("End: when one team is left, or after 90 s, the team with the most balls wins");
    const grow = say("en", summarizeBlueprint(catalogBlueprint("growEscape")));
    // --- review fix (blueprint) --- (Grow or Go loses when the ball no longer fits through the exit, said as the viewer sees it)
    expect(grow[grow.length - 1]).toBe("End: when a ball escapes or no ball fits through an exit any more, or after 60 s");
    expect(say("es", summarizeBlueprint(catalogBlueprint("growEscape"))).pop()).toBe("Final: cuando escapa una bola o ya no cabe ninguna bola por una salida, o a los 60 s");
    // a catalog game's variables by the HUD's own words (the panel passes them in the page's language)
    const varName = (id: string) => (id === "bounces" ? "odbicia" : id);
    const named = say("pl", summarizeBlueprint(catalogBlueprint("growEscape"), { varName }));
    expect(named).toContain("Gdy kulka uderza w ścianę: kulka rośnie, kulka przyspiesza, licznik „odbicia” rośnie o 1");
    expect(named[named.length - 1]).toBe("Koniec: gdy kulka ucieknie lub żadna kulka nie zmieści się już w wyjściu, albo po 60 s");
    // (--- review fix (blueprint) --- a variable is "the counter" in Polish, so its verb agrees: "licznik „odbicia” dojdzie")
    const counted = sanitizeBlueprint({ ...catalogBlueprint("growEscape"), finish: { timeoutSec: 60, any: [{ when: "escaped" }, { when: "count", what: "bounces", atLeast: 28 }] } }).blueprint;
    const countedPl = say("pl", summarizeBlueprint(counted, { varName }));
    expect(countedPl[countedPl.length - 1]).toBe("Koniec: gdy kulka ucieknie lub licznik „odbicia” dojdzie do 28, albo po 60 s");
    // any other reading of the fitting balls is said as a count
    const fitCount = sanitizeBlueprint({ ...catalogBlueprint("growEscape"), finish: { timeoutSec: 60, any: [{ when: "count", what: "fit", atLeast: 2 }] } }).blueprint;
    expect(say("en", summarizeBlueprint(fitCount)).pop()).toBe("End: when the count of balls that fit through an exit reaches 2, or after 60 s");
    expect(say("en", summarizeBlueprint(catalogBlueprint("plinkoRace"))).pop()).toBe("End: when a ball escapes, or after 60 s, the first ball out wins");
  });

  it("drops a recolouring the merge implies, calls the merged ball the new ball and writes fractions the locale's way", () => {
    const tier = say("en", summarizeBlueprint(catalogBlueprint("tierClimb")));
    expect(tier).toContain("When two balls of the same tier touch: the two merge into one ball of the next tier");
    expect(tier[1]).toBe("Start: 1 ball at the top, one more every 0.08 s");
    expect(say("pl", summarizeBlueprint(catalogBlueprint("tierClimb")))[1]).toBe("Start: 1 kulka na górze, kolejna co 0,08 s");
    const merged = sanitizeBlueprint({ ...EVERYTHING, rules: [{ when: "ballHit", with: "sameTier", do: [{ act: "merge" }, { act: "grow", by: 3 }] }] }).blueprint;
    expect(say("es", summarizeBlueprint(merged))).toContain("Cuando chocan dos bolas del mismo nivel: las dos se funden en una bola del nivel siguiente, la bola nueva crece");
  });

  it("says a spec with every trigger, action and ending, with its filters on the head", () => {
    const lines = say("en", summarizeBlueprint(sanitizeBlueprint(EVERYTHING).blueprint));
    expect(lines).toContain("Arena: a circle with one exit, the exit turns, gravity pulls the balls down, 12 bricks in 2 rows, 2 to 3 hits break a tile, 1 peg, 1 bumper, 1 bar, 1 spinner");
    expect(lines).toContain("Start: 5 balls, 2 teams, one more every 2 s");
    expect(lines).toContain("Every 5 s, every 2nd time: every ball speeds up");
    expect(lines).toContain("On every beat: a note plays");
    expect(lines).toContain("On every bar, 50% of the time: a flash");
    expect(lines).toContain("When a ball called red hits the wall, at most every 1 s: the ball grows, “score” goes up by 1");
    expect(lines).toContain("When a ball hits an obstacle, up to 3 times: the ball slows down");
    expect(lines).toContain("When a ball hits a tile: the tile takes 1 extra damage");
    expect(lines).toContain("When balls of two teams touch: the slower ball joins the faster one's team, the slower ball loses 1 HP");
    expect(lines).toContain("When two balls of the same tier touch: the two merge into one ball of the next tier");
    expect(lines).toContain("When a ball escapes: every ball splits into 2");
    expect(lines).toContain("When the ball count reaches 20: every ball moves up a tier, “score” is multiplied by 2");
    expect(lines).toContain("When a ball called red touches a ball called blue: the faster ball shrinks, “score” becomes 0");
    expect(lines[lines.length - 1]).toBe("End: when 2 balls escape or “score” reaches 30 or one team is left, or after 90 s");
  });

  // --- review fix (blueprint) --- a stranger's 1e300 printed every digit: about 400 characters with no break across the panel
  it("says a stranger's huge numbers short in every language, with no run of digits and no plural of 1e300", () => {
    const huge = sanitizeBlueprint({
      v: 1,
      meta: { name: "Huge" },
      bodies: [{ id: "b" }],
      vars: [{ id: "score", start: 1e300 }],
      tiles: { rows: 2, cols: 6, hp: 1e300 },
      spawners: [{ body: "b", count: "score", everySec: 2.5e6 }],
      rules: [
        { when: "timer", sec: 1e300, every: 1e300, maxFires: 1e300, cooldownSec: 2.5e9, do: [{ act: "spawn", body: "b", count: "score" }, { act: "var", id: "score", op: "add", value: 1e300 }] },
        { when: "wallHit", every: 3e6, do: [{ act: "split", into: "score" }] },
      ],
      finish: { timeoutSec: 60, any: [{ when: "escaped", atLeast: 1e300 }, { when: "count", what: "score", atLeast: 1.7e308 }] },
    }).blueprint;
    const lines = summarizeBlueprint(huge);
    const keys = summaryKeys(lines);
    expect(keys).toEqual(expect.arrayContaining(["tileHitsBig", "everyBig", "maxFiresBig", "end.escapedBig"]));
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      for (const k of keys) expect(message(locale, k), `${locale} ${k}`).toBeTypeOf("string");
      const num = summaryNumberFormat(locale);
      const fmt = (key: string, values: Record<string, string | number>) => String(new IntlMessageFormat(message(locale, key)!, locale).format(values));
      for (const line of lines.map((l) => `${sayPhrase(l.head, fmt, num)}: ${l.parts.map((ph) => sayPhrase(ph, fmt, num)).join(", ")}`)) {
        expect(line, locale).not.toMatch(/[{}]|<missing|undefined|NaN|Infinity/);
        expect(line, locale).not.toMatch(/\d[\d.,\s\u00a0\u202f]{12,}\d/);
        expect(line.length, `${locale} ${line}`).toBeLessThan(260);
      }
    }
    const said = (locale: Locale) => {
      const num = summaryNumberFormat(locale);
      const fmt = (key: string, values: Record<string, string | number>) => String(new IntlMessageFormat(message(locale, key)!, locale).format(values));
      return lines.map((l) => `${sayPhrase(l.head, fmt, num)}: ${l.parts.map((ph) => sayPhrase(ph, fmt, num)).join(", ")}`).join("\n");
    };
    expect(said("en")).toContain("12 glass tiles in 2 rows, 1E300 hits break a tile");
    expect(said("en")).toContain("Start: 8 balls in the centre, one more every 2.5M s");
    expect(said("en")).toContain("Every 1E300 s, once every 1E300 times, at most every 2.5B s, up to 1E300 times: 8 new balls appear at the ball, “score” goes up by 1E300");
    expect(said("en")).toContain("When a ball hits the wall, once every 3M times: the ball splits into 8");
    expect(said("en")).toContain("End: when 1E300 balls escape or “score” reaches 1.7E308, or after 60 s");
    expect(said("pl")).toContain("płytka pęka po 1E300 uderzeń");
    expect(said("es")).toContain("1E300 golpes rompen una loseta");
    // (below SUMMARY_BIG a number is the locale's plain one, and a count still takes its plural)
    expect([summaryNumberFormat("pl")(999_999.5), summaryNumberFormat("en")(SUMMARY_BIG), summaryNumberFormat("pl")(2.5e6).replace(/\s/g, " ")]).toEqual([new Intl.NumberFormat("pl").format(999_999.5), "1M", "2,5 mln"]);
  });

  it("follows a slider: Ring Breaker's ring count shows in its arena line", () => {
    const rb = catalogBlueprint("ringBreaker");
    // (--- review fix (blueprint) --- Ring Breaker's rings sit inside a solid rim, so the swarm stays on screen at the end)
    expect(say("en", summarizeBlueprint(rb))[0]).toBe("Arena: 8 spinning rings, a ring shatters when a ball gets through, inside a solid rim, so no ball gets out");
    const three = sanitizeBlueprint({ ...rb, arena: { ...rb.arena, rings: { ...rb.arena.rings!, count: 3 } } }).blueprint;
    expect(say("pl", summarizeBlueprint(three))[0]).toBe("Arena: 3 wirujące pierścienie, pierścień pęka, gdy kulka przez niego przeleci, w zamkniętej obręczy, więc żadna kulka nie ucieknie");
  });
});
