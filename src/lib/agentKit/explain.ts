/*
 * --- agent-cli --- `npm run agent -- explain`: sorts a failure (a vitest, tsc, eslint or smoke excerpt) into the kind of fix
 * that is legitimate for it, so an agent never "fixes" a red test by weakening it. The main split:
 *  - a source pin: the failing test reads a source file as text (Simulator.tsx, Canvas.tsx, Controls.tsx and others, through
 *    readFileSync) and matches a line of it – a refactor that keeps the behaviour turned it red. The legitimate fix keeps the
 *    pinned contract (the call, the order, the guard the regex looks for) in the source, or – when the pin itself names a
 *    line that no longer exists for a good reason – updates the pin to the new form of the SAME contract, never deletes it;
 *  - a behaviour failure: the code does something else now; fix the code;
 *  - a determinism fingerprint (tests/extras.test.ts BASELINE or a mode's own pinned numbers): a moved trajectory, fixed in
 *    the code; a deliberate change needs a `Fingerprint-Change: <mode> - <reason>` trailer and the owner's review.
 * Which tests read which files as text is measured by the CLI (it scans tests/), not kept in a list here.
 */

export type FailureKind = "fingerprint" | "source-pin" | "behaviour" | "timeout" | "typecheck" | "lint" | "smoke" | "unknown";

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

/** Hub sources whose text 16 test files pin (the brittle ones a refactor turns red). */
export const PINNED_HUB_FILES = ["Simulator.tsx", "Canvas.tsx", "Controls.tsx"] as const;

const NEVER_DO = [
  "re-record a fingerprint or a pinned number to match the new output",
  "delete or loosen an expect(), or add .skip / .only / skipIf / todo",
  "raise a timeout or a budget to make it pass",
  "widen an ALLOWED list or a memory ceiling",
];

const FIXES: Record<FailureKind, string[]> = {
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

function kindOfText(text: string): FailureKind | null {
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
    if (file === "tests/extras.test.ts" && /trajectory|BASELINE|samples/.test(text)) kind = "fingerprint";
    return { file, kind, readsAsText };
  });
  const order: FailureKind[] = ["fingerprint", "source-pin", "timeout", "typecheck", "lint", "smoke", "behaviour"];
  const kind = files.length > 0 ? (order.find((k) => files.some((f) => f.kind === k)) ?? "behaviour") : (general ?? (text.trim() ? "behaviour" : "unknown"));
  const pinned = files.filter((f) => f.kind === "source-pin");
  const summary =
    kind === "source-pin"
      ? `${pinned.map((f) => f.file).join(", ")} ${pinned.length === 1 ? "reads" : "read"} ${[...new Set(pinned.flatMap((f) => f.readsAsText))].join(", ")} as text: a source pin – keep the pinned contract in the source.`
      : kind === "fingerprint"
        ? "A pinned determinism fingerprint moved: a behaviour change in a mode's run, to be fixed in the code."
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
