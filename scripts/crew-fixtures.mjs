#!/usr/bin/env node
/**
 * --- crew --- The role eval's committed files (docs/agents/CREW-EVAL.md), generated from the code and never edited by hand:
 *   npm run crew:fixtures
 *       writes the fixture corpus, tests/fixtures/crew/clean.json and planted.json (the studio kit's planner on the ready
 *       templates, and lib/crew/eval.ts plantDefect), and the generated tables of docs/agents/CREW-EVAL.md from the recorded
 *       runs in tests/fixtures/crew/runs/
 *   npm run crew:fixtures -- --check
 *       exit 1 when one of those files is not what the code generates
 *   npm run crew:fixtures -- --record <studio> --model <the model's id> [--name <run>] [--date <yyyy-mm-dd>]
 *       keeps a finished eval (.agent-out/studio/<studio>/eval.json, the review tool's fixture mode) as
 *       tests/fixtures/crew/runs/<run>.json (default: the studio's name) and writes its tables into the doc
 * tests/crewEval.test.ts fails while a file is stale. It reads the repository and .agent-out/, writes only these files, and
 * calls no model. Exit 0 done, 1 stale or failed, 2 a usage error.
 */
import fs from "fs";
import path from "path";
import { loadStudioKit } from "./agent/bundle.mjs";
import { OUT_DIR, ROOT, isInside, isMainModule } from "./agent/paths.mjs";

const CORPUS_DIR = path.join(ROOT, "tests", "fixtures", "crew");
const RUNS_DIR = path.join(CORPUS_DIR, "runs");
const DOC = path.join(ROOT, "docs", "agents", "CREW-EVAL.md");
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};
const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");
const copyOf = (locale) => JSON.parse(fs.readFileSync(path.join(ROOT, "messages", `${["en", "pl", "es"].includes(locale) ? locale : "en"}.json`), "utf8")).ViralBot ?? {};

function parseArgs(argv) {
  const out = { check: false, record: null, model: null, name: null, date: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") out.check = true;
    else if (a === "--record" || a === "--model" || a === "--name" || a === "--date") {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = v;
    } else throw new Error(`unknown argument ${a}`);
  }
  if (out.record !== null && (out.check || !out.model)) throw new Error("--record needs --model (and no --check)");
  for (const k of ["record", "name"]) if (out[k] !== null && !NAME.test(out[k])) throw new Error(`--${k} must be a bare name (letters, digits, . _ -)`);
  if (out.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) throw new Error("--date is yyyy-mm-dd");
  return out;
}

/** The recorded runs, in name order. */
function loadRuns() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8")));
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\nusage: npm run crew:fixtures [-- --check | --record <studio> --model <id> [--name <run>] [--date <yyyy-mm-dd>]]\n`);
    return 2;
  }
  const kit = await loadStudioKit();
  const wanted = new Map();
  if (args.record !== null) {
    const file = path.join(OUT_DIR, "studio", args.record, "eval.json");
    const text = read(file);
    if (text === null || !isInside(fs.realpathSync(OUT_DIR), fs.realpathSync(file))) {
      process.stderr.write(`no eval in .agent-out/studio/${args.record}/ (run review with "fixture":true there first)\n`);
      return 1;
    }
    const run = kit.crewEvalRunOf(JSON.parse(text), { name: args.name ?? args.record, model: args.model, date: args.date ?? new Date().toISOString().slice(0, 10) });
    if (!run) {
      process.stderr.write(`the eval in .agent-out/studio/${args.record}/ is not finished: answer its briefs until the review tool says "done"\n`);
      return 1;
    }
    const committed = kit.corpusHash(read(path.join(CORPUS_DIR, "clean.json")) ?? "", read(path.join(CORPUS_DIR, "planted.json")) ?? "");
    if (run.corpusHash !== committed) {
      process.stderr.write(`the eval answered corpus ${run.corpusHash}, the committed one is ${committed}: run it again on the committed corpus\n`);
      return 1;
    }
    wanted.set(path.join(RUNS_DIR, `${run.name}.json`), kit.studioFileText(run));
  }
  let hash = null;
  if (args.record === null) {
    const corpus = kit.crewEvalCorpusFiles(copyOf("en"));
    for (const note of corpus.notes) process.stderr.write(`note: ${note}\n`);
    hash = corpus.hash;
    wanted.set(path.join(CORPUS_DIR, "clean.json"), corpus.clean);
    wanted.set(path.join(CORPUS_DIR, "planted.json"), corpus.planted);
  }
  const runs = loadRuns().filter((r) => !wanted.has(path.join(RUNS_DIR, `${r.name}.json`)));
  for (const [file, text] of wanted) if (file.startsWith(RUNS_DIR)) runs.push(JSON.parse(text));
  runs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const doc = read(DOC);
  if (doc === null) {
    process.stderr.write("docs/agents/CREW-EVAL.md is missing\n");
    return 1;
  }
  wanted.set(DOC, kit.crewEvalDoc(doc, runs));
  const stale = [...wanted].filter(([file, text]) => read(file) !== text).map(([file]) => rel(file));
  if (args.check) {
    process.stdout.write(stale.length ? `stale: ${stale.join(", ")}: run npm run crew:fixtures\n` : `the role eval's files are current${hash ? ` (corpus ${hash})` : ""}\n`);
    return stale.length ? 1 : 0;
  }
  for (const [file, text] of wanted) {
    if (!stale.includes(rel(file))) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    process.stdout.write(`wrote ${rel(file)}\n`);
  }
  if (!stale.length) process.stdout.write(`the role eval's files are current${hash ? ` (corpus ${hash})` : ""}\n`);
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
