import { DEFAULT_BEAT_CLOCK, isUsableGrid, type BeatClockConfig, type BeatGrid } from "./beatClock";

/**
 * Bounce math (feature bounce-math): a list of user-defined RULES, each changing one parameter by a mathematical step
 * every time a trigger fires – the classic "the ball gets bouncier / faster / bigger on every bounce" edits, generalised
 * to every parameter and every trigger, including the beat of a song.
 *
 * A rule is `{ param, trigger, every, op, amount, formula?, min?, max?, scope }`: on every `every`-th time its trigger
 * fires (a wall bounce, a gap pass, a ball-to-ball hit, a wall break, a beat of the beat grid, a bar of four beats, a
 * second of run time, or once at the start) the parameter's current value v becomes `op(v, amount)` – add, subtract,
 * multiply, divide, power, root, modulo, set, random (v ± a seeded random up to the amount) or a formula in v, n (the
 * rule's fire count), t (seconds), b (beats elapsed) and r (a seeded random in [0, 1)). Rules apply in list order. The
 * result is clamped to the rule's own min / max (both optional: by default there is NO upper limit – extreme values are a
 * feature), and a result that means nothing – NaN, ±Infinity, a negative or zero size… – is rejected: the rule then
 * leaves the value as it was (`applyRule()`).
 *
 * This module is pure (no DOM, no engine): the parameter / trigger / operation tables, the formula compiler (a small
 * recursive-descent parser that compiles a formula once into a postfix program evaluated per fire without allocating –
 * NEVER eval / new Function), `applyRule()`, the validation, the compact URL form (`bmr`), the presets and the helpers the
 * panel edits the list with. The engine side is `lib/physics/bounceMathRuntime.ts`.
 */

/* ------------------------------------------------------------------ parameters, triggers, operations */

export const BOUNCE_PARAMS = ["bounciness", "speed", "size", "gravity", "rotation", "gap", "thickness", "damping", "trail", "hue", "pitch", "timeScale", "wobble", "balls"] as const;
export type BounceParam = (typeof BOUNCE_PARAMS)[number];

export const BOUNCE_TRIGGERS = ["bounce", "pass", "collide", "break", "beat", "bar", "second", "start"] as const;
export type BounceTrigger = (typeof BOUNCE_TRIGGERS)[number];

export const BOUNCE_OPS = ["add", "subtract", "multiply", "divide", "power", "root", "modulo", "set", "random", "formula"] as const;
export type BounceOp = (typeof BOUNCE_OPS)[number];

/** "ball": the ball the trigger involves (both balls of a collision; the ball that bounced last for a time trigger); "all": every ball / the world. */
export const BOUNCE_SCOPES = ["ball", "all"] as const;
export type BounceScope = (typeof BOUNCE_SCOPES)[number];

export function isBounceParam(value: unknown): value is BounceParam {
  return typeof value === "string" && (BOUNCE_PARAMS as readonly string[]).includes(value);
}
export function isBounceTrigger(value: unknown): value is BounceTrigger {
  return typeof value === "string" && (BOUNCE_TRIGGERS as readonly string[]).includes(value);
}
export function isBounceOp(value: unknown): value is BounceOp {
  return typeof value === "string" && (BOUNCE_OPS as readonly string[]).includes(value);
}

export interface BounceRule {
  param: BounceParam;
  trigger: BounceTrigger;
  /** Fire on every N-th trigger (1 = every time). */
  every: number;
  op: BounceOp;
  /** The operand (ignored by "formula"). Any finite number: the panel's slider is only a comfort range. */
  amount: number;
  /** The expression of a "formula" rule (v, n, t, b, r; + − * / ^ ( ); sin cos tan abs sqrt pow min max floor ceil round log exp clamp; pi, e). */
  formula?: string;
  /** Optional clamps the creator sets (none by default: no upper limit). */
  min?: number;
  max?: number;
  scope: BounceScope;
}

/**
 * What a parameter lives on: "ball" – on each ball (its restitution, speed, radius, colour, bounce note), "world" – on the
 * engine or the canvas (gravity, ring spin, gap, wall thickness, air drag, trail length, the clock, the wobble), "count" –
 * the number of balls in play (a rule spawns copies of the ball).
 */
export type BounceParamKind = "ball" | "world" | "count";

export const BOUNCE_PARAM_KIND: Readonly<Record<BounceParam, BounceParamKind>> = {
  bounciness: "ball",
  speed: "ball",
  size: "ball",
  gravity: "world",
  rotation: "world",
  gap: "world",
  thickness: "world",
  damping: "world",
  trail: "world",
  hue: "ball",
  pitch: "ball",
  timeScale: "world",
  wobble: "world",
  balls: "count",
};

/**
 * Where a value means something. Below `min` (or at it when `minOpen`) the result is REJECTED (the rule leaves the value
 * unchanged: a negative size, a zero speed…); above `max` it is clamped (a physical ceiling, not a comfort limit: a gap
 * cannot open more than the whole ring, air drag cannot take more than all the speed, a trail is at most
 * `MAX_TRAIL_POINTS` points); `integer` rounds (a ball count, a trail length).
 */
export interface BounceParamDomain {
  min: number;
  minOpen: boolean;
  max: number;
  integer: boolean;
}

