# The core functions and how the guard proves them

A change must never break these 13 core functions. Each one owns some code, and the core guard (`npm run guard`,
`scripts/agent/guard.mjs`) has a way to prove each one. The data lives in `scripts/agent/core.json` under `coreFunctions`
and `editZones`, and this page explains it. `tests/agentDocs.test.ts` checks that the two agree: every function has its
section here, and every test, smoke block and file named exists.

## How the guard proves anything

| Tier | Command | What runs | Time on 4 CPUs |
| --- | --- | --- | --- |
| 0 | `npm run guard` | Lane A: the incremental type check (declarations to the guard's cache: a body-only edit re-checks no dependents). Lane B: ESLint (cached), `node --check` on the scripts, the desktop app's and the billing Worker's type checks and tests. Lane C: one vitest run of the core list plus the tests that import a changed file, then `changelog --check` and `smoke-test.mjs --list`. Before the lanes: the fingerprint lock, the protected-path report and the test-weakening detector | About 40 s warm with nothing changed, under 1 min with a full set of related tests, under 3 min cold |
| 1 | `npm run guard:browser` | Tier 0, then a `/smoke` build without Next's own type check, the export served on port 3101, and the smoke blocks: `core.json`'s `browser.smoke` list, the escalated feature blocks, and the blocks of every core function the change touches | 5 to 6 min |
| 2 | printed, never run by the guard | `JBL_REQUIRE_BROWSER=1 npm run test:ci`, a `/smoke` build and the four smoke shards: the commands `.github/workflows/deploy.yml` runs on the product branch, to run locally | About an hour of CI time |

Every unit test named below is on the core list (`vitest.core` in `core.json`), so tier 0 runs it on every change.
"Always in tier 1" means the block is on `browser.smoke`. "Tier 1 when touched" means `guard:browser` adds the block when
the change touches that function's code, and tier 2 runs it in any case. Either way, a change to a function's code or to one
of its unit tests requires tier 1: tier 0 alone exits 2, and its `required` lists `npm run guard:browser`.

## Edit zones

The guard report (`.agent-out/guard-report.json`, key `zones`) puts every changed file in one zone and lists the core
functions the change touches:

- **free**: a file no core function owns, no hub file and nothing protected: new files, catalog data, docs. Tier 0.
- **core**: a file one of the functions below owns: its code, or one of its unit tests. Tier 0, plus the function's smoke
  blocks in tier 1: the guard exits 2 until `npm run guard:browser` ran them.
- **guarded**: a hub file (`hubFiles` in `core.json`). Tier 2 is required: the guard exits 2 for any hub change and prints
  the tier-2 commands. Run them locally and say so in your hand-over, or say that tier 2 did not run so the owner can decide
  (never push to have CI run them: a push to the product branch deploys the site); the guard cannot see that they ran.
- **protected**: a file the protected-path report flagged (`scripts/agent/protected.json`). Owner review is required. It is
  reported, never a failure: a warning in the report, and a GitHub annotation on every push. The guard's rules come from
  `protected.json` at the base commit and in the working tree, so a rule a change removes still applies until it is merged.

## The 13 functions

### 1. The site serves (`site-serves`)

The static export builds every page in every locale. The Worker answers with https, the bare domain and the security
headers, and the build names its commit.

- **Code:** `next.config.ts`, `src/app/**`, `src/components/site/**`, `src/i18n/**`, `worker/**`, `wrangler.toml`,
  `public/_headers`, `scripts/postexport.mjs`, `scripts/serve-static.mjs`, `scripts/obfuscate.mjs`, `scripts/lib/build-info.cjs`.
- **Unit tests:** `tests/siteStatic.test.ts`, `tests/staticHeaders.test.ts`, `tests/workerRedirects.test.ts`,
  `tests/obfuscate.test.ts`, `tests/buildInfo.test.ts`, `tests/clientMessages.test.ts`.
- **Smoke blocks:** `static-hosting` and `pages` (always in tier 1).
- **Also:** lane A's type check, and lane B's `node --check` on `scripts/**/*.mjs` and `worker/*.mjs`.

### 2. Start a run (`start-a-run`)

The simulator page opens, Start runs the engine at a fixed 60 Hz step, and the controls and the search apply settings to it.

- **Code:** `src/components/simulator/Simulator.tsx`, `src/components/simulator/Controls.tsx`,
  `src/components/simulator/ControlPrimitives.tsx`, `src/components/simulator/panelKeys.ts`,
  `src/components/simulator/sections/**`, `src/lib/physics/engine.ts`, `src/lib/physics/types.ts`.
- **Unit tests:** `tests/engine.test.ts`, `tests/engineCore.test.ts`, `tests/docsConsistency.test.ts`,
  `tests/uiI18nReview.test.ts`.
- **Smoke blocks:** `studio-basics`, `modes` and `mode-card` (always in tier 1).
- **Also:** lane A's type check catches a mode missing from a `Record<ModeId, …>` table.

### 3. Every mode steps deterministically (`modes-deterministic`)

All 48 modes boot, stay finite and replay exactly from a seed. The proofs are the `BASELINE` fingerprints of
`tests/extras.test.ts`, no `Math.random` or clock in a mode, and an `init()` that resets every field. Mode Lab's Blueprint
interpreter is part of the blueprint mode: it plays inside the engine on every Mode Lab page and in every export.

- **Code:** `src/lib/physics/**`, `src/lib/blueprint/**` (the Blueprint language, its runtime and its catalog).
- **Unit tests:** `tests/extras.test.ts`, `tests/engine.test.ts`, `tests/physicsPurity.test.ts`, `tests/modeThumbnails.test.ts`.
- **Smoke blocks:** `core-every-mode` (always in tier 1): every mode starts, steps and draws.
- **Also:** the fingerprint lock fails a changed or removed fingerprint without a `Fingerprint-Change: <mode> - <reason>`
  trailer. A change to a mode's file also runs `tests/<id>*.test.ts` and that mode's smoke block (escalation), and a
  change in `src/lib/blueprint/**` every `tests/blueprint*.test.ts` and the `blueprint` block (the `blueprint` row).

### 4. Find Simulation (`find-simulation`)

The seed finder builds the same engine the page does (`createEngineForSettings`), finds a seed that ends at the asked time,
and says "endless" or "fixed" when no seed can.

- **Code:** `src/lib/simulation/**`, `src/lib/bot/finderRequest.ts`.
- **Unit tests:** `tests/engine.test.ts`, `tests/engineCore.test.ts`, `tests/extras.test.ts`, `tests/softCeilings.test.ts`,
  `tests/desktopAi.test.ts`.
- **Smoke blocks:** `find-simulation` (always in tier 1).
- **Also:** `src/lib/simulation/finder.ts` is a hub file, so a change there needs tier 2, which runs `tests/finderDepth.test.ts`
  and the `finder-depth` block.

### 5. Link, preset, project file and share-code round trip (`links-round-trip`)

`settingsToSearchParams` and `settingsFromSearchParams` round-trip every setting. `presetToSettings` is the final word for
links, presets, project files and share codes alike, and values stay uncapped.

- **Code:** `src/lib/settings.ts`, `src/lib/shareCode.ts`, `src/lib/project.ts`, `src/components/simulator/useProjectFiles.ts`,
  `src/components/simulator/shareLinks.tsx`.
- **Unit tests:** `tests/settings.test.ts`, `tests/uncap.test.ts`, `tests/shareCode.test.ts`, `tests/project.test.ts`,
  `tests/fastExportProject.test.ts`.
- **Smoke blocks:** `project-files` (always in tier 1).
- **Also:** `src/lib/settings.ts` is a hub file, so a change there needs tier 2.

### 6. Record, fast export and batch (`record-export-batch`)

Record Video, the fast export and the batch render all draw through `Canvas.tsx` and end where the run ends. A clip's
frames and sound match the live run.

- **Code:** `src/lib/recording/**`, `src/components/simulator/fastRenderCanvas.tsx`,
  `src/components/simulator/useBatchRender.ts`, `src/components/simulator/renderBudget.ts`,
  `src/components/simulator/Canvas.tsx`.
- **Unit tests:** `tests/recorder.test.ts`, `tests/fastRender.test.ts`, `tests/fastExportProject.test.ts`, `tests/batch.test.ts`,
  `tests/zip.test.ts`, `tests/renderBudget.test.ts`.
- **Smoke blocks:** `recording` and `fast-render` (always in tier 1).
- **Also:** a change under `src/lib/recording/` escalates to the `paywall-gate`, `free-watermark` and `watermark-everywhere`
  blocks. The `batch-render` block runs in tier 2.

### 7. Watermark (`watermark`)

Every free frame and every free video carries the watermark. The export seals it (`src/lib/watermark/seal.ts`), and the
live canvas stamps it as its last pass (`src/lib/watermark/live.ts`).

- **Code:** `src/lib/watermark/**`, `src/components/simulator/liveMarkHud.ts`, `src/components/simulator/splitScreenCanvas.tsx`.
- **Unit tests:** `tests/freeWatermark.test.ts`, `tests/watermarkEverywhere.test.ts`, `tests/recorder.test.ts`.
- **Smoke blocks:** `free-watermark` and `watermark-everywhere` (tier 1 when touched).
- **Also:** `src/lib/watermark/**` is protected, so a change there is reported for owner review.

### 8. Paywall and licence (`paywall-licence`)

`PRO_FEATURES` are gated by an ES256 licence, verified against the build's public key. The TEST key stays in the unit
tests and the smoke harness.

- **Code:** `src/lib/billing/**`, `src/lib/account/**`, `billing/src/**`.
- **Unit tests:** `tests/billingEntitlement.test.ts`, `tests/billingLicense.test.ts`, `tests/billingPlans.test.ts`,
  `tests/ownerLicense.test.ts`, `tests/account.test.ts`.
- **Smoke blocks:** `paywall-gate` (tier 1 when touched).
- **Also:** lane B runs the billing Worker's type check and tests. `src/lib/billing/**` and `PRO_FEATURES` are protected.

### 9. Desktop bridge (`desktop-bridge`)

The Windows app and the page agree on the bridge (`src/lib/desktop/contract.ts`). The page detects each feature by its
capability (`src/lib/desktop/capabilities.ts`, one capability with a `since` version per feature), so an older app keeps
working.

- **Code:** `src/lib/desktop/**`, `src/components/simulator/desktop/**`, `desktop/src/**`.
- **Unit tests:** `tests/desktopCapabilities.test.ts`, `tests/desktopSite.test.ts`, `tests/desktopQueue.test.ts`,
  `tests/desktopAi.test.ts`, `tests/desktopAiFix.test.ts`, `tests/customContent.test.ts`, `tests/desktopPublish.test.ts`,
  `tests/desktopEncode.test.ts`.
- **Smoke blocks:** `desktop-exe` (always in tier 1), `desktop-current` and `desktop-ai-fix` (tier 1 when touched).
- **Also:** lane B runs the desktop app's type check and tests. The Windows build, `JumpingBallsLive.exe --smoke`, runs
  only in `.github/workflows/desktop.yml`.

### 10. i18n (`i18n`)

en, pl and es hold the same keys with the same ICU arguments, every message compiles, and the copy keeps the budgets of
`docs/COPY-STYLE.md`.

- **Code:** `messages/*.json`, `src/i18n/**`.
- **Unit tests:** `tests/i18nParity.test.ts`, `tests/copyStyle.test.ts`, `tests/clientMessages.test.ts`,
  `tests/uiI18nReview.test.ts`, `tests/legalCopy.test.ts`.
- **Smoke blocks:** `language-switcher` (always in tier 1).
- **Also:** `messages/*.json` are hub files, so a change there needs tier 2. The `Privacy.*` and `Terms.*` namespaces are
  protected.

### 11. Consent and analytics (`consent-analytics`)

No cookies, no ad tags and no telemetry. The optional statistics script runs only behind its gates: Do Not Track, Global
Privacy Control, the opt-out switch, and never in the Windows app. The privacy copy says only what the code does.

- **Code:** `src/lib/analytics/**`, `src/components/site/Analytics.tsx`, `src/components/site/StatsOptOut.tsx`,
  `src/lib/legalDates.ts`.
- **Unit tests:** `tests/analytics.test.ts`, `tests/legalCopy.test.ts`.
- **Smoke blocks:** `go-live-kit` (tier 1 when touched): the privacy policy's sections and claims.
- **Also:** `src/lib/legalDates.ts` and the `Privacy.*` and `Terms.*` messages are protected.

### 12. No freeze, uncapped (`no-freeze-uncapped`)

No user number is clamped to a slider's maximum; the only ceilings are the memory ceilings of `src/lib/uncap.ts`. A huge
value keeps the page responsive through the soft ceilings and the frame budgets.

- **Code:** `src/lib/uncap.ts`, `src/lib/unlimited.ts`, `src/lib/physics/softCeilings.ts`, `src/lib/physics/limits.ts`,
  `src/components/simulator/ringLod.ts`, `src/components/simulator/renderBudget.ts`.
- **Unit tests:** `tests/uncap.test.ts`, `tests/softCeilings.test.ts`, `tests/renderBudget.test.ts`.
- **Smoke blocks:** `uncap-all` (tier 1 when touched).
- **Also:** the uncap `ALLOWED` list and `MEMORY_CEILINGS` are protected. The slow `tests/unlimited.test.ts` runs with
  `npm run guard -- --with-slow` and in tier 2.

### 13. Release integrity (`release-integrity`)

The changelog entry, the version and `CHANGELOG.md` agree. The workflows deploy only what they should, the smoke shards
stay balanced, and the guard and this guide stay true.

- **Code:** `src/content/changelog.json`, `CHANGELOG.md`, `package.json`, `scripts/changelog.mjs`, `scripts/test-ci.mjs`,
  `scripts/smoke-test.mjs`, `scripts/smoke-timing.json`, `scripts/smoke/**`, `vitest.config.ts`, `.github/workflows/**`,
  `scripts/agent/**`, `src/lib/agentKit/**`, `AGENTS.md`, `CLAUDE.md`.
- **Unit tests:** `tests/changelog.test.ts`, `tests/releaseWorkflows.test.ts`, `tests/testCi.test.ts`, `tests/smokeShards.test.ts`,
  `tests/docsConsistency.test.ts`, `tests/coreGuard.test.ts`, `tests/protectedDiff.test.ts`, `tests/agentDocs.test.ts`.
- **Smoke blocks:** `changelog` (tier 1 when touched).
- **Also:** lane C runs `node scripts/changelog.mjs --check` and `node scripts/smoke-test.mjs --list`. The test-weakening
  detector and the protected-path report run on every change.

## Changing this list

`scripts/agent/core.json` is protected: a change to it is reported for owner review. Never drop a test from the core list
or a function from this page to make the guard pass. To add a core test, add it with its measured seconds (vitest's
per-file duration) to `vitest.core`. `tests/coreGuard.test.ts` then checks the lane plan against the 3-minute budget. To
add a core function, add it to `coreFunctions` and give it a section here. `tests/agentDocs.test.ts` fails until both
agree.
