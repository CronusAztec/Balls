# The crew's role eval

The crew (`src/lib/crew/`, `docs/agents/STUDIO.md`) asks one AI to play several roles. Each role costs time on the owner's PC or
money on a cloud model, so each has to earn its place. The plan's bar: a role stays on by default only if it adds at least 10
points of defect recall at no more than 5 % false drops. The bar is measured on a fixed corpus, separately for each model.
This file holds the corpus's design, how to run the eval, and every recorded run with its numbers.

## The corpus

`npm run crew:fixtures` (`scripts/crew-fixtures.mjs`) generates the corpus from the code, and nobody edits it by hand.
`tests/crewEval.test.ts` fails while it is stale.

- **40 clean clips** (`tests/fixtures/crew/clean.json`): the ready templates that wrap a recipe (the proven ones) in the
  Simple look, planned from plan seed 1 up. A plan is kept when it passes every gate and crosses no evidence threshold.
  The two-messages-at-once line leaves out the HUD a template draws by design (the mode's own, or the one it keeps for its
  countdown), so a template with a HUD beside its hook is clean too. The clips are taken round robin over 16 templates.
  Fight League's templates are left out, because their fighters are third-party characters. Who Wins: Race is hidden, because none of its
  plans passes gate G1: its first impact comes at 1.8 s. It keeps its place in the turn order and gives no clip, as it gave
  none before it was hidden. On the Beat: Ball Drop is hidden too (review round 2, 21: its run fades out, and every plan
  fails G2), so it keeps its place and gives no clip either.
- **27 planted clips** (`tests/fixtures/crew/planted.json`): clean clips, each used once, with one defect planted by a named
  transform (`src/lib/crew/eval.ts` `plantDefect`). The variant that the fewest clean clips take picks its clip first, so a
  change of the clean clips never leaves a variant with none. There are nine classes, three clips each:

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
- The tooBusy line (two messages at once) confirmed an objection on every template that keeps a HUD beside its hook, even at
  Simple 86-92. The corpus therefore counted that line as the template's own. Since the studio's second review round the
  evidence check itself leaves those HUDs out: no listed fix takes them away. The corpus and every run's numbers stayed the
  same.
- Who Wins: Race fails gate G1 on every plan seed tried (its first impact comes at 1.8 s), although its binding is proven
  (it wraps a recipe). The studio's first review round hid it, and the second marked its binding not ready, since no variant
  of it plans (`docs/virality-playbook.md` §5).

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
Model: claude-opus-5-5. Date: 2026-10-28. Roles played in one context. 237 briefs answered (238 replies, refused ones included). Corpus 8e7a5ba73072f11e (an older corpus or older briefs: kept as history, not replayed).

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

### claude-opus-5-5-2026-10-28-round2e

<!-- crew-eval:run claude-opus-5-5-2026-10-28-round2e -->
Model: claude-opus-5-5. Date: 2026-10-28. Roles played in one context. 237 briefs answered (238 replies, refused ones included). Corpus 403f7108a837b3c6 (an older corpus or older briefs: kept as history, not replayed).

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
| by code (ideasByCode) | 3 | 18 | 18 | 15 of 18 (83%) | 5 | 0 | - |
| the brainstormer | 3 | 18 | 18 | 17 of 18 (94%) | 3.33 | 4 | 2 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-28-round2e -->

Review round 2's findings 20-23 changed the corpus. Ball Drop's template is hidden, so its three clean clips gave way to a
Glass, a Pendulum Wave and a Polyrhythm clip. Pendulum Wave's hook asks "Do they line up?" instead of promising a chord.
Pendulum Wave, Polyrhythm, Grow and Clone per pass draw no bar or timer: those count the clip's seconds and would stop short
at the payoff. Power Layers' hook keeps its rule. Every run's payoff moment also carries the run's usual sound, its other
accented events and its quiet end. With the clean clips changed, most clips took another planted defect. The variant that
fewest clips take now picks first: tooBusy's Simple 66 had been reached only by a Ball Drop clip. 25 viewer, 30 skeptic, 71
reviewer and 3 brainstormer briefs changed. The same model answered them again in one context, the reviewer's after the
skeptic's and the viewer's. The other 108 answers are round 1e's, to briefs that did not change by a byte, and round 1e's run
stays above as history. No catch rate, misread or call count moved. Three numbers did, all in the ideas for open requests, with Ball Drop gone from the menu: the code's
ideas mix 5 formats a request instead of 6, and the brainstormer's 3.33 instead of 4. One of the brainstormer's ideas, a Grow
clip on plan seed 3, found no fill in time, so 17 of 18 passed every gate (18 before). Its first reply to the calm request put
a Grow clip in the long bucket, which the template does not take, and was refused once.

