import { renderPluck } from "./instruments";
import { noiseSamples } from "./stringBattleTones";

/**
 * --- fl-overhaul --- (Stage 4) Fight League's synthesiser: every sound of the fights – a weapon's swing and hit, an ability's
 * charge, telegraph and fire, a match sting, an announcer's call – is a RECIPE in a compact notation (the tables of
 * flRecipes.ts are data in it), parsed once (`parseFlRecipe()`, cached) and scheduled as a small Web Audio graph
 * (`scheduleFlRecipe()`). Original synthesis only: oscillators, seeded noise, a plucked string and a vowel-shaped buzz; no
 * sample, no recording.
 *
 * A recipe is `role(N) layer + layer + … | echo` – `N` its length in ms (`held`: it lasts as long as the cue holds it). A
 * layer is a source and its modifiers, in any order after the source and its pitch:
 *
 *  - sources: `sin` `tri` `sqr` `saw` (oscillators), `p25` `p12` (pulse waves of 25 % / 12.5 % duty, PeriodicWaves cached per
 *    context), `wn` `pn` `bn` (seeded white, pink and brown noise, cached per sample rate), `ks f dD` (a Karplus–Strong
 *    string at f, D its loop decay – `renderPluck()`), `fmt v1>v2@ms pH1>H2 shK` (a sawtooth at the glide H1 → H2 through three
 *    band-passes on the formants F1/F2/F3 of vowels a I i e o O u V U r – widths 90/110/160 Hz, gains 1/.6/.35 – gliding from
 *    v1 to v2 by ms, × K), `bar f [g/d …]` (a struck bar: sines at f × 1, 2.76, 5.4, 8.93, each g loud, decaying over d ms);
 *  - a pitch: a fixed `98` (Hz, a signature's timbre: never snapped), `F` (the fighter's note), `R` (the scale's root), `H` (a
 *    family set's own pitch) or a multiple `F*2`, glides `f0>f1/ms` and a second segment `>f2@t/ms`;
 *  - `vR/C` vibrato (R Hz, C cents), `aR/D` amplitude modulation (R Hz, depth D), `mRiA>B/ms` FM (ratio R, index A → B);
 *  - `lp` `hp` `bp` `f0>f1/ms qQ` filters (a sweep), `wsK` a tanh drive (curves cached), `eA/D` (attack, decay ms), `dD` (a
 *    ≤ 2 ms attack, decay D), `eA/D/S/R` (ADSR) and `eA/D/S/Rh` (held: sustained for the cue's held time; `hN` for N ms);
 *  - `pG` the layer's gain at level 1, `@t` its offset (ms), `xN/E±J*D^P` N repeats E ms apart (± J ms of seeded jitter, the
 *    gain × D and the pitch × P each), `L.6` / `R.6` a stereo position, `L/R.3alt` repeats alternating sides;
 *  - `| echoT/FB/lpF/MIX` a feedback echo (T ms, feedback FB, low-passed at F in the loop, MIX of it sent).
 *
 * `scheduleFlRecipe(ctx, out, recipe, time, { F, R, H, level, pan, sustainSec, variant, slow, stretch })` builds it from `time`:
 * `variant` (0–1, the cue's per-fighter counter) detunes it ±40 cents and moves the noise's read position, `slow` (≤ 1: bullet
 * time) multiplies every pitch and divides every length, `stretch` lengthens it (a telegraph of a longer class),
 * `sustainSec` holds a held recipe (Infinity: a loop, released by its owner – the sources are handed back in `sources`).
 * `recipeDurationMs()` is the same timing, pure. Nothing here draws a random number: the jitter is a hash of the repeat,
 * so the page and the fast export render the same sound.
 */

export type FlSource = "sin" | "tri" | "sqr" | "saw" | "p25" | "p12" | "wn" | "pn" | "bn" | "ks" | "fmt" | "bar";
const SOURCES: ReadonlySet<string> = new Set(["sin", "tri", "sqr", "saw", "p25", "p12", "wn", "pn", "bn", "ks", "fmt", "bar"]);
const OSC_TYPE: Readonly<Record<string, OscillatorType>> = { sin: "sine", tri: "triangle", sqr: "square", saw: "sawtooth" };

/** A pitch: a fixed frequency (`ref` "") or a multiple of F (the fighter's note), R (the scale's root) or H (a family's pitch). */
export interface FlHz {
  ref: "" | "F" | "R" | "H";
  k: number;
}
/** A pitch glide: f0, then to f1 over ms, then (a second segment) to f2 from at2 over ms2 (ms, from the layer's start). */
export interface FlGlide {
  f0: FlHz;
  f1: FlHz | null;
  ms: number;
  f2: FlHz | null;
  at2: number;
  ms2: number;
}
export interface FlFilter {
  type: "lowpass" | "highpass" | "bandpass";
  f0: FlHz;
  f1: FlHz | null;
  ms: number;
  /** A second sweep segment: to f2 from at2 over ms2 (ms). */
  f2: FlHz | null;
  at2: number;
  ms2: number;
  q: number;
}
/** An envelope (ms): attack, decay; with `adsr` the decay goes to `s` and a release `r` follows (`held`: after the hold). */
export interface FlEnv {
  a: number;
  d: number;
  s: number;
  r: number;
  adsr: boolean;
  held: boolean;
  /** The hold (ms) of `hN`; −1: the cue's held time. */
  hold: number;
}
export interface FlRepeat {
  n: number;
  every: number;
  jitter: number;
  decay: number;
  pitch: number;
}
export interface FlLayer {
  src: FlSource;
  glide: FlGlide | null;
  ksDecay: number;
  partials: { g: number; d: number }[];
  vowels: { v: string; at: number }[];
  fmtPitch: FlHz[];
  shift: number;
  vib: { rate: number; cents: number } | null;
  am: { rate: number; depth: number } | null;
  fm: { ratio: number; i0: number; i1: number; ms: number } | null;
  filters: FlFilter[];
  drive: number;
  env: FlEnv | null;
  gain: number;
  at: number;
  rep: FlRepeat | null;
  pan: number;
  panAlt: boolean;
}
export interface FlEcho {
  ms: number;
  fb: number;
  lp: number;
  mix: number;
}
export interface FlRecipe {
  text: string;
  role: string;
  /** The declared length (ms); held recipes declare none (0). */
  ms: number;
  held: boolean;
  layers: FlLayer[];
  echo: FlEcho | null;
}

