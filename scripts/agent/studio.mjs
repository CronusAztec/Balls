/**
 * --- studio --- Claude's studio in the agent toolbox (docs/agents/STUDIO.md): the file side of the five studio tools –
 * templates, plan, score, review, research – and of render's planned clip (browser.mjs renderPlanTool). The studio kit
 * (src/lib/agentKit/studioKit.ts, bundle.mjs loadStudioKit) does the work on values; this file reads what it needs and writes
 * what it hands back, only under .agent-out/studio/<studio>/:
 *  - plan.json   the plans (the plan tool, or the brainstormer's ideas planned by the review tool), with their runs;
 *  - panel.json  the crew's panel before and after the render (the app's own state machine's state), every role's verdict;
 *  - post.txt    the kept clips' words to post with the crew's lines;
 *  - <clip>/     a rendered clip: clip.mp4 (or .webm), sheet.png, hook-sheet.png and render.json (<clip>-fixed/: its fixed version);
 *  - eval.json   the role eval's answers (review with fixture), on the corpus it reads from tests/fixtures/crew/.
 * Every folder it writes through paths.mjs outFolder (bare names, never a link out of .agent-out/), made only once there is
 * something to write: a studio it only reads is named the same way and never created (studioPath). Every file written under
 * a fresh name and renamed into place (writeFileSafe), every file read checked to lead inside .agent-out/ first. It reads the
 * repository's own messages (the clip's words), the committed trend summary and the playbook, and the local inspire dataset;
 * it calls no model, reads no key, opens no network and installs no licence.
 */
import fs from "fs";
import path from "path";
import { OUT_DIR, PathError, ROOT, defaultOutName, isInside, outFolder, repoRelative, resolveInputFile, writeFileSafe } from "./paths.mjs";

export const PLAN_FILE = "plan.json";
// --- studio --- the role eval (docs/agents/CREW-EVAL.md): its corpus as committed, and a run's answers in the studio folder
export const CORPUS_DIR = path.join(ROOT, "tests", "fixtures", "crew");
export const CORPUS_FILES = ["clean.json", "planted.json"];
export const EVAL_FILE = "eval.json";
export const PANEL_FILE = "panel.json";
export const POST_FILE = "post.txt";
export const RENDER_FILE = "render.json";
const LOCALES = new Set(["en", "pl", "es"]);

/** The `ViralBot` words of a locale's messages (the clip's language: en, pl or es). */
export function copyOf(locale) {
  const l = LOCALES.has(locale) ? locale : "en";
  return JSON.parse(fs.readFileSync(path.join(ROOT, "messages", `${l}.json`), "utf8")).ViralBot ?? {};
}

/** A studio's folder, .agent-out/studio/<name>/ (created): for the tools that write one (plan, review). */
export const studioDir = (name) => outFolder("studio", name);
/**
 * --- studio --- A studio's folder for reading, .agent-out/studio/<name>/, with nothing created: a bare name, and .agent-out/
 * checked to lead inside the repository when it is there (readInside checks each file it reads). score is read-only, and a
 * render or a review that fails leaves no empty studio behind.
 */
export function studioPath(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes("..")) throw new PathError(`The folder name "${name}" must be a bare name (letters, digits, . _ -)`);
  if (fs.existsSync(OUT_DIR) && !isInside(fs.realpathSync(ROOT), fs.realpathSync(OUT_DIR))) throw new PathError(".agent-out leads outside the repository (a symbolic link): remove it");
  return path.join(OUT_DIR, "studio", name);
}
/** A rendered clip's folder parts under .agent-out/ (frames.mjs extractFrames' `folder`). */
export const clipFolder = (name, clip) => ["studio", name, clip];
/** A rendered clip's folder, .agent-out/studio/<name>/<clip>/ (created). */
export const clipDir = (name, clip) => outFolder(...clipFolder(name, clip));

/** A file of .agent-out/ as text, or null when there is none; one that leads out of .agent-out/ (a link) is refused. */
export function readInside(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new PathError(`${repoRelative(file)} is not a plain file (a link or a folder): remove it`);
  if (!isInside(fs.realpathSync(OUT_DIR), fs.realpathSync(file))) throw new PathError(`${repoRelative(file)} leads outside .agent-out/`);
  return fs.readFileSync(file, "utf8");
}