/** Longest trail the engine keeps per ball, points (memory and the canvas' per-segment strokes). */
export const MAX_TRAIL_POINTS = 200;
/** The engine's trail length without a trail rule, points. */
export const DEFAULT_TRAIL_POINTS = 20;
/** Widest gap (radians): just short of the whole ring. */
export const MAX_GAP = 2 * Math.PI - 0.01;
/** Most air drag per 60 Hz step (1 would stop every ball dead). */
export const MAX_DAMPING = 0.99;

/**
 * Keeps a value a finite float (like the multipliers' `MULTIPLIER_CEILING`): 10¹⁵ is far beyond anything a clip shows – a
 * ball bouncing 10¹⁵ times harder, gravity of 10¹⁵ px/s² – so it is not a gameplay limit; it only stops a runaway stack
 * (× 1.05 on every one of thousands of bounces) from overflowing to Infinity, which would turn every position into NaN.
 */
export const FLOAT_CEILING = 1e15;
/** The clock scale's ceiling: far past what the step planner can follow anyway (it dilates the step back beyond ~40×). */
export const MAX_TIME_SCALE = 1e6;
/** The canvas parameters' ceilings (px of wall thickness, the wobble amount): far past covering the whole frame. */
export const MAX_THICKNESS = 1e6;
export const MAX_WOBBLE = 100;

const OPEN = (min: number, max = FLOAT_CEILING, integer = false): BounceParamDomain => ({ min, minOpen: true, max, integer });
const CLOSED = (min: number, max = FLOAT_CEILING, integer = false): BounceParamDomain => ({ min, minOpen: false, max, integer });
const ANY: BounceParamDomain = { min: -FLOAT_CEILING, minOpen: false, max: FLOAT_CEILING, integer: false };

export const BOUNCE_PARAM_DOMAINS: Readonly<Record<BounceParam, BounceParamDomain>> = {
  bounciness: CLOSED(0),
  speed: OPEN(0),
  size: OPEN(0),
  gravity: ANY,
  rotation: ANY,
  gap: CLOSED(0, MAX_GAP),
  thickness: CLOSED(0, MAX_THICKNESS),
  damping: CLOSED(0, MAX_DAMPING),
  trail: CLOSED(0, MAX_TRAIL_POINTS, true),
  hue: ANY,
  pitch: ANY,
  timeScale: OPEN(0, MAX_TIME_SCALE),
  wobble: CLOSED(0, MAX_WOBBLE),
  balls: CLOSED(0, FLOAT_CEILING, true),
};

/** A typical magnitude of each parameter (its default-ish value), for the panel's comfort slider of the amount. */
export const BOUNCE_PARAM_SCALE: Readonly<Record<BounceParam, number>> = {
  bounciness: 1,
  speed: 400,
  size: 8,
  gravity: 300,
  rotation: 1,
  gap: 0.4,
  thickness: 2,
  damping: 0.01,
  trail: 20,
  hue: 180,
  pitch: 12,
  timeScale: 1,
  wobble: 0.5,
  balls: 1,
};

/** Most rules in a list. */
export const MAX_BOUNCE_RULES = 24;
/** Longest formula, characters. */
export const MAX_FORMULA_LENGTH = 200;
/** Largest "every N". */
export const MAX_EVERY = 1_000_000;

/**
 * Slider comfort ranges (spread into `RANGES` in settings.ts): the "every N" slider and a generic amount range. The number
 * inputs of the panel accept ANY finite value – these only bound the sliders.
 */
export const BOUNCE_MATH_RANGES = {
  bmEvery: { min: 1, max: 32, step: 1 },
  bmAmount: { min: -10, max: 10, step: 0.01 },
} as const;

/** The comfort range of the amount slider for a parameter and an operation (the number input next to it takes any value). */
export function amountComfortRange(param: BounceParam, op: BounceOp): { min: number; max: number; step: number } {
  const scale = BOUNCE_PARAM_SCALE[param];
  const step = niceStep(scale / 100);
  switch (op) {
    case "multiply":
    case "divide":
      return { min: param === "gravity" || param === "rotation" ? -3 : 0, max: 3, step: 0.01 };
    case "power":
    case "root":
      return { min: 0, max: 3, step: 0.01 };
    case "set":
    case "modulo":
      return { min: BOUNCE_PARAM_DOMAINS[param].min > -Infinity ? 0 : -4 * scale, max: 4 * scale, step };
    default:
      return { min: -2 * scale, max: 2 * scale, step };
  }
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 0.01;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  return raw / p >= 5 ? 5 * p : raw / p >= 2 ? 2 * p : p;
}

/* ------------------------------------------------------------------ formulas */

const OP_CONST = 0;
const OP_VAR = 1;
const OP_NEG = 2;
const OP_ADD = 3;
const OP_SUB = 4;
const OP_MUL = 5;
const OP_DIV = 6;
const OP_POW = 7;
const OP_FN1 = 8;
const OP_FN2 = 9;
const OP_CLAMP = 10;

/** The variables a formula reads, in the order of their slot. */
export const FORMULA_VARIABLES = ["v", "n", "t", "b", "r"] as const;
/** One-argument functions, in the order of their id. */
export const FORMULA_FUNCTIONS_1 = ["sin", "cos", "tan", "abs", "sqrt", "floor", "ceil", "round", "log", "exp"] as const;
/** Two-argument functions (min / max also take more: min(a, b, c) = min(min(a, b), c)). */
export const FORMULA_FUNCTIONS_2 = ["pow", "min", "max"] as const;
const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E };

