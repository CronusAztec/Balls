/**
 * Ball characters (the "Boris" persona of the borisbounces format): a vector face drawn on the ball – two eyes
 * whose pupils look along the flight, a seeded blink and expressions driven by what happens to the ball – plus an
 * optional name label under it and a render-only squash-and-stretch on impact.
 *
 * Everything here is visual: the settings never reach the physics engine, so seeds, the finder and "rigged"
 * outcomes are untouched. This file holds the settings (defaults, ranges, validation), the face styles, the Boris
 * persona and the face geometry – pure and shared by the canvas renderer (components/simulator/faceRenderer.ts),
 * the live preview in the panel (sections/CharacterSection.tsx) and the tests. The expression state machine is
 * in ./expression.ts, the eye / blink / squash maths in ./eyes.ts and the per-ball bookkeeping in ./tracker.ts.
 */

export const FACE_STYLES = ["none", "dot", "cute", "cool", "cat", "angry"] as const;
export type FaceStyle = (typeof FACE_STYLES)[number];

export function isFaceStyle(value: unknown): value is FaceStyle {
  return typeof value === "string" && (FACE_STYLES as readonly string[]).includes(value);
}

/** The character settings as they live in `SimulatorSettings` (all visual, none of them reaches the engine). */
export interface CharacterSettings {
  /** none | dot | cute | cool | cat | angry (URL `face`). */
  ballFace: FaceStyle;
  /** Draw the face over a custom ball image or emoji too (URL `fimg`); off keeps the picture's own face. */
  faceOverImage: boolean;
  /** Name drawn under the (first) ball, e.g. "Boris" (URL `bn`); empty = no label. */
  ballName: string;
  /** Show the name label (URL `nl`). */
  nameLabel: boolean;
  /** 0–1: how much the ball squashes on impact and stretches back (URL `sq`); render-only. */
  ballSquash: number;
  /** Cat face: a synthesised meow-like chirp on ouch / surprise / escape while the bounce sound is not a hit sample (URL `fsnd`). */
  faceSounds: boolean;
}