### claude-opus-5-5-2026-10-28-step3

<!-- crew-eval:run claude-opus-5-5-2026-10-28-step3 -->
Model: claude-opus-5-5. Date: 2026-10-28. Roles played in one context. 237 briefs answered (237 replies, refused ones included). Corpus e5038a4fbafe84b8 (an older corpus or older briefs: kept as history, not replayed).

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
| by code (ideasByCode) | 3 | 18 | 18 | 18 of 18 (100%) | 5 | 0 | - |
| the brainstormer | 3 | 18 | 18 | 17 of 18 (94%) | 2.67 | 3 | 3 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-28-step3 -->

AI studio step 3 changed the corpus's four Glass clips (f02, f14 and f51 clean, f07 planted with twoIdeas) and no other. Gate
G5 now sees a text over a mode's own banner, Glass's "STAGE 2" as each floor begins, and the Simple look places a Glass
hook clear of it, so the four hooks moved to the bottom of the square. Their runs' action tracks follow Glass's camera and
carry the banner's box. The corpus takes only the proven templates, so the step's new trial templates gave it no clip. Four
viewer, two skeptic and five reviewer briefs changed, all on those four clips. Six templates joined the brainstormer's menu:
Shatter, Color Match, Target, Brick Smash, Perfect Fit and Classic's one ring. A template without a recipe now shows its
format's words there ("Will the ball get out?"), so the three brainstormer briefs changed too. The same model answered those
14 briefs again in one context. The other 223 answers are round 2e's, to briefs that did not change by a byte, and round 2e's
run stays above as history. No catch rate, misread, fix or clip call count moved. Four numbers did, all in the ideas for open
requests. The code's ideas pass 18 of 18 (15 before): Target's template is now the smash format's first in the menu, ahead
of Power Layers', and every idea of it, cut before its last segment, passes every gate. The brainstormer pitched Perfect
Fit, Brick Smash, Shatter and Target among its ideas and mixed 2.67 formats a request (3.33): its calm request took only
Line up and Fill. All three of its replies were valid the first time (2 of 3), so it made 3 calls (4). Its Grow clip on plan
seed 3 again found no fill in time, so 17 of 18 passed every gate, as before.

### claude-opus-5-5-2026-10-29-step4

<!-- crew-eval:run claude-opus-5-5-2026-10-29-step4 -->
Model: claude-opus-5-5. Date: 2026-10-29. Roles played in one context. 237 briefs answered (237 replies, refused ones included). Corpus 0ad98c82ecffd9ab (an older corpus or older briefs: kept as history, not replayed).

Corpus: 40 clean clips, 27 planted (9 classes).

| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |
| skeptic | the skeptic; the rules decide | 18 of 27 (67%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1.12 |
| viewer | the viewer; the rules decide | 12 of 27 (44%) | 16 of 27 (59%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 1 of 40 (3%) | none asked | 1 |
| reviewer | the reviewer alone | 23 of 27 (85%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.04 |
| quick | Quick: the skeptic, the reviewer where in doubt | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.4 |
| all | Thorough: the viewer, the skeptic, the reviewer | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 1 of 40 (3%) | 0 of 40 (0%) | 1 of 40 (3%) | 10 / 14 (4 need the seed search) | 3.3 |

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
| by code (ideasByCode) | 3 | 18 | 18 | 18 of 18 (100%) | 6 | 0 | - |
| the brainstormer | 3 | 18 | 18 | 17 of 18 (94%) | 3 | 3 | 3 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-29-step4 -->

AI studio step 4 changed ten clips of the corpus, the ones whose mode draws its own end banner: Power Layers' FREEDOM!, the
winner's banner of the battle royale, Capture the Flag and String Battle, and Multipliers' MADE IT HOME (f04, f05, f18, f40,
f54, f56 and f58 clean, f25, f39 and f46 planted). The Simple look draws no payoff words beside such a banner now, and the
dossier names the banner ("drawn on screen at the end"). Nine of the ten clips' briefs changed: 9 viewer, 9 skeptic
and 20 reviewer briefs (f46's, a planted slow start, did not change by a byte). The step's new templates joined the
brainstormer's menu: Bouncing Shapes', Bullseye's and the conveyor's (the Maze's, Territory's and Land Claim's are in the
battle family, not on its menu), so its three briefs changed too. The same model answered those 41 briefs again in one
context. The other 196 answers are step 3's, to briefs that did not change by a byte, and step 3's run stays above as
history. No catch rate, objection or call count moved. The viewer read both Multipliers clips as a count (their run ends on
MADE IT HOME, where the payoff's words had said "IT BROKE. 💥"), so the clean clips it misread fell from 3 to 1, and the
thorough run changed 1 clean clip (3) and kept 10 of 14 fixes (12 of 16): the two rewritten hooks it no longer asked for.
The banners' words name no claim ("the champion's banner", not the winner's: the screen view holds no intent). G2 reads a
banner as words to end on only where it covers the clip's quiet end, so the payoffLate twin now trims its run's quiet end with
the clip (lib/crew/eval.ts): a twin cut shorter keeps facts of its own length, and the CTF clips still take it.
The code's ideas mix 6 formats a request (5) with the aim format on the menu; the brainstormer pitched Bouncing Shapes,
Bullseye and the conveyor among its ideas and mixed 3 formats a request (2.67). Its Grow clip on plan seed 3 again found no
fill in time, so 17 of 18 passed every gate, as before.

### claude-opus-5-5-2026-10-29-step4b

<!-- crew-eval:run claude-opus-5-5-2026-10-29-step4b -->
Model: claude-opus-5-5. Date: 2026-10-29. Roles played in one context. 237 briefs answered (237 replies, refused ones included). Corpus 0ad98c82ecffd9ab (an older corpus or older briefs: kept as history, not replayed).

Corpus: 40 clean clips, 27 planted (9 classes).

| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |
| skeptic | the skeptic; the rules decide | 18 of 27 (67%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1.12 |
| viewer | the viewer; the rules decide | 12 of 27 (44%) | 16 of 27 (59%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 1 of 40 (3%) | none asked | 1 |
| reviewer | the reviewer alone | 23 of 27 (85%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.04 |
| quick | Quick: the skeptic, the reviewer where in doubt | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.4 |
| all | Thorough: the viewer, the skeptic, the reviewer | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 1 of 40 (3%) | 0 of 40 (0%) | 1 of 40 (3%) | 10 / 14 (4 need the seed search) | 3.3 |

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
| by code (ideasByCode) | 3 | 18 | 18 | 18 of 18 (100%) | 6 | 0 | - |
| the brainstormer | 3 | 18 | 18 | 17 of 18 (94%) | 3 | 3 | 3 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-29-step4b -->

AI studio step 4b readied the Journey's and Spiral Glass's templates (each mode's own overlay switched off in the Simple look),
and both joined the brainstormer's menu, so its three briefs changed. Nothing else did: the corpus is made of the proven
templates' clips and did not change by a byte. The same model answered the three briefs again in one context. It pitched
Spiral Glass among its satisfying clips, in the conveyor's place, and the Journey and Spiral Glass among the clips where
something gets out or breaks, in place of Shatter and Brick Smash (Shatter's hook would have opened with the same three words
as Spiral Glass's), and kept its six calm ideas. The other 234 answers are step 4's, and step 4's run stays above as history.
No number moved: 17 of 18 of its ideas passed every gate, as before, in 3 formats a request.

### claude-opus-5-5-2026-10-29-step5

<!-- crew-eval:run claude-opus-5-5-2026-10-29-step5 -->
Model: claude-opus-5-5. Date: 2026-10-29. Roles played in one context. 237 briefs answered (237 replies, refused ones included). Corpus 884d91a65835d962 (an older corpus or older briefs: kept as history, not replayed).

Corpus: 40 clean clips, 27 planted (9 classes).

| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |
| skeptic | the skeptic; the rules decide | 18 of 27 (67%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1.12 |
| viewer | the viewer; the rules decide | 12 of 27 (44%) | 16 of 27 (59%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 1 of 40 (3%) | none asked | 1 |
| reviewer | the reviewer alone | 23 of 27 (85%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.04 |
| quick | Quick: the skeptic, the reviewer where in doubt | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.4 |
| all | Thorough: the viewer, the skeptic, the reviewer | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 1 of 40 (3%) | 0 of 40 (0%) | 1 of 40 (3%) | 10 / 14 (4 need the seed search) | 3.3 |

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
| by code (ideasByCode) | 3 | 18 | 18 | 18 of 18 (100%) | 6 | 0 | - |
| the brainstormer | 3 | 18 | 18 | 18 of 18 (100%) | 2.33 | 3 | 3 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-29-step5 -->

AI studio step 5 readied Ball Drop's template again (its rain looped, the clip's end its payoff), so the corpus of the proven
templates' clips takes it back: its round robin moved (three Ball Drop clips in place of the third Glass, Pendulum Wave and
Polyrhythm ones), and 29 clean and 25 planted clips differ from step 4b's. 197 of the 237
briefs were word for word ones an earlier run of the same model had answered (the corpus is close again to the one of round 1
and round 2, before Ball Drop's template was hidden), and those answers stand. The same model answered the other 40 in one
context: the briefs of 8 clips (three clean Ball Drop clips; five planted ones, three hooks that ask two questions, a busy
Portal and a battle royale whose winner comes at 95 %) and the brainstormer's three, whose menu gained the line-up and beat
templates. No catch rate, objection, misread or fix count moved from step 4b's. The brainstormer pitched Colour Sort, Chord
Stars, Spinning Hoops and Ball Drop among its satisfying clips, and Ball Drop, Beat Machines and Wave Tank beside the pendulum,
the polyrhythm and Chord Stars for its calm ones, so it mixed 2.33 formats a request (3), and all 18 of its ideas passed every
gate (17 of 18). Step 4b's run stays above as history.

### claude-opus-5-5-2026-10-29-step6

<!-- crew-eval:run claude-opus-5-5-2026-10-29-step6 -->
Model: claude-opus-5-5. Date: 2026-10-29. Roles played in one context. 237 briefs answered (237 replies, refused ones included). Corpus 884d91a65835d962 (an older corpus or older briefs: kept as history, not replayed).

Corpus: 40 clean clips, 27 planted (9 classes).

| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |
| skeptic | the skeptic; the rules decide | 18 of 27 (67%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1.12 |
| viewer | the viewer; the rules decide | 12 of 27 (44%) | 16 of 27 (59%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 1 of 40 (3%) | none asked | 1 |
| reviewer | the reviewer alone | 23 of 27 (85%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.04 |
| quick | Quick: the skeptic, the reviewer where in doubt | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.4 |
| all | Thorough: the viewer, the skeptic, the reviewer | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 1 of 40 (3%) | 0 of 40 (0%) | 1 of 40 (3%) | 10 / 14 (4 need the seed search) | 3.3 |

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
| by code (ideasByCode) | 3 | 18 | 18 | 18 of 18 (100%) | 6 | 0 | - |
| the brainstormer | 3 | 18 | 18 | 18 of 18 (100%) | 3.33 | 3 | 3 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-29-step6 -->

AI studio step 6 readied the Drawing Machine's template, five Mode Lab games and Fight League's boss rush, so the
brainstormer's menu gained the reveal and Mode Lab templates and its three briefs changed. Nothing else did: the corpus is
made of the proven templates' clips, Fight League's left out, and did not change by a byte. The same model answered the three
briefs again in one context. It pitched the Drawing Machine among its satisfying clips, in the pendulum's place, and among
its calm ones, in the polyrhythm's, and Ring Breaker among the clips where something gets out or breaks, in Glass's place.
The other 234 answers are step 5's, and step 5's run stays above as history. No catch rate, objection, misread or fix count
moved; all 18 of the brainstormer's ideas passed every gate, as before, in 3.33 formats a request (2.33).

### claude-opus-5-5-2026-10-29-round1

<!-- crew-eval:run claude-opus-5-5-2026-10-29-round1 -->
Model: claude-opus-5-5. Date: 2026-10-29. Roles played in one context. 250 briefs answered (250 replies, refused ones included). Corpus 7369f59928d82bba (an older corpus or older briefs: kept as history, not replayed).

Corpus: 40 clean clips, 27 planted (9 classes).

| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |
| skeptic | the skeptic; the rules decide | 18 of 27 (67%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1.12 |
| viewer | the viewer; the rules decide | 12 of 27 (44%) | 16 of 27 (59%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 1 of 40 (3%) | none asked | 1 |
| reviewer | the reviewer alone | 23 of 27 (85%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.04 |
| quick | Quick: the skeptic, the reviewer where in doubt | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.4 |
| all | Thorough: the viewer, the skeptic, the reviewer | 26 of 27 (96%) | 27 of 27 (100%) | 0 of 40 (0%) | 1 of 40 (3%) | 0 of 40 (0%) | 1 of 40 (3%) | 10 / 14 (4 need the seed search) | 3.3 |

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
| by code (ideasByCode) | 3 | 18 | 18 | 18 of 18 (100%) | 6 | 0 | - |
| the brainstormer | 3 | 18 | 18 | 18 of 18 (100%) | 3.33 | 3 | 3 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-29-round1 -->

The studio's first review round of AI studio step 2 narrowed Grow's fill template to the short length: in the standard one its
seed search often found no fill inside the band (about one Reels plan in three failed a gate). The corpus plans its clean clips
from plan seed 1 up, so Grow's three clips are now short ones, fill-grow#1, #2 and #3 instead of #2, #4 and #5, and two planted
clips moved to them: 4 of the 67 fixtures changed, and the corpus with them. The same model answered the 13 briefs those clips
ask in one context, as before: it read both clean clips as a ball that grows until it fills the ring and kept them, and read the
one whose payoff says "Bullseye!" as a fill with a wrong ending and dropped it. The other 237 answers are step 6's, to briefs
that did not change by a byte, and step 6's run stays above as history. No catch rate, objection, misread or fix count moved.

### claude-opus-5-5-2026-10-29-round1b

<!-- crew-eval:run claude-opus-5-5-2026-10-29-round1b -->
Model: claude-opus-5-5. Date: 2026-10-29. Roles played in one context. 350 briefs answered (354 replies, refused ones included). Corpus e588ddc5b93e647c (an older corpus or older briefs: kept as history, not replayed).

Corpus: 40 clean clips, 27 planted (9 classes).

| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |
| skeptic | the skeptic; the rules decide | 17 of 27 (63%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1.1 |
| viewer | the viewer; the rules decide | 12 of 27 (44%) | 18 of 27 (67%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 3 of 40 (8%) | none asked | 1 |
| reviewer | the reviewer alone | 23 of 27 (85%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.04 |
| quick | Quick: the skeptic, the reviewer where in doubt | 25 of 27 (93%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.39 |
| all | Thorough: the viewer, the skeptic, the reviewer | 25 of 27 (93%) | 27 of 27 (100%) | 0 of 40 (0%) | 3 of 40 (8%) | 0 of 40 (0%) | 3 of 40 (8%) | 12 / 16 (4 need the seed search) | 3.24 |

| Defect (3 each) | Gate | rules | skeptic | viewer | reviewer | quick | all |
| --- | --- | --- | --- | --- | --- | --- | --- |
| slowStart | G1 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| payoffCut | G2 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| hookUntrue | G4 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| textUnreadable | G5 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| payoffLate | none | 0/3 | 2/3 | 0/3 | 0/3 | 2/3 | 2/3 |
| tooBusy | none | 0/3 | 3/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| hookMismatch | none | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| twoIdeas | none | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| endingConfusing | none | 0/3 | 0/3 | 0/3 | 2/3 | 2/3 | 2/3 |

| Ideas for open requests | Requests | Ideas | Planned | Pass every gate | Formats a request | Calls | Valid first time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| by code (ideasByCode) | 3 | 18 | 18 | 18 of 18 (100%) | 6 | 0 | - |
| the brainstormer | 3 | 18 | 18 | 18 of 18 (100%) | 3 | 3 | 3 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-29-round1b -->

The second half of the studio's first review round of AI studio step 2 hid Ball Drop's, Beat Machines', Wave Tank's and Perfect
Fit's templates again (a beat payoff must now stand out from the bars before it, and Perfect Fit's full box shows for 0.15 s),
re-timed Collision Playground's on its anti-collision drop, gave Spiral Glass and Conveyor hooks their payoffs answer and
moved the Simple payoff line to the half second its words can reach in time. The corpus of the proven templates' clips lost
Ball Drop's clips (three clean, two planted), so its round robin moved and all 67 fixtures differ from round 1's; 140 of the 237 briefs were word for
word ones round 1's run had answered, and those answers stand. The same model answered the other 97 in one context: the
viewer's, skeptic's and reviewer's briefs of 21 clips (11 clean, 10 planted) and the brainstormer's three. It read both clean
Glass clips as glass breaking rather than Gerald getting home, so the viewer misread 3 clean clips (1) and the thorough panel
rewrote those two hooks (Clean changed 3, from 1); it called Capture the Flag's win at 95 % late but minor, so the skeptic
caught one late payoff fewer (17 of 27, from 18; 25 of 27 for Quick and Thorough, from 26). It dropped the two planted clips
whose payoff word answers another question and that no listed fix can reword (a resolved-only template). The brainstormer
answered its three briefs twice. Its first pitch was refused on every request (a cliffhanger-only Shatter and Target, a
short-only Chord Stars); then the menu changed once more, as the conveyor's own hook now shows its words ("{count} balls.
Will they all get out?") where it had shown none, and it answered the three new briefs knowing those refusals: valid first
time on 3 of 3, at 3 calls. All 18 ideas passed every gate, in 3 formats a request (3.33). Round 1's run stays above as
history.

### claude-opus-5-5-2026-10-29-round1c

<!-- crew-eval:run claude-opus-5-5-2026-10-29-round1c -->
Model: claude-opus-5-5. Date: 2026-10-29. Roles played in one context. 350 briefs answered (354 replies, refused ones included). Corpus c1275a1f5f310167.

Corpus: 40 clean clips, 27 planted (9 classes).

| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |
| skeptic | the skeptic; the rules decide | 17 of 27 (63%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1.1 |
| viewer | the viewer; the rules decide | 12 of 27 (44%) | 18 of 27 (67%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 3 of 40 (8%) | none asked | 1 |
| reviewer | the reviewer alone | 23 of 27 (85%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.04 |
| quick | Quick: the skeptic, the reviewer where in doubt | 25 of 27 (93%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 9 / 13 (4 need the seed search) | 1.39 |
| all | Thorough: the viewer, the skeptic, the reviewer | 25 of 27 (93%) | 27 of 27 (100%) | 0 of 40 (0%) | 3 of 40 (8%) | 0 of 40 (0%) | 3 of 40 (8%) | 12 / 16 (4 need the seed search) | 3.24 |

| Defect (3 each) | Gate | rules | skeptic | viewer | reviewer | quick | all |
| --- | --- | --- | --- | --- | --- | --- | --- |
| slowStart | G1 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| payoffCut | G2 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| hookUntrue | G4 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| textUnreadable | G5 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| payoffLate | none | 0/3 | 2/3 | 0/3 | 0/3 | 2/3 | 2/3 |
| tooBusy | none | 0/3 | 3/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| hookMismatch | none | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| twoIdeas | none | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| endingConfusing | none | 0/3 | 0/3 | 0/3 | 2/3 | 2/3 | 2/3 |

| Ideas for open requests | Requests | Ideas | Planned | Pass every gate | Formats a request | Calls | Valid first time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| by code (ideasByCode) | 3 | 18 | 18 | 18 of 18 (100%) | 6 | 0 | - |
| the brainstormer | 3 | 18 | 18 | 18 of 18 (100%) | 3 | 3 | 3 of 3 |
<!-- /crew-eval:run claude-opus-5-5-2026-10-29-round1c -->

The round-1b run, carried over to the corpus as the round's findings 13 to 18 left it. The Simple look now moves a hook to
the bottom of the square for any action it hides at the top where the bottom hides none (finding 13), so one clean clip
changed: Gerald's Portal escape, whose hook "Gerald always escapes… right?" covered his first bounce near the top for half a
second, now sits at the bottom. Only its cold viewer's brief changed, as that brief says where each text sits. The same
model answered it in one context, knowing it was a clean clip of the corpus, as round 1b had: Gerald trying to escape five
spinning rings, clear by 3 s, maybe watched to the end. The other 349 answers are round 1b's, to briefs that did not change by
a byte, and round 1b's run stays above as history. The numbers did not move.
