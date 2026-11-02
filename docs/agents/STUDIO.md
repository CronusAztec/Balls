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
| post.txt | The kept clips' words to post (title, caption, hashtags) with the crew's lines before and after the render; a clip and its fixed version count as one keep there |
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
| `templates` | See the ten formats, all 48 modes' bindings and tiers (a binding that waits says why: `waits`), the ready templates with their words, the Simple look |
| `plan` | Plan clips with the bot's planner, deterministically, into a studio's plan.json: a template by its id, a mode's ready templates, or one of each format first |
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
   The clip and its fixed version are one clip in two versions: the review's decision keeps them as one (`versions` names
   both) and post.txt counts them once, so the owner picks the version to post.
7. Hand over the studio folder: the clips, panel.json and post.txt. The owner approves every post. Every clip's watermark
   draws the live site's domain, jumpingballslive.com (the toolbox builds its export with it), and every plan's share link
   opens the live site; gate G8 refuses a render whose watermark draws an address no viewer can open, such as localhost.

## Every mode's templates

`src/lib/bot/templates.ts` binds each of the 48 modes to one of ten formats. A format promises one thing the run must
visibly do, its claim (G4 and the viewer check it): get out, smash, fill, count, who wins, aim, line up, on the beat, reveal
and Mode Lab game. A binding whose own hook and payoff promise another thing claims that instead (`ModeBinding.claim`,
`templateClaimOf`): the conveyor, whose hook asks whether its stated balls all get out, claims out. 34 of the 48 bindings are ready, as 43 templates. A template's id is `<format>-<mode>[-<variant>]`, and its clips'
files carry it. `plan` takes one by its id, a mode's ready templates with `"mode"`, or, with neither, one of each format
first. The `templates` tool has each template's words in one locale; a binding that waits has its reason (`waits`: an
experimental one's measured reason, a proven one's hidden variants with theirs), and `plan` refuses its mode or a template's
id with it.

