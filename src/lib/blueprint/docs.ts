/*
 * --- blueprint --- docs/agents/BLUEPRINTS.md, generated: the language's reference from the very tables the sanitizer, the
 * runtime and the prompts read (schema.ts, limits.ts, lite.ts, the catalog), so the guide cannot drift from the code.
 * `npm run blueprints:docs` writes it; tests/blueprintDocs.test.ts fails while the file differs from renderBlueprintDocs().
 */
import { CHECK_CROWDED_STEPS, CHECK_HEAVY_STEP_COST, playabilityCheck, PLAYABLE_FIRST_MOTION_SEC, PLAYABLE_MIN_SEC, PLAYABLE_MIN_SOUNDS } from "./check";
import { blueprintDigest, blueprintJson, catalogQuery } from "./codec";
import { BLUEPRINT_CATALOG_IDS, catalogBlueprint } from "./catalog";
import { blueprintVocabulary, describeBlueprint } from "./describe";
import { BLUEPRINT_CEILINGS, BLUEPRINT_LIMITS as L, BLUEPRINT_MAX_SUBSTEPS } from "./limits";
import { LITE_AMOUNTS, LITE_BOUNCE, LITE_GRAVITY, LITE_HP, LITE_SIZES, LITE_SPEEDS, LITE_SPIN, LITE_TIMEOUTS } from "./lite";
import {
  ACTION_DEFAULTS,
  ACTION_DOCS,
  ACTIONS,
  COUNT_DOCS,
  COUNT_REFS,
  DEFAULT_SAY,
  FINISH_DOCS,
  FINISH_KINDS,
  FORMULA_NAME_DOCS,
  FORMULA_NAMES,
  OBSTACLE_DEFAULTS,
  OBSTACLE_KINDS,
  PARAM_SECTIONS,
  TRIGGER_DOCS,
  TRIGGERS,
  WINNER_DOCS,
  WINNERS,
} from "./schema";

export const BLUEPRINT_DOCS_FILE = "docs/agents/BLUEPRINTS.md";

