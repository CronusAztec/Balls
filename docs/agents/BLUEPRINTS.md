# Blueprints: new game modes as data

<!-- Generated from src/lib/blueprint/ by `npm run blueprints:docs`. Do not edit by hand: tests/blueprintDocs.test.ts fails while this file differs from the code. -->

A Blueprint is a game mode written as a small JSON spec: an arena, up to four kinds of ball, tiles and obstacles, spawners,
rules (when something happens, do something) and a finish. One sandboxed interpreter runs every spec, so a new mechanic never
touches `src/lib/physics/engine.ts`, `src/components/simulator/Canvas.tsx` or `src/components/simulator/Simulator.tsx`.
No code is generated or run: a spec is data, checked by one validator and bounded by fixed work ceilings, so a stranger's
link cannot freeze a tab.

The language and its checks live in `src/lib/blueprint/` (pure data: no DOM, no engine). The site plays Blueprints in the
`blueprint` mode, Mode Lab (`src/lib/physics/modes/blueprint.ts`): the interpreter (`src/lib/blueprint/runtime/`) is hosted
by the engine, so live play, the fast export, the finder and the Windows app's queue all play a spec the same way. The
playability check and the agent toolbox run the same engine headless (`src/lib/blueprint/headless.ts`).

## Write one in four steps

1. Read the vocabulary below (or `npm run -s agent -- bp-schema` for the JSON Schema).
2. Write the spec and check it: `npm run -s agent -- bp-validate --json '{"spec":{…}}'`. Every problem comes back as
   `path: sentence` (`rules[3].do[0].body: unknown body "x" (the bodies: ball)`).
3. Play it headless on four seeds: `npm run -s agent -- bp-check --json '{"spec":{…}}'`. Fix what the feedback says until
   the verdict is `playable`.
4. Get its link: `npm run -s agent -- bp-link --json '{"spec":{…}}'` (`?mode=blueprint&bls=b1.…`).