Who wins is the battle family: the arenas, the races and Fight League, whose fighters are third-party characters. Its 10
templates are offered only when that family is asked for (`"family":"all"` or `"battle"`), and only when the owner asks for
it: `plan` refuses one named by its id, its mode or its recipe without it, as `viral-bot.mjs --template` does. The default
menus offer the other 33 templates, as the daily bot leaves its battles out. The bracket is ready for the website's Bot
section, which plans and renders long clips, but not in the studio: it fills the long length only (60–90 s), and render plays
60 s at most. `viral-bot.mjs` renders no template: `viral-bot.mjs --dry-run --template <id>` plans one, and its daily
rotation renders the bracket's recipe, in the bot look, only when it is asked for long clips and the battle family
(`viral-bot.mjs --bucket long --family all`, or `battle`). The
listing names it with that reason (`notInStudio`), and the brainstormer's menu and `plan` leave it out (the mode route plans
Fight League's other three): `plan` covers 42 of the 43 ready templates. Since the studio2 review's second round (18) the studio keeps
every clip to the lengths render plays: the brainstormer's menu offers each template its short and standard lengths only, the
panel drops a planned clip past 60 s before any role looks at it (`tooLong`, the plan route's `"bucket":"long"` included), and
the reviewer's `changeLength` names short or standard only (`maxClipSec` on the panel, `RENDER_MAX_SEC`).

| Format | Mode | The payoff | Ready templates | Waits, and why |
| --- | --- | --- | --- | --- |
| get out | Classic | the first escape; the one ring's first ring (`outcome` ring-at) | `get-out-classic`, `get-out-classic-gerald`, `get-out-classic-ring` | |
| | Accumulation | the first escape, cut before it | `get-out-accumulation` | |
| | Portal | the first escape, cut before it | `get-out-portal`, `get-out-portal-gerald` | |
| | Shatter | the first escape (`outcome` escapes-at), cut before it; its rings turn at a fifth of the mode's speed | `get-out-shatter` | |
| | Color Match | the first escape (`outcome` escapes-at), cut before it | `get-out-color-match` | |
| | Glass Smash | Gerald home | `get-out-glass` | |
| | Journey | HOME, its overlay off in both looks (`journeyHud`) | `get-out-journey` | |
| smash | Target | the last segment, cut before it; its texts at the edge clear of the segment to hit next | `smash-target` | |
| | Power Layers | the break-out the settings time | `smash-power-layers` | |
| | Brick Smash | the picture's last brick (`outcome`, a run of its own); its settle held past the clip's end, so the picture never flies back in under its words; its bricks' count under the box is its countdown | `smash-brick-rebuild` | |
| | Spiral Glass | GLASS CLEARED, its overlay off in both looks (`sgHud`); its hook asks what the banner answers | `smash-spiral-glass` | |
| fill | Paint | | | `fill-paint`: its run ends at its fill, shown 0.5 s (G2) |
| | Grow | the measured fill, in the short length only (a standard clip often found no fill in time), at its fastest growth; no trails or glow on a ball the ring's size | `fill-grow` | `fill-grow-fills`: the fill that ends the run, shown 0.5 s (G2) |
| | Perfect Fit | | | `fill-perfect-fit`: its box is full for its 0.15 s flash only, then bursts (G2) |
| count | Multiply | the measured fill | `count-multiply` | |
| | Multipliers | the run's finish | `count-multipliers` | |
| | Conveyor Belt | ALL OUT! and its chord, the last ball out (its mark); its hook states its own count, its post asks whether they all got out, so it claims out, not count (`ModeBinding.claim`) | `count-conveyor` | |
| | Merge Ring | | | `count-merge-ring`: its own question under the ring for the whole run |
| who wins (battle family) | String Battle | the winner | `who-wins-string-battle` | |
| | Square Racing Grand Prix | | | `who-wins-race`: its 3-2-1-GO opens the gate at 1.8 s (G1) |
| | Square Battle Royale | the last one standing | `who-wins-battle` | |
| | Capture the Flag | the board's verdict | `who-wins-ctf` | |
| | Territory | the winner (`outcome`), cut before the verdict | `who-wins-territory` | |
| | Maze Escape | the first one out (`outcome`, a run of its own) | `who-wins-maze` | |
| | Fight League | the KO, or the champion | `who-wins-fight-league`, `who-wins-fight-league-upset`, `who-wins-fight-league-bracket` (the website's only: long, past render's 60 s), `who-wins-fight-league-boss` | |
| | Land Claim | the winner (`outcome`) of two sides, cut before the verdict where one leads by a tenth of the land | `who-wins-land-claim` | |
| aim | Bouncing Shapes | | | `aim-box`: its payoff, the first shape at zero, is drawn faded while the other bounces on bright |
| | Paddle Keep-Up | | | `aim-paddle`: its score band sits under the hook |
| | Bullseye | the first BULLSEYE! (its mark) | `aim-bullseye` | |
| line up | Pendulum Wave | the realignment | `line-up-pendulum` | |
| | Metronomes & Polyrhythms | all meet | `line-up-polyrhythm` | |
| | Double Pendulum Harp | the split (`outcome` diverges-at); its post asks when they split | `line-up-double-pendulum` | |
| | Bouncing Orbs | IN PHASE (`outcome` resolves-at) | `line-up-orb-grid` | |
| | Colour Sort | sorted (`outcome` sorted-by) | `line-up-colour-sort` | |
| | Chord Stars | every star closed (`outcome`, a run of its own) | `line-up-star-chords` | |
| | Spinning Hoops | every bead up (`outcome` all-up-by) | `line-up-hoops` | |
| | Focus Shot | every ball on the other focus (`outcome`, a run of its own) | `line-up-ellipse-foci` | |
| on the beat | Ball Drop | | | `on-the-beat-drop`: its looped rain's last 1.5 s play what the whole rain did (G2) |
| | Collision Playground | its anti-collision drop, at its setting's second (`fixed`); ten orbs, a bump a note, and a hook that says they will pass through | `on-the-beat-collide` | |
| | Beat Runner | | | `on-the-beat-runner`: its first note at 1.5 s (G1) |
| | Sound Vortex | | | `on-the-beat-vortex`: its own title in the corner for the whole run |
| | Beat Drop | | | `on-the-beat-beat-drop`: its own HUD under the hook |
| | Beat Machines | | | `on-the-beat-beat-machine`: its payoff note repeats a bar heard twice before (G2) |
| | Wave Tank | | | `on-the-beat-wave-tank`: its last 1.5 s play what every moment did (G2) |
| reveal | Lines | | | `reveal-lines`: its strings never make a picture |
| | Circle Illusion | | | `reveal-illusion`: no picture to guess, or one shown for 0.5 s |
| | Drawing Machines | the flower's last lines (`atEnd`) | `reveal-drawing-machine` | |
| Mode Lab game | Mode Lab | the game's finish rule (its mark) | `lab-game-blueprint` (Glass Hatchery), `lab-game-blueprint-ring-breaker`, `lab-game-blueprint-plinko-race`, `lab-game-blueprint-grow-escape` | `lab-game-blueprint-conquer`: the page's run parts from the planner's; `lab-game-blueprint-tier-climb`: no edge of the square is clear for its hook (G5) |

A template that wraps a playbook recipe speaks with the recipe's words; the others speak with their format's
(`ViralBot.formats`, `{thing}` the mode's noun), or with words of their own where the format's do not describe the run
(`ViralBot.ownHooks`, `ViralBot.ownPayoffs`), and a post of their own where the format's asks about something else
(`ViralBot.ownPosts`: its question and its hashtags). docs/virality-playbook.md §5 has every template's measured numbers and the
reason each hidden one waits.

### How a template times its payoff

The planner (`src/lib/bot/planner.ts`) times a payoff by its binding's strategy. Its seed search keeps a run whose payoff
lands at 80-90 % of the clip (up to 97 % for a run that ends a second after it), or cuts the clip before the payoff where
the run ends with it:

- The recipes' own: `escape` (the first escape), `winner` (the run's winner), `finish` (the run's own finish, or the moment a
  mode marks: Bullseye's first BULLSEYE!, the first shape at zero, the last ball out, a Mode Lab game's finish rule;
  `MARK_MODES`, its payoff a `hit` or a `gameOver`, and the dossier's `run.finish` the mark: "first BULLSEYE! at 14.8 s,
  the run goes on after it"), `fixed` (Power Layers' break-out, from its settings; since the studio's first review round Collision
  Playground's anti-collision drop too), `cycle` (the realignment Pendulum Wave's and Polyrhythm's settings time) and `fill`
  (the fill measured on the run).
- `outcome`: the seed finder's outcome around the payoff target, its moment read off the finder's own run of the seed
  (`src/lib/bot/outcomeStrategy.ts`). Six outcomes the finder searches over settings, not seeds, plan from a run of their own
  (`OWN_RUN_MOMENTS`): the template draws what the finder would search (Chord Stars' star set, Focus Shot's transit, Beat
  Machines' phrase, the vortex's waves, Brick Smash's picture, Perfect Fit's box), and the planner reads the seed's moment off
  its run. The Maze reads its first one out the same way. A binding's own settings switch on the option its outcome needs,
  such as the Double Pendulum's chaos fan (`OUTCOME_FLAG_SETTINGS`).
- `atEnd`: the clip's last 1.5 s, for a run that loops or has no moment to search. The seed changes nothing about the timing,
  the hook promises no event, and the clip ends resolved. A beat format's payoff must still stand out from the run (G2, since
  the studio's first review round): a looped rain or a steady scan does not, so no beat template takes it today.

### On the website

The Bot section (`src/components/simulator/sections/BotSection.tsx`) plans with the same templates and the same planner.
Its **Template** choice lists the chosen series' ready templates as "{Mode name} · {Format name}", grouped by format, a
further variant with its own name after it and each Mode Lab game with its game's ("Mode Lab · Lab game · Glass Hatchery"); the
battle family's appear only under All series and Battle. **Auto**, the default, keeps the daily rotation exactly, so the
daily bot's plans and its pinned days do not move. The **Simple look** switch is off there by default. The studio's
`plan` uses the Simple look unless `look` is `bot`. The app's crew and the autopilot are to use it too (the owner's answer),
once their own steps land; today the app's AI plans the playbook's recipes in the bot look
(`src/components/simulator/desktop/studioPorts.ts`). **Why this clip** shows a Simple clip's score and the crew's clarity
lines G1-G7, the studio's own `clarityOf` on the plan and its run; a clip in the bot look gets one line saying the rules judge
the Simple look (`clarityJudges`). A template switches its mode's own overlay off in both looks (the Journey's and Spiral
Glass's, a binding's `tune`): in the bot look, the website's default, the series label sat on Spiral Glass's question and the
hook on the Journey's stage banner (the studio's first review round, 9). `node scripts/viral-bot.mjs --dry-run --template <id> [--look
simple]` plans one template's clips in Node, a battle template only with the family all or battle.

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
- **The menu's order** (step 2's review round 1, 23). The brainstormer's menu lists the proven templates first, then, in
  each tier, the ones whose mode (or Mode Lab game) an advised theme of the trend summary names (`src/content/trends.json`:
  "escaping rings", "drops and piles" today), each line with its tier and that theme
  (`get-out-classic (getOut, proven, trending: escaping rings)`). The code's own ideas, when no model pitches, take the first
  template of each format in that order, and so does `plan` called with neither a template nor a mode. Trends advise the order and never gate a template; the owner's keep rates and post
  statistics are to rank it once the app's later steps record them.

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
One fixed version a clip; a render of an offer the panel no longer makes is left out as stale. The clip and its fixed version
are one clip in two versions, and the owner picks between them. The panel's own pick keeps both renders, so the studio
counts by clip (`postCount` in the studio kit): the review's decision keeps the pair as one entry naming both
(`versions`), adds `clips`, `renders` and `versions`, and its `after` line says so. post.txt counts the same way ("After
the render: 3 kept of 3 rendered clips … a model looked at all 4 renders. A clip and its fixed version count as one: … or
its fixed version …, the owner picks one."), and under the clip it adds "Pick one: … or …".

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
  square when it would hide them there for at least 1 s less than at the top, and the hook for less: whenever it hides any of
  them at the top and none at the bottom (the conveyor's first ball on its belt). Bullseye's dartboard lies along the bottom,
  so its texts stay at the top. Ball Drop's hook goes to the bottom, while the
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
  - Glass's hook is drawn over the mode's STAGE banner (fixed in AI studio step 3: below).
  - post.txt counts a clip whose fix is offered among the keeps, beside its fixed version ("4 kept of 4 rendered"). Fixed
    in AI studio step 8: below.
  - The fixed version keeps the producer's title that was written for the clip before its fix.

## Step 2's acceptance run

One Simple clip per format, ten formats, each from a template step 2 made ready where one was (in `.agent-out/studio/`, the
studios named acc2- and acc2b-): planned 3 a studio in the page's world (800 × 450), the panel started with `"wanted":1` at
Quick depth, Claude playing every role from its `.claude/agents/` file in one conversation (the record says "same context"),
rendered v3. The who-wins clip asked for the battle family (`"family":"battle"`) and took Territory, whose arena names no
one; no Fight League. Every render was watermarked jumpingballslive.com, played its payoff at the planned second (0 s off)
and its planned length, with 0 lagged frames, and passed every gate after the render.

```text
format     template (platform, locale)                  before      after the render (viewer's read)      Simple  Playbook
get out    get-out-shatter (reels, en)                  keep        keep (out)                            92      86
smash      smash-target (tiktok, en)                    keep        drop: misread (hit), rules            97      86
smash      smash-brick-rebuild (reels, en)              keep        keep (break)                          92      96
fill       fill-grow (shorts, pl)                       keep        keep (full)                           92      84
count      count-conveyor (reels, en)                   keep        drop: reviewer (out, claimed count)   91      82
count      count-conveyor, again after the fix          keep        keep (out)                            91      82
who wins   who-wins-territory (tiktok, en)              keep        keep (winner)                         97      86
aim        aim-bullseye (shorts, en)                    keep        keep (hit)                            90      86
line up    line-up-hoops (reels, en)                    keep        keep (inSync)                         97      86
on the beat on-the-beat-collide (tiktok, en)            keep        keep (beat)                           92      86
reveal     reveal-drawing-machine (shorts, es)          keep        keep (picture)                        97      86
Mode Lab   lab-game-blueprint-ring-breaker (reels, en)  keep        keep (gameRule)                       88      84
```

What the run showed:

- **Fixed in this run.** The briefs of the Conveyor, Bullseye and Ring Breaker had lost what the skeptic judges by: their
  intent view ran past its 1,400 characters, and the last resort cut every line to an even share of the whole, 34
  characters ("beats.end: 22.6 s, 2 s after the …"), leaving 291 characters unused. It now shares the room the short lines
  leave among the long ones (`clampLines`, tests/crewDossier.test.ts). And the conveyor's hook, banner and post say out
  while its format claimed count, so the cold viewer's honest "out" was a misread: a binding names its own claim now
  (`ModeBinding.claim`), and the conveyor's clip, the same clip again, was kept.
- **Known gaps**, noted and not fixed:
  - After the render the panel may make two calls a clip (`defaultCalls`), and a retry counts as one: the Target's viewer
    answered once too long (its line past 80 characters), so the reviewer had no call left and the rules dropped the misread
    clip without offering a fix. Room for a retry after the render is a change of the caps the owner set (cost).
  - A cliffhanger cuts before its claim happens: the Target's "Every hit counts. Will it break?" ends with the counter at 1
    and nothing broken, so a stranger reads the hits, not a break. The Brick Smash cliffhanger read as a break, its bricks
    falling all along.
  - The Double Pendulum's own hook ("Same start. Watch them split.") promises a split no claim names, under the line-up
    format's inSync; a cold viewer can answer notSure at best (makes sense: partly). Not run here.

## Known gaps

- **A mode's own texts.** Some modes draw texts of their own that no setting switches off. Merge Ring (AI studio step 4) asks
  "Will it merge into its final form?" under its ring for the whole run, beside its title, its merge count and its ladder of
  sizes. Its template passed every gate and was hidden after the render was watched (docs/virality-playbook.md §5). The
  Sound Vortex (AI studio step 5) writes a title of its own in the corner for the whole run ("why marbles speed up in a
  funnel"), and its template, which passes every gate, is hidden for it. Each could get a switch like the Journey's and
  Spiral Glass's (below, closed in step 4b): a drawn-only setting, so no run and no fingerprint moves. Perfect Fit labels its
  box ("4 × 15 / one of 368 ways") under it, where neither the Simple score nor the screen view sees it: its hook sits at the
  top, over the tray of pieces that wait still, never over the label. The Maze's banner keeps its deadpan line ("who else
  thought that was blood") under the winner's name though its template colours each ball's trail its own (watched: the line
  is the mode's, and the trail it jokes about is red only by default).
- **A HUD under the hook.** Paddle Keep-Up draws its score, lives and streak in a band over its ceiling, at the top of the
  square, and the canvas starts the top captions below a mode's top HUD only where the mode reports one (`modeTopHud` in
  Canvas.tsx; Paddle reports none). The Simple hook covers the score for its 2.5 s (watched in AI studio step 4), and at the
  bottom it would cover the paddle, so its template is hidden though its plans pass every gate. Reporting Paddle's band is a
  change of the hub file Canvas.tsx, with the planner's caption boxes (`captionBoxAt`'s `topHud`) to match: the owner's call.
  Beat Drop (AI studio step 5) is hidden the same way: its HUD at the top left of the square (BEAT DROP, the tempo, the
  landings on the beat, the bar's dots) sits under the hook for its 2.5 s, and no setting switches it off.
- **A held payoff** (the studio's first review round, 10). Perfect Fit fills its box, flashes it for 0.15 s and bursts it, and
  its page records whole loops, so its clip shows the full box for that flash only, its last second the pieces flying out and
  the next loop's tray. G2 now reads how long a payoff's state holds (`payoffHoldSec`: a box's completion to its burst) and asks
  0.8 s, as it asks of a payoff shown, so the template is hidden. A hold before the burst would bring it back: a drawn-only
  setting of the mode (its plan's timeline and loop length move with it, the fingerprint at the default does not), the
  owner's call.
- **A beat that drops** (the studio's first review round, 11). The beat format's payoff is the drop or the last bar, and G2 now
  asks it to stand out from the run before it (`beatStandsOut`: a quarter more sounds than the run's busiest moment, a larger
  chord, or an accent none before matched). Collision Playground's anti-collision switch does (a flash, ANTI-COLLISION, every
  orb a new colour, a 4-note accented chord), and its template is timed by it. Ball Drop's looped rain, the Wave Tank's bells,
  Beat Machines' phrase, Beat Drop's landings and the Sound Vortex's rings play their payoff as they play every other moment,
  so their templates are hidden. A setting that accents a run's last bar would give each a drop: a change of the mode's sound
  (its fingerprint where the sound feeds the run), the owner's call.
- **A fix offered after the render.** The producer does not run after a render, so the fixed version keeps the title and
  caption written before the fix. Its hook on screen is the fixed one, and post.txt shows it. (How the two versions are
  counted was fixed in AI studio step 8: below.)
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
  Simple look), while the balls enter at the top and pile up at the bottom. Tier Climb's hook (the studio2 review's second round,
  8) had no edge at all: the game's title block takes the top, where the rain falls and the first orbs merge, and at the bottom
  it hid the merges into 3 and 4 it describes. G5 now fails a hook the mode's own text pushes onto the action for more than half
  its samples (`hookPushedOverAction`), and the template is hidden. The free band above the square (22 % of a 9:16 frame
  when there is no Top Text) would hide nothing, but drawing captions there is a renderer change in hub files (Canvas.tsx, the
  recorder's frame, the fast export) that needs tier 2. The owner should decide it.
- **A countdown to the payoff.** A bar or a timer counts the recording's seconds (lib/captions.ts), so the Simple look draws
  none: the picture or the mode's HUD counts instead, and the picture gives up the checklist's 10 countdown points. A counter
  that ends at the payoff would change the caption's link form and the renderer (settings.ts, the hub files), which needs tier
  2: the owner should decide it. The bot look keeps its counters, on to the clip's end, as tests/bot.test.ts pins its plans.
- **The page's run and the planner's.** The planner times a payoff on a Node run of the seed, and the page plays the same seed
  in the browser. Colour Sort's 160 touching balls parted between the two within seconds (AI studio step 5: the page sorted
  0.8–1.1 s before the plan's second, so the payoff's words came over the remix), so its template turns contacts off, and both
  runs then sort on the same frame. Another mode with many touching bodies could part the same way. render reports the
  payoff's second from the planner's run, not from the page's, so only the sheets show it (page stills at the plan's seconds,
  the `preview` tool, settle it). A check that reads the page's own moment is the owner's call. The Mode Lab's Colour Conquest
  (AI studio step 6) parted the same way: its 24 balls collide and convert each other, and rendered twice, its run ended 0.8 s
  after the plan's finish once and had two colours left at the clip's end the other time, so its ending never came. Its
  template is hidden with that reason. Glass Hatchery parts by less: rendered three times, its run ended 0.13 s before and 0.18
  and 0.58 s after the planned length, its SHELL CLEARED banner shown inside the clip each time (watched), so its template
  stays ready.
- **A reveal without a picture** (AI studio step 6). The reveal format's hooks ask a viewer to guess a picture. The Drawing
  Machine's orbits draw one (Earth and Venus's five-petal flower), and its template is ready; its default harmonograph draws a
  figure no viewer could name, so the template draws the orbits. It leaves the conjunction marks unjoined (`dmPentagram`
  off, a drawn-only switch): joined, five bright lines closed a five-pointed star in the orbit's circle over the flower, the
  picture a stranger saw first, which some read as an occult sign (the first review round of step 2, 14). Whether to post
  the star is the owner's call. Lines strokes a string from every bounce point to the moving
  ball, so its strings make a fan that follows the ball, never a picture, and Circle Illusion's lines and rings show their
  circle from the first second and line up every cycle. Both pass every gate and are hidden for it (watched). Illusion's
  white-spaces type hides a picture but shows it for the recorder's 0.5 s only, as its run ends. A Lines setting that keeps
  the strings between the bounce points, or an Illusion reveal held past the run's end, is a change of the mode (its
  fingerprint) and the canvas: the owner's call.
