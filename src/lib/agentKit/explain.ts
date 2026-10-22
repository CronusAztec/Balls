/*
 * --- agent-cli --- `npm run agent -- explain`: sorts a failure (a vitest, tsc, eslint or smoke excerpt) into the kind of fix
 * that is legitimate for it, so an agent never "fixes" a red test by weakening it. The main split:
 *  - a source pin: the failing test reads a source file as text (Simulator.tsx, Canvas.tsx, Controls.tsx and others, through
 *    readFileSync) and matches a line of it – a refactor that keeps the behaviour turned it red. The legitimate fix keeps the
 *    pinned contract (the call, the order, the guard the regex looks for) in the source, or – when the pin itself names a
 *    line that no longer exists for a good reason – updates the pin to the new form of the SAME contract, never deletes it;
 *  - a behaviour failure: the code does something else now; fix the code;
 *  - a determinism fingerprint (tests/extras.test.ts BASELINE or a mode's own pinned numbers): a moved trajectory, fixed in
 *    the code; a deliberate change needs a `Fingerprint-Change: <mode> - <reason>` trailer and the owner's review;
 *  - --- ai-guard --- the guard's own findings and failures, in its report's and summary's words: a weakened test
 *    (expect-drop, expect-changed, skip-added, test-deleted …: restore it, or a `Test-Change:` trailer and the owner's
 *    review), a stale export (perfGuards' "./out was built from": rebuild it) and a missing install or browser (the machine,
 *    not the code: install it).
 * Which tests read which files as text is measured by the CLI (it scans tests/), not kept in a list here.
 */

export type FailureKind = "weakening" | "fingerprint" | "environment" | "stale-export" | "source-pin" | "behaviour" | "timeout" | "typecheck" | "lint" | "smoke" | "unknown";

export interface TestFileFacts {
  /** "tests/freeWatermark.test.ts". */
  file: string;
  /** Source files the test reads as text (repository paths it names, e.g. "src/components/simulator/Simulator.tsx"). */
  readsAsText: string[];
}

export interface ExplainedFile {
  file: string;
  kind: FailureKind;
  readsAsText: string[];
}

export interface Explanation {
  kind: FailureKind;
  summary: string;
  files: ExplainedFile[];
  legitimateFix: string[];
  neverDo: string[];
}

/** Hub sources whose text test files pin (the brittle ones a refactor turns red; textReadsOf measures which tests). */
export const PINNED_HUB_FILES = ["Simulator.tsx", "Canvas.tsx", "Controls.tsx"] as const;

const NEVER_DO = [
  "re-record a fingerprint or a pinned number to match the new output",
  "delete or loosen an expect(), or add .skip / .only / skipIf / todo",
  "raise a timeout or a budget to make it pass",
  "widen an ALLOWED list or a memory ceiling",
];

const FIXES: Record<FailureKind, string[]> = {
  weakening: [
    "the guard's test-weakening detector flagged a test the change made weaker (an expect removed or rewritten in place, a .skip / .only / .todo / .runIf / .fails added, a raised timeout, a deleted test or smoke check, a widened allow list): restore the test as it was – never make the test pass by weakening it",
    "if the edit of the test is legitimate (the behaviour it checks changed on purpose, a test moved): keep it only with a commit trailer `Test-Change: <file> - <reason>` and ask the owner to review it (an added .only always fails)",
  ],
  environment: [
    "the machine, not the code: install what is missing – `npm ci`, `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --prefix desktop`, `npm ci --prefix billing`, or Chromium for Playwright (`npx playwright install chromium`, or PLAYWRIGHT_BROWSERS_PATH) – then run the guard again",
    "change no code or test for it, and never record a baseline while it is missing",
  ],
  "stale-export": [
    "the git-ignored out/ holds an export of another commit: rebuild it (`npm run build`), remove it, or point PERF_GUARD_OUT at a fresh export – no code or test change",
  ],
  fingerprint: [
    "find the change that moved the trajectory (git diff on src/lib/physics, src/lib/simulation, settings.ts) and restore the old behaviour for the default path",
    "if the change is deliberate: keep the new numbers only with a commit trailer `Fingerprint-Change: <mode> - <reason>` and ask the owner to review it",
  ],
  "source-pin": [
    "the test pins the source text of a contract (a call, an order, a guard): keep that contract in the source – usually the refactor dropped or renamed the line the regex looks for",
    "if the pinned line moved for a good reason, update the pin to the new form of the same contract in the same commit (the test must still fail when the contract is gone)",
  ],
  behaviour: ["the code does something else now: fix the code (or, if the old behaviour was wrong, change the expectation with the reason in the commit message and the owner's review)"],
  timeout: ["something got slower: profile the change (a loop per frame, a missing cache, an O(n²) pass) and fix the cost"],
  typecheck: ["fix the types at the source of the error; never add `any`, `@ts-ignore` or `as unknown as` to silence it"],
  lint: ["fix the code the rule points at; never disable the rule for the line"],
  smoke: ["reproduce with `SMOKE_ONLY=<block> npm run smoke` against a fresh build, then fix the page; smoke checks are never deleted"],
  unknown: ["paste the vitest / tsc / eslint output including the failing test's name and the assertion"],
};

const TEST_FILE = /tests\/[\w./-]+?\.test\.(?:ts|mjs)/g;

/** The test files a failure text names, in order of first mention (a name with a `..` segment is no test file of tests/). */
export function testFilesIn(text: string): string[] {
  return [...new Set(text.match(TEST_FILE) ?? [])].filter((f) => !f.split("/").includes(".."));
}

