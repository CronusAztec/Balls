import type { BlogPost } from "./blog";

export const POSTS_EN: BlogPost[] = [
  {
    slug: "every-viralballs-mode-explained",
    locale: "en",
    title: "Every ViralBalls Mode Explained — And Which One Gets the Most Views",
    description: "A walkthrough of all 10 game modes with recommended settings, what makes each one work on screen, and how to pick the right mode for your next clip.",
    date: "2026-03-28",
    readingTime: "10 min read",
    tags: ["guide", "game modes", "tutorial", "viral content", "settings", "tips"],
    content: `ViralBalls ships with **10 game modes**, and each one produces a visibly different kind of video. Choosing the mode, and then dialling in a handful of settings, is the biggest single lever you have over how a clip performs. This guide walks through every mode, explains the mechanic behind it, and lists the settings that tend to work for short-form video.

## 1. Classic

The one everybody pictures: a ball bounces inside concentric rings, each with a single gap. When it lines up with the gap it passes through, the ring breaks with your chosen effect, and the ball moves on to the next one until it escapes.

**Why it works:** pure tension and release. Viewers quietly root for the ball, and each broken ring is a small reward that keeps them watching for the next one. It is also the most instantly readable format, which matters when you have one second to stop a thumb.

**Suggested settings:**

- **Walls:** 5 to 7. Enough layers for a build-up, not so many that the clip drags.
- **Wall break effect:** "All" for maximum payoff, or Confetti for a cleaner look.
- **Bouncier each hit:** on. The ball accelerates toward a natural climax.
- **Rainbow walls:** Gradient.
- **Duration:** 15 to 20 seconds.

**Tip:** add a top text like *"Will it escape?"*. A question in the first frame reliably lifts watch time.

## 2. Accumulation

A timer counts down. When it reaches zero the ball freezes where it is and becomes a permanent obstacle, then a fresh ball spawns and the timer resets. Frozen balls pile up until the last one either escapes or gets boxed in.

**Why it works:** stakes. The shrinking space feels claustrophobic, and viewers get invested in whether the newest ball can thread the maze its predecessors left behind.

**Suggested settings:**

- **Escape time:** 3 to 4 seconds keeps the pace up.
- **Walls:** the mode uses a single ring, so focus on gap size instead: 0.3 to 0.4.
- **Spikes:** on, with 6 to 8 spikes for extra danger.
- **Duration:** 20 to 30 seconds so enough balls accumulate.

**Tip:** the final escape through a field of frozen balls is the money shot. Trim the export so the clip ends right after it.

## 3. Multiply

Every time a ball escapes the ring it spawns several new balls in the centre. One ball becomes three, three become nine, and within seconds the screen is chaos.

**Why it works:** exponential growth is hypnotic. The moment the arena floods with dozens of balls all breaking out at once draws the most "wait, what?" reactions in comments.

**Suggested settings:**

- **Spawn count:** 3. Higher values fill the screen faster but can get heavy on older devices.
- **Wall break effect:** Confetti. With this many escapes, shatter plus shockwave becomes noise.
- **Colour trail:** on. It turns the chaos into intentional-looking streaks.
- **Rainbow ball:** on, so every clone gets its own hue.
- **Duration:** 15 to 25 seconds.

## 4. Lines

Every bounce point is recorded and connected to the ball with a line, so the run slowly draws string art on the canvas.

**Why it works:** the pattern reveals itself gradually and looks like it took hours to make. These clips do well with art and design audiences.

**Suggested settings:**

- **Line colour:** white or a single bright accent, or Rainbow for a spectrum.
- **Center obstacle:** on. The centre dot adds a second bounce surface and more varied geometry.
- **Ball speed:** medium to high. More bounces per second means denser art.
- **Duration:** 20 to 30 seconds, so the pattern has time to develop.

**Tip:** leave wall rotation on. Rotating walls turn straight-line geometry into curved, spirograph-like patterns.

## 5. Paint

The ball leaves a permanent rainbow trail and a counter tracks how much of the circle has been painted. The goal is 100%.

**Why it works:** completion mechanics. A percentage ticking upward gives viewers a concrete reason to stay until the end, the same pull that makes progress bars and pressure-washing videos so satisfying.

**Suggested settings:**

- **Ball size:** larger. More area covered per bounce means a faster path to 100%.
- **Gravity:** low. The ball floats and covers the whole circle instead of pooling at the bottom.
- **Colour trail:** on (it is the point of the mode).
- **Duration:** 25 to 30 seconds.

**Tip:** the caption *"Can it reach 100%?"* consistently outperforms Paint clips without a hook.

## 6. Target

Numbered segments line the wall and must be hit in order: 10, then 9, then 8. Hit the wrong one and it flashes red; hit the right one and it breaks with an effect.

**Why it works:** it turns the simulation into a game. Near-misses create "so close!" moments, and viewers start coaching the ball in the comments.

**Suggested settings:**

- **Number of targets:** 8 to 12.
- **Wall break effect:** Shatter. The per-segment destruction reads like a mini celebration.
- **Bouncier each hit:** on, for urgency.
- **Duration:** 20 to 30 seconds.

**Tip:** frame it as a challenge with *"Can it hit them all in order?"*.

## 7. Portal

Colour-matched portal pairs sit on the wall. Touching one teleports the ball to its twin with a random exit angle. After four uses a portal pair burns out and becomes an exit.

**Why it works:** teleporting breaks the physics the viewer expects, which produces the "wait, what?" moments that drive rewatches.

**Suggested settings:**

- **Ball glow:** on. It makes the warp look intentional.
- **Colour trail:** on. The trail reveals the teleport paths as geometry.
- **Wall break effect:** Confetti.
- **Duration:** 20 to 30 seconds.

## 8. Shatter

Every wall is divided into segments with hit points. The ball damages the segment it hits, and after enough hits that segment disappears. Clear a path through every wall to escape.

**Why it works:** it is the most game-like mode, a brick-breaker in a circle. Watching a wall crumble piece by piece is deeply satisfying, and the moment a whole ring collapses is a natural rewatch point.

**Suggested settings:**

- **Walls:** 4 to 6 for a 20 to 30 second clip, or 8 to 10 for a longer build.
- **Bouncier each hit:** on. The ball digs through segments faster as it goes.
- **Rainbow walls:** Gradient. Each segment inherits a different colour, so the wall looks like stained glass being smashed.
- **Duration:** 20 to 30 seconds.

## 9. Color Match

The single ring is split into coloured segments and the ball changes colour on every bounce. A segment only breaks when the ball's colour matches it. Clear them all to escape.

**Why it works:** it adds a puzzle layer. Viewers track the ball's colour and scan the wall for a matching segment, so wrong-colour bounces build frustration and matches deliver relief.

**Suggested settings:**

- **Number of colours:** 4 or 5. Fewer colours means more frequent matches and better pacing in a short clip.
- **Bouncier each hit:** on. It resets on every match, so the speed ebbs and flows.
- **Rainbow walls:** off. The segment colours are the story here.
- **Duration:** 20 to 30 seconds.

## 10. Grow

The ball is sealed inside one large ring with no exit. Every bounce makes it slightly larger, so over time it fills more and more of the arena and the bounces come faster.

**Why it works:** it is a slow burn with an obvious question: how big can it get? The contrast between the tiny starting ball and the huge final one is inherently dramatic.

**Suggested settings:**

- **Growth rate:** 5%, the default, for smooth visible growth.
- **Center obstacle:** on for more chaotic physics.
- **Lines:** on with Rainbow. The string art filling up as the ball grows looks incredible.
- **Ball glow:** on. The glow scales with the ball.
- **Duration:** 20 to 30 seconds.

**Tip:** the caption *"How big can it get?"* drives completion rate because viewers need to see the answer.

## Which mode should you use?

- **Maximum views:** Classic or Multiply, the most proven formats with the broadest appeal.
- **Maximum comments:** Target or Color Match, because game-like rules invite strategy talk.
- **Maximum shares:** Paint or Lines, whose end results make people tag a friend.
- **Standing out:** Accumulation or Grow, which are still underused.
- **Arcade nostalgia:** Shatter.
- **Rewatches:** Portal.

The real move is to **rotate**. Post a Classic clip on Monday, Multiply on Wednesday and Color Match on Friday. Variety keeps your feed fresh, and each mode pulls in a slightly different audience, which grows your overall reach faster than repeating one format.

[Try all 10 modes now →](/en/simulator)`,
  },
  {
    slug: "10-satisfying-ball-physics-video-ideas-that-go-viral",
    locale: "en",
    title: "10 Satisfying Ball Physics Video Ideas That Go Viral",
    description: "Out of ideas? Ten proven ball-physics concepts, each with exact settings, that consistently perform on TikTok, Reels and Shorts.",
    date: "2026-03-10",
    readingTime: "7 min read",
    tags: ["content ideas", "viral videos", "TikTok", "satisfying content", "video ideas"],
    content: `Ball physics is one of the most dependable formats on short-form platforms, but not every clip lands. The ten concepts below come up again and again among the best-performing videos, and every one of them can be recreated in the simulator in a few minutes. Settings are included so you can start from a working recipe.

## 1. The Classic Escape

**Mode:** Classic · **Walls:** 15 to 20 · **Bouncier:** on

A single ball gains speed inside a stack of rings until it smashes through the last one. Viewers know it will escape but not when, and that gap is the whole clip. Add a "Will it escape?" overlay.

**Why it works:** simple premise, satisfying payoff, perfect loop.

## 2. The Colour Cascade

**Mode:** Classic · **Rainbow walls:** Gradient · **Colour trail:** on · **Ball glow:** on

The same escape, but turned up visually. Gradient rings produce a spectrum as the ball works outward, and the trail paints a pattern behind it.

**Why it works:** in a feed of muted real-world video, a neon spectrum stops the scroll on looks alone.

## 3. The Frozen Maze

**Mode:** Accumulation · **Escape time:** 4s · **Spikes:** on

Each ball that runs out of time freezes into an obstacle. After ten or so, the arena is a maze and the last ball has to thread it.

**Why it works:** escalating stakes. Every frozen ball makes the next attempt harder to watch.

## 4. The Multiplication Bomb

**Mode:** Multiply · **Spawn count:** 3 to 5 · **Ball glow:** on

Each escape spawns more balls. With spawn count at 5 the arena fills in seconds and the comments fill with exploding-head emojis.

**Why it works:** visual overload, in a good way.

## 5. The Brick Breaker

**Mode:** Shatter · **Walls:** 8 to 10 · **Rainbow walls:** Gradient

Walls made of individual bricks that chip away one by one. Unlike Classic, where a ring breaks all at once, the progress is visible the whole time.

**Why it works:** destruction is satisfying, and the broken-versus-intact segments act as a built-in progress bar.

## 6. The Colour Puzzle

**Mode:** Color Match · **Colours:** 4 to 5

The ball cycles through colours and only breaks matching segments. Viewers root for the right colour on every bounce.

**Why it works:** a cognitive hook. People are not just watching, they are predicting.

## 7. The Portal Warp

**Mode:** Portal · **Ball glow:** on · **Colour trail:** on

Teleport pads fling the ball across the arena mid-flight and the trail reveals the warp paths as geometry.

**Why it works:** breaking expected physics creates surprise, and surprise drives rewatches.

## 8. The Speed Run

**Mode:** Classic · **Walls:** 20 · **Gravity:** 800+ · **Bouncier:** on

Max out the wall count and gravity. The ball moves so fast it blurs and the rising bounce tones become a rapid-fire soundtrack. Record 15 seconds.

**Why it works:** speed creates urgency and an adrenaline rush that is hard to scroll past.

## 9. The Brand Drop

**Mode:** any · **Custom ball image:** your logo · **Top text:** your tagline · **Watermark:** @handle

Put your logo or product on the ball, your tagline over the top and your brand colours on the walls. The result is an ad that does not feel like one.

**Why it works:** genuinely entertaining branded content gets shared; a bouncing logo is a novelty.

## 10. The Prediction Challenge

**Mode:** Target · **Targets:** 8 · **Top text:** "Can it hit all targets?"

Numbered segments must be hit in order. Frame it as a challenge, end the video just before the outcome, and post the answer as part two.

**Why it works:** prediction hooks and cliffhangers are among the strongest follow drivers on TikTok.

## Bonus tips for every idea

- **Export vertical (1080×1920).** It is the native format for TikTok, Reels and Shorts.
- **Keep it to 15 to 30 seconds.** Higher completion rates earn more reach.
- **Layer trending audio after export.** The bounce sounds stay; the trending sound helps discovery.
- **Post at peak times,** typically evenings on weekdays and midday at weekends.
- **Use relevant hashtags** such as #satisfying, #physics, #oddlysatisfying and #ballbounce.
- **Make a series.** Number your videos so people binge them.

Every idea above takes under five minutes to set up. Save your favourite recipes as presets and you can publish a fresh clip every day.

[Start creating →](/en/simulator)`,
  },
  {
    slug: "ball-bouncing-simulator-free-online-physics-sandbox",
    locale: "en",
    title: "Ball Bouncing Simulator – Free Online Physics Sandbox",
    description: "What a browser-based ball bouncing simulator is, what ViralBalls adds on top of a basic physics demo, and how to get started in under a minute.",
    date: "2026-03-10",
    readingTime: "5 min read",
    tags: ["ball simulator", "physics sandbox", "free tool", "browser game", "bouncing ball"],
    content: `Looking for a **ball bouncing simulator** that runs in your browser with nothing to install? ViralBalls is a free physics sandbox for watching, tweaking and recording balls bouncing inside concentric rings, with full control over gravity, speed, colours and effects.

## What is a ball bouncing simulator?

At its simplest, a bouncing-ball simulator models how a ball falls under gravity, rebounds off surfaces and interacts with obstacles. At its most elaborate it is a chaotic show of colour, sound and destruction, which is where ViralBalls lives. Unlike physics engines aimed at game developers, it is built for anyone who wants to watch, customise and share satisfying motion: creators, teachers, designers, or people who just find it relaxing.

## Key features

### Tuneable physics

Adjust gravity from feather-light to crushing, set the ball speed, and enable increasing bounciness so the ball accelerates until it smashes through the walls. Every change applies immediately without restarting the run.

### Ten game modes

- **Classic**: the original ball-escapes-the-rings experience.
- **Accumulation**: balls that run out of time freeze into obstacles.
- **Multiply**: every escape spawns more balls.
- **Lines**: bounce points are connected into string art.
- **Paint**: the ball colours the circle and a counter tracks coverage.
- **Target**: numbered segments must be hit in order.
- **Portal**: teleport pads warp the ball across the arena.
- **Shatter**: walls are bricks with hit points.
- **Color Match**: only matching colours break segments.
- **Grow**: the ball gets bigger with every bounce.

### Visual effects

Rainbow gradient or pulsing walls, ball and wall glow, colour trails, confetti, shatter and shockwave effects, reactive backgrounds, custom ball images or emojis, and text overlays for captions and watermarks.

### Built-in video export

Record the run straight from the browser in square (500×500), HD (1280×720), Full HD (1920×1080) or vertical TikTok (1080×1920) format. No screen recorder, no post-processing.

### Presets and shareable links

Save a configuration you like and reload it in one click. The URL updates as you change settings, so you can bookmark a setup or send it to a friend.

## Who is it for?

- **Content creators** producing TikTok, Reels and Shorts clips.
- **Teachers and students** visualising gravity, elasticity and momentum.
- **Designers and artists** using the simulator as a generative art tool.
- **Anyone who wants to relax** for a few minutes.

## Getting started

1. Open the simulator.
2. Press **Start Simulator**.
3. Adjust the settings in the right-hand panel.
4. Pick a mode from the mode cards below the canvas.
5. Press **Record Video** to export a clip.

Everything runs client-side. Nothing is uploaded, and there is no sign-up.

[Try the simulator now →](/en/simulator)`,
  },
  {
    slug: "the-science-behind-why-satisfying-videos-go-viral",
    locale: "en",
    title: "The Science Behind Why Satisfying Videos Go Viral",
    description: "Prediction loops, visual ASMR, tension and release, colour and sound: the psychology behind satisfying videos and how to use it in your own clips.",
    date: "2026-03-10",
    readingTime: "8 min read",
    tags: ["psychology", "neuroscience", "viral content", "satisfying videos", "ASMR", "content strategy"],
    content: `Balls bouncing in perfect patterns, slime being stretched, sand being cut: "oddly satisfying" is one of the biggest genres on the internet. What is happening in the brain when we watch, and why is it so hard to stop? Here is a practical tour of the mechanisms, and what each one suggests for the clips you make.

## The prediction loop

Dopamine is often described as a pleasure chemical, but it behaves more like a prediction signal. While you watch a ball bounce inside rings, your brain keeps guessing: it will hit that wall next, it is about to slip through the gap. Every confirmed guess is a small reward, and every surprise is a bigger one because the brain updates its model.

Ball physics is especially effective because it is deterministic yet chaotic. The rules are real, so prediction feels possible; the complexity makes exact prediction impossible. The loop never resolves.

**For creators:** prefer setups where the outcome stays uncertain for most of the clip, such as Classic with many walls or Target mode.

## Visual ASMR

The tingling calm people associate with whispering and tapping also has a visual side. Smooth continuous motion, repetitive patterns, symmetry and colour harmony are all relaxing to track. Concentric rings, evenly spaced segments and radial patterns lean straight into the brain's preference for order, and pairing them with rising bounce tones makes the effect multi-sensory.

**For creators:** keep motion smooth, use gradient colours, and do not mute the bounce sounds.

## Tension and release

Every satisfying clip hides a story: setup, rising tension, climax, resolution. The ball starts bouncing, gets faster, misses the gap a few times, then breaks through in a burst of confetti and flies free. It is the same shape as a joke or a chorus, compressed into twenty seconds.

**For creators:** let the tension build. A ring that breaks on the first bounce is a wasted climax. Increasing bounciness and a few extra walls stretch the arc.

## The completion instinct

The Zeigarnik effect says unfinished tasks nag at us more than finished ones. A ball that has not escaped yet is an open loop, and viewers stay to close it. Modes that make progress visible, like Shatter's crumbling segments or Paint's percentage counter, amplify the pull.

**For creators:** show progress, and consider ending occasionally just before the payoff. "Part 2 tomorrow" turns an open loop into a follow.

## Colour

Warm colours grab attention and cool colours calm; a full spectrum does both in turn, which is why rainbow walls tend to out-perform single colours. Bright, saturated colours on a dark background also survive small screens and bright rooms.

**For creators:** Gradient rainbow walls on the default dark background are a safe default.

## Sound

Sound is the most underrated part of the format. Rising pitch signals progress, the irregular but physical rhythm of the bounces is easy for the brain to lock onto, and the percussive hit itself is a classic ASMR trigger. On platforms that autoplay with sound, the first bounce can hook a viewer before the visuals register.

**For creators:** keep the bounce audio in the export. Layer a trending sound on top if you like, but do not replace it.

## Why the algorithm likes it too

Satisfying clips optimise the metrics platforms reward: high completion because people watch to the end, replays because every run is a little different, shares because "you have to see this", comments because prediction hooks invite them, and very few negative signals.

## Putting it together

1. Keep the outcome uncertain for most of the clip.
2. Make progress visible.
3. Use the full spectrum.
4. Keep the bounce sounds.
5. Frame the clip as a question.
6. Occasionally end on a cliffhanger.
7. Stay between 15 and 30 seconds.

Satisfying videos are not viral by accident. Understanding why they hold attention gives you a checklist for making ones that hold it longer.

[Make your own satisfying clip →](/en/simulator)`,
  },
  {
    slug: "how-to-create-viral-ball-physics-videos",
    locale: "en",
    title: "How to Create Viral Ball Physics Videos for TikTok, Reels & Shorts",
    description: "Why bouncing-ball simulations keep blowing up on social media, and a five-step workflow for making one in the browser without editing software.",
    date: "2026-03-09",
    readingTime: "6 min read",
    tags: ["viral content", "TikTok", "social media", "tutorial"],
    content: `If you have spent any time on TikTok, Reels or Shorts you have seen them: a ball bouncing between shrinking rings, smashing through walls in a cascade of colour and sound. These clips routinely reach millions of views, and you can make your own in minutes.

## Why ball physics videos go viral

- **Pattern anticipation.** Viewers cannot look away because they are subconsciously predicting the next bounce.
- **Satisfying payoff.** The moment the ball breaks a wall, especially with confetti or a shockwave, is a small dopamine hit.
- **Infinite replayability.** The physics are chaotic, so every run is different and people rewatch.
- **Sound design.** Rising bounce tones stop the scroll before the visuals even register.
- **Short-form friendly.** A 15 to 30 second clip needs no story and fits every platform.

## What ViralBalls adds

Most ball-in-a-circle demos online are bare-bones. ViralBalls is built for creators: ten distinct modes, full visual customisation, custom ball images and text overlays, built-in melody playback, a seed finder that produces a run of an exact length, presets, and MP4 export in vertical format. It is free, with no sign-up and no watermark unless you add your own.

## Your first clip in five steps

### 1. Pick a mode

Start with **Classic** if you are new. For something more dynamic, try **Shatter** (segments break individually) or **Color Match** (the ball must hit matching colours).

### 2. Turn up the visuals

Enable **Rainbow walls** in Gradient mode, switch on **Colour trail**, and set the wall break effect to **All** for maximum impact. Prefer a cleaner look? Keep Confetti and a single accent colour.

### 3. Add text

Enable Show Advanced Options, then put a hook at the top such as *"Will it escape?"* and your handle at the bottom. The first keeps viewers watching; the second brings followers.

### 4. Set the format

Choose **1080×1920 (Vertical, TikTok)** in the Recording section and a duration of 15 to 30 seconds: short enough to hold attention, long enough for the ball to escape.

### 5. Hit record

Press Record Video. The run plays, the file downloads automatically, and you upload it to TikTok, Reels or Shorts.

## Tips for more engagement

- **Use increasing bounciness.** The ball accelerates toward a natural climax.
- **Try a custom ball.** A logo, a face or a trending meme image gets more comments.
- **Post consistently.** With presets saved, a new clip takes two minutes.
- **Keep the sound.** The bounce tones are part of the hook.
- **A/B test modes.** Some audiences love the clean geometry of Classic; others want the chaos of Multiply.

## Ideas by niche

- **Brands:** your logo as the ball, your tagline on top, your colours on the walls.
- **Sports accounts:** a football or basketball emoji and a "Will it score?" caption.
- **Satisfying pages:** all effects on, low gravity, let the visuals do the work.
- **Education:** demonstrate gravity, elasticity and conservation of energy.
- **Gaming:** Shatter and Target play like mini-games; add commentary or a prediction challenge.

## Why now

The format is proven but not yet saturated, and most creators are still screen-recording basic demos. A fully customised clip stands out immediately, and it takes zero editing skill: the simulation, the effects and the recording all happen in your browser.

[Try ViralBalls now →](/en/simulator)`,
  },
];