/** A struck bar's partial ratios (the `bar` source). */
export const FL_BAR_RATIOS = [1, 2.76, 5.4, 8.93] as const;
/** The vowels' formants F1/F2/F3 (Hz) of the `fmt` voice; o and O are the same. */
export const FL_VOWELS: Readonly<Record<string, readonly [number, number, number]>> = {
  a: [730, 1090, 2440],
  I: [390, 1990, 2550],
  i: [270, 2290, 3010],
  e: [530, 1840, 2480],
  o: [570, 840, 2410],
  O: [570, 840, 2410],
  u: [300, 870, 2240],
  V: [640, 1190, 2390],
  U: [440, 1020, 2240],
  r: [490, 1350, 1690],
};
/** The formant band-passes' widths (Hz) and gains. */
export const FL_FORMANT_WIDTHS = [90, 110, 160] as const;
export const FL_FORMANT_GAINS = [1, 0.6, 0.35] as const;
/** A held recipe is measured (and calibrated) at this hold. */
export const FL_TYPICAL_HOLD_SEC = 1;

/* ------------------------------------------------------------------ the parser */

const NUM = String.raw`\d*\.?\d+`;
const HZ_RE = /^(?:([FRH])(?:\*(\d*\.?\d+))?|(\d*\.?\d+))$/;
const HEADER_RE = /^([A-Za-z][A-Za-z0-9]*)\((\d+|held)\)\s+(.+)$/;
const ENV_AD = new RegExp(`^e(${NUM})/(${NUM})$`);
const ENV_ADSR = new RegExp(`^e(${NUM})/(${NUM})/(${NUM})/(${NUM})(h(${NUM})?)?$`);
const DECAY = new RegExp(`^d(${NUM})$`);
const GAIN = new RegExp(`^p(${NUM})$`);
const AM = new RegExp(`^a(${NUM})/(${NUM})$`);
const VIB = new RegExp(`^v(${NUM})/(${NUM})$`);
const FM = new RegExp(`^m(${NUM})i(${NUM})(?:>(${NUM})/(${NUM}))?$`);
const DRIVE = new RegExp(`^ws(${NUM})$`);
const SHIFT = new RegExp(`^sh(${NUM})$`);
const REPEAT = new RegExp(`^x(\\d+)/(${NUM})(?:±(${NUM}))?(?:\\*(${NUM}))?(?:\\^(${NUM}))?$`);
const OFFSET = new RegExp(`^@(${NUM})$`);
const PAN = new RegExp(`^([LR])(${NUM})$`);
const PAN_ALT = new RegExp(`^L/R(${NUM})alt$`);
const FILTER = /^(lp|hp|bp)(.+)$/;
const ECHO = new RegExp(`^echo(${NUM})/(${NUM})/lp(${NUM})/(${NUM})$`);

function fail(text: string, why: string): never {
  throw new Error(`Fight League recipe: ${why} in "${text}"`);
}

/** A pitch token: `98`, `F`, `R*0.75`, `H*1.006`. */
export function parseFlHz(s: string): FlHz {
  const m = HZ_RE.exec(s);
  if (!m) throw new Error(`Fight League recipe: bad pitch "${s}"`);
  if (m[1]) return { ref: m[1] as "F" | "R" | "H", k: m[2] !== undefined ? Number(m[2]) : 1 };
  return { ref: "", k: Number(m[3]) };
}

/** A glide `f0`, `f0>f1/ms` or `f0>f1/ms>f2@t/ms`. */
function parseGlide(s: string, text: string): FlGlide {
  const parts = s.split(">");
  const g: FlGlide = { f0: parseFlHz(parts[0]), f1: null, ms: 0, f2: null, at2: 0, ms2: 0 };
  if (parts.length >= 2) {
    const [f, ms] = parts[1].split("/");
    if (ms === undefined) fail(text, `a glide without its length "${s}"`);
    g.f1 = parseFlHz(f);
    g.ms = Number(ms);
  }
  if (parts.length >= 3) {
    const m = new RegExp(`^(.+)@(${NUM})/(${NUM})$`).exec(parts[2]);
    if (!m) fail(text, `a bad second glide segment "${s}"`);
    g.f2 = parseFlHz(m[1]);
    g.at2 = Number(m[2]);
    g.ms2 = Number(m[3]);
  }
  if (parts.length > 3) fail(text, `too many glide segments "${s}"`);
  return g;
}

