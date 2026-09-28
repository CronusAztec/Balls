# ViralBalls clone – satisfying ball physics simulator

A full-featured, editable re-creation of [viralballs.com](https://viralballs.com/en): a free, browser-based
bouncing-ball physics simulator that exports vertical MP4 clips for TikTok, Reels and Shorts.

Built with **Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · next-intl**.
Everything runs client-side: physics, rendering, audio and video encoding happen in the visitor's browser.
The site is exported as plain static files, so it deploys to **GitHub Pages** (workflow included) or any
static host – no server required.

## Features

| Area | What you get |
| --- | --- |
| **10 game modes** | Classic, Accumulation, Multiply, Lines, Paint, Target, Portal, Shatter, Color Match, Grow – each a small plugin class |
| **Physics** | Ball speed, size, gravity, bounciness ("bouncier each hit"), two balls, wall count, thickness, gap size, rotation |
| **Visuals** | Rainbow walls (gradient / pulse), ball & wall glow, colour trail, trail thickness, reactive background, camera follow, wall-break effects (confetti, shatter, shockwave, all, none), custom ball image or emoji, top/bottom text overlays, watermark |
| **Drama director** | A hidden "cinematic" layer that nudges rebounds for near-misses and dramatic escapes (toggle in advanced options) |
| **Sound** | Synthesised bounce tones, 12 built-in public-domain melodies (MIDI), custom MIDI import, custom hit samples (3 built-in clips or your own upload on every bounce, optionally pitched per wall, included in recordings), song slicer (upload any MP3/OGG/WAV/M4A and every bounce plays the next slice of it, with a song progress bar in the HUD and in the recording), custom wall-break sound clips |
| **Instruments, scales & BPM lock** | Seven bounce voices (sine, triangle, square, saw, Karplus-Strong pluck, FM marimba, chip blip) for the wall tones and, separately, for melody notes; snap every wall tone and melody note to a scale (major, minor, pentatonic, blues, whole tone) on any root note; and a beat lock that schedules sounds (voices and hit samples alike) on a 60–200 BPM grid (1/4, 1/8, 1/16) so exports sit on the beat – all shareable via the URL (`inst`, `minst`, `scale`, `root`, `qz`, `bpm`, `grid`) |
| **Recording** | MediaRecorder export in 500×500, 1280×720, 1920×1080 or 1080×1920, 10–120 s, with audio; MP4 where supported (Chrome, Safari), WebM elsewhere |
| **Find Simulation** | Deterministic, seeded physics lets the finder search for a seed whose run lasts exactly N seconds |
| **Presets & sharing** | Save/load presets in localStorage; every setting is mirrored into the URL for bookmarking and sharing |
| **Controls UX** | Collapsible sections, setting search, advanced-options toggle, per-section reset, keyboard shortcuts (Space, R), 1×–8× playback speed, FPS counter, auto-pause when off-screen |
| **Site** | Landing page (hero, mode cards, about, how-it-works, illustrated instructions, features, FAQ, blog preview), simulator page with editorial sections and troubleshooting, blog with 5 articles, About, TikTok page, Feedback form (GitHub issue / email / any form endpoint), Privacy, Terms, Disclaimer, localised 404 |
| **i18n & SEO** | English, Polish and Spanish (`/en`, `/pl`, `/es`), hreflang alternates, sitemap, robots, Open Graph, JSON-LD (WebSite, WebApplication, FAQPage, BlogPosting) |
| **Hosting** | Static export (`out/`) with base-path support, GitHub Actions workflow that lints, tests, builds and publishes to GitHub Pages, localised 404 page, root page that redirects to the visitor's language |

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000 (plus the base path, if set) → redirects to your browser's language, /en by default
npm run build      # static export into ./out (+ 404.html and .nojekyll for GitHub Pages)
npm start          # serves ./out the way GitHub Pages does (base path, 404 page, trailing slashes)
```

Copy `.env.example` to `.env.local` to configure the build. Everything is optional for local development:

- `NEXT_PUBLIC_BASE_PATH` – sub-folder the site is served from (`/Balls` on `https://user.github.io/Balls`, empty for a root deployment).
- `NEXT_PUBLIC_SITE_URL` – public URL used for canonical links, hreflang, sitemap and Open Graph, including the base path. Defaults to `http://localhost:3000` plus the base path.
- Feedback channel, first one set wins: `NEXT_PUBLIC_FEEDBACK_ENDPOINT` (an endpoint that accepts a cross-origin JSON POST, e.g. Formspree, Basin or your own worker with CORS enabled), `NEXT_PUBLIC_FEEDBACK_EMAIL` (opens the visitor's email app) or `NEXT_PUBLIC_GITHUB_REPO` (opens a prefilled GitHub issue; needs a public repository with Issues on, and visitors need a GitHub account).
- `NEXT_PUBLIC_ANALYTICS_SCRIPT_URL` / `NEXT_PUBLIC_ANALYTICS_SITE_ID` – load a privacy-friendly analytics script (Plausible, Umami, Rybbit…).

`next build` reads `.env.local`; so do `npm start`, `npm run smoke` and `npm run previews` (for `NEXT_PUBLIC_BASE_PATH`),
so a base-path build previews correctly at `http://localhost:3000/<base path>/`. You can also pass it explicitly:
`npm start -- --base /Balls` and `BASE_URL=http://localhost:3000/Balls npm run smoke`.

Other scripts:

```bash
npm run typecheck                          # tsc --noEmit
npm run lint                               # eslint
npm test                                   # vitest unit tests (engine, MIDI parser, settings, hit samples, song slicer, scales, instruments)
npm run smoke                              # headless-browser end-to-end checks; build and `npm start` first (see scripts/smoke-test.mjs)
npm run previews                           # regenerate public/modes/*.webp from the real simulator (build and `npm start` first)
python3 scripts/generate-midi.py           # regenerate the built-in melodies in public/notes
python3 scripts/generate-sounds.py         # regenerate the wall-break and hit sound effects
```

## Deploying to GitHub Pages

The repository ships with `.github/workflows/deploy.yml`:

1. **Enable Pages once**: repository *Settings → Pages → Build and deployment → Source: GitHub Actions*.
   The workflow cannot do this for you; until it is done the *deploy* job stops with a message saying so.
   Private repositories need a paid GitHub plan (Pro, Team or Enterprise) for Pages; public repositories work on
   the free plan.
2. **Push to the default branch** (or run the workflow manually from the *Actions* tab). Every push is linted,
   type-checked, unit-tested and built; pushes to the default branch are then published.
3. The site appears at `https://<user>.github.io/<repo>/` – for this repository
   `https://cronusaztec.github.io/Balls/`. The workflow reads the site URL from the repository's Pages settings
   on every run (falling back to that conventional URL while Pages is off) and builds with the matching base path.

**Feedback form**: on a public repository with Issues enabled the deployed form opens a prefilled GitHub issue
(visitors need a GitHub account). On a private repository, or to use another channel, set a repository
*Variable* (Settings → Secrets and variables → Actions → Variables): `FEEDBACK_ENDPOINT` (a form endpoint that
accepts a cross-origin JSON POST, e.g. Formspree) or `FEEDBACK_EMAIL`. Until one of these applies the form
tells visitors that no channel is configured. `ANALYTICS_SCRIPT_URL` and `ANALYTICS_SITE_ID` variables are passed
to the build the same way.

**Custom domain**: set it under *Settings → Pages → Custom domain* and point its DNS at GitHub Pages. For
Actions-based deployments GitHub ignores a `CNAME` file; the workflow picks the domain up from the Pages settings
and builds for the domain root (no base path) on the next run.

**Other static hosts** (Netlify, Cloudflare Pages, S3, nginx…): run `npm run build` with `NEXT_PUBLIC_SITE_URL`
set and upload `out/`. Point the host's "not found" page at `404.html`.

`.github/workflows/smoke.yml` builds the site under a base path and runs the browser smoke test on pull
requests and on demand.

### How the static export works

- `next.config.ts` sets `output: "export"`, `trailingSlash: true` (every page is `route/index.html`) and
  `basePath` from `NEXT_PUBLIC_BASE_PATH`.
- There is no middleware: `src/app/(static)/page.tsx` is the root page and redirects to the visitor's language
  in the browser (with a `<meta refresh>` fallback), `src/app/(static)/404/` is the localised not-found page
  and `scripts/postexport.mjs` copies it to `out/404.html`.
- `src/lib/site.ts` exposes `assetPath()` for `/public` files referenced from plain `<img>`/`fetch()` calls (Next's
  `Link`/`Image` add the base path on their own) and `pageUrl()`/`absoluteUrl()` for canonical, Open Graph and
  sitemap URLs.
- The feedback form talks to its channel directly from the browser (`src/components/site/FeedbackForm.tsx`).

## Project layout

```
messages/               en.json · pl.json · es.json – every UI string, grouped by namespace
public/
  modes/*.webp          mode preview images (generated)
  notes/*.mid           built-in melodies (generated, public domain)
  wallBreak/*.wav       built-in wall-break sounds (generated)
  hitSounds/*.wav       built-in hit samples: click, pluck, kick (generated)
scripts/                asset generators, postexport.mjs (404.html/.nojekyll), serve-static.mjs (GitHub-Pages-like server), smoke test
.github/workflows/      deploy.yml (lint · test · build · publish to GitHub Pages) · smoke.yml (browser test)
src/
  app/[locale]/         pages (landing, simulator, blog, about, tiktok-ball-videos, feedback, privacy, terms, disclaimer, not-found)
  app/(static)/         locale-less pages of the static export: "/" (language redirect) and "/404"
  app/sitemap.ts, robots.ts
  components/site/      navbar, footer, language switcher, landing sections, forms
  components/simulator/ Simulator.tsx (page state) · Canvas.tsx (renderer) · Controls.tsx (panel) · ControlPrimitives.tsx (Slider/Toggle/… helpers) · sections/*.tsx (feature blocks of the panel)
  content/              blog posts (blog.en.ts, blog.pl.ts, blog.es.ts)
  i18n/                 next-intl routing + request config
  lib/physics/          engine.ts · director.ts · types.ts · modes/*.ts
  lib/audio/            toneGenerator.ts · instruments.ts (voices) · scales.ts (scale snap + beat grid) · sampler.ts (hit samples) · slicer.ts + slicePlayer.ts (song slicer) · midi.ts · songs.ts
  lib/recording/        recorder.ts (MediaRecorder wrapper)
  lib/simulation/       finder.ts (seed search)
  lib/settings.ts       the single settings object, defaults, ranges, URL + preset serialisation
  lib/site.ts           site name/domain/accent – change these to rebrand; base-path and URL helpers
```

## How to extend it

### Add a setting
1. Add the field and its default to `SimulatorSettings` / `defaultSettings()` in `src/lib/settings.ts` (and a range in `RANGES` if it is numeric).
2. Optionally give it a short URL key in the `*_URL_KEYS` maps so it is shareable.
3. Render a control in `src/components/simulator/Controls.tsx` (use the `Slider`, `Toggle`, `ColorPicker` helpers from `ControlPrimitives.tsx` and wrap it in `Searchable` with a label key so the search box finds it; add the key to `SECTION_KEYS`). A bigger feature gets its own component in `src/components/simulator/sections/` that Controls.tsx renders inside the right section (see `SongSlicerSection.tsx`, which also exports its search keys).
4. Add the label + tooltip to every `messages/*.json` under `Controls`.
5. Apply it: either read it in `Canvas.tsx` (visual) or forward it to the engine in an effect in `Simulator.tsx` (physics).

### Add a game mode
1. Create `src/lib/physics/modes/<name>.ts` implementing `GameMode` (see `types.ts`; `classic.ts` is the minimal example, `portal.ts` a complete one). Use `ctx.random()` for randomness so the seed finder stays deterministic.
2. Register it: add the id to `MODE_IDS` in `types.ts`, instantiate it in `engine.ts` and add a case to `initMode()`.
3. Draw anything mode-specific in `Canvas.tsx` (segments, overlays, HUD counters).
4. Add the card order in `src/lib/modes.ts`, names/descriptions in `messages/*.json` (`Modes`, `Controls.mode<Name>`, `Editorial.mode<Name>`), and a preview image in `public/modes/<name>.webp` (run the preview script).

### Add a language
Add the code to `locales` and `LOCALE_OPTIONS` in `src/i18n/routing.ts`, create `messages/<code>.json` (copy `en.json`), import it in the `MESSAGES` map of `src/components/site/NotFoundStatic.tsx` (the static 404 page), add the code to the locale list in `scripts/smoke-test.mjs`, and optionally add translated posts in `src/content/blog.<code>.ts`.

### Add a blog post
Append an object to `src/content/blog.en.ts` (and translations in `blog.pl.ts` / `blog.es.ts`, same slug). Content is Markdown rendered by `src/lib/markdown.tsx`.

### Add a melody or sound
Drop a `.mid` file into `public/notes` and list it in `src/lib/audio/songs.ts` (`SONGS`); drop an audio file into `public/wallBreak` and list it in `WALL_BREAK_SOUNDS`. Wrap the paths in `assetPath()` (as the existing entries do) so they resolve under a base path.

Built-in **hit samples** (the clips that can replace the bounce tone) live in `public/hitSounds` and are listed in `HIT_SAMPLES` in `src/lib/audio/sampler.ts` with a `nameKey` under `Controls` in every `messages/*.json`. `scripts/generate-sounds.py` synthesises the shipped ones. At runtime the `HitSampler` decodes a clip once and plays it through the ToneGenerator's master gain (so recordings include it) with up to 8 voices, a 20 ms fade and a playback rate per wall from `hitSamplePlaybackRate()`; `resolveHitSoundSource()` decides between tones and sample, and the sampler reports its decode state (`idle` / `loading` / `ready` / `error`) through `ToneGenerator.setHitSampleStatusListener()`, which the panel shows under the clip picker – a clip that cannot be decoded is never a silent fallback to the tones. The settings are `hitSoundMode` (URL `hsm`), `hitSampleId` (`hs`, built-in id or `custom` for the in-session upload, which never travels in links or presets), `hitSamplePitchByWall` (`hspw`) and `hitSampleVolume` (`hsv`).

### How a wall hit becomes sound
`ToneGenerator.scheduleHit()` dispatches every bounce in this order: the **song slicer** while it has a song to play, then the **hit sample** in `sample` mode once the clip is decoded, otherwise a **synthesised voice** – the next melody note (played with `melodyInstrument`, sine by default) or the wall tone (played with `instrument`), snapped to the chosen scale. With the beat lock on, voices and hit samples alike are scheduled on the BPM grid and extra hits inside an occupied grid slot are dropped. The Sound section of the panel follows the same order (bounce sound: mode, instrument or sample; melody; scale, root note and beat lock; song slicer; wall-break sound), and controls that only apply in one mode – the sample picker, the melody instrument, the root note, the grid – are still rendered while the settings search is in use, so the search box finds them whatever the current mode is.

### Song slicer
The "each bounce plays the next bit of a song" format. `src/lib/audio/slicer.ts` holds the pure cursor arithmetic (`planSlice` picks the next slice, shortens the last one, wraps or stops at the end; `positionAt`, `sliceProgress`, `sliceCount`, `formatSongTime`) and is covered by `tests/slicer.test.ts`, which also drives a `SlicePlayer` through a fake `AudioContext` (next-bounce cut, pause/resume, switching off, reset); the smoke test checks the pause/resume position in the served export. `slicePlayer.ts` is the Web Audio side: it keeps the decoded `AudioBuffer` and the cursor, plays each slice through an `AudioBufferSourceNode` + `GainNode` with linear fades into the ToneGenerator's master gain (so recordings include it), fades out a slice that is still sounding whenever it is cut short (`stop()`: the next bounce, a pause, slicing switched off, restart, new song) and moves the cursor to the point where it was cut, so the song always continues from there and the HUD bar never jumps to the end of the cut slice. `ToneGenerator.getSlicer()` / `decodeAudio()` expose it and `scheduleHit()` hands every wall hit to the slicer first (a bounce falls back to the hit sample, tone or melody note when the slicer has nothing to play, e.g. a finished non-looping song). `Simulator.tsx` decodes the upload, mirrors the settings into the player, rewinds it on restart / mode change / preset load and pushes the song position to the canvas each frame (`CanvasHandle.setSongProgress`), where `Canvas.tsx` draws the thin progress bar along the bottom edge. The panel block lives in `components/simulator/sections/SongSlicerSection.tsx`. Settings: `sliceSong` (URL `slice`), `sliceMs` (`slms`, 80–1000 ms), `sliceLoop` (`sloop`) and `sliceFadeMs` (`slfade`); the song itself stays in memory and is not part of links or presets.

### Add an instrument or a scale
- **Instrument**: add the id to `INSTRUMENT_IDS` in `src/lib/audio/instruments.ts`, give it a loudness in `LEVEL` and a
  `play…()` recipe reached from `playVoice()` (one short Web Audio graph per note; keep per-note work small – a bounce can
  fire several times a second). Add its label key to `INSTRUMENT_LABELS` in `Controls.tsx` and `Controls.inst<Name>` to
  every `messages/*.json`. Pure DSP such as the pluck's `renderPluck()` belongs in a testable function (see
  `tests/instruments.test.ts`).
- **Scale**: add the id and its semitone intervals to `SCALE_IDS` / `SCALE_INTERVALS` in `src/lib/audio/scales.ts`, a
  label key in `SCALE_LABELS` (`Controls.tsx`) and `Controls.scale<Name>` in every message file. `quantizeFrequency()`
  picks up the new scale automatically; `tests/scales.test.ts` checks every scale only ever returns its own degrees.
- The music settings (`instrument` for the wall tones, `melodyInstrument` for melody notes, `scale`, `rootNote`,
  `quantizeToBeat`, `bpm`, `quantizeGrid`) live in `SimulatorSettings` like everything else and reach the audio through
  `ToneGenerator.setMusicSettings()`. The beat lock uses `nextGridTime()` on `AudioContext.currentTime`, anchored when
  the run starts (`resetBeatGrid()`), and drops extra hits that land in a grid slot that already has a sound. Presets and
  URL parameters validate these fields (`presetToSettings()` / `settingsFromSearchParams()`): unknown instruments,
  scales or grids fall back to the defaults, root note and BPM to their ranges.

### Rebrand
Change `SITE_NAME`, `SITE_DOMAIN` and the accent colours in `src/lib/site.ts`, the theme tokens in `src/app/globals.css`, and `public/icon.svg`.

## Browser support

Chrome, Edge and Safari export MP4; Firefox exports WebM. Recording uses `canvas.captureStream()` and
`MediaRecorder`, so it needs a recent desktop browser. The simulator itself runs anywhere `<canvas>` and
Web Audio are available.

## Notes

- The tool is free of external runtime dependencies beyond Next.js, React and next-intl.
- Uploaded images, MIDI files and sounds never leave the browser.
- Melodies shipped in `public/notes` are short public-domain themes generated from note lists in `scripts/generate-midi.py`.