const code = (s: string) => `\`${s}\``;
const row = (cells: string[]) => `| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
const table = (head: string[], rows: string[][]) => [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
const fields = (o: Record<string, unknown>) =>
  Object.entries(o)
    .map(([k, v]) => `${k} ${v === "" ? "(required)" : JSON.stringify(v)}`)
    .join(", ");

const CEILING_WHY: Record<keyof typeof BLUEPRINT_CEILINGS, string> = {
  balls: "balls alive at once; past it ARENA FULL",
  tiles: "tiles of the one tiles block (rows × columns)",
  obstacles: "obstacles after peg grids and rings expand",
  rules: "rules in one spec",
  timeoutSec: "the longest run, in seconds",
  specBytes: "UTF-8 bytes of the spec's canonical JSON",
  eventsPerStep: "world events one step queues for the rules",
  ruleFiringsPerStep: "rule firings one step runs",
  spawnsPerStep: "balls one step adds (the rest wait, in order)",
  soundsPerStep: "sounds one step plays",
  ballRadius: "a ball's radius in px (a body, a grow, a merge or a split stops there)",
  ballSpeed: "a ball's speed in px/s (a faster ball is taken out and counted)",
  subStepsPerStep: "sub-steps of one step (slow motion beyond)",
  pairTestsPerStep: "ball pairs one step tests for a contact (the rest of a sub-step's are skipped and counted)",
  pairVisitsPerStep: "pair-grid entries one step walks to find those pairs (the rest of a sub-step's are skipped and counted)",
  actionBallsPerStep: "balls the rules' actions change in one step (further actions are dropped and counted)",
};

/** The whole guide, as Markdown. */
export function renderBlueprintDocs(): string {
  const out: string[] = [];
  const p = (...lines: string[]) => out.push(...lines, "");
  p(
    "# Blueprints: new game modes as data",
    "",
    "<!-- Generated from src/lib/blueprint/ by `npm run blueprints:docs`. Do not edit by hand: tests/blueprintDocs.test.ts fails while this file differs from the code. -->",
  );
  p(
    "A Blueprint is a game mode written as a small JSON spec: an arena, up to four kinds of ball, tiles and obstacles, spawners,",
    "rules (when something happens, do something) and a finish. One sandboxed interpreter runs every spec, so a new mechanic never",
    "touches `src/lib/physics/engine.ts`, `src/components/simulator/Canvas.tsx` or `src/components/simulator/Simulator.tsx`.",
    "No code is generated or run: a spec is data, checked by one validator and bounded by fixed work ceilings, so a stranger's",
    "link cannot freeze a tab.",
  );
  p(
    "The language and its checks live in `src/lib/blueprint/` (pure data: no DOM, no engine). The site plays Blueprints in the",
    "`blueprint` mode, Mode Lab (`src/lib/physics/modes/blueprint.ts`): the interpreter (`src/lib/blueprint/runtime/`) is hosted",
    "by the engine, so live play, the fast export, the finder and the Windows app's queue all play a spec the same way. The",
    "playability check and the agent toolbox run the same engine headless (`src/lib/blueprint/headless.ts`).",
  );
  p(
    "## Write one in four steps",
    "",
    "1. Read the vocabulary below (or `npm run -s agent -- bp-schema` for the JSON Schema).",
    "2. Write the spec and check it: `npm run -s agent -- bp-validate --json '{\"spec\":{…}}'`. Every problem comes back as",
    "   `path: sentence` (`rules[3].do[0].body: unknown body \"x\" (the bodies: ball)`).",
    "3. Play it headless on four seeds: `npm run -s agent -- bp-check --json '{\"spec\":{…}}'`. Fix what the feedback says until",
    "   the verdict is `playable`.",
    "4. Get its link: `npm run -s agent -- bp-link --json '{\"spec\":{…}}'` (`?mode=blueprint&bls=b1.…`).",
  );
  p(
    "A link keeps three keys: `blp` (a catalog id below), `bls` (a spec's code, played instead of the catalog entry) and `blv`",
    "(the sliders' values, see Sliders). A code that cannot be read plays the catalog entry, with a note in Mode Lab's panel.",
  );
  p(
    "Every tool also takes `code` (a `b1.` code or a link holding one), `catalog` (an id below) or `lite` (the Lite form) instead",
    "of `spec`. A new built-in entry is a file in `src/lib/blueprint/catalog/` plus its id in `BLUEPRINT_CATALOG_IDS`; it must",
    "sanitize with no note and be `playable` (tests/blueprintCheck.test.ts), and the owner approves it.",
  );

  p("## Units", "", "- Bodies are in world px, like every mode: radius 8 px, speed 400 px/s, gravity 300 px/s². The world's shorter side is 450 px.", "- Obstacles and tile areas are in arena units: −1…1 from the centre, 1 = the rim. A layout keeps its shape at any arena size.", "- Angles are clock degrees: 0 = top, 90 = right, 180 = bottom, 270 = left.", "- Physics numbers (speeds, radii, gravity, bounciness, spin) take any finite value. Only the structure has ceilings.");

  p("## The vocabulary in one block", "", "This is the text a model's prompt gets (`blueprintVocabulary()`, at most 500 tokens):", "", "```text", blueprintVocabulary(), "```");

  p("## Triggers (`when`)", "", table(["Trigger", "Fires"], TRIGGERS.map((t) => [code(t), TRIGGER_DOCS[t]])));
  p(
    "A rule's filters: `of` (self's body), `with` (ballHit: a body id or `any`, `same`, `sameTier`, `sameTeam`, `otherTeam`),",
    "`every` (every n-th match), `chance` (0-1, a seeded draw), `cooldownSec`, `maxFires` (0: no limit). Rules run in list order.",
    "An event an action causes (a tile a `damage` breaks) waits for the next step, so rules never recurse.",
  );
  p("## Actions (`do`, up to 4 a rule)", "", table(["Action", "What it does", "Fields and defaults"], ACTIONS.map((a) => [code(a), ACTION_DOCS[a], fields(ACTION_DEFAULTS[a] as Record<string, unknown>)])));
  p("`target` is `self` (the event's ball), `other` (ballHit's second ball) or `all` (every ball of the rule's `of`). A rule with a trigger that has no ball (start, timer, beat, bar, countReached) acts on every ball.");
  p("## Finish (`finish.any`, up to 3, and `timeoutSec`)", "", table(["Condition", "Met when", "Default result line"], FINISH_KINDS.map((k) => [code(k), FINISH_DOCS[k], code(DEFAULT_SAY[k])])));
  p(
    "A condition ends the run only after it was once unmet. `timeoutSec` (5-180 s) is required: every run ends. The result line",
    "(`say`, `timeoutSay`) may hold `{winner}`, `{time}`, `{balls}`, `{escaped}`, `{tier}`, `{tiles}`, `{rings}` and variable ids.",
    "",
    table(["Winner", "Who"], WINNERS.map((w) => [code(w), WINNER_DOCS[w]])),
  );
  p("## Counts (`what`, `show`)", "", table(["Count", "Reads"], COUNT_REFS.map((c) => [code(c), COUNT_DOCS[c]])), "", "A variable's id (`vars`) is a count too.");
  p(
    "## Obstacles",
    "",
    table(
      ["Kind", "Fields and defaults"],
      OBSTACLE_KINDS.map((k) => [code(k), fields(OBSTACLE_DEFAULTS[k] as Record<string, unknown>)]),
    ),
  );
  p(
    "## Sliders (`params`, up to " + L.params + ")",
    "",
    "A spec may offer sliders, each `{ id, label, at, min, max, step }`: `at` is the path of one number of the resolved spec",
    "(for example `arena.rings.count`, `tiles.hp`, `spawners[0].speed`), in one of these sections:",
    `${PARAM_SECTIONS.map(code).join(", ")}.`,
    "Mode Lab shows one slider each, and a link carries their values as `blv`, comma-separated (an empty place keeps the spec's",
    "own value). A value past a slider's ends plays as typed: the spec is sanitized again, so only a structural ceiling or a",
    "design domain puts it back in range, exactly as in a spec written that way.",
  );
  p(
    "## Formulas",
    "",
    "A number slot (a spawner's `count` and `speed`, an action's `count`, `speed`, `into`, `by`, `scale`, `amount`, `value`) also",
    "takes a formula, as text of at most 200 characters, compiled by bounce math's own parser (never eval). Operators `+ - * / ^`,",
    "functions sin, cos, tan, abs, sqrt, floor, ceil, round, log, exp, pow, min, max, clamp, constants pi and e. The variables:",
    "",
    table(["Name", "Value"], FORMULA_NAMES.map((n) => [code(n), FORMULA_NAME_DOCS[n]])),
    "",
    "and the spec's own variable ids. A result that is not a finite number refuses the action (counted, never applied).",
  );
  p(
    "## Ceilings",
    "",
    "Fixed work and memory ceilings (`BLUEPRINT_CEILINGS` in `src/lib/uncap.ts`, the one deliberate exception to \"uncapped\"):",
    "",
    table(["Ceiling", "Value", "What it bounds"], (Object.keys(BLUEPRINT_CEILINGS) as (keyof typeof BLUEPRINT_CEILINGS)[]).map((k) => [code(k), String(BLUEPRINT_CEILINGS[k]), CEILING_WHY[k]])),
    "",
    `The shape of a spec (\`BLUEPRINT_LIMITS\` in \`src/lib/blueprint/limits.ts\`): ${L.bodies} bodies, ${L.exits} exits, ${L.obstaclePatterns} obstacle patterns, ${L.vars} variables, ${L.spawners} spawners, ${L.actionsPerRule} actions a rule, ${L.finishConditions} finish conditions, ${L.hud} HUD counters, ${L.palette} colours, ${L.teams} teams, ${L.rings} rings, ${L.perSpawn} balls a spawn, names of ${L.nameChars} and descriptions of ${L.descriptionChars} characters. A step has 4 to ${BLUEPRINT_MAX_SUBSTEPS} sub-steps: the engine plans enough that no ball moves more than half its radius in one, and past ${BLUEPRINT_MAX_SUBSTEPS} the run plays in slow motion instead.`,
  );
  p(
    "## The playability check",
    "",
    "`bp-check` plays the spec in the engine on seeds 1-4, exactly as the page plays it, and judges it on deterministic counts",
    "only (never wall time, so every machine agrees). Mode Lab's Check playability button runs the same check:",
    "",
    `- **playable:** at least 3 of 4 seeds end by a finish condition; the median end is between ${PLAYABLE_MIN_SEC} s and the timeout; no seed has a fault, a ball gone NaN or past the speed ceiling, dropped events, firings, pair tests or actions, or ARENA FULL; the median seed plays at least ${PLAYABLE_MIN_SOUNDS} sounds; something moves within ${PLAYABLE_FIRST_MOTION_SEC} s;`,
    "- **endless:** every seed runs into the timeout;",
    "- **broken:** anything else. The feedback says what to change, in plain sentences.",
    "",
    `A seed a browser tab could not play is stopped early and broken, on counts alone: **heavy** when a second of steps costs more than ${CHECK_HEAVY_STEP_COST} work units a step on average (ball sub-steps, contact and pair tests, rule firings and the balls their actions change), **slow** when five seconds of steps move the run's clock less than half that (slow motion: balls too fast for their size), **crowded** when ${CHECK_CROWDED_STEPS} of a second's 60 steps skip ball pairs past the pair budgets (balls that overlap so much that the sandbox only bounds them).`,
  );
  p(
    "## The Lite form (small local models)",
    "",
    "Only enums and level words, no free numbers or ids: a 1.5B model's grammar holds it to valid values. `liteSchema()` is its",
    "JSON Schema; `liteToBlueprint()` maps it onto a full spec, which goes through the same sanitizer. At most 3 bodies (a, b, c),",
    "3 starts, 6 rules of one action each, one tiles block, one pegs block and 2 HUD counters.",
    "",
    table(
      ["Word", "Means"],
      [
        ["size", Object.entries(LITE_SIZES).map(([k, v]) => `${k} ${v} px`).join(", ")],
        ["speed", Object.entries(LITE_SPEEDS).map(([k, v]) => `${k} ${v} px/s`).join(", ")],
        ["gravity", Object.entries(LITE_GRAVITY).map(([k, v]) => `${k} ${v}`).join(", ")],
        ["bounce", Object.entries(LITE_BOUNCE).map(([k, v]) => `${k} ${v}`).join(", ")],
        ["spin", Object.entries(LITE_SPIN).map(([k, v]) => `${k} ${v}°/s`).join(", ")],
        ["amount", Object.entries(LITE_AMOUNTS).map(([k, v]) => `${k} ${v}`).join(", ")],
        ["hp", Object.entries(LITE_HP).map(([k, v]) => `${k} ${v}`).join(", ")],
        ["timeout", Object.entries(LITE_TIMEOUTS).map(([k, v]) => `${k} ${v} s`).join(", ")],
      ],
    ),
  );
  p("## The catalog", "", "The built-in Blueprints, each `playable`. Their specs are the best examples of the language.");
  for (const id of BLUEPRINT_CATALOG_IDS) {
    const bp = catalogBlueprint(id);
    const report = playabilityCheck(bp);
    const outcomes = [...new Set(report.seeds.map((s) => s.result))].map((r) => `"${r}"`).join(", ");
    p(
      `### ${bp.meta.name} (\`${id}\`)`,
      "",
      `${bp.meta.description}`,
      "",
      `Link: \`?${catalogQuery(id)}\` · digest \`${blueprintDigest(bp)}\` · check: ${report.verdict}, median end ${report.medianFinishSec} s, outcomes ${outcomes}.`,
      "",
      "```text",
      describeBlueprint(bp),
      "```",
      "",
      "```json",
      JSON.stringify(JSON.parse(blueprintJson(bp)), null, 1),
      "```",
    );
  }
  return `${out.join("\n").trimEnd()}\n`;
}