function parseLayer(raw: string, text: string): FlLayer {
  let body = raw.trim();
  const partials: { g: number; d: number }[] = [];
  const bar = /\[([^\]]*)\]/.exec(body);
  if (bar) {
    for (const pair of bar[1].trim().split(/\s+/)) {
      const [g, d] = pair.split("/");
      partials.push({ g: Number(g), d: Number(d) });
    }
    body = (body.slice(0, bar.index) + body.slice(bar.index + bar[0].length)).trim();
  }
  const tokens = body.split(/\s+/);
  const src = tokens[0];
  if (!SOURCES.has(src)) fail(text, `an unknown source "${src}"`);
  const layer: FlLayer = { src: src as FlSource, glide: null, ksDecay: 0.996, partials, vowels: [], fmtPitch: [], shift: 1, vib: null, am: null, fm: null, filters: [], drive: 0, env: null, gain: 1, at: 0, rep: null, pan: 0, panAlt: false };
  let i = 1;
  const noise = src === "wn" || src === "pn" || src === "bn";
  if (src === "fmt") {
    const spec = tokens[i++];
    if (!spec) fail(text, "a formant voice without its vowels");
    const parts = spec.split(">");
    layer.vowels.push({ v: parts[0], at: 0 });
    for (const p of parts.slice(1)) {
      const m = new RegExp(`^([A-Za-z])@(${NUM})$`).exec(p);
      if (!m) fail(text, `a bad vowel glide "${spec}"`);
      layer.vowels.push({ v: m[1], at: Number(m[2]) });
    }
    for (const v of layer.vowels) if (!FL_VOWELS[v.v]) fail(text, `an unknown vowel "${v.v}"`);
  } else if (!noise) {
    const spec = tokens[i++];
    if (!spec) fail(text, `a ${src} without its pitch`);
    layer.glide = parseGlide(spec, text);
  }
  let ksDecaySeen = false;
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    let m: RegExpExecArray | null;
    if ((m = ENV_ADSR.exec(t))) layer.env = { a: Number(m[1]), d: Number(m[2]), s: Number(m[3]), r: Number(m[4]), adsr: true, held: !!m[5], hold: m[6] !== undefined ? Number(m[6]) : -1 };
    else if ((m = ENV_AD.exec(t))) layer.env = { a: Number(m[1]), d: Number(m[2]), s: 0, r: 0, adsr: false, held: false, hold: -1 };
    else if ((m = DECAY.exec(t))) {
      const v = Number(m[1]);
      if (src === "ks" && !ksDecaySeen && v < 1) {
        layer.ksDecay = v;
        ksDecaySeen = true;
      } else layer.env = { a: Math.min(2, v / 4), d: Math.max(0, v - Math.min(2, v / 4)), s: 0, r: 0, adsr: false, held: false, hold: -1 };
    } else if ((m = GAIN.exec(t))) layer.gain = Number(m[1]);
    else if (src === "fmt" && t.startsWith("p") && t.includes(">")) layer.fmtPitch = t.slice(1).split(">").map(parseFlHz);
    else if ((m = AM.exec(t))) layer.am = { rate: Number(m[1]), depth: Number(m[2]) };
    else if ((m = VIB.exec(t))) layer.vib = { rate: Number(m[1]), cents: Number(m[2]) };
    else if ((m = FM.exec(t))) layer.fm = { ratio: Number(m[1]), i0: Number(m[2]), i1: m[3] !== undefined ? Number(m[3]) : Number(m[2]), ms: m[4] !== undefined ? Number(m[4]) : 0 };
    else if ((m = DRIVE.exec(t))) layer.drive = Number(m[1]);
    else if ((m = SHIFT.exec(t))) layer.shift = Number(m[1]);
    else if ((m = REPEAT.exec(t))) layer.rep = { n: Number(m[1]), every: Number(m[2]), jitter: m[3] !== undefined ? Number(m[3]) : 0, decay: m[4] !== undefined ? Number(m[4]) : 1, pitch: m[5] !== undefined ? Number(m[5]) : 1 };
    else if ((m = OFFSET.exec(t))) layer.at = Number(m[1]);
    else if ((m = PAN_ALT.exec(t))) {
      layer.pan = Number(m[1]);
      layer.panAlt = true;
    } else if ((m = PAN.exec(t))) layer.pan = (m[1] === "L" ? -1 : 1) * Number(m[2]);
    else if ((m = FILTER.exec(t))) {
      const rest = m[2];
      const q = new RegExp(`q(${NUM})$`).exec(rest);
      const g = parseGlide(q ? rest.slice(0, q.index) : rest, text);
      layer.filters.push({ type: m[1] === "lp" ? "lowpass" : m[1] === "hp" ? "highpass" : "bandpass", f0: g.f0, f1: g.f1, ms: g.ms, f2: g.f2, at2: g.at2, ms2: g.ms2, q: q ? Number(q[1]) : m[1] === "bp" ? 1 : 0.707 });
    } else fail(text, `an unknown token "${t}"`);
  }
  if (src === "fmt" && layer.fmtPitch.length === 0) fail(text, "a formant voice without its pitch (pH1>H2)");
  if (src === "bar" && partials.length === 0) fail(text, "a bar without its partials [g/d …]");
  if (src !== "bar" && !layer.env) fail(text, `a ${src} layer without an envelope`);
  return layer;
}

const PARSED = new Map<string, FlRecipe>();

/** Parses a recipe (`role(N) layer + layer | echo`), cached by its text; throws on any token it does not know. */
export function parseFlRecipe(text: string): FlRecipe {
  const hit = PARSED.get(text);
  if (hit) return hit;
  const m = HEADER_RE.exec(text.trim());
  if (!m) fail(text, "no role(N) header");
  const [layersPart, echoPart] = m[3].split("|");
  let echo: FlEcho | null = null;
  if (echoPart !== undefined) {
    const e = ECHO.exec(echoPart.trim());
    if (!e) fail(text, `a bad echo "${echoPart.trim()}"`);
    echo = { ms: Number(e[1]), fb: Number(e[2]), lp: Number(e[3]), mix: Number(e[4]) };
  }
  const recipe: FlRecipe = { text, role: m[1], ms: m[2] === "held" ? 0 : Number(m[2]), held: m[2] === "held", layers: layersPart.split(" + ").map((l) => parseLayer(l, text)), echo };
  if (PARSED.size > 4096) PARSED.clear();
  PARSED.set(text, recipe);
  return recipe;
}

/* ------------------------------------------------------------------ timing (pure) */

/** A layer's envelope length (ms) at hold `heldMs` (a held envelope sustains to it), before its offset and repeats. */
function envMs(layer: FlLayer, heldMs: number): number {
  if (layer.src === "bar") {
    let d = 0;
    for (const p of layer.partials) d = Math.max(d, p.d + 1);
    return d;
  }
  const e = layer.env!;
  if (!e.adsr) return e.a + e.d;
  if (!e.held) return e.a + e.d + e.r;
  const hold = e.hold >= 0 ? e.a + e.d + e.hold : Math.max(e.a + e.d, heldMs);
  return hold + e.r;
}