/** A formula compiled once into a postfix program (`code`: op / argument pairs) evaluated per fire on its own stack. */
export interface CompiledFormula {
  readonly source: string;
  readonly code: Int32Array;
  readonly consts: Float64Array;
  /** The evaluation stack (reused: evaluation allocates nothing). */
  readonly stack: Float64Array;
  /** The formula reads r: the runtime draws a seeded random number for it (and only then). */
  readonly usesR: boolean;
}

export type FormulaErrorCode = "empty" | "tooLong" | "unexpected" | "unknownName" | "arity" | "unclosed" | "badNumber";

export interface FormulaError {
  code: FormulaErrorCode;
  /** Character index the error was found at. */
  at: number;
  /** The unknown name, or the function whose argument count is wrong. */
  name?: string;
}

export type FormulaResult = { ok: true; formula: CompiledFormula } | { ok: false; error: FormulaError };

class FormulaSyntaxError {
  constructor(readonly error: FormulaError) {}
}

class FormulaParser {
  private pos = 0;
  private depth = 0;
  maxDepth = 0;
  usesR = false;
  readonly code: number[] = [];
  readonly consts: number[] = [];

  constructor(private readonly text: string) {}

  parse() {
    this.skip();
    if (this.pos >= this.text.length) this.fail("empty");
    this.expr();
    this.skip();
    if (this.pos < this.text.length) this.fail("unexpected");
  }

  private fail(code: FormulaErrorCode, name?: string, at = this.pos): never {
    throw new FormulaSyntaxError(name === undefined ? { code, at } : { code, at, name });
  }

  private skip() {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++;
  }

  private peek(): string {
    this.skip();
    return this.pos < this.text.length ? this.text[this.pos] : "";
  }

  private emit(op: number, arg: number, delta: number) {
    this.code.push(op, arg);
    this.depth += delta;
    if (this.depth > this.maxDepth) this.maxDepth = this.depth;
  }

  private expr() {
    this.term();
    for (;;) {
      const c = this.peek();
      if (c !== "+" && c !== "-") return;
      this.pos++;
      this.term();
      this.emit(c === "+" ? OP_ADD : OP_SUB, 0, -1);
    }
  }

  private term() {
    this.unary();
    for (;;) {
      const c = this.peek();
      if (c !== "*" && c !== "/") return;
      this.pos++;
      this.unary();
      this.emit(c === "*" ? OP_MUL : OP_DIV, 0, -1);
    }
  }

  /** −x binds looser than ^ (−2^2 = −4), tighter than * and /. */
  private unary() {
    const c = this.peek();
    if (c === "-" || c === "+") {
      this.pos++;
      this.unary();
      if (c === "-") this.emit(OP_NEG, 0, 0);
      return;
    }
    this.power();
  }

  /** ^ is right-associative (2^3^2 = 2^9) and takes a signed exponent (2^-1). */
  private power() {
    this.primary();
    if (this.peek() === "^") {
      this.pos++;
      this.unary();
      this.emit(OP_POW, 0, -1);
    }
  }

  private primary() {
    const c = this.peek();
    const start = this.pos;
    if (c === "") this.fail("unexpected");
    if (c === "(") {
      this.pos++;
      this.expr();
      if (this.peek() !== ")") this.fail("unclosed", undefined, start);
      this.pos++;
      return;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.pos));
      if (!m) this.fail("badNumber");
      const value = Number(m[0]);
      if (!Number.isFinite(value)) this.fail("badNumber");
      this.pos += m[0].length;
      this.pushConst(value);
      return;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.text.slice(this.pos))!;
      this.pos += m[0].length;
      const name = m[0].toLowerCase();
      if (this.peek() === "(") {
        this.pos++;
        this.call(name, start);
        return;
      }
      const slot = (FORMULA_VARIABLES as readonly string[]).indexOf(name);
      if (slot >= 0) {
        if (name === "r") this.usesR = true;
        this.emit(OP_VAR, slot, 1);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) {
        this.pushConst(CONSTANTS[name]);
        return;
      }
      this.fail("unknownName", m[0], start);
    }
    this.fail("unexpected");
  }

  private pushConst(value: number) {
    this.consts.push(value);
    this.emit(OP_CONST, this.consts.length - 1, 1);
  }

  /** A function call after its "(": the arguments, then the call itself. */
  private call(name: string, at: number) {
    const fn1 = (FORMULA_FUNCTIONS_1 as readonly string[]).indexOf(name);
    const fn2 = (FORMULA_FUNCTIONS_2 as readonly string[]).indexOf(name);
    if (fn1 < 0 && fn2 < 0 && name !== "clamp") this.fail("unknownName", name, at);
    let args = 0;
    if (this.peek() !== ")") {
      for (;;) {
        this.expr();
        args++;
        // min / max fold as they go: min(a, b, c) = min(min(a, b), c)
        if (fn2 > 0 && args >= 2) this.emit(OP_FN2, fn2, -1);
        const c = this.peek();
        if (c === ",") {
          this.pos++;
          continue;
        }
        if (c === ")") break;
        this.fail("unclosed", undefined, at);
      }
    }
    this.pos++; // ")"
    if (fn1 >= 0) {
      if (args !== 1) this.fail("arity", name, at);
      this.emit(OP_FN1, fn1, 0);
    } else if (fn2 === 0) {
      if (args !== 2) this.fail("arity", name, at);
      this.emit(OP_FN2, 0, -1);
    } else if (fn2 > 0) {
      if (args < 2) this.fail("arity", name, at);
    } else {
      if (args !== 3) this.fail("arity", name, at);
      this.emit(OP_CLAMP, 0, -2);
    }
  }
}

