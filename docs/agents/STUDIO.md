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
   `"request"` and the same `"world"`: the brainstormer pitches, and the review tool plans the ideas itself, in that world.
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

After the render, gate G1 reads the clip's first impact as the Playbook score reads the same file: its first motion or its
first sound, the earlier. The picture alone misses a small ball on the Simple look's dark background. The export measures
motion on 16 × 16 thumbnails against the analyser's threshold, and in the worked example below a Power Layers clip measured
its first motion at 7.5 s while its first bounce was heard at 0.83 s. A Ball Drop clip never crossed the threshold at all. The
dossier shows both numbers (`measured.firstMotion: 7.5 s (first sound 0.8 s)`).

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

A real run on this branch, as the owner would ask for it: an open request, three clips wanted, Claude Code playing every
role in one conversation (this session had no subagent tool, so the record says "same context"). Everything is in
`.agent-out/studio/simple-three/`: plan.json, panel.json, post.txt and a folder per rendered clip with its frames and sheets.

```text
review {"studio":"simple-three","wanted":3,"world":{"width":800,"height":450},
        "request":"Three simple, satisfying clips for Reels, each a different kind: something that breaks,
                   something on the beat, something that lines up."}
```

The brainstormer read the menu (each template with its hook's words) and pitched six ideas, one each on Power Layers, Ball
Drop, Pendulum Wave, Glass, Polyrhythm and Multipliers. The review tool planned them in the page's world, plan seeds 1 to 6:

```text
ep001-3-line-up-pendulum-1147647781   16 s    payoff at 14 s (88%)     Simple 97  Playbook 96  gates pass
ep001-5-line-up-polyrhythm-350413613  18 s    payoff at 15.5 s (86%)   Simple 97  Playbook 96  gates pass
ep001-2-on-the-beat-drop-1957595456   12.3 s  payoff at 10.8 s (88%)   Simple 97  Playbook 94  gates pass
ep001-1-smash-power-layers-799547072  19 s    payoff at 16.7 s (88%)   Simple 90  Playbook 96  gates pass
ep001-4-get-out-glass-337905923       22.3 s  payoff at 20 s (90%)     Simple 90  Playbook 96  gates pass
ep001-6-count-multipliers-1749420188  15.2 s  payoff at 12.7 s (84%)   Simple 88  Playbook 94  gates pass
```

The review before the render, at Quick depth, in rule-rank order (7 calls):

```text
skeptic   pendulum      no objection                                   -> keep (medium), no reviewer needed
skeptic   polyrhythm    sameAsOther, major, evidence others + clip.claim -> opinion
reviewer  polyrhythm    drop (medium): a second drift-then-line-up clip next to the pendulum one
skeptic   ball drop     no objection                                   -> keep
skeptic   power layers  no objection                                   -> keep; three kept: stop
producer  three titles, captions ending on one question with the series line, 6 hashtags each
decision  keeps: pendulum (93.9), ball drop (93), power layers (90.7); glass and multipliers not reviewed (enough)
```

The renders, all in the planned world (29-66 s each on 4 CPUs, the first one with a 20 s export build): the payoff played
at the planned second and the clip ran its planned length on all three, each watermarked, with 0 lagged frames. Measured
first motion: 0.25 s, none, 7.5 s. First sound: 0.15 s, 0.87 s, 0.83 s. Every gate passed after the render.

The review after the render. The viewer looked at each clip's sheet.png and hook-sheet.png first (4 calls):

```text
viewer    ball drop     beat, "Ten balls fall through pegs and every peg they hit plays a note", clear by 2 s,
                        distractions [text], would watch: maybe          -> keep
viewer    pendulum      inSync, "Balls on the spokes of a wheel drift out of step, then all meet at once", clear by 3 s,
                        distractions [background], would watch: yes      -> keep
viewer    power layers  break, "A ball smashes down through rainbow layers, faster every hit, then breaks out",
                        distractions [text] (confirmed: two texts at once), would watch: maybe
reviewer  power layers  keep (medium): the first 7 s move little and FREEDOM shows twice at the end; no listed fix
                        removes either
decision  keeps: all three
```

post.txt holds each clip's words and the crew's lines, for example:

```text
## 3. Every hit doubles the power.

Clip: ep001-1-smash-power-layers-799547072 · smash-power-layers (powerLayers) · reels · standard · resolved · seed 799547072
Hook on screen: Every hit doubles the power.
Title: Every hit doubles the power.
Caption: Every bounce hits twice as hard as the last, until the ball smashes out through 700 layers. …
Crew before the render: keep (medium), Simple 90, Playbook 96
Crew after the render: keep, the viewer read "break" (makes sense: yes), would watch to the end: maybe, Simple 90, Playbook 96
```

How the clips came out, judged plainly:

- **Pendulum wave**, the best of the three. A wheel of balls drifts apart, a progress bar counts up, and at 14 s every ball
  meets in the center on a chord, with "Back in line." under it. One text at a time; a stranger gets "wait for them to
  line up" by 3 s. Weak spots: the hook says "15 pendulums" over a wheel of balls with no strings, and the camera's zoom
  shows the canvas's lighter box for a moment.
- **Ball drop.** Ten balls fall through pegs and every peg plays a note; it is the calmest clip on screen (Simple 97). Its
  payoff is the weakest: the balls just come to rest. The timer counts down the recording, not the payoff, so "Final
  chord." replaces it at 0:03. The last 1.5 s show two texts, "Final chord." and the mode's own "SETTLED!".
- **Power layers.** The hook, the layer counter and the break-out at 16.7 s make sense together. The first 7 s barely move
  (700 to 685 layers): doubling starts slow, and many viewers would scroll before it gets going. The end shows "FREEDOM"
  twice, the caption and the mode's own banner.

All three make sense and are simple on screen; none is a sure share. The crew kept them for the right reasons and named
their weak spots. What it could not fix comes from the modes and the templates themselves (see Known gaps).

**What the run showed, and what this step fixed** (a first pass, in `.agent-out/studio/s6-run/`, ran on the code before
these fixes):

- An open request's ideas were planned in 800 × 600 and rendered in the page's 800 × 450, a different run than the one the
  crew had judged. `review` now takes `world` for a request, keeps it for the panel, and the skill and the make-video prompt
  pass the page's world on both routes.
- After the render, every Simple clip failed G1 on the thumbnails' motion although its first bounce was heard within a
  second. G1, the skeptic's slowStart check and the Simple score's measured term now read the export's first impact, its
  motion or its sound, as the Playbook score already did.
- With three other candidates and two research lines, the dossier cut the hook to 20 characters ("15 pendulums. Wait …"),
  the one line the skeptic judges a hook by. The clip's own words now stay whole; the other candidates and the research are
  cut first.
- The cold viewer read "15 pendulums side by side" for a wheel of balls, and "one ball under a stack" for a ball bouncing on
  top of its layers. The scene line now follows the pendulum's layout and the layer stack's side.
- The brainstormer saw each template's hook as the letter "a". Its menu now shows the hook's words.
- The research digest offered a table's head row ("| | Bot look | Simple look |") as a playbook source. Table rows are
  left out.

The role eval's recorded run was carried over to the changed briefs (`docs/agents/CREW-EVAL.md`): nine briefs changed and
were answered again, and the numbers did not move.

## Known gaps

- **Two endings at once.** Some modes draw their own finish banner: Power Layers' "FREEDOM! 10 hits · 16.7s" and Ball Drop's
  "SETTLED! All 10 balls at rest". The template's payoff caption ("FREEDOM 🌈", "Final chord. 🎹") shows beside it. Neither
  the Simple score nor the screen view knows these banners. A fix would change the plans or the Simple scores of every such
  template, and with them the role eval's corpus and its recorded run. The owner should first choose which of the two stays.
- **Every mode's HUD flags under turnOff.** The reviewer's "turnOff may name" lists every HUD flag that is on in the settings
  (sbHud, tyHud …), even on a clip whose mode draws none of them. A turnOff on one of those changes nothing, so this is noise,
  not harm. Narrowing it would change the reviewer's brief on every eval clip (125 recorded answers).
- **Payoffs the settings time.** Power Layers, Pendulum Wave and Polyrhythm time their payoff from the settings, so the
  planner stops simulating after the first impact. Their dossier then says "no first escape in the run" and "no finish in
  the run" beside a payoff at 16.7 s. The evidence check refutes a payoffMissing on them, but a model reads the two lines as a
  contradiction.
- **A countdown that is not to the payoff.** Ball Drop's timer counts down the recording, so it reads 0:03 when the payoff
  replaces it. This is the bot recipe's own countdown, and tests/bot.test.ts pins the bot's plans.
- **The cinematic camera.** Its zoom shows the canvas's lighter box for a moment. The Simple look keeps the camera because its
  slow motion moves the run in several modes.
- **The page's world.** The headless page is 800 × 450; the planner's default world is 800 × 600. Plan in the page's world,
  on both routes (`plan`'s and an open request's `world`). render reports the page's world and says when they differ.
- **Lengths.** The planner estimates a clip's length; the page's own end of the run can differ (a Ball Drop clip rendered
  17 s against 18 s planned). render reports both.
- **The eval runs no planner.** In the role eval, a fix that needs the seed search is reverted (`docs/agents/CREW-EVAL.md`).
  The studio's own review runs that search.