function repeatSpanMs(layer: FlLayer): number {
  return layer.rep ? (layer.rep.n - 1) * layer.rep.every + layer.rep.jitter : 0;
}

/**
 * The hold (ms) a recipe sustains for when its cue gives none: FL_TYPICAL_HOLD_SEC for a `role(held)` one; for a one declared
 * with its typical length whose layers hold (a breath held for the cone, a hammer for its flight), that length less the
 * longest release of its held layers – so it lasts what it declares.
 */
export function defaultHoldMs(recipe: FlRecipe | string): number {
  const r = typeof recipe === "string" ? parseFlRecipe(recipe) : recipe;
  if (r.held) return 1000 * FL_TYPICAL_HOLD_SEC;
  let release = -1;
  for (const l of r.layers) if (l.env && l.env.held && l.env.hold < 0) release = Math.max(release, l.at + l.env.r);
  return release < 0 ? 1000 * FL_TYPICAL_HOLD_SEC : Math.max(0, r.ms - release);
}

/** Whether a recipe sustains for its cue's held time (a held envelope without its own hold): a breath, a beam, a sustain. */
export function flRecipeHolds(recipe: FlRecipe | string): boolean {
  const r = typeof recipe === "string" ? parseFlRecipe(recipe) : recipe;
  return r.held || r.layers.some((l) => !!l.env && l.env.held && l.env.hold < 0);
}

/**
 * The recipe's length in ms – its longest layer (offset + repeats + envelope) and two echo repeats – at a hold of `heldMs` (by
 * default `defaultHoldMs()`). What `scheduleFlRecipe()` schedules, without Web Audio.
 */
export function recipeDurationMs(recipe: FlRecipe | string, heldMs?: number): number {
  const r = typeof recipe === "string" ? parseFlRecipe(recipe) : recipe;
  const hold = heldMs ?? defaultHoldMs(r);
  let end = 0;
  for (const l of r.layers) end = Math.max(end, l.at + repeatSpanMs(l) + envMs(l, hold));
  return end + (r.echo ? 2 * r.echo.ms : 0);
}

/** Every pitch a recipe names, evaluated at typical F, R and H – for the range checks. */
function pitchesOf(l: FlLayer): FlHz[] {
  const out: FlHz[] = [];
  const g = l.glide;
  if (g) out.push(g.f0, ...(g.f1 ? [g.f1] : []), ...(g.f2 ? [g.f2] : []));
  out.push(...l.fmtPitch);
  return out;
}

/**
 * The recipe's range problems (empty: none): a held envelope only in a held recipe, attack + decay within the declared length,
 * finite gains above 0, filters 20–20 000 Hz with Q 0.1–20, pans within ±1, at most 40 repeats, a drive of at most 8, an FM
 * index of at most 6, an echo's feedback under 0.6 – F, R and H at `typical` (the tests).
 */
export function flRecipeProblems(recipe: FlRecipe | string, typical: { F: number; R: number; H: number } = { F: 330, R: 523.25, H: 440 }): string[] {
  const r = typeof recipe === "string" ? parseFlRecipe(recipe) : recipe;
  const out: string[] = [];
  const hz = (h: FlHz) => (h.ref === "" ? h.k : typical[h.ref] * h.k);
  for (const l of r.layers) {
    if (!(Number.isFinite(l.gain) && l.gain > 0)) out.push(`gain ${l.gain}`);
    for (const p of l.partials) if (!(p.g > 0 && p.d > 0)) out.push(`partial ${p.g}/${p.d}`);
    if (l.env && !r.held && l.env.a + l.env.d > r.ms + 1) out.push(`attack + decay ${l.env.a + l.env.d} > ${r.ms}`);
    for (const f of l.filters) {
      for (const h of [f.f0, ...(f.f1 ? [f.f1] : []), ...(f.f2 ? [f.f2] : [])]) if (!(hz(h) >= 20 && hz(h) <= 20000)) out.push(`filter ${hz(h)} Hz`);
      if (!(f.q >= 0.1 && f.q <= 20)) out.push(`Q ${f.q}`);
    }
    for (const h of pitchesOf(l)) if (!(hz(h) >= 10 && hz(h) <= 20000)) out.push(`pitch ${hz(h)} Hz`);
    if (Math.abs(l.pan) > 1) out.push(`pan ${l.pan}`);
    if (l.rep && (l.rep.n < 1 || l.rep.n > 40)) out.push(`repeats ${l.rep.n}`);
    if (l.drive > 8) out.push(`drive ${l.drive}`);
    if (l.fm && Math.max(l.fm.i0, l.fm.i1) > 6) out.push(`FM index ${Math.max(l.fm.i0, l.fm.i1)}`);
    if (l.vib && l.vib.cents > 600) out.push(`vibrato ${l.vib.cents} cents`);
    if (l.am && (l.am.depth < 0 || l.am.depth > 1)) out.push(`AM depth ${l.am.depth}`);
  }
  if (r.echo && !(r.echo.fb >= 0 && r.echo.fb < 0.6)) out.push(`echo feedback ${r.echo.fb}`);
  return out;
}

/* ------------------------------------------------------------------ caches */

/** Seconds of noise per colour (a held layer loops it). */
export const FL_NOISE_SECONDS = 2;
const NOISE_SEEDS = { wn: 0x2545f491, pn: 0x9e3779b1, bn: 0x6c8e9cf5 } as const;

