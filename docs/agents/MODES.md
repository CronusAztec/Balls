# Adding a coded mode: the exact checklist

A coded mode is the last resort. Read the decision tree in `AGENTS.md` first: settings, presets and the data-driven blocks
cover a lot, and from phase P4 a Blueprint (data) is the way to add a mechanic. When a coded mode really is the answer, it
has to be wired by hand into every place below. Two recent modes did exactly this: Merge Ring (`mergeRing`) and Spiral Glass
(`spiralGlass`). Copy them.

The table names each registration point by its file and by a symbol you can grep for, not by line number. The placeholders
stand for the new mode: `<id>` (`mergeRing`), `<Name>` (`MergeRing`), `<NAME>` (`MERGE_RING`), `<px>` (the 2-3 letter
settings prefix, `mr`) and `<kebab>` (`merge-ring`). `tests/agentDocs.test.ts` fills them in with Merge Ring's values and
checks that every file exists and holds every symbol, so the list cannot drift from the code.

"Caught by" says what fails when the point is missed:

- **typed**: `npm run typecheck` fails, for example through a `Record<ModeId, …>` table.
- **tested**: a named test fails.
- **partly**: a test catches part of it.
- **escalated**: the guard runs it when the mode's files change.
- **none**: nothing fails. The mode just works worse: the finder, the app's AI, the bot or the watermark layout quietly skip
  it. These are the points agents miss. Check each one by hand.

## Physics

| # | File | Look for | Add | Caught by |
| --- | --- | --- | --- | --- |
| 1 | `src/lib/physics/types.ts` | `MODE_IDS` | The id, after its neighbour. | **typed**: every `Record<ModeId, …>` table needs it then |
| 2 | `src/lib/physics/modes/<id>.ts` | `export class <Name>Mode implements GameMode`, `DEFAULT_<NAME>_SETTINGS`, `export const <NAME>_RANGES`, `export function default<Name>Fields`, `export function <id>ModeDefaults`, `export function resolve<Name>Fields`, `export function write<Name>Params`, `export function read<Name>Params`, `export function <id>SettingsOf` | The new file: the class and its settings boilerplate. `<NAME>_RANGES` is keyed by the `SimulatorSettings` field names. Randomness only from `ctx.random()`, and `init()` resets every field. | **typed** (`GameMode`), and `tests/physicsPurity.test.ts` |
| 3 | `src/lib/physics/modes/index.ts` | `export { <Name>Mode }` | Export the class and its types. | **tested**: `tests/docsConsistency.test.ts` |
| 4 | `src/lib/physics/engine.ts` | `readonly <id>Mode = new <Name>Mode()` | The instance, with its import. | **typed** (used by rows 5 and 7) |
| 5 | `src/lib/physics/engine.ts` | `init<Name>()`, `this.activateMode(this.<id>Mode, "none")` | The init method. `activateMode` takes the ring layout: `"classic"`, `"single-gap"`, `"solid"`, or `"none"` for a mode that builds its own playfield. | **typed** (row 6 calls it) |
| 6 | `src/lib/physics/engine.ts` | `initMode(`, `case "<id>":` | A case in the `initMode()` switch. Its `never` default makes a missing case a type error. | **typed**, and `tests/engine.test.ts` boots every mode |
| 7 | `src/lib/physics/engine.ts` | `is<Name>Mode()`, `get<Name>Settings()`, `set<Name>Settings(`, `get<Name>View()`, `get<Name>Progress()` | The accessor block. The canvas reads the view through it. | **partly**: `tests/docsConsistency.test.ts` checks each setter is applied in `initEngineForMode` |
| 8 | `src/lib/physics/bounceMathRuntime.ts` | `BOUNCE_MATH_BALL_MODES`, `BOUNCE_MATH_COLLIDE_MODES`, `BOUNCE_MATH_PASS_MODES`, `BOUNCE_MATH_BREAK_MODES` | The lists the mode's contacts belong to. A mode that resolves its own contacts calls `ctx.noteBounce?.(ball)` and `ctx.noteCollide?.(a, b)`. | **partly**: `tests/bounceMath.test.ts` checks the bounce trigger only. The hit, pass and break lists: none |
| 9 | `src/lib/uncap.ts` | `MEMORY_CEILINGS` | A ceiling for each whole-number setting that sizes an allocation, such as a tier or ball count. Protected: owner review. | **tested**: `tests/uncap.test.ts` (missed in both recent modes, fixed later in 916a3bb) |
| 10 | `src/lib/audio/songs.ts` | `MODE_WALL_BREAK_SOUNDS` | Optional: the wall-break clip of a mode that shatters something. | **none** |