const parse = (text, what) => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${what} is not valid JSON (${e instanceof Error ? e.message : String(e)}): run the tool that writes it again`);
  }
};

/**
 * A studio as its files hold it: the plan (and the hash of plan.json's very text), the panel when it reviews that plan (a
 * panel of an older plan is left for the review tool to start over), and the folder (read, never created here).
 */
export function loadStudio(kit, name) {
  const dir = studioPath(name);
  const planText = readInside(path.join(dir, PLAN_FILE));
  const plan = parse(planText, `.agent-out/studio/${name}/${PLAN_FILE}`);
  const planHash = planText === null ? null : kit.studioHash(planText);
  const panelRaw = parse(readInside(path.join(dir, PANEL_FILE)), `.agent-out/studio/${name}/${PANEL_FILE}`);
  const panel = panelRaw && panelRaw.planHash === planHash ? panelRaw : null;
  return { name, dir, plan, planHash, panel, panelRaw };
}

/** The studio a plan.json path names: .agent-out/studio/<name>/plan.json inside the repository, nothing else. */
export function loadStudioOfPlan(kit, planPath) {
  const real = resolveInputFile(planPath);
  const base = path.join(fs.realpathSync(OUT_DIR), "studio");
  const rel = path.relative(base, real).split(path.sep);
  if (!isInside(base, real) || rel.length !== 2 || rel[1] !== PLAN_FILE || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rel[0])) throw new PathError(`${planPath} is not a studio's plan.json (.agent-out/studio/<studio>/plan.json, as the plan tool writes it)`);
  const loaded = loadStudio(kit, rel[0]);
  if (!loaded.plan) throw new Error(`${planPath} holds no plan`);
  return loaded;
}

/** Writes a rendered clip's record (render.json) beside it; its repository path. */
export function writeRenderRecord(kit, name, clip, record) {
  const file = path.join(clipDir(name, clip), RENDER_FILE);
  writeFileSafe(file, kit.studioFileText(record));
  return repoRelative(file);
}

/**
 * The studio's rendered clips (their render.json), in plan order: only those rendered from the clip as it stands now (the
 * same settings and seed: a re-plan or a new fix makes an older render stale, and it is left out with a note). --- studio ---
 * Each clip's fixed version (<clip>-fixed: the fix offered after its render, render {"fixed":true}) follows it, while the
 * panel after the render still offers that very fix.
 */
export function renderedClips(kit, loaded) {
  const out = [];
  const stale = [];
  for (const p of loaded.plan?.plans ?? []) {
    for (const fixed of [false, true]) {
      const id = fixed ? kit.fixedIdOf(p.id) : p.id;
      const file = path.join(loaded.dir, id, RENDER_FILE);
      if (!fs.existsSync(file)) continue;
      const record = parse(readInside(file), repoRelative(file));
      const job = kit.studioRenderJob(loaded.plan, loaded.panel, p.id, fixed ? { fixed: true, copyOf } : {});
      if (record?.v === 1 && record.clip === id && job.ok && record.query === job.job.query) out.push(record);
      else stale.push(id);
    }
  }
  return { records: out, stale };
}

/** The research inputs: the playbook, the committed trend summary, the local inspire dataset (when there is one). */
export function researchInputs(args = {}) {
  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(ROOT, rel), "utf8");
    } catch {
      return null;
    }
  };
  const trendsText = read("src/content/trends.json");
  let trends = null;
  try {
    trends = trendsText ? JSON.parse(trendsText) : null;
  } catch {
    trends = null;
  }
  const dataset = path.join(OUT_DIR, "inspiration", `${args.dataset ?? "dataset"}.jsonl`);
  const text = fs.existsSync(dataset) ? readInside(dataset) : null;
  const inspire = [];
  for (const line of (text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      inspire.push(JSON.parse(line));
    } catch {
      /* a line that cannot be read holds nothing */
    }
  }
  return { playbook: read("docs/virality-playbook.md"), trends, now: Date.now(), query: args.query, inspire, theme: args.theme, datasetFile: text === null ? null : repoRelative(dataset) };
}

/* ------------------------------------------------------------------ the tools */

export async function templatesTool(kit, args) {
  return kit.studioTemplates(args, copyOf(args.locale ?? "en"));
}

export async function planTool(kit, args) {
  const made = kit.studioPlan(args, copyOf(args.locale ?? "en"));
  if (!made.ok) throw new Error(made.error);
  const { studio: asked, ...rest } = args;
  const name = asked ?? defaultOutName(args.template ?? args.recipe ?? args.mode ?? "studio", rest);
  const file = { v: 1, studio: name, made: { by: "plan", args: rest }, plans: made.records };
  const text = kit.studioFileText(file);
  const planFile = path.join(studioDir(name), PLAN_FILE);
  writeFileSafe(planFile, text);
  return {
    studio: name,
    planFile: repoRelative(planFile),
    planHash: kit.studioHash(text),
    count: made.records.length,
    plans: made.records.map((r) => kit.studioEntry(r, { others: kit.othersOf(made.records, r.id) })),
    // --- studio --- the review, or (past the crew's limit of a studio) how to split the plans for it
    next: kit.studioPlanNext(name, made.records.length, rest),
  };
}

