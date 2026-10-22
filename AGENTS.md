# AGENTS.md: working on JumpingBallsLive as a coding agent

JumpingBallsLive is a ball-physics simulator for short videos. This repository holds the website (Next.js 15 exported as
static files), the Windows app (Electron, in `desktop/`), the billing Worker (`billing/`) and the publish relay (`relay/`).
Read this file first. Codex and other agents read it on their own, and `CLAUDE.md` imports it for Claude Code.
`tests/agentDocs.test.ts` keeps it true: every command, tool, file and smoke block named here must exist, and the file
stays within 250 lines.

## Set up

```sh
npm ci                                                    # the site, the tests and the guard (Node 22)
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --prefix desktop   # the Windows app's tests and type check (no Electron binary)
npm ci --prefix billing                                   # the billing Worker's tests and type check
```

Chromium for Playwright (the browser smoke suite and the agent toolbox's browser tools) comes from `npx playwright install
chromium`, or from `PLAYWRIGHT_BROWSERS_PATH` when one is installed already. `graphify-out/` is git-ignored and stale: never
trust it over the source.

## Commands

| Command | What it does |
| --- | --- |
| `npm run guard` | The core guard, tier 0: type check, lint, the core tests and the tests your change touches, plus the static checks. No build. Exit 0 green, 1 failed, 2 green but a higher tier is required. About a minute warm, 3 minutes cold |
| `npm run guard -- --baseline` | Tier 0 on the untouched tree: records the failures that already exist, so later runs mark them pre-existing |
| `npm run guard -- --plan` | What would run, plus the static checks' findings, in about a second. Nothing runs |
| `npm run guard:browser` | Tier 1: tier 0, then a `/smoke` build, the export served on port 3101 and the core smoke blocks plus your change's |
| `npm run typecheck`, `npm run lint` | `tsc --noEmit` and ESLint for the site (`scripts/`, `desktop/` and `billing/` are outside both) |
| `npx vitest run tests/<file>.test.ts` | One test file. On a small machine add `--maxWorkers=1 --minWorkers=1` |
| `npm run test:ci` | The whole vitest suite as CI runs it (tier 2, with the four smoke shards) |
| `npm run changelog:check` | The changelog data, `CHANGELOG.md` and the version agree |
| `npm run smoke` | The browser smoke suite against a served build. `SMOKE_ONLY=core-every-mode` runs one block |
| `npm run -s agent -- <tool> --json '{…}'` | The agent toolbox: one JSON result per call (see below) |

The guard writes `.agent-out/guard-report.json`. It lists every lane with its duration, the failures, what the change
requires beyond this run (`required`), the fingerprint, protected and weakening findings, and each changed file's edit
zone together with the core functions it touches (`zones`).

## The verification protocol

1. Run `npm run guard -- --baseline` on the untouched tree.
2. Make the change.
3. Run `npm run guard` until it exits 0. If it exits 2, run what `required` lists.
4. Run `npm run guard:browser` when you touched page, canvas, recording, export or desktop page code. It adds the smoke
   blocks of the core functions your change touches.
5. A hub file (exit 2, "tier 2 required") needs `npm run test:ci` and the four smoke shards. The commands are printed, and
   `.github/workflows/deploy.yml` runs exactly them on the product branch.

Never report a subset as the whole check. If you could not run a tier, say so.

## Architecture

- **The site** is a static export (`next.config.ts`, `output: "export"`), finished by `scripts/postexport.mjs` (service
  worker, headers, obfuscation). The Worker `worker/redirects.mjs` (`wrangler.toml`) sends http to https and www to the
  bare domain, and serves the static assets.
- **Pure modules** live in `src/lib/`: no React, unit-tested in Node. `src/components/` holds the React side.
- **The engine** is `src/lib/physics/engine.ts`. It runs a fixed 60 Hz step (`FIXED_STEP_MS`) with sub-steps. A mode is a
  class that implements `GameMode` and talks to the engine only through `ModeContext` (both in `src/lib/physics/types.ts`).
  The modes live in `src/lib/physics/modes/`.
- **One draw routine.** `src/components/simulator/Canvas.tsx` draws live play, the fast export
  (`src/lib/recording/fastRender.ts`), the batch render, the bot and the Windows app's render queue. A mode drawn there is
  exported everywhere, with no `desktop/` change.
- **The settings and URL contract** (`src/lib/settings.ts`): every mode owns a 2-3 letter prefix for its fields and its
  link keys. `settingsToSearchParams` writes only values that differ from the defaults, and `settingsFromSearchParams` reads
  them back. `presetToSettings` is the final word: links, presets, project files, share codes and the app AI's patches all
  go through it.
- **The desktop bridge**: `src/lib/desktop/contract.ts` is the IPC contract that `desktop/src/preload.ts` implements.
  `src/lib/desktop/capabilities.ts` gives one capability, with a `since` version, per feature, so the page works with an
  older app.
- **The app's AI** is one model-agnostic tool-call loop, `runAgent` in `src/lib/desktop/ai/agent.ts`. New jobs plug in as an
  `AgentTask` or `AgentTool`. The studio's ports are the `StudioPorts` interface in `src/lib/desktop/ai/studio.ts`,
  implemented in `src/components/simulator/desktop/studioPorts.ts`.
- **Messages** come in three locales: `messages/en.json`, `messages/pl.json` and `messages/es.json` (next-intl, `src/i18n/`).

## Edit zones

Every changed file lands in one zone, listed in the guard report and defined in `scripts/agent/core.json` (`editZones`):

- **free**: new files, catalog data and docs that no core function owns. Tier 0 is enough.
- **core**: a file one of the 13 core functions owns (`docs/agents/CORE.md`). Tier 0, plus that function's smoke blocks in
  `npm run guard:browser`.
- **guarded**: a hub file (`hubFiles` in `core.json`, for example `src/lib/physics/engine.ts`, `src/lib/settings.ts`,
  `src/components/simulator/Canvas.tsx` and `messages/*.json`). Most of the suite imports these, so a change needs tier 2.
- **protected**: a path or region in `scripts/agent/protected.json`. It needs owner review. The guard reports it as a
  warning (an annotation in CI) and never fails on it. Say so when you hand the change over.

## Invariants

- **Determinism.** A mode takes randomness only from `ctx.random()`, and `init()` resets every field, so a seed replays
  exactly. No `Math.random`, `Date.now`, `performance.now`, `new Date` or `eval` in `src/lib/physics/modes/`
  (`tests/physicsPurity.test.ts`). Every one of the 47 modes has a fingerprint in the `BASELINE` of `tests/extras.test.ts`.
- **Uncapped.** No user number is clamped to a slider's maximum. The only ceilings are the memory and work ceilings,
  `MEMORY_CEILINGS` in `src/lib/uncap.ts` (`tests/uncap.test.ts`).
- **Watermarked.** Every free frame and every free video carries the watermark (`src/lib/watermark/`,
  `tests/freeWatermark.test.ts`, `tests/watermarkEverywhere.test.ts`).
- **Three locales.** Every message exists in en, pl and es with the same ICU arguments (`tests/i18nParity.test.ts`), within
  the budgets of `docs/COPY-STYLE.md` (`tests/copyStyle.test.ts`). Follow `docs/COPY-STYLE.md` for any copy a visitor reads.
- **One release commit.** The changelog entry (`src/content/changelog.json`), the version bump and `CHANGELOG.md`
  (`npm run changelog`) go in one commit (`docs/RELEASING.md`).
- **Privacy.** No cookies, ad tags, telemetry-named modules or scraping. No new network host without privacy copy for it
  (`tests/legalCopy.test.ts`, `tests/analytics.test.ts`).

## A new mechanic: the decision tree

1. **Data first.** Try the data-driven blocks a mode already reads: bounce math, obstacles, timeline keyframes, captions
   and teams, set through settings, links and presets. The app's AI makes a "custom mode" the same way: a base mode plus a
   settings patch (`src/lib/desktop/ai/customMode.ts`). Once the Blueprint mode of phase P4 lands, a new mechanic is a
   Blueprint: data run by one sandboxed interpreter.
2. **A gap in the vocabulary.** Add one trigger or action, with a conformance scenario, rather than a mode (from P4).
3. **Only then a coded mode.** Follow `docs/agents/MODES.md` exactly: it lists every registration point, with its file, its
   symbol and whether a type, a test or nothing catches it when it is missed.

## Never do

- Never re-record a fingerprint to make a test pass. A moved fingerprint means the mode now plays differently: find out
  why. A deliberate change needs the commit trailer `Fingerprint-Change: <mode> - <reason>` and owner review.
- Never widen an allow list: the uncap `ALLOWED`, the physics-purity `ALLOWED` or the i18n `KNOWN` list.
- Never relax a budget or raise a timeout, delete an `expect(`, or add `.skip`, `.skipIf`, `.todo` or `.only`. A legitimate
  test edit that the weakening detector flags needs `Test-Change: <file or glob> - <reason>`. An added `.only` always fails.
- Never use the TEST licence (`tests/fixtures/license-test-key.json`, `scripts/lib/test-license.mjs`) outside the unit tests
  and the smoke harness. No tool may produce an unwatermarked clip.
- Never fetch, download, scrape or screen-capture other creators' videos from TikTok, Instagram or YouTube.
- Never push, rebase, force or deploy unless the owner asks. Never change the deploy gates
  (`deploy/vps/jbl-deploy.sh`, `.github/workflows/`) on your own.

## The agent toolbox (CLI) and the MCP server

`npm run -s agent -- <tool> --json '{…}'` (`scripts/agent/cli.mjs`) prints one JSON object and exits 0 (ok), 1 (the tool
failed) or 2 (a usage error). `npm run -s agent -- --help` lists every tool with its input schema, and
`docs/agents/CLI.md` is the full guide.

| Tool | Use it to |
| --- | --- |
| `modes` | List the 47 modes, or one mode's fields with defaults, ranges and link keys |
| `simulate` | Run one seed of a link or mode headlessly, exactly as the seed finder does (deterministic) |
| `fingerprint` | Compare a mode's fingerprint with the `BASELINE` of `tests/extras.test.ts` |
| `preview` | Get a watermarked PNG contact sheet of a link from a local export of your working tree |
| `render` | Render a watermarked clip through the page's own fast export |
| `site-shot` | Take PNG screenshots of site pages at phone and desktop widths |
| `analyse` | Measure a local video file inside the repository (cuts, motion, colour, loudness, tempo) |
| `guard` | Run the core guard and return its report (`{"plan":true}` for the static checks alone) |
| `explain` | Sort a failure into a source pin, a behaviour change, a fingerprint and so on, with the legitimate fix |
| `site-stats` | Owner-run only: aggregate numbers from the owner's own Plausible or Umami |
| `postiz-probe` | Owner-run only: which analytics series the owner's Postiz returns |

Every tool writes only under `.agent-out/`, refuses paths outside the repository and URLs, starts no shell, and uses no
network except its own 127.0.0.1 server. The two owner-run tools call only the owner's own host, with the owner's key.

**MCP.** The MCP server exposes 9 tools: `modes`, `simulate`, `fingerprint`, `preview`, `render`, `site-shot`, `analyse`,
`guard` and `explain`, each with its JSON Schema. It does not offer the owner-run tools. It is `scripts/agent/mcp.mjs`, a
hand-written JSON-RPC 2.0 server over stdio with no SDK and no new dependency. A call runs the CLI as a child process, so the
result is exactly the CLI's and every rule above holds. There is no exec, shell or file-write tool, and a result is at most
200 KB.

- **Claude Code:** the project's `.mcp.json` registers the server as `jumpingballs-agent`. Claude Code asks you to approve a
  project server the first time. Approve it, or run `/mcp` to see its state.
- **Another MCP client:** start `node scripts/agent/mcp.mjs` with the repository root as the working folder, over stdio.
  `npm run agent:mcp` does the same by hand.
- **No MCP:** any agent with a shell uses the CLI directly. It is the primary interface.

## House rules

- Match the surrounding style. A feature's code carries its `// --- feature-name ---` block comments, and new files say at
  the top what they are for.
- Copy a visitor reads follows `docs/COPY-STYLE.md` and exists in all three locales.
- Never weaken or skip a test, and never trim the guard's core list (`scripts/agent/core.json`).
- On a 4-CPU machine, run vitest on targeted files with `--maxWorkers=1 --minWorkers=1`, and the full suite at most once per
  stage.
- Keep the guide true. A renamed script, file, smoke block or tool fails `tests/agentDocs.test.ts` until this file,
  `CLAUDE.md` and `docs/agents/` follow.

## Decisions the owner made for this batch

- The MCP server is a small hand-written stdio wrapper with no new npm dependency, registered in a project `.mcp.json`. It
  exposes only the CLI's tools: no arbitrary shell, no writes outside the repository, and no network except what a tool
  needs and documents.
- Protected-path changes are reported (a warning, an annotation in CI). Only a fingerprint change without its
  `Fingerprint-Change:` trailer fails the guard.
- The VPS deployer's gating and the deploy job are unchanged.
- Nothing visitors see changed, and there is no version bump.

## Read next

- `docs/agents/CORE.md`: the 13 core functions, the files each owns, and how the guard proves each one.
- `docs/agents/MODES.md`: the checklist for a coded mode.
- `docs/agents/CLI.md`: the agent toolbox and the MCP server.
- `README.md`: "How to extend it" and "Core guard". `docs/RELEASING.md` covers releases.
