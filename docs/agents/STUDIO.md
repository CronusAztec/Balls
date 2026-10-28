# Claude's studio: videos the crew judges

Claude (or any agent with a shell or MCP) can make short ball-physics videos in this repository the way the app's crew will
make them: plan with the bot's own planner and the viral templates, score with the app's rules, judge every clip with the
crew's roles, render the kept clips watermarked and look at them again after the render. Claude plays every role. The
rules are code, and they overrule Claude as they overrule any model. Nothing here ships to visitors or app users, and no
tool calls a model or reads a key.

The pieces: the toolbox's studio tools (`src/lib/agentKit/tools.ts`, run by `scripts/agent/studio.mjs` on the studio kit
`src/lib/agentKit/studioKit.ts`), the crew (`src/lib/crew/`: the rules, the roles and the panel the app's Make videos will
run), the templates (`src/lib/bot/templates.ts`) and render v3 (the page's bot handle version 3,
`src/components/simulator/useViralBot.ts`, driven by `scripts/agent/browser.mjs`).

## What a studio holds

Everything lands in `.agent-out/studio/<studio>/`, which git ignores:

| File | What it is |
| --- | --- |
| plan.json | The plans (the plan tool's, or the brainstormer's ideas planned by the review tool), each with its run |
| panel.json | The crew's panel before and after the render: every role's answer, the evidence marks, fixes, verdicts and records |
| post.txt | The kept clips' words to post (title, caption, hashtags) with the crew's lines before and after the render |
| `<clip>/` | A rendered clip: clip.mp4 (or .webm), sheet.png, hook-sheet.png and render.json |

## The crew

The same AI plays every role, each with its own card, data and answer schema (`src/lib/crew/roles.ts`). Two more roles are
plain code.

