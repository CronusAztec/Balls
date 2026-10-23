/*
 * --- blueprint --- The agent toolbox's Blueprint entry for Node: scripts/agent/bundle.mjs bundles it on its own (loadBlueprintKit),
 * so the five bp-* tools load the Blueprint library (src/lib/blueprint/) and nothing of the engine, the settings or the
 * modes – and the tool core stays as small as it was. Pure: reading the committed guide and printing stay in scripts/agent/.
 */
import { decodeBlueprint, isBlueprintCatalogId, parseParamValues, BLUEPRINT_CATALOG, BLUEPRINT_CATALOG_IDS, BLUEPRINT_LINK_KEYS, liteToRaw } from "@/lib/blueprint";

export * from "@/lib/blueprint";
export { encodeShareCode, SHARE_CODE_MAX_LENGTH } from "@/lib/shareCode";

export type BlueprintInput =
  | {
      ok: true;
      raw: unknown;
      source: "spec" | "code" | "catalog" | "lite";
      /** The catalog id it names (a catalog call, or a link's `blp`), else "". */
      catalogId: string;
      /** --- review fix (blueprint) --- Slider values to play it with (a link's `blv`, or the call's `params`): [] for none. */
      params: (number | null)[];
      /** Where the slider values came from: the link's `blv`, the call's `params`, or null (none). */
      paramsFrom: "link" | "params" | null;
    }
  | { ok: false; error: string };

/** The Blueprint keys of a link or a query string (`bls`, `blp`, `blv`), or null when the text is a bare code. */
function linkKeys(text: string): { spec: string | null; preset: string | null; values: string | null } | null {
  const t = text.trim();
  const q = t.indexOf("?");
  const query = q >= 0 ? t.slice(q + 1) : /^[A-Za-z]\w*=/.test(t) ? t : null;
  if (query === null) return null;
  const params = new URLSearchParams(query.split("#")[0]);
  return { spec: params.get(BLUEPRINT_LINK_KEYS.spec), preset: params.get(BLUEPRINT_LINK_KEYS.preset), values: params.get("blv") };
}

const unknownCatalog = (id: unknown) => `Unknown catalog id "${String(id).slice(0, 40)}" (the catalog: ${BLUEPRINT_CATALOG_IDS.join(", ")})`;

/**
 * The raw spec a tool call names: its spec, its code (or a link holding one), a catalog id, or a Lite reply turned into a
 * spec. --- review fix (blueprint) --- A link is read the way Mode Lab reads it: its game (`bls`, or a catalog game by its
 * `blp`) and its slider values (`blv`, which Copy link always writes), so a tool judges the game the link plays; the call's
 * own `params` (the same comma-separated form) take the place of the link's. A link whose game cannot be read is refused –
 * the page would play a catalog game instead, never the one the link meant.
 */
export function blueprintInput(args: { spec?: unknown; code?: unknown; catalog?: unknown; lite?: unknown; params?: unknown }): BlueprintInput {
  const own = typeof args.params === "string" ? parseParamValues(args.params) : [];
  const done = (raw: unknown, source: "spec" | "code" | "catalog" | "lite", catalogId = "", linkValues: (number | null)[] = []): BlueprintInput => {
    const params = own.length ? own : linkValues;
    return { ok: true, raw, source, catalogId, params, paramsFrom: own.length ? "params" : linkValues.length ? "link" : null };
  };
  if (args.spec !== undefined) return done(args.spec, "spec");
  if (typeof args.code === "string") {
    const keys = linkKeys(args.code);
    const values = keys?.values ? parseParamValues(keys.values) : [];
    if (keys && keys.spec === null) {
      if (keys.preset === null) return { ok: false, error: "The link holds no Blueprint: Mode Lab's links carry bls=b1.… (a game) or blp=<catalog id> (a built-in game)" };
      if (!isBlueprintCatalogId(keys.preset)) return { ok: false, error: unknownCatalog(keys.preset) };
      return done(BLUEPRINT_CATALOG[keys.preset], "catalog", keys.preset, values);
    }
    const decoded = decodeBlueprint(keys ? (keys.spec ?? "") : args.code);
    return decoded.ok ? done(decoded.raw, "code", "", values) : { ok: false, error: `The code could not be read: ${decoded.error}` };
  }
  if (args.catalog !== undefined) {
    if (!isBlueprintCatalogId(args.catalog)) return { ok: false, error: unknownCatalog(args.catalog) };
    return done(BLUEPRINT_CATALOG[args.catalog], "catalog", args.catalog);
  }
  if (args.lite !== undefined) return done(liteToRaw(args.lite), "lite");
  return { ok: false, error: "Give exactly one of spec, code, catalog or lite" };
}
