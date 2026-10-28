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

Everything lands in `.agent-out/studio/<studio>/`, which git ignores. Outside the repository, `render` builds the site's
export in the agent cache (`~/.cache/jbl-agent`, or `JBL_AGENT_CACHE`: several hundred MB) and the studio's tools keep their
bundle there, as AGENTS.md says.

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
| Producer | you | the kept clips, each with its scene and its numbers | the words to post, the hook locked to the drawn one, no number the clip does not have |

## The tools

| Tool | Use it to |
| --- | --- |
| `research` | Read the research brief, offline: the trend summary, the playbook and the local inspire dataset by its searches |
| `templates` | See the ten formats, all 48 modes' bindings and tiers, the ready templates with their words, the Simple look |
| `plan` | Plan clips with the bot's planner, deterministically, into a studio's plan.json |
| `review` | Play the crew's roles: take the next brief, answer it, get the next one or the decision |
| `render` | With `plan` and `clip`: render a planned clip as the crew left it, watermarked, with its melody and sheets |
| `score` | Score a link, or a studio clip as the crew left it (and as its render measured it) |
| `frames`, `preview` | With `image`: a sheet as one JPEG image block, for a client that cannot read files (`frames` with `"imageOf":"hook"`: the opening's sheet) |

Run them with `npm run -s agent -- <tool> --json '{…}'`, or over MCP (`jumpingballs-agent`). `docs/agents/CLI.md` has every
argument.

## The loop

1. `npm run -s agent -- research --json '{}'`: the brief. A weak finding is weak. When the trend summary is stale, `inspire`
   on a template's theme words refreshes the evidence first.
2. `npm run -s agent -- templates --json '{}'`: the ready templates. The battle family (Fight League names third-party
   characters) only when the owner asks for it.
3. `npm run -s agent -- plan --json '{"template":"get-out-classic","count":5,"world":{"width":800,"height":450},"studio":"rings"}'`.
   Plan in the page's own world, as here (the headless page is 800 × 450), or the clip plays another run than the one
   planned; render tells you when the worlds differ. Add `"platform"` (`reels`, `tiktok` or `shorts`; default reels) for
   the platform asked for. The crew reviews 8 plans at most in one studio: plan more only to render them without it. For an
   open request, skip the plan and start the review with `"request"`, the same `"world"` and `"platform"`: the brainstormer
   pitches, and the review tool plans the ideas itself, in that world, for that platform.
4. `npm run -s agent -- review --json '{"studio":"rings","wanted":3}'`, then answer each brief with
   `{"studio":"rings","role":"…","clip":"…","verdict":{…}}` until the panel is done. The first call starts the panel and
   fixes how many clips it keeps: `"wanted"`, the clips asked for (default 3, at most the plans), on this route as on an open
   request. Plan two more than that, so the crew can drop one and still keep the count. Play each role in a context of its
   own where you can (in Claude Code, the `jbl-<role>` subagents of the `jbl-make-video` skill) and pass
   `"separation":"contexts"` when the panel starts; otherwise the record says the roles shared one context. A later call
   that names another `wanted`, `depth` or `separation` changes nothing, and its result says so.
5. `npm run -s agent -- render --json '{"plan":".agent-out/studio/rings/plan.json","clip":"…"}'` for each kept clip.
6. Look at each clip's sheet.png and hook-sheet.png, then review again with `"stage":"post"`: the viewer reads the clip from
   what is on screen alone, and the reviewer steps in where the rules, the read or the facts disagree. The panel after the
   render is its own, so every call of it keeps `"stage":"post"`, each next brief and each answer (a brief's `next.answer`
   has it); a call without it reaches the finished panel before the render, and its result notes that the other one waits.
   It keeps the separation the panel before the render started with, unless its first call names another, and post.txt
   says how each panel played its roles.
   A keep rendered later, or rendered again, joins the post-render panel on the next call and gets its own look. A fix the
   reviewer offers there is never applied to the rendered clip: `render` with `"fixed":true` (the review's `fixed` lists the
   calls) makes it as a clip of its own, `<clip>-fixed`, and the next post-render call looks at it like any rendered clip.
7. Hand over the studio folder: the clips, panel.json and post.txt. The owner approves every post. Every clip's watermark
   draws the live site's domain, jumpingballslive.com (the toolbox builds its export with it), and every plan's share link
   opens the live site; gate G8 refuses a render whose watermark draws an address no viewer can open, such as localhost.

## How the review holds you to the rules

- **One brief at a time, in the panel's order.** An answer for another role or clip is refused and changes nothing.
- **The schema is the clip's.** Evidence is dossier keys only, written exactly. Fixes come only from the fixed list of nine,
  inside their bounds (a new hook has a word to read, at most 7 words and 42 characters, and only numbers the clip has, read
  as a viewer reads them: "1,000" is a thousand; invisible format characters are taken out). turnOff names only an effect,
  HUD or label the clip draws, and one that changes nothing on screen is refused. The reviewer may answer only the
  objections that still stand.
- **Facts first.** Each objection is marked confirmed, refuted (dropped, with the fact that refutes it in the log) or
  opinion (half weight, never a blocker, standing only at major or fatal). A confirmed objection cannot be rejected, and a
  clip that fails a gate is never kept. Nor can a viewer's misread (its makesSense no or partly): the reviewer accepts it,
  with a new hook or the other ending before a render, or drops the clip.
- **One fix round.** The fixes are compiled and measured again. A fix that makes a gate fail, lowers the pick score or
  leaves a confirmed major objection it answers still confirmed (a payoff still past 90 %, two texts still on screen at
  once) is reverted, and no role is asked again about that clip. A fix that needs a new seed or length runs the seed search
  here: the clip's template is planned again from its plan seed and five re-roll seeds until a plan meets the need, and the
  clip takes that plan's words with it (a new length is a new number in "Can it escape in 24 seconds?"): the producer reads
  them, and they are the post's when no producer answers. A
  retimed payoff must land on time (66-90 % of the clip), near the target, and no farther from it than an on-time payoff
  was. The planner keeps its own payoff band, so a payoff target outside it is rarely met, and the fix is then reverted.
- **Retries count.** A refused answer comes back with its errors (at most 8, each cut to 200 characters). After 4 refusals
  in a row (the first answer and its 3 retries) the rules answer for that role, labelled so. Every answer, a refused one too, spends a call of the app's budget (after a render two a clip), and once it
  is spent the rules answer the rest. A clip no model answered for (its skeptic, or after the render its viewer, refused
  until the budget ended or the role broke) is "not reviewed", rules only, never kept as seen. At most 8 clips a studio; the
  panel stops once enough are kept with a model's medium confidence or more, and marks the rest "not reviewed". A clip that
  fails a gate is dropped by the rules whether a model reached it or not, after the render too.
- **Depth.** `quick` (the default) asks the reviewer only where something is in doubt; `thorough` asks every role about
  every clip; `rules` asks no role at all. A clip only the rules weighed is never called looked at: its pick reason is
  `rules`, its record names no model, and post.txt and the review's `after` say "rules only".
- **Ideas.** An open request's brainstormer pitches up to 6 ideas, and at least one for each clip wanted (fewer when the menu
  has fewer templates): a reply with fewer is refused, since each idea is one candidate.

