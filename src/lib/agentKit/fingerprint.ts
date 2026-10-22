import type { PhysicsEngine } from "@/lib/physics/engine";
import type { ModeId, PhysicsConfig } from "@/lib/physics/types";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";

/*
 * --- agent-cli --- `npm run agent -- fingerprint`: a mode's determinism fingerprint by the recipe of tests/extras.test.ts
 * (the BASELINE every mode is pinned to): the config and mode settings below, seed 12345, 600 frames of 1/60 s, the first two
 * balls' positions × 1000 every 150 frames, the broken walls and the wall radii × 1000 – and its diff against the BASELINE
 * entry, read from the test file's own text (so the tool never carries a second copy of the numbers). An agent sees at once
 * whether its change moved a pinned trajectory; tests/agentKit.test.ts keeps this recipe equal to the test's.
 *
 * A moved fingerprint is a behaviour change to fix, never a number to re-record: a deliberate change needs a
 * `Fingerprint-Change: <mode> - <reason>` commit trailer and the owner's review (AGENTS.md).
 */

/** tests/extras.test.ts `config`. */
export const FINGERPRINT_CONFIG: PhysicsConfig = {
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

/** tests/extras.test.ts `modeSettings`. */
export const FINGERPRINT_MODE_SETTINGS: ModeSettings = {
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
  stringBattle: { life: "lives" },
};

export const FINGERPRINT_SEED = 12345;
export const FINGERPRINT_FRAMES = 600;
export const FINGERPRINT_SAMPLE_EVERY = 150;
/** Where the pinned numbers live. */
export const BASELINE_FILE = "tests/extras.test.ts";

export interface Fingerprint {
  /** [x, y] × 1000 of the first two balls every 150 frames. */
  samples: number[][];
  broken: number[];
  /** Wall radii × 1000 after the run. */
  walls: number[];
}

function fingerprintEngine(engine: PhysicsEngine, frames: number): Fingerprint {
  const samples: number[][] = [];
  for (let i = 1; i <= frames; i++) {
    engine.update(1000 / 60, 0);
    if (i % FINGERPRINT_SAMPLE_EVERY === 0) samples.push(...engine.getBalls().slice(0, 2).map((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]));
  }
  return {
    samples,
    broken: [...engine.getBrokenWalls()].sort((a, b) => a - b),
    walls: engine.getCircularWalls().map((w) => Math.round(w.radius * 1000)),
  };
}

/** The fingerprint of `mode` by the extras.test recipe (`seed` and `frames` default to the BASELINE's). */
export function fingerprintOf(mode: ModeId, seed = FINGERPRINT_SEED, frames = FINGERPRINT_FRAMES): Fingerprint {
  return fingerprintEngine(createEngineForSettings(FINGERPRINT_CONFIG, mode, FINGERPRINT_MODE_SETTINGS, seed), frames);
}

/** The source without its comments (line and block), strings left alone – enough for the BASELINE literal's numbers. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The text between the brace at `open` and its matching closing brace (exclusive), or null when it never closes. */
function braceBody(text: string, open: number): { body: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return { body: text.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/**
 * The entries of the `const BASELINE: Record<ModeId, Fingerprint> = { … };` literal in tests/extras.test.ts, by mode id.
 * Throws when the literal is missing or an entry is not the `{ samples, broken, walls }` shape (the file changed form).
 */
export function parseBaselineLiteral(source: string): Record<string, Fingerprint> {
  const text = stripComments(source);
  const at = text.search(/const\s+BASELINE\s*:[^=]*=\s*\{/);
  if (at < 0) throw new Error(`No "const BASELINE … = {" literal in ${BASELINE_FILE}`);
  const literal = braceBody(text, text.indexOf("{", text.indexOf("=", at)));
  if (!literal) throw new Error(`The BASELINE literal in ${BASELINE_FILE} never closes`);
  const out: Record<string, Fingerprint> = {};
  const entry = /([A-Za-z_$][\w$]*)\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(literal.body))) {
    const body = braceBody(literal.body, m.index + m[0].length - 1);
    if (!body) throw new Error(`The BASELINE entry ${m[1]} never closes`);
    const json = `{${body.body.replace(/([A-Za-z_$][\w$]*)\s*:/g, '"$1":').replace(/,\s*$/, "")}}`;
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      throw new Error(`The BASELINE entry ${m[1]} is not plain numbers`);
    }
    const fp = value as Partial<Fingerprint>;
    if (!Array.isArray(fp.samples) || !Array.isArray(fp.broken) || !Array.isArray(fp.walls)) throw new Error(`The BASELINE entry ${m[1]} is not { samples, broken, walls }`);
    out[m[1]] = { samples: fp.samples, broken: fp.broken, walls: fp.walls };
    entry.lastIndex = body.end + 1;
  }
  return out;
}

export interface FingerprintDiff {
  equal: boolean;
  /** One line per difference ("samples[2]: [395319,386187] → [395320,386187]"), at most 20. */
  differences: string[];
}

export function diffFingerprint(actual: Fingerprint, expected: Fingerprint): FingerprintDiff {
  const differences: string[] = [];
  const show = (v: unknown) => JSON.stringify(v);
  for (const key of ["samples", "broken", "walls"] as const) {
    const a = actual[key] as unknown[];
    const e = expected[key] as unknown[];
    if (a.length !== e.length) differences.push(`${key}: ${e.length} entries → ${a.length}`);
    for (let i = 0; i < Math.max(a.length, e.length); i++) {
      if (show(a[i]) !== show(e[i])) differences.push(`${key}[${i}]: ${show(e[i]) ?? "none"} → ${show(a[i]) ?? "none"}`);
    }
  }
  return { equal: differences.length === 0, differences: differences.slice(0, 20) };
}
