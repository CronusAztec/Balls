import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  CONFIDENCES,
  DISTRACTIONS,
  FIX_IDS,
  GATES,
  MAKES_SENSE,
  OBJECTION_KINDS,
  PANEL_DEPTHS,
  PANEL_STAGES,
  REVIEW_CONFIDENCES,
  REVIEW_DEPTHS,
  REVIEW_DISTRACTIONS,
  REVIEW_FIXES,
  REVIEW_GATES,
  REVIEW_ISSUES,
  REVIEW_MAKES_SENSE,
  REVIEW_MAX_JSON,
  REVIEW_OBJECTION_KINDS,
  REVIEW_REVIEWER_VERDICTS,
  REVIEW_STAGES,
  REVIEW_VIEWER_VERDICTS,
  SEVERITIES,
  VERDICTS,
  VIEWER_READS,
  REVIEW_SKEPTIC_VERDICTS,
  sanitizeReview,
  utf8Bytes,
  type ClipReview,
} from "@/lib/crew";

/*
 * --- crew --- The review record (lib/crew/review.ts ClipReview v1, C3 of the AI studio plan) and its sanitiser, which the app runs
 * on every write and load: a full record passes unchanged; oversized and control-character notes are cut and cleaned; unknown
 * keys and values are dropped; NaN and the infinities become null and numbers stay within 0–100; lists are filtered, de-duplicated
 * and capped; ids keep to their alphabets; a record without a version, a verdict or a stage is no record; the JSON stays within
 * 2 KB; and the file imports types only, its lists held equal to the ones it mirrors.
 */

const full = (): ClipReview => ({
  v: 1,
  depth: "quick",
  stage: "pre",
  verdict: "fix",
  confidence: "medium",
  makesSense: "partly",
  simple: 86,
  playbook: 96,
  pick: 89.3,
  gates: ["G2"],
  issues: ["payoffLate", "misread", "text"],
  fixes: ["retimePayoff", "simplifyLook"],
  fixState: "applied",
  notReviewed: null,
  roles: [
    { role: "skeptic", source: "model", verdict: "major", note: "Will the ball get out of the rings?" },
    { role: "viewer", source: "skipped", verdict: null, note: "quick" },
    { role: "reviewer", source: "model", verdict: "fix", note: "the payoff lands too late" },
  ],
  model: "claude-opus-5-5",
  promptHash: "0123456789abcdef",
  date: "2026-10-28",
  who: "claude",
  separation: "contexts",
});

