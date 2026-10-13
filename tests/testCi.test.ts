import { describe, expect, it } from "vitest";
import { onlyWorkerTimeout } from "../scripts/test-ci.mjs";

/*
 * scripts/test-ci.mjs turns exactly one vitest false alarm into a pass (see its header). The text below is the end of the real
 * output of Actions run 38344496746 (colour codes included): 138 test files and 3180 tests passed, then vitest caught one
 * unhandled error – its own worker report timing out – and exited 1.
 */

const REAL_TAIL = [
  "\u001b[31m⎯⎯⎯⎯⎯⎯\u001b[39m\u001b[1m\u001b[41m Unhandled Errors \u001b[49m\u001b[22m\u001b[31m⎯⎯⎯⎯⎯⎯\u001b[39m",
  "\u001b[31m\u001b[1m",
  "",
  "Vitest caught 1 unhandled error during the test run.",
  "This might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.\u001b[22m\u001b[39m",
  "",
  "\u001b[31m⎯⎯⎯⎯⎯⎯\u001b[39m\u001b[1m\u001b[41m Unhandled Error \u001b[49m\u001b[22m\u001b[31m⎯⎯⎯⎯⎯⎯⎯\u001b[39m",
  '\u001b[31m\u001b[1mError\u001b[22m: [vitest-worker]: Timeout calling "onTaskUpdate"\u001b[39m',
  "\u001b[90m \u001b[2m❯\u001b[22m Object.onTimeoutError node_modules/vitest/dist/chunks/rpc.-pEldfrD.js:\u001b[2m53:10\u001b[22m\u001b[39m",
  "",
  "\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m138 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m1 skipped\u001b[39m\u001b[90m (139)\u001b[39m\u001b[22m",
  "\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m3180 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m22 skipped\u001b[39m\u001b[90m (3202)\u001b[39m",
  "\u001b[2m     Errors \u001b[22m \u001b[1m\u001b[31m1 error\u001b[39m\u001b[22m",
  "\u001b[2m   Start at \u001b[22m 04:04:11",
  "\u001b[2m   Duration \u001b[22m 283.07s",
].join("\n");

/** The same run with a different summary / error block. */
function tail(over: { files?: string; tests?: string; caught?: string; error?: string }): string {
  return [
    `Vitest caught ${over.caught ?? "1 unhandled error"} during the test run.`,
    over.error ?? 'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
    ` Test Files  ${over.files ?? "138 passed | 1 skipped (139)"}`,
    `      Tests  ${over.tests ?? "3180 passed | 22 skipped (3202)"}`,
  ].join("\n");
}

describe("scripts/test-ci.mjs – which failed vitest runs it accepts", () => {
  it("accepts the real output: everything passed and the one error is vitest's worker timeout", () => {
    expect(onlyWorkerTimeout(REAL_TAIL)).toBe(true);
    expect(onlyWorkerTimeout(tail({}))).toBe(true);
  });

  it("accepts several timeouts when every caught error is one", () => {
    const two = `${tail({ caught: "2 unhandled errors" })}\nError: [vitest-worker]: Timeout calling "onTaskUpdate"`;
    expect(onlyWorkerTimeout(two)).toBe(true);
  });

  it("refuses a run in which a test failed", () => {
    expect(onlyWorkerTimeout(tail({ tests: "1 failed | 3179 passed | 22 skipped (3202)" }))).toBe(false);
    expect(onlyWorkerTimeout(tail({ files: "1 failed | 137 passed | 1 skipped (139)" }))).toBe(false);
  });

  it("refuses a run in which some file or test is not accounted for (a crashed worker)", () => {
    expect(onlyWorkerTimeout(tail({ files: "137 passed | 1 skipped (139)" }))).toBe(false);
    expect(onlyWorkerTimeout(tail({ tests: "3100 passed | 22 skipped (3202)" }))).toBe(false);
  });

  it("refuses another unhandled error next to the timeout, or another kind of timeout", () => {
    expect(onlyWorkerTimeout(`${tail({ caught: "2 unhandled errors" })}\nTypeError: x is not a function`)).toBe(false);
    expect(onlyWorkerTimeout(tail({ error: 'Error: [vitest-worker]: Timeout calling "fetch" with "[]"' }))).toBe(false);
    expect(onlyWorkerTimeout(tail({ caught: "0 unhandled errors" }))).toBe(false);
  });

  it("refuses output without a summary, an empty run and a run with no passing test", () => {
    expect(onlyWorkerTimeout("")).toBe(false);
    expect(onlyWorkerTimeout('Vitest caught 1 unhandled error\nError: [vitest-worker]: Timeout calling "onTaskUpdate"')).toBe(false);
    expect(onlyWorkerTimeout(tail({ files: "1 skipped (1)", tests: "3 skipped (3)" }))).toBe(false);
  });
});
