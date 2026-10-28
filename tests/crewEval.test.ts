import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import {
  CLEAN_COUNT,
  DEFECT_CLASSES,
  DEFECTS,
  EVAL_ASK_ORDER,
  EVAL_CONFIGS,
  FIXES_FOR_KIND,
  PLANTED_PER_CLASS,
  checkEvalReply,
  clarityOf,
  configMetrics,
  confirmedBeyondTemplate,
  confirmedKinds,
  corpusHash,
  createPanel,
  crowding,
  defectHolds,
  drawnHookText,
  evalMetrics,
  failedGates,
  fixtureOfJson,
  fixtureToJson,
  nextEvalAsk,
  nextStep,
  overlaysOf,
  recordedAnswer,
  remediesOf,
  renderEvalTables,
  shownSecOf,
  simpleScore,
  softClean,
  type EvalAnswer,
  type EvalAsk,
  type EvalFixture,
  type EvalFixtureJson,
  type ObjectionKind,
} from "@/lib/crew";
import { crewEvalBrainstorm, crewEvalCorpusFiles, crewEvalDoc, crewEvalRunSection, type CrewEvalRun } from "@/lib/agentKit/studioKit";

/*
 * --- crew --- The role eval (lib/crew/eval.ts, C7 of the AI studio plan; docs/agents/CREW-EVAL.md): the fixture corpus is what
 * the code generates, byte for byte (npm run crew:fixtures), every planted clip carries exactly its defect and every clean one
 * none; the panel leaves an "off" role to the rules; the eval asks the cold viewer first; scripted models reproduce known
 * numbers – derived by hand for a model that always objects, pinned for a heuristic trio that reads the briefs – and every
 * recorded run in tests/fixtures/crew/runs/ is in the doc as generated, and replays to its own numbers while it is current.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const copy = (en as unknown as { ViralBot: Parameters<typeof crewEvalCorpusFiles>[0] }).ViralBot;
const copyOf = () => copy;

const CLEAN_TEXT = read("tests/fixtures/crew/clean.json");
const PLANTED_TEXT = read("tests/fixtures/crew/planted.json");
const fixturesOf = (text: string) => (JSON.parse(text) as { fixtures: EvalFixtureJson[] }).fixtures.map(fixtureOfJson);
const CLEAN = fixturesOf(CLEAN_TEXT);
const PLANTED = fixturesOf(PLANTED_TEXT);
const CORPUS: EvalFixture[] = [...CLEAN, ...PLANTED].sort((a, b) => (a.id < b.id ? -1 : 1));
const HARD = PLANTED.filter((f) => DEFECTS[f.defect!].gate !== null);
const SOFT = PLANTED.filter((f) => DEFECTS[f.defect!].gate === null);
const config = (id: string) => EVAL_CONFIGS.find((c) => c.id === id)!;

describe("the fixture corpus (--- crew ---)", () => {
  it("is what the code generates, byte for byte (run npm run crew:fixtures after a change)", () => {
    const made = crewEvalCorpusFiles(copy);
    expect(made.notes.filter((n) => !/no clean plan/.test(n))).toEqual([]);
    expect(made.clean === CLEAN_TEXT, "tests/fixtures/crew/clean.json is stale: run npm run crew:fixtures").toBe(true);
    expect(made.planted === PLANTED_TEXT, "tests/fixtures/crew/planted.json is stale: run npm run crew:fixtures").toBe(true);
    expect(made.hash).toBe(corpusHash(CLEAN_TEXT, PLANTED_TEXT));
  }, 240_000);

  it("holds 40 clean clips and 27 planted ones, 3 in each of 9 classes, with ids that say nothing of the defect", () => {
    expect(CLEAN.length).toBe(CLEAN_COUNT);
    expect(PLANTED.length).toBe(PLANTED_PER_CLASS * DEFECT_CLASSES.length);
    for (const d of DEFECT_CLASSES) expect([d, PLANTED.filter((f) => f.defect === d).map((f) => f.variant).sort()]).toEqual([d, [0, 1, 2]]);
    const ids = CORPUS.map((f) => f.id);
    expect(ids).toEqual(Array.from({ length: ids.length }, (_, i) => `f${String(i + 1).padStart(2, "0")}`));
    // (the planted ones are spread over the ids: no class sits in a run of its own)
    const firstHalf = new Set(CORPUS.slice(0, 34).filter((f) => f.defect).map((f) => f.defect));
    expect(firstHalf.size).toBeGreaterThanOrEqual(5);
    // Fight League's fighters are third-party characters: none in the corpus
    expect(CORPUS.some((f) => f.clip.mode === "fightLeague")).toBe(false);
  });

  it("round-trips through its file form, settings kept as the keys off the mode's defaults", () => {
    for (const f of CORPUS) {
      const back = fixtureOfJson(JSON.parse(JSON.stringify(fixtureToJson(f))) as EvalFixtureJson);
      expect(JSON.stringify(back), f.id).toBe(JSON.stringify(f));
    }
  });

  it("has clean clips that pass every gate and cross no evidence line beyond their template's own", () => {
    for (const f of CLEAN) {
      expect([f.id, softClean(f.clip)]).toEqual([f.id, true]);
      expect([f.id, f.defect, f.variant]).toEqual([f.id, null, 0]);
    }
  });

  it("plants exactly one defect in a clean twin: its gate alone fails, or (a soft class) every gate passes", () => {
    const sources = new Set<string>();
    for (const f of PLANTED) {
      const twin = CLEAN.find((c) => c.source === f.source);
      expect([f.id, !!twin]).toEqual([f.id, true]);
      expect([f.id, sources.has(f.source)]).toEqual([f.id, false]);
      sources.add(f.source);
      expect([f.id, f.defect, defectHolds(f.clip, f.defect!)]).toEqual([f.id, f.defect, true]);
      const failed = failedGates(clarityOf(f.clip));
      expect([f.id, failed]).toEqual([f.id, DEFECTS[f.defect!].gate ? [DEFECTS[f.defect!].gate] : []]);
      const c = f.clip;
      const t = twin!.clip;
      // the named transform, and nothing else of the run
      expect([f.id, c.seed, c.mode, c.recipe, c.template, JSON.stringify(c.run?.summary.teams)]).toEqual([f.id, t.seed, t.mode, t.recipe, t.template, JSON.stringify(t.run?.summary.teams)]);
      switch (f.defect) {
        case "slowStart":
          expect([f.id, c.timing.firstImpactSec]).toEqual([f.id, [1.4, 1.9, 2.4][f.variant]]);
          break;
        case "payoffCut":
          expect([f.id, c.timing.clipSec < c.payoff.atSec!]).toEqual([f.id, true]);
          break;
        case "payoffLate":
          expect([f.id, c.payoff.position! > 0.9 && c.payoff.position! <= 0.97, c.timing.clipSec - c.payoff.atSec! >= 0.85 - 1e-9]).toEqual([f.id, true, true]);
          break;
        case "textUnreadable":
          expect([f.id, drawnHookText(c).split(/\s+/).length > 7]).toEqual([f.id, true]);
          break;
        case "tooBusy": {
          const score = simpleScore(c).score;
          expect([f.id, score >= 60 && score <= 78, JSON.stringify(c.captions)]).toEqual([f.id, true, JSON.stringify(t.captions)]);
          break;
        }
        case "hookUntrue":
        case "hookMismatch":
        case "twoIdeas":
          expect([f.id, drawnHookText(c) !== drawnHookText(t), c.hook]).toEqual([f.id, true, drawnHookText(c)]);
          break;
        case "endingConfusing":
          expect([f.id, c.payoff.text !== t.payoff.text, c.ending]).toEqual([f.id, true, "resolved"]);
          break;
      }
    }
  });

  it("names, for each class, the kinds and the fixes that answer it", () => {
    for (const d of DEFECT_CLASSES) {
      expect(DEFECTS[d].kinds.length, d).toBeGreaterThan(0);
      expect(remediesOf(d)).toEqual([...new Set(DEFECTS[d].kinds.flatMap((k: ObjectionKind) => FIXES_FOR_KIND[k]))]);
    }
    // the HUD a template keeps beside its hook (two messages at once, Simple 80 or more) is the template's own: the tooBusy line
    // leaves it out (evidence.ts, review round 2), so such clips are clean and no measurable kind is confirmed on them
    const hudClean = CLEAN.filter((f) => crowding(overlaysOf(f.clip), shownSecOf(f.clip)).most >= 2);
    expect(hudClean.length).toBeGreaterThan(0);
    for (const f of hudClean) expect([f.id, simpleScore(f.clip).score >= 80, confirmedKinds(f.clip), confirmedBeyondTemplate(f.clip)]).toEqual([f.id, true, [], []]);
  });
});

describe("a run that leaves roles to the rules (--- crew --- PanelInput.off)", () => {
  it("never asks an off role: the skeptic and the viewer skipped, the reviewer's place the rules', each labelled off", () => {
    const f = CLEAN[0];
    let state = createPanel({ stage: "pre", depth: "thorough", wanted: 1, candidates: [{ id: f.id, clip: f.clip }], off: ["skeptic", "viewer", "reviewer", "producer"] });
    const { state: s, step } = nextStep(state);
    state = s;
    expect(step.type).toBe("done");
    const c = state.clips[0];
    expect([c.skeptic.source, c.skeptic.why, c.viewer.source, c.viewer.why, c.reviewer.source, c.reviewer.why, c.verdict]).toEqual(["skipped", "off", "skipped", "off", "rules", "off", "keep"]);
    expect([state.producer.source, state.producer.why, state.spent.calls]).toEqual(["rules", "off", 0]);
    // the same panel with nothing off asks the viewer first
    const asked = nextStep(createPanel({ stage: "pre", depth: "thorough", wanted: 1, candidates: [{ id: f.id, clip: f.clip }] })).step;
    expect(asked.type === "call" && asked.role).toBe("viewer");
  });

  it("leaves an off brainstormer's ideas to the code", () => {
    const bs = crewEvalBrainstorm(copyOf);
    const state = createPanel({ stage: "pre", depth: "quick", wanted: 2, request: { text: "anything", open: true, platform: "reels", locale: "en" }, menu: bs.menu, off: ["brainstormer"] });
    const { state: s, step } = nextStep(state);
    expect([step.type, s.brainstormer.source, s.brainstormer.why, s.ideas.length]).toEqual(["plan", "rules", "off", 4]);
  });
});

/* ------------------------------------------------------------------ scripted models */

