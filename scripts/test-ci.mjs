#!/usr/bin/env node
// The unit tests for CI (`npm run test:ci`): `vitest run` with the same output and the same exit code, except for one false
// alarm of vitest's own. The simulation tests (tests/fightLeagueBalance*.test.ts and others) keep a test worker busy for
// seconds at a time; on a busy runner (a private repository's runners have 2 vCPUs) the worker's report of finished tests to
// the main process (`onTaskUpdate`) can then miss vitest's 60 s RPC limit. Vitest prints the error after the summary and exits
// 1 although every test passed – it failed the deploy of a green commit (Actions runs 267, 270 and 271).
// A run is accepted only when ALL of this holds: every test file and every test is accounted for as passed or skipped, none
// failed, and every unhandled error vitest caught is that timeout. Anything else keeps vitest's exit code.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;
const WORKER_TIMEOUT = /\[vitest-worker\]: Timeout calling "onTaskUpdate"/g;

/** "138 passed | 1 skipped (139)" -> { passed: 138, skipped: 1, total: 139 }; null when it does not parse. */
function parseCounts(segment) {
  const total = /\((\d+)\)\s*$/.exec(segment.trim());
  if (!total) return null;
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0, total: Number(total[1]) };
  for (const m of segment.matchAll(/(\d+) (passed|failed|skipped|todo)\b/g)) counts[m[2]] += Number(m[1]);
  return counts;
}

/**
 * Whether a failed `vitest run` was only the worker-reporting timeout described above.
 * @param {string} output everything vitest printed
 * @returns {boolean}
 */
export function onlyWorkerTimeout(output) {
  const text = String(output).replace(ANSI, "");
  const files = /^[ \t]*Test Files[ \t]+(.+)$/m.exec(text)?.[1];
  const tests = /^[ \t]*Tests[ \t]+(.+)$/m.exec(text)?.[1];
  if (!files || !tests) return false;
  for (const segment of [files, tests]) {
    const c = parseCounts(segment);
    if (!c || c.failed > 0 || c.passed + c.skipped + c.todo !== c.total || c.passed === 0) return false;
  }
  const caught = Number(/Vitest caught (\d+) unhandled errors?/.exec(text)?.[1] ?? 0);
  const timeouts = (text.match(WORKER_TIMEOUT) ?? []).length;
  return caught > 0 && timeouts === caught;
}

function main(args) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const child = spawn(process.execPath, [path.join(root, "node_modules", "vitest", "vitest.mjs"), "run", ...args], {
    cwd: root,
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });
  let seen = "";
  const keep = (chunk) => {
    seen += chunk.toString();
    if (seen.length > 8_000_000) seen = seen.slice(-4_000_000); // the summary and the errors are at the end
  };
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    keep(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    keep(chunk);
  });
  child.on("error", (err) => {
    console.error(`could not start vitest: ${err.message}`);
    process.exit(1);
  });
  child.on("close", (code) => {
    if (code === 0) process.exit(0);
    if (code === 1 && onlyWorkerTimeout(seen)) {
      console.log('::warning title=Vitest worker timeout::Every test passed; the only error was vitest\'s own "Timeout calling onTaskUpdate" (a busy runner). The run is accepted.');
      process.exit(0);
    }
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));