## After the render

Render v3 opens the fenced local export as a free visitor, sets the clip's settings and seed, loads its melody and exports
through the page's own fast export, at most 60 s. A clip the page reports as clean is refused and nothing is written. The
result has the page's world, the payoff planned and played, the clip's length planned and rendered, the melody planned and
played, the measured features and lagged frames, the sheets, and the clip's gates and scores after the render. render.json
keeps it all for the post-render review, which reviews only clips rendered from the clip as it stands now.

The fixed version. After the render the reviewer's fix is offered, never applied: `render` with `"plan"`, `"clip"` and
`"fixed":true` applies the offered fix to the clip as rendered (its look and words; for a new seed, ending or length the seed
search runs first, then the clip's rule fix and its fix before the render again) and renders it into `<clip>-fixed/`, with its
own sheets and render.json. The panel after the render looks at it on its next call, and post.txt lists it under its clip.
One fixed version a clip; a render of an offer the panel no longer makes is left out as stale.

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
  licence, results under `.agent-out/` and render's export in the agent cache, one fix round, never push or post), and the
  role eval.

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
result's 200 KB. The viewer needs both sheets of a rendered clip, one a call: the whole clip, `frames
{"path":"<the clip>","image":true}`, then its opening seconds, the same with `"imageOf":"hook"`. The post-render brief's
`look.pictures` holds the two calls for its clip, and the `crew-viewer`, `make-video` and `review-clip` prompts name them.
`crew-viewer` and `crew-reviewer` take `stage`: with `post` every call they name is the post-render panel's; without it
they say how to reach that panel. Without subagents, one conversation plays every role, and panel.json says so.

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

post.txt holds each clip's words and the crew's lines, for example (a title is one line and a caption is quoted, line by
line, so the model's words never start a line of their own):

```text
## 3. Every hit doubles the power.

Clip: ep001-1-smash-power-layers-799547072 · smash-power-layers (powerLayers) · reels · standard · resolved · seed 799547072
Hook on screen: Every hit doubles the power.
Title: Every hit doubles the power.
Caption:
> Every bounce hits twice as hard as the last, until the ball smashes out through 700 layers. …
Crew before the render: keep (medium), Simple 90, Playbook 96
Crew after the render: keep, the viewer read "break" (makes sense: yes), would watch to the end: maybe, Simple 90, Playbook 96
```

How the clips came out, judged plainly:

- **Pendulum wave.** A wheel of balls drifts apart, a progress bar counts up, and at 14 s every ball meets in the center,
  with "Back in line." under it. One text at a time; a stranger gets "wait for them to line up" by 3 s. But the hook's
  chord never comes: the recipe sounds a bob as it crosses the centre, and at the realignment every bob is at a turning
  point, so 14 s is the quietest moment of the clip (a 0.15 s dropout, then the same notes as before). The hook also says
  "15 pendulums" over a wheel of balls with no strings, and "Back in line." is a clump at the hub.
- **Ball drop.** Ten balls fall through pegs and every peg plays a note; it is the calmest clip on screen (Simple 97). Its
  payoff does not land: the last note sounds at 9.8 s, the audio is silent from 10.35 s to the end at 12.3 s, and "Final
  chord." appears at 10.5 s over a board that has stopped – the planner timed the payoff a second before the board counted
  as settled, but one ball rolled on, silent, for two more.
- **Power layers.** The hook, the layer counter and the break-out at 16.7 s make sense together, but the Simple look cut
  the hook to its rule, "Every hit doubles the power.", and dropped its goal, "700 layers to go.": after 2.5 s the only
  stake on screen is the mode's 16 px counter. The first 7 s barely move (700 to 685 layers), and the end shows "FREEDOM"
  twice, the caption and the mode's own banner.

None is a sure share. The crew kept all three, and every gate passed: no rule looked at the payoff's moment, and no role
hears a clip. And every frame of the three clips carried a watermark that read "localhost:3000", since the toolbox built
its export without the site's domain, with share links to localhost in plan.json.

**What review round 1 changed after this run** (findings 19-26; the clips above were made before it):

- The pendulum template sounds every bob at its turning points (`pwSoundOn` "extremes"), so all of them play one accented
  chord, with the mode's flash, at the realignment, and it hangs the pendulums in a row, so "Back in line." is a line. The
  same chord also sounds at the release and at half a cycle, when the bobs stand in two rows. The bot's own recipe is
  unchanged.
- The Ball Drop template times its payoff at the last ball's last note (the `lastNote` strategy) and cuts the clip at 85 %
  of it or at the run's own end, and its format draws no payoff words: the plan's onTheBeat payoff is "the drop or the last
  bar", and no words name a chord the mode never plays.
- The Simple look keeps the stake in a smash or count template's hook: Power Layers draws "700 layers to go.", the clause
  with the clip's own number, and the whole hook stays in the post.
- Gate G2 reads the run's payoff moment (`run.payoffMoment` in the dossier): a beat, or words that name a chord, need a
  sound there; words that name a chord need the mode's own chord; and no payoff may be silent and still. The bot's Drop
  Symphony and Pendulum Wave, as this run played them, now fail G2.
- The toolbox's export draws the live site's domain, studio plans link to the live site, and G8 refuses a watermark that
  draws a local address. render.json records the domain.
- The Simple look breaks a text of two lines where a reader would: at its clause ("15 pendulums." / "Wait for the chord.",
  "10 balls." / "Every peg is a note."), a size step or two smaller where only that fits, else evenly ("Every hit" /
  "doubles the power."), never with a last line of one or two words. The bot look keeps its own breaks.
- Each Simple text sits at the edge of the square its run leaves clear. The planner plays the chosen seed to the clip's end
  and notes where its balls move every half second (`run.action`, lib/bot/actionTrack.ts); a text moves to the bottom of the
  square when it would hide them there for at least 1 s less than at the top. Ball Drop's hook goes to the bottom, while the
  balls enter the board at the top, and so do Pendulum Wave's texts, whose short pendulums swing under the top band. The
  Simple score charges a text that hides the action where the other edge would not (textOverAction), the viewer's "text"
  distraction counts as confirmed then, and the oneTextAtATime fix places the texts the same way.

Rendered again after these changes (plan seed 1 of each template, in the page's world): the pendulum clip plays its
accented chord at its payoff, 21.05 s, after 0.2 s of quiet as every bob reaches its turning point – but not as its loudest
moment, as this guide first said: the same chord, as loud and as bright, plays at the release and at half a cycle (10.5 s),
and the steady stream of notes peaks above it. The Ball Drop clip's last note sounds at its payoff, 18.7 s: one faint note,
then 2.4 s of silence over a board at rest, and the mode's SETTLED! banner for the recorder's last 0.5 s. Both watermarks
read jumpingballslive.com, and every gate passed after both renders. Review round 2 (below) changed both templates.

**What review round 2 changed** (findings 19-23):

- The make-video skill says where the tools write: their results under `.agent-out/`, and `render`'s build of the site's
  export in the agent cache (`~/.cache/jbl-agent`, or `JBL_AGENT_CACHE`), outside the repository.
- The pendulum template's hook no longer promises a chord its run plays three times. No sound setting plays it at the
  realignment alone, so the hook asks the question the line answers, from the recipe's own copy in every language: "22
  pendulums. Do they line up?" (`hookAsk`). Gate G2 fails a hook that promises a chord when an accented event as large plays
  after the hook, before or after the payoff (Outdone: `run.payoffMoment` keeps the run's other accented events).
- Ball Drop's template is hidden, with its reason: its run fades out. Its last note is a lone faint tick over a board at rest,
  then silence until a SETTLED! banner the recorder shows for 0.5 s, and no moment at 80–90 % of the clip lands. G2 now judges
  a beat's payoff still when the balls barely move and it plays only lone notes, fewer than the run's usual moment (not only
  silence). A clip that ends without words fails G2 when it ends on more than 1.5 s of silence over still balls (DeadTail).
- The Simple look draws a counter caption only where the format takes one and it counts what happens: the walls broken. A bar or
  a timer counts the recording's seconds, so one text at a time took it off at the payoff ("84 %" as the pendulums line up,
  "0:04" as Ball Drop's last ball lands). Pendulum Wave, Polyrhythm, Grow and Clone per pass now let the picture count, and give
  up the checklist's 10 countdown points. The format table (`countdown`) is what the planner reads, and the oneTextAtATime fix
  drops a bar or a timer instead of cutting it short. G4 fails one that leaves more than 1 s before its end (CounterCut).
- Power Layers' Simple hook keeps its rule, "Every hit doubles the power.". The mode's own counter shows the layers left from
  the first frame, while +1, Fibonacci and doubling all start with hits of a layer or two. A cliffhanger's "One more hit?"
  hangs on that rule. Only where no HUD counts the stake down does a smash or count hook keep its number. A Simple
  cliffhanger's post asks the question the clip ends on.

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

## The step's acceptance run

The same open request again, after review round 2: "Three simple, satisfying clips for Reels that make sense to a stranger,
each a different kind of payoff, with few distractions." World 800 × 450; Claude played every role in one conversation, so
the record says "same context". Everything is in `.agent-out/studio/acc-real/`.

The brainstormer pitched six ideas: Ring Escape, Power Layers, Polyrhythm, Multipliers, Glass and Pendulum Wave.

Before the render (Quick, 7 calls):

```text
skeptic   ring escape   payoffLate, major (beats.payoff: escape at 95 % of 28.4 s)        -> confirmed
reviewer  ring escape   fix (medium): retimePayoff 0.85 -> seed search: 23.8 s, escape at 21.4 s (90 %), applied
skeptic   power layers  notShareable, major -> opinion; tooBusy, minor -> refuted (one text beside the HUD it keeps)
reviewer  power layers  keep (medium): the break-out is the template's payoff
skeptic   glass         endingConfusing, minor -> opinion, does not stand                  -> keep; three kept: stop
producer  the three clips' words; the ring escape's brief reads its re-planned plan ("24 seconds")
```

The renders: all three played their payoff at the planned second and ran their planned length. Each was watermarked
jumpingballslive.com, played its melody, had 0 lagged frames and passed every gate.

After the render, the viewer looked at each clip's two sheets first:

```text
viewer    ring escape   out, clear by 2 s, [effects] (confirmed: the camera), maybe       -> reviewer keep (medium)
viewer    power layers  break, clear by 3 s, [text, nothingHappens] (text confirmed), maybe -> reviewer keep (medium)
viewer    glass         break: the claim is out, so makes sense: no                       -> reviewer fix, offered:
                        rewriteHook "Can Gerald smash his way home?", made as its own clip (render "fixed")
viewer    glass, fixed  out, clear by 2 s, [text], yes                                     -> reviewer keep (medium)
```

What the run showed:

- **Fixed in this step.** The producer's brief for the re-planned ring escape still carried the old plan's caption, "Can it
  escape in 29 seconds?". It also listed 29 among the clip's numbers. A re-planned clip now takes its plan's words with it.
- **Known gaps** (below), noted and not fixed:
  - Glass's hook is drawn over the mode's STAGE banner.
  - post.txt counts a clip whose fix is offered among the keeps, beside its fixed version ("4 kept of 4 rendered").
  - The fixed version keeps the producer's title that was written for the clip before its fix.

## Known gaps

- **Text over a mode's own banner.** The Glass template's hook sits at the top of the square for its first 2.5 s. The
  mode's STAGE 1 and STAGE 2 banners are drawn under it at the same time, and the acceptance run's viewer named the text. The
  Simple look places a text by where the balls move, not by the mode's banners. G5 checks Top Text over a scoreboard band
  only, not a caption over a banner. As with the finish banners below, a fix would move the template's plans and Simple
  scores, so it waits for the owner.
- **A fix offered after the render.** The clip as rendered keeps its place among the keeps beside its fixed version: post.txt
  lists both, with the viewer's read of each, and the owner picks. The producer does not run after a render, so the fixed
  version keeps the title and caption written before the fix. Its hook on screen is the fixed one, and post.txt shows it.
- **Two endings at once.** Some modes draw their own finish banner: Power Layers' "FREEDOM! 10 hits · 16.7s". The template's
  payoff caption ("FREEDOM 🌈") shows beside it. Neither the Simple score nor the screen view knows these banners. A fix would
  change the plans or the Simple scores of every such template, and with them the role eval's corpus and its recorded run.
  The owner should first choose which of the two stays. (Ball Drop's template, which drew no payoff words, is hidden.)
- **The pendulum's other chords.** With every bob sounding at its turning points, the realignment's chord also sounds, as
  loud and as bright, at the release and at half a cycle, and half of it at each quarter. Only the realignment has the line.
  The hook promises the line, never the chord; the payoff's "🎼" names the music, and G2 asks it to play an accented chord
  there, which it does.
- **Payoffs the settings time.** Power Layers, Pendulum Wave and Polyrhythm time their payoff from the settings, so the
  planner stops simulating after the first impact. Their dossier then says "no first escape in the run" and "no finish in
  the run" beside a payoff at 16.7 s. The evidence check refutes a payoffMissing on them, but a model reads the two lines as a
  contradiction. The run's payoff moment (`run.payoffMoment`) is read on its own run to the payoff, so it shows what they play
  and how they move there.
- **Texts inside the square.** The canvas draws every caption inside the exported square, so a Simple text can take only its top
  or its bottom edge. Where the action fills the square, some text still hides some of it: Ball Drop's texts (its recipe in the
  Simple look), while the balls enter at the top and pile up at the bottom. The free band above the square (22 % of a 9:16 frame
  when there is no Top Text) would hide nothing, but drawing captions there is a renderer change in hub files (Canvas.tsx, the
  recorder's frame, the fast export) that needs tier 2. The owner should decide it.
- **A countdown to the payoff.** A bar or a timer counts the recording's seconds (lib/captions.ts), so the Simple look draws
  none: the picture or the mode's HUD counts instead, and the picture gives up the checklist's 10 countdown points. A counter
  that ends at the payoff would change the caption's link form and the renderer (settings.ts, the hub files), which needs tier
  2: the owner should decide it. The bot look keeps its counters, on to the clip's end, as tests/bot.test.ts pins its plans.
- **Ball Drop.** Its template is hidden until a payoff that lands. The beat format has no ready template in this release;
  the later bindings (Beat Drop, Beat Machine, Vortex) are its candidates.
- **The cinematic camera.** Its zoom shows the canvas's lighter box for a moment. The Simple look keeps the camera because its
  slow motion moves the run in several modes.
- **The page's world.** The headless page is 800 × 450; the planner's default world is 800 × 600. Plan in the page's world,
  on both routes (`plan`'s and an open request's `world`). render reports the page's world and says when they differ.
- **Lengths.** The planner estimates a clip's length; the page's own end of the run can differ (a Ball Drop clip rendered
  17 s against 18 s planned). render reports both.
- **The eval runs no planner.** In the role eval, a fix that needs the seed search is reverted (`docs/agents/CREW-EVAL.md`).
  The studio's own review runs that search.