/** The dossier's lines of a brief (its leading system message), by key. */
function dossierOf(prefix: string): Record<string, string> {
  const at = prefix.indexOf("The clip's dossier:\n");
  const out: Record<string, string> = {};
  for (const line of prefix.slice(at + 20).split("\n")) {
    const m = /^([a-zA-Z.]+): (.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const CLAIM_WORDS: Record<string, RegExp> = {
  out: /escape|get out|free|home|make it|out\b/,
  winner: /win|colou?r|survivor|takes|pick|last/,
  count: /how many|balls?|x2|spawns|more/,
  full: /fill|grow|full/,
  inSync: /line|sync|meet|chord|together|wait/,
  beat: /note|beat|sound|peg|song/,
  break: /break|hit|smash|crack|power|layer/,
};
const OTHER_PAYOFF = /FULL!|Smashed|In sync|Bullseye|ESCAPED/;
const OWN_PAYOFF: Record<string, RegExp> = { out: /ESCAPED|FREE|HOME/, full: /FULL/, break: /BROKE|Smashed|FREEDOM/, inSync: /line|together/i, beat: /chord/i, count: /stops|count|\d/i, winner: /wins|standing|taken|last/i };

/** A heuristic skeptic: the payoff past 90 %, Simple below 80, a hook without its claim's words, two questions, another format's payoff. */
const scriptedSkeptic = (ask: EvalAsk) => {
  const d = dossierOf(ask.brief.prefix);
  const objections: { id: string; kind: string; evidence: string[]; severity: string; note: string }[] = [];
  const add = (kind: string, evidence: string[], severity: string) => objections.length < 3 && objections.push({ id: `o${objections.length + 1}`, kind, evidence, severity, note: kind });
  const pos = /\((\d+)%\)/.exec(d["beats.payoff"] ?? "");
  if (pos && Number(pos[1]) > 90 && d["clip.ending"] === "resolved") add("payoffLate", ["beats.payoff"], "major");
  if (Number(d["score.simple"]) < 80) add("tooBusy", ["score.simple"], "major");
  const claim = d["clip.claim"];
  const hook = (d["words.hook"] ?? "").toLowerCase();
  if (CLAIM_WORDS[claim] && !CLAIM_WORDS[claim].test(hook)) add("hookMismatch", ["words.hook", "clip.claim"], "major");
  if (/, or | or /.test(hook) && hook.includes("?")) add("twoIdeas", ["words.hook"], "major");
  const payoff = d["words.payoff"] ?? "";
  if (OTHER_PAYOFF.test(payoff) && !(OWN_PAYOFF[claim]?.test(payoff) ?? false)) add("endingConfusing", ["words.payoff"], "major");
  return { oneIdea: `the clip's ${claim}`, objections };
};

/** A heuristic viewer: the first text's words against each claim's words; effects named when the look is charged. */
const scriptedViewer = (ask: EvalAsk) => {
  const first = /- [^:]*: "([^"]*)"/.exec(ask.brief.user)?.[1]?.toLowerCase() ?? "";
  const read = Object.entries(CLAIM_WORDS).find(([, re]) => re.test(first))?.[0] ?? "notSure";
  const charged = /rainbow|pulsing|shake|confetti|colour-cycling|glowing walls/.test(ask.brief.user);
  return { whatHappens: read, understood: first.slice(0, 80) || "a ball moving", waitingFor: "the end", clearBySec: 2, distractions: charged ? ["effects"] : [], watchToEnd: charged ? "maybe" : "yes" };
};

const SAFE_HOOK: Record<string, string> = { out: "Will it get out?", winner: "Which colour wins?", count: "How many by the end?", full: "Can it fill the ring?", inSync: "Wait for them to line up.", beat: "Sound on.", break: "Every hit cracks it." };

/** A heuristic reviewer: every standing objection accepted with a fix of its kind (a new hook, a calm look, a retime), a drop when refused. */
const scriptedReviewer = (ask: EvalAsk) => {
  const user = ask.brief.user;
  const objections = JSON.parse(/Objections \(JSON[^)]*\): (.*)/.exec(user)![1]) as { id: string; kind: string; severity: string; mark: string }[];
  const viewerLine = /The viewer's read \(JSON\): (.*)/.exec(user)![1];
  const viewer = viewerLine.startsWith("none") ? null : (JSON.parse(viewerLine) as { makesSense: string });
  const d = dossierOf(ask.brief.prefix);
  const hook = { action: "rewriteHook", text: SAFE_HOOK[d["clip.claim"]] ?? "Watch this." };
  const fixFor = (kind: string) => (kind === "tooBusy" ? { action: "simplifyLook" } : kind === "payoffLate" || kind === "payoffEarly" ? { action: "retimePayoff", targetPos: 0.85 } : kind === "slowStart" ? { action: "reseedEarlyMotion" } : hook);
  const drop = ask.attempt > 1 || d.gates?.startsWith("fail");
  const answers = objections.map((o) => ({ objection: o.id, accept: true, reason: null, fix: drop || o.severity === "minor" ? null : fixFor(o.kind) }));
  const misread = viewer !== null && viewer.makesSense !== "yes";
  const viewerAnswer = viewer === null ? null : { accept: true, fix: misread && !drop ? hook : null };
  const fixes: unknown[] = [];
  for (const f of [...answers.map((a) => a.fix), viewerAnswer?.fix ?? null]) if (f && !fixes.some((x) => JSON.stringify(x) === JSON.stringify(f))) fixes.push(f);
  return { verdict: drop ? "drop" : fixes.length ? "fix" : "keep", confidence: "medium", answers, viewerAnswer, fixes: drop ? [] : fixes.slice(0, 3), why: drop ? "no fix holds" : fixes.length ? "the fixes answer the objections" : "clear" };
};

