/*
 * --- crew --- The AI studio crew's rules (lib/crew/): one AI in several roles reviews every clip, and these plain-code checks
 * come first and cost nothing: the clip as the crew reads it (clip.ts), the HUD flags (hudFlags.ts), the Simple score
 * (simplicity.ts), the clarity gates (clarity.ts) and the clip dossier with its intent and screen views (dossier.ts). Then the
 * roles as data (roles.ts: cards, schemas, checks), the evidence check (evidence.ts), the fix compiler (fixes.ts), the picker
 * (pick.ts), the research digest and brief (research.ts), the review record (review.ts) and the panel that runs them
 * (panel.ts) – model-agnostic: a model is a function the caller passes. The role eval (eval.ts) measures which roles earn
 * their cost on a corpus of clean and planted clips.
 * Pure and deterministic: no clock, no randomness, no engine (a run is simulated by lib/insights/score.ts and handed in).
 */

// --- crew ---
export * from "./clip";
export * from "./hudFlags";
export * from "./simplicity";
export * from "./clarity";
export * from "./dossier";
export * from "./roles";
export * from "./evidence";
export * from "./fixes";
export * from "./pick";
export * from "./research";
export * from "./review";
export * from "./panel";
export * from "./eval";
// --- end crew ---