describe("a review record", () => {
  it("passes the sanitiser unchanged, and the sanitiser is idempotent", () => {
    expect(sanitizeReview(full())).toEqual(full());
    expect(sanitizeReview(sanitizeReview(full()))).toEqual(full());
    expect(utf8Bytes(JSON.stringify(full()))).toBeLessThan(REVIEW_MAX_JSON);
  });

  it("is no record without its version, verdict, depth, stage or who, or when it is not an object", () => {
    for (const raw of [null, undefined, 3, "review", [], { ...full(), v: 2 }, { ...full(), v: undefined }]) expect(sanitizeReview(raw)).toBeNull();
    for (const key of ["verdict", "depth", "stage", "who"] as const) {
      expect([key, sanitizeReview({ ...full(), [key]: undefined })]).toEqual([key, null]);
      expect([key, sanitizeReview({ ...full(), [key]: "maybe" })]).toEqual([key, null]);
    }
  });

  it("cuts oversized notes to 140 characters and strips control characters", () => {
    const long = "word ".repeat(80);
    const out = sanitizeReview({ ...full(), roles: [{ role: "reviewer", source: "model", verdict: "fix", note: `${long}` }, { role: "skeptic", source: "model", verdict: "minor", note: "line one\nline\u0000two\u2028three\t end" }] })!;
    const reviewer = out.roles.find((r) => r.role === "reviewer")!;
    expect(Array.from(reviewer.note).length).toBeLessThanOrEqual(140);
    expect(reviewer.note.endsWith("…")).toBe(true);
    expect(out.roles.find((r) => r.role === "skeptic")!.note).toBe("line one line two three end");
    // the roles in their order, each once, the role's own verdicts only
    expect(out.roles.map((r) => r.role)).toEqual(["skeptic", "reviewer"]);
    const mixed = sanitizeReview({ ...full(), roles: [{ role: "viewer", source: "model", verdict: "keep", note: "" }, { role: "viewer", source: "model", verdict: "out", note: "" }, { role: "boss", source: "model", verdict: "keep", note: "" }, { role: "skeptic", source: "oracle", verdict: "none", note: "" }] })!;
    expect(mixed.roles).toEqual([{ role: "viewer", source: "model", verdict: null, note: "" }]);
  });

  it("drops unknown keys and unknown values; NaN and the infinities become null; numbers stay within 0-100 at one decimal", () => {
    const out = sanitizeReview({ ...full(), extra: "x", __proto__: { polluted: true }, confidence: "certain", makesSense: "kind of", fixState: "maybe", notReviewed: "lazy", separation: "merged", simple: Number.NaN, playbook: Infinity, pick: 123.456 } as unknown)!;
    expect(Object.keys(out).sort()).toEqual(Object.keys(full()).sort());
    expect([out.confidence, out.makesSense, out.fixState, out.notReviewed, out.separation]).toEqual([null, null, null, null, "contexts"]);
    expect([out.simple, out.playbook, out.pick]).toEqual([null, null, 100]);
    expect(sanitizeReview({ ...full(), simple: -5, pick: 42.26 })!.simple).toBe(0);
    expect(sanitizeReview({ ...full(), pick: 42.26 })!.pick).toBe(42.3);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("filters, de-duplicates and caps its lists: issues at 6, fixes at 3, gates to G1-G8", () => {
    const out = sanitizeReview({ ...full(), gates: ["G9", "G1", "G1", "g2", 4], issues: ["tooBusy", "tooBusy", "bored", "misread", "wouldScroll", "text", "effects", "hud", "shake", "slowStart"], fixes: ["simplifyLook", "simplifyLook", "makeItPop", "turnOff", "rewriteHook", "retimePayoff"] })!;
    expect(out.gates).toEqual(["G1"]);
    expect(out.issues).toEqual(["tooBusy", "misread", "wouldScroll", "text", "effects", "hud"]);
    expect(out.fixes).toEqual(["simplifyLook", "turnOff", "rewriteHook"]);
    expect(sanitizeReview({ ...full(), gates: "G1", issues: null, fixes: {} })!).toMatchObject({ gates: [], issues: [], fixes: [] });
  });

  it("keeps ids to their alphabets: the model's at most 64 characters, the prompt hash 16 hex, the date ISO", () => {
    expect(sanitizeReview({ ...full(), model: "qwen3-4b-instruct.Q4_K_M" })!.model).toBe("qwen3-4b-instruct.Q4_K_M");
    for (const model of ["", "<script>", "a b", "x".repeat(65), 42]) expect([model, sanitizeReview({ ...full(), model })!.model]).toEqual([model, null]);
    for (const promptHash of ["0123456789ABCDEF", "0123", "0123456789abcdefg", null]) expect([promptHash, sanitizeReview({ ...full(), promptHash })!.promptHash]).toEqual([promptHash, null]);
    expect(sanitizeReview({ ...full(), date: "2026-10-28T03:12:45.123Z" })!.date).toBe("2026-10-28T03:12:45.123Z");
    for (const date of ["28/10/2026", "2026-10-28 03:00", "yesterday", 20261028]) expect([date, sanitizeReview({ ...full(), date })!.date]).toEqual([date, null]);
  });

  it("stays within 2 KB: the notes are shortened first", () => {
    const note = "🎱".repeat(140);
    const heavy = { ...full(), roles: [{ role: "skeptic", source: "model", verdict: "fatal", note }, { role: "viewer", source: "model", verdict: "out", note }, { role: "reviewer", source: "model", verdict: "drop", note }] };
    expect(utf8Bytes(JSON.stringify(heavy))).toBeGreaterThan(REVIEW_MAX_JSON);
    const out = sanitizeReview(heavy)!;
    expect(out).not.toBeNull();
    expect(utf8Bytes(JSON.stringify(out))).toBeLessThanOrEqual(REVIEW_MAX_JSON);
    expect(out.roles.map((r) => r.verdict)).toEqual(["fatal", "out", "drop"]);
    expect(Array.from(out.roles[0].note).length).toBeLessThan(140);
    expect(utf8Bytes("aé🎱")).toBe(1 + 2 + 4);
  });
});

describe("the record's lists mirror the crew's", () => {
  it("are equal to roles.ts and clarity.ts", () => {
    expect(REVIEW_DEPTHS).toEqual(PANEL_DEPTHS);
    expect(REVIEW_STAGES).toEqual(PANEL_STAGES);
    expect(REVIEW_CONFIDENCES).toEqual(CONFIDENCES);
    expect(REVIEW_MAKES_SENSE).toEqual(MAKES_SENSE);
    expect(REVIEW_GATES).toEqual(GATES.map((g) => g.id));
    expect(REVIEW_OBJECTION_KINDS).toEqual(OBJECTION_KINDS);
    expect(REVIEW_DISTRACTIONS).toEqual(DISTRACTIONS);
    expect(REVIEW_ISSUES).toEqual([...OBJECTION_KINDS, "misread", "wouldScroll", ...DISTRACTIONS]);
    expect(REVIEW_FIXES).toEqual(FIX_IDS);
    expect(REVIEW_VIEWER_VERDICTS).toEqual(VIEWER_READS);
    expect(REVIEW_REVIEWER_VERDICTS).toEqual(VERDICTS);
    expect(REVIEW_SKEPTIC_VERDICTS).toEqual(["none", ...SEVERITIES]);
  });

  it("review.ts imports types only (the app's main process bundles it without the page's modules)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/lib/crew/review.ts"), "utf8");
    const imports = src.split("\n").filter((l) => /^import\b/.test(l));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/^import type /);
  });
});
