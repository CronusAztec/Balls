# The agent toolbox (`npm run agent`)

The agent toolbox gives a coding agent, or a person, eyes on this repository. An agent can simulate a seed, check a mode's
determinism fingerprint, see a mode and the website, render a clip and measure a video file. It does all of this without
editing anything but its own output folder. Every call prints exactly one JSON result, so any agent with a shell can use it.
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
| `modes` | Every mode: id, family, English name, settings prefix, field count. With `mode`: each field's default, slider range, link key and whether the engine reads it. | `{"mode":"mergeRing"}` |
| `simulate` | One seed of a link or a mode, run in Node exactly as the seed finder runs it. It returns `finished` and `finishSec` (the finder's own time), balls per second, sound events per type, the mode's state, view and progress (JSON-safe), a NaN flag and work counts. | `{"mode":"spiralGlass","seed":12345,"seconds":10}` |
| `fingerprint` | A mode's fingerprint by the `tests/extras.test.ts` recipe (seed 12345, 600 frames) and its diff against that file's BASELINE entry. Without `mode`: every mode, equal or not. | `{"mode":"classic"}` |
| `preview` | A PNG contact sheet of a link at the given seconds, from the real page's still camera. | `{"link":"?mode=box&seed=3","times":[1,3,5]}` |
| `render` | A clip of a link through the page's own fast export, with its export digest and render result. WebM is also converted to MP4 when ffmpeg is present. | `{"mode":"classic","seed":42,"seconds":10}` |
| `site-shot` | PNG screenshots of site pages at the given widths, with page errors and a horizontal-scroll flag. | `{"pages":["/en/","/en/pricing/"],"widths":[390,1280]}` |
| `analyse` | Numeric features of a local video file: duration, fps, size, scene cuts, motion, colour, loop seam, loudness, tempo. | `{"path":".agent-out/inbox/clip.mp4"}` |
| `guard` | Runs the core guard (`npm run guard`) and returns its exit code, its report and the end of its output. | `{"plan":true}`, `{"browser":true}` |
| `explain` | Sorts a failure into a source pin, a behaviour change, a moved fingerprint, a timeout, a type or a lint error. It says which fix is legitimate and what never to do. | `{"failure":"<vitest output>"}` |
| `site-stats` | Owner-run. Aggregate website numbers from the owner's own Plausible or Umami. | `{"days":30}` |
| `postiz-probe` | Owner-run. Which analytics series the owner's Postiz returns: labels and point counts only. | `{"days":30,"posts":5}` |

A run is named by `link` (a share link, a `?c=` short link or just its query string; it is read, never fetched) or by `mode`
(its defaults). The seed is the call's `seed`, else the link's `seed=`, else 1.

`simulate` and `fingerprint` are deterministic: the same call gives byte-identical JSON. `simulate` runs the finder's
nominal 800 × 600 world unless `world` says otherwise. The page's canvas is usually another size, so a seed found on the
page can play differently here. `preview` and `render` run in the page and use its world.

## The rules every tool keeps

- **It writes its results only under `.agent-out/`.** That folder holds its own `.gitignore` (`*`), so nothing a tool
  writes ever shows in `git status`. Every file is written under a fresh name and renamed into place, so a symbolic link at
  the target (a checkout can carry one) is replaced, never written through, and a linked `.agent-out` is refused.
- **Its caches live elsewhere.** The bundled toolbox and the local export are in the agent cache outside the repository:
  `JBL_AGENT_CACHE`, else `<OS temp>/jbl-agent-<user>-<hash>`. The CLI runs code from it, so it is private: created 0700,
  and refused when it is a link, belongs to another user or others may write to it. The `guard` tool's state is the
  guard's own (`node_modules/.cache/jbl-guard`), and with `browser` the guard rebuilds the repository's `.next/` and `out/`.
- **Every path argument must resolve inside the repository**, symbolic links included. URLs (`http:`, `https:`, `data:`,
  `file:`…) are refused, never opened. To analyse a file from elsewhere, copy it to `.agent-out/inbox/` first. `explain`
  reads only test files inside `tests/`.
- **Arguments match their schema exactly.** An unknown field is refused, a field named after a JavaScript built-in such as
  `constructor` or `__proto__` too. `--json -` reads the arguments from stdin, at any length.
- **No shell.** Child processes (ffmpeg, git, next, the guard) get argument arrays.
- **No network** except the CLI's own static server on 127.0.0.1 for the browser tools. The browser is fenced to that
  server: every other request is aborted and reported as `blockedRequests`, and service workers are blocked. The two
  owner-run commands are the only exceptions, and they call only the hosts listed below.
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

`analyse` reads only a local file inside the repository and keeps only numbers. Nothing is uploaded, copied or kept.
ffmpeg opens the file as `file:` with only the file protocol and video demuxers allowed, so a playlist dressed as `.mp4`
is refused, never followed. Its ffmpeg is `FFMPEG_PATH`, else the Windows app's bundled one
(`desktop/node_modules/ffmpeg-static`, after `npm ci` in `desktop/`), else `ffmpeg` on the PATH. With none, it says so
and measures nothing.

The feature definitions are in `src/lib/videoAnalysis/features.ts`. Pictures are sampled as 16 × 16 RGB twice a second, the
rate own clips are compared at. Cuts come from scdet, loudness from ebur128 (BS.1770, like the export's normaliser), and
tempo from the app's own beat detector.

Only analyse files you made or may use. The toolbox never downloads, scrapes or screen-captures other creators' videos from
TikTok, Instagram or YouTube, and no agent may do that with it.

## guard and explain

`guard` runs the core guard, `scripts/agent/guard.mjs`, through `package.json`'s `guard` script (a plain `node <file>`
command, so no shell and no npm in between). Its arguments map onto the guard's flags: `browser` (`--browser`),
`baseline` (`--baseline`, CLI only), `plan` (`--plan`: the static checks alone, in about a second), `withSlow`
(`--with-slow`) and `base` (`--base <ref>`). It returns the exit code (0 green, 1 failed, 2 green but a higher tier is
required), the guard's own report (`.agent-out/guard-report.json`) and the end of its output. A verdict that is green only
because the baseline excused failures says so.

In the guard, a protected-path change is only reported, for the owner's review. Of the static checks, the fingerprint lock
(a changed fingerprint without a `Fingerprint-Change: <mode> - <reason>` commit trailer) and the test-weakening detector (a
finding without `Test-Change: <file or glob> - <reason>`; an added `.only` always) fail it. Both read their rules from
`protected.json` at the base commit and in the working tree, so a change cannot switch off the check it would fail. A
baseline is refused on a changed tree, and used only by a run measured from its commit or a later one. AGENTS.md has the
order to run it in.

`explain` measures which source files a failing test reads as text (16 tests read `Simulator.tsx`, `Canvas.tsx` or
`Controls.tsx`). A text assertion in such a test is a source pin: keep the pinned contract in the source. Never re-record a
fingerprint, delete an `expect(`, add `.skip` or `.only`, or raise a timeout to make a test pass.

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
repository, so a session opened in `desktop/` starts it too. Run it by hand with `npm run agent:mcp`.

It offers the CLI's tools with their JSON Schemas, but not the owner-run commands and not the guard's `baseline`, which is
CLI only. A call is checked against the schema first, then runs the CLI itself as a child process with the arguments on
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