/** Seeded noise of `color` (white, pink, brown), RMS-matched to white noise. */
export function flNoiseSamples(color: "wn" | "pn" | "bn", length: number): Float32Array<ArrayBuffer> {
  const white = noiseSamples(length, NOISE_SEEDS[color]);
  if (color === "wn") return white;
  const out = new Float32Array(white.length);
  if (color === "pn") {
    // Paul Kellet's refined pink filter.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < white.length; i++) {
      const w = white[i];
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else {
    // Brown: leaky integrated white noise.
    let last = 0;
    for (let i = 0; i < white.length; i++) {
      last = 0.985 * last + 0.15 * white[i];
      out[i] = last;
    }
  }
  let sum = 0;
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i];
  mean /= Math.max(1, out.length);
  for (let i = 0; i < out.length; i++) {
    out[i] -= mean;
    sum += out[i] * out[i];
  }
  const rms = Math.sqrt(sum / Math.max(1, out.length)) || 1;
  const k = 0.577 / rms; // white noise in [−1, 1) has an RMS of 1/√3
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

/** The Fourier coefficients of a pulse wave of duty `d` (no DC), `n` harmonics: [real, imag]. */
export function pulseCoefficients(d: number, n = 64): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const real = new Float32Array(n + 1);
  const imag = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) {
    real[k] = (2 / (k * Math.PI)) * Math.sin(2 * Math.PI * k * d);
    imag[k] = (2 / (k * Math.PI)) * (1 - Math.cos(2 * Math.PI * k * d));
  }
  return [real, imag];
}

const CURVES = new Map<number, Float32Array<ArrayBuffer>>();
/** A tanh drive curve of strength `k` (normalised to ±1 at full scale), cached by k. */
export function tanhCurve(k: number, points = 2048): Float32Array<ArrayBuffer> {
  const key = Math.round(k * 100) / 100;
  const hit = CURVES.get(key);
  if (hit) return hit;
  const c = new Float32Array(points);
  const norm = Math.tanh(Math.max(0.01, key));
  for (let i = 0; i < points; i++) c[i] = Math.tanh(key * ((2 * i) / (points - 1) - 1)) / norm;
  CURVES.set(key, c);
  return c;
}

/** The buffers and waves the synthesiser reuses: noise per sample rate and colour, plucked strings, pulse waves per context. */
export class FlSynthCache {
  private readonly noise = new Map<string, AudioBuffer>();
  private readonly plucks = new Map<string, AudioBuffer>();
  private waves = new WeakMap<object, Map<number, PeriodicWave>>();

  noiseBuffer(ctx: BaseAudioContext, color: "wn" | "pn" | "bn"): AudioBuffer {
    const key = `${ctx.sampleRate}:${color}`;
    let b = this.noise.get(key);
    if (!b) {
      const samples = flNoiseSamples(color, Math.round(ctx.sampleRate * FL_NOISE_SECONDS));
      b = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      b.copyToChannel(samples, 0);
      this.noise.set(key, b);
    }
    return b;
  }

  pluckBuffer(ctx: BaseAudioContext, hz: number, decay: number, sec: number): AudioBuffer {
    const f = Math.round(hz * 10) / 10;
    const s = Math.min(3, Math.max(0.05, Math.round(sec * 20) / 20));
    const key = `${ctx.sampleRate}:${f}:${decay}:${s}`;
    let b = this.plucks.get(key);
    if (!b) {
      if (this.plucks.size >= 96) this.plucks.clear();
      const samples = renderPluck(ctx.sampleRate, f, s, Math.min(0.9999, Math.max(0.5, decay)));
      b = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      b.copyToChannel(samples, 0);
      this.plucks.set(key, b);
    }
    return b;
  }

  pulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave | null {
    if (typeof ctx.createPeriodicWave !== "function") return null;
    let byDuty = this.waves.get(ctx);
    if (!byDuty) {
      byDuty = new Map();
      this.waves.set(ctx, byDuty);
    }
    let w = byDuty.get(duty);
    if (!w) {
      const [real, imag] = pulseCoefficients(duty);
      w = ctx.createPeriodicWave(real, imag);
      byDuty.set(duty, w);
    }
    return w;
  }

  clear() {
    this.noise.clear();
    this.plucks.clear();
    this.waves = new WeakMap();
  }
}

/* ------------------------------------------------------------------ scheduling */

export interface FlSynthOptions {
  /** The fighter's note, the scale's root and the family's pitch (Hz). */
  F?: number;
  R?: number;
  H?: number;
  /** × every layer's gain (default 1). */
  level?: number;
  /** The voice's stereo position (−1…1), added to a layer's own. */
  pan?: number;
  /** A held recipe's hold (s; default `defaultHoldMs()`); Infinity: until its owner stops the sources (a loop). */
  sustainSec?: number;
  /** 0–1: ±40 cents and the noise's read position (0.5: neither). */
  variant?: number;
  /** ≤ 1 (bullet time): every pitch × it, every length ÷ it. */
  slow?: number;
  /** Every length × it (a telegraph of a longer class). */
  stretch?: number;
  cache?: FlSynthCache;
  /** Receives every source node started (a loop's owner stops them). */
  sources?: AudioScheduledSourceNode[];
}

export interface FlScheduled {
  /** When the last layer (and the echo's tail) ends (context seconds; Infinity for a loop). */
  end: number;
  /** Nodes created (the render budget). */
  nodes: number;
}

const DEFAULT_CACHE = new FlSynthCache();

/** A seeded jitter in [−j, j] for repeat `k` of layer `li` (a hash, no random draw). */
function jitterMs(j: number, k: number, li: number, variant: number): number {
  if (!(j > 0)) return 0;
  let h = Math.imul((k + 1) * 0x9e3779b1 + li * 0x85ebca6b, 0xc2b2ae35) ^ Math.round(variant * 1e6);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296 - 0.5) * 2 * j;
}

interface Ctx {
  ctx: BaseAudioContext;
  cache: FlSynthCache;
  vars: { F: number; R: number; H: number };
  /** ms → s, with stretch and slow. */
  tk: number;
  /** The pitch factor (slow × the variant's cents). */
  pk: number;
  level: number;
  pan: number;
  heldSec: number;
  variant: number;
  nyquist: number;
  nodes: number;
  sources?: AudioScheduledSourceNode[];
}

