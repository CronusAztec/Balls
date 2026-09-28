# ViralBalls clone – satisfying ball physics simulator

A full-featured, editable re-creation of [viralballs.com](https://viralballs.com/en): a free, browser-based
bouncing-ball physics simulator that exports vertical MP4 clips for TikTok, Reels and Shorts.

Built with **Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · next-intl**.
Everything runs client-side: physics, rendering, audio and video encoding happen in the visitor's browser.

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
| **Site** | Landing page (hero, mode cards, about, how-it-works, illustrated instructions, features, FAQ, blog preview), simulator page with editorial sections and troubleshooting, blog with 5 articles, About, TikTok page, Feedback form + API, Privacy, Terms, Disclaimer, 404 |
| **i18n & SEO** | English, Polish and Spanish (`/en`, `/pl`, `/es`), hreflang alternates, sitemap, robots, Open Graph, JSON-LD (WebSite, WebApplication, FAQPage, BlogPosting) |

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000 → redirects to /en
npm run build && npm start
```

Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SITE_URL` to your public URL (used for canonical
links, sitemap and Open Graph). Optional variables:

- `FEEDBACK_WEBHOOK_URL` – forward feedback submissions to Slack/Discord/Zapier/your API. Without it, feedback is appended to `data/feedback.jsonl`.
- `NEXT_PUBLIC_ANALYTICS_SCRIPT_URL` / `NEXT_PUBLIC_ANALYTICS_SITE_ID` – load a privacy-friendly analytics script (Plausible, Umami, Rybbit…).

Other scripts:

```bash
npm run typecheck                          # tsc --noEmit
npm run lint                               # eslint
node scripts/smoke-test.mjs                # headless-browser end-to-end checks (needs a running server + playwright)
node scripts/generate-mode-previews.mjs    # regenerate public/modes/*.webp from the real simulator
python3 scripts/generate-midi.py           # regenerate the built-in melodies in public/notes
python3 scripts/generate-sounds.py         # regenerate the wall-break sound effects
```

## Project layout

```
messages/               en.json · pl.json · es.json – every UI string, grouped by namespace
public/
  modes/*.webp          mode preview images (generated)
  notes/*.mid           built-in melodies (generated, public domain)
  wallBreak/*.wav       built-in wall-break sounds (generated)
scripts/                asset generators and the browser smoke test
src/
  app/[locale]/         pages (landing, simulator, blog, about, tiktok-ball-videos, feedback, privacy, terms, disclaimer, 404)
  app/api/feedback/     feedback endpoint
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
  lib/site.ts           site name/domain/accent – change these to rebrand
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