/** --- ai-guard --- The weakening detector's finding kinds, as its report and summary name them. */
const WEAKENING_KINDS = /\b(?:expect-drop(?:ped)?|expect-changed|skip-runtime|only-added|skip-added|skipIf-added|runIf-added|todo-added|fails-added|timeout-raised|test-deleted|check-drop|allow-list-widened|core-test-dropped)\b|needs "Test-Change:|Test weakened \(/;

function kindOfText(text: string): FailureKind | null {
  if (WEAKENING_KINDS.test(text)) return "weakening";
  if (/\.\/out was built from [0-9a-f]{7,}|built export freshness|out\/version\.json names/i.test(text)) return "stale-export";
  if (/\bis missing\b[^\n]*\b(?:npm ci|run npm)|node_modules is missing|JBL_REQUIRE_BROWSER=1: Chromium did not start|Executable doesn't exist|npx playwright install/i.test(text)) return "environment";
  if (/\bfingerprint (?:changed|removed)\b|Fingerprint-Change:|Fingerprint (?:changed|removed) without a trailer/.test(text)) return "fingerprint";
  if (/\bBASELINE\b|Fingerprint|leaves every mode's trajectory|fingerprint/i.test(text) && /extras\.test|samples|walls|broken/.test(text)) return "fingerprint";
  if (/Test timed out in \d+ms|timed out after/i.test(text)) return "timeout";
  if (/error TS\d{3,5}/.test(text)) return "typecheck";
  if (/\b(?:@typescript-eslint|react-hooks|@next\/next)\/[a-z-]+|\d+:\d+\s+(?:error|warning)\s+.+\s[\w@/-]+$/m.test(text)) return "lint";
  if (/smoke(?:-test)?\.mjs|SMOKE_ONLY|smokeBlock|\[smoke\]/i.test(text)) return "smoke";
  return null;
}

/** An assertion on text (a source pin's shape): toMatch / toContain / "to match /…/" / "to contain". */
const TEXT_ASSERTION = /toMatch\(|toContain\(|not\.toMatch|expected [\s\S]{0,4000}? to (?:not )?(?:match|contain|include) /;

export function explainFailure(text: string, facts: readonly TestFileFacts[]): Explanation {
  const named = testFilesIn(text);
  const byFile = new Map(facts.map((f) => [f.file, f]));
  const general = kindOfText(text);
  const textAssertion = TEXT_ASSERTION.test(text);
  const files: ExplainedFile[] = named.map((file) => {
    const readsAsText = byFile.get(file)?.readsAsText ?? [];
    let kind: FailureKind = general ?? "behaviour";
    if (kind === "behaviour" && readsAsText.length > 0 && textAssertion) kind = "source-pin";
    if (file === "tests/extras.test.ts" && /trajectory|BASELINE|samples/.test(text) && kind !== "weakening" && kind !== "environment" && kind !== "stale-export") kind = "fingerprint";
    return { file, kind, readsAsText };
  });
  // (the guard's own verdicts first: a weakened test is never "fixed" by changing the code, a missing install never by either)
  const order: FailureKind[] = ["weakening", "fingerprint", "environment", "stale-export", "source-pin", "timeout", "typecheck", "lint", "smoke", "behaviour"];
  const kind = files.length > 0 ? (order.find((k) => files.some((f) => f.kind === k)) ?? "behaviour") : (general ?? (text.trim() ? "behaviour" : "unknown"));
  const pinned = files.filter((f) => f.kind === "source-pin");
  const summary =
    kind === "source-pin"
      ? `${pinned.map((f) => f.file).join(", ")} ${pinned.length === 1 ? "reads" : "read"} ${[...new Set(pinned.flatMap((f) => f.readsAsText))].join(", ")} as text: a source pin – keep the pinned contract in the source.`
      : kind === "fingerprint"
        ? "A pinned determinism fingerprint moved: a behaviour change in a mode's run, to be fixed in the code."
        : kind === "weakening"
          ? `The guard's test-weakening detector flagged ${files.length ? files.map((f) => f.file).join(", ") : "a test"}: restore the test, or justify the edit with a Test-Change trailer for the owner's review.`
          : kind === "environment"
            ? "An install or a browser is missing: the machine, not the code."
            : kind === "stale-export"
              ? "The built export in out/ is of another commit: rebuild or remove it."
              : kind === "unknown"
          ? "No failure text to explain."
          : `A ${kind} failure${files.length ? ` in ${files.map((f) => f.file).join(", ")}` : ""}.`;
  return { kind, summary, files, legitimateFix: FIXES[kind], neverDo: NEVER_DO };
}

/**
 * The repository paths a test file's source names that it reads as text: string literals ending in a source extension
 * (".tsx", ".ts", ".mjs", ".json" under src/, scripts/, desktop/ or messages/) in a file that calls readFileSync or a
 * read() helper. Pure: the CLI hands in each test's text.
 */
export function textReadsOf(source: string): string[] {
  if (!/readFileSync|\bread\(/.test(source)) return [];
  const out = new Set<string>();
  const literal = /["'`]([^"'`\s]*?(?:Simulator|Canvas|Controls)\.tsx|(?:src|scripts|desktop|worker)\/[^"'`\s]+?\.(?:tsx?|mjs|cjs))["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = literal.exec(source))) out.add(m[1]);
  return [...out].sort();
}
