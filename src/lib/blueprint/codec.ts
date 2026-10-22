/*
 * --- blueprint --- A Blueprint as text: the compact form (every default left out), canonical JSON (sorted keys: the same spec
 * is always the same bytes), the link code `b1.<base64url of the canonical JSON>`, a digest (FNV-1a) and the simulator link
 * that opens it (`?mode=blueprint&bls=<code>`, Mode Lab's link key; a catalog entry is `?mode=blueprint&blp=<id>`).
 *
 * The code is plain base64url, not deflated, so encoding and decoding are synchronous and need no CompressionStream: the
 * largest legal spec (BLUEPRINT_JSON_MAX_BYTES, 6,000 bytes) is about 8,000 characters, a link under 9,000 and, through the
 * site's own share code (lib/shareCode.ts, which deflates the whole link), far under SHARE_CODE_MAX_LENGTH.
 *
 * Decoding returns the raw JSON only: every caller hands it to sanitizeBlueprint() or validateBlueprint() (sanitize.ts).
 */
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/base64";
import { BLUEPRINT_JSON_MAX_BYTES } from "./limits";
import {
  ACTION_DEFAULTS,
  DEFAULT_PALETTE,
  DEFAULT_TEAM_NAMES,
  DEFAULT_VOICES,
  DEFAULTS,
  OBSTACLE_DEFAULTS,
  type Blueprint,
  type BlueprintAction,
  type BlueprintObstacle,
} from "./schema";
import { isRecord, utf8Bytes } from "./text";

/** The code's prefix: format 1 of the link code. */
export const BLUEPRINT_CODE_PREFIX = "b1.";
/** The longest code read (characters): the largest legal spec's, with room. */
export const BLUEPRINT_CODE_MAX_CHARS = Math.ceil((BLUEPRINT_JSON_MAX_BYTES * 4) / 3) + BLUEPRINT_CODE_PREFIX.length + 16;
/** Mode Lab's link keys (settings blSpec / blPreset, P4). */
export const BLUEPRINT_LINK_KEYS = { spec: "bls", preset: "blp" } as const;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** `value` without the fields equal to `defaults` (fields not in defaults are kept). */
function withoutDefaults(value: Record<string, unknown>, defaults: Record<string, unknown>, keep: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null || v === undefined) continue;
    if (!keep.includes(k) && Object.hasOwn(defaults, k) && same(v, defaults[k])) continue;
    out[k] = v;
  }
  return out;
}

const nonEmpty = (o: Record<string, unknown>) => (Object.keys(o).length ? o : undefined);

function compactAction(a: BlueprintAction): Record<string, unknown> {
  const { act, ...rest } = a;
  return { act, ...withoutDefaults(rest, ACTION_DEFAULTS[act] as Record<string, unknown>, act === "spawn" ? ["body"] : act === "var" ? ["id"] : []) };
}

function compactObstacle(o: BlueprintObstacle): Record<string, unknown> {
  const { kind, ...rest } = o;
  return { kind, ...withoutDefaults(rest, OBSTACLE_DEFAULTS[kind] as Record<string, unknown>) };
}

/**
 * The compact form of a resolved spec: what a link carries. Defaults are left out (`v`, `meta.name`, the bodies' and
 * variables' ids, every spawner's body, every rule's `when` and `do`, and `finish.timeoutSec` always stay); sanitizing the
 * compact form gives the resolved spec back.
 */
export function compactBlueprint(bp: Blueprint): Record<string, unknown> {
  const out: Record<string, unknown> = { v: bp.v };
  out.meta = withoutDefaults(bp.meta as unknown as Record<string, unknown>, DEFAULTS.meta, ["name"]);
  const { rings, exits, gravity, ...arenaRest } = bp.arena;
  const arena = withoutDefaults(arenaRest, DEFAULTS.arena);
  if (gravity.x !== 0 || gravity.y !== 0) arena.gravity = { x: gravity.x, y: gravity.y };
  if (exits.length) arena.exits = exits.map((e) => ({ ...e }));
  if (rings) arena.rings = withoutDefaults(rings as unknown as Record<string, unknown>, DEFAULTS.rings);
  if (nonEmpty(arena)) out.arena = arena;
  out.bodies = bp.bodies.map((b) => withoutDefaults(b as unknown as Record<string, unknown>, DEFAULTS.body, ["id"]));
  if (bp.tiles) out.tiles = withoutDefaults(bp.tiles as unknown as Record<string, unknown>, DEFAULTS.tiles as unknown as Record<string, unknown>);
  if (bp.obstacles.length) out.obstacles = bp.obstacles.map(compactObstacle);
  if (bp.vars.length) out.vars = bp.vars.map((v) => withoutDefaults(v as unknown as Record<string, unknown>, { start: 0 }, ["id"]));
  out.spawners = bp.spawners.map((s) => withoutDefaults(s as unknown as Record<string, unknown>, DEFAULTS.spawner, ["body"]));
  if (bp.rules.length)
    out.rules = bp.rules.map((r) => {
      const { do: actions, ...rest } = r;
      return { ...withoutDefaults(rest as unknown as Record<string, unknown>, DEFAULTS.rule, ["when"]), do: actions.map(compactAction) };
    });
  const finish = withoutDefaults({ winner: bp.finish.winner, timeoutSay: bp.finish.timeoutSay, timeoutSec: bp.finish.timeoutSec }, DEFAULTS.finish, ["timeoutSec"]);
  if (bp.finish.any.length) finish.any = bp.finish.any.map((c) => withoutDefaults(c as unknown as Record<string, unknown>, { what: "balls", say: "" }, ["when"]));
  out.finish = finish;
  if (bp.hud.length) out.hud = bp.hud.map((h) => withoutDefaults(h as unknown as Record<string, unknown>, { label: "" }, ["show"]));
  const look = withoutDefaults(bp.look as unknown as Record<string, unknown>, { ...DEFAULTS.look, palette: DEFAULT_PALETTE, teamNames: DEFAULT_TEAM_NAMES });
  if (nonEmpty(look)) out.look = look;
  const { voices, ...soundRest } = bp.sound;
  const sound = withoutDefaults(soundRest, DEFAULTS.sound);
  const ownVoices = withoutDefaults(voices, DEFAULT_VOICES);
  if (nonEmpty(ownVoices)) sound.voices = ownVoices;
  if (nonEmpty(sound)) out.sound = sound;
  return out;
}