const scriptedBrainstormer = (ask: EvalAsk) => {
  const menu = [...ask.brief.user.matchAll(/^- ([a-z0-9-]+) \(([a-zA-Z]+)\): ([a-zA-Z]+);/gm)].map((m) => ({ template: m[1], format: m[2], mode: m[3] }));
  const firsts = menu.filter((m, i) => menu.findIndex((x) => x.format === m.format) === i);
  return { ideas: firsts.slice(0, 6).map((m, i) => ({ template: m.template, mode: m.mode, hook: "a", ending: "resolved", bucket: "standard", angle: `idea ${i + 1}`, basis: "none" })) };
};

const scripted: EvalAnswer = (ask) => {
  switch (ask.role) {
    case "skeptic":
      return scriptedSkeptic(ask);
    case "viewer":
      return scriptedViewer(ask);
    case "reviewer":
      return scriptedReviewer(ask);
    case "brainstormer":
      return scriptedBrainstormer(ask);
    default:
      return undefined;
  }
};

describe("the eval's numbers (--- crew ---)", () => {
  it("counts by hand for a skeptic that objects twoIdeas (an opinion) to everything, and for the rules alone", () => {
    const always: EvalAnswer = (ask) => (ask.role === "skeptic" ? { oneIdea: "x", objections: [{ id: "o1", kind: "twoIdeas", evidence: ["words.hook"], severity: "major", note: "two ideas" }] } : undefined);
    const rules = configMetrics(CORPUS, config("rules"), always).metrics;
    // the rules alone: the four gate classes caught before any model (12 clips), nothing else, no clean clip dropped, no call
    expect([rules.planted.caught, rules.planted.flagged, rules.clean.dropped, rules.clean.objected, rules.calls, rules.kept]).toEqual([HARD.length, HARD.length, 0, 0, 0, CLEAN.length + SOFT.length]);
    const sk = configMetrics(CORPUS, config("skeptic"), always);
    expect(sk.missing).toEqual([]);
    const m = sk.metrics;
    // one skeptic call on each clip that passes the gates; an opinion never blocks, so the rules keep every one of them
    const named = SOFT.filter((f) => DEFECTS[f.defect!].kinds.includes("twoIdeas")).length;
    expect([m.calls, m.kept, m.callsPerKept, m.planted.caught, m.planted.flagged, m.clean.objected, m.clean.dropped]).toEqual([CLEAN.length + SOFT.length, CLEAN.length + SOFT.length, 1, HARD.length, HARD.length + named, CLEAN.length, 0]);
    expect(named).toBe(6);
  });

  it("asks the cold viewer's briefs before any intent dossier, the brainstormer's last", () => {
    expect(EVAL_ASK_ORDER[0]).toBe("viewer");
    const first = nextEvalAsk(CORPUS, () => undefined);
    expect([first?.config, first?.role]).toEqual(["viewer", "viewer"]);
    // once every viewer brief is answered, the next is a skeptic's
    const viewerOnly: EvalAnswer = (ask) => (ask.role === "viewer" ? scriptedViewer(ask) : undefined);
    const after = nextEvalAsk(CORPUS, viewerOnly);
    expect([after?.config, after?.role]).toEqual(["skeptic", "skeptic"]);
    // and the brainstormer's come after every clip's
    const allButIdeas: EvalAnswer = (ask) => (ask.role === "brainstormer" ? undefined : scripted(ask));
    const last = nextEvalAsk(CORPUS, allButIdeas, crewEvalBrainstorm(copyOf));
    expect([last?.config, last?.role]).toEqual(["brainstormer", "brainstormer"]);
  }, 240_000);

  it("checks a reply where the eval asks it: a schema miss is refused with its errors", () => {
    const ask = nextEvalAsk(CORPUS, () => undefined)!;
    const bad = checkEvalReply(CORPUS, ask, { whatHappens: "flying" }, () => undefined);
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
    const good = checkEvalReply(CORPUS, ask, scriptedViewer(ask), () => undefined);
    expect(good).toEqual({ ok: true, errors: [] });
  });

  it("reproduces the scripted trio's numbers exactly (the wiring and the maths, not a model's quality)", () => {
    const { metrics, missing } = evalMetrics(CORPUS, scripted, crewEvalBrainstorm(copyOf));
    expect(missing).toEqual([]);
    expect(renderEvalTables(metrics)).toBe(SCRIPTED_TABLES);
  }, 240_000);
});

