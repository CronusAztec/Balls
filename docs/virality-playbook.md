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
| **borisbounces** | 17.5K followers, 26 posts, bio "Boris always escapes. Freedom lasts about 4 seconds. New struggles daily" | one character ball with a face, a new obstacle every day (glass, multipliers, conveyors, vortex, bullseye, splat barriers, moving exits), ASMR piano notes | the character and the daily "struggle" turn physics clips into a serial; the promise in the bio (always escapes, freedom lasts 4 seconds) is the hook and the payoff **[observed]** |
| **oddplayground** | 15K followers, 389 posts, bio "Tiny random simulations. Seeds, rules, chaos." | numbered balls in a ring cutting each other's "web" strings (Web Dominion / string battles), rainbow "it doubles every time" layer breakers, pong-wars territory battles with Vortex and Bomber powers, maze escapes; neon on black, a "FLASHING LIGHTS / THE END GETS INTENSE" badge, deadpan absurdist captions | two pinned hits carry the account: the string battle (347K likes, 10K comments) and "It starts tiny and gets out of control" (137K likes, 355 comments); most other reels sit at 60 to 300 likes **[observed]** |

Patterns that repeat across all three **[observed]**:

- **A rule you understand in one second.** Every clip states its rule in the first frames, either in the picture (numbered balls, a stack of layers, a maze) or as a text pill ("Each hit x2 the power", "new sound every level", "PICK A SIDE").
- **A countdown you can feel.** Lives on the balls, layers left, a percentage bar, a timer, rings left. The viewer always knows how close the payoff is.
- **Sound as the second hook.** Bounces play notes; the pitch rises with progress ("new sound every level"); project.jdm frames the whole thing as music theory.
- **The ending is the comment engine.** oddplayground regularly cuts before the result; the top comments are "why'd you not show the winner", "who won, white or blue?" and answer requests. project.jdm's deathmatch with named contestants drew 1,099 comments. Unresolved or contested endings drive replies and re-watches **[inferred from the comments]**.
- **Series and characters over one-offs.** Named series (Rhythm Theory #2), recurring contestants, a character with a bio-level promise (Boris), daily variations of one mechanic.
- **Cadence.** oddplayground posted about one reel a day in late September 2026 (twelve reels between 22 and 28 September); borisbounces promises "new struggles daily".
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

## 4. What we do not know

- No source has data on payoff timing, on-screen counters or comment-bait wording; those rules are observations of the three accounts, not measurements.
- The guides disagree on the best length and on whether DM shares outrank watch time.
- The ballsimulator.com figures ("70 percent completion", "sound is 50 percent of virality", "1 to 3 videos a day") are marketing claims without sources.
- Nothing here replaces measurement: track average watch time, sends per reach, saves and first-hour comments per clip in Instagram Insights, and let the bot's recipe scores be corrected by what actually performs.

## 5. How the bot applies it, and what building it taught us

The bot (README, "Viral video bot") turns §3 into 15 recipes in three series that rotate day by day: **escape** (ring escape,
Pip escapes, grow until it fills, clone per pass, multipliers board, power layers), **rhythm** (pendulum wave, polyrhythm, drop
symphony, glass smash) and **battle** (string battle, territory, battle royale, square race, maze race). Every clip gets the
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

Next: feed each clip's average watch time, sends per reach, saves and first-hour comments back into the checklist weights, and
compare the resolved and cliffhanger clips the bot alternates.

Sources: instagram.com/project.jdm, instagram.com/borisbounces and instagram.com/oddplayground (profiles and 30 reel
pages, September 2026); ballsimulator.com, "How to Create Viral Bouncing Ball Videos" and "10 Pro Tips to Make Your
Bouncing Ball Videos Go Viral"; creatorflow.so, "Instagram Algorithm 2026: What Changed"; clixie.ai, "Instagram
algorithm 2026: the 4 ranking signals that matter"; reddit.com/r/learnprogramming, "how to make bouncing balls tiktok
videos" (implementation notes only).