/** Compiles a formula (once): the program, or where and why it is not one. Never evaluates the text as code. */
export function compileFormula(text: string): FormulaResult {
  const source = typeof text === "string" ? text : "";
  if (source.length > MAX_FORMULA_LENGTH) return { ok: false, error: { code: "tooLong", at: MAX_FORMULA_LENGTH } };
  const parser = new FormulaParser(source);
  try {
    parser.parse();
  } catch (err) {
    if (err instanceof FormulaSyntaxError) return { ok: false, error: err.error };
    throw err;
  }
  return {
    ok: true,
    formula: {
      source,
      code: Int32Array.from(parser.code),
      consts: Float64Array.from(parser.consts),
      stack: new Float64Array(Math.max(1, parser.maxDepth)),
      usesR: parser.usesR,
    },
  };
}

/** The values a formula reads. */
export interface FormulaVars {
  /** The parameter's current value. */
  v: number;
  /** How many times the rule has fired, this time included (1 on the first fire). */
  n: number;
  /** Seconds of run time. */
  t: number;
  /** Beats elapsed. */
  b: number;
  /** A seeded random number in [0, 1). */
  r: number;
}

function fn1(id: number, x: number): number {
  switch (id) {
    case 0:
      return Math.sin(x);
    case 1:
      return Math.cos(x);
    case 2:
      return Math.tan(x);
    case 3:
      return Math.abs(x);
    case 4:
      return Math.sqrt(x);
    case 5:
      return Math.floor(x);
    case 6:
      return Math.ceil(x);
    case 7:
      return Math.round(x);
    case 8:
      return Math.log(x);
    default:
      return Math.exp(x);
  }
}

function fn2(id: number, a: number, b: number): number {
  if (id === 0) return Math.pow(a, b);
  return id === 1 ? Math.min(a, b) : Math.max(a, b);
}

/** Runs a compiled formula on its own stack (no allocation). NaN / ±Infinity come back as they are – `applyRule()` rejects them. */
export function evaluateFormula(formula: CompiledFormula, vars: FormulaVars): number {
  const code = formula.code;
  const st = formula.stack;
  const consts = formula.consts;
  let sp = 0;
  for (let i = 0; i < code.length; i += 2) {
    const arg = code[i + 1];
    switch (code[i]) {
      case OP_CONST:
        st[sp++] = consts[arg];
        break;
      case OP_VAR:
        st[sp++] = arg === 0 ? vars.v : arg === 1 ? vars.n : arg === 2 ? vars.t : arg === 3 ? vars.b : vars.r;
        break;
      case OP_NEG:
        st[sp - 1] = -st[sp - 1];
        break;
      case OP_ADD:
        sp--;
        st[sp - 1] += st[sp];
        break;
      case OP_SUB:
        sp--;
        st[sp - 1] -= st[sp];
        break;
      case OP_MUL:
        sp--;
        st[sp - 1] *= st[sp];
        break;
      case OP_DIV:
        sp--;
        st[sp - 1] /= st[sp];
        break;
      case OP_POW:
        sp--;
        st[sp - 1] = Math.pow(st[sp - 1], st[sp]);
        break;
      case OP_FN1:
        st[sp - 1] = fn1(arg, st[sp - 1]);
        break;
      case OP_FN2:
        sp--;
        st[sp - 1] = fn2(arg, st[sp - 1], st[sp]);
        break;
      case OP_CLAMP: {
        sp -= 2;
        const x = st[sp - 1];
        const lo = st[sp];
        const hi = st[sp + 1];
        st[sp - 1] = Math.min(Math.max(x, lo), hi);
        break;
      }
    }
  }
  return sp === 1 ? st[0] : NaN;
}

/* ------------------------------------------------------------------ applying a rule */

/** A rule with its formula compiled (the engine compiles each rule once, when the list arrives). */
export interface CompiledRule {
  readonly rule: BounceRule;
  readonly formula: CompiledFormula | null;
}

/** A valid rule compiled for the engine, or null (a "formula" rule whose formula does not compile). */
export function compileRule(rule: BounceRule): CompiledRule | null {
  if (rule.op !== "formula") return { rule, formula: null };
  const result = compileFormula(rule.formula ?? "");
  return result.ok ? { rule, formula: result.formula } : null;
}

/** What a firing rule knows besides the value: its fire count, the clock, the beats and the seeded random numbers. */
export interface RuleContext {
  /** How many times the rule has fired, this time included. */
  n: number;
  /** Seconds of run time. */
  t: number;
  /** Beats elapsed. */
  b: number;
  /** A seeded random number in [0, 1) (the engine's `random()`); drawn only by "random" rules and formulas that read r. */
  random: () => number;
}

const vars: FormulaVars = { v: 0, n: 0, t: 0, b: 0, r: 0 };
/** Formulas of plain (uncompiled) rules handed to `applyRule()` – tools and tests; the engine hands compiled rules. */
const formulaCache = new Map<string, CompiledFormula | null>();

