import type { Particle } from "./types";
import { TWO_PI } from "./types";

/**
 * Particle styles of the celebration bursts (the "confetti" the engine throws when a wall breaks, a portal
 * fires, a run finishes…). "confetti" is the classic burst and stays the default; the other styles are
 * drawn by `components/simulator/themeRenderer.ts` from the `style` field of each particle.
 *
 * Everything here is visual only: the engine's physics never reads a particle, so the bursts use
 * `Math.random` (like the existing effects) and never touch the seeded generator – seeds, the finder and
 * "rigged" outcomes are unaffected by the particle style.
 */
export const PARTICLE_STYLES = ["confetti", "sparks", "petals", "pixels", "bubbles"] as const;
export type ParticleStyle = (typeof PARTICLE_STYLES)[number];
/** The styles drawn by the theme renderer (everything but the classic confetti). */
export type StyledParticleKind = NonNullable<Particle["style"]>;

export function isParticleStyle(value: unknown): value is ParticleStyle {
  return typeof value === "string" && (PARTICLE_STYLES as readonly string[]).includes(value);
}

/** The classic confetti colours (engine.spawnConfetti) – also the fallback palette of a themed confetti burst. */
export const CLASSIC_CONFETTI_COLORS = ["#FF6B6B", "#4ECDC4", "#FFE66D", "#95E1D3", "#F38181", "#AA96DA", "#FCBAD3", "#A8D8EA"];

/** Colours a style uses when no theme palette is set. */
export const STYLE_PALETTES: Record<ParticleStyle, readonly string[]> = {
  confetti: CLASSIC_CONFETTI_COLORS,
  sparks: ["#FFF7D6", "#FFD166", "#FF9F1C", "#FFFFFF"],
  petals: ["#FFC8DD", "#FFAFCC", "#FDE2E4", "#F8BBD0"],
  pixels: ["#FF004D", "#FFA300", "#FFEC27", "#00E436", "#29ADFF", "#FF77A8"],
  bubbles: ["#BDE0FE", "#A2D2FF", "#E0FBFC", "#CAF0F8"],
};

/**
 * Shape of each style's burst: particle count, launch speed (px/s), size, lifetime (s), spin and the
 * gravity multiplier the engine's particle integrator applies (1 = the classic 400 px/s², negative rises).
 */
export interface BurstRecipe {
  count: number;
  speed: [number, number];
  size: [number, number];
  life: [number, number];
  spin: number;
  gravity: number;
}

export const BURST_RECIPES: Record<ParticleStyle, BurstRecipe> = {
  confetti: { count: 30, speed: [150, 350], size: [4, 10], life: [1.5, 1.5], spin: 10, gravity: 1 },
  sparks: { count: 36, speed: [250, 550], size: [1.2, 2.6], life: [0.45, 0.9], spin: 0, gravity: 0.6 },
  petals: { count: 22, speed: [60, 200], size: [5, 9], life: [2.2, 3.2], spin: 4, gravity: 0.12 },
  pixels: { count: 28, speed: [120, 320], size: [3, 7], life: [1, 1.6], spin: 0, gravity: 1 },
  bubbles: { count: 18, speed: [40, 140], size: [3, 9], life: [1.6, 2.6], spin: 0, gravity: -0.35 },
};

/**
 * Throws one burst of `style` particles from (x, y) through `push` (the engine's capped `pushParticle`).
 * `palette` replaces the style's own colours when it is not empty (a theme's colours). `rand` defaults to
 * Math.random – visual randomness only – and is injectable for the unit tests.
 */
export function spawnStyledBurst(style: ParticleStyle, palette: readonly string[], x: number, y: number, push: (p: Particle) => void, rand: () => number = Math.random): void {
  const recipe = BURST_RECIPES[style];
  const colors = palette.length > 0 ? palette : STYLE_PALETTES[style];
  const between = (range: [number, number]) => range[0] + (range[1] - range[0]) * rand();
  for (let i = 0; i < recipe.count; i++) {
    // Evenly spread around the circle plus a little jitter, like the classic confetti.
    const a = (TWO_PI * i) / recipe.count + 0.5 * rand();
    // Bubbles drift mostly upwards from the start; everything else flies out radially.
    const speed = between(recipe.speed);
    const vx = Math.cos(a) * speed;
    const vy = style === "bubbles" ? -Math.abs(Math.sin(a)) * speed - 30 : Math.sin(a) * speed;
    const life = between(recipe.life);
    const size = style === "pixels" ? Math.round(between(recipe.size)) : between(recipe.size);
    push({
      x,
      y,
      vx,
      vy,
      color: colors[Math.floor(rand() * colors.length) % colors.length],
      size,
      life,
      maxLife: Math.max(life, recipe.life[1]),
      rotation: recipe.spin > 0 ? rand() * TWO_PI : 0,
      rotationSpeed: recipe.spin > 0 ? (rand() - 0.5) * recipe.spin : 0,
      type: "confetti",
      style: style === "confetti" ? undefined : style,
      gravity: recipe.gravity === 1 ? undefined : recipe.gravity,
    });
  }
}
