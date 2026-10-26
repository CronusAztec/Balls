#!/usr/bin/env node
// --- trends --- What is trending, for the app's AI: the inspire reports of the agent toolbox (`npm run agent -- inspire`)
// summed up in src/content/trends.json, which is committed and read next to the virality playbook by the planner, Make
// videos and the idea generator (src/lib/desktop/ai/playbookContext.ts trendingContext).
//   npm run trends -- <report.json or inspire run folder> …   write src/content/trends.json from these reports
//   npm run trends -- --stdout <report.json or folder> …       print the summary instead of writing it
//   npm run trends -- --check                                   exit 1 when src/content/trends.json fails its check
// The maths are the inspire report's own (src/lib/agentKit/trends.ts, on the toolbox's tool core bundle) and the shape and
// check are src/lib/trends.ts: dated, the queries, the sample, the numbers and patterns, the themes, the title formats and
// recommendations in our levers, and the links and titles of the most viewed videos. It reads only report.json files inside
// the repository, never a video, and writes only src/content/trends.json. Exit 0 done, 1 failed, 2 a usage error.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadToolCore } from "./agent/bundle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TRENDS_FILE = path.join(ROOT, "src", "content", "trends.json");

/** The report.json a path names (the file, or an inspire run folder), inside the repository. */
export function reportFile(arg) {
  const resolved = path.resolve(ROOT, arg);
  const rel = path.relative(ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${arg} is outside the repository`);
  const file = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? path.join(resolved, "report.json") : resolved;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${arg} has no report.json (give an inspire run folder or its report.json)`);
  const real = fs.realpathSync(file);
  const realRel = path.relative(fs.realpathSync(ROOT), real);
  if (realRel.startsWith("..") || path.isAbsolute(realRel)) throw new Error(`${arg} leads outside the repository`);
  return real;
}

/** The site's mode ids (messages/en.json Modes: the entries with a name), as inspire reads them. */
function modeIds() {
  const modes = JSON.parse(fs.readFileSync(path.join(ROOT, "messages", "en.json"), "utf8")).Modes ?? {};
  return Object.keys(modes).filter((k) => modes[k] && typeof modes[k] === "object" && typeof modes[k].name === "string");
}

async function main(argv) {
  const check = argv.includes("--check");
  const toStdout = argv.includes("--stdout");
  const args = argv.filter((a) => !a.startsWith("--"));
  const unknown = argv.filter((a) => a.startsWith("--") && a !== "--check" && a !== "--stdout");
  if (unknown.length || (check && args.length) || (!check && !args.length)) {
    process.stderr.write("usage: npm run trends -- <report.json or inspire run folder> … [--stdout] | --check\n");
    return 2;
  }
  const tb = await loadToolCore();
  if (check) {
    const problems = tb.validateTrends(JSON.parse(fs.readFileSync(TRENDS_FILE, "utf8")));
    if (problems.length) {
      process.stderr.write(`src/content/trends.json fails its check:\n${problems.map((p) => `  ${p}`).join("\n")}\n`);
      return 1;
    }
    process.stdout.write("src/content/trends.json is sound\n");
    return 0;
  }
  const reports = args.map((a) => {
    const file = reportFile(a);
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!report || typeof report !== "object" || !Array.isArray(report.videos)) throw new Error(`${a} is no inspire report`);
    return report;
  });
  const summary = tb.buildTrendSummary(reports, { modes: modeIds() });
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (toStdout) process.stdout.write(text);
  else {
    fs.writeFileSync(TRENDS_FILE, text);
    process.stdout.write(`wrote src/content/trends.json: ${summary.sample.compared} short-form videos from ${summary.sources.length} report${summary.sources.length === 1 ? "" : "s"}, ${summary.date}\n`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`trends: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    },
  );
}
