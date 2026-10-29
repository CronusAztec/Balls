# Virality playbook: what makes the simulation accounts go viral

This is the research behind the **Viral video bot** (`scripts/viral-bot.mjs`, the Bot section of the simulator and
`src/lib/bot/playbook.ts`). It was compiled on 29 September 2026 from the public Instagram profiles and reel pages of
three accounts the owner asked us to study, two creator playbooks and two 2026 guides to the Instagram Reels ranking
signals. Claims are marked **[observed]** (seen on the accounts), **[sourced]** (stated by a guide, with the source) or
**[inferred]** (our reading; treat as a hypothesis to test).

## 1. The three accounts

| Account | Size (Sept 2026) | Format | What their hits look like |
|---|---|---|---|
| **project.jdm** | 381K followers, 716 posts, bio "I do math to take the edge off", link to full animations | polyrhythms and DVD-style bouncing shapes, pendulum waves, collision playgrounds, double pendulum harps, square races and battle royales; series with names ("Rhythm Theory", "DVD Rhythms", "Pocket Changes") and 10-minute YouTube versions | pendulum waves ("Another way to think about a pendulum wave", 84K likes; "a good ol' pendulum wave for your Friday", 95K likes) and a **"bouncing square deathmatch featuring 2 new contestants"** with 1,099 comments: recurring contestants make people root and argue **[observed]** |
| **the character-ball account** | 17.5K followers, 26 posts, bio "[the character] always escapes. Freedom lasts about 4 seconds. New struggles daily" | one character ball with a face, a new obstacle every day (glass, multipliers, conveyors, vortex, bullseye, splat barriers, moving exits), ASMR piano notes | the character and the daily "struggle" turn physics clips into a serial; the promise in the bio (always escapes, freedom lasts 4 seconds) is the hook and the payoff **[observed]** |
| **oddplayground** | 15K followers, 389 posts, bio "Tiny random simulations. Seeds, rules, chaos." | numbered balls in a ring cutting each other's "web" strings (Web Dominion / string battles), rainbow "it doubles every time" layer breakers, pong-wars territory battles with Vortex and Bomber powers, maze escapes; neon on black, a "FLASHING LIGHTS / THE END GETS INTENSE" badge, deadpan absurdist captions | two pinned hits carry the account: the string battle (347K likes, 10K comments) and "It starts tiny and gets out of control" (137K likes, 355 comments); most other reels sit at 60 to 300 likes **[observed]** |

Patterns that repeat across all three **[observed]**:

- **A rule you understand in one second.** Every clip states its rule in the first frames, either in the picture (numbered balls, a stack of layers, a maze) or as a text pill ("Each hit x2 the power", "new sound every level", "PICK A SIDE").
- **A countdown you can feel.** Lives on the balls, layers left, a percentage bar, a timer, rings left. The viewer always knows how close the payoff is.
- **Sound as the second hook.** Bounces play notes; the pitch rises with progress ("new sound every level"); project.jdm frames the whole thing as music theory.
- **The ending is the comment engine.** oddplayground regularly cuts before the result; the top comments are "why'd you not show the winner", "who won, white or blue?" and answer requests. project.jdm's deathmatch with named contestants drew 1,099 comments. Unresolved or contested endings drive replies and re-watches **[inferred from the comments]**.
- **Series and characters over one-offs.** Named series (Rhythm Theory #2), recurring contestants, a character with a bio-level promise (the character ball), daily variations of one mechanic.
- **Cadence.** oddplayground posted about one reel a day in late September 2026 (twelve reels between 22 and 28 September); the character-ball account promises "new struggles daily".
- **Vertical, neon on black, one arena centred**, with the top-left reserved for a warning or sound badge and nothing important in the bottom fifth where the platform UI sits.
- **Virality is hit-driven.** On oddplayground two reels out of 389 hold almost all the likes. The strategy that works is volume plus variation of one recognisable format, so that the occasional hit lands on a profile full of similar clips to binge **[inferred]**.

## 2. What the platform rewards in 2026

From creatorflow.so's "Instagram Algorithm 2026" (February 2026, updated September 2026) and clixie.ai's "4 ranking
signals" (June 2026). Where the two disagree both readings are given.

- **The three signals Instagram named** (Adam Mosseri, January 2025): **watch time**, **sends per reach** (DM shares) and **likes per reach**. Sends matter slightly more for viewers who do not follow you, likes slightly more for followers **[sourced: creatorflow]**. clixie.ai ranks DM shares above everything with watch-time-to-length ratio second **[sourced: clixie]**.
- **Watch time, not completion rate**, is the published signal; rewatches count through average watch time. Instagram publishes no 3-second cutoff; creators read an early drop as a weak hook **[sourced: creatorflow]**. Rules of thumb only: keep most viewers past 3 seconds, completion above 50 percent **[sourced: creatorflow, marked as rule of thumb]**.
- **Length.** Reels up to 3 minutes can be recommended to non-followers; 15 to 30 seconds usually completes best **[sourced: creatorflow]**. clixie.ai argues 7 to 15 seconds loops best and that completion falls after about 22 seconds (unsourced) **[sourced: clixie]**. The two creator playbooks want 60 to 90 seconds for TikTok Creator Rewards (unsourced) **[sourced: ballsimulator.com]**. Net: keep a clip as short as its idea allows, and make the long version a separate cut.
- **Sound off by default.** The first 3 seconds must work silent: a text overlay and a visual hook **[sourced: clixie]**.
- **Originality and quality.** Since 30 April 2026 accounts that repost others' content are removed from recommendations; blurry, low-resolution or watermarked video is excluded **[sourced: creatorflow]**. Content you designed and rendered counts as original.
- **Captions are search data** (since August 2026): natural keywords beat hashtag stuffing; 5 to 10 niche hashtags **[sourced: creatorflow, clixie]**.
- **Early velocity.** Creators treat the first 30 to 60 minutes as decisive; Instagram publishes no window. Reply to early comments; specific questions in the caption outperform "what do you think?" **[sourced: creatorflow, clixie]**.
- **Trial Reels** show a clip to non-followers first and can auto-share after 72 hours: use them to A/B hooks **[sourced: creatorflow]**.
- **Posting frequency.** A Buffer study: 3 to 5 feed posts a week more than doubled follower growth versus 1 to 2 **[sourced: creatorflow]**; the ballsimulator posts push 1 to 3 videos a day (unsourced); clixie warns that more posts do not help if each one loses first-hour velocity.

## 3. The recipe the bot follows

Ordered by how strongly the sources and the observations agree.

1. **Motion in frame one.** The ball is already moving toward its first impact; no slow build-up. The first impact happens inside the first second.
2. **A one-line rule on screen** for the silent viewer ("Every hit doubles the power", "4 lives each. Cut a string, cost a life", "Which colour takes the board?"), shown for the first 2 to 3 seconds and kept out of the bottom fifth and the right edge.
3. **A visible countdown to the payoff**: lives, layers left, walls left, a percentage bar or a timer.
4. **One payoff someone would send to a friend**: an escape, a shatter, a screen filled with balls, a last survivor, a board flipped by one bounce. Planned with the seed finder so it lands in the last 10 to 20 percent of the clip.
5. **Two endings, used deliberately**: resolved (payoff shown, clean loop back to frame one) for shares and re-watches, or cut-before-the-result (the "who won?" ending) for comments. The bot alternates and labels each clip so results can be compared.
6. **A note per bounce**, piano or xylophone by default, pitch rising with progress; a whoosh or fanfare on the payoff; no third-party audio.
7. **Length buckets per platform**: short 8 to 15 s, standard 15 to 30 s, long 60 to 90 s; the standard bucket is the default for Reels.
8. **Format**: 1080 by 1920, 60 fps, sharp, no watermark other than the site's own small one, action inside the safe zones.
9. **Neon on black, glow and trails**, one arena, the badge top-left.
10. **A specific question in the caption** ("Blue or white?", "How many hits until it breaks through?"), 5 to 10 niche hashtags, natural keywords ("bouncing ball", "physics simulation", "satisfying").
11. **Series, not one-offs**: the bot rotates families (escape, rhythm, battle) day by day, keeps recurring team names and colours, and numbers the episodes.
12. **Cadence and timing**: one to three clips a day, posted when the audience is online, replies in the first hour; Trial Reels for new hooks.

**Beats from a video.** A recipe can run on a real song's beat instead of a fixed BPM: import the video or audio in the Sound section's *Beats from a video* block (or load a project file that carries it) and pick the **Media** source, or place the beats by hand (**Manual**, URL `bm`). Every rhythm feature then follows that grid, **On beat** (URL `onbeat`) lands the ring modes' wall hits on it, and the export carries the song as its music bed – so the bot's "a note per bounce" rule (6) can become "a hit on every beat" of a trending sound. The grid is part of the run, so the finder searches with it and reports how many beats a found seed covers **[inferred: that on-beat hits raise watch time is a hypothesis to test]**.

## 4. What we do not know

- No source has data on payoff timing, on-screen counters or comment-bait wording; those rules are observations of the three accounts, not measurements.
- The guides disagree on the best length and on whether DM shares outrank watch time.
- The ballsimulator.com figures ("70 percent completion", "sound is 50 percent of virality", "1 to 3 videos a day") are marketing claims without sources.
- Nothing here replaces measurement: track average watch time, sends per reach, saves and first-hour comments per clip in Instagram Insights, and let the bot's recipe scores be corrected by what actually performs.

## 5. How the bot applies it, and what building it taught us

The bot (README, "Viral video bot") turns §3 into 19 recipes in three series that rotate day by day: **escape** (ring escape,
Pip escapes, grow until it fills, clone per pass, multipliers board, power layers), **rhythm** (pendulum wave, polyrhythm, drop
symphony, glass smash) and **battle** (string battle, territory, battle royale, square race, maze race, and the Fight League
duel, upset, bracket and boss rush). Every clip gets the
rule as a caption for the first 2–3 s, a countdown, a payoff planned with the seed finder, a note per bounce, neon on black, a
series label and a recurring cast, and a 0–100 score against the checklist below. The weights are ours, not measured:

| Checklist item | Points | §3 step |
| --- | --- | --- |
| Motion in the first second (first impact ≤ 1 s) | 10 | 1 |
| Hook on screen from 0 s for 2–3 s, inside the safe zone | 15 | 2 |
| A visible countdown (caption or the mode's HUD) | 10 | 3 |
| Payoff at 80–90 % of the clip (resolved) or 0.5–1 s after the cut | 20 | 4, 5 |
| Length inside the bucket, a bucket that suits the platform | 10 | 7 |
| Sound: a melody (or the mode's note ladder) on a scale, piano / xylophone | 10 | 6 |
| Ending: a tight loop after the payoff, or a closing question on a cut | 10 | 5 |
| Series: label, episode, recurring cast | 10 | 11 |
| Look: neon on black, glow, trails | 5 | 9 |

What the simulator taught us while building it **[observed in our own planner runs, not on Instagram]**:

- **A run that ends on its own ends right after its payoff.** Classic finishes about a second after the escape, Power Layers
  1.8 s after the ball breaks free, Ball Drop a second after the last ball settles. On a 15–30 s clip that puts the payoff at
  85–94 %; on a 60–90 s clip at 95–97 %. The bot accepts up to 97 % and the score marks anything past 90 % down; endless formats
  (pendulum wave, polyrhythm, grow, clone) are cut at exactly 85 %.
- **Battles are short.** String battles, battle royales and capture the flag are over in 10–30 s and then hold a 3 s winner
  banner, so they cannot fill a 60–90 s TikTok cut or an 8–15 s short one; the bot plays them in the standard bucket. The long
  bucket goes to pendulum waves, polyrhythms, clone loops, power layers, slow ring escapes, long glass runs, races and territory.
- **A race's 3-2-1-GO breaks rule 1.** The square race's gate opens at 1.8 s; the score flags it ("first impact at 1.8 s").
- **Growth varies by seed.** At two clones per escape Multiply takes 20–90 s to put 60 balls on screen; at four, most seeds fill
  it in 15–25 s. The planner measures the fill per seed instead of guessing.
- **The safe zone is a width limit.** A caption centred in a 1080×1920 frame stays out of the right 12 % only while it is at
  most 76 % of the frame wide; the bot splits the hook into one-line pills of at most ~68 % of the width (a conservative text
  estimate), and everything it places stays inside the centred square, above the bottom fifth.
- **Posting needs a public MP4.** The Instagram Graph API publishes a Reel in two steps (a `REELS` container from a public video
  URL, then `media_publish` once its `status_code` is `FINISHED`) and takes MP4 (H.264 + AAC). A Chromium without H.264 + AAC
  encoders exports WebM – Playwright's Chromium on Linux has neither, and Google Chrome on Linux has no AAC encoder – so the
  CLI converts every WebM clip to MP4 with ffmpeg before anything is uploaded (the daily job installs it) and never posts a WebM.
- **The race is won at the line, not on the podium.** The square race names its winner – callout, fanfare, "wins!" badge – the
  moment the first racer crosses; the podium comes 5–10 s later. The bot times the payoff (and a cliffhanger's cut) at that
  first crossing and cuts a resolved race at 85 % instead of waiting for the podium.
- **Say the rule the clip plays by.** Power Layers only reaches a long clip with a slower sequence than doubling (Fibonacci,
  +1 per hit); the hook names the sequence the clip really uses, and #itdoubles is only added when it doubles.
- **Arena games own the top of the square.** Battle royale and capture the flag draw their scoreboard band ("7 LEFT", the
  score and the clock) where the Top Text goes, so their series label is the Bottom Text and the captions start below the band.
- **Posting times are placeholders.** The slots (Reels 12:00 / 18:00 / 21:00, TikTok 13:00 / 19:00 / 22:00, Shorts 12:00 /
  17:00 / 20:00 local) are the usual lunch / after-work / evening windows **[inferred]**; replace them with the hours your own
  Insights show.

- **A fight is paced, not waited for.** Fight League duels are over in 11–20 s at 100 HP; the fight recipes set the HP so the
  KO lands where the clip wants it (about 18 s of fighting per 100 HP, the divisions' median), cut a duel's winner card at
  85 % instead of holding it, and play the shows (an 8-bracket, a boss rush) with short bouts and cards so a whole bracket fits
  a 60–90 s clip. The series label is the matchup itself with its running episode ("Thor vs Loki #3").

Next: feed each clip's average watch time, sends per reach, saves and first-hour comments back into the checklist weights, and
compare the resolved and cliffhanger clips the bot alternates.

### The Simple score and the clarity gates

The AI studio's crew (`src/lib/crew/`) checks every clip with plain rules before any model looks at it, and a model may fix or
drop a clip that fails a rule, never keep it.

**The Simple score** (0–100, `simplicity.ts`) measures "simple, not a lot of distractions" from the settings and the caption
timeline. It is 100 minus:

- text on screen at once (a caption group, the Top or Bottom Text, a HUD's words, a name label, a cut's hook pill or address
  line): 2 messages cost 5, 3 cost 15, 4 or more cost 30;
- 20 × the share of the clip above 15 % with 2 or more messages on screen;
- 6 for every persistent message (on screen for more than 80 % of the clip) after the first;
- a hook over 7 words (2 a word, at most 10) or over 2 lines (5);
- a message said twice: an AI hook that is not the drawn one 10, a cut's hook pill that is not the clip's hook 6, a payoff line
  the hook already says 3, a countdown caption beside a HUD that counts down 5;
- effects: wall glow 2, thick trails 3, a colour-cycling trail 3, rainbow walls 4, a rainbow ball 3, a reactive background 5,
  shake up to 5, the cinematic camera 3, confetti bursts 2, a confetti wall break 2 (the wall effects only in ring modes);
- 5 for each mode HUD or badge the clip does not keep (the HUD that counts down is kept when it is the countdown);
- after a render: 5 for motion above twice the most viewed median, 5 for no motion by 1.5 s;
- a text over the action: 2 a second a text hides the run's moving balls for 1 s or more longer than it would at the other
  edge of the square (the top or the bottom), 10 at most. It reads the run itself (where its balls move, every half second),
  so a plan with no run is not charged.

80 or more is Simple, 60–79 a bit busy, below 60 busy. The watermark badge is not counted.

**The clarity gates** (`clarity.ts`):

| Gate | Passes when |
| --- | --- |
| G1 motion early | The first impact comes within 1 s (after a render: the measured first impact, the first motion or the first sound, within 1.5 s). |
| G2 payoff lands | The payoff comes at 60–97 % with at least 0.8 s shown after it, or the cut comes 0–3 s before it with a question at the end. A shown payoff happens in the run: a sound there where the clip promises one (a beat, or words that name a chord), the mode's own chord where the words name one, no chord as large after a hook that promises one, and never silence with the balls at a quarter of their usual motion or less (on a beat, never only a few lone notes, fewer than the run's usual moment plays). A clip that ends without words never ends on more than 1.5 s of silence over still balls. |
| G3 one idea | One mode since the plan, one hook, one ending (the payoff's words or a closing question, never both). |
| G4 words match the picture | The drawn hook is the clip's hook, its numbers are the clip's, a named winner is the run's, the run shows the claim, and a bar or a timer of the clip's seconds stays on screen to within 1 s of its end. |
| G5 readable | Every text is in the safe zone, 2 lines at most, 7 words at most in the hook, 1.2 s a line, nothing over a scoreboard band, and no text over a mode's own banner while it shows (Glass's "STAGE 2" as each floor begins). |
| G6 not too busy | Simple is 60 or more. |
| G7 length fits | The length is in a bucket the platform takes. |
| G8 rendered | At most 2 % lagged frames, and the watermark on every free clip, drawing an address a viewer can open (never localhost). |

**Today's bot clips are busy** **[observed in our own planner: 19 recipes × 3 platforms × 4 plan seeds, 228 plans, the bot's
look]**. Their median Simple is 44 (15–56), while their median checklist score is 100.

- Every clip stacks the hook, the countdown and the series label in its first seconds and keeps two messages on screen for the
  whole clip.
- Every clip has the colour trail and the cinematic camera. The ring modes add wall glow, shake and the confetti wall break.
- 74 plans fail G5, 60 of them with a hook of more than 7 words: 12 each of Grow until it fills, Power Layers, String Battle,
  Territory and Fight League's boss rush. 12 fail G1 (the square race's 3-2-1). 7 fail G7.
- 7 fail G2. 4 show their payoff for 0.5 s only, at 97 % of the clip. In 1 cliffhanger the seed search never found the
  escape, 1 Grow clip never fills, and 1 cliffhanger race shows its finish 2.7 s before the cut instead of just after it.
- 2 fail G4: their seed search found no seed, so the run never shows the escape or the fill.

| Recipe | Simple (median) | Simple (range) | Checklist (median) |
| --- | --- | --- | --- |
| ring-escape | 47 | 47–47 | 98 |
| pip-escape | 26 | 26–26 | 98 |
| grow-fill | 40 | 40–40 | 100 |
| clone-per-pass | 44 | 44–44 | 100 |
| multipliers-board | 30 | 30–30 | 100 |
| power-layers | 26 | 26–28 | 100 |
| pendulum-wave | 56 | 56–56 | 100 |
| polyrhythm | 30 | 30–30 | 100 |
| drop-symphony | 56 | 56–56 | 100 |
| glass-smash | 24 | 24–24 | 100 |
| string-battle | 52 | 52–52 | 100 |
| territory | 28 | 28–28 | 100 |
| battle-royale | 56 | 56–56 | 100 |
| square-race | 25 | 25–25 | 95 |
| maze-race | 15 | 15–15 | 99 |
| fight-duel | 51 | 51–51 | 100 |
| fight-upset | 51 | 51–51 | 100 |
| fight-bracket | 51 | 51–51 | 94 |
| fight-boss | 49 | 47–49 | 100 |

These are the plans' own scores: settings and captions. Read with its run (where its balls move, half a second at a time),
the bot look also pays for its texts over the action, which all sit at the top of the square: 78 of the 228 plans, most of
all Grow until it fills, Clone per pass, Pendulum Wave, Ball Drop, Polyrhythm, Territory and the maze race. The median then
drops to 35 (8–56). The Simple look puts each text at the edge its run leaves clear and owes none of it.

The Simple look (below) is measured against this baseline.

**The cinematic camera is not only a look** **[observed in our own planner runs]**. Its slow motion changes the physics steps,
so turning `cinematicEnabled` off changes the run in 12 modes: Classic, Accumulation, Multiply, Shatter, Color Match, Ball Drop,
Multipliers, String Battle, Maze, Conveyor, Fight League and Land Claim. A seed found with the camera on plays differently with it
off, so a calmer look must keep it or plan its seeds with it off. Every other look setting the Simple score reads leaves the run
alone.

### The viral templates and the Simple look

The templates (`src/lib/bot/templates.ts`) bind every mode to one of ten formats: get out, smash, fill, count, who wins, aim,
line up, on the beat, reveal and Mode Lab game. A format promises one thing the run must visibly do, its claim, which the crew
checks (G4).

- **Ready now:** 39 modes as 49 templates. 15 of the 16 modes a recipe plays give 20 of them: Classic and Portal also have a
  Gerald variant, and Fight League has the duel, the upset, the bracket and, since AI studio step 6, the boss rush. A template
  plans its recipe pinned to its own mode.
  Gerald's Portal escape takes the standard length only: in the short one, Shorts' own, its seed search found no escape in time
  on about half the plans. Five modes without a recipe play their own settings (AI studio step 3): Shatter, Color Match, Target,
  Brick Smash and Perfect Fit, a trial tier each. Classic adds a variant of its own settings, one ring with one gap
  ("Classic · Get out · One ring"). Six more do since AI studio step 4: the conveyor, the Maze, Territory, Land Claim, Bullseye
  and Bouncing Shapes. Two more since step 4b: the Journey and Spiral Glass, each with a setting that switches its own overlay
  off. Nine more since step 5: Chord Stars, Focus Shot, Spinning Hoops, Bouncing Orbs, Colour Sort and the Double Pendulum Harp
  line up, and Beat Machines, Collision Playground and Wave Tank play on the beat. Ball Drop's template is ready again since
  step 5, its rain looped. Two more since step 6: the Drawing Machine reveals its flower, and the Mode Lab plays five of its
  six built-in games, a template each. Their numbers are in the tables of steps 3, 4, 4b, 5 and 6 below, and the whole table's
  counts and medians per format after them.
- **Hidden for now:** the other 9 modes are bound but wait, each with its reason. Eight sit in the experimental table
  (`EXPERIMENTAL`), which a test lets only shrink: a binding leaves it when its plans pass. Each was planned and measured and
  stays with the reason found: Paint in step 3, Merge Ring and Paddle Keep-Up in step 4, Beat Drop, Beat Runner and the Sound
  Vortex in step 5, Lines and Circle Illusion in step 6 (below). The ninth is the square race, a recipe's binding whose one
  variant is hidden (below). The Journey and Spiral Glass, hidden in step 3, left the table in step 4b, and the Drawing Machine
  and the Mode Lab in step 6. The payoff timing of every binding is in place
  (`src/lib/bot/outcomeStrategy.ts`). The **outcome** strategy asks the seed finder for the
  binding's outcome around the payoff target, such as Shatter's first escape, and reads the moment off the finder's own run
  of the seed. The **atEnd** strategy puts the payoff in the clip's last 1.5 s, for a run that loops. Its clips end resolved,
  in the short and standard lengths. A binding's own settings switch on the option its outcome needs, such as the chaos fan
  for the Double Pendulum's split. The finder searches six outcomes over settings, not seeds: Chord Stars, Focus Shot, Beat
  Machines, the vortex's ring waves, Brick Smash and Perfect Fit. Each of the six plans from a run of its own instead: the
  template's settings draw what the finder would search (a star set, a transit, a phrase, a wave interval), and the planner
  plays the seed's run with them and reads the moment off it, such as the last brick of the picture or the last piece landed
  (`OWN_RUN_MOMENTS`). Fight League's boss rush was hidden until step 6: its recipe's hook names the boss and the division in
  one clause of 8–9 words, more than the 7 G5 allows, so its template now draws its format's own (below). The square race is
  hidden: its 3-2-1-GO opens the gate at 1.8 s, so no plan passes G1, and no setting skips the count (step 4 tried 96
  seeds, 8 for each of its 12 plans: the gate opened at 1.8 s on every one). Ball Drop's was hidden until step 5:
  its run fades out. Its last note is one faint tick over a board at rest, then silence until a SETTLED! banner the recorder
  shows for 0.5 s, so no plan timed by that note lands (G2). Its template now loops the rain (below). A template that fails a
  gate on every plan is hidden with its reason, never kept by an exception. A binding is ready only while one of its templates
  is, so the race's binding is not ready either, though it wraps a recipe.
- **Unchanged:** the templates sit beside the recipes, so the daily rotation, its pinned days, the bot's own plans and every
  fingerprint stay as they were.
- **Words:** a template that wraps a recipe speaks with the recipe's words. The 32 bindings without one speak with their format's, written
  once per format in English, Polish and Spanish (`ViralBot.formats` in messages/*.json, read by `src/lib/bot/copy.ts`): a
  name, three hooks to pick from, a hook for a clip cut before its payoff, the payoff's words, the closing question and the
  post's question. `{thing}` is the mode's own noun ("the ball", "the orbs", "Gerald": `ViralBot.things`). In Polish and
  Spanish the formats put it where nothing has to agree with it ("Piłka w pułapce. Uda się wyjść?", "¿Hay salida para la
  pelota?"), so one hook reads right on every mode. A test fills every hook with every noun of its format, in each language:
  at most 7 words on 2 lines, broken at its clause, at most 42 characters in English and 52 in Polish and Spanish. A number
  the planner cannot fill yet (a count format's "{count}!") leaves the text out, never a brace. A template is named "{Mode
  name} · {Format name}" ("Shatter · Get out"). A binding's further variant adds its recipe's name ("Classic · Get out ·
  Gerald escapes"), or without a recipe its own (`ViralBot.variants`: "Classic · Get out · One ring", and since step 6 a Mode
  Lab game's name: "Mode Lab · Lab game · Ring Breaker"). The two looks have a name and a line each (`ViralBot.looks`: Bold, today's bot look, and Simple).
  A binding whose run its format's words do not describe has words of its own: a hook (`ViralBot.ownHooks`: Merge Ring's,
  Bouncing Shapes', Spiral Glass's, the Double Pendulum's, and since step 6 each Mode Lab game's rule) or a payoff
  (`ViralBot.ownPayoffs`, step 4b: the Journey's "Home! 🏠"). A variant that wraps a recipe may draw one of its format's hooks
  instead of the recipe's (step 6: Fight League's boss rush, "Pick one before it starts.").

**The Simple look** (`SIMPLE_LOOK`; templates plan in it, the daily bot keeps its own look):

- neon on a dark gradient (#05070a to #141a24, both under the look item's 0.12 luminance), ball glow and thin single-colour
  trails;
- no wall glow, colour trail, rainbow walls, rainbow ball, reactive background, shake or confetti: a wall breaks into shards;
- every HUD switched off but the one that counts down (String Battle's panel, Fight League's HP bars), and no name label.
  Since AI studio step 4b that includes the Journey's and Spiral Glass's own overlays (`journeyHud`, `sgHud`);
- one text at a time: the hook for 2.5 s, then the countdown caption until the next text, then the payoff's words or the
  closing question. No countdown caption appears where a HUD on screen counts down already. The caption counts walls only,
  where the format takes one: a bar or a timer counts the clip's seconds and would leave at the payoff short of its 100 % or
  0:00, so Grow, Clone per pass, Pendulum Wave and Polyrhythm let the picture count and give up the checklist's 10 countdown
  points;
- each text at the edge of the square its run leaves clear: the top, or the bottom where the text would hide the moving
  balls there for at least 1 s less (Ball Drop's hook while the balls enter at the top, Pendulum Wave's texts over the short
  pendulums). Never the bottom where the mode draws something of its own there (Fight League's boxes, Multipliers' counter,
  the loop HUD's counter). A mode's own banner counts first: a text takes the edge where it covers the banner for less time, so
  Glass's hooks sit at the bottom, clear of its "STAGE n" banner (G5);
- a text of two lines broken where a reader breaks it: at its clause ("15 pendulums." / "Wait for the chord."), a size step
  or two smaller where only that fits, else evenly, never with a last line of one or two words;
- a hook of at most 7 words. A longer one keeps its own whole clauses ("Pick a side: which colour takes the board?" becomes
  "Which colour takes the board?"). Pendulum Wave's asks its question instead of promising a chord ("22 pendulums. Do they
  line up?"): its run plays the same chord at the release and at half a cycle. Power Layers' keeps the rule it plays by, as
  the mode's own counter shows the layers left;
- one ending (AI studio step 4): where the mode draws its own finish banner as its payoff comes (Power Layers' "FREEDOM! 10
  hits · 16.7s", a battle's winner card, Bullseye's BULLSEYE!), the banner stays and the look draws no payoff words beside
  it. The banners and when they show are a table (`MODE_END_BANNERS` in `src/lib/crew/hudFlags.ts`); the Simple score counts
  one as a text on screen, the crew's screen view names it, and G2 reads it as the words the clip ends on where it covers the
  clip's quiet end;
- a payoff cut the same way toward 3 words ("FREE! Gerald made it 🎉" becomes "FREE!"). A payoff of one clause keeps its
  words ("Thor is the champion! 🏆", "Znów w jednej linii. 🎼"). It gets 1.2 s a line: where the seconds after it are too
  short for two lines, as on Shorts, it takes one line, without its closing emoji and a size smaller if need be. The closing
  question gets the last 2 s, or 2.5 s on two lines;
- the series label and the rest of a long hook go in the post caption, not on the clip.

It changes look settings only. The cinematic camera stays as the mode plays it, since it moves the run. The seed search ranks
and stops on the bot look's score, so the series label's 4 points never send it on to another seed. A test checks that the
Simple look leaves the seed, every other setting and the run's facts (`runFactsSync`) of every ready template as they are,
with the seed search on and off, on every platform the template is offered on.

**What it costs and what it buys** **[observed in our own planner: the 19 recipes × 3 platforms × 4 plan seeds, 228 plans in
each look]**:

| | Bot look | Simple look |
| --- | --- | --- |
| Simple score, median (range) | 44 (15–56) | 92 (85–97) |
| Simple score with the run read, median (range) | 34 (8–56) | 91 (84–97) |
| Checklist score, median | 100 | 94 |
| Plans that pass every clarity gate | 0 | 179 |

- Both looks pick the same seed. The checklist loses the series item's label points, 4 on every plan, and the countdown's 10
  on the 60 plans of Grow, Clone per pass, Pendulum Wave, Polyrhythm and Drop Symphony, whose bar counts the clip's seconds.
  The look item stays at 5 on every plan.
- The Simple score still charges every plan 3 for the cinematic camera. 138 plans show two messages at once for a while: a
  mode's own HUD (an arena's band, the layer count, the stage dots) beside a text, or its end banner beside the HUD.
- AI studio step 4 measured the table again once the Simple score counted the modes' own end banners (above): the bot look's
  median with the run read went from 35 to 34 (its payoff words stand beside the banner), the Simple look's from 91 to 92
  without the run (no payoff words beside a banner) and its lowest with the run from 85 to 84; 132 plans had shown two messages
  at once. The checklist and the gates did not move.
- 49 plans still fail a gate. 12 square races fail G1: the 3-2-1-GO opens the gate at 1.8 s. 12 boss rushes fail G5 on their
  hook. 7 clips run outside their platform's buckets (G7), among them 4 brackets on Shorts. The bot look's 7 G2 misses stay,
  on the same seeds, and the 4 of them that show their payoff for 0.5 s give its one line under 1.2 s (G5). A payoff of two
  lines whose clip ends too soon for both is drawn on one line (above). 12 Drop Symphony and Pendulum Wave plans fail G2's
  reading of the payoff's moment: "Final chord. 🎹" over a silent board, and a realignment that plays no chord. Pendulum
  Wave's template asks whether they line up instead, and Ball Drop's is hidden (below).

**The 18 ready templates** **[observed: each on the platforms its buckets fit, 4 plan seeds, 212 plans]** have a median Simple
of 97 (83–97) and a median checklist score of 96. 208 plans pass every gate, G2's reading of the payoff's moment included,
and every template passes on at least 3 of 4 plan seeds on each platform it is offered on, in English, Polish and Spanish
alike (208 of the 212 plans in each; a test checks it). Pendulum Wave's template sounds its chord at the realignment and asks
whether the pendulums line up, where the bot's own Pendulum Wave fails G2 (a realignment with no chord). The four templates
whose counter would count the clip's seconds score 82–84 on the checklist: the picture counts instead.

| Template | Simple (median) | Checklist (median) | Pass every gate |
| --- | --- | --- | --- |
| get-out-classic | 97 | 96 | 12/12 |
| get-out-classic-gerald | 97 | 96 | 12/12 |
| get-out-accumulation | 97 | 96 | 12/12 |
| get-out-portal | 97 | 96 | 12/12 |
| get-out-portal-gerald | 97 | 96 | 12/12 |
| get-out-glass | 88.5 | 96 | 11/12 |
| smash-power-layers | 89.5 | 96 | 12/12 |
| fill-grow | 97 | 82 | 10/12 |
| count-multiply | 97 | 82 | 12/12 |
| count-multipliers | 90 | 96 | 12/12 |
| who-wins-ctf | 90 | 96 | 12/12 |
| who-wins-battle | 89.5 | 96 | 12/12 |
| who-wins-string-battle | 89 | 96 | 11/12 |
| who-wins-fight-league | 89.5 | 96 | 12/12 |
| who-wins-fight-league-upset | 90 | 96 | 12/12 |
| who-wins-fight-league-bracket | 92 | 90 | 8/8 |
| line-up-pendulum | 97 | 82 | 12/12 |
| line-up-polyrhythm | 97 | 84 | 12/12 |

- The square race is not in the table: it failed G1 on every plan (0 of 12), as the bot's own race clips do, so it is hidden
  (above). Nor is Ball Drop: timed at its last note, every plan fails G2, so that template stayed hidden. Its template of
  step 5 loops the rain and is timed by the clip's end (below).
- Portal and Accumulation end the run with the escape. A resolved clip would show it for the recorder's 0.5 s only, under
  G2's 0.8 s, so their templates take the cliffhanger ending and cut before it.
- The other misses are seeds the search could not fit: no fill found in time, a length outside the bucket, a cut too far
  from the payoff, and one String Battle whose first hit comes at 1.4 s.
- Multipliers' and Fight League's rows are AI studio step 4's: their own end banner is the clip's one ending now, with no
  payoff words beside it (above), and their Simple medians moved from 89 to 90 and 89.5. Power Layers, CTF, the battle royale,
  String Battle, the upset and the bracket kept theirs; their counts did not move.
- Glass's row is AI studio step 3's. Its hook moved to the bottom of the square, clear of the mode's "STAGE n" banner (G5,
  above), and its Simple score is 88.5 in English, 89 in Polish and 88 in Spanish (83–97 over its plans). Its one miss is a
  Shorts cliffhanger, the same in each language: its seed search found no seed that fits, and the cut comes 1 s after the
  payoff instead of before it.

**AI studio step 3's templates** **[observed: 4 plan seeds × 3 platforms, the Simple look, in English, Polish and Spanish:
the same counts in each]**. Five modes without a recipe play settings of their own, drawn from the planner's seeded context
on their sliders' steps (`src/lib/bot/templates.ts`), and Classic adds one ring. Each also passed its watch: one clip of each
rendered watermarked through the page's own fast export, and its hook and contact sheets looked at.

| Template | Its own settings | Simple (median) | Checklist (median) | Pass every gate |
| --- | --- | --- | --- | --- |
| get-out-shatter | 8–12 rings of glass (short) or 16–20 (standard), ball speed 380–440; cut before the escape | 97 | 86 | 12/12 |
| get-out-color-match | one ring of 12 segments in 2 colours, ball speed 600–800; standard only, cut before the escape | 97 | 86 | 12/12 |
| smash-target | 5 numbered segments (short) or 6–7 (standard), ball speed 600–720, no gravity; cut before the last | 97 | 86 | 12/12 |
| smash-brick-rebuild | a new ball every max(1, target ÷ 5) bricks, ball speed 420–520; the last brick of the picture | 100 | 86 | 12/12 |
| fill-perfect-fit | the 12 pentominoes in a 10 × 6, 12 × 5 or 15 × 4 box, timed to fill at the target; the tiling with the most pieces on the floor | 97 | 82 | 12/12 |
| get-out-classic-ring | one ring with a 15–25 % gap, ball speed 420–560, spin 0.8–1.6, ball 8–11 | 97 | 86 | 11/12 |

- Their runs are the bot look's: the seed and every run fact (`runFactsSync`) are the same in both looks, on every plan.
- They let the picture count (the rings left, the segment's number, the bricks, the empty box), so each gives up the
  checklist's 10 countdown points, as Grow does, and the series item's 4. Perfect Fit loses 4 more: a looping run's payoff
  is close to its end (below).
- Shatter, Color Match and Target end their run with the payoff: a resolved clip would show it for the recorder's 0.5 s, under
  G2's 0.8 s, so they cut before it and ask, as Portal does. Color Match's escape comes 17–36 s in, the standard length's.
- Brick Smash never finishes: it rebuilds its picture and smashes it again. Perfect Fit loops too: it fills its box, bursts
  it and starts again. Both plan from a run of their own (`OWN_RUN_MOMENTS` in `outcomeStrategy.ts`). Perfect Fit's page
  records whole loops, so its clip ends on the loop's seam, 1.4 s after the box is full, and its payoff lands at 85–94 %,
  inside G2's band but past the checklist's 90 % on TikTok and Reels.
- Classic's one ring misses one Shorts plan: in the short length its seed search found no escape in time.
- In the bot look, Brick Smash and Perfect Fit are busy (G6), as Glass is: the Simple look is what makes them ready.

Hidden after measuring, each with its reason in `EXPERIMENTAL` (a template that fails a gate on every plan, or a screen that
is not calm when watched, is hidden, never kept by an exception):

- **Paint** fills its picture and ends the run at 95 %: a resolved clip shows the fill for the recorder's 0.5 s only, and
  the fill format ends resolved only. 0 of 12 plans passed. Grow's own variant whose fill ends the run (`fills-by`) fails the
  same way, 0 of 12; the grow-fill recipe's ring goes on after its fill.
- **Spiral Glass** passed every gate on 12 of 12 plans in each language, timed at its GLASS CLEARED, 2 s before its run ends.
  Watched, it draws a question of its own over the spiral for the whole run ("Will the ball multiply?"), with its title, its
  tiles left and a progress ring, and no setting switched them off then: a template's hook stacked a second question over it.
  Ready since step 4b (below).
- **Journey** passed every gate on 11 of 12 plans in each language, home as its way out. Watched, its own HUD (a banner as each
  stage begins, a mini-map, a clock, every stage's label) and its HOME! card beside the payoff's words put two or three texts
  on screen at once, and no setting switched them off then. Ready since step 4b (below).

**AI studio step 4's templates** **[observed: 4 plan seeds × 3 platforms, the Simple look, in English, Polish and Spanish:
the same counts in each]**. Six more modes play settings of their own, and each is timed by a moment of its own run: the
planner reads the moment the run marks it (`MARK_MODES` in `src/lib/bot/planner.ts`: the first bullseye, the first shape at
zero, the last ball out) or, for the Maze, the moment its first ball leaves (`OWN_RUN_MODE_MOMENTS` in `outcomeStrategy.ts`). Each
passed its watch: one clip of each rendered watermarked and its hook and contact sheets looked at.

| Template | Its own settings | Simple (median) | Checklist (median) | Pass every gate |
| --- | --- | --- | --- | --- |
| count-conveyor | a ball every 2–3 s up to as many as fill the clip; standard only; ALL OUT!, 1.5 s before the run ends | 91 | 82 | 12/12 |
| who-wins-maze | 8–10 columns (short) or 11–13 (standard), 3–4 balls, each trail in its ball's colour; the first one out | 97 | 86 | 12/12 |
| who-wins-territory | its countdown on its 5 s step at or past the target; cut before the verdict | 97 | 86 | 12/12 |
| who-wins-land-claim | the claim rule (a block takes its hitter's colour), 2 balls a side over 12–20 rows (short) or 2–3 a side, no new balls, 12–16 rows (standard); cut before the verdict | 97 | 86 | 11/12 |
| aim-bullseye | 4–5 rings (short) or 6–7 (standard), most pegs in play (chaos 0.6–0.75), 16 or 20 shots; the first BULLSEYE! | 90 | 86 | 12/12 |
| aim-box | two squares at speeds 2 : 3, each counting down from twice the target; the first one at zero | 97 | 82 | 12/12 |

- Their runs are the bot look's: the seed and every run fact are the same in both looks, on every plan.
- The plan said the conveyor and Merge Ring loop and should take the clip's last 1.5 s. The code says otherwise: both runs
  end, the conveyor 1.5 s after its last ball is out (ALL OUT!), Merge Ring 2 s after its final form or its OVERFLOW. So they
  take their own finish, as the code has it.
- Territory and Land Claim end their run with the verdict, its banner shown for the recorder's 0.5 s: they cut before it and
  ask, as Portal does. Land Claim's one miss is a standard plan of 42 s, past Reels' lengths. Its knock rule was watched first:
  the walls stay white, and who leads is a blind guess; the claim rule colours each block its hitter's, so the land shows.
- Bouncing Shapes' hook is its own, "It stops at zero." (`ViralBot.ownHooks`, in English, Polish and Spanish): its format's
  three ask about a corner. The DVD logo's corner comes 1.4–6 s in at a speed whose first bounce is inside G1's first second,
  too soon for any length; one shape counting down ends the run as it reaches zero (0.5 s shown). Two shapes leave the other
  counting on. Merge Ring's hook is its own too, "How far can it merge?", though its template stays hidden (below).
- Bullseye's pegs: at chaos 0.3–0.5 a short clip's first shot fell clear to the board in 1.3 s on 2 of 4 Shorts plans (G1);
  with most pegs in play every first shot hits one within the first second.
- The Maze names its winner by its colour ("AQUA", "SNOW"), as its banner does, in the plan, the payoff and the crew's run.
- The battle family keeps the Maze, Territory and Land Claim: they are offered only when that family is asked for.

Hidden after measuring in step 4 (`EXPERIMENTAL`):

- **Merge Ring** passed every gate on 12 of 12 plans in each language, timed at its FINAL FORM. Watched, it asks "Will it
  merge into its final form?" under its ring for the whole run, with its title, its merge count and its ladder of sizes, and
  no setting switches them off: a template's hook stacks a second question over it, as Spiral Glass's did before step 4b.
- **Paddle Keep-Up** passed every gate on 12 of 12 plans, timed at its GAME OVER. Watched, its score, lives and streak sit in a
  band over its ceiling at the top of the square, which the hook covers for its 2.5 s, and the bottom is its paddle. The
  canvas starts the top captions below a mode's top HUD only where the mode reports one, and Paddle reports none
  (docs/agents/STUDIO.md, known gaps).
- **The square race** stays hidden: its gate opens at 1.8 s on every seed searched.

**AI studio step 4b's templates** **[observed: 4 plan seeds × 3 platforms, the Simple look, in English, Polish and Spanish:
the same counts in each]**. The two step 3 hid for what they draw of their own get a setting that switches it off, with its
mode's own link key: the Journey's `journeyHud` (`jshud=0`: the stage banners and names, the mini-map, the clock and score, and
the HOME! card) and Spiral Glass's `sgHud` (`sghud=0`: its title and tiles left, its progress ring and its question over the
spiral). Each is a toggle in its mode's panel, in English, Polish and Spanish. The default shows the overlay, so every link,
preset, project file and the daily bot look as before. Both are HUD flags, so the Simple look switches them off, and both are
drawn only: the canvas reads them and the engine never does, so the run is the same either way (a test checks that the
engine's request and `runFactsSync` are the same with each switch on and off, and that each mode's fingerprint is its
BASELINE's). Each passed its watch: one clip of each rendered watermarked and its hook and contact sheets
looked at.

| Template | Its own settings and words | Simple (median) | Checklist (median) | Pass every gate |
| --- | --- | --- | --- | --- |
| get-out-journey | three stages before HOME (short) or four (standard), none with badges or a score; hook b "Will Gerald make it home?", its own payoff "Home! 🏠"; resolved only | 97 | 86 | 12/12 |
| smash-spiral-glass | 5 turns of 1-hit glass at speed 2 (short), 3–4 turns of 2-hit glass at 1.5–2 (standard); its own hook "Will the ball multiply?"; GLASS CLEARED, 2 s before the run ends; resolved only | 97 | 86 | 12/12 |

- Their runs are the bot look's: the seed and every run fact are the same in both looks, on all 72 plans.
- What stays for the clip to make sense with the overlay off. The Journey: the door marked HOME, which is the picture's, and
  the payoff's own words say HOME where the card did. Spiral Glass: the badge at the spiral's entrance, which counts the balls
  as they multiply (x1 to x7 in the clip watched), and GLASS CLEARED with the balls' count, the clip's one ending. Its hook asks
  the question the overlay asked ("Czy kulka się pomnoży?", "¿Se multiplicará la bola?").
- Both end resolved only: a cut clip's closing question ("Out or not?", "One more hit?") would ask another question than the
  hook. Step 3 had planned both endings: the Journey then missed one Shorts cliffhanger, whose seed search fit no cut.
- In the bot look they keep their overlays and are busy (G6: Simple 9 and 24), as Glass is: the Simple look is what makes them
  ready. The bot look also draws the Journey's hook over its stage banner (G5).

**AI studio step 5's templates** **[observed: 4 plan seeds × 3 platforms, the Simple look, in English, Polish and Spanish:
the same counts in each]**. Nine more modes play settings of their own, six that line up and three on the beat, and Ball
Drop's template plays its recipe with the rain looped. Each is timed by its outcome's moment (the **outcome** strategy) or by
the clip's last 1.5 s (**atEnd**). Each passed its watch: one clip of each rendered watermarked, its payoff heard (the render's
notes) and its hook and contact sheets looked at.

| Template | Its own settings | Simple (median) | Checklist (median) | Pass every gate |
| --- | --- | --- | --- | --- |
| line-up-star-chords | 4–6 balls, each drawing a star of a set (the best of 40 drawn, one star with as many points as the drawing has seconds) that closes 85 % into the clip, then its hold and fade; the clip ends on the loop's seam; short only | 97 | 84 | 12/12 |
| line-up-ellipse-foci | a volley of 36–72 balls fired from one focus, its transit whole 2 s bars nearest the target, so every ball lands on the other focus at once; two passes a loop; short only (a standard clip's target asks a transit past the slider's 20 s) | 97 | 84 | 12/12 |
| line-up-hoops | the spin's ramp that brings every bead up by the target | 97 | 86 | 12/12 |
| line-up-orb-grid | 21 × 21 orbs (the default 33 × 33 was busy when watched), their cycle on the target; the mode's IN PHASE banner the one ending | 97 | 82 | 12/12 |
| line-up-colour-sort | 40 balls a colour at size 8, passing through each other, the speed that sorts them about the target; the clip ends on the loop's seam after the remix | 100 | 82 | 12/12 |
| line-up-double-pendulum | the chaos fan 10⁻⁵° apart (short) or 10⁻⁶° (standard), played forward; its own hook "Same start. Watch them split." | 97 | 86 | 12/12 |
| on-the-beat-drop | Drop Symphony's draw with the rain looped; the clip's last 1.5 s | 97 | 82 | 12/12 |
| on-the-beat-beat-machine | 120 bpm, one loop the clip's length, 5 marbles a tube; a seed whose phrase needs no spare marble, the note nearest 85 % of the loop its payoff; the clip ends on the loop's seam | 97 | 86 | 12/12 |
| on-the-beat-collide | 100–140 orbs; the clip's last 1.5 s | 97 | 82 | 12/12 |
| on-the-beat-wave-tank | the mode's own double slit; the clip's last 1.5 s | 97 | 82 | 12/12 |

- Their runs are the bot look's: the seed and every run fact are the same in both looks, on all 156 plans measured (the ten
  above and the three hidden below).
- The beat format has its first ready templates. Ball Drop's run fades out (above), so its template loops the rain
  (`dropLoop`): the balls fall through the board and in again, its notes never thin out, and the clip's last 1.5 s land on a
  full board, heard (a test checks two plans: at least 3 notes at the payoff and under 0.5 s of quiet after it). The words
  are the recipe's.
- Four of the six outcomes the finder searches over settings plan this way since step 5 (`OWN_RUN_MOMENTS`): the template draws
  Chord Stars' star set, Focus Shot's transit, Beat Machines' tempo and loop, and the vortex's wave interval and friction as
  the finder would, and the planner reads the seed's moment off its run. A Beat Machines seed writes its own phrase: at five
  marbles a tube about every other seed's needs no spare, at the default auto count none of 40 did.
- Chord Stars, Colour Sort and Beat Machines end on their loop's seam. The page exports whole loops, so the plan ends the clip
  where the loop closes and holds nothing after it: each rendered length is the planned one, to the frame.
- Colour Sort's balls pass through each other (`csContacts` off). With contacts, the page's run of 160 touching balls parted
  from the planner's run within seconds: the page sorted 0.8–1.1 s before the plan's second, so "There it is." came over the
  remix (watched, then checked with page stills at the plan's seconds). Without contacts both runs sort on the same frame.
- Bouncing Orbs draws its own IN PHASE banner as the field lands together ("441 orbs land together at 19.0s"): a row of
  `MODE_END_BANNERS` now, so the Simple look draws no payoff words beside it.
- The Double Pendulum's hook is its own (`ViralBot.ownHooks`: "Ten sam start. Patrz, jak się rozchodzą.", "Mismo inicio. Mira
  cómo se separan."): the format's hooks promise a line-up, and its fan splits.
- A beat format's claim is a beat heard at the payoff. The crew's claim check (`claimSeen`) now takes the run's moment with its
  sounds at the payoff where the run has no finish of its own, and, where no moment was read (the bot's own runs), a run that
  sounds before its payoff.
- In the bot look, Spinning Hoops, the Double Pendulum and Collision Playground pass every gate (Simple 85–89). The others are
  busy there (G6: Simple 30–46), as Glass is: the Simple look is what makes them ready.

Hidden after measuring in step 5 (`EXPERIMENTAL`):

- **Beat Drop** passed every gate on 12 of 12 plans in each language, the clip's end its payoff (its run is its recording).
  Watched, it draws a HUD of its own at the top left of the square, with BEAT DROP, the tempo, the landings on the beat and
  the bar's four dots. No setting switches it off, and the hook covers its title for 2.5 s, as with Paddle Keep-Up's score band.
- **The Sound Vortex** passed every gate on 12 of 12 plans, its last ring swallowed on a bar line of its bed (0 ms off).
  Watched, it writes a title of its own in the corner for the whole run ("why marbles speed up in a funnel"), which no
  setting switches off: the hook stacks over it.
- **Beat Runner** passed none of 12. Its square runs a second before its first take-off, so its first note comes 1.5 s in on
  every plan (G1 asks 1 s), and its LEVEL COMPLETE comes 0.5 s before the clip's end (G2).

**AI studio step 6's templates** **[observed: 4 plan seeds × 3 platforms, the Simple look, in English, Polish and Spanish:
the same counts in each]**. The last group: the reveal format's first ready template, the Mode Lab's built-in games, and
Fight League's boss rush. Each passed its watch: one clip of each rendered watermarked and its hook and contact sheets looked
at, Glass Hatchery's three times.

| Template | Its own settings and words | Simple (median) | Checklist (median) | Pass every gate |
| --- | --- | --- | --- | --- |
| reveal-drawing-machine | the orbits machine: Earth and Venus over 8 years, a line between them every few days, so a five-petal flower and its pentagram come out of the lines; the years' pace on its slider's step so the flower is done 0.25–0.65 s into the clip's last 1.5 s (atEnd), the hold past the clip's end; hook "Guess what it draws." | 97 | 82 | 12/12 |
| lab-game-blueprint | Glass Hatchery, the Mode Lab's default game; standard only; its own hook "Every broken tile hatches a new ball." | 92 | 82 | 12/12 |
| lab-game-blueprint-ring-breaker | Ring Breaker; short only; "Every broken ring doubles the balls." | 87.5 | 84 | 12/12 |
| lab-game-blueprint-tier-climb | Tier Climb; standard only; "Matching orbs merge into a bigger one." | 91.5 | 82 | 12/12 |
| lab-game-blueprint-plinko-race | Peg Race; short only; "Through the pegs. First one out wins." | 87.5 | 84 | 12/12 |
| lab-game-blueprint-grow-escape | Grow or Go; short only; "Bigger every bounce. Will it still fit?" | 89 | 84 | 12/12 |
| who-wins-fight-league-boss | the boss rush recipe, with its format's hook b "Pick one before it starts." | 89.5 | 96 | 12/12 |

- Their runs are the bot look's: the seed and every run fact are the same in both looks, on all 84 plans.
- The Drawing Machine draws its orbits: its default harmonograph draws a figure no viewer could name (watched), and the
  format's hooks ask to guess a picture. Its last lines are drawn as the payoff comes. Measured first with a pace that closed
  the flower by the payoff, it was done 0–0.4 s before it on 3 of 12 plans, which failed G2: a still, quiet moment, the bed playing on and the
  last conjunction's pluck 1.6 years before the flower closes. Its cycle of drawing, hold and rewind is longer than
  the clip, which the page's whole-loop export records at its set length (rendered 21 s of 21 planned).
- A Mode Lab template per built-in game that bp-check calls playable (all six are; Colour Conquest's is hidden, below). Its
  hook is the game's rule (`ViralBot.ownHooks`, in English, Polish and Spanish), its series the game's own family, its words
  the variant's name ("Mode Lab · Lab game · Ring Breaker"). Its payoff is the moment its finish rule fires, read off the run
  (`MARK_MODES`), and the game's end banner, with its result and its time, holds 1.5 s before the run ends: the clip's one
  ending (`MODE_END_BANNERS`), with no payoff words beside it.
- The lengths a game fills: Glass Hatchery's shell is cleared about 17 s in and Tier Climb's top tier about 25 s in, so their
  seed search found no seed in a short clip (0 of 4 Shorts plans each): standard only. Ring Breaker, Peg Race and Grow or Go
  end 8–14 s in, and in a standard clip their seed search took the seeds that drag (four balls waiting 8 s for the last
  rings, the racers resting 10 s on the bowl's floor, watched): short only. Glass Hatchery's payoff lands at 93 % of its
  clip, past the checklist's 90 %, and Tier Climb's at 90–93 %.
- A game draws its title block at the top left of the square: its name and counters. Watched, the first hook at the top
  covered it, so the block is a banner on the run's action track (`labTitleBox` in `src/lib/bot/actionTrack.ts`): the
  Simple look puts each game's hook at the bottom, and G5 fails a text over the block.
- The boss rush's hook in the recipe names the boss and the division in one clause of 8–9 words, over G5's 7. Its template
  draws its format's hook b instead ("Wybierz, zanim ruszy.", "Elige antes de que empiece."): a variant may take one of its
  format's hooks (`hookKey`), and the bot's own Boss rush keeps its words. It stays in the battle family.
- In the bot look none of them passes: the Mode Lab's hooks sit at the top over the game's title (G5), and all are busy
  (G6: Simple 30–41). The Simple look is what makes them ready.

Hidden after measuring in step 6:

- **Colour Conquest** (`lab-game-blueprint-conquer`, a variant hidden with its reason; its game is a battle) passed every gate on 12
  of 12 plans. Its 24 balls collide and convert each other, and the page's run parted from the planner's: rendered twice,
  its run ended 0.8 s after the planned finish once, and had two colours left at the clip's end the other time (13 s, the
  plan's last colour standing 11 s in), so its ending never came (watched). Glass Hatchery's page run parts by less: rendered
  three times, it ended 0.13 s before and 0.18 and 0.58 s after the planned length, with its SHELL CLEARED shown inside the
  clip each time (watched), so it stays ready (docs/agents/STUDIO.md, known gaps).
- **Lines** (`EXPERIMENTAL`) passed every gate on 12 of 12 plans, the clip's last 1.5 s its payoff. Watched, its strings run from every
  bounce point to the moving ball, so they make a fan that follows the ball and never a picture, and the reveal format's
  hooks ask to guess one.
- **Circle Illusion** (`EXPERIMENTAL`) runs a fixed length, whole cycles that cover the clip. Its lines and rings types passed every gate
  on 12 of 12 plans but show no picture to guess (watched): the rolling circle the lines make is there from the first second,
  and the rings line up every cycle, a line-up rather than a reveal. Its white-spaces type hides a picture and reveals it as
  its run ends, shown for the recorder's 0.5 s only: 0 of 12 plans passed (G2), as Paint's fill.

**The whole table after AI studio step 6** **[observed: every ready template, 4 plan seeds × 3 platforms, on the platforms
its buckets fit: 584 plans in the Simple look in each of English, Polish and Spanish, and 584 in the bot look in English]**.
48 of 48 modes are bound. 39 are ready, as 49 templates. The other 9 are not ready, each with its reason: the 8 bindings of
the experimental table and the square race, a recipe's binding whose one variant is hidden. Three variants of ready bindings
are hidden with theirs: Grow's fill that ends the run, Colour Conquest and the square race's. A test pins the counts per
format (`tests/botTemplates.test.ts`).

| Format | Bindings ready | Not ready, and why | Templates ready | Pass every gate (each language) | Simple median (range) | Checklist median |
| --- | --- | --- | --- | --- | --- | --- |
| get out | 7 | – | 10 | 118/120 | 97 (84–97) | 94 |
| smash | 4 | – | 4 | 48/48 | 97 (86–100) | 86 |
| fill | 2 | Paint: its run ends at its fill, shown 0.5 s | 2 | 22/24 | 97 (97–97) | 82 |
| count | 3 | Merge Ring: its own question under the ring | 3 | 36/36 | 91 (87–97) | 85 |
| who wins | 7 | the square race: its count-in opens the gate at 1.8 s (G1) | 10 | 114/116 | 90 (87–97) | 94 |
| aim | 2 | Paddle Keep-Up: its score band under the hook | 2 | 24/24 | 94 (87–97) | 86 |
| line up | 8 | – | 8 | 96/96 | 97 (97–100) | 84 |
| on the beat | 4 | Beat Drop and the Sound Vortex: their own HUD or title under the hook; Beat Runner: its first note at 1.5 s (G1) | 4 | 48/48 | 97 (97–97) | 82 |
| reveal | 1 | Lines and Circle Illusion: no picture to guess | 1 | 12/12 | 97 (97–97) | 82 |
| Mode Lab game | 1 | – | 5 | 60/60 | 89 (86–92) | 84 |
| **All** | **39** | **9** | **49** | **578/584** | **97 (84–100)** | **86** |

- The ranges are the English plans'. Polish and Spanish pass the same 578 plans, miss the same 6 and have the same medians
  per format. A template's Simple median moves by half a point at most, and a lowest plan by one (Glass's lowest Spanish
  plan scores 83, Power Layers' lowest Polish one 85).
- Every ready template passes every gate on at least 3 of its 4 plan seeds on every platform it is offered on, at Simple 80
  or more and a checklist score of 75 or more, in each language. Its runs are the bot look's: the seed and every run fact are
  the same in both looks, on all 584 English plans.
- The 6 misses are the ones the tables above name: Classic's one ring and Glass on one Shorts plan each, Grow until it fills
  on two, a Land Claim plan of 42 s past Reels' lengths, and one String Battle whose first hit comes at 1.4 s.
- The lowest checklist score of a passing plan is the Maze's 76; the lowest Simple score is Glass's 84.
- In the bot look 95 of the 584 plans pass every gate (median Simple 36): the Simple look is what makes most templates ready.
- Each format has at least one ready template. Who wins holds the battle family: its 10 templates, Fight League's among them,
  are offered only where that family is asked for (`readyTemplates("battle")` or `"all"`, and the `templates` tool's
  `family`). The default menus offer the other 39, as the daily bot leaves its battles out.

Sources: instagram.com/project.jdm, a second account (its handle is left out of this repository) and instagram.com/oddplayground (profiles and 30 reel
pages, September 2026); ballsimulator.com, "How to Create Viral Bouncing Ball Videos" and "10 Pro Tips to Make Your
Bouncing Ball Videos Go Viral"; creatorflow.so, "Instagram Algorithm 2026: What Changed"; clixie.ai, "Instagram
algorithm 2026: the 4 ranking signals that matter"; reddit.com/r/learnprogramming, "how to make bouncing balls tiktok
videos" (implementation notes only).

## 6. What is trending: the trend data and how to use it

The playbook above is research from September 2026. What goes viral moves faster, so the owner decided (October 2026) that
agents study other creators' trending and viral simulation videos and feed what they learn into the app. The data lives in
`src/content/trends.json`, and the app's AI reads it fresh; it never reads this section, whose findings are one day's
(`docs/agents/CLI.md`, under `npm run trends`, says how the data is made, read and refreshed). This section is for people:
how to read the numbers, and what the first runs found.

- **How to read it.** A run is a few dozen videos on one day: tendencies, not laws. A pattern is "clear" from 5 videos,
  |ρ| of 0.4, a two-sided p-value of ρ below 0.05 and a step's difference, a "hint" from 3 videos, |ρ| of 0.3, p below 0.2
  and half a step, and it is dropped when one search on its own says the opposite. The p-value is what makes the bar
  depend on the sample: ρ has to reach 1.0 over 5 videos, 0.74 over 8 and 0.45 over 20, and a pattern of fewer than 20
  videos is a hunch to test, not a finding. Every pattern says its n and p, and the prompt tags every advice with what it
  rests on: a pattern's ρ, n and p, or "benchmark" when the most viewed do it but the rest as well. A trait whose
  searches' most viewed differ by more than two steps (one search's top is dark, another's light) is "split": no advice
  comes from it, and the prompt gives its range by search. A theme is advice only from three videos, when they rank above
  the other videos with and without the best of them, and never for "satisfying", which most titles of the genre carry:
  summed views never decide it, since one hit would. When a site refuses a download, `inspire` sees a YouTube video
  through its public stills (the opening frame, 25, 50 and 75 % and the cover): its colours then come from four moments,
  and its motion and sound are unknown.

### What the October 2026 runs found

These are the numbers of 26 October 2026, frozen: `npm run trends` refreshes `trends.json`, not this list, so whoever
refreshes the data rewrites it from the new reports (or marks it as the older runs'). A refresh replaces the summary with
the reports it is given and only those, and the reports live in the git-ignored `.agent-out/`: keep the earlier runs'
report.json files and pass them again to merge them, or the summary forgets them. The app marks a summary old 60 days
after its date and stops reading it after 120, so refresh it about once a month.

Two searches on 26 October 2026, "ball simulation" (mostly 2D clips) and "satisfying physics simulation shorts" (read from
#physicssimulation, mostly 3D renders), gave 39 short-form videos on YouTube Shorts, 14.5 million views together. YouTube
refused every download from the server, so none was measured whole: the colours come from the public stills of all 39
(the second pass of the day; the first read only the top 8 of each search, so its "most viewed" and "rest" were both in
the top 40 %). The 3D search has five times the views of the 2D one, so each search is read on its own and the two are
pooled by rank, never by views.

- **Short clips.** In "ball simulation" the most viewed third runs 11 s against 24 s for the rest (ρ −0.55, n 20, p
  0.01: the one clear pattern of that search). In the 3D search length does not separate them (11 s against 9 s, ρ +0.29,
  p 0.21), so the pooled numbers show no pattern (ρ −0.04 over 39): the summary's "11 s" is a benchmark. Our 10–15 s clips
  fit **[observed]**.
- **Light pictures; the saturation depends on the search.** In both searches the most viewed are lighter than the rest:
  "ball simulation" brightness 0.39 against 0.10 and dark share 0.04 against 0.64 (most of its lower ranks are
  near-black clips), the 3D search 0.60 against 0.52 (ρ +0.34, n 20, p 0.14: a hint) with no video darker than a dark
  share of 0.15. But a dark clip can top a list: the second most viewed of "ball simulation" (734,000 views) is almost black (dark share
  0.97, brightness 0.03), and 3 of its 7 most viewed have a dark share of 0.4 or more. Saturation goes the other way
  between the searches: the most viewed 2D clips are more saturated than the rest (0.57 against 0.24), the 3D renders
  are not (0.31 against 0.29). The "calm colours" pattern of the first pass (saturation 0.32 against 0.59, ρ −0.52 over
  only 8 videos, p 0.20: a hint by today's bar, though the old one called it clear) was the 3D renders' muted look
  against the 2D clips', not what separates the most viewed **[observed]**. Our test renders measured a brightness of
  0.06 and a dark share of 0.90, darker than nearly every trending clip: try a light-to-mid background on a few renders
  (a gradient of its own colours, `bg1` and `bg2` with `bgt` gradient: every theme's background is dark, so no theme
  gives it), and saturated colours for 2D clips, before making either a default **[inferred]**.
- **Themes.** Only "drops and piles" ranks above the rest: its 4 videos have a median view percentile of 63 against 47
  for the others (58 without the best of them). The "×5 escaping rings" and "×4.9 loops" of the first pass were both
  carried by one video, "This Ball Is Trapped in a Perfect Loop" (3.6 million views, a quarter of the pool, 96 and 98 %
  of the two themes' views), and the other "escape" was an apple bursting "out" of a grid; mazes rank high (86 against
  47) but are two videos. Battles and "vs" crashes are a third of the videos and rank below the others (32 against 61)
  **[observed]**.
- **Title formats.** A versus in 28 % of the titles ("Glass Pipes vs Soft Body"), a question in 18 %, a scale stepped up
  in 15 % ("0% vs 100% Softness", "Small to Big") and a numbered series in 13 %. Only the series is more common among the
  most viewed third (13 of the 39 titles): 23 % against 8 % of the rest ("Day 56 → 1K Subscribers"); the others are rarer
  there (a versus 15 against 35 %, a question 8 against 23 %, a scale stepped up 8 against 19 %), so they are common, not
  trending **[observed]**.
- **What the stills showed.** A big label on screen that names the variable and its level, stepped up through the clip
  (1 m FACE → 16k FACE, 0% SOFT → 100% SOFT, 9% POWER → 100% POWER), or a running counter (the rings left: 200 → 52);
  3D balls poured into a grid or a pile; escape rings and glass spirals with a counter on a black background; and often
  an empty stage in the opening frame, with the action by the first quarter **[observed]**.
- **What to make of it.** A numbered daily series; an escalation clip, the same seed with one number stepped up and a
  `progress` or `text` caption naming the level (the stills show it on screen, though titles that say so are rarer among
  the most viewed: test it); drops into a grid or a pile (`drop`, `conveyor`, `accumulation`); a
  `wallCounter` or `progress` caption on every escape and spiral clip; 11–15 s; and the playbook's motion in frame one
  still stands, as the trending openings that start empty are 3D renders we do not make **[inferred]**.

Sources: the `inspire` reports of 26 October 2026: the second pass (`.agent-out/inspiration/2026-10-26-ball-simulation/`,
`.agent-out/inspiration/2026-10-26-satisfying-physics-simulation-shorts/`), which `src/content/trends.json` sums up with
the links, and the first (the same folders with `-run1`).