| Role | Who plays it here | What it reads | What it answers |
| --- | --- | --- | --- |
| Clarity check | code | the clip | the gates G1-G8, the Simple score, the Playbook score |
| Researcher | code, or you with `"research":"live"` | the research digest | at most five pieces of advice |
| Brainstormer | you, for an open request | the request, the brief, the ready templates | ideas, each a template on its mode |
| Skeptic | you | the clip's dossier (the intent view) | the clip's one idea and at most three objections |
| Viewer | you | the screen view only (after the render: the clip's sheets too) | what a stranger thinks happens |
| Reviewer | you, where something is in doubt | the dossier, the objections marked by the facts, the viewer's read | keep, fix or drop |
| Picker | code | the gates and the scores | the best clips |
| Producer | you | the kept clips | the words to post, the hook locked to the drawn one |

## The tools

| Tool | Use it to |
| --- | --- |
| `research` | Read the research brief, offline: the trend summary, the playbook and the local inspire dataset by its searches |
| `templates` | See the ten formats, all 48 modes' bindings and tiers, the ready templates with their words, the Simple look |
| `plan` | Plan clips with the bot's planner, deterministically, into a studio's plan.json |
| `review` | Play the crew's roles: take the next brief, answer it, get the next one or the decision |
| `render` | With `plan` and `clip`: render a planned clip as the crew left it, watermarked, with its melody and sheets |
| `score` | Score a link, or a studio clip as the crew left it (and as its render measured it) |
| `frames`, `preview` | With `image`: a sheet as one JPEG image block, for a client that cannot read files |

Run them with `npm run -s agent -- <tool> --json '{…}'`, or over MCP (`jumpingballs-agent`). `docs/agents/CLI.md` has every
argument.

## The loop

1. `npm run -s agent -- research --json '{}'`: the brief. A weak finding is weak. When the trend summary is stale, `inspire`
   on a template's theme words refreshes the evidence first.
2. `npm run -s agent -- templates --json '{}'`: the ready templates. The battle family (Fight League names third-party
   characters) only when the owner asks for it.
3. `npm run -s agent -- plan --json '{"template":"get-out-classic","count":3,"studio":"rings"}'`. Plan in the page's own
   world (the headless page is 800 × 450: pass `"world":{"width":800,"height":450}`), or the clip plays another run than
   the one planned; render tells you when the worlds differ. For an open request, skip the plan and start the review with
   `"request"`: the brainstormer pitches, and the review tool plans the ideas itself.
4. `npm run -s agent -- review --json '{"studio":"rings"}'`, then answer each brief with
   `{"studio":"rings","role":"…","clip":"…","verdict":{…}}` until the panel is done. Play each role in a context of its own
   where you can (in Claude Code, the `jbl-<role>` subagents of the `jbl-make-video` skill) and pass
   `"separation":"contexts"` when the panel starts; otherwise the record says the roles shared one context.
5. `npm run -s agent -- render --json '{"plan":".agent-out/studio/rings/plan.json","clip":"…"}'` for each kept clip.
6. Look at each clip's sheet.png and hook-sheet.png, then review again with `"stage":"post"`: the viewer reads the clip from
   what is on screen alone, and the reviewer steps in where the rules, the read or the facts disagree.
7. Hand over the studio folder: the clips, panel.json and post.txt. The owner approves every post.

## How the review holds you to the rules

- **One brief at a time, in the panel's order.** An answer for another role or clip is refused and changes nothing.
- **The schema is the clip's.** Evidence is dossier keys only, written exactly. Fixes come only from the fixed list of nine,
  inside their bounds (a new hook has at most 7 words and 42 characters and only numbers the clip has). The reviewer may
  answer only the objections that still stand.
- **Facts first.** Each objection is marked confirmed, refuted (dropped, with the fact that refutes it in the log) or
  opinion (half weight, never a blocker, standing only at major or fatal). A confirmed objection cannot be rejected, and a
  clip that fails a gate is never kept.
- **One fix round.** The fixes are compiled and measured again. A fix that makes a gate fail or lowers the pick score is
  reverted, and no role is asked again about that clip. A fix that needs a new seed or length runs the seed search here: the
  clip's template is planned again from its plan seed and five re-roll seeds until a plan meets the need. The planner keeps
  its own payoff band, so a payoff target outside it is rarely met, and the fix is then reverted.
- **Retries count.** A refused answer comes back with its errors. After 3 refusals in a row the rules answer for that role,
  labelled so. Every answer, a refused one too, spends a call of the app's budget (after a render two a clip), and once it
  is spent the rules answer the rest. At most 8 clips a studio; the panel stops once enough are kept and marks the rest
  "not reviewed".
- **Depth.** `quick` (the default) asks the reviewer only where something is in doubt; `thorough` asks every role about
  every clip; `rules` asks no role at all.

## After the render

Render v3 opens the fenced local export as a free visitor, sets the clip's settings and seed, loads its melody and exports
through the page's own fast export, at most 60 s. A clip the page reports as clean is refused and nothing is written. The
result has the page's world, the payoff planned and played, the clip's length planned and rendered, the melody planned and
played, the measured features and lagged frames, the sheets, and the clip's gates and scores after the render. render.json
keeps it all for the post-render review, which reviews only clips rendered from the clip as it stands now.

## In Claude Code: a subagent per role, and the make-video skill

`npm run studio:agents` (`scripts/studio-agents.mjs`) writes the Claude Code files from the crew's roles, so they never
drift from what the app asks. `tests/studioAgents.test.ts` fails while one is stale. The files are protected paths: a change
needs the owner's review.

- `.claude/agents/jbl-<role>.md`: one subagent for each of the six roles (researcher, brainstormer, skeptic, viewer,
  reviewer, producer). Each runs on the session's own model, in a context of its own. Each carries its role's card and answer
  shape word for word, and may call only the review tool of the project's MCP server
  (`mcp__jumpingballs-agent__review`). The viewer may also Read, for the two sheets it looks at after a render. A subagent
  fetches one brief, answers it and stops. The caller starts a fresh one for the next brief, so no clip is judged in another
  clip's context.
- `.claude/skills/jbl-make-video/SKILL.md`: the whole loop, which subagent plays which role, the rules (the watermark, no
  licence, `.agent-out/` only, one fix round, never push or post), and the role eval.

The subagents need the MCP server approved in Claude Code (`/mcp`). Without it, one conversation plays every role through
the CLI, and the record says so.

## The role eval

`review` with `"fixture":true` runs the crew's role eval on a generated corpus of clean and planted clips. It asks every
run's briefs, the cold viewer's first, and once every brief is answered it gives the numbers. `docs/agents/CREW-EVAL.md`
explains the corpus and the runs, and holds every recorded run.

## Claude Desktop and other MCP clients

The MCP server offers the studio tools and 7 prompts: `crew-researcher`, `crew-brainstormer`, `crew-skeptic`, `crew-viewer`,
`crew-reviewer`, `make-video` and `review-clip`. Their texts are the role cards of `src/lib/crew/roles.ts`, so the app and
Claude ask the same questions in the same words. A client that cannot read files gets a sheet as an image block from
`frames` or `preview` with `image`: one JPEG of at most 110,000 bytes, its base64 counted with the text against the
result's 200 KB. Without subagents, one conversation plays every role, and panel.json says so.

## A worked example

A real run on this branch (Claude Code playing every role in one context). The plan, in the page's world:

```text
plan {"count":3,"world":{"width":800,"height":450},"studio":"real-run","planSeed":21}
ep001-1-get-out-classic-1431990282  get-out-classic  17.7 s  escape at 16.1 s (91%)  Simple 97  Playbook 92  gates pass
ep001-2-count-multiply-184890734    count-multiply   21 s    fill at 17.9 s (85%)    Simple 97  Playbook 92  gates pass
ep001-3-fill-grow-1578788951        fill-grow        26 s    fill at 22.1 s (85%)    Simple 97  Playbook 92  gates pass
```

The review before the render, at Quick depth with three wanted:

```text
skeptic   ring escape    payoffLate, minor, evidence beats.payoff        -> confirmed (91% is past 90%)
reviewer  ring escape    keep, high: the objection accepted, no fix needed for a minor one
skeptic   multiply       hookMismatch, major, evidence words.hook + run.escape
                         ("every escape spawns 4 more balls", but the first escape comes at 11.2 s) -> opinion
reviewer  multiply       fix, medium: rewriteHook "One ball. How many by the end?" -> applied (the gates pass, the pick holds)
skeptic   growing ball   no objection -> kept without the reviewer
producer  three titles, captions with one question each, 6 hashtags each
decision  keeps: ring escape (95.1), multiply (92.1), growing ball (92.1)
```

The renders (35-63 s each on 4 CPUs):

```text
render {"plan":".agent-out/studio/real-run/plan.json","clip":"ep001-1-get-out-classic-1431990282"}
  world 800 × 450 (the plan's), payoff planned 16.1 s, played 16.1 s, length 17.7 s planned and rendered,
  melody canon-in-d played, watermarked, 1,060 frames, 0 lagged, sheet.png and hook-sheet.png written
render {"plan":".agent-out/studio/real-run/plan.json","clip":"ep001-2-count-multiply-184890734"}
  rendered as the crew left it (the rewritten hook), payoff 17.9 s planned and played, 21 s long,
  melody entertainer played, watermarked, 1,260 frames, 0 lagged
render {"plan":".agent-out/studio/real-run/plan.json","clip":"ep001-3-fill-grow-1578788951"}
  payoff 22.1 s planned and played, 26 s long, melody ode-to-joy played, watermarked, 1,560 frames, 0 lagged
```

The review after the render, each clip's sheets looked at first:

```text
viewer    ring escape    out, "A ball breaks out of spinning rings before the time is up.", clear by 2 s, would watch: yes
reviewer  ring escape    fix, low: reseedEarlyMotion offered (G1 fails on the measured motion; see Known gaps)
viewer    multiply       distractions ["the timer counts down, not the balls"] -> refused (a distraction is one of
                         the listed kinds); again: count, clear by 3 s, distractions [hud] (not confirmed by the facts)
reviewer  multiply       fix, low: reseedEarlyMotion offered
viewer    growing ball   full, "A ball grows on every bounce until it fills the whole ring.", clear by 2 s,
                         distractions [effects]
reviewer  growing ball   the rules, by budget (2 calls a clip after a render, and the refused answer spent one): drop, G1
decision  keeps: none. Drops: ring escape 86.8, multiply 86.8, growing ball 87.6, all on G1
```

post.txt then holds each kept clip's words and the crew's lines, for example:

```text
## 2. One ball. How many by the end?

Clip: ep001-2-count-multiply-184890734 · count-multiply (multiply) · reels · standard · resolved · seed 184890734
Hook on screen: One ball. How many by the end?
Title: One ball. How many by the end?
Caption: Every ball that escapes comes back as four more. …
Crew before the render: fix (medium), fix applied (rewriteHook), Simple 97, Playbook 92
Crew after the render: fix, the viewer read "count" (makes sense: yes), would watch to the end: yes, fix offered
(reseedEarlyMotion): plan it again to make the fixed version, Simple 92, Playbook 92
```

All three clips read as planned, and all three fail G1 after the render: the first gap below, which the owner decides.

## Known gaps

- **G1 after a render.** The measured first motion comes from the export's 16 × 16 thumbnails with the analyser's 0.02
  threshold. In the calm Simple look the frames move from the first quarter second but stay under it (0.005-0.017), so most
  Simple clips fail G1 after the render although their first sound comes at 0.2-0.7 s (the worked example: all three). The
  post-render review then asks the reviewer to fix or drop a clip that starts well. This is the crew's gate
  (`src/lib/crew/clarity.ts`), not the studio's, and changing it is the owner's call.
- **The page's world.** The headless page is 800 × 450; the planner's default world is 800 × 600. Plan in the page's world.
- **Lengths.** The planner estimates a clip's length; the page's own end of the run can differ (a Ball Drop clip rendered
  17 s against 18 s planned). render reports both.
- **The eval runs no planner.** In the role eval, a fix that needs the seed search is reverted (`docs/agents/CREW-EVAL.md`).
  The studio's own review runs that search.
