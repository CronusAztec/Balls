import { afterEach, describe, expect, it } from "vitest";
import {
  CUSTOM_ID_PREFIX,
  MAX_CUSTOM_FIGHTERS,
  PRIMITIVE_PARAMS,
  buildCustomFighter,
  buildCustomFighters,
  customIdFor,
  normaliseColor,
  plainText,
  type CustomFighterSpec,
} from "@/lib/physics/modes/fightLeagueCustom";
import {
  FL_ABILITY_PRIMITIVES,
  FL_BY_ID,
  FL_CHARGE_RANGE,
  FL_ROSTER,
  FL_WEAPON_KINDS,
  abilityClass,
  customFighters,
  customFightersVersion,
  fightersOf,
  flLimitViolations,
  flRosterHash,
  isFlFighterId,
  rosterTableMarkdown,
  setCustomFighters,
  subscribeCustomFighters,
} from "@/lib/physics/modes/fightLeagueRoster";
import { CUSTOM_FIGHTER_FINAL, customFighterTask, fighterFromAnswer, primitiveCatalog, specFromAnswer, weaponCatalog } from "@/lib/desktop/ai/customFighter";
import { CUSTOM_MODE_FINAL, customModeFrom, customModeTask, sanitizeCustomModes, MAX_CUSTOM_MODES } from "@/lib/desktop/ai/customMode";
import { validateJson } from "@/lib/desktop/ai/jsonSchema";
import { resolveCustomContent } from "@/lib/desktop/custom";
import { checkIpcArgs, BRIDGE_METHODS, IPC } from "@/lib/desktop/contract";
import { defaultSettings } from "@/lib/settings";
import { probeDuel } from "./flProbes";
import { BALANCE_PANEL, BALANCE_WINDOW, balanceCustomFighter, panelWinRate, strengthStats } from "@/lib/simulation/flBalance";
import { addTemporaryFighter, withTemporaryFighter } from "@/lib/physics/modes/fightLeagueRoster";

/*
 * --- custom-content --- The fighters and modes the player makes with the Windows app's AI. A fighter is data, built and clamped
 * by fightLeagueCustom.ts, so these tests throw absurd answers at it, play the results through the real fight engine and check
 * that the built-in roster, its hashes and its table never notice.
 */

const BASE: CustomFighterSpec = {
  name: "Shadow Star",
  role: "glass",
  body: "#223355",
  accent: "#ffcc00",
  weapon: { kind: "cards", damage: 5 },
  ability: { name: "Star Veil", primitive: "blinkStrike", params: { n: 3, damage: 5 } },
  description: "A tiny ninja ball that blinks behind its enemy.",
};

afterEach(() => setCustomFighters([]));

const built = (spec: CustomFighterSpec, taken?: ReadonlySet<string>) => {
  const out = buildCustomFighter(spec, taken);
  if (!out.ok) throw new Error(out.errors.join("; "));
  return out;
};

