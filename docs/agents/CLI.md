# The agent toolbox (`npm run agent`)

The agent toolbox gives a coding agent, or a person, eyes on this repository. An agent can simulate a seed, check a mode's
determinism fingerprint, see a mode and the website, render a clip and measure a video. It can also find other creators'
trending and viral simulation videos, fetch them, look at their frames and learn from them what makes our clips better. It
does all of this without editing anything but its own output folder. Every call prints exactly one JSON result, so any agent with a shell can use it.
An optional MCP server offers the same tools to agents that take tools over MCP.

```sh
npm run -s agent -- <tool> --json '{…}'      # -s: no npm banner, so stdout is only the JSON line
node scripts/agent/cli.mjs <tool> --json '{…}' --pretty
npm run -s agent -- --help                   # every tool with its input schema
```

The result is `{"ok":true,"tool":…,"result":…}` or `{"ok":false,"tool":…,"error":…}`. The exit code is 0 (ok), 1 (the
tool failed) or 2 (a usage error: an unknown tool, bad JSON, or arguments the tool's schema refuses). Progress notes go to
stderr. The schemas live in `src/lib/agentKit/tools.ts`.

## Tools

| Tool | What it returns | Example |
| --- | --- | --- |
| `modes` | Every mode: id, family, English name, settings prefix, field count. With `mode`: each field's default, slider range, link key, whether the engine reads it, whether a link keeps it (`roundTrip`) and whether `presetToSettings` resolves it (`resolved`). A field only a link sets, never a slider or a patch, is listed too and marked `linkOnly` (Mode Lab's `blSpec`, link key `bls`). | `{"mode":"mergeRing"}` |
| `simulate` | One seed of a link or a mode, run in Node exactly as the seed finder runs it. It returns `finished` and `finishSec` (the finder's own time), balls per second, sound events per type, the mode's state, view and progress (JSON-safe), a NaN flag and work counts. | `{"mode":"spiralGlass","seed":12345,"seconds":10}` |
| `fingerprint` | A mode's fingerprint by the `tests/extras.test.ts` recipe (seed 12345, 600 frames) and its diff against that file's BASELINE entry. Without `mode`: every mode, equal or not. | `{"mode":"classic"}` |
| `preview` | A PNG contact sheet of a link at the given seconds, from the real page's still camera. | `{"link":"?mode=box&seed=3","times":[1,3,5]}` |
| `render` | A clip of a link through the page's own fast export, with its export digest and render result. WebM is also converted to MP4 when ffmpeg is present. | `{"mode":"classic","seed":42,"seconds":10}` |
| `site-shot` | PNG screenshots of site pages at the given widths (one file per page and width, numbered in the list's order), with page errors and a horizontal-scroll flag. | `{"pages":["/en/","/en/pricing/"],"widths":[390,1280]}` |
| `analyse` | Numeric features of a video, your own clip or another creator's trending one: duration, fps, size, scene cuts, motion, colour, loop seam, loudness, tempo. A file (`path`) or a link (`url`, fetched first). | `{"path":".agent-out/inbox/clip.mp4"}`, `{"url":"https://www.tiktok.com/@…/video/…"}` |
| `frames` | Frames of a video spread over it, its opening seconds in finer steps and a contact sheet of each, for a vision-capable model. A file or a link. | `{"url":"https://www.youtube.com/shorts/…","count":12}` |
| `trending` | Trending and viral videos: a YouTube search, its Shorts feed and any links you give, with views, likes, comments, length, upload date and views per day, ranked. | `{"query":"ball simulation","limit":20,"maxDurationSec":180}` |
| `fetch-video` | One video downloaded into `.agent-out/inbox/<platform>-<id>.mp4` with its info JSON and its numbers. | `{"url":"https://www.instagram.com/reel/…"}` |
| `inspire` | The whole pipeline: trending, fetch the top videos, analyse and frames for each, and a report of what separates the most viewed, in our own levers. | `{"query":"ball simulation","top":8}` |
| `guard` | Runs the core guard (`npm run guard`) and returns its exit code, its report and the end of its output. | `{"plan":true}`, `{"browser":true}` |
| `explain` | Sorts a failure into a source pin, a behaviour change, a moved fingerprint, a timeout, a type or a lint error, or one of the guard's own: a weakened test, a stale export, a missing install or browser. It says which fix is legitimate and what never to do. | `{"failure":"<vitest output>"}` |
| `bp-schema` | The Blueprint language: its JSON Schema (`form`: `full` or `lite`), the vocabulary block for prompts and the sandbox ceilings. | `{"form":"lite"}` |
| `bp-validate` | A Blueprint checked strictly: every problem as `path: sentence`, plus what the sanitizer would change, a plain summary, its size, digest and link code. | `{"spec":{…}}`, `{"catalog":"hatchery"}` |
| `bp-check` | A Blueprint played headless on seeds 1-4 on the real runtime (the engine in the blueprint mode): `playable`, `endless` or `broken`, with plain feedback and each seed's counts. Deterministic; the wall time is an advisory. | `{"catalog":"conquer"}` |
| `bp-link` | A Blueprint's link code (`b1.…`), simulator link (`?mode=blueprint&bls=…`) and short share code, with their lengths. | `{"code":"b1.…","locale":"pl"}` |
| `bp-docs` | `docs/agents/BLUEPRINTS.md` as the code generates it, and whether the committed file is current. | `{"markdown":false}` |
| `site-stats` | Owner-run. Aggregate website numbers from the owner's own Plausible or Umami. | `{"days":30}` |
| `postiz-probe` | Owner-run. Which analytics series the owner's Postiz returns: labels and point counts only. | `{"days":30,"posts":5}` |

A run is named by `link` (a share link, a `?c=` short link or just its query string; it is read, never fetched) or by `mode`
(its defaults). The seed is the call's `seed`, else the link's `seed=`, else 1. A link may be 20,000 characters long, so
the link `bp-link` writes for a Blueprint at the 6 KB ceiling (a code of about 8,000 characters) plays in `simulate`,
`preview` and `render` as it is.

`simulate` and `fingerprint` are deterministic: the same call gives byte-identical JSON. `simulate` runs the finder's
nominal 800 × 600 world unless `world` says otherwise. The page's canvas is usually another size, so a seed found on the
page can play differently here. `preview` and `render` run in the page and use its world.

## The rules every tool keeps

- **It writes its results only under `.agent-out/`.** That folder holds its own `.gitignore` (`*`), so nothing a tool
  writes ever shows in `git status`. Every file is written under a fresh name and renamed into place, so a symbolic link at
  the target (a checkout can carry one) is replaced, never written through, and a linked `.agent-out` is refused.
- **Its caches live elsewhere.** The bundled toolbox and the local export are in the agent cache outside the repository:
  `JBL_AGENT_CACHE`, else `jbl-agent/<hash>` in your own cache folder (`XDG_CACHE_HOME` or `~/.cache` on Linux,
  `~/Library/Caches` on macOS, `%LOCALAPPDATA%` on Windows), never the shared temp folder, where another user could take the
  name first. The CLI runs code from it, so it is private: created 0700, and refused when it is a link, belongs to another
  user or others may write to it. The `guard` tool's state is the
  guard's own (`node_modules/.cache/jbl-guard`), and with `browser` the guard rebuilds the repository's `.next/` and `out/`.
- **Every path argument must resolve inside the repository**, symbolic links included. A URL (`http:`, `https:`, `data:`,
  `file:`…) is not a path: give a video link as `url` (analyse, frames, fetch-video), or download it into `.agent-out/inbox/`
  first, and copy a file from elsewhere there too. `explain` reads only test files inside `tests/`.
- **Arguments match their schema exactly.** An unknown field is refused, a field named after a JavaScript built-in such as
  `constructor` or `__proto__` too. `--json -` reads the arguments from stdin, at any length.
- **No shell.** Child processes (ffmpeg, yt-dlp, git, next, the guard) get argument arrays.
- **No network** except the CLI's own static server on 127.0.0.1 for the browser tools, and the video sites yt-dlp reads for
  the video tools, with YouTube's image host for `inspire`'s stills (see
  [Learning from trending videos](#learning-from-trending-videos)). The browser is fenced to that
  server: every other request is aborted and reported as `blockedRequests`, and service workers are blocked. The two
  owner-run commands call only the hosts listed below.
- **The watermark stays.** No tool installs a licence, and the committed TEST licence stays inside the smoke harness. The
  browser opens the site as a free visitor, so pictures and clips carry the watermark exactly as a free render does. A
  picture or a clip the page reports as clean is refused and never written. `tests/agentCli.test.ts` checks this.

## The local export (preview, render, site-shot)

The browser tools look at the site as the working tree builds it, committed or not, so an agent sees its own change.
`scripts/agent/local-build.mjs` copies the working tree's site files (tracked and new, never ignored ones such as `.env`)
into the agent cache. It then runs `next build --no-lint` and `scripts/postexport.mjs` there. A build takes about a minute
on 4 CPUs.

- The build runs at the root path in test mode, with no statistics script and no `NEXT_PUBLIC_*` setting from the shell.
  Next's telemetry is off and obfuscation is skipped.
- Next's own type check is skipped through the guard's `JBL_BUILD_SKIP_TYPECHECK=1` knob in the build's environment; the
  repository's `next.config.ts` is not touched. Types are `npm run typecheck`'s and the guard's job.
- `build: "auto"` (the default) rebuilds when HEAD or any changed site file differs from the last build. `reuse` takes the
  last build as it is, and `force` always rebuilds.
- `render` needs the page's bot handle version 2 (`window.__jumpingBallsBot.renderLink`). An older export says so. The
  site's shortest clip is 10 s, and the tool renders at most 60 s.

Chromium comes from Playwright's browsers (`PLAYWRIGHT_BROWSERS_PATH`) or `CHROME_PATH`. The CLI never downloads one.

## analyse

`analyse` measures a video and returns numbers: your own clips, and the trending and viral videos of other creators on
TikTok, Instagram, YouTube or any other site, so you learn what makes them work and make the clips better. Give a file
inside the repository as `path`, or a link as `url`: the link is fetched into `.agent-out/inbox/` first (as `fetch-video`
does, a video already there is reused) and the file is then measured exactly as a path is.

```sh
npm run -s agent -- analyse --json '{"url":"https://www.tiktok.com/@…/video/…"}'
npm run -s agent -- analyse --json '{"path":".agent-out/inbox/tiktok-<id>.mp4"}'
```

Nothing is uploaded, and the tool keeps no copy of the file. ffmpeg opens the file as `file:` with only the file protocol
and video demuxers allowed, so a playlist dressed as `.mp4` is refused, never followed. Its ffmpeg is `JBL_FFMPEG` or
`FFMPEG_PATH`, else the Windows app's bundled one (`desktop/node_modules/ffmpeg-static`, after `npm ci` in `desktop/`), else
`ffmpeg` on the PATH. With none, it says so and measures nothing.

The feature definitions are in `src/lib/videoAnalysis/features.ts`. Pictures are sampled as 16 × 16 RGB twice a second, the
rate own clips are compared at. Cuts come from scdet, loudness from ebur128 (BS.1770, like the export's normaliser), and
tempo from the app's own beat detector.

## Learning from trending videos

The owner wants agents to take inspiration from trending and viral simulation videos, analyse them and make our clips and
our algorithm better. Four tools do it, with yt-dlp (`yt-dlp` on the PATH, or `JBL_YTDLP`: an executable, or a .mjs
script run with Node) and ffmpeg. Without yt-dlp they say how to install it and fetch nothing. Install it with its browser
impersonation (`pipx install "yt-dlp[default,curl-cffi]"`): TikTok answers yt-dlp without it with an error.

```sh
npm run -s agent -- trending --json '{"query":"ball simulation","limit":20,"maxDurationSec":180}'
npm run -s agent -- fetch-video --json '{"url":"https://www.youtube.com/shorts/<id>"}'
npm run -s agent -- frames --json '{"path":".agent-out/inbox/youtube-<id>.mp4"}'
npm run -s agent -- inspire --json '{"query":"ball simulation","top":8}'
```

- **`trending`** searches YouTube (`ytsearchN:`), and with `maxDurationSec` at most 180 also the query's hashtag Shorts feed
  (`ball simulation` reads `#ballsimulation`; the word "shorts" is left out, and a query whose hashtag has no feed falls back
  to the hashtag of its last two words, then its first two: `satisfying physics simulation shorts` reads
  `#physicssimulation`, and the result's `feed` says which). Links in `urls` (TikTok, Instagram, YouTube or any site) are added; yt-dlp
  cannot list TikTok's tags, so give TikTok videos as links. The best rows' own pages are then read for exact views, likes,
  comments, length and upload date (`details: false` skips that); a video found twice counts once, by the id its page names
  (a TikTok share link, vm.tiktok.com/…, and the video's own link are one video). It returns each video's link, platform, title, channel,
  views, likes, comments, length, upload date, views per day and whether it is short-form, sorted by `sortBy` (`views` or
  `viewsPerDay`), short-form first when `maxDurationSec` is at most 180. `limit` has no maximum. It writes nothing.
- **`fetch-video`** downloads one video into `.agent-out/inbox/<platform>-<id>.mp4` with `<platform>-<id>.info.json` beside
  it: the best picture up to `maxHeight` (the shorter side, default 1080, so a 1080 × 1920 short stays whole), merged into
  MP4 with ffmpeg. A video already there is reused unless `force`: when the link names the video's id, before its site is
  asked, so a blocked address or a rate limit does not stop a second run (the numbers are then its info JSON's, as they
  were when it was fetched). One video per link: yt-dlp reads the first entry of a
  playlist, channel, profile, hashtag or search page link at most (`yt-dlp --playlist-items 1`), and such a link is refused with
  an error that says so (in `trending`'s and `inspire`'s `urls` too, listed under `refused`).
- **`frames`** writes `count` frames spread over a video (default 12), its first `hookSec` seconds every `hookStepSec`
  (default 3 s every 0.25 s: the hook a viewer decides on) and a contact sheet of each, into `.agent-out/frames/<name>/`:
  sheet.png, hook-sheet.png, frame-01.png… and hook-01.png…. A model that reads images looks at the two sheets to see what
  the numbers describe. No number is refused for being large, but the work has ceilings (`FRAMES_CEILING` and
  `SHEET_TILES_CEILING` in `src/lib/videoAnalysis/ffmpegArgs.ts`): never more frames than the video has, 600 of each kind
  at most, a hook step no finer than one frame, and 120 pictures a sheet, an even pick of the frames. The result's `limited`
  says what was cut. A sheet ffmpeg cannot make comes back as null, with the frames.
- **`inspire`** runs the whole pipeline: `trending` (short-form by default), the top `top` videos fetched, measured as
  `analyse` measures a file and cut into frames, our own renders measured alike (the newest under `.agent-out/render`, or
  the folder `ours` names), and a report in `.agent-out/inspiration/<date>-<slug>/` (report.json and report.md). The
  report compares the most viewed third with the rest, per trait: length, cuts a minute, motion, the first second's
  motion (the hook), first motion, where the peak sits, brightness, saturation, dark share, the loop seam, loudness, tempo,
  sound events a second, title words and themes. It lists the patterns that separate them (medians and Spearman's rank
  correlation with views) and recommendations in our own levers: settings with their link keys (`recordingDuration` as
  `dur`, `bpm`, `captions` as `cap`…), modes, Blueprint mechanics and the tools to check them. A video that cannot be
  fetched stays in the report with its error. Every measured video is added to `.agent-out/inspiration/dataset.jsonl` (or
  `dataset`'s name) once, by its platform and id, so the dataset grows from run to run.
- **What the first live runs taught `inspire`** (October 2026, `scripts/agent/stills.mjs`). A YouTube video that cannot be
  fetched is seen through its public stills instead: YouTube's image host serves every video's opening frame, frames at
  about 25, 50 and 75% of it and its cover. They are saved in `.agent-out/frames/youtube-<id>/`, cropped to the video's
  shape, laid out on stills-sheet.png and their brightness, saturation and dark share measured (the report marks such a
  video `measured: "stills"`; `stills: false` turns this off). A short-form run (the default) compares only short-form
  videos: a long compilation is listed, marked long-form, and left out of the numbers. A theme is weighed by its videos'
  ranks, never by summed views, which one hit decides (in October one video of 3.6 million views made two themes "×5"):
  it is advice from three videos up, when their median view percentile in their list is above the other videos' with and
  without its best video; its `lift` (its share of the views over its share of the videos) only describes the list, beside
  `topShare`, the part of the theme's views its most viewed video carries. "satisfying" names the genre, not a mechanic,
  and is never advice; a theme's words leave out fillers such as "out" and "first". A pattern needs its ρ and the
  difference of the medians to point the same way. The look advice also compares our renders with all the trending clips, so a
  picture far darker than every one of them is said, and the titles' formats are counted (a question, a count of 100 or
  more, a versus, a scale stepped up such as "0% vs 100%", a numbered series).
- **`npm run trends`** sums inspire reports up for the app's AI. It is a script, not a toolbox tool, because it writes
  `src/content/trends.json`, which is committed: `npm run trends -- .agent-out/inspiration/<run> …` (a run folder or its
  report.json; `npm run trends -- --stdout <run> …` prints instead, `npm run trends -- --check` checks the committed file). The summary is dated and holds the queries,
  the sample, the numbers and patterns, the themes with their ranks, the title formats, recommendations in our levers and
  the links and titles of the most viewed videos, never a video file. Each report stays its own list: a video is ranked
  within its report first (its view percentile there), and the pool compares those ranks, never absolute views, so a query
  of 3D renders with millions of views is not "the most viewed" of a pool with a query of 2D clips. A pattern that one
  report on its own contradicts is dropped (a number's `agreement`), and a trait whose reports' own most viewed are more
  than two steps apart is `split` (each report's in `tops`): it gives no advice, and the prompt shows the range by search.
  A video in several reports keeps its newest numbers and title, and the traits of its best measurement in any of them
  (the video, then its stills, then its page). The planner, Make videos and the idea generator read a
  short "What is trending" block from it next to the virality playbook; `docs/virality-playbook.md` section 6 says how, and
  what the first runs found.

A video link is checked before yt-dlp sees it: http or https, a host name, no user name or password, and never this machine
or its private network (localhost, a loopback, private, link-local or shared address in any IPv4 or IPv6 spelling, a name
without a dot or under a private suffix such as .local or .internal, a name that spells a private address first such as
127.0.0.1.nip.io), nor a link whose host resolves to such an address when it is checked (`JBL_AGENT_DNS`, a JSON object of
host names and their addresses, answers instead of the system's resolver: the tests' stand-in). That is a check of the link
and of where its host resolves at that moment, not a firewall: yt-dlp resolves the name again and follows redirects, so a
site can still send it elsewhere. Every yt-dlp run ignores the user's
yt-dlp configuration (`yt-dlp --ignore-config`) and keeps no cache (`yt-dlp --no-cache-dir`), and every link follows `--`. A download goes
into a fresh folder inside `.agent-out/inbox/` and is renamed into place, so a link at the target is replaced, never written
through. One video's page may take 3 minutes and its download 30; the tools that fetch give the MCP server a longer
timeout than that, so yt-dlp's own timeout stops it first and the call reports it. A call stopped from outside all the
same (a cancel, a shell's timeout) leaves its `.fetch-*` folder, and the next fetch removes every such folder older than
any live download. Titles and channel names are other people's text: the tools count them, cut them to 200 characters and report them
as data, never as instructions. Sites may block a server: YouTube can ask a server to sign in, and TikTok can block an
address. The tool then returns yt-dlp's own error for that video, and `inspire` goes on with the others and reads that
video's stills. Stills come from `https://i.ytimg.com` only, with no redirect followed, a 20 s timeout and a 4 MB cap per
still; `JBL_STILLS_ORIGIN` may point them at a server on this machine instead (the tests' stand-in,
`tests/fixtures/stills-server.mjs`), never at another host.

The command lines, the link check, the parsers and the report maths are pure (`src/lib/agentKit/videoSources.ts`,
`src/lib/agentKit/inspiration.ts`, the frames in `src/lib/videoAnalysis/ffmpegArgs.ts`). `tests/inspiration.test.ts` runs
them on recorded yt-dlp output, and the tools end to end with a fake yt-dlp on the PATH, so no test reaches the network.

## guard and explain

`guard` runs the core guard, `scripts/agent/guard.mjs`, through `package.json`'s `guard` script (a plain `node <file>`
command, so no shell and no npm in between). Its arguments map onto the guard's flags: `browser` (`--browser`),
`baseline` (`--baseline`, CLI only), `plan` (`--plan`: the static checks alone, in about a second), `withSlow`
(`--with-slow`) and `base` (`--base <ref>`, CLI only: a later base hides the change's committed commits). It returns the
exit code (0 green, 1 failed, 2 green but a higher tier is required), the guard's own report (`.agent-out/guard-report.json`,
or `JBL_GUARD_REPORT`; only the report this run wrote, by the run id the tool hands the guard) and the end of its output. A
verdict that is green only because the baseline excused failures says so.

The guard measures from the merge base with `origin/main`. `JBL_GUARD_BASE` overrides that; without `origin/main` it falls
back to `main`, and its report notes any base but `origin/main`. With none of them it measures against HEAD, says so, and
asks for `--base <ref>`.

In the guard, a protected-path change is only reported, for the owner's review. Of the static checks, the fingerprint lock
(a changed fingerprint without a `Fingerprint-Change: <mode> - <reason>` commit trailer) and the test-weakening detector (a
finding without `Test-Change: <file or glob> - <reason>`; an added `.only` always) fail it. Both read their rules from
`protected.json` at the base commit and in the working tree, so a change cannot switch off the check it would fail. A
baseline is refused on a changed tree, and used only by a run measured from that very commit. AGENTS.md has the order to
run it in.

`explain` measures which source files a failing test reads as text, `Simulator.tsx`, `Canvas.tsx` and `Controls.tsx` among
them. A text assertion in such a test is a source pin: keep the pinned contract in the source. It also knows the guard's
own failures: a weakening finding (restore the test, or a `Test-Change:` trailer and owner review), a stale `out/` (rebuild
it) and a missing install or browser (install it, and change no code). Never re-record a fingerprint, delete or rewrite an
`expect(`, add `.skip` or `.only`, or raise a timeout to make a test pass.

## Blueprints (bp-schema, bp-validate, bp-check, bp-link, bp-docs)

A Blueprint is a game mode as a JSON spec, run by one sandboxed interpreter (`src/lib/blueprint/`); the language, its
ceilings and the catalog are in `docs/agents/BLUEPRINTS.md`. The tools take one Blueprint a call: `spec` (the object),
`code` (a `b1.` code, or a link or query string holding `bls=` or `blp=`; never fetched), `catalog` (a built-in id) or
`lite` (the enum-only Lite form). They write nothing; `bp-check` plays the spec on the real runtime (the engine in the
blueprint mode, as the page and the finder play it), the others load the Blueprint library alone.

A link's slider values (`blv`, which Mode Lab's Copy link always writes) are applied as the page applies them, so the tools
judge the game the link plays; `params` (the same comma-separated form, `"3,60"`) gives them for any Blueprint and takes the
place of a link's. The result's `params` then says what was applied. A link whose game cannot be read is refused.

- `bp-validate` is strict: an unknown field, a value past its domain, a dangling reference or a formula that does not compile
  is an error with its path. It also returns the tolerant sanitizer's notes: what it would drop or change to play the spec.
- `bp-check` plays the sanitized spec on seeds 1-4 and judges it on counts only (finish condition, median end, faults,
  NaN, dropped events, ARENA FULL, sounds, first motion), so its verdict and report are identical on every machine. It
  reports validation errors too, when there are any. A seed a browser tab could not play stops early, on counts alone:
  `heavy` (a second of steps costs too many work units), `slow` (the run plays in slow motion) or `crowded` (half the steps
  of a second skip ball pairs past the pair budget), so the tool always returns; `problems` names what each feedback
  sentence is about.
- `bp-docs` never writes the guide; `npm run blueprints:docs` does, and `npm run -s blueprints:docs -- --check` exits 1 while
  it is stale.

## Owner-run commands

These commands are for the owner's own machine. They run only with the owner's keys from the environment or the
git-ignored `.env` files. Without a key they print `not configured` and exit 0. The MCP server does not offer them.

- **`site-stats`**
  - Plausible: `PLAUSIBLE_API_KEY`, `PLAUSIBLE_SITE_ID` (else `JBL_ANALYTICS_SITE_ID`) and `PLAUSIBLE_HOST` (default
    `https://plausible.io`). It sends two `POST <host>/api/v2/query` calls: totals and goals for the period.
  - Umami: `UMAMI_API_KEY`, `UMAMI_WEBSITE_ID` (else `JBL_ANALYTICS_SITE_ID`) and `UMAMI_HOST`. Without a host it calls
    Umami Cloud at `https://api.umami.is/v1`. It sends `GET …/websites/<id>/stats` and `…/metrics?type=event`.
  - It prints totals and event counts only, never a visitor, a page address or a referrer.
- **`postiz-probe`** needs `POSTIZ_URL` and `POSTIZ_API_KEY`. It goes through the Windows app's own Postiz client and calls
  `GET /public/v1/integrations`, `/analytics/<channel>`, `/posts` and `/analytics/post/<post>`. It prints series labels and
  point counts only, never values, channel names or post text. Run it before the Insights work is built, to see what your
  providers really return.

The keys never appear in any output.

## MCP

`scripts/agent/mcp.mjs` is a hand-written MCP server: JSON-RPC 2.0 over stdio, one message per line, with no SDK and no new
dependency. It implements `initialize`, `ping`, `tools/list` and `tools/call`, plus the `initialized` and `cancelled`
notifications. `.mcp.json` registers it for Claude Code as `jumpingballs-agent`, and Claude Code asks each user to approve
a project server before it starts. Its entry is a one-line launcher that walks up from the session's folder to the
repository, so a session opened in `desktop/` starts it too. A client's command is `node scripts/agent/mcp.mjs` (or that
launcher). Run it by hand with `npm run -s agent:mcp`: without `-s`, npm prints its banner on stdout before the first
message, which a client cannot parse.

It offers the CLI's tools with their JSON Schemas, but not the owner-run commands and not the guard's `baseline` and `base`,
which are CLI only. The video tools are marked as reaching an open world (`openWorldHint`). It loads only the tool core (the
tool table, the argument checks, `explain`, the video analyser and the inspiration tools' pure halves; not the engine), so
it starts, lists its tools and runs `guard`, `explain`, `analyse` and the video tools while an edit has broken a mode; the
engine's tools answer with the build error then. Should the tool core itself not build, it still answers `initialize` and
`tools/list` (with the last table that built), and each call says why it cannot run. A message line longer than the largest
arguments (1 MB of JSON and its envelope) is dropped unread with an error. A call is checked against the schema first, then runs the CLI itself as a child process with the arguments on
its stdin, so a result is exactly the CLI's, a long `explain` fits, and every rule above holds. The child runs in a process
group of its own: a cancelled or timed-out call, or a stopped server, ends it with everything it started (the guard's
lanes and vitest workers, `next build`, ffmpeg). There is no exec, shell or file-write tool. A result is at most 200 KB of
text, and pictures and clips come back as repository paths.

## Decisions for the agent platform (October 2026: the guard, the toolbox, the guide)

- The MCP server is a small hand-written stdio wrapper with no new npm dependency, registered in a project `.mcp.json`. It
  exposes only the CLI's tools: no arbitrary shell, and no network except what a tool needs and documents. Results go to
  `.agent-out/`; the caches are the ones listed above (owner review: the decision first said "no writes outside the
  repository", which the temp-folder cache and the browser tier never met).
- The guard only reports protected-path changes. Of its static checks, the fingerprint lock (without its
  `Fingerprint-Change:` trailer) and the test-weakening detector (without `Test-Change:`; an added `.only` always) fail it.
- The VPS deployer's gating and the deploy job are unchanged; the guard's static checks run in the build job as
  annotations only.
- That batch changed nothing visitors see and bumped no version. The page's bot handle gained `renderLink` (version 2) for
  `render`, and the batch renderer now hands back each clip's render result.