function hzOf(c: Ctx, h: FlHz, extra = 1): number {
  const v = (h.ref === "" ? h.k : c.vars[h.ref] * h.k) * c.pk * extra;
  return Math.max(10, Math.min(c.nyquist, v));
}
/** A filter's cut-off: like a pitch, but never moved by the variant's cents or the slow factor (a timbre). */
function cutoffOf(c: Ctx, h: FlHz): number {
  const v = h.ref === "" ? h.k : c.vars[h.ref] * h.k;
  return Math.max(20, Math.min(c.nyquist, v));
}

/** Writes a glide onto a frequency param from `t0` (seconds; ms × c.tk), × `mul`. */
function applyGlide(c: Ctx, p: AudioParam, g: FlGlide, t0: number, mul: number) {
  p.setValueAtTime(hzOf(c, g.f0, mul), t0);
  if (g.f1) p.exponentialRampToValueAtTime(hzOf(c, g.f1, mul), t0 + Math.max(0.001, (g.ms * c.tk) / 1000));
  if (g.f2) {
    const at = t0 + (g.at2 * c.tk) / 1000;
    p.setValueAtTime(hzOf(c, g.f1 ?? g.f0, mul), at);
    p.exponentialRampToValueAtTime(hzOf(c, g.f2, mul), at + Math.max(0.001, (g.ms2 * c.tk) / 1000));
  }
}

/** The envelope's timing (s) for a copy starting at t0: attack end, decay end, release start, end (Infinity: a loop). */
function envTimes(c: Ctx, e: FlEnv, t0: number): { a: number; d: number; rel: number; end: number } {
  const a = t0 + Math.max(0.001, (e.a * c.tk) / 1000);
  const d = a + Math.max(0.001, (e.d * c.tk) / 1000);
  if (!e.adsr) return { a, d, rel: d, end: d };
  let rel = d;
  if (e.held) {
    if (e.hold >= 0) rel = d + (e.hold * c.tk) / 1000;
    else if (!Number.isFinite(c.heldSec)) return { a, d, rel: Infinity, end: Infinity };
    else rel = Math.max(d, t0 + c.heldSec);
  }
  return { a, d, rel, end: rel + Math.max(0.001, (e.r * c.tk) / 1000) };
}

/** Writes envelope `e` of peak `g` onto a gain param from t0; returns when it ends (Infinity: a loop). */
function applyEnv(c: Ctx, p: AudioParam, e: FlEnv, g: number, t0: number): number {
  const T = envTimes(c, e, t0);
  const peak = Math.max(1e-6, g);
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(peak, T.a);
  if (!e.adsr) {
    p.exponentialRampToValueAtTime(peak * 1e-4, T.d);
    p.setValueAtTime(0, T.d + 0.002);
    return T.d + 0.002;
  }
  const sus = Math.max(1e-6, peak * Math.max(0, Math.min(1, e.s)));
  if (Math.abs(sus - peak) > 1e-9) p.exponentialRampToValueAtTime(sus, T.d);
  else p.setValueAtTime(peak, T.d);
  if (!Number.isFinite(T.rel)) return Infinity;
  p.setValueAtTime(sus, T.rel);
  p.exponentialRampToValueAtTime(sus * 1e-4, T.end);
  p.setValueAtTime(0, T.end + 0.002);
  return T.end + 0.002;
}

/** The tail every copy of a layer feeds: its filters (a sweep from `t0`), the drive, the stereo position → `dest`. */
function buildTail(c: Ctx, l: FlLayer, dest: AudioNode, t0: number, pan: number): AudioNode {
  const ctx = c.ctx;
  const chain: AudioNode[] = [];
  for (const f of l.filters) {
    const bq = ctx.createBiquadFilter();
    bq.type = f.type;
    bq.Q.value = f.q;
    bq.frequency.setValueAtTime(cutoffOf(c, f.f0), t0);
    if (f.f1) bq.frequency.exponentialRampToValueAtTime(cutoffOf(c, f.f1), t0 + Math.max(0.001, (f.ms * c.tk) / 1000));
    if (f.f2) {
      const at = t0 + (f.at2 * c.tk) / 1000;
      bq.frequency.setValueAtTime(cutoffOf(c, f.f1 ?? f.f0), at);
      bq.frequency.exponentialRampToValueAtTime(cutoffOf(c, f.f2), at + Math.max(0.001, (f.ms2 * c.tk) / 1000));
    }
    chain.push(bq);
  }
  if (l.drive > 0 && typeof ctx.createWaveShaper === "function") {
    const ws = ctx.createWaveShaper();
    ws.curve = tanhCurve(l.drive);
    ws.oversample = "none";
    chain.push(ws);
  }
  const p = Math.max(-1, Math.min(1, pan));
  if (Math.abs(p) > 0.005 && typeof ctx.createStereoPanner === "function") {
    const sp = ctx.createStereoPanner();
    sp.pan.value = p;
    chain.push(sp);
  }
  if (chain.length === 0) return dest;
  for (let i = 0; i + 1 < chain.length; i++) chain[i].connect(chain[i + 1]);
  chain[chain.length - 1].connect(dest);
  c.nodes += chain.length;
  return chain[0];
}

/** Starts an oscillator of the layer's source (a pulse wave's PeriodicWave; a square without one). */
function oscOf(c: Ctx, src: FlSource): OscillatorNode {
  const o = c.ctx.createOscillator();
  c.nodes++;
  if (src === "p25" || src === "p12") {
    const w = c.cache.pulseWave(c.ctx, src === "p25" ? 0.25 : 0.125);
    if (w && typeof o.setPeriodicWave === "function") o.setPeriodicWave(w);
    else o.type = "square";
  } else o.type = OSC_TYPE[src] ?? "sine";
  return o;
}