describe("buildCustomFighter", () => {
  it("makes a wildcard row with the my- id, the custom flag and the role's template stats", () => {
    const { row } = built(BASE);
    expect(row.id).toBe("my-shadow-star");
    expect(row.division).toBe("wildcard");
    expect(row.custom).toBe(true);
    expect(row.isNew).toBe(true);
    expect(row.role).toBe("glass");
    // a glass cannon: HP 85–95, speed 1.3–1.8, size 0.7–0.9
    expect(row.stats.hp).toBeGreaterThanOrEqual(85);
    expect(row.stats.hp).toBeLessThanOrEqual(95);
    expect(row.stats.speed).toBeGreaterThanOrEqual(1.3);
    expect(row.stats.size).toBeLessThanOrEqual(0.9);
    expect(row.weapons).toHaveLength(1);
    expect(row.weapons[0].kind).toBe("cards");
    expect(row.ability.charge).toBeGreaterThanOrEqual(FL_CHARGE_RANGE.standard[0]);
    expect(row.ability.charge).toBeLessThanOrEqual(FL_CHARGE_RANGE.standard[1]);
  });

  it("brings absurd numbers inside the bounds and says what it changed", () => {
    const out = built({
      ...BASE,
      role: "tank",
      stats: { hp: 99999, speed: 50, attackSpeed: 99, damage: 99, castSpeed: 99, size: 99 },
      weapon: { kind: "sword", damage: 9999, reach: 500, cooldown: 0.0001, count: 999, homing: 99, style: "chainsaw", color: "not-a-colour" },
      ability: { name: "Everything", primitive: "damageBurst", params: { mult: 1e9, dur: 1e9, knockback: 1e9, evil: 1 } },
    });
    const s = out.row.stats;
    expect([s.hp, s.speed, s.size]).toEqual([130, 0.85, 1.3]);
    expect([s.attackSpeed, s.damage, s.castSpeed]).toEqual([1.3, 2.4, 1.3]); // (the balancer sets these three for a new fighter)
    const w = out.row.weapons[0];
    expect(w.damage).toBeLessThanOrEqual(9.2); // 7 × 1.3
    expect(w.reach).toBeLessThanOrEqual(2.4); // 1.9 × 1.25
    expect(w.cooldown).toBeGreaterThanOrEqual(0.25); // 0.36 × 0.7
    expect(w.homing).toBeLessThanOrEqual(0.4);
    expect(w.style).toBeUndefined(); // "chainsaw" is a look, not a style
    expect(w.color).toBe("#ffcc00"); // the accent
    const e = out.row.ability.effects[0] as { p: string; mult: number; dur: number; knockback: number };
    expect(e.dur).toBe(4);
    expect(e.knockback).toBe(2);
    expect(e.mult).toBeGreaterThanOrEqual(1.3);
    expect(e.mult * e.dur).toBeLessThanOrEqual(6.51); // the damage burst's budget
    expect(e).not.toHaveProperty("evil");
    expect(out.notes.length).toBeGreaterThan(3);
  });

  it("refuses what cannot be repaired: no name, no ability name, no description, no weapon", () => {
    expect(buildCustomFighter({ ...BASE, name: "  " }).ok).toBe(false);
    expect(buildCustomFighter({ ...BASE, ability: { ...BASE.ability, name: "" } }).ok).toBe(false);
    expect(buildCustomFighter({ ...BASE, description: "" }).ok).toBe(false);
    expect(buildCustomFighter({ ...BASE, weapon: undefined as never }).ok).toBe(false);
  });

  it("falls back for unknown roles, colours, kinds and primitives instead of failing", () => {
    const { row } = built({ ...BASE, role: "wizard" as never, body: "red", weapon: { kind: "laser-sword" as never }, ability: { name: "Mystery", primitive: "explode" as never } });
    expect(row.role).toBe("duelist");
    expect(row.body).toBe("#8b5cf6");
    expect(row.weapons[0].kind).toBe("fists");
    expect(row.ability.effects[0].p).toBe("speedBurst");
  });

  it("cleans names and text, makes unique ids and keeps a free stored id", () => {
    expect(plainText("  Hello\u0000 <b>World</b>  ", 40)).toBe("Hello b World /b");
    expect(normaliseColor("#ABC", "#000000")).toBe("#aabbcc");
    expect(normaliseColor("ffcc00", "#000000")).toBe("#ffcc00");
    expect(normaliseColor("nope", "#123456")).toBe("#123456");
    expect(customIdFor("Zoë the Great!", new Set())).toBe("my-zoe-the-great");
    expect(customIdFor("Zoë the Great!", new Set(["my-zoe-the-great"]))).toBe("my-zoe-the-great-2");
    expect(customIdFor("???", new Set())).toBe("my-fighter");
    expect(built({ ...BASE, id: "my-old-one" }).row.id).toBe("my-old-one");
    expect(built({ ...BASE, id: "my-old-one" }, new Set(["my-old-one"])).row.id).toBe("my-shadow-star");
    expect(built({ ...BASE, id: "gerald" }).row.id).toBe("my-shadow-star"); // never a built-in id
  });
});

