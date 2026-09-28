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
| **Sound** | Synthesised bounce tones, 12 built-in public-domain melodies (MIDI), custom MIDI import, custom wall-break sound clips |
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
npm run dev        # http://localhost:3000 → redirects to /en
npm run build      # static export into ./out (+ 404.html and .nojekyll for GitHub Pages)
npm start          # serves ./out the way GitHub Pages does (base path, 404 page, trailing slashes)
```

Copy `.env.example` to `.env.local` to configure the build. Everything is optional for local development:

- `NEXT_PUBLIC_SITE_URL` – public URL used for canonical links, hreflang, sitemap and Open Graph (include the base path).
- `NEXT_PUBLIC_BASE_PATH` – sub-folder the site is served from (`/Balls` on `https://user.github.io/Balls`, empty for a root deployment).
- Feedback channel, first one set wins: `NEXT_PUBLIC_FEEDBACK_ENDPOINT` (any JSON POST endpoint such as Formspree or your own worker), `NEXT_PUBLIC_FEEDBACK_EMAIL` (opens the visitor's email app) or `NEXT_PUBLIC_GITHUB_REPO` (opens a prefilled GitHub issue).
- `NEXT_PUBLIC_ANALYTICS_SCRIPT_URL` / `NEXT_PUBLIC_ANALYTICS_SITE_ID` – load a privacy-friendly analytics script (Plausible, Umami, Rybbit…).

Other scripts:

```bash
npm run typecheck                          # tsc --noEmit
npm run lint                               # eslint
npm test                                   # vitest unit tests (engine, MIDI parser, settings)
npm run smoke                              # headless-browser end-to-end checks against the served export (see scripts/smoke-test.mjs)
npm run previews                           # regenerate public/modes/*.webp from the real simulator
python3 scripts/generate-midi.py           # regenerate the built-in melodies in public/notes
python3 scripts/generate-sounds.py         # regenerate the wall-break sound effects
```

## Deploying to GitHub Pages

The repository ships with `.github/workflows/deploy.yml`:

1. **Enable Pages once**: repository *Settings → Pages → Build and deployment → Source: GitHub Actions*
   (the workflow also tries to enable it on its first run). Private repositories need a paid GitHub plan for
   Pages; public repositories work on the free plan.
2. **Push to the default branch** (or run the workflow manually from the *Actions* tab). Every push is linted,
   type-checked, unit-tested and built; pushes to the default branch are then published.
3. The site appears at `https://<user>.github.io/<repo>/` – for this repository
   `https://cronusaztec.github.io/Balls/`. The workflow works out the URL and base path by itself, and it sets
   the feedback form to open issues on the same repository.

Optional repository *Variables* (Settings → Secrets and variables → Actions → Variables) are passed to the
build: `FEEDBACK_ENDPOINT`, `FEEDBACK_EMAIL`, `ANALYTICS_SCRIPT_URL`, `ANALYTICS_SITE_ID`.

**Custom domain**: add `public/CNAME` containing the domain (e.g. `viralballs.example.com`) and point its DNS at
GitHub Pages. The workflow detects the file and builds for the domain root (no base path).

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
scripts/                asset generators, postexport.mjs (404.html/.nojekyll), serve-static.mjs (GitHub-Pages-like server), smoke test
.github/workflows/      deploy.yml (lint · test · build · publish to GitHub Pages) · smoke.yml (browser test)
src/
  app/[locale]/         pages (landing, simulator, blog, about, tiktok-ball-videos, feedback, privacy, terms, disclaimer, not-found)
  app/(static)/         locale-less pages of the static export: "/" (language redirect) and "/404"
  app/sitemap.ts, robots.ts
  components/site/      navbar, footer, language switcher, landing sections, forms
  components/simulator/ Simulator.tsx (page state) · Canvas.tsx (renderer) · Controls.tsx (panel)
  content/              blog posts (blog.en.ts, blog.pl.ts, blog.es.ts)
  i18n/                 next-intl routing + request config
  lib/physics/          engine.ts · director.ts · types.ts · modes/*.ts
  lib/audio/            toneGenerator.ts · midi.ts · songs.ts
  lib/recording/        recorder.ts (MediaRecorder wrapper)
  lib/simulation/       finder.ts (seed search)
  lib/settings.ts       the single settings object, defaults, ranges, URL + preset serialisation
  lib/site.ts           site name/domain/accent – change these to rebrand; base-path and URL helpers
```

## How to extend it

### Add a setting
1. Add the field and its default to `SimulatorSettings` / `defaultSettings()` in `src/lib/settings.ts` (and a range in `RANGES` if it is numeric).
2. Optionally give it a short URL key in the `*_URL_KEYS` maps so it is shareable.
3. Render a control in `src/components/simulator/Controls.tsx` (use the `Slider`, `Toggle`, `ColorPicker` helpers and wrap it in `Searchable` with a label key so the search box finds it; add the key to `SECTION_KEYS`).
4. Add the label + tooltip to every `messages/*.json` under `Controls`.
5. Apply it: either read it in `Canvas.tsx` (visual) or forward it to the engine in an effect in `Simulator.tsx` (physics).

### Add a game mode
1. Create `src/lib/physics/modes/<name>.ts` implementing `GameMode` (see `types.ts`; `classic.ts` is the minimal example, `portal.ts` a complete one). Use `ctx.random()` for randomness so the seed finder stays deterministic.
2. Register it: add the id to `MODE_IDS` in `types.ts`, instantiate it in `engine.ts` and add a case to `initMode()`.
3. Draw anything mode-specific in `Canvas.tsx` (segments, overlays, HUD counters).
4. Add the card order in `src/lib/modes.ts`, names/descriptions in `messages/*.json` (`Modes`, `Controls.mode<Name>`, `Editorial.mode<Name>`), and a preview image in `public/modes/<name>.webp` (run the preview script).

### Add a language
Add the code to `locales` and `LOCALE_OPTIONS` in `src/i18n/routing.ts`, create `messages/<code>.json` (copy `en.json`), and optionally add translated posts in `src/content/blog.<code>.ts`.

### Add a blog post
Append an object to `src/content/blog.en.ts` (and translations in `blog.pl.ts` / `blog.es.ts`, same slug). Content is Markdown rendered by `src/lib/markdown.tsx`.

### Add a melody or sound
Drop a `.mid` file into `public/notes` and list it in `src/lib/audio/songs.ts` (`SONGS`); drop an audio file into `public/wallBreak` and list it in `WALL_BREAK_SOUNDS`.

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