function startStop(c: Ctx, s: AudioScheduledSourceNode, t0: number, end: number, offset?: number) {
  if (offset !== undefined) (s as AudioBufferSourceNode).start(t0, offset);
  else s.start(t0);
  if (Number.isFinite(end)) s.stop(end + 0.02);
  c.sources?.push(s);
}

/** A vibrato (cents) on an oscillator's detune, from t0 to end. */
function vibrato(c: Ctx, o: OscillatorNode, v: { rate: number; cents: number }, t0: number, end: number) {
  if (!o.detune) return;
  const lfo = c.ctx.createOscillator();
  lfo.frequency.value = v.rate;
  const g = c.ctx.createGain();
  g.gain.value = v.cents;
  lfo.connect(g);
  g.connect(o.detune);
  c.nodes += 2;
  startStop(c, lfo, t0, end);
}

/** Schedules one copy of a layer from t0 into `tail`, `g` loud and its pitch × `pm`; returns when it ends. */
function scheduleCopy(c: Ctx, l: FlLayer, tail: AudioNode, t0: number, g: number, pm: number, k: number, li: number): number {
  const ctx = c.ctx;
  if (l.src === "bar") {
    let end = t0;
    const base = l.glide!;
    for (let j = 0; j < l.partials.length && j < FL_BAR_RATIOS.length; j++) {
      const part = l.partials[j];
      const o = ctx.createOscillator();
      o.type = "sine";
      const f = hzOf(c, base.f0, pm * FL_BAR_RATIOS[j]);
      o.frequency.setValueAtTime(f, t0);
      const e = ctx.createGain();
      const peak = Math.max(1e-6, part.g * g);
      const d = t0 + 0.001 + Math.max(0.002, (part.d * c.tk) / 1000);
      e.gain.setValueAtTime(0, t0);
      e.gain.linearRampToValueAtTime(peak, t0 + 0.001);
      e.gain.exponentialRampToValueAtTime(peak * 1e-4, d);
      e.gain.setValueAtTime(0, d + 0.002);
      o.connect(e);
      e.connect(tail);
      c.nodes += 2;
      startStop(c, o, t0, d + 0.002);
      end = Math.max(end, d + 0.002);
    }
    return end;
  }
  const env = l.env!;
  const T = envTimes(c, env, t0);
  const amp = ctx.createGain();
  c.nodes++;
  let into: AudioNode = amp;
  // Amplitude modulation: a gain between 1 − depth and 1 before the envelope.
  if (l.am) {
    const am = ctx.createGain();
    am.gain.value = 1 - l.am.depth / 2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = l.am.rate;
    const lg = ctx.createGain();
    lg.gain.value = l.am.depth / 2;
    lfo.connect(lg);
    lg.connect(am.gain);
    am.connect(amp);
    c.nodes += 3;
    startStop(c, lfo, t0, T.end);
    into = am;
  }
  const end = applyEnv(c, amp.gain, env, g, t0);
  amp.connect(tail);
  if (l.src === "wn" || l.src === "pn" || l.src === "bn") {
    const s = ctx.createBufferSource();
    const buf = c.cache.noiseBuffer(ctx, l.src);
    s.buffer = buf;
    s.loop = true;
    s.connect(into);
    c.nodes++;
    const span = Math.max(0, buf.duration - 0.05);
    const offset = span > 0 ? (((c.variant * 7.919 + k * 0.371 + li * 0.137) % 1) + 1) % 1 * span : 0;
    startStop(c, s, t0, end, offset);
    return end;
  }
  if (l.src === "ks") {
    const f = hzOf(c, l.glide!.f0, pm);
    const lenSec = Number.isFinite(end) ? end - t0 + 0.05 : 3;
    const s = ctx.createBufferSource();
    s.buffer = c.cache.pluckBuffer(ctx, f, l.ksDecay, lenSec);
    s.connect(into);
    c.nodes++;
    startStop(c, s, t0, end);
    return end;
  }
  if (l.src === "fmt") {
    const o = oscOf(c, "saw");
    const times = l.vowels.map((v) => t0 + (v.at * c.tk) / 1000);
    const lastT = times[times.length - 1] > t0 ? times[times.length - 1] : Number.isFinite(T.end) ? T.end : t0 + 1;
    // The pitch glide: on the vowels' breakpoints when it has as many values, else spread evenly to the last one.
    const pt = l.fmtPitch.length === times.length ? times : l.fmtPitch.map((_, i) => t0 + (l.fmtPitch.length > 1 ? (i / (l.fmtPitch.length - 1)) * (lastT - t0) : 0));
    o.frequency.setValueAtTime(hzOf(c, l.fmtPitch[0], pm), t0);
    for (let i = 1; i < l.fmtPitch.length; i++) o.frequency.exponentialRampToValueAtTime(hzOf(c, l.fmtPitch[i], pm), Math.max(pt[i], pt[i - 1] + 0.001));
    if (l.vib) vibrato(c, o, l.vib, t0, end);
    const sum = ctx.createGain();
    sum.gain.value = 1;
    sum.connect(into);
    c.nodes++;
    for (let fi = 0; fi < 3; fi++) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      const at = (vi: number) => Math.max(40, Math.min(c.nyquist, FL_VOWELS[l.vowels[vi].v][fi] * l.shift));
      bp.frequency.setValueAtTime(at(0), t0);
      for (let vi = 1; vi < l.vowels.length; vi++) bp.frequency.linearRampToValueAtTime(at(vi), Math.max(times[vi], times[vi - 1] + 0.001));
      bp.Q.value = Math.max(0.5, (FL_VOWELS[l.vowels[0].v][fi] * l.shift) / FL_FORMANT_WIDTHS[fi]);
      const fg = ctx.createGain();
      fg.gain.value = FL_FORMANT_GAINS[fi];
      o.connect(bp);
      bp.connect(fg);
      fg.connect(sum);
      c.nodes += 2;
    }
    startStop(c, o, t0, end);
    return end;
  }
  // An oscillator (sin, tri, sqr, saw, p25, p12): its glide, vibrato and FM.
  const o = oscOf(c, l.src);
  applyGlide(c, o.frequency, l.glide!, t0, pm);
  if (l.vib) vibrato(c, o, l.vib, t0, end);
  if (l.fm) {
    const m = ctx.createOscillator();
    m.type = "sine";
    applyGlide(c, m.frequency, l.glide!, t0, pm * l.fm.ratio);
    const mg = ctx.createGain();
    const fm0 = hzOf(c, l.glide!.f0, pm * l.fm.ratio);
    mg.gain.setValueAtTime(l.fm.i0 * fm0, t0);
    if (l.fm.ms > 0) mg.gain.linearRampToValueAtTime(l.fm.i1 * fm0, t0 + (l.fm.ms * c.tk) / 1000);
    m.connect(mg);
    mg.connect(o.frequency);
    c.nodes += 2;
    startStop(c, m, t0, end);
  }
  o.connect(into);
  startStop(c, o, t0, end);
  return end;
}