describe("every ability primitive and weapon kind", () => {
  const extreme = (p: (typeof FL_ABILITY_PRIMITIVES)[number]) => {
    const params: Record<string, number | boolean | string> = {};
    for (const [key, spec] of Object.entries(PRIMITIVE_PARAMS[p])) params[key] = "min" in spec ? 1e9 : "flag" in spec ? true : "shape" in spec ? "ghost" : "choice" in spec ? "end" : "#ff0000";
    return params;
  };

  it("builds from no numbers at all and from extreme ones, inside the primitive's limits and its class's charge time", () => {
    for (const p of FL_ABILITY_PRIMITIVES) {
      for (const params of [undefined, extreme(p), Object.fromEntries(Object.keys(extreme(p)).map((k) => [k, -1e9]))]) {
        const { row } = built({ ...BASE, ability: { name: "Test Move", primitive: p, params } });
        const effect = row.ability.effects[0];
        expect(effect.p).toBe(p);
        expect(flLimitViolations(effect), `${p} ${JSON.stringify(params)}`).toEqual([]);
        const [lo, hi] = FL_CHARGE_RANGE[abilityClass(row.ability)];
        expect(row.ability.charge).toBeGreaterThanOrEqual(lo);
        expect(row.ability.charge).toBeLessThanOrEqual(hi);
        for (const [key, spec] of Object.entries(PRIMITIVE_PARAMS[p])) {
          const v = (effect as unknown as Record<string, unknown>)[key];
          if ("min" in spec && typeof v === "number") {
            expect(v, `${p}.${key}`).toBeGreaterThanOrEqual(spec.min);
            expect(v, `${p}.${key}`).toBeLessThanOrEqual(spec.max);
          }
        }
      }
    }
  });

  it("takes a second primitive but not the same one twice", () => {
    const two = built({ ...BASE, ability: { name: "Combo", primitive: "speedBurst", second: { primitive: "damageBurst" } } });
    expect(two.row.ability.effects.map((e) => e.p)).toEqual(["speedBurst", "damageBurst"]);
    const same = built({ ...BASE, ability: { name: "Combo", primitive: "speedBurst", second: { primitive: "speedBurst" } } });
    expect(same.row.ability.effects).toHaveLength(1);
  });

  it("plays a full fight with every weapon kind and with every primitive, extreme numbers included", () => {
    const specs: CustomFighterSpec[] = [
      ...FL_WEAPON_KINDS.map((kind, i) => ({ ...BASE, name: `Kind ${kind}`, id: `my-k${i}`, weapon: { kind, damage: 1e6, reach: 1e6, cooldown: 1e-6, count: 1e6, size: 1e6, speed: 1e6, spread: 1e6, homing: 1e6 } })),
      ...FL_ABILITY_PRIMITIVES.map((p, i) => ({ ...BASE, name: `Move ${p}`, id: `my-p${i}`, ability: { name: "Move", primitive: p, params: extreme(p) } })),
    ];
    const { rows } = buildCustomFighters(specs);
    expect(rows).toHaveLength(Math.min(MAX_CUSTOM_FIGHTERS, specs.length));
    setCustomFighters(rows);
    for (const row of rows) {
      const v = probeDuel(row.id, "gerald", 3);
      expect(v.fighters[0].row.id).toBe(row.id);
      expect(v.timeMs, row.id).toBeGreaterThan(1500); // past the VS card: the fight was played
      expect(v.fighters.every((f) => Number.isFinite(f.hp) && Number.isFinite(f.x) && Number.isFinite(f.y)), row.id).toBe(true);
      expect(v.fighters[0].hp, row.id).toBeLessThanOrEqual(row.stats.hp * 2);
    }
  }, 180_000);
});