function formulaOf(rule: BounceRule | CompiledRule): CompiledFormula | null {
  if ("rule" in rule) return rule.formula;
  const text = rule.formula ?? "";
  let cached = formulaCache.get(text);
  if (cached === undefined) {
    const result = compileFormula(text);
    cached = result.ok ? result.formula : null;
    if (formulaCache.size > 64) formulaCache.clear();
    formulaCache.set(text, cached);
  }
  return cached;
}

/** The a-th root of v (a real one for a negative v and an odd whole a: root(−8, 3) = −2); NaN where there is none. */
export function rootOf(v: number, a: number): number {
  if (a === 0) return NaN;
  if (v < 0 && Number.isInteger(a) && Math.abs(a) % 2 === 1) return -Math.pow(-v, 1 / a);
  return Math.pow(v, 1 / a);
}

/** The raw result of the rule's operation on `value` (before its min / max and the parameter's domain). */
export function ruleOperation(value: number, rule: BounceRule | CompiledRule, ctx: RuleContext): number {
  const r = "rule" in rule ? rule.rule : rule;
  const a = r.amount;
  switch (r.op) {
    case "add":
      return value + a;
    case "subtract":
      return value - a;
    case "multiply":
      return value * a;
    case "divide":
      return value / a;
    case "power":
      return Math.pow(value, a);
    case "root":
      return rootOf(value, a);
    case "modulo":
      return a === 0 ? NaN : value - a * Math.floor(value / a);
    case "set":
      return a;
    case "random":
      return value + (2 * ctx.random() - 1) * a;
    case "formula": {
      const formula = formulaOf(rule);
      if (!formula) return NaN;
      vars.v = value;
      vars.n = ctx.n;
      vars.t = ctx.t;
      vars.b = ctx.b;
      vars.r = formula.usesR ? ctx.random() : 0;
      return evaluateFormula(formula, vars);
    }
  }
}

/**
 * Fits a raw result into the rule's min / max and the parameter's domain: NaN or ±Infinity, or a value below what the
 * parameter can mean (a negative size, a zero speed…) is rejected – `previous` comes back unchanged; above a physical
 * ceiling (a gap wider than the ring, all the speed dragged away, a trail longer than `MAX_TRAIL_POINTS`) or the float
 * ceiling (`FLOAT_CEILING`, ±10¹⁵ – not a gameplay limit) it is clamped; counts and trail lengths are rounded.
 */
export function fitRuleValue(raw: number, previous: number, rule: Pick<BounceRule, "param" | "min" | "max">): number {
  if (!Number.isFinite(raw)) return previous;
  let value = raw;
  if (rule.min !== undefined && value < rule.min) value = rule.min;
  if (rule.max !== undefined && value > rule.max) value = rule.max;
  const domain = BOUNCE_PARAM_DOMAINS[rule.param];
  if (domain.integer) value = Math.round(value);
  if (value < domain.min || (domain.minOpen && value <= domain.min)) {
    // Below a domain that has no floor of meaning (gravity, spin, hue, pitch) it is the float ceiling mirrored: clamp it.
    if (domain.min === -FLOAT_CEILING) return domain.min;
    return previous;
  }
  if (value > domain.max) value = domain.max;
  return value;
}

/** The value a firing rule gives the parameter (its current value `value`), or `value` itself when the result is rejected. */
export function applyRule(value: number, rule: BounceRule | CompiledRule, ctx: RuleContext): number {
  const r = "rule" in rule ? rule.rule : rule;
  return fitRuleValue(ruleOperation(value, rule, ctx), value, r);
}

/* ------------------------------------------------------------------ validation */

function finiteOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A clean rule, or null: an unknown parameter, trigger or operation, a non-finite amount (a formula rule needs none), or a
 * formula that does not compile. `every` becomes a whole number ≥ 1 (1 when missing), min / max stay only when finite
 * (swapped when min > max), the scope is "ball" unless it is "all"; a formula is kept only on a "formula" rule.
 */
export function sanitizeRule(value: unknown): BounceRule | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isBounceParam(v.param) || !isBounceTrigger(v.trigger) || !isBounceOp(v.op)) return null;
  const everyRaw = Number(v.every);
  const every = Number.isFinite(everyRaw) && everyRaw >= 1 ? Math.min(MAX_EVERY, Math.floor(everyRaw)) : 1;
  let amount = typeof v.amount === "number" ? v.amount : Number(v.amount);
  if (!Number.isFinite(amount)) {
    if (v.op !== "formula") return null;
    amount = 0;
  }
  const rule: BounceRule = { param: v.param, trigger: v.trigger, every, op: v.op, amount, scope: v.scope === "all" ? "all" : "ball" };
  if (v.op === "formula") {
    const text = typeof v.formula === "string" ? v.formula.trim() : "";
    if (!compileFormula(text).ok) return null;
    rule.formula = text;
  }
  let min = finiteOrUndefined(v.min);
  let max = finiteOrUndefined(v.max);
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  if (min !== undefined) rule.min = min;
  if (max !== undefined) rule.max = max;
  return rule;
}

