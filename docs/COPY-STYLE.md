# Copy style

Every string a visitor reads follows this page: messages/*.json (site namespaces and the simulator's section intros and tooltips), src/content/gallery.ts, src/content/changelog.json (every release's headline and items), the README's opening paragraph. tests/copyStyle.test.ts enforces the hard rules.

## Voice

- Plain, short, confident, human. Write the way you would explain the thing to a friend over their shoulder.
- One idea per sentence. A sentence has one verb and rarely more than 18 words.
- Say what the viewer sees and gets. Never how the engine, the integrator, the solver, determinism or seeds work. The simulator UI may say "Same seed, same run." once.
- Concrete nouns and verbs. No superlatives, no "endlessly", "hypnotic", "mesmerising", "seamless", "effortless", "dependable".
- "Satisfying" is the genre word. It may appear in a page title or a meta description, once, never stacked with another adjective.
- No lists of every option in running copy. Name at most three things, then stop.
- Never name another creator, account, channel or clip title. The product is JumpingBallsLive and the character is Gerald.
- Never write the site name out in messages. Use {siteName}. Never write how many modes there are. Use {count}.

## Punctuation

- No dashes as punctuation: no em-dash (—) and no spaced en-dash ( – ). Full stop, comma or a new sentence instead. Ranges inside a number keep an unspaced en-dash (1–2.5 GB). Page titles keep " – {siteName}" as the title separator only.
- No semicolons.
- No parentheses in running copy (any string of 80 characters or more). A short UI label may use them ("Card (Stripe)").
- No colon lists in marketing copy. A tooltip that defines the options of one control may use "Option: what it does." lines. A status label may use a label colon ("Pro: {plan} until {date}").
- Separators in status lines are the middle dot (" · ").
- British spelling: colour, centre, customise, licence, favourite. Mode names are fixed product names and do not change (Color Match is the recorded exception).

## Budgets

- Mode card one-liner (Modes.<id>.description): 60 to 110 characters in English, at most two sentences, at most 140 characters in Polish and Spanish.
- Mode names: as they are. A new mode gets a name of one to three words in Title Case, no punctuation, British spelling.
- Section intro on a marketing page (hero sub, modes wall intro, gallery intro, about paragraphs): at most two sentences for a sub, at most four short sentences for a paragraph, never over 300 characters.
- FAQ answers and troubleshooting answers: at most three short sentences, at most 200 characters in English.
- How it works steps: one sentence, at most 110 characters.
- Simulator section intro (Controls.*Desc): at most three sentences, at most 220 characters in English, 280 in Polish and Spanish.
- Simulator tooltip: at most 300 characters in English, 380 in Polish and Spanish.
- Meta description: 70 to 160 characters as rendered, with the site name and the numbers filled in.
- Page title (`*metaTitle`): at most 60 characters as rendered, " – {siteName}" included. That leaves a headline of 41, because the separator and the name take 19.
- Social card (Seo.card.<page>): a headline of at most 42 characters and a line of at most 80, with no number of modes and no version, because the picture is committed and would go stale.

## Translations

Polish and Spanish are written as a Polish or Spanish copywriter would write them, in the same length class as the English (within about a quarter), with the same placeholders and the same rules. Never a word-for-word gloss, never left in English.

## Before and after

| Key | Before | After |
| --- | --- | --- |
| Modes.classic.description | A ball bounces inside concentric rings that each have a single gap. Every wall it slips through breaks with a satisfying effect. Simple, hypnotic and endlessly rewatchable. Make the exits jump, flee or shrink (Exit Behaviour), or let every hit leave a solid splat of paint (Splat Barrier). | One ball, a stack of rings, one gap each. Every ring it slips through breaks. Will it get out? |
| Modes.glass.description | Gerald is determined to smash all of the glass: he drops down a shaft of glass panes, every landing cracks the pane under him and plays a note, and the last hit shatters it. Stage after stage the glass gets denser and thicker, starts to slide and grows holes – until he rolls through the door marked HOME. | Gerald drops through floors of glass. Every landing cracks a pane and plays a note. The last hit shatters it. |
| Modes.orbGrid.description | Thousands of glossy orbs on a slab, each bouncing straight up and down on its own spot forever – 1089, 1936 or 4900 of them. Their tempos vary smoothly across the field, so the whole set rises from a corner, funnels into the centre or ripples in rings, falls into phase at the end of every cycle and dissolves again – polyrhythms on a metronome, every landing a soft note. | Thousands of orbs bounce on their own spot. Waves roll across the field until every orb lands together. |
| Modes.maze.description | Who else thought that was blood? Balls drop through a red slot into a seeded, green-glowing maze and bounce their way to the exit, painting every corridor they pass red. Every wall hit is a note that climbs as a ball closes in on the way out – the first ball through the exit wins. | Balls drop into a glowing maze and bounce their way out, painting every corridor red. First one out wins. |
| Editorial.modeBattle (deleted) | No rings: 2–20 squares with hit points bounce around a box or a circle and into each other. When two collide, the faster one deals damage in proportion to their closing speed; ... Seeded and deterministic, so Find Simulation can search for a battle of a given length. | Modes.battle.description: Up to 256 squares with health bars crash into each other. Last square standing wins. |
| Editorial.physicsP1 (deleted) | Every run starts from the same idea: a ball bouncing inside a ring. ... The engine steps the world sixty times per second with several sub-steps per frame, so collisions stay stable even at high speed. | (nothing: the block is gone) |
| SiteRedesign.hero.sub | Tune the physics, pick one of {count} modes and play with every setting – free, in your browser, no account. Export the vertical clip, ready to post – Pro removes the watermark. | Pick one of {count} modes, tune the physics and press play. Free, in your browser, no account. Export a vertical clip ready to post. Pro removes the watermark. |
| HowItWorks.step1.description | Choose one of {count} modes: escape rings, rhythm machines, duels and journeys. | Choose one of {count} modes. Rings to escape, rhythm machines, duels and journeys. |
| FAQ.q1.answer | Yes: every mode, every customisation option, the sound and Find Simulation – and recording and exporting the videos – with no account to create. Videos made for free carry a small watermark; Pro removes it for $10 a month or $79 a year. | Yes. Every mode, every setting and recording are free, with no account. Free videos carry a small watermark, and Pro removes it for {monthly} a month or {yearly} a year. |
| Billing.lede | Every mode, every setting and every sound is free, without an account – and so is making the videos: Record Video, the fast export, batch renders, the viral bot's renders and the desktop app's render queue work for everyone. Videos made on Free carry a small watermark; Pro exports them without it and adds Publish. | Every mode, every setting and every sound is free, with no account. So is making videos. Free videos carry a small watermark. Pro exports them clean and adds quick share to TikTok, Instagram and YouTube. |
| Billing.account.free | Free – your videos carry a watermark | Free: your videos carry a watermark |
| About.p3 | Speed and control, more than anything else. Speed, because the gap between an idea and a posted video is where most content dies; if a clip takes twenty minutes and three apps, you stop making clips. Control, because reposted content does not grow an account. When you set the mode, the colours, the pacing and the hook yourself, the video is yours and it stands a real chance in a feed that has seen every recycled clip. | Speed and control. Speed, because a clip that takes twenty minutes and three apps never gets made. Control, because a video you shaped yourself stands out in a feed full of reposts. |
| TikTokBallVideos.p4 | There is no dialogue, no face on screen and no setup. Just a clean visual hook that works even as background noise for a scrolling viewer, which is why the format regularly out-performs more produced content in the discovery feed. | No dialogue, no face, no setup. A clean visual hook that works even for someone half-scrolling. |
| Controls.sbDesc | oddplayground's WEB DOMINION: every wall bounce anchors a glowing thread from the ring to the ball, the threads follow their balls, and the combat rule decides who pays for crossing them. The last ball standing wins. | Every wall bounce anchors a glowing thread from the ring to the ball. The combat rule decides who pays for crossing a thread. The last ball standing wins. |
| Controls.exitBehaviorTip | How every ring’s exit moves. Rotate: ... Shrink: it narrows until it shuts, then opens again somewhere else. Deterministic: seeds, links and Find Simulation include it. | How every ring's exit moves. Rotate: it turns with its ring. Jump: it teleports to another spot every few seconds, or as soon as the ball gets close. Flee: it runs away from the ball along the ring. Shrink: it narrows until it shuts, then opens again somewhere else. Same seed, same run. |
| Desktop.intro | Everything the simulator does in the browser, plus what a browser can't: your GPU renders and encodes the videos, a render queue works through batches while you do something else, and an AI studio – running on your PC, offline – plans clips, writes captions and changes settings for you. | Everything the simulator does in the browser, plus what a browser cannot. Your graphics card encodes the videos, a queue works through batches while you do something else, and an AI studio on your PC plans clips and writes captions, offline. |