describe("the roster registry", () => {
  const rowsOf = (...names: string[]) => buildCustomFighters(names.map((name) => ({ ...BASE, name }))).rows;

  it("adds custom fighters to the live roster and removes them again", () => {
    const before = FL_ROSTER.length;
    setCustomFighters(rowsOf("Alpha", "Beta"));
    expect(FL_ROSTER.length).toBe(before + 2);
    expect(isFlFighterId("my-alpha")).toBe(true);
    expect(FL_BY_ID.get("my-beta")?.custom).toBe(true);
    expect(fightersOf("wildcard").map((r) => r.id)).toEqual(["gerald", "my-alpha", "my-beta"]);
    expect(FL_ROSTER[FL_ROSTER.length - 1].id).toBe("my-beta"); // division order holds: Wildcard is last
    expect(customFighters().map((r) => r.id)).toEqual(["my-alpha", "my-beta"]);
    setCustomFighters(rowsOf("Gamma")); // replaces
    expect(FL_ROSTER.length).toBe(before + 1);
    expect(isFlFighterId("my-alpha")).toBe(false);
    setCustomFighters([]);
    expect(FL_ROSTER.length).toBe(before);
  });

  it("leaves the built-in roster's hash and README table alone", () => {
    const hash = flRosterHash();
    const table = rosterTableMarkdown();
    setCustomFighters(rowsOf("Alpha"));
    expect(flRosterHash()).toBe(hash);
    expect(rosterTableMarkdown()).toBe(table);
  });

  it("ignores rows that are not custom wildcard rows with a my- id, and clashing ids", () => {
    const [good] = rowsOf("Alpha");
    const before = FL_ROSTER.length;
    setCustomFighters([
      { ...good, id: "my-not-custom", custom: undefined },
      { ...good, id: "my-elsewhere", division: "marvel" },
      { ...good, id: "thor" },
      good,
      { ...good }, // the same id twice
    ]);
    expect(FL_ROSTER.length).toBe(before + 1);
    expect(FL_BY_ID.get("thor")?.custom).toBeUndefined();
  });

  it("tells subscribers and bumps the version", () => {
    let calls = 0;
    const off = subscribeCustomFighters(() => calls++);
    const v = customFightersVersion();
    setCustomFighters(rowsOf("Alpha"));
    setCustomFighters([]);
    off();
    setCustomFighters([]);
    expect(calls).toBe(2);
    expect(customFightersVersion()).toBe(v + 3);
  });

  it("lets a slot name a custom fighter in a match, and a duel finishes", () => {
    setCustomFighters(rowsOf("Alpha"));
    const v = probeDuel("my-alpha", "gerald", 5);
    expect(v.fighters[0].row.id).toBe("my-alpha");
    expect(v.fighters[0].row.name).toBe("Alpha");
    expect(v.timeMs).toBeGreaterThan(5000); // it was played, not skipped
  });
});

describe("the stored document", () => {
  it("rebuilds fighters through the builder, drops the broken, renames clashes and caps the number", () => {
    const many = Array.from({ length: MAX_CUSTOM_FIGHTERS + 10 }, (_, i) => ({ ...BASE, name: `Fighter ${i}`, id: undefined }));
    const { content, rows } = resolveCustomContent({
      fighters: [null, 5, "x", { name: "" }, { ...BASE, id: "thor", stats: { hp: 1e9 } }, ...many],
      modes: "nope",
    });
    expect(rows).toHaveLength(MAX_CUSTOM_FIGHTERS);
    expect(content.fighters).toHaveLength(MAX_CUSTOM_FIGHTERS);
    expect(content.fighters.every((f) => f.id?.startsWith(CUSTOM_ID_PREFIX))).toBe(true);
    expect(rows[0].stats.hp).toBeLessThanOrEqual(95); // 1e9 → the glass template's top
    expect(content.modes).toEqual([]);
    // writing the resolved document and reading it again changes nothing
    expect(resolveCustomContent(JSON.parse(JSON.stringify(content))).content).toEqual(content);
  });

  it("survives anything the file could hold", () => {
    for (const raw of [null, undefined, 5, "text", [], {}, { fighters: 5, modes: 5 }]) {
      const { content, rows } = resolveCustomContent(raw);
      expect(rows).toEqual([]);
      expect(content).toEqual({ version: 1, fighters: [], modes: [] });
    }
  });
});

describe("the AI side of a fighter", () => {
  const answer = {
    name: "Moon Archer",
    role: "ranged",
    body: "#334155",
    accent: "#e2e8f0",
    description: "A calm archer ball that fires silver arrows that bend toward its foe.",
    weapon: { kind: "bow", damage: 8, speed: 1.4 },
    ability: { name: "Silver Rain", primitive: "volley", params: { n: 6, damage: 4, homing: 2 } },
  };

  it("accepts a good answer by the schema and builds it", () => {
    expect(validateJson(CUSTOM_FIGHTER_FINAL, answer)).toEqual([]);
    const out = fighterFromAnswer(answer, new Set(FL_BY_ID.keys()));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.row.weapons[0].kind).toBe("bow");
  });

  it("rejects answers the schema or the builder cannot use", () => {
    expect(validateJson(CUSTOM_FIGHTER_FINAL, { ...answer, role: "wizard" }).length).toBeGreaterThan(0);
    expect(validateJson(CUSTOM_FIGHTER_FINAL, { ...answer, weapon: { kind: "laser" } }).length).toBeGreaterThan(0);
    expect(validateJson(CUSTOM_FIGHTER_FINAL, { ...answer, ability: { name: "x", primitive: "nuke" } }).length).toBeGreaterThan(0);
    expect(validateJson(CUSTOM_FIGHTER_FINAL, { name: "Only a name" }).length).toBeGreaterThan(0);
    expect(fighterFromAnswer({ name: "Nothing" }, new Set()).ok).toBe(false);
    expect(specFromAnswer(null)).toBeNull();
  });

  it("describes every primitive and weapon kind in the prompt and checks the answer in the task", () => {
    const catalog = primitiveCatalog();
    for (const p of FL_ABILITY_PRIMITIVES) expect(catalog).toContain(`${p}:`);
    for (const k of FL_WEAPON_KINDS) expect(weaponCatalog()).toContain(k);
    const task = customFighterTask("a moon archer", "en", new Set(FL_BY_ID.keys()));
    expect(task.name).toBe("fighter");
    expect(task.system).toContain("volley:");
    expect(task.checkFinal?.(answer)).toEqual([]);
    expect(task.checkFinal?.({ name: "Nothing" }).length).toBeGreaterThan(0);
  });
});

