/*
 * --- blueprint --- Blueprints in words: describeBlueprint() says what a spec does in plain sentences (the Mode Lab panel,
 * the CLI, an AI's prompt), and blueprintVocabulary() is the whole language in at most 500 tokens, for a model's prompt.
 * The spec's own texts (name, description, result lines) are quoted as data, never as instructions – --- review fix
 * (blueprint) --- as JSON strings (`quote()`), so a text with a double quote in it cannot close its quotes and read as the
 * summary's own words.
 */
import { BLUEPRINT_LIMITS as L } from "./limits";
import { COUNT_REFS, DEFAULT_SAY, FINISH_KINDS, FORMULA_NAMES, TRIGGERS, WINNERS, WITH_RELATIONS, type Blueprint, type BlueprintAction, type BlueprintRule, type Num } from "./schema";

/** A spec's own text as a quoted JSON string: its quotes and backslashes escaped. */
const quote = (text: string) => JSON.stringify(text);
const num = (n: Num) => (typeof n === "number" ? String(Math.round(n * 1000) / 1000) : `(${n})`);
const plural = (n: Num, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

const WHEN: Record<BlueprintRule["when"], (r: BlueprintRule) => string> = {
  start: () => "at the start",
  timer: (r) => `every ${r.sec} s`,
  beat: () => "on every beat",
  bar: () => "on every bar",
  wallHit: (r) => `when ${r.of ?? "a ball"} hits a wall`,
  obstacleHit: (r) => `when ${r.of ?? "a ball"} hits an obstacle`,
  tileHit: (r) => `when ${r.of ?? "a ball"} hits a tile`,
  tileBroken: (r) => `when ${r.of ?? "a ball"} breaks a tile`,
  ballHit: (r) => `when ${r.of ?? "a ball"} touches ${r.with === "any" ? "another ball" : r.with === "same" ? "a ball of its kind" : r.with === "sameTier" ? "a ball of its tier" : r.with === "sameTeam" ? "a team-mate" : r.with === "otherTeam" ? "a ball of another team" : r.with}`,
  escape: (r) => `when ${r.of ?? "a ball"} escapes`,
  ringPass: (r) => `when ${r.of ?? "a ball"} passes a ring`,
  countReached: (r) => `when ${r.what} reaches ${r.atLeast !== null ? `${r.atLeast} or more` : `${r.atMost} or less`}`,
};

function target(t: string): string {
  return t === "other" ? "the other ball" : t === "all" ? "every ball" : "it";
}

function action(a: BlueprintAction): string {
  switch (a.act) {
    case "spawn":
      return `spawn ${plural(a.count, a.body)} ${a.at === "self" ? "at the ball" : a.at === "tile" ? "at the tile" : a.at === "random" ? "at random places" : a.at === "rim" ? "along the rim" : `at the ${a.at}`}`;
    case "split":
      return `split ${target(a.target)} into ${num(a.into)}`;
    case "merge":
      return "merge the two into one of the next tier";
    case "remove":
      return `remove ${target(a.target)}`;
    case "grow":
      return typeof a.by === "number" && a.by < 0 ? `shrink ${target(a.target)} by ${-a.by} px` : `grow ${target(a.target)} by ${num(a.by)} px`;
    case "speed":
      return `speed ${target(a.target)} × ${num(a.scale)}`;
    case "recolor":
      return `recolour ${target(a.target)} (${a.color})`;
    case "tier":
      return `tier ${target(a.target)} + ${num(a.by)}`;
    case "team":
      return `${target(a.target)} joins ${a.to === "self" ? "its team" : a.to === "other" ? "the other's team" : a.to === "next" ? "the next team" : `team ${a.to}`}`;
    case "damage":
      return `${num(a.amount)} damage to ${a.target === "tile" ? "the tile" : target(a.target)}`;
    case "var":
      return `${a.id} ${a.op === "add" ? "+" : a.op === "mul" ? "×" : "="} ${num(a.value)}`;
    case "impulse":
      return `push ${target(a.target)} ${a.dir} at ${num(a.amount)} px/s`;
    case "fx":
      return `a ${a.kind}`;
    case "sound":
      return `a ${a.voice} note`;
  }
}

/** What a spec does, in plain sentences (one per line). */
export function describeBlueprint(bp: Blueprint): string {
  const a = bp.arena;
  const lines: string[] = [];
  lines.push(`${quote(bp.meta.name)}${bp.meta.description ? `: ${quote(bp.meta.description)}` : ""}`);
  const gravity = a.gravity.x === 0 && a.gravity.y === 0 ? "no gravity" : `gravity ${a.gravity.x}, ${a.gravity.y} px/s²`;
  const shape =
    a.shape === "rings" && a.rings
      ? `${a.rings.count} spinning rings with ${a.rings.gapDeg}° gaps${a.rings.breakOnPass ? " that break when a ball gets through" : ""}${a.rings.rim ? ", inside a solid rim" : ""}`
      : a.shape === "box"
        ? "a box"
        : `a circle${a.exits.length ? ` with ${a.exits.length === 1 ? "an exit" : `${a.exits.length} exits`}${a.spinDegPerSec ? (a.exits.length === 1 ? " that turns" : " that turn") : ""}` : ""}`;
  lines.push(`Arena: ${shape}, ${gravity}, bounce ${a.restitution}.`);
  lines.push(`Bodies: ${bp.bodies.map((b) => `${b.id} (${b.radius} px${b.team ? `, team ${b.team}` : ""}${b.tier > 1 ? `, tier ${b.tier}` : ""}${b.hp ? `, ${b.hp} HP` : ""})`).join(", ")}.`);
  if (bp.tiles) {
    const t = bp.tiles;
    lines.push(`Tiles: ${t.rows} × ${t.cols} ${t.style} tiles in a ${t.layout}, ${t.hp} HP${t.hpStep ? ` (+${t.hpStep} a row)` : ""}${t.pierce ? ", a ball breaking one flies through" : ""}.`);
  }
  if (bp.obstacles.length) lines.push(`Obstacles: ${bp.obstacles.map((o) => o.kind).join(", ")}.`);
  lines.push(`Start: ${bp.spawners.map((s) => `${plural(s.count, s.body)} ${s.at === "random" ? "at random places" : s.at === "rim" ? "along the rim" : `at the ${s.at}`}${s.speed !== 0 ? ` at ${num(s.speed)} px/s` : ""}${s.everySec > 0 ? `, again every ${s.everySec} s (up to ${s.maxTotal})` : s.onBeat ? ", again on every beat" : ""}`).join("; ")}.`);
  for (const r of bp.rules) {
    const filters = [r.every > 1 ? `every ${r.every}th time` : "", r.chance < 1 ? `${Math.round(r.chance * 100)}% of the time` : "", r.cooldownSec > 0 ? `at most every ${r.cooldownSec} s` : "", r.maxFires > 0 ? `at most ${r.maxFires} times` : ""].filter(Boolean);
    lines.push(`Rule: ${WHEN[r.when](r)}${filters.length ? ` (${filters.join(", ")})` : ""}: ${r.do.map(action).join(", then ")}.`);
  }
  const ends = bp.finish.any.map((c) => {
    const say = quote(c.say || DEFAULT_SAY[c.when]);
    switch (c.when) {
      case "escaped":
        return `${plural(c.atLeast ?? 1, c.of ?? "ball")} escaped ${say}`;
      case "tilesCleared":
        return `every tile is broken ${say}`;
      case "ringsCleared":
        return `every ring is broken ${say}`;
      case "count":
        return `${c.what} reaches ${c.atLeast !== null ? `${c.atLeast}` : `${c.atMost} or less`} ${say}`;
      case "tier":
        return `a ball reaches tier ${c.atLeast} ${say}`;
      case "teamsLeft":
        return `${c.atMost ?? 1} team${c.atMost === 1 ? "" : "s"} or fewer are left ${say}`;
    }
  });
  lines.push(`Ends: ${ends.length ? `when ${ends.join(", or when ")}; ` : ""}after ${bp.finish.timeoutSec} s at the latest ${quote(bp.finish.timeoutSay)}${bp.finish.winner !== "none" ? `; the winner is ${bp.finish.winner}` : ""}.`);
  return lines.join("\n");
}

/** The language in a few lines (≤ 500 tokens): what a model needs to write a valid spec. */
export function blueprintVocabulary(): string {
  return [
    "Blueprint v1 (JSON). Bodies in px; obstacles in arena units -1..1; angles 0=top, clockwise.",
    `{v:1,meta:{name<=${L.nameChars},description,family:escape|rhythm|battle},`,
    "arena:{shape:circle|box|rings,size .5-.95,restitution,gravity:{x,y},spinDegPerSec,exits<=4:[{atDeg,widthDeg}],rings:{count,gapDeg,breakOnPass,rim}},",
    `bodies<=${L.bodies}:[{id,radius,color 0-5,gravityScale,hp,tier,team 0-5,collide:bounce|pass}],`,
    `tiles:{layout:grid|ring,rows,cols(<=${L.tiles}),hp,hpStep,pierce,style:glass|brick|neon},`,
    `obstacles<=8:[{kind:peg|bumper|pegGrid|pegRing|bar|spinner,x,y,...}],vars<=4:[{id,start}],`,
    "spawners<=6:[{body,at:center|top|random|rim,count 1-8,speed,dir,startSec,everySec,maxTotal}],",
    `rules<=${L.rules}:[{when,of,every,chance,cooldownSec,maxFires,do<=4:[{act,...}]}],`,
    "finish:{any<=3:[{when,...,say}],timeoutSec 5-180,winner},hud<=2:[{show,label}],look,sound}",
    `when: ${TRIGGERS.join(" ")}; ballHit with:body|${WITH_RELATIONS.join("|")}; timer sec; countReached what,atLeast|atMost`,
    "act (target self|other|all): spawn{body,count,at,speed,dir} split{into} merge remove grow{by} speed{scale} recolor{color} tier{by} team{to} damage{amount} var{id,op,value} impulse{dir,amount} fx{kind} sound{voice}",
    `finish when: ${FINISH_KINDS.join(" ")}; winner ${WINNERS.join("|")}; what: ${COUNT_REFS.join("|")}|var`,
    `Formulas (text) in count,speed,by,scale,amount,value: ${FORMULA_NAMES.join(" ")} vars; + - * / ^ min max clamp sin`,
    "say: {winner} {time} {balls} {var}",
  ].join("\n");
}

/** A rough token count (code-like text: about 3.2 characters a token, never fewer tokens than words). */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(words, Math.ceil(text.length / 3.2));
}
