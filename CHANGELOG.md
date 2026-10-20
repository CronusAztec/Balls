# Changelog

The releases of JumpingBallsLive, newest first: the website ("Website x.y.z") and the Windows app ("Windows app x.y.z").
The website's version is the `version` in `package.json`, the Windows app's is the one in `desktop/package.json`.
The site shows the same list, in English, Polish and Spanish, at `/changelog`.

This file is generated from `src/content/changelog.json`. Do not edit it by hand: change the entry there, then run `npm run changelog`.
`npm run changelog:check` fails when this file is out of date.

## Website 1.12.0 · 2026-10-20

Merge Ring and Spiral Glass join the modes

### New

- Merge Ring is a new rhythm mode. Balls drop through a chute into a rainbow ring and two of the same tier fuse into the next one. The run ends with the final form or an overflow.
- Every tier has its own emblem, colour and note. A ladder beside the ring lights the tiers reached, and Find Simulation searches for the final form at your clip length.
- Spiral Glass is a new rhythm mode. Balls circle a spiral of frosted glass and chip it away from the outside in, and every lap past the badge adds a ball. The run ends when the glass is cleared.

## Windows app 1.4.1 · 2026-10-19

Third-party licences in the Help menu

### New

- Help has a Third-party licences entry. It opens the notices file: ffmpeg under the GPL with an offer of its source code, Electron, Chromium, llama.cpp, the fonts and the model licences.

### Improved

- The model list no longer offers Qwen2.5 3B, whose licence allows research only. Qwen3 4B covers that size and allows commercial use.

## Website 1.11.1 · 2026-10-19

Clearer terms, a licences page and one secure address

### New

- A third-party licences page lists the packages and fonts the site is built with, each with its licence text.

### Improved

- The terms add the EU and UK right of withdrawal, keep your consumer rights in the liability and warranty clauses, and add an age rule, AI features, how to report content and the law that applies.
- The privacy policy names the legal basis of each use, the retention periods, where the data goes, the one-month answer time and a switch that turns the action counts off in your browser.
- Plain http addresses and the www address now lead to the secure bare domain, and the site publishes a security.txt for researchers.
- Fight League division names are generic words and a fan-made badge is drawn on the canvas. The viral video bot is now the Clip planner, and it does not promise views.

## Windows app 1.4.0 · 2026-10-19

Post through Postiz, with an autopilot that proposes

### New

- The Accounts tab takes your Postiz API key. It is stored encrypted on your PC and used only with your own Postiz, where your channels are connected.
- Post with Postiz sends a clip from the Library to TikTok, Instagram or YouTube through Postiz. Every post goes out only after you approve it on a card.
- The approval card asks for the TikTok, Instagram and YouTube settings of each post, such as the audience, the comments and the title.
- The Posts tab lists what is scheduled, posted, failed and drafted in Postiz, with retry and delete.
- The autopilot proposes posts for your unposted clips, within the channels, the daily number and the quiet hours you set. It never posts by itself. Nothing goes out until you approve it.
- The AI studio has a Plan posts job that drafts proposals and sends them to the Posts tab.

## Website 1.11.0 · 2026-10-19

The Account page points to Postiz for the Windows app

### Improved

- The Account page says that an account serves the browser studio's relay, and that the Windows app connects channels in Postiz and posts from its Accounts and Posts tabs.
- The privacy policy and the terms describe posting through Postiz from the Windows app: what stays on your PC, what goes to your Postiz and whose rules apply.
- The download and pricing pages name posting through Postiz among the Windows app's Pro features, with the autopilot that proposes posts you approve.

## Website 1.10.0 · 2026-10-14

Versions, a changelog and pages ready to share

### New

- The footer shows which version and build you are on, and /version.json names the build that is live.
- A changelog page lists the releases of the website and the Windows app, newest first.
- A press page has the facts, the description in three lengths, the logo files and the brand colours.

### Improved

- Shared links to the main pages show a picture made for the page and the language, and every page has its own title and description.
- Pages open faster on phones. The landing, pricing and download pages no longer load the studio's code up front, and the offline copy downloads later, not on a slow or metered connection.
- The privacy policy, the terms, the disclaimer and the download page are clearer about cookies, what is free and what the Windows app sends.

### Fixed

- The pricing page no longer mentions PayPal, which is switched off, and no longer scrolls sideways on phones.
- Offline, a page you had not opened before now shows the offline page instead of the browser's error page.

## Windows app 1.3.0 · 2026-10-14

Your version, and what changed in it

### New

- The window title shows the app version, and says portable or safe mode when they apply.
- The About dialog lists the app version, how it is installed and the website build inside it, with Copy details and What's new buttons.
- A What's new entry in the Help menu opens the changelog.
- From the next update on, the app shows what's new in that version once, with a link to its release in the changelog.

### Improved

- The App card on the GPU tab shows the website build and the install type, with a Copy details button.
- The privacy policy and terms inside the app are updated, including what the app sends and where.