describe("the recorded runs (--- crew --- tests/fixtures/crew/runs/)", () => {
  const dir = path.join(ROOT, "tests", "fixtures", "crew", "runs");
  const runs: CrewEvalRun[] = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as CrewEvalRun) : [];
  const doc = read("docs/agents/CREW-EVAL.md");

  it("are in docs/agents/CREW-EVAL.md as generated (npm run crew:fixtures), each named by its file", () => {
    expect(runs.length).toBeGreaterThan(0);
    expect(crewEvalDoc(doc, runs) === doc, "docs/agents/CREW-EVAL.md is stale: run npm run crew:fixtures").toBe(true);
    for (const run of runs) {
      expect(doc).toContain(crewEvalRunSection(run));
      expect([run.v, run.who, typeof run.model, /^\d{4}-\d{2}-\d{2}$/.test(run.date)]).toEqual([1, "claude", "string", true]);
    }
  });

  it("sit in a guide that names only real scripts and files", () => {
    const scripts = Object.keys((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts);
    for (const m of doc.matchAll(/\bnpm run(?: -s)? ([a-z][\w:.-]*)/g)) expect(scripts, m[0]).toContain(m[1]);
    for (const m of doc.matchAll(/`((?:docs|src|tests|scripts|\.claude)\/[\w./-]+)`/g)) expect(fs.existsSync(path.join(ROOT, m[1])), m[1]).toBe(true);
    for (const d of DEFECT_CLASSES) expect(doc, d).toContain(`| ${d} | ${DEFECTS[d].gate ?? "none"} |`);
  });

  it("replay to their own numbers while they are current: the same corpus, every brief answered", () => {
    const current = runs.filter((r) => r.current);
    expect(current.length).toBeGreaterThan(0);
    for (const run of current) {
      expect(run.corpusHash, `${run.name} answers another corpus: run the eval again, or keep it as history (current: false)`).toBe(corpusHash(CLEAN_TEXT, PLANTED_TEXT));
      const { metrics, missing } = evalMetrics(CORPUS, recordedAnswer(run.answers), crewEvalBrainstorm(copyOf));
      expect(missing.map((m) => `${m.config} ${m.role} ${m.item}`), `${run.name}: briefs its answers no longer meet (the crew's briefs changed): run the eval again, or keep it as history`).toEqual([]);
      expect(metrics).toEqual(run.metrics);
    }
  }, 240_000);
});

