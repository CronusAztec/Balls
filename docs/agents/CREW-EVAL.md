# The crew's role eval

The crew (`src/lib/crew/`, `docs/agents/STUDIO.md`) asks one AI to play several roles. Each role costs time on the owner's PC or
money on a cloud model, so each has to earn its place. The plan's bar: a role stays on by default only if it adds at least 10
points of defect recall at no more than 5 % false drops. The bar is measured on a fixed corpus, separately for each model.
This file holds the corpus's design, how to run the eval, and every recorded run with its numbers.

## The corpus

`npm run crew:fixtures` (`scripts/crew-fixtures.mjs`) generates the corpus from the code, and nobody edits it by hand.
`tests/crewEval.test.ts` fails while it is stale.

- **40 clean clips** (`tests/fixtures/crew/clean.json`): the ready templates in the Simple look, planned from plan seed 1 up.
  A plan is kept when it passes every gate and crosses no evidence threshold. The one exception is the two-messages-at-once
  line on a template that keeps a HUD beside its hook. The clips are taken round robin over 16 templates. Fight League's
  templates are left out, because their fighters are third-party characters. Who Wins: Race is left out because none of its
  plans passes gate G1: its first impact comes at 1.8 s.
- **27 planted clips** (`tests/fixtures/crew/planted.json`): clean clips, each used once, with one defect planted by a named
  transform (`src/lib/crew/eval.ts` `plantDefect`). There are nine classes, three clips each:

| Class | Gate it fails | What was planted |
| --- | --- | --- |
| slowStart | G1 | the first impact moved past 1 s (1.4, 1.9 or 2.4 s) |
| payoffCut | G2 | the clip ends 0.6-1.4 s before its payoff |
| hookUntrue | G4 | a number in the hook that the run does not have |
| textUnreadable | G5 | a hook of 9-10 words |
| payoffLate | none | the clip trimmed so the payoff lands at 92-95 % (G2 still passes) |
| tooBusy | none | charged effects switched on until Simple is 60-78 (G6 still passes) |
| hookMismatch | none | the hook of another format, with no number (G4 still passes) |
| twoIdeas | none | a hook that asks two different questions |
| endingConfusing | none | the payoff's words of another format |

The first four classes are the rules' job, and the rules drop them before any model is asked. The last five pass every gate,
so only the roles can see them. A fixture's id (f01…) follows a hash of its source, so the order of the ids says nothing about
the defects.

## The runs

Each run reviews every fixture on its own, with a different set of roles. The rules take the place of the roles a run leaves
out (`PanelInput.off` in `src/lib/crew/panel.ts`).

| Run | Who is asked |
| --- | --- |
| rules | no model |
| skeptic | the skeptic; the rules decide in the reviewer's place |
| viewer | the viewer, before the render; the rules decide |
| reviewer | the reviewer alone, with no objections and no viewer's read |
| quick | the default: the skeptic, then the reviewer where something is in doubt |
| all | Thorough: the viewer, the skeptic and the reviewer on every clip |
| brainstormer | three open requests, pitched by the brainstormer, against the ideas the code picks |

What the tables count:

- **Defects caught**: a planted clip that does not reach the keeps as it came. It was dropped, or a fix that answers its defect
  was applied (a rule fix counts too).
- **Defects named**: its gate fails, an objection of its kinds stands, the viewer misread a clip whose defect is about what it
  shows, or a distraction it names is confirmed by a measure. A reviewer who fixes a clip without an objection catches the
  defect without naming it.
- **Clean dropped, changed, objected to, misread**: the false alarms on the 40 clean clips.
- **Fixes kept / asked**: the reviewer's fixes the rules kept, out of those it asked for. The eval has no planner, so a fix that
  needs the seed search (retimePayoff, reseedEarlyMotion, switchEnding, changeLength) is reverted. The panel's rule then drops
  a clip whose confirmed major objection still stands, and keeps one that only has opinions against it.
- **Calls per kept clip**: model calls, retries included, over the clips the run kept. Time and cost are not measured here.

## How to run it

- **Claude Code**: the `jbl-make-video` skill's "role eval" section (`.claude/skills/jbl-make-video/SKILL.md`). Start with
  `npm run -s agent -- review --json '{"studio":"eval-<name>","fixture":true,"separation":"contexts"}'`. The review tool
  then asks every run's briefs, the cold viewer's first, so no viewer answer is written after an intent dossier was read. Hand
  each brief to its subagent. When the tool says "done", run `npm run crew:fixtures -- --record eval-<name> --model <id>` to
  keep the run in `tests/fixtures/crew/runs/` and write its tables below.