describe("the AI side of a mode", () => {
  const current = defaultSettings();
  const good = { name: "Slow Fill", description: "Many soft balls drift down and fill the glass.", changes: [{ setting: "mode", value: "classic" }, { setting: "ballCount", value: 12 }, { setting: "gravity", value: 300 }], summary: "Calmer." };

  it("builds a mode from a valid answer, snapped by the settings check", () => {
    expect(validateJson({ ...CUSTOM_MODE_FINAL, properties: { ...CUSTOM_MODE_FINAL.properties, changes: { type: "array" } } }, good)).toEqual([]);
    const task = customModeTask("a calm filling mode", current, "en");
    expect(task.name).toBe("mode");
    expect(task.checkFinal?.(good)).toEqual([]);
    const spec = customModeFrom(good, current, new Set());
    expect(spec?.id).toBe("mymode-slow-fill");
    expect(spec?.patch.mode).toBe("classic");
    expect(spec?.patch.ballCount).toBe(12);
    expect(customModeFrom(good, current, new Set(["mymode-slow-fill"]))?.id).toBe("mymode-slow-fill-2");
  });

  it("rejects an answer without a base mode, with an unknown mode or setting, or with a nameless mode", () => {
    const task = customModeTask("x", current, "en");
    expect(task.checkFinal?.({ ...good, changes: [{ setting: "ballCount", value: 12 }] })[0]).toMatch(/mode/);
    expect(task.checkFinal?.({ ...good, changes: [{ setting: "mode", value: "warp-drive" }] }).length).toBeGreaterThan(0);
    expect(task.checkFinal?.({ ...good, changes: [{ setting: "mode", value: "classic" }, { setting: "teleport", value: 1 }] }).length).toBeGreaterThan(0);
    expect(customModeFrom({ ...good, name: "" }, current, new Set())).toBeNull();
  });

  it("cleans a stored list of modes", () => {
    const ok = { id: "mymode-a", name: "A mode", description: "does things", patch: { mode: "classic", ballCount: 3 }, createdAt: "2026-10-13" };
    const out = sanitizeCustomModes([ok, ok, { ...ok, id: "bad id" }, { ...ok, id: "mymode-b", patch: { ballCount: 3 } }, { ...ok, id: "mymode-c", patch: { mode: "classic", "__proto__": 1, "a b": 2, x: { y: 1 } } }, null, 7]);
    expect(out.map((m) => m.id)).toEqual(["mymode-a", "mymode-c"]);
    expect(out[1].patch).toEqual({ mode: "classic" });
    expect(sanitizeCustomModes(Array.from({ length: 60 }, (_, i) => ({ ...ok, id: `mymode-${i}` })))).toHaveLength(MAX_CUSTOM_MODES);
    expect(sanitizeCustomModes("nope")).toEqual([]);
  });
});

describe("the bridge", () => {
  it("carries custom.load and custom.save on their own channels and checks what is saved", () => {
    expect(BRIDGE_METHODS["custom.load"]).toBe("custom:load");
    expect(BRIDGE_METHODS["custom.save"]).toBe("custom:save");
    expect(Object.values(IPC)).toContain("custom:save");
    expect(checkIpcArgs(IPC.customSave, [{ version: 1, fighters: [], modes: [] }])).toBeNull();
    expect(checkIpcArgs(IPC.customSave, [undefined])).not.toBeNull();
    expect(checkIpcArgs(IPC.customSave, [[1, 2]])).not.toBeNull();
    expect(checkIpcArgs(IPC.customSave, ["text"])).not.toBeNull();
    expect(checkIpcArgs(IPC.customSave, [{ big: "x".repeat(1_100_000) }])).not.toBeNull();
  });
});