- **The cinematic camera.** Its zoom shows the canvas's lighter box for a moment. The Simple look keeps the camera because its
  slow motion moves the run in several modes.
- **The page's world.** The headless page is 800 × 450; the planner's default world is 800 × 600. Plan in the page's world,
  on both routes (`plan`'s and an open request's `world`). render reports the page's world and says when they differ.
- **Lengths.** The planner estimates a clip's length; the page's own end of the run can differ (a Ball Drop clip rendered
  17 s against 18 s planned). render reports both. A loop that closes inside the clip ends it on its seam, as the page's
  whole-loop export does (Perfect Fit since AI studio step 3; Chord Stars, Colour Sort and Beat Machines since step 5): their
  rendered lengths are the planned ones.
- **The eval runs no planner.** In the role eval, a fix that needs the seed search is reverted (`docs/agents/CREW-EVAL.md`).
  The studio's own review runs that search.
- **A silent hold after the payoff** (the studio2 review's second round, 12). A mode's own end banner holds 1.5-4.7 s before its run
  ends (Spiral Glass's GLASS CLEARED and Merge Ring's FINAL FORM 2 s, the conveyor's ALL OUT! 1.5 s, an arena's champion
  3 s), and its chord decays in well under a second, so these clips end on 1.5-4.7 s of silence under the banner. G2 accepts
  it where the payoff is heard and the banner gives the end words to read, and fails a payoff that plays nothing with silence
  after it (`payoffLandsSilentEnd`: the conveyor's ALL OUT! until it got its chord). A bed under the end, or a chord that rings
  through the hold, is a change of the tone generator and of the modes' sound: the owner's call.
- **A bracket longer than render** (step 2's review round 1, 20). Fight League's bracket plays seven bouts and fills the long
  length only: its 12 plans at 800 × 450 on TikTok, Reels and Shorts ran 62–88 s, the champion crowned 57–83 s in, and render
  plays 60 s at most (the page's `LINK_RENDER_MAX_SEC`). The studio leaves it out, and render's advice for a clip past 60 s
  names the lengths its template fills. A bracket of four in a standard clip would be a template of its own, planned, measured
  and watched like the others: not built yet. The other templates' long lengths stay the website's: the studio offers, keeps and
  fixes short and standard clips only (the studio2 review's second round, 18).
- **A pattern that flickers** (the studio2 review's second round, 14). Shatter's counter-turning rings flipped the whole disc from
  spokes to bricks 4.5 times a second, and no rule measured it: the post-render Simple score reads motion, not a moiré. The
  template turns its rings slower; a flicker measure in the post-render rules is not built.
- **A stopped shape drawn faded** (the studio2 review's second round, 17). Bouncing Shapes draws a shape that reached zero at 35 %:
  its template's payoff cannot be the brightest thing on screen while another shape bounces, and one shape ends the run at its
  zero. A setting for how a stopped shape is drawn would be a change of the mode: the owner's call.

## Gaps closed in AI studio steps 3 to 8 and the review round after them

- **Text over a mode's own banner** (AI studio step 3). The run's action track (`src/lib/bot/actionTrack.ts`) now
  records where a mode's own banner shows, every half second: Glass's "STAGE n" and the Journey's stage banner, with the
  camera these modes scroll. G5 fails a caption over such a banner (`readableOverBanner`), and the Simple look places a text
  at the edge where it covers the banner for less time, before it weighs the balls. Glass's hooks moved to the bottom of the
  square, so the role eval's four Glass clips changed (`docs/agents/CREW-EVAL.md`, run step3). Since AI studio step 6 the track
  also knows the Mode Lab's title block, the game's name and counters at the top left of the square (`labTitleBox`): watched,
  a game's first hook at the top covered it, so the Simple look puts each game's hook at the bottom. The banners the track
  knows are these three: a mode's other texts of its own are not in it (Known gaps, above).
- **The Journey's and Spiral Glass's own texts** (AI studio step 4b). Both were hidden in step 3 for what they draw of their
  own. A setting now switches each one's overlay off (`sgHud`, link `sghud=0`: its question over the spiral, its title, tiles
  left and progress ring; `journeyHud`, link `jshud=0`: the stage banners and names, the mini-map, the clock and the HOME!
  card), a switch in its mode's panel, on by default. Both are HUD flags (`HUD_FLAGS` in `src/lib/crew/hudFlags.ts`), so the
  Simple look turns them off as it does the others, and both are drawn only: the canvas reads them, the engine never sees
  them, so the run and every fingerprint are the same either way. Their templates are ready: Spiral Glass's hook asks the
  question its overlay asked and ends on its GLASS CLEARED, the Journey's asks "Will Gerald make it home?" and its payoff's own
  words say "Home! 🏠" where the card did.
- **Two endings at once** (AI studio step 4). Some modes draw their own finish banner: Power Layers' "FREEDOM! 10 hits
  · 16.7s". The template's payoff caption ("FREEDOM 🌈") showed beside it. Now the mode's banner stays and the Simple look draws
  no payoff words of its own beside it: one ending, one text. The banners are a table (`MODE_END_BANNERS` in
  `src/lib/crew/hudFlags.ts`): each mode's, when it shows (from the payoff, as Power Layers' FREEDOM!, or a set time before
  the run ends, as Fight League's champion card) and in words. `endBannersIn` times them on a plan; the planner leaves the
  payoff's words out where one comes in with the payoff, within 1 s (`ownEnding` in `assemblePlan`,
  `BANNER_WITH_PAYOFF_SEC`), the Simple score counts it as a text on screen (a "banner" overlay, never one the crew can
  remove), the screen view names it ("drawn on screen at the end"), and G2 reads it as words to end on where it covers the
  clip's quiet end (Ball Drop's SETTLED!, after seconds of silence, does not). The bot look keeps its payoff caption as
  before. Of the ready templates, Multipliers' Simple
  median moved from 89 to 90 and Fight League's from 89 to 89.5; the others kept theirs (docs/virality-playbook.md §5). The
  role eval's corpus changed with them (`docs/agents/CREW-EVAL.md`, run step4).
- **Ball Drop's faded run** (AI studio step 5). Its template loops the rain (`dropLoop`), so its notes never thin out and the
  clip's last 1.5 s, on a full board, are its payoff. The beat format had four ready templates: Ball Drop, Beat Machines,
  Collision Playground and Wave Tank. Beat Drop and the Sound Vortex wait for a switch for their own HUD and title (Known gaps),
  Beat Runner for a first note inside the first second: it runs a second before its first take-off. Since the studio's first
  review round only Collision Playground's is ready, timed by its drop (Known gaps: a beat that drops).
- **The hook its ending answers** (the studio's first review round, 8 and 12). Spiral Glass's hook asked the overlay's
  question, "Will the ball multiply?", which the badge's first x2 answered 44-51 % into the clip, and its ending, GLASS
  CLEARED, answered another: it asks "Can it clear all the glass?" now. The conveyor's asked "One ball. How many by the end?"
  over a belt that loads a ball every 2-3 s and multiplies nothing: it states its own count, "7 balls. Will they all get
  out?", and its ALL OUT! answers it. Both own hooks are in English, Polish and Spanish (`ViralBot.ownHooks`), and neither
  draws the format's payoff words beside the mode's banner, in either look.
- **Payoff words before the event** (the studio's first review round, 10). The Simple look floored a payoff's words to the half
  second, so they came up to 0.5 s before the event they name (Perfect Fit's "Full!" over a box with a gap, its last piece
  falling). They start at the event's half second or after it now, the one before only while they are still entering (at most
  0.2 s, half the caption's entrance: `simplePayoffHalf`), and a clip that leaves no line its 1.2 s after the event draws none.
  The bot look keeps its floor, its plans as they were.
- **A fix offered after the render, counted twice** (AI studio step 8). post.txt counted the clip as rendered among the keeps
  beside its fixed version ("4 kept of 4 rendered" for three clips). The clip and its fixed version are now one clip in two
  versions: post.txt says "3 kept of 3 rendered clips" with the 4 renders and names the pair, the review's decision keeps
  the pair as one entry naming both (`versions`), and the owner picks the version to post (After the render, above).
- **What the second review round of step 2 watched** (findings 7-12). Brick Smash's resolved clips ended inside its rebuild, the
  picture flying back in under "Smashed. 💥": its template holds the settle past the clip's end (`brickSettleSec`), G4 fails
  payoff words over a rebuild (`payoffUndone`), and the screen view names it and the bricks' counter under the box. Tier Climb's
  hook hid the merges it describes and is hidden (above). Collision Playground's 140 orbs played the sound's ceiling under "Every
  bounce is a note.": ten orbs now play 9-15 notes a second, its own hook says the switch is coming ("Bumps play notes. Then they
  slip through."), and G4 fails a beat played faster than 40 notes a second (`beatWashPerSec`). Land Claim asked "Who wins? 👇"
  over four sides level to 1-3 points: two sides that snowball now, cut only where one leads by a tenth of the land
  (`LC_LEAD_MIN`). Bouncing Shapes was posted as a trick shot, the conveyor's stated count asked for as a guess and the chaos fan's
  split tagged as a sync: their posts are their own (`ViralBot.ownPosts`), and the templates listing shows no payoff words where
  none are drawn. The conveyor's ALL OUT! came in silent: it plays its chord, and G2 fails a silent payoff the clip then ends on
  in silence. docs/virality-playbook.md §5 has the numbers.
- **What the second review round of step 2 watched** (findings 13-18). Grow's ball, the ring's size near its fill, laid its trail
  as wedges past the ring and its glow as a hard-edged box over the square: the Simple look draws a ball that fills its arena
  without either (`BALL_FILLS_ARENA_MODES`), and the template grows at its short length's fastest rate, so every plan finds its
  fill. Shatter's rings flipped from spokes to bricks four or five times a second: they turn at a fifth of the speed now. Brick
  Smash's count of its bricks under the box is its countdown, credited by the checklist (`hudShowsCountdown`). Target's hook and
  closing question sat over the very segment they asked about: the action track records a mode's stake (`stakes`, Target's
  segment to hit next), and the Simple look puts a text at the edge clear of it before it weighs the balls. Bouncing Shapes'
  payoff, a stopped shape the mode draws faded, stayed the dimmest thing on screen with a race hook and payoff words too
  (watched): hidden. And the studio planned and kept long clips its render cannot play: no more (above).
- **What the second review round of step 2 found** (findings 19-24). The numbers a mode's own counter draws were not among the
  clip's facts: Brick Smash's "900 bricks" and Spiral Glass's x1 to x7 badge. The run's action track now reads the counter
  (`COUNTER_MODES`), its first, last, least and most readings are the clip's numbers for a hook, a title or a caption
  (`counterNumbersOf`), the screen view says what it reads at the start and the end, and the badge is a HUD of Spiral Glass's
  own (`MODE_HUDS`). `plan` by a waiting template's id gives the reason its mode gives, an open request's plans link to the
  live site, and the bracket's refusal no longer sends anyone to `viral-bot.mjs` to render a template it only plans, in a
  dry run. docs/virality-playbook.md §5 has the numbers.
