/*
 * --- blueprint --- The built-in Blueprints: catalog entries in the compact form a link carries (every one sanitizes with no
 * note and is 'playable' on the check's seeds – tests/blueprintCheck.test.ts). Mode Lab (P4) offers them by id
 * (`?mode=blueprint&blp=<id>`); new ones arrive as data, approved by the owner.
 */
import { sanitizeBlueprint } from "../sanitize";
import type { Blueprint } from "../schema";
import { conquer } from "./conquer";
import { growEscape } from "./growEscape";
import { hatchery } from "./hatchery";
import { plinkoRace } from "./plinkoRace";
import { ringBreaker } from "./ringBreaker";
import { tierClimb } from "./tierClimb";

/** The catalog's ids, in the order Mode Lab lists them. */
export const BLUEPRINT_CATALOG_IDS = ["hatchery", "ringBreaker", "conquer", "tierClimb", "plinkoRace", "growEscape"] as const;
export type BlueprintCatalogId = (typeof BLUEPRINT_CATALOG_IDS)[number];

/** Each entry's spec, as written (the compact form). */
export const BLUEPRINT_CATALOG: Readonly<Record<BlueprintCatalogId, unknown>> = { hatchery, ringBreaker, conquer, tierClimb, plinkoRace, growEscape };

export function isBlueprintCatalogId(value: unknown): value is BlueprintCatalogId {
  return typeof value === "string" && (BLUEPRINT_CATALOG_IDS as readonly string[]).includes(value);
}

/** A catalog entry resolved (sanitizeBlueprint of its spec). */
export function catalogBlueprint(id: BlueprintCatalogId): Blueprint {
  return sanitizeBlueprint(BLUEPRINT_CATALOG[id]).blueprint;
}