export async function scoreTool(kit, args) {
  if (args.studio === undefined) {
    const scored = await kit.studioScoreLink(args);
    if (!scored.ok) throw new Error(scored.error);
    return scored.result;
  }
  const loaded = loadStudio(kit, args.studio);
  if (!loaded.plan) throw new Error(`No plan.json in .agent-out/studio/${args.studio}/: plan first`);
  const found = kit.studioClip(loaded.plan, loaded.panel, args.clip);
  if (!found.ok) throw new Error(found.error);
  const rendered = renderedClips(kit, loaded).records.find((r) => r.clip === found.id);
  if (rendered) return { studio: args.studio, clip: found.id, source: "render", ...kit.renderSummary(rendered) };
  return { studio: args.studio, clip: found.id, source: found.panelClip ? "panel" : "plan", ...(found.panelClip ? { verdict: found.panelClip.verdict } : {}), ...kit.scoreOfCrewClip(found.clip) };
}

export async function researchTool(kit, args) {
  const inputs = researchInputs(args);
  return { ...kit.studioResearch(inputs), dataset: inputs.datasetFile };
}

/** The role eval's fixture corpus as committed (tests/fixtures/crew/clean.json and planted.json): its fixtures in id order and its hash. */
export function loadCorpus(kit) {
  const [clean, planted] = CORPUS_FILES.map((name) => fs.readFileSync(path.join(CORPUS_DIR, name), "utf8"));
  const fixtures = [clean, planted]
    .flatMap((text, i) => parse(text, `tests/fixtures/crew/${CORPUS_FILES[i]}`).fixtures)
    .map((json) => kit.fixtureOfJson(json))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { fixtures, hash: kit.corpusHash(clean, planted) };
}

/** The review tool's fixture mode: the role eval's next brief or a verdict for it, the run kept in .agent-out/studio/<studio>/eval.json. */
async function evalTool(kit, args) {
  const corpus = loadCorpus(kit);
  const record = parse(readInside(path.join(studioPath(args.studio), EVAL_FILE)), `.agent-out/studio/${args.studio}/${EVAL_FILE}`);
  const outcome = kit.studioEval(args, { studio: args.studio, fixtures: corpus.fixtures, corpusHash: corpus.hash, record, copyOf });
  if (!outcome.ok) throw new Error(outcome.error);
  const file = path.join(studioDir(args.studio), EVAL_FILE);
  writeFileSafe(file, kit.studioFileText(outcome.record));
  return { ...outcome.result, files: { eval: repoRelative(file) } };
}

export async function reviewTool(kit, args) {
  if (args.fixture === true) return evalTool(kit, args);
  const loaded = loadStudio(kit, args.studio);
  const stage = args.stage ?? "pre";
  const rendered = stage === "post" && loaded.plan ? renderedClips(kit, loaded) : { records: [], stale: [] };
  const inputs = researchInputs({});
  const { digest } = kit.studioDigest(inputs);
  const outcome = kit.studioReview(args, { studio: loaded.name, plan: loaded.plan, planHash: loaded.planHash, panel: loaded.panelRaw, rendered: rendered.records, digest, copyOf });
  if (!outcome.ok) throw new Error(outcome.error);
  const dir = studioDir(loaded.name); // (made here, once there is something to write)
  const files = {};
  if (outcome.plan) {
    const planFile = path.join(dir, PLAN_FILE);
    writeFileSafe(planFile, kit.studioFileText(outcome.plan));
    files.plan = repoRelative(planFile);
  }
  const panelFile = path.join(dir, PANEL_FILE);
  writeFileSafe(panelFile, kit.studioFileText(outcome.panel));
  files.panel = repoRelative(panelFile);
  if (outcome.post) {
    const postFile = path.join(dir, POST_FILE);
    writeFileSafe(postFile, outcome.post);
    files.post = repoRelative(postFile);
  }
  return { ...outcome.result, ...(rendered.stale.length ? { staleRenders: rendered.stale } : {}), files };
}

/** The MCP prompts' texts (cli.mjs --prompt): the studio kit's, made from lib/crew/roles.ts. */
export function promptOf(kit, name, args) {
  return kit.studioPrompt(name, args);
}
