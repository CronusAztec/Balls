# CLAUDE.md

@AGENTS.md

The guide above is the whole contract. What a Claude Code session must not skip:

## Before you start (cloud sessions too)

- Install all three packages: `npm ci`, then `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --prefix desktop`, then
  `npm ci --prefix billing`. Without the last two, the guard's lane B fails.
- `graphify-out/` is git-ignored and stale. Read the source.
- Run `npm run guard -- --baseline` on the untouched tree, so later runs tell old failures from yours. It is refused on a
  changed tree. On a branch already ahead of `origin/main`, later runs use it only with `--base <commit>`, the commit you
  started from.

## Must run before you hand over

- `npm run guard`: exit 0, or exit 2 with every command its report's `required` lists (a hub file always exits 2: say you
  ran tier 2, the guard cannot see it).
- `npm run guard:browser` when page, canvas, recording, export or desktop page code changed.
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
- A coded mode: `docs/agents/MODES.md`. The core functions and their proofs: `docs/agents/CORE.md`.