describe("the balancer", () => {
  const strong: CustomFighterSpec = {
    ...BASE,
    id: "my-tester",
    name: "Overkill",
    role: "tank",
    stats: { hp: 999, damage: 9, attackSpeed: 9, castSpeed: 9 },
    weapon: { kind: "shotgun", damage: 1e6, count: 1e6, cooldown: 1e-6 },
    ability: { name: "Everything", primitive: "damageBurst", params: { mult: 1e9, dur: 1e9 } },
  };
  const heldOut = (spec: CustomFighterSpec) => {
    const b = built(spec);
    return withTemporaryFighter(b.row, () => panelWinRate(b.row.id, BALANCE_PANEL, [5, 6, 7, 8]));
  };

  it("sets damage, attack speed and cast speed from one strength scale", () => {
    const lo = strengthStats(0);
    const mid = strengthStats(0.5);
    const hi = strengthStats(1);
    expect(lo).toEqual({ damage: 0.45, attackSpeed: 0.85, castSpeed: 0.7 });
    expect(hi).toEqual({ damage: 2.4, attackSpeed: 1.25, castSpeed: 1.3 });
    expect(mid.damage).toBeGreaterThan(lo.damage);
    expect(mid.damage).toBeLessThan(hi.damage);
    expect(strengthStats(-5)).toEqual(lo);
    expect(strengthStats(9)).toEqual(hi);
  });

  it("brings an overpowered fighter to a win rate inside the built-in range, also on seeds it never played", async () => {
    const progress: number[] = [];
    const result = await balanceCustomFighter(strong, { yieldNow: async () => {}, onProgress: (done) => progress.push(done) });
    expect(result.before).toBeGreaterThan(0.7);
    expect(result.after).toBeGreaterThanOrEqual(BALANCE_WINDOW[0] - 0.05);
    expect(result.after).toBeLessThanOrEqual(BALANCE_WINDOW[1] + 0.05);
    expect(result.spec.stats?.damage).toBeLessThan(1.2);
    expect(result.spec.id).toBe("my-tester");
    expect(progress.length).toBeGreaterThan(0);
    expect(heldOut(result.spec)).toBeLessThanOrEqual(0.72);
  }, 180_000);

  it("lifts a hopeless fighter instead of leaving it, and never changes anything but the three power stats", async () => {
    const weak: CustomFighterSpec = { ...BASE, id: "my-weakling", name: "Weakling", role: "tank", stats: { damage: 0.45, attackSpeed: 0.8, castSpeed: 0.7 }, weapon: { kind: "hammer" } };
    const result = await balanceCustomFighter(weak, { yieldNow: async () => {} });
    expect(result.after).toBeGreaterThanOrEqual(result.before);
    expect(result.spec.stats?.damage).toBeGreaterThan(0.45);
    const a = built(weak).row;
    const b = built(result.spec).row;
    expect({ ...b, stats: { ...b.stats, damage: 0, attackSpeed: 0, castSpeed: 0 }, ability: { ...b.ability, charge: 0 } }).toEqual({ ...a, stats: { ...a.stats, damage: 0, attackSpeed: 0, castSpeed: 0 }, ability: { ...a.ability, charge: 0 } });
  }, 180_000);

  it("can be stopped, and leaves the roster as it found it", async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(
      balanceCustomFighter(strong, {
        signal: controller.signal,
        yieldNow: async () => {
          if (++calls === 2) controller.abort();
        },
      }),
    ).rejects.toThrow(/cancelled/);
    expect(FL_BY_ID.has("my-tester")).toBe(false);
    const remove = addTemporaryFighter(built(strong).row);
    expect(FL_BY_ID.has("my-tester")).toBe(true);
    remove();
    expect(FL_BY_ID.has("my-tester")).toBe(false);
    expect(FL_ROSTER.some((r) => r.custom)).toBe(false);
  }, 120_000);

  it("uses a panel of twelve built-in fighters from several divisions", () => {
    expect(BALANCE_PANEL.every((id) => FL_BY_ID.has(id))).toBe(true);
    expect(new Set(BALANCE_PANEL.map((id) => FL_BY_ID.get(id)?.division)).size).toBeGreaterThanOrEqual(8);
  });
});
