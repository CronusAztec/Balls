/*
 * --- crew --- The AI studio crew's rules (lib/crew/): one AI in several roles reviews every clip, and these plain-code checks
 * come first and cost nothing. This step holds the clip as the crew reads it (clip.ts), the HUD flags (hudFlags.ts), the Simple
 * score (simplicity.ts), the clarity gates (clarity.ts) and the clip dossier with its intent and screen views (dossier.ts).
 * Pure and deterministic: no clock, no randomness, no engine (a run is simulated by lib/insights/score.ts and handed in).
 */

// --- crew ---
export * from "./clip";
export * from "./hudFlags";
export * from "./simplicity";
export * from "./clarity";
export * from "./dossier";
// --- end crew ---
