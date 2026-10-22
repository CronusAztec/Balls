/*
 * --- blueprint --- The agent toolbox's Blueprint entry for Node: scripts/agent/bundle.mjs bundles it on its own (loadBlueprintKit),
 * so the five bp-* tools load the Blueprint library (src/lib/blueprint/) and nothing of the engine, the settings or the
 * modes – and the tool core stays as small as it was. Pure: reading the committed guide and printing stay in scripts/agent/.
 */
import { decodeBlueprint, isBlueprintCatalogId, BLUEPRINT_CATALOG, BLUEPRINT_CATALOG_IDS, liteToRaw } from "@/lib/blueprint";

export * from "@/lib/blueprint";
export { encodeShareCode, SHARE_CODE_MAX_LENGTH } from "@/lib/shareCode";

export type BlueprintInput = { ok: true; raw: unknown; source: "spec" | "code" | "catalog" | "lite" } | { ok: false; error: string };

/** The raw spec a tool call names: its spec, its code (or a link holding one), a catalog id, or a Lite reply turned into a spec. */
export function blueprintInput(args: { spec?: unknown; code?: unknown; catalog?: unknown; lite?: unknown }): BlueprintInput {
  if (args.spec !== undefined) return { ok: true, raw: args.spec, source: "spec" };
  if (typeof args.code === "string") {
    const decoded = decodeBlueprint(args.code);
    return decoded.ok ? { ok: true, raw: decoded.raw, source: "code" } : { ok: false, error: `The code could not be read: ${decoded.error}` };
  }
  if (args.catalog !== undefined) {
    if (!isBlueprintCatalogId(args.catalog)) return { ok: false, error: `Unknown catalog id "${String(args.catalog)}" (the catalog: ${BLUEPRINT_CATALOG_IDS.join(", ")})` };
    return { ok: true, raw: BLUEPRINT_CATALOG[args.catalog], source: "catalog" };
  }
  if (args.lite !== undefined) return { ok: true, raw: liteToRaw(args.lite), source: "lite" };
  return { ok: false, error: "Give exactly one of spec, code, catalog or lite" };
}
