# CLAUDE.md

@AGENTS.md

The guide above is the whole contract. What a Claude Code session must not skip:

## Before you start (cloud sessions too)

- Install all three packages: `npm ci`, then `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --prefix desktop`, then
  `npm ci --prefix billing`. Without the last two, the guard's lane B fails and `--baseline` is refused.
- Chromium for Playwright: `npx playwright install chromium`, unless `PLAYWRIGHT_BROWSERS_PATH` names one. Tier 0 needs it:
  its tests run with `JBL_REQUIRE_BROWSER=1`, so `tests/masterBus.test.ts` fails without a browser.
- `graphify-out/` is git-ignored and stale. Read the source.
- Run `npm run guard -- --baseline` on the untouched tree, so later runs tell old failures from yours. It is refused on a
  changed tree, and a later run uses it only when it measures from that very commit. On a branch already ahead of
  `origin/main`, pass `--base <commit>`, the commit you started from.

## Must run before you hand over

- `npm run guard`: exit 0, or exit 2 with every command its report's `required` lists (a hub file always exits 2: run the
  tier-2 commands it prints and say so, or say that tier 2 did not run; never push to have CI run them, a push deploys).
- `npm run guard:browser` when page, canvas, recording, export or desktop page code changed, or when `required` lists it
  (a core-zone file).
- `npm run typecheck` and `npm run lint` if the guard could not run.
- Say what you did not run and why.

## House rules

- Follow `docs/COPY-STYLE.md` for any copy a visitor reads, in en, pl and es.
- Match the surrounding style, including the `// --- feature-name ---` block comments.
- Never weaken or skip a test, never re-record a fingerprint to make a test pass, never widen an allow list.
- Never push or rebase unless asked.
- On a 4-CPU machine: `npx vitest run <files> --maxWorkers=1 --minWorkers=1`, and the full suite at most once per stage.
- A protected path (`scripts/agent/protected.json`) needs owner review: name it in your summary.

## Tools

- The agent toolbox: `npm run -s agent -- <tool> --json '{…}'` (`docs/agents/CLI.md`).
- The MCP server `jumpingballs-agent` (`.mcp.json`) offers the same tools once you approve it in Claude Code.
- A new mechanic as data: `docs/agents/BLUEPRINTS.md`. A coded mode: `docs/agents/MODES.md`. The core functions and their
  proofs: `docs/agents/CORE.md`.
