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
  templates are left out, because their fighters are third-party characters. Who Wins: Race is hidden, because none of its
  plans passes gate G1: its first impact comes at 1.8 s. It keeps its place in the turn order and gives no clip, as it gave
  none before it was hidden.
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
Model: claude-opus-5-5. Date: 2026-10-28. Roles played in one context. 237 briefs answered (239 replies, refused ones included). Corpus 8e1c1023a7b609a9 (an older corpus or older briefs: kept as history, not replayed).

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
  The studio's first review round hid it (`docs/virality-playbook.md` §5).

### claude-opus-5-5-2026-10-28-step6

<!-- crew-eval:run claude-opus-5-5-2026-10-28-step6 -->
Model: claude-opus-5-5. Date: 2026-10-28. Roles played in one context. 237 briefs answered (239 replies, refused ones included). Corpus 8e1c1023a7b609a9 (an older corpus or older briefs: kept as history, not replayed).

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
<!-- /crew-eval:run claude-opus-5-5-2026-10-28-step6 -->

**What this run is.** The run above, carried over to the briefs as step 6 of the studio's build left them. That step's real
run (`docs/agents/STUDIO.md`, the worked example) changed nine briefs, and the same model answered those nine again, in one
context: the cold viewer's three (a Power Layers scene now says the ball bounces on top of its layers, a pendulum ring is
described as a ring), the Thorough reviewer's three that read those viewer answers, and the brainstormer's three (its menu now
shows each hook's words). The other 228 answers are the earlier run's, to briefs that did not change by a byte: the eval keys
every answer by its brief's hash, and the earlier run stays above as history. The numbers did not move.

### claude-opus-5-5-2026-10-28-round1

<!-- crew-eval:run claude-opus-5-5-2026-10-28-round1 -->
Model: claude-opus-5-5. Date: 2026-10-28. Roles played in one context. 237 briefs answered (243 replies, refused ones included). Corpus 8e1c1023a7b609a9 (an older corpus or older briefs: kept as history, not replayed).

Corpus: 40 clean clips, 27 planted (9 classes).

| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |
| skeptic | the skeptic; the rules decide | 18 of 27 (67%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1.12 |
| viewer | the viewer; the rules decide | 12 of 27 (44%) | 16 of 27 (59%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 3 of 40 (8%) | none asked | 1 |
| reviewer | the reviewer alone | 23 of 27 (85%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.08 |
| quick | Quick: the skeptic, the reviewer where in doubt | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.44 |
| all | Thorough: the viewer, the skeptic, the reviewer | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 3 of 40 (8%) | 0 of 40 (0%) | 3 of 40 (8%) | 12 / 16 (4 need the seed search) | 3.34 |

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
<!-- /crew-eval:run claude-opus-5-5-2026-10-28-round1 -->

**What this run is.** The step-6 run, carried over to the briefs as the studio's first review round left them. That round
narrowed the reviewer's "turnOff may name" line (and its turnOff choices) to the effects, HUDs and labels a clip draws: before
it, every eval clip listed the HUD flags of other modes (sbHud, flHud, showScoreboard …), which a turnOff could name to no
effect. The line is part of every reviewer brief, so all 125 reviewer briefs changed, and the same model answered them again,
in one context. The other 112 answers (the skeptic's 55, the viewer's 54, the brainstormer's 3) are step 6's, to briefs that
did not change by a byte, and step 6's run stays above as history. The numbers did not move, save the calls: on the two
endingConfusing clips whose templates end resolved only, the reviewer again tried switchEnding, was refused, and dropped them,
now in all three runs that ask it (six refusals), so the reviewer alone costs 1.08 calls per kept clip and Thorough 3.34.

### claude-opus-5-5-2026-10-28-round1b

<!-- crew-eval:run claude-opus-5-5-2026-10-28-round1b -->
Model: claude-opus-5-5. Date: 2026-10-28. Roles played in one context. 237 briefs answered (244 replies, refused ones included). Corpus 1eb78cc0c5c16f05 (an older corpus or older briefs: kept as history, not replayed).

Corpus: 40 clean clips, 27 planted (9 classes).

| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |
| skeptic | the skeptic; the rules decide | 18 of 27 (67%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1.12 |
| viewer | the viewer; the rules decide | 12 of 27 (44%) | 16 of 27 (59%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 3 of 40 (8%) | none asked | 1 |
| reviewer | the reviewer alone | 23 of 27 (85%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.08 |
| quick | Quick: the skeptic, the reviewer where in doubt | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.44 |
| all | Thorough: the viewer, the skeptic, the reviewer | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 3 of 40 (8%) | 0 of 40 (0%) | 3 of 40 (8%) | 12 / 16 (4 need the seed search) | 3.34 |

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
| the brainstormer | 3 | 18 | 18 | 18 of 18 (100%) | 4 | 4 | 2 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-28-round1b -->

**What this run is.** The round-1 run, carried over to the corpus and the briefs as the round's findings 7 to 12 left them.
Gerald's Portal escape now takes the standard length only: in the short one, on Shorts, its seed search missed the escape on
half the plan seeds. So one clean clip changed. The Gerald Portal plan of plan seed 3 on Shorts is clean now and takes the
place of plan seed 4's, and the ids after it moved. The same model answered that clip's four briefs (the cold viewer's, the
skeptic's and two reviewers'), in one context, knowing it was a clean clip of the corpus. The brainstormer's third request had
pitched Gerald's Portal escape at the short length, which the menu no longer offers. Its recorded reply is now refused, and
the same model answered again with the standard length, the other five ideas unchanged: the brainstormer took 4 calls and was
valid the first time on 2 of 3 requests. The other 233 briefs keep round 1's answers, to briefs that did not change by a byte,
and round 1's run stays above as history. The numbers did not move otherwise.

### claude-opus-5-5-2026-10-28-round1c

<!-- crew-eval:run claude-opus-5-5-2026-10-28-round1c -->
Model: claude-opus-5-5. Date: 2026-10-28. Roles played in one context. 237 briefs answered (238 replies, refused ones included). Corpus 1eb78cc0c5c16f05 (an older corpus or older briefs: kept as history, not replayed).

Corpus: 40 clean clips, 27 planted (9 classes).

| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |
| skeptic | the skeptic; the rules decide | 18 of 27 (67%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1.12 |
| viewer | the viewer; the rules decide | 12 of 27 (44%) | 16 of 27 (59%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 3 of 40 (8%) | none asked | 1 |
| reviewer | the reviewer alone | 23 of 27 (85%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.04 |
| quick | Quick: the skeptic, the reviewer where in doubt | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.4 |
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
| the brainstormer | 3 | 18 | 18 | 18 of 18 (100%) | 4 | 4 | 2 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-28-round1c -->

**What this run is.** The round-1b run, carried over to the briefs as the round's findings 13 to 18 left them. The
reviewer's card said a viewer's misread could be rejected with a reason, which the answer's schema (it has no reason field)
and the rules (a misread is never rejected) both refuse. It now says what they take: viewerAnswer is null unless the read's
makesSense is no or partly, and then it is accepted, with rewriteHook or switchEnding before a render, or the clip dropped.
The card is part of every reviewer brief, so all 125 reviewer briefs changed, and the same model answered them again, in one
context, having seen part of the first run's reviewer answers while it set the eval up. It answered them twice. The card's
first wording named the read's values wrong ("notSure", the viewer's own word, where the reviewer's data says "partly"),
and to that card 4 replies were refused: oneTextAtATime twice, on clips whose look has it on already, and switchEnding once
on each of the two endingConfusing clips whose templates end resolved only. No brief of the corpus holds a "partly" read, so
the corrected card asks the same of every clip, and this run is the second pass, given what the first had shown: no reply
refused. The other 112 answers (the skeptic's 55, the viewer's 54, the brainstormer's 3) are round 1b's, to briefs that did
not change by a byte, and round 1b's run stays above as history. The verdicts and the fixes are round 1b's, counted over the
125 briefs: 77 keeps, 42 fixes (21 new hooks, 9 calmer looks, 9 retimed payoffs, 3 other endings) and 6 drops. Six of the
eight new hooks have other words. The viewer's read is answered on the 4 misreads only, where round 1b also answered 9
reads that were right. Without round 1b's 6 refused replies the calls per kept clip went down (the reviewer alone 1.08 to
1.04, Quick 1.44 to 1.4, Thorough 3.34 to 3.3), and no other number moved.

### claude-opus-5-5-2026-10-28-round1d

<!-- crew-eval:run claude-opus-5-5-2026-10-28-round1d -->
Model: claude-opus-5-5. Date: 2026-10-28. Roles played in one context. 237 briefs answered (238 replies, refused ones included). Corpus 97b0eff71b9fea6d (an older corpus or older briefs: kept as history, not replayed).

Corpus: 40 clean clips, 27 planted (9 classes).

| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |
| skeptic | the skeptic; the rules decide | 18 of 27 (67%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1.12 |
| viewer | the viewer; the rules decide | 12 of 27 (44%) | 16 of 27 (59%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 3 of 40 (8%) | none asked | 1 |
| reviewer | the reviewer alone | 23 of 27 (85%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.04 |
| quick | Quick: the skeptic, the reviewer where in doubt | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.4 |
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
| the brainstormer | 3 | 18 | 18 | 18 of 18 (100%) | 4 | 4 | 2 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-28-round1d -->

Review round 1's findings 19-24 changed the corpus and every intent dossier. The Ball Drop template now times its payoff at
the last ball's last note and draws no payoff words, so the corpus took its plans of plan seeds 1 and 2 where it had taken
7 and 10. The pendulum template sounds its chord at the realignment and hangs in a row. Power Layers' Simple hook keeps its
goal ("260 layers to go."). Every dossier has a new line, `run.payoffMoment`, and a cliffhanger's payoff comes "after the clip
ends". So every skeptic and reviewer brief changed, and 7 viewer briefs did. The same model answered the 187 changed briefs
again in one context (7 viewer, 55 skeptic, 125 reviewer). The other 47 viewer briefs and the 3 brainstormer briefs did not
change by a byte and keep round 1c's answers, and round 1c's run stays above as history. The verdicts and fixes are round
1c's on every clip whose content did not change. On the Ball Drop clips the skeptic now notes the soft payoff (one last note
as the board goes still) as a minor opinion, which counts nowhere. No number moved.

### claude-opus-5-5-2026-10-28-round1e

<!-- crew-eval:run claude-opus-5-5-2026-10-28-round1e -->
Model: claude-opus-5-5. Date: 2026-10-28. Roles played in one context. 237 briefs answered (238 replies, refused ones included). Corpus 8e7a5ba73072f11e.

Corpus: 40 clean clips, 27 planted (9 classes).

| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |
| skeptic | the skeptic; the rules decide | 18 of 27 (67%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1.12 |
| viewer | the viewer; the rules decide | 12 of 27 (44%) | 16 of 27 (59%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 3 of 40 (8%) | none asked | 1 |
| reviewer | the reviewer alone | 23 of 27 (85%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.04 |
| quick | Quick: the skeptic, the reviewer where in doubt | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.4 |
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
| the brainstormer | 3 | 18 | 18 | 18 of 18 (100%) | 4 | 4 | 2 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-28-round1e -->

Review round 1's findings 25 and 26 changed the corpus. The Simple look now breaks a text of two lines at its clause ("16
balls." / "Every peg is a note.", never "16 balls. Every peg is" / "a note."), a size step smaller where only that fits
("Gerald always escapes…" / "right?"), and puts each text at the edge of the square its run leaves clear, so 32 clean and 18
planted clips have other captions: the hooks of the Ball Drop, Pendulum Wave and Capture the Flag clips moved to the bottom of
the square, and so did a Grow clip's counter and one pendulum clip's counter and payoff words. Every run now also says where
its balls move (`run.action`). The intent dossier shows neither the line breaks
nor the places, so no skeptic or reviewer brief changed; the screen view says where each text is, so 12 viewer briefs did.
The same model answered those again in one context, with the same reads. On the busy Ball Drop clip (f25), whose hook now
shares the bottom with the loop HUD's counter, it also named the text, which a measure confirms, and that changed one
reviewer brief (all:f25), answered again with the same fix: the calm look, which takes the loop HUD off. The other 224
answers are round 1d's, to briefs that did not change by a byte, and round 1d's run stays above as history. No number moved.