## Settings and links (`src/lib/settings.ts`)

| # | File | Look for | Add | Caught by |
| --- | --- | --- | --- | --- |
| 11 | `src/lib/settings.ts` | `import { <NAME>_RANGES, default<Name>Fields` | The import of the mode's helpers. | **typed** |
| 12 | `src/lib/settings.ts` | `export interface SimulatorSettings`, `// --- <kebab> ---` | The mode's `<px>…` fields, under the feature's comment. | **typed** (through the defaults) |
| 13 | `src/lib/settings.ts` | `...default<Name>Fields(),`, `...<id>ModeDefaults(mode),` | The spreads in `defaultSettings()`, outside the core literal: past about 550 properties V8 leaves its fast path. | **typed** |
| 14 | `src/lib/settings.ts` | `keyof <Name>Fields` | The fields in `coreDefaultSettings`'s `Omit<>`. | **typed** |
| 15 | `src/lib/settings.ts` | `...<NAME>_RANGES,` | The spread in `RANGES`. | **typed**: the section reads `RANGES.<px>…` |
| 16 | `src/lib/settings.ts` | `write<Name>Params(settings, base, params)` | The link writer in `settingsToSearchParams`. It writes only values that differ from the mode's defaults. | **none** (only the mode's own test) |
| 17 | `src/lib/settings.ts` | `read<Name>Params(params, settings)` | The link reader in `settingsFromSearchParams`. | **none** (only the mode's own test) |
| 18 | `src/lib/settings.ts` | `MODE_ENGINE_KEYS`, `<id>: rangeKeys(<NAME>_RANGES)` | The restart keys. A visual key, such as a rainbow switch, applies live and is left out. | **typed** (`Record<ModeId, …>`) |
| 19 | `src/lib/settings.ts` | `Object.assign(merged, resolve<Name>Fields(merged))` | The resolver in `presetToSettings`, the final word for links, presets, project files and share codes. | **none** |

## The finder, the bot and the app's AI

| # | File | Look for | Add | Caught by |
| --- | --- | --- | --- | --- |
| 20 | `src/lib/simulation/finder.ts` | `export interface ModeSettings`, `<id>?: Partial<<Name>Settings>` | The mode's settings for the finder. | **none** |
| 21 | `src/lib/simulation/finder.ts` | `if (mode === "<id>") engine.set<Name>Settings(settings.<id> ?? {})` | The branch in `createEngineForSettings`. Without it the finder runs the mode with its defaults. | **none** |
| 22 | `src/lib/simulation/finder.ts` | `export function runNeverFinishes`, `export function fixedRunDurationSec` | Only when a run cannot finish, or its length is fixed by its settings. Otherwise the run must end (`isFinished`), with a timeout if it can stall. | **none** |
| 23 | `src/lib/bot/finderRequest.ts` | `<id>: <id>SettingsOf(s)` | The mode in `modeSettingsOfSettings`, for the bot and the live preview. | **none** |
| 24 | `src/lib/desktop/ai/settingsPatch.ts` | `MODE_PREFIXES`, `<id>: "<px>"` | The prefix, so the app's AI can tune the mode. A key counts when the prefix is followed by a capital letter or a digit. | **none** |

## The page (`Simulator.tsx`, `Canvas.tsx`, `Controls.tsx`)

| # | File | Look for | Add | Caught by |
| --- | --- | --- | --- | --- |
| 25 | `src/components/simulator/Simulator.tsx` | `const initEngineForMode`, `engine.set<Name>Settings(<id>SettingsOf(s))` | The setter. The page, the fast export, the batch and the desktop render queue all build their engine through it. | **tested**: `tests/docsConsistency.test.ts` |
| 26 | `src/components/simulator/Simulator.tsx` | `engine.init<Name>()` | The restart effect on the restart keys (with `setFinished(false)` and `setSeed(null)`), and a live effect that only calls the setter. | **none** |
| 27 | `src/components/simulator/Simulator.tsx` | `const splitHooks` | The split-screen arena's live setter. | **none** |
| 28 | `src/components/simulator/Simulator.tsx` | `const runFinderWith`, `<id>: <id>SettingsOf(settings)` | The mode in the page finder's `modeSettings` literal. | **none** |
| 29 | `src/components/simulator/Simulator.tsx` | `useMemo<CanvasLabels>`, `t("<Name>.canvasTitle")` | The canvas labels from the messages. | **none** (the field is optional) |
| 30 | `src/components/simulator/<id>Renderer.ts` | `export class <Name>Layer`, `export class <Name>Dataset`, `export const DEFAULT_<NAME>_LABELS`, `export interface <Name>Labels` | The new renderer file: render options, labels and their defaults, a layer with `drawWorld`, `drawEffects` and `drawOverlay`, and a dataset for the smoke test. | **none** (the smoke block only) |
| 31 | `src/components/simulator/sections/<Name>Section.tsx` | `export const <NAME>_KEYS`, `RANGES.<px>` | The new section file: sliders and toggles from `RANGES`, with a `labelKey` and a `tipKey` each. | **none** |
| 32 | `src/components/simulator/Canvas.tsx` | `export interface CanvasLabels`, `<id>?: <Name>Labels`, `<id>: DEFAULT_<NAME>_LABELS` | The labels field and its default. | **none** |
| 33 | `src/components/simulator/Canvas.tsx` | `new <Name>Layer()`, `new <Name>Dataset()` | The layer, its options and the dataset, built once. | **none** |
| 34 | `src/components/simulator/Canvas.tsx` | `engine.is<Name>Mode() ? engine.get<Name>View() : null` | The view fetch each frame. | **none** |
| 35 | `src/components/simulator/Canvas.tsx` | `<id>Layer.drawWorld(`, `<id>Layer.drawEffects(`, `<id>Layer.drawOverlay(` | The phases: the world under the balls, effects over them, and the screen-space HUD, which is part of the recording. | **none** |
| 36 | `src/components/simulator/Canvas.tsx` | `bigBanner(` | The end banner. | **none** |
| 37 | `src/components/simulator/Canvas.tsx` | `<id>Data.write(<id>View, setCanvasData)` | The `data-*` dataset that the smoke test reads. | **none** |
| 38 | `src/components/simulator/Canvas.tsx` | `<id>Layer.noteHud(hud)`, `noteTitleBlock(` | The HUD report, so the live watermark badge avoids the mode's HUD (2669b37 fixed the Merge Ring HUD under the badge). | **none** |
| 39 | `src/components/simulator/Controls.tsx` | `import <Name>Section, { <NAME>_KEYS }`, `SECTION_KEYS.ball.push(...<NAME>_KEYS)` | The section and its search keys. | **none** |
| 40 | `src/components/simulator/Controls.tsx` | `const modeNames`, `<id>: t("mode<Name>")` | The mode's name. | **typed** (`Record<ModeId, string>`) |
| 41 | `src/components/simulator/Controls.tsx` | `s.mode === "<id>" && !!search && <<Name>Section` | The section in the search results. | **none** |
| 42 | `src/components/simulator/Controls.tsx` | `const modeSpecific`, `case "<id>":` | The section in the Mode group. | **none** |
| 43 | `src/components/simulator/panelKeys.ts` | `export function wallControlsOf`, `if (mode === "<id>")` | Which wall controls the mode offers. | **none** |
| 44 | `src/components/simulator/panelKeys.ts` | `MODE_BLOCK_KEYS`, `<id>: <NAME>_KEYS` | The section's keys for the command palette, in this mode only. | **none** |

## Cards, previews and copy

| # | File | Look for | Add | Caught by |
| --- | --- | --- | --- | --- |
| 45 | `src/lib/modes.ts` | `MODE_CARD_ORDER`, `0, "<id>")` | The card, spliced in after its neighbour. | **tested**: `tests/siteStatic.test.ts` (every id), `tests/bullseye.test.ts` (the neighbours) |
| 46 | `src/lib/modes.ts` | `MODE_CATEGORIES` | The family: `escape`, `rhythm`, `battle` or `journey`. A new family needs more (README "Add a game mode", step 4). | **typed** |
| 47 | `src/lib/thumbnails/heroMoments.ts` | `HERO_MOMENTS` | The card picture's moment, query, seed and second. | **typed**, and `tests/modeThumbnails.test.ts` |
| 48 | `public/modes/<id>.webp` | | The card picture: `MODES=<id> npm run previews` against the served build. | **tested**: `tests/modeThumbnails.test.ts` |
| 49 | `messages/en.json` | `"mode<Name>"`, `"<Name>": {` | `Controls.mode<Name>`, the section's `<px>Title`, `<px>Desc`, field labels and tips, `Modes.<id>.name` and `.description`, and a `<Name>` namespace for the canvas. Follow `docs/COPY-STYLE.md`. | **tested**: `tests/i18nParity.test.ts`, `tests/copyStyle.test.ts` |
| 50 | `messages/pl.json` | `"mode<Name>"`, `"<Name>": {` | The same keys in Polish. | **tested**: `tests/i18nParity.test.ts` |
| 51 | `messages/es.json` | `"mode<Name>"`, `"<Name>": {` | The same keys in Spanish. | **tested**: `tests/i18nParity.test.ts` |

## Tests, smoke, docs and the release

| # | File | Look for | Add | Caught by |
| --- | --- | --- | --- | --- |
| 52 | `tests/<id>.test.ts` | `describe(` | The mode's own tests: one seed gives the same balls and sound events, another seed differs, a restart replays exactly, the run ends, and the link round-trips. | **escalated**: the guard runs `tests/<id>*.test.ts` when the mode's file changes |
| 53 | `tests/extras.test.ts` | `BASELINE`, `<id>:` | The default run's fingerprint. An added entry passes the fingerprint lock; a changed one needs a `Fingerprint-Change:` trailer. | **typed** (`Record<ModeId, Fingerprint>`) |
| 54 | `tests/bullseye.test.ts` | `"<id>"` | The card neighbours. | **tested** |
| 55 | `tests/beatDrop.test.ts` | `"<id>"` | The modes whose default ball size is not 8. Update the list, never loosen the check. | **tested** |
| 56 | `tests/powerLayers.test.ts` | `"<id>"` | The same default ball size list. | **tested** |
| 57 | `scripts/smoke-test.mjs` | `smokeBlock("<kebab>"` | The mode's block: the card picture, the card, link to controls, controls to link, the search, and a fast run to the end through the dataset. | **tested**: `tests/docsConsistency.test.ts`, `tests/coreGuard.test.ts` |
| 58 | `scripts/smoke-timing.json` | `"<kebab>"` | The block's time, written in CI with `--write-timing`. Until then the block counts at the median. | **none** |
| 59 | `scripts/agent/core.json` | `modeSmoke` | Only when the mode's smoke block is not named `<kebab>` or `*-<kebab>`. Protected: owner review. | **tested**: `tests/coreGuard.test.ts` |
| 60 | `README.md` | `\| **<Title>** \|`, `### <Title>`, `` \| `<id>` \| `` | The Game modes row, the mode's section, and its row in the hero-moments table. | **tested**: `tests/docsConsistency.test.ts`, `tests/modeThumbnails.test.ts` |
| 61 | `src/content/changelog.json` | `"items"` | The release entry. Bump the version in `package.json` and run `npm run changelog` for `CHANGELOG.md`, all in one commit (`docs/RELEASING.md`). | **tested**: `tests/changelog.test.ts` |

`<Title>` is the mode's English name (`Merge Ring`).

## Checking the mode as you go

- `npm run -s agent -- modes --json '{"mode":"<id>"}'` lists the fields with their defaults, ranges, link keys and whether
  the engine reads them, so a field missing from rows 13 to 19 shows.
- `npm run -s agent -- simulate --json '{"mode":"<id>","seed":1,"seconds":30}'` runs a seed as the finder does. Run it
  twice: the output must be byte-identical.
- `npm run -s agent -- fingerprint --json '{"mode":"<id>"}'` prints the fingerprint to put in `BASELINE`, once the mode
  plays the way you want.
- `npm run -s agent -- preview --json '{"mode":"<id>","times":[1,5,10]}'` shows the mode on the real page, watermarked.
- `npm run guard` runs the mode's tests and asks for its smoke block. `npm run guard:browser` runs that block, plus
  `core-every-mode`, which starts, steps and draws every mode.
- `docs/agents/CORE.md` lists what the guard proves for the 13 core functions. A new mode touches most of them.