/** Off by default: no face, no label, no squash, so nothing changes until a character is picked. */
export const DEFAULT_CHARACTER: CharacterSettings = {
  ballFace: "none",
  faceOverImage: false,
  ballName: "",
  nameLabel: true,
  ballSquash: 0,
  faceSounds: false,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const CHARACTER_RANGES = {
  ballSquash: { min: 0, max: 1, step: 0.05 },
} as const;

/** Longest name the label shows (URL parameters and presets are trimmed to it). */
export const MAX_NAME_LENGTH = 24;

/** The persona of the demo: Boris, a round little guy with big eyes who always escapes (freedom lasts about 4 seconds). */
export const BORIS_PERSONA = {
  ballFace: "cute",
  ballName: "Boris",
  nameLabel: true,
  ballSquash: 0.6,
} as const satisfies Partial<CharacterSettings>;
/** Boris needs a ball big enough to read his face on a phone: the persona raises the ball size to at least this. */
export const BORIS_MIN_RADIUS = 16;

/** The settings patch the "Meet Boris" button applies (the ball size only ever grows). */
export function borisPersonaPatch(current: { ballRadius: number }): Partial<CharacterSettings> & { ballRadius: number } {
  return { ...BORIS_PERSONA, ballRadius: Math.max(current.ballRadius, BORIS_MIN_RADIUS) };
}

/** Trims a name to one line of at most `MAX_NAME_LENGTH` characters. */
export function sanitizeName(value: unknown): string {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(/[\r\n\t]+/g, " ")).slice(0, MAX_NAME_LENGTH).join("").trim();
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Fills in the defaults and validates every value (URL parameters and presets alike): unknown faces and non-boolean flags fall back. */
export function resolveCharacterSettings(source: Partial<CharacterSettings> | null | undefined): CharacterSettings {
  const out = { ...DEFAULT_CHARACTER };
  if (!source) return out;
  if (isFaceStyle(source.ballFace)) out.ballFace = source.ballFace;
  if (typeof source.faceOverImage === "boolean") out.faceOverImage = source.faceOverImage;
  if (source.ballName !== undefined) out.ballName = sanitizeName(source.ballName);
  if (typeof source.nameLabel === "boolean") out.nameLabel = source.nameLabel;
  if (source.ballSquash !== undefined) out.ballSquash = clampNumber(source.ballSquash, CHARACTER_RANGES.ballSquash, out.ballSquash);
  if (typeof source.faceSounds === "boolean") out.faceSounds = source.faceSounds;
  return out;
}

/** Picks the character fields out of a bigger object (the SimulatorSettings, a preset…). */
export function characterOf(source: CharacterSettings): CharacterSettings {
  return {
    ballFace: source.ballFace,
    faceOverImage: source.faceOverImage,
    ballName: source.ballName,
    nameLabel: source.nameLabel,
    ballSquash: source.ballSquash,
    faceSounds: source.faceSounds,
  };
}

/** What the canvas needs to draw the character (resolved from the settings by the page). */
export interface CharacterRenderOptions {
  face: FaceStyle;
  faceOverImage: boolean;
  /** The label text, or "" for none (name empty or the label switched off). */
  label: string;
  squash: number;
  /** Report expression events so the page can play the cat chirp. */
  sounds: boolean;
}

/**
 * The cat chirp plays only with the cat face, the face sounds on and the bounce sound not replaced by an audio
 * clip ("when the hit sample is unset"): a sample-driven clip keeps its own sound world.
 */
export function characterSoundsOn(s: { ballFace: FaceStyle; faceSounds: boolean; hitSoundMode: string }): boolean {
  return s.ballFace === "cat" && s.faceSounds && s.hitSoundMode !== "sample";
}

export function characterRenderOptions(s: CharacterSettings & { hitSoundMode: string }): CharacterRenderOptions {
  return {
    face: s.ballFace,
    faceOverImage: s.faceOverImage,
    label: s.nameLabel ? sanitizeName(s.ballName) : "",
    squash: s.ballSquash,
    sounds: characterSoundsOn(s),
  };
}

/* ------------------------------------------------------------------ face geometry */

/**
 * Where the features of a face sit on a ball of radius `r`, in px relative to the ball centre (y down). Every
 * value is proportional to the radius, so a face scales with the ball size (and with Ball Drop's size spread).
 */
export interface FaceGeometry {
  /** Horizontal distance of each eye from the centre line. */
  eyeDx: number;
  /** Height of the eyes (negative = above the centre). */
  eyeY: number;
  /** Radius of the eye white (for "dot": the dot itself). */
  eyeR: number;
  /** Radius of the pupil (0 for "dot", whose dot is the pupil). */
  pupilR: number;
  /** How far a pupil (or a dot eye) may travel from the eye centre when it looks along the flight. */
  maxLook: number;
  /** How far the whole face shifts toward the flight direction (a hint of the ball turning its head). */
  faceShift: number;
  /** Height of the mouth centre. */
  mouthY: number;
  /** Half the width of the mouth. */
  mouthW: number;
}

/** Ball radius under which a face is reduced to two dots (a detailed face would be a few blurred pixels). */
export const TINY_FACE_RADIUS = 6;

export function faceGeometry(style: FaceStyle, r: number): FaceGeometry {
  const radius = Math.max(0, r);
  if (style === "dot" || radius < TINY_FACE_RADIUS) {
    const eyeR = 0.12 * radius;
    return { eyeDx: 0.32 * radius, eyeY: -0.1 * radius, eyeR, pupilR: 0, maxLook: 0.14 * radius, faceShift: 0.1 * radius, mouthY: 0.3 * radius, mouthW: 0.18 * radius };
  }
  const eyeR = (style === "cute" ? 0.29 : style === "cat" ? 0.25 : 0.24) * radius;
  const pupilR = (style === "cute" ? 0.6 : style === "cat" ? 0.5 : 0.48) * eyeR;
  return {
    eyeDx: (style === "cute" ? 0.38 : 0.36) * radius,
    eyeY: (style === "cute" ? -0.08 : -0.12) * radius,
    eyeR,
    pupilR,
    // The pupil stays inside the eye white with a thin rim.
    maxLook: Math.max(0, eyeR - pupilR - 0.08 * eyeR),
    faceShift: 0.1 * radius,
    mouthY: (style === "cute" ? 0.36 : 0.38) * radius,
    mouthW: (style === "cute" ? 0.16 : 0.22) * radius,
  };
}