/** JSON with every object's keys sorted (arrays keep their order): one spec, one text. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): Json => {
    if (Array.isArray(v)) return v.map(sort);
    if (isRecord(v)) {
      const out: { [key: string]: Json } = {};
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sort(v[k]);
      return out;
    }
    return v as Json;
  };
  return JSON.stringify(sort(value));
}

/** The canonical JSON of a resolved spec (its compact form, keys sorted). */
export function blueprintJson(bp: Blueprint): string {
  return canonicalJson(compactBlueprint(bp));
}

/** UTF-8 bytes of the spec's canonical JSON (what BLUEPRINT_JSON_MAX_BYTES bounds). */
export function blueprintBytes(bp: Blueprint): number {
  return utf8Bytes(blueprintJson(bp));
}

/** The link code of a resolved spec: `b1.` + base64url of its canonical JSON. */
export function encodeBlueprint(bp: Blueprint): string {
  return BLUEPRINT_CODE_PREFIX + bytesToBase64Url(new TextEncoder().encode(blueprintJson(bp)));
}

export type BlueprintDecodeResult = { ok: true; raw: unknown } | { ok: false; error: string };

/**
 * The raw JSON a code carries – a bare code, or a link / query string with `bls=<code>` – for sanitizeBlueprint(). Refuses a
 * code longer than BLUEPRINT_CODE_MAX_CHARS, another format than `b1.`, bad base64url, bad UTF-8 and bad JSON.
 */
export function decodeBlueprint(text: string): BlueprintDecodeResult {
  if (typeof text !== "string") return { ok: false, error: "not a text" };
  let code = text.trim();
  const at = code.search(/[?&]bls=/);
  if (at >= 0) code = code.slice(at + 5).split("&")[0];
  else if (code.startsWith("bls=")) code = code.slice(4).split("&")[0];
  try {
    code = decodeURIComponent(code);
  } catch {
    return { ok: false, error: "the code is not a valid link parameter" };
  }
  if (code.length > BLUEPRINT_CODE_MAX_CHARS) return { ok: false, error: `the code is longer than ${BLUEPRINT_CODE_MAX_CHARS} characters` };
  if (!code.startsWith(BLUEPRINT_CODE_PREFIX)) return { ok: false, error: `a Blueprint code starts with "${BLUEPRINT_CODE_PREFIX}" (a newer version of JumpingBallsLive may read other formats)` };
  const bytes = base64UrlToBytes(code.slice(BLUEPRINT_CODE_PREFIX.length));
  if (!bytes) return { ok: false, error: "the code is not base64url" };
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: "the code is not UTF-8 text" };
  }
  try {
    return { ok: true, raw: JSON.parse(json) as unknown };
  } catch (e) {
    return { ok: false, error: `the code is not JSON (${e instanceof Error ? e.message : String(e)})` };
  }
}

/** FNV-1a (32-bit) of the spec's canonical JSON as 8 hex digits: the same spec, the same digest, on every machine. */
export function blueprintDigest(bp: Blueprint): string {
  const bytes = new TextEncoder().encode(blueprintJson(bp));
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The simulator query that opens a spec (Mode Lab, the blueprint mode). */
export function blueprintQuery(bp: Blueprint): string {
  return `mode=blueprint&${BLUEPRINT_LINK_KEYS.spec}=${encodeBlueprint(bp)}`;
}

/** The simulator query that opens a catalog entry by its id. */
export function catalogQuery(id: string): string {
  return `mode=blueprint&${BLUEPRINT_LINK_KEYS.preset}=${encodeURIComponent(id)}`;
}

/** A site-relative simulator link (`/en/simulator/?…`). */
export function simulatorLink(query: string, locale = "en"): string {
  return `/${locale}/simulator/?${query}`;
}