A link keeps three keys: `blp` (a catalog id below), `bls` (a spec's code, played instead of the catalog entry) and `blv`
(the sliders' values, see Sliders). A code that cannot be read plays the catalog entry, with a note in Mode Lab's panel.

Every tool also takes `code` (a `b1.` code or a link holding one), `catalog` (an id below) or `lite` (the Lite form) instead
of `spec`. A new built-in entry is a file in `src/lib/blueprint/catalog/` plus its id in `BLUEPRINT_CATALOG_IDS`; it must
sanitize with no note and be `playable` (tests/blueprintCheck.test.ts), and the owner approves it.

## Units

- Bodies are in world px, like every mode: radius 8 px, speed 400 px/s, gravity 300 px/s². The world's shorter side is 450 px.
- Obstacles and tile areas are in arena units: −1…1 from the centre, 1 = the rim. A layout keeps its shape at any arena size.
- Angles are clock degrees: 0 = top, 90 = right, 180 = bottom, 270 = left.
- Physics numbers (speeds, radii, gravity, bounciness, spin) take any finite value. Only the structure has ceilings.

## The vocabulary in one block

This is the text a model's prompt gets (`blueprintVocabulary()`, at most 500 tokens):

```text
Blueprint v1 (JSON). Bodies in px; obstacles in arena units -1..1; angles 0=top, clockwise.
{v:1,meta:{name<=28,description,family:escape|rhythm|battle},
arena:{shape:circle|box|rings,size .5-.95,restitution,gravity:{x,y},spinDegPerSec,exits<=4:[{atDeg,widthDeg}],rings:{count,gapDeg,breakOnPass,rim}},
bodies<=4:[{id,radius,color 0-5,gravityScale,hp,tier,team 0-5,collide:bounce|pass}],
tiles:{layout:grid|ring,rows,cols(<=600),hp,hpStep,pierce,style:glass|brick|neon},
obstacles<=8:[{kind:peg|bumper|pegGrid|pegRing|bar|spinner,x,y,...}],vars<=4:[{id,start}],
spawners<=6:[{body,at:center|top|random|rim,count 1-8,speed,dir,startSec,everySec,maxTotal}],
rules<=16:[{when,of,every,chance,cooldownSec,maxFires,do<=4:[{act,...}]}],
finish:{any<=3:[{when,...,say}],timeoutSec 5-180,winner},hud<=2:[{show,label}],look,sound}
when: start timer beat bar wallHit obstacleHit tileHit tileBroken ballHit escape ringPass countReached; ballHit with:body|any|same|sameTier|sameTeam|otherTeam; timer sec; countReached what,atLeast|atMost
act (target self|other|all): spawn{body,count,at,speed,dir} split{into} merge remove grow{by} speed{scale} recolor{color} tier{by} team{to} damage{amount} var{id,op,value} impulse{dir,amount} fx{kind} sound{voice}
finish when: escaped tilesCleared ringsCleared count tier teamsLeft; winner none|firstOut|lastOut|mostBalls|highestTier|lastBall; what: balls|tiles|rings|escaped|teams|tier|time|var
Formulas (text) in count,speed,by,scale,amount,value: n t b r balls tiles escaped tier size speed vars; + - * / ^ min max clamp sin
say: {winner} {time} {balls} {var}
```

## Triggers (`when`)

| Trigger | Fires |
| --- | --- |
| `start` | once, when the run starts (after the first balls appear) |
| `timer` | every `sec` seconds |
| `beat` | on every beat of `sound.bpm` |
| `bar` | on every fourth beat |
| `wallHit` | a ball (self) bounces off the rim, a box wall or a ring |
| `obstacleHit` | a ball (self) hits a peg, bumper, bar or spinner |
| `tileHit` | a ball (self) hits a tile (every hit chips 1 HP off it) |
| `tileBroken` | a ball (self) breaks a tile (the `tile` spawn point is where it was) |
| `ballHit` | two balls start to touch (once a contact): self is the one that was faster before (or the one `of` names), other the second |
| `escape` | a ball (self) leaves the arena through an exit or past the last ring |
| `ringPass` | a ball (self) passes outward through a ring's gap |
| `countReached` | a count (`what`) crosses `atLeast` or `atMost` (fires again only after it goes back) |

A rule's filters: `of` (self's body), `with` (ballHit: a body id or `any`, `same`, `sameTier`, `sameTeam`, `otherTeam`),
`every` (every n-th match), `chance` (0-1, a seeded draw), `cooldownSec`, `maxFires` (0: no limit). Rules run in list order.
An event an action causes (a tile a `damage` breaks) waits for the next step, so rules never recurse. Every event runs its
rules even when an earlier rule removed its ball that step (actions on that ball are refused; a spawn `at` `tile` still lands
at the tile); only a ballHit whose ball is gone by then is skipped. A contact raises one ballHit, as it starts: balls resting
on each other or passing through each other raise no more, until they part or a rule changes either one's tier or team.

## Actions (`do`, up to 4 a rule)

| Action | What it does | Fields and defaults |
| --- | --- | --- |
| `spawn` | new balls: body, count (f), at self\|tile\|center\|top\|bottom\|left\|right\|random\|rim, speed (f, px/s), dir | body (required), count 1, at "self", speed 250, dir "random" |
| `split` | the ball becomes `into` (f, 2-8) balls fanned out, each radius × `scale` | target "self", into 2, scale 1 |
| `merge` | other merges into self: tier + 1, radius = max × `scale` (default: areas add up) | scale 0 |
| `remove` | the ball disappears (no escape) | target "self" |
| `grow` | radius + `by` px (f; negative shrinks; below 1 px the ball pops) | target "self", by 2 |
| `speed` | velocity × `scale` (f) | target "self", scale 1.1 |
| `recolor` | colour = palette index, or next\|random\|team\|tier | target "self", color "next" |
| `tier` | tier + `by` (f) | target "self", by 1 |
| `team` | team = 0-5, or self\|other\|next | target "self", to "next" |
| `damage` | `amount` (f) HP off the event's tile (target tile) or off a ball with HP (a ball at 0 HP pops) | target "tile", amount 1 |
| `var` | variable `id` add\|set\|mul `value` (f) | id (required), op "add", value 1 |
| `impulse` | push `amount` px/s (f) towards dir (or away from the other ball) | target "self", dir "out", amount 200 |
| `fx` | a visual effect: burst\|flash\|shake\|confetti\|slowmo | kind "burst" |
| `sound` | a note: voice hit\|gap\|merge\|split, `pitch` scale steps up | voice "hit", pitch 0 |

`target` is `self` (the event's ball), `other` (ballHit's second ball) or `all` (every ball of the rule's `of`). A rule with a trigger that has no ball (start, timer, beat, bar, countReached) acts on every ball.

## Finish (`finish.any`, up to 3, and `timeoutSec`)

| Condition | Met when | Default result line |
| --- | --- | --- |
| `escaped` | `atLeast` balls (of `of`) escaped (default 1) | `ESCAPED` |
| `tilesCleared` | every tile is broken | `CLEARED` |
| `ringsCleared` | every ring is broken | `ALL RINGS DOWN` |
| `count` | a count (`what`, `of`) reaches `atLeast` or `atMost` | `DONE` |
| `tier` | a ball reaches tier `atLeast` | `TIER {tier}` |
| `teamsLeft` | at most `atMost` teams have balls left (default 1) | `{winner} WINS` |

A condition ends the run only after it was once unmet. `timeoutSec` (5-180 s) is required: every run ends. The result line
(`say`, `timeoutSay`) may hold `{winner}`, `{time}`, `{balls}`, `{escaped}`, `{tier}`, `{tiles}`, `{rings}` and variable ids.

| Winner | Who |
| --- | --- |
| `none` | no winner |
| `firstOut` | the team of the first ball out |
| `lastOut` | the team of the last ball out |
| `mostBalls` | the team with the most balls left |
| `highestTier` | the team of the highest-tier ball |
| `lastBall` | the team of the last ball left |

## Counts (`what`, `show`)

| Count | Reads |
| --- | --- |
| `balls` | balls in the arena (of `of`, when given) |
| `tiles` | tiles left |
| `rings` | rings left |
| `escaped` | balls that escaped (of `of`, when given) |
| `teams` | teams with a ball in the arena |
| `tier` | the highest tier of a ball in the arena |
| `time` | seconds of the run |

A variable's id (`vars`) is a count too.

## Obstacles

| Kind | Fields and defaults |
| --- | --- |
| `peg` | x 0, y 0, r 0.04 |
| `bumper` | x 0, y 0, r 0.06, kick 150 |
| `pegGrid` | x 0, y 0, w 1.2, h 0.8, rows 4, cols 5, r 0.03, stagger true |
| `pegRing` | x 0, y 0, radius 0.5, count 8, r 0.04 |
| `bar` | x 0, y 0, len 0.4, angleDeg 0, thick 0.03 |
| `spinner` | x 0, y 0, len 0.5, angleDeg 0, spinDegPerSec 90, thick 0.03 |

## Sliders (`params`, up to 4)

A spec may offer sliders, each `{ id, label, at, min, max, step }`: `at` is the path of one number of the resolved spec
(for example `arena.rings.count`, `tiles.hp`, `spawners[0].speed`), in one of these sections:
`arena`, `bodies`, `tiles`, `obstacles`, `vars`, `spawners`, `rules`, `finish`, `look`, `sound`.
Mode Lab shows one slider each, and a link carries their values as `blv`, comma-separated (an empty place keeps the spec's
own value). A value past a slider's ends plays as typed: the spec is sanitized again, so only a structural ceiling or a
design domain puts it back in range, exactly as in a spec written that way.

## Formulas

A number slot (a spawner's `count` and `speed`, an action's `count`, `speed`, `into`, `by`, `scale`, `amount`, `value`) also
takes a formula, as text of at most 200 characters, compiled by bounce math's own parser (never eval). Operators `+ - * / ^`,
functions sin, cos, tan, abs, sqrt, floor, ceil, round, log, exp, pow, min, max, clamp, constants pi and e. The variables:

| Name | Value |
| --- | --- |
| `n` | how many times this rule or spawner has fired (1 the first time) |
| `t` | seconds of the run |
| `b` | beats so far |
| `r` | a seeded random number in [0, 1) |
| `balls` | balls in the arena |
| `tiles` | tiles left |
| `escaped` | balls escaped |
| `tier` | self's tier (0 without a ball) |
| `size` | self's radius in px |
| `speed` | self's speed in px/s |

and the spec's own variable ids. A result that is not a finite number refuses the action (counted, never applied).

## Ceilings

Fixed work and memory ceilings (`BLUEPRINT_CEILINGS` in `src/lib/uncap.ts`, the one deliberate exception to "uncapped"):

| Ceiling | Value | What it bounds |
| --- | --- | --- |
| `balls` | 400 | balls alive at once; past it ARENA FULL |
| `tiles` | 600 | tiles of the one tiles block (rows × columns) |
| `obstacles` | 48 | obstacles after peg grids and rings expand |
| `rules` | 16 | rules in one spec |
| `timeoutSec` | 180 | the longest run, in seconds |
| `specBytes` | 6000 | UTF-8 bytes of the spec's canonical JSON |
| `eventsPerStep` | 512 | world events one step queues for the rules |
| `ruleFiringsPerStep` | 64 | rule firings one step runs |
| `spawnsPerStep` | 8 | balls one step adds (the rest wait, in order) |
| `soundsPerStep` | 6 | sounds one step plays |
| `ballRadius` | 225 | a ball's radius in px (a body, a grow, a merge or a split stops there) |
| `ballSpeed` | 100000 | a ball's speed in px/s (a faster ball is taken out and counted) |
| `subStepsPerStep` | 16 | sub-steps of one step (slow motion beyond) |
| `pairTestsPerStep` | 64000 | ball pairs one step tests for a contact (the rest of a sub-step's are skipped and counted) |
| `pairVisitsPerStep` | 160000 | pair-grid entries one step walks to find those pairs (the rest of a sub-step's are skipped and counted) |
| `tileTestsPerStep` | 40000 | tiles one step's sweeps look at and test, and tile-grid cells they visit (past it a ball's tile sweep is skipped and counted) |
| `actionBallsPerStep` | 4096 | balls the rules' actions change in one step (further actions are dropped and counted) |

The shape of a spec (`BLUEPRINT_LIMITS` in `src/lib/blueprint/limits.ts`): 4 bodies, 4 exits, 8 obstacle patterns, 4 variables, 6 spawners, 4 actions a rule, 3 finish conditions, 2 HUD counters, 6 colours, 6 teams, 8 rings, 8 balls a spawn, names of 28 and descriptions of 160 characters. A step has 4 to 16 sub-steps: the engine plans enough that no ball moves more than half its radius in one, and past 16 the run plays in slow motion instead.

## The playability check

`bp-check` plays the spec in the engine on seeds 1-4, exactly as the page plays it, and judges it on deterministic counts
only (never wall time, so every machine agrees). Mode Lab's Check playability button runs the same check:

- **playable:** at least 3 of 4 seeds end by a finish condition; the median end is between 6 s and the timeout; no seed has a fault (a rule's or a crash the sandbox caught), a ball gone NaN or past the speed ceiling, dropped events, firings, pair tests, tile sweeps or actions, or ARENA FULL; the median seed plays at least 5 sounds; something moves within 1 s;
- **endless:** every seed runs into the timeout;
- **broken:** anything else. The feedback says what to change, in plain sentences.

A seed a browser tab could not play is stopped early and broken, on counts alone: **heavy** when a second of steps costs more than 60000 work units a step on average (ball sub-steps, contact and pair tests, tile work, rule firings and the balls their actions change), **slow** when five seconds of steps move the run's clock less than half that (slow motion: balls too fast for their size), **crowded** when 30 of a second's 60 steps skip ball pairs past the pair budgets or tile sweeps past the tile budget (balls that overlap so much, or cover so many tiles, that the sandbox only bounds them).

## The Lite form (small local models)

Only enums and level words, no free numbers or ids: a 1.5B model's grammar holds it to valid values. `liteSchema()` is its
JSON Schema; `liteToBlueprint()` maps it onto a full spec, which goes through the same sanitizer. At most 3 bodies (a, b, c),
3 starts, 6 rules of one action each, one tiles block, one pegs block and 2 HUD counters.

| Word | Means |
| --- | --- |
| size | tiny 5 px, small 8 px, medium 12 px, large 18 px, huge 26 px |
| speed | still 0 px/s, slow 150 px/s, normal 300 px/s, fast 500 px/s, wild 800 px/s |
| gravity | none 0, low 150, normal 350, high 700, reverse -350 |
| bounce | soft 0.6, normal 0.9, bouncy 1 |
| spin | none 0°/s, slow 25°/s, fast 70°/s |
| amount | one 1, few 3, some 6, many 12 |
| hp | low 1, medium 3, high 6 |
| timeout | short 30 s, medium 60 s, long 90 s |

## The catalog

The built-in Blueprints, each `playable`. Their specs are the best examples of the language.

### Glass Hatchery (`hatchery`)

Every glass tile a ball breaks hatches a new ball. One ball becomes a swarm before the shell is gone.

Link: `?mode=blueprint&blp=hatchery` · digest `1fcd12b7` · check: playable, median end 17.18 s, outcomes "SHELL CLEARED".

```text
"Glass Hatchery": "Every glass tile a ball breaks hatches a new ball. One ball becomes a swarm before the shell is gone."
Arena: a circle, no gravity, bounce 1.
Bodies: ball (8 px).
Tiles: 6 × 20 glass tiles in a ring, 2 HP (+3 a row).
Start: 1 ball at the center at 240 px/s.
Rule: when a ball breaks a tile: spawn 1 ball at the tile, then recolour it (random).
Ends: when every tile is broken "SHELL CLEARED"; after 60 s at the latest "STILL IN THE SHELL".
```

```json
{
 "arena": {
  "size": 0.92
 },
 "bodies": [
  {
   "color": 1,
   "id": "ball",
   "radius": 8
  }
 ],
 "finish": {
  "any": [
   {
    "say": "SHELL CLEARED",
    "when": "tilesCleared"
   }
  ],
  "timeoutSay": "STILL IN THE SHELL",
  "timeoutSec": 60
 },
 "hud": [
  {
   "label": "tiles",
   "show": "tiles"
  },
  {
   "label": "balls",
   "show": "balls"
  }
 ],
 "look": {
  "rim": 5,
  "trail": true
 },
 "meta": {
  "author": "builtin",
  "description": "Every glass tile a ball breaks hatches a new ball. One ball becomes a swarm before the shell is gone.",
  "name": "Glass Hatchery"
 },
 "params": [
  {
   "at": "tiles.rows",
   "id": "layers",
   "label": "layers",
   "max": 10,
   "min": 2
  },
  {
   "at": "tiles.hp",
   "id": "glass",
   "label": "glass strength",
   "max": 6,
   "min": 1
  },
  {
   "at": "spawners[0].speed",
   "id": "speed",
   "label": "ball speed",
   "max": 600,
   "min": 100,
   "step": 10
  }
 ],
 "rules": [
  {
   "do": [
    {
     "act": "spawn",
     "at": "tile",
     "body": "ball",
     "speed": 150
    },
    {
     "act": "recolor",
     "color": "random"
    }
   ],
   "when": "tileBroken"
  }
 ],
 "sound": {
  "root": 2,
  "scale": "pentatonic",
  "voices": {
   "ballHit": "none",
   "wallHit": "none"
  }
 },
 "spawners": [
  {
   "body": "ball",
   "speed": 240
  }
 ],
 "tiles": {
  "cols": 20,
  "hp": 2,
  "hpStep": 3,
  "inner": 0.3,
  "layout": "ring",
  "outer": 0.88,
  "pitchBy": "col",
  "rows": 6
 },
 "v": 1
}
```

### Ring Breaker (`ringBreaker`)

Every ring a ball gets through shatters and doubles every ball. Break every ring.

Link: `?mode=blueprint&blp=ringBreaker` · digest `b5dfc3d7` · check: playable, median end 7.85 s, outcomes "ALL RINGS DOWN".

```text
"Ring Breaker": "Every ring a ball gets through shatters and doubles every ball. Break every ring."
Arena: 8 spinning rings with 28° gaps that break when a ball gets through, inside a solid rim, no gravity, bounce 1.
Bodies: ball (7 px).
Start: 1 ball at the center at (260 + 80 * r) px/s.
Rule: at the start: push every ball right at (15 + 25 * r) px/s.
Rule: when a ball passes a ring: split every ball into 2, then recolour it (next), then a burst.
Ends: when every ring is broken "ALL RINGS DOWN"; after 60 s at the latest "{rings} RINGS LEFT".
```

```json
{
 "arena": {
  "rings": {
   "count": 8,
   "gapDeg": 28,
   "inner": 0.2,
   "rim": true
  },
  "shape": "rings",
  "size": 0.92
 },
 "bodies": [
  {
   "color": 5,
   "id": "ball",
   "radius": 7
  }
 ],
 "finish": {
  "any": [
   {
    "say": "ALL RINGS DOWN",
    "when": "ringsCleared"
   }
  ],
  "timeoutSay": "{rings} RINGS LEFT",
  "timeoutSec": 60
 },
 "hud": [
  {
   "label": "rings",
   "show": "rings"
  },
  {
   "label": "balls",
   "show": "balls"
  }
 ],
 "look": {
  "rim": 5,
  "trail": true
 },
 "meta": {
  "author": "builtin",
  "description": "Every ring a ball gets through shatters and doubles every ball. Break every ring.",
  "name": "Ring Breaker"
 },
 "params": [
  {
   "at": "arena.rings.count",
   "id": "rings",
   "label": "rings",
   "max": 8,
   "min": 3
  },
  {
   "at": "arena.rings.gapDeg",
   "id": "gap",
   "label": "gap",
   "max": 60,
   "min": 15
  },
  {
   "at": "arena.rings.spinDegPerSec",
   "id": "spin",
   "label": "ring spin",
   "max": 120,
   "min": 0,
   "step": 5
  }
 ],
 "rules": [
  {
   "do": [
    {
     "act": "impulse",
     "amount": "15 + 25 * r",
     "dir": "right",
     "target": "all"
    }
   ],
   "when": "start"
  },
  {
   "do": [
    {
     "act": "split",
     "target": "all"
    },
    {
     "act": "recolor"
    },
    {
     "act": "fx"
    }
   ],
   "when": "ringPass"
  }
 ],
 "sound": {
  "root": 4,
  "scale": "minor"
 },
 "spawners": [
  {
   "body": "ball",
   "dir": "up",
   "speed": "260 + 80 * r"
  }
 ],
 "v": 1
}
```

### Colour Conquest (`conquer`)

Four colours collide: the faster ball converts the slower one. The last colour standing wins.

Link: `?mode=blueprint&blp=conquer` · digest `31e468d1` · check: playable, median end 12.83 s, outcomes "RED WINS", "BLUE WINS", "GREEN WINS".

```text
"Colour Conquest": "Four colours collide: the faster ball converts the slower one. The last colour standing wins."
Arena: a circle, no gravity, bounce 1.
Bodies: red (9 px), blue (9 px, team 1), green (9 px, team 2), gold (9 px, team 3).
Start: (per) reds at random places at 230 px/s; (per) blues at random places at 230 px/s; (per) greens at random places at 230 px/s; (per) golds at random places at 230 px/s.
Rule: when a ball touches a ball of another team: the other ball joins its team, then recolour the other ball (team), then a merge note.
Rule: every 6 s: speed every ball × 1.12.
Ends: when 1 team or fewer are left "{winner} WINS"; after 90 s at the latest "{winner} LEADS"; the winner is mostBalls.
```

```json
{
 "arena": {
  "size": 0.92
 },
 "bodies": [
  {
   "id": "red",
   "radius": 9
  },
  {
   "color": 1,
   "id": "blue",
   "radius": 9,
   "team": 1
  },
  {
   "color": 2,
   "id": "green",
   "radius": 9,
   "team": 2
  },
  {
   "color": 3,
   "id": "gold",
   "radius": 9,
   "team": 3
  }
 ],
 "finish": {
  "any": [
   {
    "atMost": 1,
    "say": "{winner} WINS",
    "when": "teamsLeft"
   }
  ],
  "timeoutSay": "{winner} LEADS",
  "timeoutSec": 90,
  "winner": "mostBalls"
 },
 "hud": [
  {
   "label": "colours left",
   "show": "teams"
  },
  {
   "label": "time",
   "show": "time"
  }
 ],
 "look": {
  "teamNames": [
   "RED",
   "BLUE",
   "GREEN",
   "GOLD",
   "PURPLE",
   "CYAN"
  ]
 },
 "meta": {
  "author": "builtin",
  "description": "Four colours collide: the faster ball converts the slower one. The last colour standing wins.",
  "family": "battle",
  "name": "Colour Conquest"
 },
 "params": [
  {
   "at": "vars[0].start",
   "id": "per",
   "label": "balls per colour",
   "max": 8,
   "min": 2
  },
  {
   "at": "rules[1].sec",
   "id": "boost",
   "label": "speed-up every",
   "max": 20,
   "min": 2
  }
 ],
 "rules": [
  {
   "do": [
    {
     "act": "team",
     "target": "other",
     "to": "self"
    },
    {
     "act": "recolor",
     "color": "team",
     "target": "other"
    },
    {
     "act": "sound",
     "voice": "merge"
    }
   ],
   "when": "ballHit",
   "with": "otherTeam"
  },
  {
   "do": [
    {
     "act": "speed",
     "scale": 1.12,
     "target": "all"
    }
   ],
   "sec": 6,
   "when": "timer"
  }
 ],
 "sound": {
  "root": 9,
  "scale": "minor",
  "voices": {
   "wallHit": "none"
  }
 },
 "spawners": [
  {
   "at": "random",
   "body": "red",
   "count": "per",
   "speed": 230
  },
  {
   "at": "random",
   "body": "blue",
   "count": "per",
   "speed": 230
  },
  {
   "at": "random",
   "body": "green",
   "count": "per",
   "speed": 230
  },
  {
   "at": "random",
   "body": "gold",
   "count": "per",
   "speed": 230
  }
 ],
 "v": 1,
 "vars": [
  {
   "id": "per",
   "start": 6
  }
 ]
}
```

### Tier Climb (`tierClimb`)

Orbs rain down and two of a tier merge into the next. The first to the target tier ends it.

Link: `?mode=blueprint&blp=tierClimb` · digest `c7f720cc` · check: playable, median end 25.29 s, outcomes "TIER 8 REACHED".

```text
"Tier Climb": "Orbs rain down and two of a tier merge into the next. The first to the target tier ends it."
Arena: a circle, gravity 0, 520 px/s², bounce 0.55.
Bodies: orb (9 px).
Start: 1 orb at the top at 80 px/s, again every 0.08 s (up to 400).
Rule: when a ball touches a ball of its tier: merge the two into one of the next tier, then recolour it (tier).
Ends: when a ball reaches tier 8 "TIER {tier} REACHED"; after 120 s at the latest "TOP TIER {tier}".
```

```json
{
 "arena": {
  "gravity": {
   "x": 0,
   "y": 520
  },
  "restitution": 0.55,
  "size": 0.92
 },
 "bodies": [
  {
   "id": "orb",
   "radius": 9
  }
 ],
 "finish": {
  "any": [
   {
    "atLeast": 8,
    "say": "TIER {tier} REACHED",
    "when": "tier"
   }
  ],
  "timeoutSay": "TOP TIER {tier}",
  "timeoutSec": 120
 },
 "hud": [
  {
   "label": "top tier",
   "show": "tier"
  },
  {
   "label": "orbs",
   "show": "balls"
  }
 ],
 "look": {
  "palette": [
   "#ff4d6d",
   "#ff922b",
   "#ffd43b",
   "#51cf66",
   "#22d3ee",
   "#b197fc"
  ]
 },
 "meta": {
  "author": "builtin",
  "description": "Orbs rain down and two of a tier merge into the next. The first to the target tier ends it.",
  "family": "rhythm",
  "name": "Tier Climb"
 },
 "params": [
  {
   "at": "finish.any[0].atLeast",
   "id": "target",
   "label": "target tier",
   "max": 10,
   "min": 4
  },
  {
   "at": "spawners[0].everySec",
   "id": "rain",
   "label": "seconds per orb",
   "max": 0.5,
   "min": 0.04,
   "step": 0.01
  },
  {
   "at": "arena.gravity.y",
   "id": "gravity",
   "label": "gravity",
   "max": 1200,
   "min": 100,
   "step": 20
  }
 ],
 "rules": [
  {
   "do": [
    {
     "act": "merge",
     "scale": 1.24
    },
    {
     "act": "recolor",
     "color": "tier"
    }
   ],
   "when": "ballHit",
   "with": "sameTier"
  }
 ],
 "sound": {
  "root": 5,
  "scale": "pentatonic",
  "voices": {
   "ballHit": "none",
   "wallHit": "none"
  }
 },
 "spawners": [
  {
   "at": "top",
   "body": "orb",
   "dir": "down",
   "everySec": 0.08,
   "maxTotal": 400,
   "speed": 80
  }
 ],
 "v": 1
}
```

### Peg Race (`plinkoRace`)

Four balls fall through the pegs and chase a turning exit. First one out wins.

Link: `?mode=blueprint&blp=plinkoRace` · digest `ad34af37` · check: playable, median end 8.87 s, outcomes "GREEN WINS THE RACE", "GOLD WINS THE RACE".

```text
"Peg Race": "Four balls fall through the pegs and chase a turning exit. First one out wins."
Arena: a circle with an exit that turns, gravity 0, 380 px/s², bounce 0.9.
Bodies: red (8 px), blue (8 px, team 1), green (8 px, team 2), gold (8 px, team 3).
Obstacles: pegGrid.
Start: 1 red at the top at 60 px/s; 1 blue at the top at 60 px/s; 1 green at the top at 60 px/s; 1 gold at the top at 60 px/s.
Ends: when 1 ball escaped "{winner} WINS THE RACE"; after 60 s at the latest "NOBODY GOT OUT"; the winner is firstOut.
```

```json
{
 "arena": {
  "exits": [
   {
    "atDeg": 270,
    "widthDeg": 14
   }
  ],
  "gravity": {
   "x": 0,
   "y": 380
  },
  "restitution": 0.9,
  "size": 0.92,
  "spinDegPerSec": 30
 },
 "bodies": [
  {
   "id": "red",
   "radius": 8
  },
  {
   "color": 1,
   "id": "blue",
   "radius": 8,
   "team": 1
  },
  {
   "color": 2,
   "id": "green",
   "radius": 8,
   "team": 2
  },
  {
   "color": 3,
   "id": "gold",
   "radius": 8,
   "team": 3
  }
 ],
 "finish": {
  "any": [
   {
    "atLeast": 1,
    "say": "{winner} WINS THE RACE",
    "when": "escaped"
   }
  ],
  "timeoutSay": "NOBODY GOT OUT",
  "timeoutSec": 60,
  "winner": "firstOut"
 },
 "hud": [
  {
   "label": "time",
   "show": "time"
  }
 ],
 "look": {
  "rim": 4,
  "teamNames": [
   "RED",
   "BLUE",
   "GREEN",
   "GOLD",
   "PURPLE",
   "CYAN"
  ]
 },
 "meta": {
  "author": "builtin",
  "description": "Four balls fall through the pegs and chase a turning exit. First one out wins.",
  "family": "rhythm",
  "name": "Peg Race"
 },
 "obstacles": [
  {
   "cols": 7,
   "h": 0.9,
   "kind": "pegGrid",
   "r": 0.028,
   "rows": 6,
   "w": 1.3,
   "y": 0.1
  }
 ],
 "params": [
  {
   "at": "arena.exits[0].widthDeg",
   "id": "exit",
   "label": "exit width",
   "max": 40,
   "min": 8
  },
  {
   "at": "arena.spinDegPerSec",
   "id": "spin",
   "label": "exit spin",
   "max": 90,
   "min": 0,
   "step": 5
  },
  {
   "at": "obstacles[0].rows",
   "id": "rows",
   "label": "peg rows",
   "max": 6,
   "min": 2
  }
 ],
 "sound": {
  "root": 7
 },
 "spawners": [
  {
   "at": "top",
   "body": "red",
   "speed": 60
  },
  {
   "at": "top",
   "body": "blue",
   "speed": 60
  },
  {
   "at": "top",
   "body": "green",
   "speed": 60
  },
  {
   "at": "top",
   "body": "gold",
   "speed": 60
  }
 ],
 "v": 1
}
```

### Grow or Go (`growEscape`)

Every bounce makes the ball bigger and faster. Can it find the gap before it no longer fits?

Link: `?mode=blueprint&blp=growEscape` · digest `55ffef0b` · check: playable, median end 19.63 s, outcomes "ESCAPED AFTER BOUNCE 10", "ESCAPED AFTER BOUNCE 4", "ESCAPED AFTER BOUNCE 26", "TOO BIG TO ESCAPE".

```text
"Grow or Go": "Every bounce makes the ball bigger and faster. Can it find the gap before it no longer fits?"
Arena: a circle with an exit that turns, no gravity, bounce 1.
Bodies: ball (8 px).
Start: 1 ball at the top at 110 px/s.
Rule: when a ball hits a wall: grow it by 1 px, then speed it × 1.15, then bounces + 1.
Rule: on every beat: a gap note.
Ends: when 1 ball escaped "ESCAPED AFTER BOUNCE {bounces}", or when bounces reaches 28 "TOO BIG TO ESCAPE"; after 60 s at the latest "TIME UP".
```

```json
{
 "arena": {
  "exits": [
   {
    "atDeg": 180,
    "widthDeg": 21
   }
  ],
  "size": 0.92,
  "spinDegPerSec": 40
 },
 "bodies": [
  {
   "color": 3,
   "id": "ball",
   "radius": 8
  }
 ],
 "finish": {
  "any": [
   {
    "atLeast": 1,
    "say": "ESCAPED AFTER BOUNCE {bounces}",
    "when": "escaped"
   },
   {
    "atLeast": 28,
    "say": "TOO BIG TO ESCAPE",
    "what": "bounces",
    "when": "count"
   }
  ],
  "timeoutSec": 60
 },
 "hud": [
  {
   "label": "bounces",
   "show": "bounces"
  },
  {
   "label": "time",
   "show": "time"
  }
 ],
 "look": {
  "rim": 1,
  "trail": true
 },
 "meta": {
  "author": "builtin",
  "description": "Every bounce makes the ball bigger and faster. Can it find the gap before it no longer fits?",
  "name": "Grow or Go"
 },
 "params": [
  {
   "at": "rules[0].do[0].by",
   "id": "grow",
   "label": "grow per bounce",
   "max": 3,
   "min": 0.2,
   "step": 0.1
  },
  {
   "at": "arena.exits[0].widthDeg",
   "id": "exit",
   "label": "exit width",
   "max": 40,
   "min": 8
  },
  {
   "at": "finish.any[1].atLeast",
   "id": "limit",
   "label": "bounces to lose",
   "max": 60,
   "min": 10
  }
 ],
 "rules": [
  {
   "do": [
    {
     "act": "grow",
     "by": 1
    },
    {
     "act": "speed",
     "scale": 1.15
    },
    {
     "act": "var",
     "id": "bounces"
    }
   ],
   "when": "wallHit"
  },
  {
   "do": [
    {
     "act": "sound",
     "pitch": -7,
     "voice": "gap"
    }
   ],
   "when": "beat"
  }
 ],
 "sound": {
  "bpm": 100
 },
 "spawners": [
  {
   "at": "top",
   "body": "ball",
   "dir": "up",
   "speed": 110
  }
 ],
 "v": 1,
 "vars": [
  {
   "id": "bounces"
  }
 ]
}
```