## Website 1.9.0 · 2026-10-13

Accounts, a lower price and its own web address

### New

- Accounts arrive. Sign up once and sign in on any browser or in the Windows app.

### Improved

- Pro now costs $6.99 a month or $49 a year.
- The site has its own web address, with and without www.
- Windows downloads now come from a new public installers page, and the download page links a checksum for every file.

## Windows app 1.2.0 · 2026-10-13

The AI makes fighters and modes

### New

- New fighter. Describe one and the AI builds a Fight League fighter with a weapon and an ability.
- The app tests your fighter in practice fights and balances it against the built-in fighters.
- New mode. The AI picks a base mode and tunes its settings, and you can undo it.
- The My creations list shows what you made. Play a mode, delete anything or fight with a fighter.

### Improved

- Your creations are saved on your PC only, and each list holds up to 24 of them.

## Windows app 1.1.0 · 2026-10-13

Accounts and a new update feed

### New

- The Account page lets you sign in to the same account you use on the website.

### Improved

- The installed app checks for updates soon after it starts and every four hours.
- A finished download shows a Windows notification and a banner with Restart and update. The button waits while a render is running.
- Downloads and updates now come from a new public installers page, with checksums for every file.
- Using 1.0.3 or older? Download the installer once, because those versions cannot find new updates.
- The app includes the modes added since 1.0.3, such as Focus Shot, Brick Smash and Colour Sort.

## Website 1.8.0 · 2026-10-12

Beat machines, pyramids and plainer words

### New

- Beat Machines joins the modes. Sound Vortex can now send rings of marbles down in waves.
- Land Claim can build a stepped pyramid and knock it down, summit last.
- Classic gets Ring Escape options, such as a spiral of gaps, rainbow rings and a time-in-ring display.
- Brick Smash, Perfect Fit and Wave Tank join the modes.
- The Drawing Machines mode draws with pendulums, or with Earth and Venus.

### Improved

- Every page and panel now reads shorter and plainer, in English, Polish and Spanish.
- String Battle balls stay alive while a string holds, and the last two meet in a final duel.

### Fixed

- Mode card text now reads in full on phones and small tablets.

## Website 1.7.0 · 2026-10-11

Fight League overhaul and more loops

### New

- Focus Shot and Colour Sort join the modes.
- The Double Pendulum can swing a chaos fan, and the metronome rings can wind into a Phase Spiral.
- Fight League gets a much bigger roster, sorted into divisions.
- Fight League adds team fights, best-of series, brackets and boss rushes.
- Every fight has a VS card, a countdown, its own sounds and an announcer, and ends in a slow-motion finish.
- The Make a clip button builds a fight video for you, and a tier list card ranks the fighters.

### Improved

- Fights are fairer, and they go to sudden death when time runs out.

## Website 1.6.0 · 2026-10-05

Mode pictures and the first loop clips

### New

- Every mode card shows its mode mid-action, with the payoff on screen.
- Grow can fill its ring and then start again as a loop.
- The Export whole loops option cuts a clip to a whole number of cycles.
- New original sounds for loop clips, such as plucks, tuned bars and a finishing chord.
- Chord Stars and Spinning Hoops join the modes.

### Improved

- Free visitors now see the watermark on the live canvas too. Pro removes it everywhere.

## Windows app 1.0.3 · 2026-10-05

An AI that works with small models

### New

- An AI status panel shows the runtime, the model, your cloud provider, the network and the last error.
- The Run checks button tests everything, Copy report gathers the details, and a switch forces CPU only.
- Pro plans and the small watermark on free videos arrive in the app.
- Mode pictures arrive too, along with new modes such as Conveyor Belt, Bouncing Orbs and Land Claim.

### Improved

- A first-run card helps you pick a model, and a finished download is selected for you.
- The AI shows its progress, such as Reading the request and Writing.

### Fixed

- The AI studio now works with small local models. Replies are cleaned up and checked first.
- Model downloads and cloud calls now work behind a company proxy or an antivirus that scans HTTPS.

## Website 1.5.0 · 2026-10-04

Pro plans, Bouncing Orbs and Fight League

### New

- Pro plans arrive on the pricing page. Restore a purchase on any device with your email and receipt reference.
- Free videos carry a small watermark that is drawn into the picture. Pro removes it and adds Publish.
- Bouncing Orbs fills a field with thousands of orbs that bounce on their own spot, with a metronome and polyrhythms.
- Land Claim lets balls knock blocks off columns for their colour. The most blocks wins.
- Fight League is a duel mode where each fighter is a ball with its own weapon and ability.
- String Battle gets a round String Circle style, where flag balls fan their strings to the rim.

## Website 1.4.0 · 2026-10-01

A new look and no limits

### New

