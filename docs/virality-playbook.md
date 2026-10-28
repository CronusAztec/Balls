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
- after a render: 5 for motion above twice the most viewed median, 5 for no motion by 1.5 s.

80 or more is Simple, 60–79 a bit busy, below 60 busy. The watermark badge is not counted.

**The clarity gates** (`clarity.ts`):

| Gate | Passes when |
| --- | --- |
| G1 motion early | The first impact comes within 1 s (after a render: the measured first motion within 1.5 s). |
| G2 payoff lands | The payoff comes at 60–97 % with at least 0.8 s shown after it, or the cut comes 0–3 s before it with a question at the end. |
| G3 one idea | One mode since the plan, one hook, one ending (the payoff's words or a closing question, never both). |
| G4 words match the picture | The drawn hook is the clip's hook, its numbers are the clip's, a named winner is the run's, the run shows the claim. |
| G5 readable | Every text is in the safe zone, 2 lines at most, 7 words at most in the hook, 1.2 s a line, nothing over a scoreboard band. |
| G6 not too busy | Simple is 60 or more. |
| G7 length fits | The length is in a bucket the platform takes. |
| G8 rendered | At most 2 % lagged frames, and the watermark on every free clip. |

**Today's bot clips are busy** **[observed in our own planner: 19 recipes × 3 platforms × 4 plan seeds, 228 plans, the bot's
look]**. Their median Simple is 44 (15–56), while their median checklist score is 100.

- Every clip stacks the hook, the countdown and the series label in its first seconds and keeps two messages on screen for the
  whole clip.
- Every clip has the colour trail and the cinematic camera. The ring modes add wall glow, shake and the confetti wall break.
- 74 plans fail G5, 60 of them with a hook of more than 7 words (mostly Grow until it fills, Power Layers, String Battle and
  Territory). 12 fail G1 (the square race's 3-2-1). 7 fail G2 (a payoff at 97 % with 0.5 s after it) and 7 fail G7.
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

- **Ready now:** the 16 modes a recipe plays, as 20 templates. Classic and Portal also have a Gerald variant, and Fight League
  has the duel, the upset and the bracket. A template plans its recipe pinned to its own mode.
- **Hidden for now:** the other 32 modes are bound but wait for their own payoff timing and copy. So does Fight League's boss
  rush: its hook names the boss and the division in one clause of 8–9 words, more than the 7 G5 allows.
- **Unchanged:** the templates sit beside the recipes, so the daily rotation, its pinned days, the bot's own plans and every
  fingerprint stay as they were.

**The Simple look** (`SIMPLE_LOOK`; templates plan in it, the daily bot keeps its own look):

- neon on a dark gradient (#05070a to #141a24, both under the look item's 0.12 luminance), ball glow and thin single-colour
  trails;
- no wall glow, colour trail, rainbow walls, rainbow ball, reactive background, shake or confetti: a wall breaks into shards;
- every HUD switched off but the one that counts down (String Battle's panel, Fight League's HP bars), and no name label;
- one text at a time: the hook for 2.5 s, then the countdown caption until the next text, then the payoff's words or the
  closing question. No countdown caption appears where a HUD on screen counts down already;
- a hook of at most 7 words and a payoff of at most 3. A longer one keeps its own whole clauses ("Pick a side: which colour
  takes the board?" becomes "Which colour takes the board?"). The closing question gets the last 2 s, or 2.5 s on two lines;
- the series label and the rest of a long hook go in the post caption, not on the clip.

It changes look settings only. The cinematic camera stays as the mode plays it, since it moves the run. A test checks that the
Simple look leaves the seed, every other setting and the run's facts (`runFactsSync`) of every ready template as they are.

**What it costs and what it buys** **[observed in our own planner: the 19 recipes × 3 platforms × 4 plan seeds, 228 plans in
each look]**:

| | Bot look | Simple look |
| --- | --- | --- |
| Simple score, median (range) | 44 (15–56) | 91 (85–97) |
| Checklist score, median | 100 | 96 |
| Plans that pass every clarity gate | 0 | 192 |

- The checklist loses the series item's label points alone: 4 on every plan. The look item stays at 5 on every plan.
- The Simple score still charges every plan 3 for the cinematic camera. 132 plans show two messages at once for a while: a
  mode's own HUD (an arena's band, the layer count, the stage dots) beside a text.
- 36 plans still fail a gate. 12 square races fail G1: the 3-2-1-GO opens the gate at 1.8 s. 12 boss rushes fail G5 on their
  hook. 7 clips run outside their platform's buckets (G7), among them 4 brackets on Shorts. 5 payoffs land too close to the
  end, after the cut or never (G2), and 3 payoff lines stay under 1.2 s a line (G5).

**The 20 ready templates** **[observed: each on the platforms its buckets fit, 4 plan seeds, 236 plans]** have a median Simple
of 97 (86–97) and a median checklist score of 96. 219 plans pass every gate:

| Template | Simple (median) | Checklist (median) | Pass every gate |
| --- | --- | --- | --- |
| get-out-classic | 97 | 96 | 12/12 |
| get-out-classic-gerald | 97 | 96 | 12/12 |
| get-out-accumulation | 97 | 96 | 12/12 |
| get-out-portal | 97 | 96 | 12/12 |
| get-out-portal-gerald | 97 | 96 | 10/12 |
| get-out-glass | 89 | 96 | 11/12 |
| smash-power-layers | 89.5 | 96 | 12/12 |
| fill-grow | 97 | 92 | 10/12 |
| count-multiply | 97 | 92 | 12/12 |
| count-multipliers | 89 | 96 | 12/12 |
| who-wins-race | 89 | 91 | 0/12 |
| who-wins-ctf | 90 | 96 | 12/12 |
| who-wins-battle | 89.5 | 96 | 12/12 |
| who-wins-string-battle | 89 | 96 | 12/12 |
| who-wins-fight-league | 89 | 96 | 12/12 |
| who-wins-fight-league-upset | 90 | 96 | 12/12 |
| who-wins-fight-league-bracket | 92 | 90 | 8/8 |
| line-up-pendulum | 97 | 92 | 12/12 |
| line-up-polyrhythm | 97 | 96 | 12/12 |
| on-the-beat-drop | 97 | 92 | 12/12 |

- The square race fails G1 on every plan, as the bot's own race clips do. No setting skips its 3-2-1.
- Portal and Accumulation end the run with the escape. A resolved clip would show it for the recorder's 0.5 s only, under
  G2's 0.8 s, so their templates take the cliffhanger ending and cut before it.
- The other misses are seeds the search could not fit: no escape or fill found in time, or a length outside the bucket.

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