/** A valid rule list: invalid rules dropped, at most `MAX_BOUNCE_RULES`. */
export function resolveRules(value: unknown): BounceRule[] {
  if (!Array.isArray(value)) return [];
  const out: BounceRule[] = [];
  for (const item of value) {
    const rule = sanitizeRule(item);
    if (rule) out.push(rule);
    if (out.length >= MAX_BOUNCE_RULES) break;
  }
  return out;
}

/* ------------------------------------------------------------------ the URL form */

/** A number in a URL field: the decimal point written "_" (the fields are separated by "."), no "+" in the exponent. */
export function encodeRuleNumber(n: number): string {
  return String(n).replace("e+", "e").replace(".", "_");
}

/** A number field back ("_" or "." as the decimal point, percent-escapes undone); NaN when it is not one ("" included). */
export function decodeRuleNumber(text: string): number {
  const t = safeDecode(text).trim().replace(/_/g, ".");
  return t === "" ? NaN : Number(t);
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A formula in a URL field: every character but letters and digits percent-encoded (so "." and "_" never split the field). */
export function encodeFormulaText(text: string): string {
  return encodeURIComponent(text).replace(/[._\-!~*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/**
 * One rule as `param.trigger.every.op.amount[.min][.max][.scope]` – a formula rule's formula in the amount field,
 * percent-encoded; min / max empty when unset, trailing empty fields and the default scope ("ball") left out.
 */
export function serializeRule(rule: BounceRule): string {
  const fields = [
    rule.param,
    rule.trigger,
    String(rule.every),
    rule.op,
    rule.op === "formula" ? encodeFormulaText(rule.formula ?? "") : encodeRuleNumber(rule.amount),
    rule.min !== undefined ? encodeRuleNumber(rule.min) : "",
    rule.max !== undefined ? encodeRuleNumber(rule.max) : "",
    rule.scope === "all" ? "all" : "",
  ];
  while (fields.length > 5 && fields[fields.length - 1] === "") fields.pop();
  return fields.join(".");
}

/** Rules joined by ";" (the `bmr` URL parameter). */
export function serializeRules(rules: readonly BounceRule[]): string {
  return rules.map(serializeRule).join(";");
}

/** One rule from its URL form, or null (tolerant: unknown names, bad numbers or formulas drop the rule, never the list). */
export function parseRule(text: string): BounceRule | null {
  const fields = text.trim().split(".");
  if (fields.length < 5) return null;
  const [param, trigger, every, op, amount, min, max, scope] = fields;
  const formula = op === "formula" ? safeDecode(amount) : undefined;
  return sanitizeRule({
    param,
    trigger,
    every: decodeRuleNumber(every),
    op,
    amount: op === "formula" ? 0 : decodeRuleNumber(amount),
    formula,
    min: min !== undefined ? decodeRuleNumber(min) : undefined,
    max: max !== undefined ? decodeRuleNumber(max) : undefined,
    scope: scope === "all" || scope === "a" ? "all" : "ball",
  });
}

/** The rule list of a `bmr` parameter (invalid rules dropped, at most `MAX_BOUNCE_RULES`). */
export function parseRules(text: string | null | undefined): BounceRule[] {
  if (!text) return [];
  const out: BounceRule[] = [];
  for (const part of text.split(";")) {
    if (!part.trim()) continue;
    const rule = parseRule(part);
    if (rule) out.push(rule);
    if (out.length >= MAX_BOUNCE_RULES) break;
  }
  return out;
}

/** True when two lists hold the same rules (their URL forms match). */
export function sameRules(a: readonly BounceRule[], b: readonly BounceRule[]): boolean {
  if (a === b) return true;
  return a.length === b.length && serializeRules(a) === serializeRules(b);
}

/* ------------------------------------------------------------------ settings */

/** The SimulatorSettings fields of the feature. */
export interface BounceMathSettings {
  /** The rule list (URL `bmr`). */
  bounceMath: BounceRule[];
  /** "Show values": the HUD badge on the canvas while rules are in play (URL `bmh`). */
  bounceMathHud: boolean;
}

export function defaultBounceMathFields(): BounceMathSettings {
  return { bounceMath: [], bounceMathHud: true };
}

/** Validated fields (presets, project files): a clean rule list and a real boolean. */
export function resolveBounceMathFields(source: Partial<Record<keyof BounceMathSettings, unknown>> | null | undefined): BounceMathSettings {
  return {
    bounceMath: resolveRules(source?.bounceMath),
    bounceMathHud: typeof source?.bounceMathHud === "boolean" ? source.bounceMathHud : true,
  };
}

/** The rules are part of the clip, whatever the mode: they carry over to a new mode (a parameter a mode lacks is ignored there). */
export function bounceMathCarryOver(settings: BounceMathSettings): BounceMathSettings {
  return { bounceMath: settings.bounceMath.map((r) => ({ ...r })), bounceMathHud: settings.bounceMathHud };
}

/** URL keys of the feature (`bm` is the beat markers' key). */
export const BOUNCE_MATH_URL_KEYS = { rules: "bmr", hud: "bmh" } as const;

export function writeBounceMathParams(settings: BounceMathSettings, params: URLSearchParams): void {
  if (settings.bounceMath.length > 0) params.set(BOUNCE_MATH_URL_KEYS.rules, serializeRules(settings.bounceMath));
  if (!settings.bounceMathHud) params.set(BOUNCE_MATH_URL_KEYS.hud, "0");
}

export function readBounceMathParams(params: URLSearchParams, settings: BounceMathSettings): void {
  settings.bounceMath = parseRules(params.get(BOUNCE_MATH_URL_KEYS.rules));
  const hud = params.get(BOUNCE_MATH_URL_KEYS.hud);
  settings.bounceMathHud = hud === "0" ? false : hud === "1" ? true : settings.bounceMathHud;
}

/* ------------------------------------------------------------------ what the engine gets */

/** The beat grid the page hands over (the loaded song's, an imported video's or the hand-placed markers' – `rhythmBeat`). */
export interface BounceMathBeatInput {
  grid: BeatGrid | null;
  offset: number;
  loop: boolean;
}

/**
 * The beat the "beat" and "bar" triggers follow: the grid the page hands over (the beat source in effect – the loaded
 * song's detected beats, an imported video's, the hand-placed markers) while it is usable, else the Sound section's BPM –
 * the same grid Beat Drop and Picture Paint follow.
 */
export function bounceMathBeatConfig(bpm: number, beat?: BounceMathBeatInput | null): BeatClockConfig {
  const song = isUsableGrid(beat?.grid);
  return {
    ...DEFAULT_BEAT_CLOCK,
    source: song ? "song" : "bpm",
    grid: song ? beat!.grid : null,
    manualBpm: Number.isFinite(bpm) && bpm > 0 ? bpm : 120,
    offset: song ? Math.max(0, beat!.offset || 0) : 0,
    loop: song ? beat!.loop : true,
  };
}

/**
 * What the engine gets (`PhysicsConfig.bounceMath`): the rules, the beat grid, the starting values of the canvas
 * parameters (the wall thickness and the wobble are page settings the engine does not otherwise know) and "Show values".
 * It travels in the physics config, so the seed finder, split-screen arenas, the batch renderer and the fast export –
 * which all copy the page engine's config – replay a rule run exactly.
 */
export interface BounceMathConfig {
  rules: readonly BounceRule[];
  beat: BeatClockConfig;
  wallThickness: number;
  wallWobble: number;
  showValues: boolean;
}

export function bounceMathConfigOf(
  settings: BounceMathSettings & { bpm: number; wallThickness: number; wallWobble: number },
  beat?: BounceMathBeatInput | null,
): BounceMathConfig {
  return {
    rules: settings.bounceMath,
    beat: bounceMathBeatConfig(settings.bpm, beat),
    wallThickness: settings.wallThickness,
    wallWobble: settings.wallWobble,
    showValues: settings.bounceMathHud,
  };
}

/* ------------------------------------------------------------------ list editing (the panel) */

/** The rule "+ Add rule" appends: bounciness × 1.05 on every bounce. */
export function defaultRule(): BounceRule {
  return { param: "bounciness", trigger: "bounce", every: 1, op: "multiply", amount: 1.05, scope: "ball" };
}

/** The formula a rule switched to "formula" starts with (its current operation written out when there is one). */
export function exampleFormula(rule: Pick<BounceRule, "op" | "amount">): string {
  const a = String(rule.amount);
  switch (rule.op) {
    case "add":
      return `v + ${a}`;
    case "subtract":
      return `v - ${a}`;
    case "multiply":
      return `v * ${a}`;
    case "divide":
      return `v / ${a}`;
    case "power":
      return `v ^ ${a}`;
    case "set":
      return a;
    default:
      return "v * (1 + 0.1 * sin(n / 3))";
  }
}

export function addRule(list: readonly BounceRule[], rule: BounceRule = defaultRule()): BounceRule[] {
  return list.length >= MAX_BOUNCE_RULES ? [...list] : [...list, rule];
}

/** The list with rule `index` changed by `patch` (re-validated: an invalid result keeps the old rule). */
export function updateRule(list: readonly BounceRule[], index: number, patch: Partial<BounceRule>): BounceRule[] {
  if (index < 0 || index >= list.length) return [...list];
  const next = { ...list[index], ...patch };
  if (patch.op === "formula" && !next.formula) next.formula = exampleFormula(list[index]);
  if ("min" in patch && patch.min === undefined) delete next.min;
  if ("max" in patch && patch.max === undefined) delete next.max;
  const clean = sanitizeRule(next);
  if (!clean) return [...list];
  const out = [...list];
  out[index] = clean;
  return out;
}

export function removeRule(list: readonly BounceRule[], index: number): BounceRule[] {
  return list.filter((_, i) => i !== index);
}

/** Moves rule `index` one place up (−1) or down (+1); the list order is the order rules apply in. */
export function moveRule(list: readonly BounceRule[], index: number, direction: -1 | 1): BounceRule[] {
  const to = index + direction;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

/* ------------------------------------------------------------------ presets */

export const BOUNCE_MATH_PRESET_IDS = ["bouncier", "faster", "growing", "beatPump", "gravityFlip", "chaos"] as const;
export type BounceMathPresetId = (typeof BOUNCE_MATH_PRESET_IDS)[number];

/** The ready-made rule sets the panel's preset picker appends. */
export const BOUNCE_MATH_PRESETS: Readonly<Record<BounceMathPresetId, readonly BounceRule[]>> = {
  /** "Bouncier every bounce": the ball's bounciness × 1.05 on every bounce. */
  bouncier: [{ param: "bounciness", trigger: "bounce", every: 1, op: "multiply", amount: 1.05, scope: "ball" }],
  /** "Faster and faster": the ball's speed × 1.05 on every bounce. */
  faster: [{ param: "speed", trigger: "bounce", every: 1, op: "multiply", amount: 1.05, scope: "ball" }],
  /** "Growing ball": the ball's radius + 1 px on every bounce. */
  growing: [{ param: "size", trigger: "bounce", every: 1, op: "add", amount: 1, scope: "ball" }],
  /** "Beat pump": every ball × 1.35 on every beat and × 0.85 every second – the ball breathes with the song. */
  beatPump: [
    { param: "size", trigger: "beat", every: 1, op: "multiply", amount: 1.35, scope: "all" },
    { param: "size", trigger: "second", every: 1, op: "multiply", amount: 0.85, scope: "all" },
  ],
  /** "Gravity flips every bar": gravity × −1 every four beats. */
  gravityFlip: [{ param: "gravity", trigger: "bar", every: 1, op: "multiply", amount: -1, scope: "all" }],
  /** "Chaos formula": the ball's speed follows v · (1 + 0.1 · sin(n / 3)) on every bounce. */
  chaos: [{ param: "speed", trigger: "bounce", every: 1, op: "formula", amount: 0, formula: "v * (1 + 0.1 * sin(n / 3))", scope: "ball" }],
};

export function isBounceMathPresetId(value: unknown): value is BounceMathPresetId {
  return typeof value === "string" && (BOUNCE_MATH_PRESET_IDS as readonly string[]).includes(value);
}

/** The list with a preset's rules appended (up to `MAX_BOUNCE_RULES`). */
export function appendPreset(list: readonly BounceRule[], id: BounceMathPresetId): BounceRule[] {
  const out = [...list];
  for (const rule of BOUNCE_MATH_PRESETS[id]) {
    if (out.length >= MAX_BOUNCE_RULES) break;
    out.push({ ...rule });
  }
  return out;
}

/* ------------------------------------------------------------------ colour */

/** "#rrggbb" of r, g, b in 0–255. */
function hex(r: number, g: number, b: number): string {
  const h = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** A colour as hue (degrees), saturation and lightness (0–1), or null when it is not a colour this can read. */
export function parseColorHsl(color: string): { h: number; s: number; l: number } | null {
  const c = color.trim().toLowerCase();
  let r: number;
  let g: number;
  let b: number;
  let m: RegExpExecArray | null;
  if ((m = /^#([0-9a-f]{3})$/.exec(c))) {
    r = parseInt(m[1][0] + m[1][0], 16);
    g = parseInt(m[1][1] + m[1][1], 16);
    b = parseInt(m[1][2] + m[1][2], 16);
  } else if ((m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(c))) {
    r = parseInt(m[1].slice(0, 2), 16);
    g = parseInt(m[1].slice(2, 4), 16);
    b = parseInt(m[1].slice(4, 6), 16);
  } else if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(c))) {
    r = Number(m[1]);
    g = Number(m[2]);
    b = Number(m[3]);
  } else if ((m = /^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(c))) {
    return { h: ((Number(m[1]) % 360) + 360) % 360, s: Number(m[2]) / 100, l: Number(m[3]) / 100 };
  } else return null;
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** A colour from hue (degrees), saturation and lightness (0–1), as "#rrggbb". */
export function hslToHex(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return hex(255 * l, 255 * l, 255 * l);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return hex(255 * channel(hue + 1 / 3), 255 * channel(hue), 255 * channel(hue - 1 / 3));
}

/** Below this saturation a colour is (nearly) grey: turning its hue would change nothing you could see. */
export const ACHROMATIC_SATURATION = 0.1;

/**
 * `color` with its hue turned by `degrees` (a colour this cannot read comes back as it is). White, black and the greys have
 * no hue to turn (the default ball is white), so they turn from a saturated colour of a similar lightness instead – red at
 * 0°, kept between 45 % and 65 % lightness so it reads on the dark background: a colour shift always shows. A turn of 0
 * keeps the colour as it is.
 */
export function rotateHue(color: string, degrees: number): string {
  if (!Number.isFinite(degrees) || degrees === 0) return color;
  const hsl = parseColorHsl(color);
  if (!hsl) return color;
  if (hsl.s < ACHROMATIC_SATURATION) return hslToHex(hsl.h + degrees, 1, Math.min(0.65, Math.max(0.45, hsl.l)));
  return hslToHex(hsl.h + degrees, hsl.s, hsl.l);
}

/* ------------------------------------------------------------------ the readout */

/** A value for the readout and the HUD: up to three significant decimals, big values with k / M / B / T, "∞" beyond. */
export function formatBounceValue(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : value < 0 ? "-∞" : "–";
  const a = Math.abs(value);
  if (a >= 1e15) return value.toExponential(1).replace("+", "");
  if (a >= 1e12) return `${Math.round((value / 1e12) * 10) / 10}T`;
  if (a >= 1e9) return `${Math.round((value / 1e9) * 10) / 10}B`;
  if (a >= 1e6) return `${Math.round((value / 1e6) * 10) / 10}M`;
  if (a >= 1e4) return `${Math.round((value / 1e3) * 10) / 10}k`;
  if (a >= 100) return String(Math.round(value));
  if (a >= 10) return String(Math.round(value * 10) / 10);
  return String(Math.round(value * 1000) / 1000);
}