- The whole site has a new calm, dark look. The studio has a control rail, a stage and a panel.
- Every slider has a number field that takes any value, and Wide sliders stretch them far past their usual range.
- Territory and Maze Escape join the modes.
- Conveyor Belt drops a new ball every few seconds. Classic and Multiply can respawn balls on a timer.
- Ring exits can jump, flee or shrink. A splat barrier leaves paint where the ball hits.
- A Windows app page offers an installer and a portable EXE.

### Improved

- Find Simulation keeps searching for up to 25 seconds when its first seeds find nothing.
- The simulation runs in one fixed world, so a seed plays the same on every screen.

## Windows app 1.0.2 · 2026-10-01

The new look and more modes

### New

- The app takes on the new calm, dark look of the site.
- Territory and Maze Escape come to the app.

### Improved

- Every slider takes any number you type.
- The simulation runs in one fixed world, so a seed plays the same on every screen.
- Find Simulation keeps searching for up to 25 seconds when its first seeds find nothing.

## Windows app 1.0.1 · 2026-10-01

Fixes for the AI and cancelled renders

### Fixed

- The local AI now starts in the installed app.
- A cancelled render no longer leaves a half-written MP4 behind.
- String Battle credits every kill when you run more than six balls.

## Windows app 1.0.0 · 2026-10-01

The first Windows app

### New

- Install it for your user only, with no administrator rights, or run the portable EXE from a folder or a USB stick.
- The whole simulator runs in the app, with no browser needed.
- The app encodes videos on your graphics card, in H.264, HEVC or AV1 where the card supports them, and falls back to the processor.
- A render queue works through seeds, share links and viral bot plans while you do something else. It saves to a folder, lets you retry failures and carries on after a restart.
- An AI studio plans clips, writes captions and hashtags and changes settings. Download a model once to run it offline, or use your own cloud key.
- A library keeps every clip you rendered, with its thumbnail, length and post text.
- The app has menus in English, Polish and Spanish, and it stays in the tray when you close the window.

## Website 1.3.0 · 2026-09-30

Races, beats and a daily challenge

### New

- Race two or four arenas on one canvas and in one recording.
- Sound Vortex, Bullseye and Journey join the modes.
- Beat Drop lands on every beat. Follow the beat of a song, a video or markers you place.
- The viral video bot plans clips with a hook in the first seconds and the payoff at the end.
- The daily challenge gives everyone one mode and one seed a day. The gallery holds ready-made setups to open.
- Install the site as an app. The home page works offline, and so does the simulator once you have opened it.
- Bounce math changes any value by a step on every bounce, gap pass or beat.
- Publish prepares a caption and hashtags for TikTok, Instagram and YouTube. It opens the share sheet on a phone, or downloads the clip and opens the upload page on a computer.

## Website 1.2.0 · 2026-09-29

Fast export, project files and more modes

### New

- Fast export renders a clip frame by frame, usually faster than real time. Batch render queues many and packs them in a ZIP.
- Save a project file with every setting, or share a short code instead of a long link.
- Place pegs, bumpers and spinners in the ring modes, and add animated captions such as countdowns.
- Choose how a run ends, such as the winner, and Find Simulation looks for it. Keyframes change settings as the clip plays.
- Square Racing Grand Prix, Square Battle Royale and Capture the Flag join the modes.
- String Battle, Power Layers and Circle Illusion join the modes.
- Beat Runner, Paddle Keep-Up and Double Pendulum Harp join the modes.

## Website 1.1.0 · 2026-09-29

Looks, faces and a camera

### New

- Ball Drop, Bouncing Shapes and Pendulum Wave join the modes.
- Metronomes & Polyrhythms brings hundreds of ticking voices, and Collision Playground hundreds of bumping orbs.
- Glass Smash and Multipliers join the modes. A ball drops through floors of glass, and gates clone balls into hundreds.
- Picture Paint reveals a picture of your own in Paint mode, and can follow the beat of a song.
- Pick one of ten themes with one click, or put your own picture behind the arena.
- Give the ball a face. It looks where it flies, blinks and reacts to hard hits.
- Put balls into teams. A scoreboard keeps score, and a winner banner appears when the run ends.
- A cinematic camera zooms in, shakes on wall breaks, slows down on near misses and replays the escape.

## Website 1.0.0 · 2026-09-28

The first release

### New

- Ring modes where a ball bounces its way out, such as Classic, Multiply and Paint.
- Record a vertical clip with sound. You get an MP4, or a WebM in browsers that cannot make one.
- Find Simulation searches for a run that lasts exactly as long as your clip needs.
- Every setting lives in the link, so you can share a setup. Presets save in your browser.
- Pick a built-in melody or one of seven instruments. Snap the notes to a scale or lock them to a tempo.
- Use your own hit sound. Slice a song so each bounce plays the next bit, or add a music bed that dips on every bounce.
- Add wind, drag and breathing walls. Let balls merge when they touch, or split each time one breaks a wall.
- The site speaks English, Polish and Spanish.
