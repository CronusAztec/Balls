import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_IDS, type ModeId, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { wallHitFrequency } from "@/lib/audio/sampler";
import { MULTIPLY_MAX_BALLS } from "@/lib/physics/modes/multiply";
import { BOX_WALL_NOTES } from "@/lib/physics/modes/box";
import { BM_BOUNCE, BounceMathRuntime, PITCH_MAX_HZ, bounceHitEvent, bounceParamApplies, bounceTriggerApplies, pitchedFrequency, resizeTrail } from "@/lib/physics/bounceMathRuntime";
import { createEngineForSettings, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { buildProject, parseProject, serializeProject } from "@/lib/project";
import { decodeShareCode, encodeShareCode, supportsShareCodes } from "@/lib/shareCode";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import {
  BOUNCE_MATH_PRESETS,
  BOUNCE_MATH_PRESET_IDS,
  BOUNCE_OPS,
  BOUNCE_PARAMS,
  BOUNCE_TRIGGERS,
  FLOAT_CEILING,
  MAX_BOUNCE_RULES,
  MAX_FORMULA_LENGTH,
  MAX_GAP,
  MAX_TRAIL_POINTS,
  addRule,
  amountComfortRange,
  appendPreset,
  applyRule,
  bounceMathBeatConfig,
  bounceMathCarryOver,
  bounceMathConfigOf,
  compileFormula,
  compileRule,
  defaultRule,
  evaluateFormula,
  formatBounceValue,
  moveRule,
  parseColorHsl,
  parseRule,
  parseRules,
  removeRule,
  resolveBounceMathFields,
  resolveRules,
  rotateHue,
  sanitizeRule,
  serializeRule,
  serializeRules,
  updateRule,
  type BounceMathConfig,
  type BounceRule,
  type RuleContext,
} from "@/lib/simulation/bounceMath";

/**
 * Bounce math (lib/simulation/bounceMath.ts + lib/physics/bounceMathRuntime.ts): the formula parser, every operation, the
 * clamps and the rejection of meaningless results, the URL form, rule order, and the engine – every trigger (bounce, pass,
 * collide, break, beat, bar, second, start) firing where the engine handles it, deterministic replays, the beat trigger on a
 * song grid, per-ball vs all scope, world values restored per run, and the finder / fast export (engines built from the page
 * engine's config) replaying a rule run exactly.
 */

const config: PhysicsConfig = {
  width: 800,
  height: 600,
  gravity: 300,
  bounce: 1,
  damping: 0,
  ballSpeed: 400,
  rotationSpeed: 1,
  wallCount: 7,
  gapSize: 0.4,
  ballColor: "#ffffff",
  ballRadius: 8,
  audioIntensity: 0,
};

const modeSettings: ModeSettings = {
  bouncierEnabled: false,
  countdownTotal: 10,
  countdownRandom: false,
  colorMatchColorCount: 7,
  accumulationTimerMax: 4000,
  spikesEnabled: false,
  spikeCount: 6,
  multiplySpawnCount: 3,
  shatterSegmentsPerWall: 18,
  shatterHpPerSegment: 1,
  growRate: 5,
  portalCount: 3,
  twoBalls: false,
  drop: {},
  box: {},
};

const STEP = 1000 / 60;

const rule = (patch: Partial<BounceRule> = {}): BounceRule => ({ param: "bounciness", trigger: "bounce", every: 1, op: "multiply", amount: 1.05, scope: "ball", ...patch });

function bmConfig(rules: BounceRule[], beat = bounceMathBeatConfig(120)): BounceMathConfig {
  return { rules, beat, wallThickness: 2, wallWobble: 0, showValues: true };
}

function makeEngine(rules: BounceRule[] | null, mode: ModeId = "classic", seed = 7, extra: Partial<PhysicsConfig> = {}, beat?: BounceMathConfig["beat"]) {
  const engine = new PhysicsEngine({ ...config, ...extra, ...(rules ? { bounceMath: bmConfig(rules, beat) } : {}) });
  engine.setSeed(seed);
  engine.initMode(mode);
  return engine;
}

function run(engine: PhysicsEngine, seconds: number, onStep?: () => void) {
  const steps = Math.round((seconds * 1000) / STEP);
  for (let i = 0; i < steps; i++) {
    engine.update(STEP, 0);
    onStep?.();
  }
}

function trace(engine: PhysicsEngine, seconds: number): number[][] {
  const out: number[][] = [];
  const steps = Math.round((seconds * 1000) / STEP);
  for (let i = 0; i < steps; i++) {
    engine.update(STEP, 0);
    engine.consumeSoundEvents();
    if (i % 20 === 0) out.push(engine.getBalls().flatMap((b) => [b.x, b.y, b.radius, b.restitution ?? 1]));
  }
  return out;
}

const ctxOf = (n = 1, t = 0, b = 0, random = () => 0.5): RuleContext => ({ n, t, b, random });

/* ------------------------------------------------------------------ formulas */

describe("the formula parser", () => {
  const value = (text: string, vars = { v: 2, n: 3, t: 1.5, b: 4, r: 0.25 }) => {
    const result = compileFormula(text);
    if (!result.ok) throw new Error(`${text}: ${result.error.code}`);
    return evaluateFormula(result.formula, vars);
  };

  it("follows the usual precedence: ^ before unary minus before * / before + −, left to right, ^ right-associative", () => {
    expect(value("1 + 2 * 3")).toBe(7);
    expect(value("(1 + 2) * 3")).toBe(9);
    expect(value("10 - 4 - 3")).toBe(3);
    expect(value("12 / 3 / 2")).toBe(2);
    expect(value("2 ^ 3 ^ 2")).toBe(512);
    expect(value("-2 ^ 2")).toBe(-4);
    expect(value("(-2) ^ 2")).toBe(4);
    expect(value("2 ^ -1")).toBe(0.5);
    expect(value("--3")).toBe(3);
    expect(value("-v * 2")).toBe(-4);
    expect(value("1 + -2")).toBe(-1);
  });

  it("reads numbers, the variables and the constants", () => {
    expect(value(".5")).toBe(0.5);
    expect(value("1e3")).toBe(1000);
    expect(value("2.5e-1")).toBe(0.25);
    expect(value("v + n + t + b + r")).toBe(2 + 3 + 1.5 + 4 + 0.25);
    expect(value("pi")).toBeCloseTo(Math.PI, 12);
    expect(value("e")).toBeCloseTo(Math.E, 12);
    expect(value("PI * V")).toBeCloseTo(2 * Math.PI, 12);
  });

  it("knows its functions", () => {
    expect(value("sin(pi / 2)")).toBeCloseTo(1, 12);
    expect(value("cos(0)")).toBe(1);
    expect(value("tan(0)")).toBe(0);
    expect(value("abs(-3)")).toBe(3);
    expect(value("sqrt(16)")).toBe(4);
    expect(value("pow(2, 10)")).toBe(1024);
    expect(value("min(3, 1, 2)")).toBe(1);
    expect(value("max(3, 1, 2, 7)")).toBe(7);
    expect(value("floor(1.7)")).toBe(1);
    expect(value("ceil(1.2)")).toBe(2);
    expect(value("round(2.5)")).toBe(3);
    expect(value("log(e)")).toBeCloseTo(1, 12);
    expect(value("exp(0)")).toBe(1);
    expect(value("clamp(5, 0, 3)")).toBe(3);
    expect(value("clamp(-5, 0, 3)")).toBe(0);
    expect(value("v * (1 + 0.1 * sin(n / 3))")).toBeCloseTo(2 * (1 + 0.1 * Math.sin(1)), 12);
  });

  it("names what is wrong and where", () => {
    const error = (text: string) => {
      const result = compileFormula(text);
      return result.ok ? null : result.error;
    };
    expect(error("")?.code).toBe("empty");
    expect(error("   ")?.code).toBe("empty");
    expect(error("1 +")?.code).toBe("unexpected");
    expect(error("1 2")?.code).toBe("unexpected");
    expect(error("2v")?.code).toBe("unexpected");
    expect(error("1..2")?.code).toBe("unexpected");
    expect(error("(1 + 2")?.code).toBe("unclosed");
    expect(error("sin(1")?.code).toBe("unclosed");
    expect(error("foo")).toEqual({ code: "unknownName", at: 0, name: "foo" });
    expect(error("v + speed")).toEqual({ code: "unknownName", at: 4, name: "speed" });
    expect(error("sin(1, 2)")).toMatchObject({ code: "arity", name: "sin" });
    expect(error("pow(1)")?.code).toBe("arity");
    expect(error("min(1)")?.code).toBe("arity");
    expect(error("clamp(1, 2)")?.code).toBe("arity");
    expect(error("x".repeat(MAX_FORMULA_LENGTH + 1))?.code).toBe("tooLong");
  });

  it("never runs the text as code (no eval, no Function)", () => {
    for (const text of ["alert(1)", "process.exit(1)", "constructor", "toString", "__proto__", "hasOwnProperty(v)", "this", "globalThis", "v; 1", "`1`", "'1'", "[1]", "{}", "v = 3"]) expect(compileFormula(text).ok, text).toBe(false);
    const code = readFileSync(path.resolve(__dirname, "../src/lib/simulation/bounceMath.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\beval\s*\(/);
    expect(code).not.toMatch(/new\s+Function/);
  });

  it("compiles once and evaluates on its own stack, the same every time", () => {
    const result = compileFormula("max(v, 1) * (2 + t) ^ 2 - clamp(r, 0, 1)");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const vars = { v: 3, n: 1, t: 1, b: 0, r: 0.5 };
    const first = evaluateFormula(result.formula, vars);
    for (let i = 0; i < 1000; i++) expect(evaluateFormula(result.formula, vars)).toBe(first);
    expect(first).toBe(3 * 9 - 0.5);
    expect(result.formula.usesR).toBe(true);
    expect((compileFormula("v * 2") as { ok: true; formula: { usesR: boolean } }).formula.usesR).toBe(false);
  });
});

/* ------------------------------------------------------------------ operations */

describe("applyRule", () => {
  it("applies every operation", () => {
    const at = (op: BounceRule["op"], v: number, amount: number, param: BounceRule["param"] = "gravity") => applyRule(v, rule({ param, op, amount }), ctxOf(1, 0, 0, () => 0.75));
    expect(at("add", 10, 5)).toBe(15);
    expect(at("subtract", 10, 5)).toBe(5);
    expect(at("multiply", 10, 1.5)).toBe(15);
    expect(at("divide", 10, 4)).toBe(2.5);
    expect(at("power", 3, 2)).toBe(9);
    expect(at("root", 16, 2)).toBe(4);
    expect(at("root", -8, 3)).toBeCloseTo(-2, 12);
    expect(at("modulo", 7, 3)).toBe(1);
    expect(at("modulo", -30, 360, "hue")).toBe(330);
    expect(at("set", 10, 42)).toBe(42);
    expect(at("random", 10, 4)).toBe(12); // 10 + (2 · 0.75 − 1) · 4
    expect(applyRule(10, rule({ param: "gravity", op: "formula", formula: "v * n + t + b" }), ctxOf(3, 2, 1))).toBe(33);
  });

  it("draws a random number only for random rules and formulas that read r", () => {
    let draws = 0;
    const random = () => {
      draws++;
      return 0.5;
    };
    applyRule(1, rule({ op: "multiply" }), ctxOf(1, 0, 0, random));
    applyRule(1, rule({ op: "formula", formula: "v * 2" }), ctxOf(1, 0, 0, random));
    expect(draws).toBe(0);
    applyRule(1, rule({ op: "random", amount: 0.1 }), ctxOf(1, 0, 0, random));
    applyRule(1, rule({ op: "formula", formula: "v + r" }), ctxOf(1, 0, 0, random));
    expect(draws).toBe(2);
  });

  it("clamps to the rule's own min / max – and has no upper limit without one", () => {
    expect(applyRule(8, rule({ param: "size", op: "multiply", amount: 2, max: 10 }), ctxOf())).toBe(10);
    expect(applyRule(8, rule({ param: "size", op: "multiply", amount: 0.1, min: 4 }), ctxOf())).toBe(4);
    let v = 1;
    for (let i = 0; i < 400; i++) v = applyRule(v, rule({ op: "multiply", amount: 1.05 }), ctxOf());
    expect(v).toBeCloseTo(Math.pow(1.05, 400), -5);
    expect(v).toBeGreaterThan(1e8);
  });

  it("rejects NaN, ±Infinity and values the parameter cannot mean – the value stays as it was", () => {
    expect(applyRule(8, rule({ param: "size", op: "divide", amount: 0 }), ctxOf())).toBe(8);
    expect(applyRule(8, rule({ param: "size", op: "subtract", amount: 20 }), ctxOf())).toBe(8);
    expect(applyRule(8, rule({ param: "size", op: "set", amount: 0 }), ctxOf())).toBe(8);
    expect(applyRule(400, rule({ param: "speed", op: "multiply", amount: -1 }), ctxOf())).toBe(400);
    expect(applyRule(1, rule({ param: "bounciness", op: "subtract", amount: 2 }), ctxOf())).toBe(1);
    expect(applyRule(4, rule({ param: "gravity", op: "formula", formula: "sqrt(-v)" }), ctxOf())).toBe(4);
    expect(applyRule(4, rule({ param: "gravity", op: "formula", formula: "v / 0" }), ctxOf())).toBe(4);
    expect(applyRule(4, rule({ param: "gravity", op: "modulo", amount: 0 }), ctxOf())).toBe(4);
    expect(applyRule(4, rule({ param: "gravity", op: "root", amount: 0 }), ctxOf())).toBe(4);
    // Negative values that mean something are fine: gravity upwards, a reversed spin, a lower pitch.
    expect(applyRule(300, rule({ param: "gravity", op: "multiply", amount: -1 }), ctxOf())).toBe(-300);
    expect(applyRule(1, rule({ param: "rotation", op: "subtract", amount: 3 }), ctxOf())).toBe(-2);
    expect(applyRule(0, rule({ param: "pitch", op: "subtract", amount: 12 }), ctxOf())).toBe(-12);
  });

  it("clamps at physical ceilings and the float ceiling, and rounds counts", () => {
    expect(applyRule(0.4, rule({ param: "gap", op: "add", amount: 100 }), ctxOf())).toBe(MAX_GAP);
    expect(applyRule(0.01, rule({ param: "damping", op: "multiply", amount: 1000 }), ctxOf())).toBe(0.99);
    expect(applyRule(20, rule({ param: "trail", op: "multiply", amount: 1000 }), ctxOf())).toBe(MAX_TRAIL_POINTS);
    expect(applyRule(3, rule({ param: "balls", op: "multiply", amount: 1.5 }), ctxOf())).toBe(5); // 4.5 rounds to 5
    expect(applyRule(1e14, rule({ param: "bounciness", op: "multiply", amount: 1000 }), ctxOf())).toBe(FLOAT_CEILING);
    expect(applyRule(-1e14, rule({ param: "gravity", op: "multiply", amount: 1000 }), ctxOf())).toBe(-FLOAT_CEILING);
  });

  it("gives the amount slider a comfort range only", () => {
    expect(amountComfortRange("bounciness", "multiply")).toEqual({ min: 0, max: 3, step: 0.01 });
    expect(amountComfortRange("gravity", "multiply").min).toBe(-3);
    const add = amountComfortRange("speed", "add");
    expect(add.min).toBeLessThan(0);
    expect(add.max).toBe(800);
    // …while a rule itself takes any finite amount
    expect(sanitizeRule(rule({ op: "add", amount: 123456 }))?.amount).toBe(123456);
  });
});

/* ------------------------------------------------------------------ validation and the URL */

describe("validation and the URL form", () => {
  const RULES: BounceRule[] = [
    rule(),
    rule({ param: "speed", op: "multiply", amount: 1.05, every: 3 }),
    rule({ param: "size", op: "add", amount: 1, min: 4, max: 60.5 }),
    rule({ param: "gravity", trigger: "bar", op: "multiply", amount: -1, scope: "all" }),
    rule({ param: "hue", trigger: "second", op: "add", amount: 1.5e-7 }),
    rule({ param: "pitch", trigger: "beat", op: "random", amount: 12, max: 24 }),
    rule({ param: "speed", op: "formula", amount: 0, formula: "v * (1 + 0.1 * sin(n / 3))" }),
    rule({ param: "size", trigger: "start", op: "formula", amount: 0, formula: "clamp(v * 1.5, 0.5, 20.25) - -1e3", scope: "all" }),
    rule({ param: "balls", trigger: "break", op: "set", amount: 1e21 }),
  ];

  it("writes param.trigger.every.op.amount[.min][.max][.scope] joined by ';' and reads it back exactly", () => {
    expect(serializeRule(RULES[0])).toBe("bounciness.bounce.1.multiply.1_05");
    expect(serializeRule(RULES[2])).toBe("size.bounce.1.add.1.4.60_5");
    expect(serializeRule(RULES[3])).toBe("gravity.bar.1.multiply.-1...all");
    const text = serializeRules(RULES);
    expect(text.split(";")).toHaveLength(RULES.length);
    expect(parseRules(text)).toEqual(RULES);
    // through a real URL (URLSearchParams percent-encodes what it must)
    const url = new URL(`https://example.com/en/simulator/?${new URLSearchParams({ bmr: text }).toString()}`);
    expect(parseRules(url.searchParams.get("bmr"))).toEqual(RULES);
  });

  it("is tolerant: invalid rules are dropped, the rest stays", () => {
    const text = ["size.bounce.1.add.1", "bogus", "speed.nope.1.add.1", "speed.bounce.1.explode.2", "size.bounce.x.add.nan", "gravity.bar.1.multiply.-1", "speed.bounce.1.formula.v%20%2B%20speed", "", "hue.second.0.add.30.."].join(";");
    const rules = parseRules(text);
    expect(rules.map((r) => r.param)).toEqual(["size", "gravity", "hue"]);
    expect(rules[2].every).toBe(1);
    expect(parseRules(null)).toEqual([]);
    expect(parseRule("size.bounce")).toBeNull();
  });

  it("validates presets and project lists: unknown values, bad numbers and broken formulas are dropped, min > max swapped", () => {
    expect(sanitizeRule({ ...rule(), param: "mass" })).toBeNull();
    expect(sanitizeRule({ ...rule(), amount: Infinity })).toBeNull();
    expect(sanitizeRule({ ...rule(), op: "formula", formula: "v +" })).toBeNull();
    expect(sanitizeRule({ ...rule(), every: 0 })?.every).toBe(1);
    expect(sanitizeRule({ ...rule(), every: 2.7 })?.every).toBe(2);
    expect(sanitizeRule({ ...rule(), min: 5, max: 2 })).toMatchObject({ min: 2, max: 5 });
    expect(sanitizeRule({ ...rule(), scope: "planet" })?.scope).toBe("ball");
    expect(sanitizeRule({ ...rule(), formula: "v * 2" })?.formula).toBeUndefined();
    const many = Array.from({ length: MAX_BOUNCE_RULES + 5 }, () => rule());
    expect(resolveRules(many)).toHaveLength(MAX_BOUNCE_RULES);
    expect(resolveRules("nope")).toEqual([]);
  });

  it("round-trips through the settings URL (bmr, bmh), presets, project files and share codes – next to the beat markers' bm", async () => {
    const s: SimulatorSettings = { ...defaultSettings("classic"), bounceMath: RULES, bounceMathHud: false, beatSource: "manual", beatMarkers: "250.500*7" };
    const params = settingsToSearchParams(s);
    expect(params.get("bmr")).toBe(serializeRules(RULES));
    expect(params.get("bmh")).toBe("0");
    expect(params.get("bm")).toBe("250.500*7");
    const back = settingsFromSearchParams(new URLSearchParams(params.toString()));
    expect(back.bounceMath).toEqual(RULES);
    expect(back.bounceMathHud).toBe(false);
    expect(back.beatMarkers).toBe("250.500*7");
    // defaults: nothing written
    expect(settingsToSearchParams(defaultSettings("classic")).has("bmr")).toBe(false);
    expect(settingsFromSearchParams(new URLSearchParams("mode=grow")).bounceMath).toEqual([]);
    // presets
    const preset = presetToSettings({ mode: "classic", bounceMath: [...RULES, { param: "nope" } as unknown as BounceRule], bounceMathHud: "yes" as unknown as boolean });
    expect(preset.bounceMath).toEqual(RULES);
    expect(preset.bounceMathHud).toBe(true);
    // project files
    const file = parseProject(serializeProject(buildProject({ name: "rules", settings: s })));
    expect(file.ok).toBe(true);
    if (file.ok) expect(file.project.settings.bounceMath).toEqual(RULES);
    // share codes
    if (supportsShareCodes()) {
      const code = await encodeShareCode(params);
      const decoded = await decodeShareCode(code!);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(settingsFromSearchParams(decoded.params).bounceMath).toEqual(RULES);
    }
  });

  it("carries over to another mode and fills the fields from anything", () => {
    const s = { ...defaultSettings("classic"), bounceMath: [rule()], bounceMathHud: false };
    expect(bounceMathCarryOver(s)).toEqual({ bounceMath: [rule()], bounceMathHud: false });
    expect(resolveBounceMathFields(null)).toEqual({ bounceMath: [], bounceMathHud: true });
    expect(defaultSettings("grow").bounceMath).toEqual([]);
  });

  it("edits the list: add, update (re-validated), move, remove, presets appended", () => {
    let list = addRule([], defaultRule());
    expect(list).toEqual([defaultRule()]);
    list = updateRule(list, 0, { op: "formula" });
    expect(list[0].op).toBe("formula");
    expect(list[0].formula).toBe("v * 1.05");
    expect(updateRule(list, 0, { formula: "v +" })).toEqual(list); // an invalid edit keeps the rule
    list = updateRule(list, 0, { op: "add", min: 1 });
    expect(list[0]).toMatchObject({ op: "add", min: 1 });
    expect(list[0].formula).toBeUndefined();
    list = updateRule(list, 0, { min: undefined });
    expect("min" in list[0]).toBe(false);
    list = appendPreset(list, "beatPump");
    expect(list.map((r) => r.trigger)).toEqual(["bounce", "beat", "second"]);
    expect(moveRule(list, 2, -1).map((r) => r.trigger)).toEqual(["bounce", "second", "beat"]);
    expect(moveRule(list, 0, -1)).toEqual(list);
    expect(removeRule(list, 1).map((r) => r.trigger)).toEqual(["bounce", "second"]);
  });

  it("has the six presets of the owner's brief, all valid", () => {
    expect([...BOUNCE_MATH_PRESET_IDS]).toEqual(["bouncier", "faster", "growing", "beatPump", "gravityFlip", "chaos"]);
    for (const id of BOUNCE_MATH_PRESET_IDS) for (const r of BOUNCE_MATH_PRESETS[id]) expect(sanitizeRule(r), id).toEqual(r);
    expect(BOUNCE_MATH_PRESETS.bouncier).toEqual([rule({ param: "bounciness", op: "multiply", amount: 1.05 })]);
    expect(BOUNCE_MATH_PRESETS.gravityFlip[0]).toMatchObject({ param: "gravity", trigger: "bar", op: "multiply", amount: -1 });
    expect(BOUNCE_MATH_PRESETS.chaos[0].formula).toBe("v * (1 + 0.1 * sin(n / 3))");
    expect(BOUNCE_PARAMS.length).toBe(14);
    expect(BOUNCE_TRIGGERS.length).toBe(8);
    expect(BOUNCE_OPS.length).toBe(10);
  });

  it("turns colours and formats values", () => {
    expect(rotateHue("#ff0000", 120)).toBe("#00ff00");
    expect(rotateHue("#f00", -120)).toBe("#0000ff");
    expect(rotateHue("hsl(0, 100%, 50%)", 240)).toBe("#0000ff");
    expect(rotateHue("not a colour", 90)).toBe("not a colour");
    // White, black and greys have no hue to turn: they turn from a saturated colour of a similar lightness, so a shift shows.
    for (const grey of ["#FFFFFF", "#ffffff", "#fff", "#808080", "#000000", "#fcfcfc"]) {
      const turned = rotateHue(grey, 90);
      expect(turned, grey).not.toBe(grey.toLowerCase());
      const hsl = parseColorHsl(turned)!;
      expect(hsl.s, grey).toBeGreaterThan(0.5);
      expect(hsl.l, grey).toBeGreaterThanOrEqual(0.44);
      expect(hsl.l, grey).toBeLessThanOrEqual(0.66);
      expect(hsl.h, grey).toBeCloseTo(90, 0);
    }
    expect(rotateHue("#FFFFFF", 90)).not.toBe("#ffffff");
    expect(rotateHue("#808080", 120)).not.toBe("#808080");
    expect(rotateHue("#FFFFFF", 0)).toBe("#FFFFFF");
    expect(rotateHue("#ffffff", 30)).not.toBe(rotateHue("#ffffff", 60));
    expect(formatBounceValue(1.05)).toBe("1.05");
    expect(formatBounceValue(812.4)).toBe("812");
    expect(formatBounceValue(12345)).toBe("12.3k");
    expect(formatBounceValue(Infinity)).toBe("∞");
  });
});

/* ------------------------------------------------------------------ the engine */

describe("bounce math in the engine", () => {
  it("leaves a run without rules exactly as it was (an empty list included)", () => {
    const plain = trace(makeEngine(null, "classic", 11), 8);
    const empty = trace(makeEngine([], "classic", 11), 8);
    expect(empty).toEqual(plain);
    const multiply = trace(makeEngine(null, "multiply", 3), 6);
    expect(trace(makeEngine([], "multiply", 3), 6)).toEqual(multiply);
  });

  it("fires on every wall bounce: 'Bouncier every bounce' multiplies the ball's bounciness per bounce", () => {
    const engine = makeEngine(BOUNCE_MATH_PRESETS.bouncier.map((r) => ({ ...r })), "classic", 7);
    let bounces = 0;
    run(engine, 3, () => {
      bounces += engine.consumeSoundEvents().filter((e) => e.type === "hit").length;
    });
    const view = engine.getBounceMathView();
    expect(view.fires[0]).toBeGreaterThan(5);
    expect(view.fires[0]).toBe(bounces);
    expect(engine.getBalls()[0].restitution).toBeCloseTo(Math.pow(1.05, view.fires[0]), 6);
    expect(view.bounciness).toBeCloseTo(engine.getBalls()[0].restitution!, 9);
  });

  it("fires on gap passes and wall breaks, once each", () => {
    const engine = makeEngine([rule({ trigger: "pass", param: "hue", op: "add", amount: 10 }), rule({ trigger: "break", param: "pitch", op: "add", amount: 1 })], "classic", 7);
    let gaps = 0;
    run(engine, 40, () => {
      gaps += engine.consumeSoundEvents().filter((e) => e.type === "gap").length;
    });
    const view = engine.getBounceMathView();
    expect(gaps).toBeGreaterThan(1);
    expect(view.fires[0]).toBe(engine.getBrokenWalls().size);
    expect(view.fires[1]).toBe(gaps);
    expect(engine.getBalls()[0].pitchShift).toBe(gaps);
    expect(engine.getBalls()[0].hueShift).toBe(10 * view.fires[0]);
  });

  it("fires on ball-to-ball hits, for both balls with the ball scope", () => {
    const engine = makeEngine([rule({ trigger: "collide", param: "hue", op: "add", amount: 1 })], "classic", 3, { ballCount: 6 });
    run(engine, 20);
    const fires = engine.getBounceMathView().fires[0];
    expect(fires).toBeGreaterThan(0);
    const shifted = engine.getBalls().reduce((sum, b) => sum + (b.hueShift ?? 0), 0);
    expect(shifted).toBe(2 * fires);
  });

  it("fires on the beat, every bar and every second of run time – 120 BPM is two beats a second", () => {
    const engine = makeEngine(
      [rule({ trigger: "beat", param: "gravity", op: "add", amount: 1 }), rule({ trigger: "bar", param: "hue", op: "add", amount: 1 }), rule({ trigger: "second", param: "pitch", op: "add", amount: 1 }), rule({ trigger: "start", param: "size", op: "set", amount: 12 })],
      "classic",
      3,
    );
    engine.update(STEP, 0);
    expect(engine.getBounceMathView().fires).toEqual([1, 1, 0, 1]); // beat 0 (a bar) at 0 s and the start
    expect(engine.getBalls()[0].radius).toBe(12);
    run(engine, 10.2 - 1 / 60);
    // beats at 0, 0.5 … 10 s: 21; bars on beats 0, 4, 8 … 20: 6; seconds 1 … 10: 10; start once
    expect(engine.getBounceMathView().fires).toEqual([21, 6, 10, 1]);
  });

  it("puts every beat's fire in the step that holds it – on a song's own irregular grid too", () => {
    const beats = [0.25, 0.9, 1.3, 2.05, 2.6];
    const beat = bounceMathBeatConfig(120, { grid: { bpm: 100, beatTimes: beats, duration: 3 }, offset: 0, loop: false });
    const engine = makeEngine([rule({ trigger: "beat", param: "gravity", op: "add", amount: 1 })], "classic", 3, {}, beat);
    const fireTimes: number[] = [];
    let last = 0;
    run(engine, 4.5, () => {
      const fires = engine.getBounceMathView().fires[0];
      for (; last < fires; last++) fireTimes.push(engine.getElapsedMs() / 1000);
    });
    // the song's five beats, then the grid's tempo (100 BPM) after its last beat
    const expected = [...beats, 2.6 + 0.6, 2.6 + 1.2, 2.6 + 1.8];
    expect(fireTimes).toHaveLength(expected.length);
    fireTimes.forEach((t, i) => {
      expect(t).toBeGreaterThanOrEqual(expected[i] - 1e-9);
      expect(t - expected[i]).toBeLessThan(STEP / 1000 + 1e-9);
    });
  });

  it("follows the music bed's start offset and the formula's b (beats elapsed)", () => {
    const beat = bounceMathBeatConfig(120, { grid: { bpm: 120, beatTimes: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], duration: 4 }, offset: 0.2, loop: true });
    const engine = makeEngine([rule({ trigger: "second", param: "gravity", op: "formula", amount: 0, formula: "b", scope: "all" })], "classic", 3, {}, beat);
    run(engine, 1.02);
    // at 1 s the song is at 1.2 s: beats at song 0.5 and 1.0 have sounded (simulation 0.3, 0.8), 0.4 s of the next
    expect(engine.ctx.config.gravity).toBeCloseTo(1 + 0.2 / 0.5, 1);
  });

  it("applies per-ball values to the ball involved, or to every ball with the 'all' scope", () => {
    const ball = makeEngine([rule({ trigger: "start", param: "size", op: "add", amount: 4 })], "classic", 3, { ballCount: 3 });
    ball.update(STEP, 0);
    expect(ball.getBalls().map((b) => Math.round(b.radius))).toEqual([12, 8, 8]);
    const all = makeEngine([rule({ trigger: "start", param: "size", op: "add", amount: 4, scope: "all" })], "classic", 3, { ballCount: 3 });
    all.update(STEP, 0);
    expect(all.getBalls().map((b) => Math.round(b.radius))).toEqual([12, 12, 12]);
  });

  it("applies rules in list order", () => {
    const a = makeEngine([rule({ trigger: "start", param: "size", op: "add", amount: 2 }), rule({ trigger: "start", param: "size", op: "multiply", amount: 2 })], "classic", 3);
    const b = makeEngine([rule({ trigger: "start", param: "size", op: "multiply", amount: 2 }), rule({ trigger: "start", param: "size", op: "add", amount: 2 })], "classic", 3);
    a.update(STEP, 0);
    b.update(STEP, 0);
    expect(a.getBalls()[0].radius).toBeCloseTo(20, 9); // (8 + 2) · 2
    expect(b.getBalls()[0].radius).toBeCloseTo(18, 9); // 8 · 2 + 2
  });

  it("fires on every N-th trigger only", () => {
    const engine = makeEngine([rule({ trigger: "beat", every: 3, param: "gravity", op: "add", amount: 1 })], "classic", 3);
    run(engine, 5.1);
    expect(engine.getBounceMathView().fires[0]).toBe(3); // 11 beats (0 … 5 s): the 3rd, 6th and 9th
  });

  it("replays a rule run exactly for a seed (random operations and formulas with r included) and differs between seeds", { timeout: 60_000 }, () => {
    const rules = [rule({ op: "random", amount: 0.3 }), rule({ param: "speed", op: "formula", amount: 0, formula: "v * (1 + 0.1 * r)" }), rule({ trigger: "beat", param: "gravity", op: "random", amount: 200, scope: "all" }), rule({ trigger: "collide", param: "balls", op: "add", amount: 1 })];
    const a = trace(makeEngine(rules, "classic", 21, { ballCount: 2 }), 10);
    const b = trace(makeEngine(rules, "classic", 21, { ballCount: 2 }), 10);
    const c = trace(makeEngine(rules, "classic", 22, { ballCount: 2 }), 10);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it("restores the page's world values when the next run starts, and hands them out as the engine's config meanwhile", () => {
    const engine = makeEngine([rule({ trigger: "start", param: "gravity", op: "multiply", amount: -1, scope: "all" }), rule({ trigger: "start", param: "rotation", op: "set", amount: 3 }), rule({ trigger: "start", param: "gap", op: "set", amount: 1.2 })], "classic", 3);
    engine.update(STEP, 0);
    expect(engine.ctx.config.gravity).toBe(-300);
    expect(engine.ctx.config.rotationSpeed).toBe(3);
    expect(engine.ctx.config.gapSize).toBe(1.2);
    const gap = engine.getCircularWalls()[3].gaps[0];
    expect(gap.endAngle - gap.startAngle).toBeCloseTo(1.2, 9);
    // what the finder, the arenas and the fast export copy: the page's values
    expect(engine.config.gravity).toBe(300);
    expect(engine.config.rotationSpeed).toBe(1);
    expect(engine.config.gapSize).toBe(0.4);
    // the page re-sending its own value (another setting of the same effect changed) keeps the rule's value …
    engine.setConfig({ gravity: 300, ballSpeed: 400, gapSize: 0.4 });
    expect(engine.ctx.config.gravity).toBe(-300);
    expect(engine.ctx.config.gapSize).toBe(1.2);
    // … a new value from the page replaces it
    engine.setConfig({ gravity: 500 });
    expect(engine.ctx.config.gravity).toBe(500);
    expect(engine.config.gravity).toBe(500);
    engine.initMode("classic");
    expect(engine.ctx.config.rotationSpeed).toBe(1);
    expect(engine.ctx.config.gapSize).toBe(0.4);
    expect(engine.ctx.config.gravity).toBe(500);
    engine.update(STEP, 0); // the new run's start fires again
    expect(engine.ctx.config.gravity).toBe(-500);
  });

  it("lets a run replay in the finder's and the fast export's engines, built from the page engine's config", { timeout: 60_000 }, () => {
    const rules = [rule({ trigger: "bar", param: "gravity", op: "multiply", amount: -1, scope: "all" }), rule({ param: "size", op: "add", amount: 0.5 }), rule({ op: "random", amount: 0.2 }), rule({ trigger: "second", param: "rotation", op: "multiply", amount: 1.1 })];
    const page = makeEngine(rules, "classic", 42);
    const pageTrace = trace(page, 9);
    expect(page.ctx.config.rotationSpeed).not.toBe(1);
    // the fast export / an arena: new PhysicsEngine({ ...page.config }) with the run's seed
    const exportEngine = new PhysicsEngine({ ...page.config });
    exportEngine.setSeed(42);
    exportEngine.initMode("classic");
    expect(trace(exportEngine, 9)).toEqual(pageTrace);
    // the seed finder
    const finderEngine = createEngineForSettings(page.config, "classic", modeSettings, 42);
    expect(trace(finderEngine, 9)).toEqual(pageTrace);
    const request: FinderRequest = { targetDurationSec: 30, mode: "classic", physicsConfig: { ...page.config }, modeSettings } as FinderRequest;
    expect(simulateSeed(42, request, 60_000)).toBe(simulateSeed(42, request, 60_000));
  });

  it("gives the headless finder requests (the bot) the rules with the BPM or the hand-placed markers", () => {
    const s: SimulatorSettings = { ...defaultSettings("classic"), bounceMath: [rule({ trigger: "beat" })], bpm: 90 };
    const physics = physicsConfigOfSettings(s);
    expect(physics.bounceMath?.rules).toEqual(s.bounceMath);
    expect(physics.bounceMath?.beat.manualBpm).toBe(90);
    expect(physics.bounceMath?.beat.source).toBe("bpm");
    const manual = physicsConfigOfSettings({ ...s, beatSource: "manual", beatMarkers: "250.500*7" });
    expect(manual.bounceMath?.beat.source).toBe("song");
    expect(physicsConfigOfSettings(defaultSettings("classic")).bounceMath).toBeUndefined();
    expect(bounceMathConfigOf(s).showValues).toBe(true);
  });

  it("grows a ball until it eats the arena: the run ends with the outgrow finish", () => {
    const engine = makeEngine([rule({ param: "size", op: "multiply", amount: 1.5 })], "classic", 5);
    run(engine, 20);
    expect(engine.isSimulationFinished()).toBe(true);
    expect(engine.getMultiplierView().outgrown).toBe(true);
    expect(engine.getBalls().every((b) => Number.isFinite(b.x) && Number.isFinite(b.radius))).toBe(true);
  });

  it("stops a growing ball at the field's size where there is no arena to eat (Bouncing Shapes)", () => {
    const engine = makeEngine([rule({ trigger: "second", param: "size", op: "multiply", amount: 4, scope: "all" })], "box", 5);
    run(engine, 6);
    for (const b of engine.getBalls()) expect(b.radius).toBeLessThanOrEqual(0.45 * 600 + 1e-6);
  });

  it("keeps runaway values finite: speed and bounciness compounding on every bounce never turn a position into NaN", { timeout: 60_000 }, () => {
    for (const mode of ["classic", "grow", "drop", "portal", "box"] as ModeId[]) {
      const engine = makeEngine([rule({ amount: 2 }), rule({ param: "speed", amount: 2 }), rule({ trigger: "second", param: "gravity", amount: 10, scope: "all" })], mode, 9);
      run(engine, 8, () => engine.consumeSoundEvents());
      for (const b of engine.getBalls()) expect(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.vx) && Number.isFinite(b.vy), mode).toBe(true);
    }
  });

  it("sub-steps a fast ball instead of letting it tunnel through its ring", () => {
    const engine = makeEngine([rule({ param: "speed", op: "multiply", amount: 1.5 })], "lines", 5);
    const walls = engine.getCircularWalls();
    let maxSub = 0;
    run(engine, 6, () => {
      maxSub = Math.max(maxSub, engine.getMultiplierView().subSteps);
      const b = engine.getBalls()[0];
      const d = Math.hypot(b.x - 400, b.y - 300);
      expect(d).toBeLessThan(walls[walls.length - 1].radius + 1);
    });
    expect(maxSub).toBeGreaterThan(4);
  });

  it("spawns copies of the ball within Multiply's ceiling", { timeout: 60_000 }, () => {
    const engine = makeEngine([rule({ param: "balls", op: "multiply", amount: 2 })], "classic", 5);
    run(engine, 2, () => expect(engine.getBalls().length).toBeLessThanOrEqual(MULTIPLY_MAX_BALLS));
    expect(engine.getBalls().length).toBe(MULTIPLY_MAX_BALLS);
  });

  it("with No limits on spawns past Multiply's ceiling: full-physics balls up to the run's limit, then the crowd", { timeout: 120_000 }, () => {
    // --- unlimited --- the balls parameter follows the switch like Multiply's clone storms (lifted ceiling, crowd overflow)
    const engine = makeEngine([rule({ param: "balls", op: "multiply", amount: 2 })], "classic", 5, { unlimited: true });
    let steps = 0;
    while (engine.getCrowd().spawned === 0 && steps < 600) {
      engine.update(STEP, 0);
      steps++;
    }
    expect(engine.getBalls().length).toBeGreaterThan(MULTIPLY_MAX_BALLS);
    expect(engine.getCrowd().spawned).toBeGreaterThan(0);
    for (const b of engine.getBalls()) expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
    // the same rule without the switch keeps Multiply's ceiling
    const capped = makeEngine([rule({ param: "balls", op: "multiply", amount: 2 })], "classic", 5);
    run(capped, 1);
    expect(capped.getBalls().length).toBe(MULTIPLY_MAX_BALLS);
    expect(capped.getCrowd().spawned).toBe(0);
  });

  it("shifts the ring bounce notes by the ball's pitch (the existing pitch override)", () => {
    const engine = makeEngine([rule({ trigger: "start", param: "pitch", op: "set", amount: 12 })], "classic", 5);
    const hits: SoundEvent[] = [];
    run(engine, 3, () => hits.push(...engine.consumeSoundEvents().filter((e) => e.type === "hit")));
    expect(hits.length).toBeGreaterThan(0);
    for (const e of hits) expect(e.frequency).toBeCloseTo(2 * wallHitFrequency(e.wallIndex), 6);
    expect(bounceHitEvent(2, {})).toEqual({ type: "hit", wallIndex: 2 });
    expect(pitchedFrequency(800, 1e9)).toBe(PITCH_MAX_HZ);
  });

  it("scales the world clock, the trail, the air drag and the canvas values", () => {
    const clock = makeEngine([rule({ trigger: "start", param: "timeScale", op: "set", amount: 2 })], "classic", 5);
    run(clock, 1);
    expect(clock.getElapsedMs()).toBeCloseTo(2000, 3); // (the start fires before the first step is planned: every step is scaled)
    // (not in a mode whose clock drives an analytic figure)
    const pendulum = makeEngine([rule({ trigger: "start", param: "timeScale", op: "set", amount: 2 })], "pendulum", 5);
    run(pendulum, 1);
    expect(pendulum.getElapsedMs()).toBeCloseTo(1000, 3);
    const visual = makeEngine(
      [rule({ trigger: "start", param: "trail", op: "set", amount: 5 }), rule({ trigger: "start", param: "damping", op: "set", amount: 0.02 }), rule({ trigger: "start", param: "thickness", op: "multiply", amount: 3 }), rule({ trigger: "start", param: "wobble", op: "add", amount: 0.4 })],
      "classic",
      5,
    );
    run(visual, 1);
    const view = visual.getBounceMathView();
    expect(visual.getBalls()[0].trail.length).toBe(5);
    expect(view.damping).toBe(0.02);
    expect(view.thickness).toBe(6);
    expect(view.wobble).toBe(0.4);
    const ball = { trail: [1, 2, 3, 4, 5, 6].map((x) => ({ x, y: 0 })), trailIndex: 2 };
    resizeTrail(ball, 4);
    expect(ball.trail.map((p) => p.x)).toEqual([5, 6, 1, 2]);
    expect(ball.trailIndex).toBe(0);
  });

  it("works in every mode that has bounces, and is ignored gracefully where a value does not apply", { timeout: 60_000 }, () => {
    const rules = [rule({ amount: 1.02 }), rule({ param: "hue", op: "add", amount: 5 }), rule({ trigger: "second", param: "size", op: "multiply", amount: 1.01 })];
    for (const mode of ["classic", "multiply", "grow", "portal", "shatter", "colorMatch", "drop", "box", "glass", "journey", "accumulation", "lines", "paint", "target", "bullseye"] as ModeId[]) {
      const engine = makeEngine(rules, mode, 7);
      run(engine, 12, () => engine.consumeSoundEvents());
      expect(engine.getBounceMathView().fires[0], mode).toBeGreaterThan(0);
      expect(engine.getBalls().some((b) => b.restitution !== undefined && b.restitution > 1), mode).toBe(true);
    }
    for (const mode of ["pendulum", "polyrhythm", "beatDrop", "vortex", "illusion"] as ModeId[]) {
      const engine = makeEngine([...rules, rule({ trigger: "beat", param: "gravity", op: "add", amount: 1, scope: "all" })], mode, 7);
      run(engine, 3, () => engine.consumeSoundEvents());
      expect(engine.getBalls().every((b) => b.restitution === undefined), mode).toBe(true);
      expect(engine.getBounceMathView().fires[3], mode).toBeGreaterThan(0);
      expect(bounceParamApplies("bounciness", mode)).toBe(false);
    }
    expect(bounceParamApplies("gap", "portal")).toBe(false);
    expect(bounceParamApplies("gap", "classic")).toBe(true);
  });

  it("lifts a Bouncing Shapes shape's own speed by its bounciness exactly once, and pitches the box's wall notes", () => {
    const speeds = (e: PhysicsEngine) => e.getBalls().map((b) => Math.hypot(b.vx, b.vy));
    const plain = makeEngine(null, "box", 5);
    run(plain, 4, () => plain.consumeSoundEvents());
    const bm = makeEngine([rule({ trigger: "start", op: "set", amount: 2, scope: "all" }), rule({ trigger: "start", param: "pitch", op: "set", amount: 12, scope: "all" })], "box", 5);
    const hits: SoundEvent[] = [];
    run(bm, 4, () => hits.push(...bm.consumeSoundEvents().filter((e) => e.type === "hit")));
    const before = speeds(plain);
    const after = speeds(bm);
    expect(after.length).toBe(before.length);
    // every shape keeps its own speed ratio and carries the bounciness once (× 2), never compounding hit after hit
    after.forEach((v, i) => expect(v / before[i]).toBeCloseTo(2, 6));
    expect(hits.length).toBeGreaterThan(0);
    for (const e of hits) expect(BOX_WALL_NOTES.map((f) => 2 * f).some((f) => Math.abs(f - (e.frequency ?? 0)) < 1e-6)).toBe(true);
    // "Bouncier every bounce" in the box: the speed grows with the bounciness (× 1.05 per bounce), like the ring rebounds
    const bouncier = makeEngine([rule()], "box", 5);
    run(bouncier, 4, () => bouncier.consumeSoundEvents());
    const grown = speeds(bouncier);
    grown.forEach((v, i) => {
      const r = bouncier.getBalls()[i].restitution ?? 1;
      expect(v / before[i]).toBeGreaterThan(1);
      expect(v / before[i]).toBeLessThanOrEqual(r + 1e-9);
    });
  });

  it("applies the bounciness once to a rebound a ring mode sets itself (Grow): above 1 it lifts, it never compounds", () => {
    let max = 0;
    const engine = makeEngine([rule({ trigger: "start", op: "set", amount: 1.5 })], "grow", 5);
    run(engine, 10, () => {
      engine.consumeSoundEvents();
      for (const b of engine.getBalls()) max = Math.max(max, Math.hypot(b.vx, b.vy));
    });
    expect(max).toBeGreaterThan(400 * 1.2);
    expect(max).toBeLessThan(400 * 1.5 * 2.5);
  });

  it("Glass Smash: a bounciness of 2 hops twice as fast and four times as high – the landing's hop takes it", () => {
    const hop = (rules: BounceRule[] | null) => {
      const engine = makeEngine(rules, "glass", 7);
      let up = 0;
      let sum = 0;
      let n = 0;
      run(engine, 10, () => {
        engine.consumeSoundEvents();
        const b = engine.getBalls()[0];
        if (!b) return;
        up = Math.max(up, -b.vy);
        sum += Math.hypot(b.vx, b.vy);
        n++;
      });
      return { up, mean: sum / n };
    };
    const plain = hop(null);
    const bouncy = hop([rule({ trigger: "start", op: "set", amount: 2, scope: "all" })]);
    expect(bouncy.up / plain.up).toBeCloseTo(2, 1);
    expect(bouncy.mean).toBeGreaterThan(1.3 * plain.mean);
    // "Bouncier every bounce" now shows in the hops (it did nothing before: the landing reset the hop)
    const bouncier = hop([rule()]);
    expect(bouncier.up).toBeGreaterThan(1.5 * plain.up);
    // The Journey's glass stage too (and its other stages' obstacles)
    const journey = (rules: BounceRule[] | null) => {
      const engine = makeEngine(rules, "journey", 7);
      let up = 0;
      run(engine, 10, () => {
        engine.consumeSoundEvents();
        for (const b of engine.getBalls()) up = Math.max(up, -b.vy);
      });
      return up;
    };
    expect(journey([rule({ trigger: "start", op: "set", amount: 2, scope: "all" })])).toBeGreaterThan(1.5 * journey(null));
  });

  it("Ball Drop and Bullseye: a bounciness of 2 makes the pegs, bars and walls bouncier than their 0.98 cap – without running away", { timeout: 60_000 }, () => {
    const speeds = (mode: ModeId, rules: BounceRule[] | null) => {
      const engine = makeEngine(rules, mode, 7);
      let max = 0;
      let sum = 0;
      let n = 0;
      run(engine, 10, () => {
        engine.consumeSoundEvents();
        for (const b of engine.getBalls()) {
          const v = Math.hypot(b.vx, b.vy);
          max = Math.max(max, v);
          if (v > 1) {
            sum += v;
            n++;
          }
        }
      });
      return { max, mean: sum / n };
    };
    // ("second", all balls: the balls released later get it too)
    const two = [rule({ trigger: "second", op: "set", amount: 2, scope: "all" })];
    for (const mode of ["drop", "bullseye"] as ModeId[]) {
      const plain = speeds(mode, null);
      const bouncy = speeds(mode, two);
      expect(bouncy.mean, mode).toBeGreaterThan(1.15 * plain.mean);
      expect(bouncy.max, mode).toBeGreaterThan(plain.max);
      // the lift: a rebound the bounciness speeds up stops at the cruising speed × the bounciness (gravity adds the rest)
      expect(bouncy.max, mode).toBeLessThan(3 * plain.max);
    }
  });

  it("turns the default white ball's colour on a colour shift", () => {
    const engine = makeEngine([rule({ param: "hue", op: "add", amount: 30 })], "classic", 5);
    run(engine, 4, () => engine.consumeSoundEvents());
    const ball = engine.getBalls()[0];
    expect(ball.hueShift).toBeGreaterThan(0);
    expect(ball.color.toLowerCase()).not.toBe("#ffffff");
    expect(parseColorHsl(ball.color)!.s).toBeGreaterThan(0.5);
  });

  it("reports bounces in every mode and ball hits wherever balls hit each other; the panel names the triggers a mode never sets off", { timeout: 120_000 }, () => {
    const listen = (["bounce", "collide"] as const).map((trigger) => rule({ trigger, param: "hue", op: "add", amount: 5 }));
    const settingsFor: Partial<Record<ModeId, Partial<ModeSettings>>> = {
      classic: { twoBalls: true },
      doublePendulum: { doublePendulum: { spar: true, randomStart: false, angle1: 45, angle2: 90, endless: true } },
    };
    for (const mode of MODE_IDS) {
      const engine = createEngineForSettings({ ...config, bounceMath: bmConfig(listen) }, mode, { ...modeSettings, ...settingsFor[mode] }, 7);
      const seconds = mode === "doublePendulum" ? 12 : 10;
      run(engine, seconds, () => engine.consumeSoundEvents());
      const fires = engine.getBounceMathView().fires;
      expect(bounceTriggerApplies("bounce", mode), mode).toBe(true);
      expect(fires[0], `${mode} bounce`).toBeGreaterThan(0);
      const collides = ["classic", "drop", "collide", "multipliers", "battle", "ctf", "stringBattle", "doublePendulum"].includes(mode);
      if (collides) {
        expect(bounceTriggerApplies("collide", mode), mode).toBe(true);
        expect(fires[1], `${mode} collide`).toBeGreaterThan(0);
      }
      if (!bounceTriggerApplies("collide", mode)) expect(fires[1], `${mode} collide`).toBe(0);
    }
    // the triggers a mode never sets off (the panel's note), and the clock's, which fire everywhere
    expect(bounceTriggerApplies("collide", "pendulum")).toBe(false);
    expect(bounceTriggerApplies("collide", "box")).toBe(false);
    expect(bounceTriggerApplies("pass", "drop")).toBe(false);
    expect(bounceTriggerApplies("pass", "classic")).toBe(true);
    expect(bounceTriggerApplies("pass", "journey")).toBe(true);
    expect(bounceTriggerApplies("break", "collide")).toBe(false);
    expect(bounceTriggerApplies("break", "glass")).toBe(true);
    for (const mode of MODE_IDS) for (const trigger of ["beat", "bar", "second", "start"] as const) expect(bounceTriggerApplies(trigger, mode)).toBe(true);
  });

  it("queues its triggers without touching a run whose rules do not listen to them", () => {
    const runtime = new BounceMathRuntime({
      ctx: () => makeEngine(null).ctx,
      mode: () => "classic",
      multipliers: () => makeEngine(null).getMultiplierRuntime(),
      setWorld: () => {},
      airDrag: () => 0,
      soundEvents: () => [],
    });
    runtime.configure(bmConfig([rule({ trigger: "beat" })]), 0);
    expect(runtime.wantsTrigger(BM_BOUNCE)).toBe(false);
    expect(runtime.on).toBe(true);
    expect(compileRule(rule({ op: "formula", formula: "v +" }))).toBeNull();
  });
});