/** The scripted trio's tables (pinned: a change to the crew's rules or the corpus moves them, on purpose or not). */
const SCRIPTED_TABLES = [
  "Corpus: 40 clean clips, 27 planted (9 classes).",
  "",
  "| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| rules | no model: the rules alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 0 |",
  "| skeptic | the skeptic; the rules decide | 18 of 27 (67%) | 27 of 27 (100%) | 0 of 40 (0%) | 0 of 40 (0%) | 4 of 40 (10%) | 0 of 40 (0%) | none asked | 1.12 |",
  "| viewer | the viewer; the rules decide | 12 of 27 (44%) | 21 of 27 (78%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 10 of 40 (25%) | none asked | 1 |",
  "| reviewer | the reviewer alone | 12 of 27 (44%) | 12 of 27 (44%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | 0 of 40 (0%) | none asked | 1 |",
  "| quick | Quick: the skeptic, the reviewer where in doubt | 27 of 27 (100%) | 27 of 27 (100%) | 0 of 40 (0%) | 4 of 40 (10%) | 4 of 40 (10%) | 0 of 40 (0%) | 16 / 19 (3 need the seed search) | 1.42 |",
  "| all | Thorough: the viewer, the skeptic, the reviewer | 27 of 27 (100%) | 27 of 27 (100%) | 0 of 40 (0%) | 10 of 40 (25%) | 4 of 40 (10%) | 10 of 40 (25%) | 22 / 25 (3 need the seed search) | 3.17 |",
  "",
  "| Defect (3 each) | Gate | rules | skeptic | viewer | reviewer | quick | all |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| slowStart | G1 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |",
  "| payoffCut | G2 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |",
  "| hookUntrue | G4 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |",
  "| textUnreadable | G5 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |",
  "| payoffLate | none | 0/3 | 3/3 | 0/3 | 0/3 | 3/3 | 3/3 |",
  "| tooBusy | none | 0/3 | 3/3 | 0/3 | 0/3 | 3/3 | 3/3 |",
  "| hookMismatch | none | 0/3 | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 |",
  "| twoIdeas | none | 0/3 | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 |",
  "| endingConfusing | none | 0/3 | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 |",
  "",
  "| Ideas for open requests | Requests | Ideas | Planned | Pass every gate | Formats a request | Calls | Valid first time |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| by code (ideasByCode) | 3 | 18 | 18 | 15 of 18 (83%) | 6 | 0 | - |",
  "| the brainstormer | 3 | 18 | 18 | 15 of 18 (83%) | 6 | 3 | 3 of 3 |",
].join("\n");