- **The local model**: from the app's Make videos crew (a later step), on the same corpus.
- **CI**: `tests/crewEval.test.ts` runs scripted models. Their numbers prove the wiring and the arithmetic, not a model's
  quality. The test also replays every current recorded run to the numbers below.

## Runs

### claude-opus-5-5-2026-10-28

<!-- crew-eval:run claude-opus-5-5-2026-10-28 -->
Model: claude-opus-5-5. Date: 2026-10-28. Roles played in one context. 237 briefs answered (239 replies, refused ones included). Corpus 8e1c1023a7b609a9.

Corpus: 40 clean clips, 27 planted (9 classes).

| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |
| skeptic | the skeptic; the rules decide | 18 of 27 (67%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1.12 |
| viewer | the viewer; the rules decide | 12 of 27 (44%) | 16 of 27 (59%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 3 of 40 (8%) | none asked | 1 |
| reviewer | the reviewer alone | 23 of 27 (85%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.04 |
| quick | Quick: the skeptic, the reviewer where in doubt | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.44 |
| all | Thorough: the viewer, the skeptic, the reviewer | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 3 of 40 (8%) | 0 of 40 (0%) | 3 of 40 (8%) | 12 / 16 (4 need the seed search) | 3.3 |

| Defect (3 each) | Gate | rules | skeptic | viewer | reviewer | quick | all |
| --- | --- | --- | --- | --- | --- | --- | --- |
| slowStart | G1 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| payoffCut | G2 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| hookUntrue | G4 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| textUnreadable | G5 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| payoffLate | none | 0/3 | 3/3 | 0/3 | 0/3 | 3/3 | 3/3 |
| tooBusy | none | 0/3 | 3/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| hookMismatch | none | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| twoIdeas | none | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| endingConfusing | none | 0/3 | 0/3 | 0/3 | 2/3 | 2/3 | 2/3 |

| Ideas for open requests | Requests | Ideas | Planned | Pass every gate | Formats a request | Calls | Valid first time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| by code (ideasByCode) | 3 | 18 | 18 | 15 of 18 (83%) | 6 | 0 | - |
| the brainstormer | 3 | 18 | 18 | 18 of 18 (100%) | 4 | 3 | 3 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-28 -->

**What this run is, plainly.** These numbers come from one model's run. Claude Opus 5.5 played every role in one
conversation. It worked through a batch driver of the review tool's own protocol: one brief at a time, checked by the panel.
The roles did not run in separate contexts. The run is not blind either: the same model wrote the defect transforms and saw the
list of planted clips before it answered. It wrote every viewer answer before it read any intent dossier, but it could
recognise a planted hook when it saw one. Each class has three clips. Read the numbers as one model's upper bound, and as
proof that the loop works end to end. They do not settle which roles are worth their cost.

**What it says.**

- The rules alone catch the four gate classes (12 of 27) for free.
- The skeptic adds 22 points (to 67 %) with no clean clip dropped or changed. Its judgement objections act only when a
  reviewer is there to answer them.
- Quick (the skeptic, then the reviewer where in doubt) catches 26 of 27 at 1.44 calls per kept clip.
- The reviewer alone catches 23 of 27, because it reads the whole dossier. It missed the three late payoffs: its retime needs
  the seed search, and with no confirmed objection standing, the rules kept those clips as they were. After the skeptic, the
  same retime ends in a drop, because the skeptic's late-payoff objection is confirmed by the facts.
- Thorough adds a viewer before the render. Here that bought no recall over Quick (26 of 27 both), changed 3 clean clips after
  their misreads, and cost 3.3 calls per kept clip. By the plan's bar, the viewer does not earn its place before the render in
  this run. Its real job is the look after the render, which a pre-render corpus cannot measure.
- The miss: one endingConfusing clip, a ring escape that ends on "Smashed.". The reviewer chose switchEnding, which needs the
  seed search the eval does not run, so the rules kept the clip unchanged. The other two endingConfusing clips were on
  templates that only end resolved: switchEnding was refused there, and the reviewer dropped them.
- The brainstormer's 18 ideas all passed every gate, against 15 of 18 for the code's picks. It mixed fewer formats per request
  (4 against 6).

**What it found in the templates** (not planted, so worth a look):

- Count: Multipliers says "x2 x4 x8… until it breaks." and "IT BROKE.". The cold viewer read both clean Multipliers clips as
  something breaking, not as a count.
- Get Out: Glass ends its cliffhanger on "Will the glass hold?", and the viewer read it as a breaking clip, not as Gerald
  getting home.
- The tooBusy line (two messages at once) confirms an objection on every template that keeps a HUD beside its hook, even at
  Simple 86-92. The corpus therefore counts that line as the template's own.
- Who Wins: Race fails gate G1 on every plan seed tried (its first impact comes at 1.8 s), although its binding is proven.