/** Schedules layer `li` from `time`; returns when its last copy ends. */
function scheduleLayer(c: Ctx, l: FlLayer, li: number, dest: AudioNode, time: number): number {
  const start = time + (l.at * c.tk) / 1000;
  const copies = l.rep ? Math.max(1, Math.min(40, l.rep.n)) : 1;
  const sweep = l.filters.some((f) => f.f1 !== null || f.f2 !== null);
  const tails = new Map<number, AudioNode>();
  const tailFor = (sign: number, t0: number) => {
    const pan = c.pan + (l.panAlt ? sign * l.pan : l.pan);
    if (sweep) return buildTail(c, l, dest, t0, pan);
    let tail = tails.get(sign);
    if (!tail) {
      tail = buildTail(c, l, dest, start, pan);
      tails.set(sign, tail);
    }
    return tail;
  };
  let end = start;
  for (let k = 0; k < copies; k++) {
    const t0 = start + (l.rep ? ((k * l.rep.every + jitterMs(l.rep.jitter, k, li, c.variant)) * c.tk) / 1000 : 0);
    const g = l.gain * c.level * (l.rep ? Math.pow(l.rep.decay, k) : 1);
    const pm = l.rep ? Math.pow(l.rep.pitch, k) : 1;
    const sign = l.panAlt ? (k % 2 === 0 ? -1 : 1) : 1;
    end = Math.max(end, scheduleCopy(c, l, tailFor(sign, Math.max(time, t0)), Math.max(time, t0), g, pm, k, li));
  }
  return end;
}

/**
 * Schedules `recipe` from `time` (context seconds) into `out` (see the header for the options). Returns when it ends and how
 * many nodes it made. Throws only on a recipe it cannot parse.
 */
export function scheduleFlRecipe(ctx: BaseAudioContext, out: AudioNode, recipe: FlRecipe | string, time: number, opts: FlSynthOptions = {}): FlScheduled {
  const r = typeof recipe === "string" ? parseFlRecipe(recipe) : recipe;
  const slow = Math.max(0.25, Math.min(1, Number.isFinite(opts.slow) ? (opts.slow as number) : 1));
  const variant = Number.isFinite(opts.variant) ? Math.max(0, Math.min(1, opts.variant as number)) : 0.5;
  const c: Ctx = {
    ctx,
    cache: opts.cache ?? DEFAULT_CACHE,
    vars: { F: opts.F && opts.F > 0 ? opts.F : 330, R: opts.R && opts.R > 0 ? opts.R : 523.25, H: opts.H && opts.H > 0 ? opts.H : 440 },
    tk: Math.max(0.05, Number.isFinite(opts.stretch) ? (opts.stretch as number) : 1) / slow,
    pk: slow * Math.pow(2, ((variant - 0.5) * 80) / 1200),
    level: Number.isFinite(opts.level) ? Math.max(0, opts.level as number) : 1,
    pan: Number.isFinite(opts.pan) ? Math.max(-1, Math.min(1, opts.pan as number)) : 0,
    heldSec: opts.sustainSec === undefined || Number.isNaN(opts.sustainSec) ? defaultHoldMs(r) / 1000 / slow : opts.sustainSec === Infinity ? Infinity : Math.max(0, opts.sustainSec / slow),
    variant,
    nyquist: Math.max(1000, ctx.sampleRate / 2 - 100),
    nodes: 0,
    sources: opts.sources,
  };
  let dest: AudioNode = out;
  let fb: GainNode | null = null;
  let send: GainNode | null = null;
  const echoSec = r.echo ? (r.echo.ms * c.tk) / 1000 : 0;
  if (r.echo && typeof ctx.createDelay === "function") {
    const input = ctx.createGain();
    input.connect(out);
    send = ctx.createGain();
    send.gain.setValueAtTime(r.echo.mix, time);
    const dl = ctx.createDelay(2);
    dl.delayTime.value = Math.min(1.9, echoSec);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.min(c.nyquist, r.echo.lp);
    fb = ctx.createGain();
    fb.gain.setValueAtTime(Math.min(0.59, r.echo.fb), time);
    input.connect(send);
    send.connect(dl);
    dl.connect(lp);
    lp.connect(out);
    lp.connect(fb);
    fb.connect(dl);
    c.nodes += 6;
    dest = input;
  }
  let end = time;
  for (let li = 0; li < r.layers.length; li++) end = Math.max(end, scheduleLayer(c, r.layers[li], li, dest, time));
  if (fb && send && Number.isFinite(end)) {
    // The loop dies out: nothing more goes in after the dry sound, and the feedback stops after a few repeats.
    send.gain.setValueAtTime(0, end);
    fb.gain.setValueAtTime(0, end + 4 * echoSec);
  }
  return { end: r.echo && Number.isFinite(end) ? end + 2 * echoSec : end, nodes: c.nodes };
}
