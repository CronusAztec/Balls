import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { BOT_PLATFORMS, RECIPES } from "@/lib/bot/playbook";
import { planClip } from "@/lib/bot/planner";
import { defaultSettings } from "@/lib/settings";
import { validateJson, type JsonSchema } from "@/lib/desktop/ai/jsonSchema";
import { makeVideosFinal } from "@/lib/desktop/ai/studio";
import { toGrammarSchema } from "../desktop/src/ai/gbnf";
import {
  BRIEF_POINT_IDS,
  CLAIMS,
  CLUTTER_KEYS,
  CREW_ROLES,
  DOSSIER_KEYS,
  EFFECT_KEYS,
  FIX_ACTION_SCHEMA,
  FIX_ACTIONS,
  FIX_IDS,
  FIXES_FOR_KIND,
  FIXES_FOR_MISREAD,
  HUD_FLAGS,
  INTENT_MAX,
  MAKES_SENSE,
  MEASURABLE_KINDS,
  OBJECTION_KINDS,
  REVIEW_FINAL,
  ROLE_SPECS,
  RUN_MOVING_KEYS,
  SHARED_RUBRIC,
  SIMPLE_DEDUCTIONS,
  SKEPTIC_FINAL,
  VIEWER_FINAL,
  VIEWER_PREAMBLE,
  VIEWER_READS,
  brainstormFinal,
  checkBrainstorm,
  hookVariantOf,
  normaliseBrainstorm,
  OWN_HOOK_MIN_WORDS,
  checkProducer,
  checkReview,
  checkSkeptic,
  crewClipOfPlan,
  effortOf,
  intentView,
  normaliseProducer,
  normaliseResearch,
  normaliseReview,
  producerFinal,
  promptHash,
  protocolOf,
  recipeMenu,
  researchFinal,
  reviewFinal,
  simpleScore,
  taskOf,
  tokensLower,
  tokensUpper,
  type BrainstormResult,
  type FixAction,
  type MenuItem,
  type ReviewContext,
  type ReviewResult,
  type SkepticResult,
  type StandingObjection,
} from "@/lib/crew";

/*
 * --- crew --- The roles as data (lib/crew/roles.ts, C3 of the AI studio plan): every answer schema takes a sample answer and
 * refuses a wrong one, turns into a local grammar (desktop/src/ai/gbnf.ts) and is ready for structured outputs (closed objects,
 * the JsonSchema subset: the cloud converter of a later step strips the bounds it cannot send); the producer answers in Make
 * videos' own schema; the rubric is pinned; each card and every prompt fits its budget, and the shared prefix is long enough
 * to be cached; the viewer's words carry no intent; and the checks beyond the schemas hold the reviewer, the skeptic, the
 * brainstormer and the producer to the rules.
 */

const copy = (en as unknown as { ViralBot: Parameters<typeof planClip>[3]["copy"] }).ViralBot;

const fix = (action: FixAction["action"], extra: Record<string, unknown> = {}) => ({ action, ...extra }) as FixAction;
const objection = (id: "o1" | "o2" | "o3", kind: StandingObjection["kind"], severity: StandingObjection["severity"], mark: StandingObjection["mark"]): StandingObjection => ({ id, kind, severity, mark });
const ctx = (over: Partial<ReviewContext> = {}): ReviewContext => ({ stage: "pre", objections: [], viewer: null, gateFails: false, ...over });
const review = (over: Partial<ReviewResult> = {}): ReviewResult => ({ verdict: "keep", confidence: "high", answers: [], viewerAnswer: null, fixes: [], why: "clear and simple", ...over });

/** Every sub-schema of a schema (itself included). */
function walk(schema: JsonSchema, out: JsonSchema[] = []): JsonSchema[] {
  out.push(schema);
  for (const s of Object.values(schema.properties ?? {})) walk(s, out);
  if (schema.items) walk(schema.items, out);
  for (const s of schema.oneOf ?? []) walk(s, out);
  return out;
}

const menu = recipeMenu();
const SCHEMAS: [string, JsonSchema, unknown, unknown][] = [
  ["skeptic", SKEPTIC_FINAL, { oneIdea: "Will the ball get out of 12 rings?", objections: [{ id: "o1", kind: "payoffLate", evidence: ["beats.payoff"], severity: "major", note: "lands at 95%" }] }, { oneIdea: "x", objections: [{ id: "o1", kind: "boring", evidence: ["beats.payoff"], severity: "major", note: "" }] }],
  ["viewer", VIEWER_FINAL, { whatHappens: "out", understood: "a ball tries to escape rings", waitingFor: "the last ring", clearBySec: 1.5, distractions: ["text"], watchToEnd: "yes" }, { whatHappens: "out", understood: "", waitingFor: "", clearBySec: 1, distractions: ["music"], watchToEnd: "yes" }],
  [
    "reviewer",
    REVIEW_FINAL,
    { verdict: "fix", confidence: "medium", answers: [{ objection: "o1", accept: true, reason: null, fix: { action: "retimePayoff", targetPos: 0.85 } }], viewerAnswer: null, fixes: [{ action: "retimePayoff", targetPos: 0.85 }], why: "the payoff lands too late" },
    { verdict: "fix", confidence: "medium", answers: [], viewerAnswer: null, fixes: [{ action: "makeItPop" }], why: "" },
  ],
  ["researcher", researchFinal(["t1", "p1"]), { points: [{ id: "r1", area: "pace", advice: "Put the busiest moment late.", lever: { kind: "setting", name: "recordingDuration" }, basis: "t1", strength: "weak" }], stale: false }, { points: [{ id: "r1", area: "pace", advice: "x", lever: null, basis: "t9", strength: "weak" }], stale: false }],
  ["brainstormer", brainstormFinal(menu, 4, ["r1"]), { ideas: [{ template: "ring-escape", mode: "classic", hook: "a", ending: "resolved", bucket: "standard", angle: "the last ring", basis: "r1" }] }, { ideas: [{ template: "ring-escape", mode: "race", hook: "a", ending: "resolved", bucket: "standard", angle: "", basis: "none" }] }],
  [
    "producer",
    producerFinal(["c1"], ["reels"]),
    { clips: [{ planId: "c1", name: "ring escape 1", title: "Can it get out?", hook: "Can it escape?", caption: "Which ring falls last?", hashtags: ["#physics", "#satisfying", "#asmr"], platform: "reels" }], summary: "one clip" },
    { clips: [{ planId: "c9", name: "x", title: "x", hook: "x", caption: "x", hashtags: ["#a", "#b", "#c"], platform: "reels" }], summary: "" },
  ],
];

describe("the answer schemas", () => {
  it("take a sample answer and refuse a wrong one", () => {
    for (const [role, schema, good, bad] of SCHEMAS) {
      expect([role, validateJson(schema, good)]).toEqual([role, []]);
      expect([role, validateJson(schema, bad).length > 0]).toEqual([role, true]);
    }
  });

  it("hold every field to an enum of runnable choices: objection kinds, dossier keys, fixes, viewer reads", () => {
    const item = (SKEPTIC_FINAL.properties!.objections.items as JsonSchema).properties!;
    expect(item.kind.enum).toEqual(OBJECTION_KINDS);
    expect(item.evidence.items!.enum).toEqual(DOSSIER_KEYS);
    expect(VIEWER_FINAL.properties!.whatHappens.enum).toEqual(VIEWER_READS);
    expect(VIEWER_READS).toEqual([...CLAIMS, "notSure", "nothing"]);
    expect(FIX_ACTION_SCHEMA.oneOf!.map((s) => s.properties!.action.const)).toEqual([...FIX_IDS]);
    // a fix's bounds: a hook of 42 characters, a payoff between 66 % and 90 %
    expect(validateJson(FIX_ACTION_SCHEMA, { action: "rewriteHook", text: "x".repeat(43) }).length).toBeGreaterThan(0);
    expect(validateJson(FIX_ACTION_SCHEMA, { action: "retimePayoff", targetPos: 0.95 }).length).toBeGreaterThan(0);
    expect(validateJson(FIX_ACTION_SCHEMA, { action: "turnOff", key: "gravity" }).length).toBeGreaterThan(0);
    expect(validateJson(FIX_ACTION_SCHEMA, { action: "turnOff", key: "colorTrail" })).toEqual([]);
  });

  it("narrow the reviewer's answer to one clip: its standing objections, its viewer, the clutter it has", () => {
    const schema = reviewFinal({ objections: ["o2"], viewer: "none", clutter: ["colorTrail"] });
    const ok = { verdict: "fix", confidence: "low", answers: [{ objection: "o2", accept: true, reason: null, fix: { action: "turnOff", key: "colorTrail" } }], viewerAnswer: null, fixes: [{ action: "turnOff", key: "colorTrail" }], why: "" };
    expect(validateJson(schema, ok)).toEqual([]);
    expect(validateJson(schema, { ...ok, answers: [{ ...ok.answers[0], objection: "o1" }] }).length).toBeGreaterThan(0);
    expect(validateJson(schema, { ...ok, viewerAnswer: { accept: true, fix: null } }).length).toBeGreaterThan(0);
    expect(validateJson(schema, { ...ok, fixes: [{ action: "turnOff", key: "screenShake" }] }).length).toBeGreaterThan(0);
    // a misread must be answered: the field is required and not null
    const misread = reviewFinal({ objections: [], viewer: "misread" });
    expect(validateJson(misread, { ...ok, answers: [], viewerAnswer: null }).length).toBeGreaterThan(0);
    expect(validateJson(misread, { ...ok, answers: [], viewerAnswer: { accept: true, fix: { action: "rewriteHook", text: "Watch the last ring" } } })).toEqual([]);
  });

  it("turn into a llama.cpp grammar schema, keeping every enum", () => {
    const GRAMMAR_KEYS = new Set(["type", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "enum", "const", "oneOf", "minLength", "maxLength"]);
    for (const [role, schema] of SCHEMAS) {
      const grammar = toGrammarSchema(schema);
      const text = JSON.stringify(grammar);
      const keys = [...text.matchAll(/"([A-Za-z]+)":/g)].map((m) => m[1]);
      const structural = keys.filter((k) => !walk(schema).some((s) => Object.keys(s.properties ?? {}).includes(k)));
      expect([role, structural.filter((k) => !GRAMMAR_KEYS.has(k))]).toEqual([role, []]);
      for (const s of walk(schema)) for (const e of s.enum ?? []) if (typeof e === "string") expect([role, text.includes(JSON.stringify(e))]).toEqual([role, true]);
    }
  });

  it("are ready for structured outputs: closed objects, every field required, the JsonSchema subset only", () => {
    const KEYS = new Set(["type", "description", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "enum", "const", "minimum", "maximum", "minLength", "maxLength", "pattern", "oneOf"]);
    for (const [role, schema] of SCHEMAS) {
      for (const s of walk(schema)) {
        expect([role, Object.keys(s).filter((k) => !KEYS.has(k))]).toEqual([role, []]);
        if (s.type === "object") {
          expect([role, s.additionalProperties]).toEqual([role, false]);
          expect([role, [...(s.required ?? [])].sort()]).toEqual([role, Object.keys(s.properties ?? {}).sort()]);
        }
      }
    }
  });

  it("the producer answers in Make videos' own schema", () => {
    expect(producerFinal(["a", "b"], ["reels", "tiktok"])).toEqual(makeVideosFinal(["a", "b"], ["reels", "tiktok"]));
    expect(producerFinal(["a"], ["shorts", "shorts"])).toEqual(makeVideosFinal(["a"], ["shorts", "shorts"]));
  });
});

describe("the prompts", () => {
  it("pin the shared rubric (a changed rubric is a deliberate edit of every role's prompt)", () => {
    expect(SHARED_RUBRIC.length).toBeLessThanOrEqual(3000);
    expect(promptHash(SHARED_RUBRIC)).toBe("1cc8e94aa766fccf");
  });

  it("keep each card within 800 characters and every role to its limits", () => {
    expect(Object.keys(ROLE_SPECS)).toEqual([...CREW_ROLES]);
    for (const role of CREW_ROLES) {
      const spec = ROLE_SPECS[role];
      expect([role, spec.card.length <= 800, spec.role]).toEqual([role, true, role]);
      expect([role, taskOf(role, "quick").startsWith("crew."), taskOf(role, "thorough").length <= 40]).toEqual([role, true, true]);
      expect([role, protocolOf(role).includes(spec.finalHint)]).toEqual([role, true]);
    }
    expect(Object.fromEntries(CREW_ROLES.map((r) => [r, ROLE_SPECS[r].maxTokens]))).toEqual({ researcher: 400, brainstormer: 500, skeptic: 260, viewer: 200, reviewer: 320, producer: 1800 });
    expect([ROLE_SPECS.skeptic.temperature, ROLE_SPECS.reviewer.temperature, ROLE_SPECS.brainstormer.temperature]).toEqual([0.3, 0.2, 0.9]);
    expect([effortOf("skeptic", "quick"), effortOf("viewer", "quick"), effortOf("reviewer", "quick"), effortOf("reviewer", "thorough"), effortOf("brainstormer", "quick")]).toEqual(["low", "low", "low", "medium", "medium"]);
    expect([taskOf("reviewer", "quick"), taskOf("reviewer", "thorough")]).toEqual(["crew.reviewer", "crew.reviewer.thorough"]);
  });

  it("keep rubric, dossier, card and protocol to about 1,600 tokens, and the cached prefix to 512 tokens or more", () => {
    const worst = "x".repeat(INTENT_MAX);
    for (const role of ["skeptic", "reviewer"] as const) {
      const prompt = `${SHARED_RUBRIC}\n\nThe clip's dossier:\n${worst}\n\n${ROLE_SPECS[role].card}\n\n${protocolOf(role)}`;
      expect([role, tokensUpper(prompt) <= 1600]).toEqual([role, true]);
    }
    for (const recipe of RECIPES) {
      const plan = planClip(recipe, 1, "reels", { copy, ending: "resolved", episode: 3, search: false });
      const dossier = intentView(crewClipOfPlan(plan)).text;
      expect([recipe.id, tokensLower(`${SHARED_RUBRIC}\n\nThe clip's dossier:\n${dossier}`) >= 512]).toEqual([recipe.id, true]);
    }
  });

  it("give the viewer no intent: its preamble, card and answer shape never say template, idea, intent, payoff or recipe", () => {
    const text = `${VIEWER_PREAMBLE}\n${ROLE_SPECS.viewer.card}\n${ROLE_SPECS.viewer.finalHint}`;
    expect(text).not.toMatch(/template|idea|intent|payoff|recipe|dossier/i);
  });

  it("fingerprint a prompt in 16 hex characters, the same for the same text", () => {
    expect(promptHash("abc")).toMatch(/^[0-9a-f]{16}$/);
    expect(promptHash("abc")).toBe(promptHash("abc"));
    expect(promptHash("abc")).not.toBe(promptHash("abd"));
  });
});

describe("the fixes as data", () => {
  it("turnOff reaches every effect, HUD and label the Simple score charges for, and nothing else", () => {
    const keys = new Set(Object.keys(defaultSettings("classic")));
    for (const k of CLUTTER_KEYS) expect([k, keys.has(k)]).toEqual([k, true]);
    for (const h of HUD_FLAGS) expect(CLUTTER_KEYS).toContain(h.key);
    for (const k of EFFECT_KEYS) expect(CLUTTER_KEYS).toContain(k);
    for (const k of ["gravity", "ballSpeed", "captions", "mode", "recordingDuration", "seed"]) expect(CLUTTER_KEYS).not.toContain(k);
    // every effect the Simple score names a setting for is one turnOff may switch off
    const busy = { ...defaultSettings("classic"), showWallGlow: true, trailThickness: 2, showTrails: true, colorTrail: true, rainbowWalls: true, rainbowBall: true, reactiveBackground: true, screenShake: 0.3, cinematicEnabled: true, particleStyle: "confetti" as const, wallBreakStyle: "all" as const, loopHud: true };
    const plan = planClip(RECIPES[0], 1, "reels", { copy, ending: "resolved", search: false });
    const named = simpleScore({ ...crewClipOfPlan(plan), settings: busy })
      .deductions.map((d) => d.key)
      .filter((k): k is NonNullable<typeof k> => !!k);
    expect(named.length).toBeGreaterThan(8);
    for (const k of named) expect(CLUTTER_KEYS).toContain(k);
    expect(SIMPLE_DEDUCTIONS).toContain("cinematic");
    expect(RUN_MOVING_KEYS).toEqual(["cinematicEnabled"]);
  });

  it("every objection kind has fixes that answer it, from the fixed list", () => {
    expect(Object.keys(FIXES_FOR_KIND).sort()).toEqual([...OBJECTION_KINDS].sort());
    for (const kind of OBJECTION_KINDS) {
      expect([kind, FIXES_FOR_KIND[kind].length > 0]).toEqual([kind, true]);
      for (const f of FIXES_FOR_KIND[kind]) expect(FIX_IDS).toContain(f);
    }
    for (const k of MEASURABLE_KINDS) expect(OBJECTION_KINDS).toContain(k);
    expect(Object.keys(FIX_ACTIONS)).toEqual([...FIX_IDS]);
    expect(FIX_IDS.filter((id) => FIX_ACTIONS[id].finder)).toEqual(["retimePayoff", "reseedEarlyMotion", "switchEnding", "changeLength"]);
  });
});

describe("the checks beyond the schemas", () => {
  it("the skeptic numbers its objections in order and cites each key once", () => {
    const ok: SkepticResult = { oneIdea: "x", objections: [{ id: "o1", kind: "tooBusy", evidence: ["score.simple"], severity: "minor", note: "" }] };
    expect(checkSkeptic(ok)).toEqual([]);
    expect(checkSkeptic({ ...ok, objections: [{ ...ok.objections[0], id: "o2" }] }).length).toBe(1);
    expect(checkSkeptic({ ...ok, objections: [{ ...ok.objections[0], evidence: ["score.simple", "score.simple"] }] }).length).toBe(1);
  });

  it("the reviewer answers every confirmed objection, never rejects one, and fixes an accepted major one with a fix that answers it", () => {
    const late = objection("o1", "payoffLate", "major", "confirmed");
    const c = ctx({ objections: [late] });
    expect(checkReview(review(), c).some((e) => e.includes("answer o1"))).toBe(true);
    expect(checkReview(review({ answers: [{ objection: "o1", accept: false, reason: "rulePasses", fix: null }] }), c).some((e) => e.includes("cannot be rejected"))).toBe(true);
    expect(checkReview(review({ verdict: "keep", answers: [{ objection: "o1", accept: true, reason: null, fix: null }] }), c).some((e) => e.includes("give it a fix"))).toBe(true);
    const wrong = fix("rewriteHook", { text: "Watch the last ring" });
    expect(checkReview(review({ verdict: "fix", answers: [{ objection: "o1", accept: true, reason: null, fix: wrong }], fixes: [wrong] }), c).some((e) => e.includes("does not answer payoffLate"))).toBe(true);
    const retime = fix("retimePayoff", { targetPos: 0.85 });
    expect(checkReview(review({ verdict: "fix", answers: [{ objection: "o1", accept: true, reason: null, fix: retime }], fixes: [retime] }), c)).toEqual([]);
    // a drop needs no fix
    expect(checkReview(review({ verdict: "drop", answers: [{ objection: "o1", accept: true, reason: null, fix: null }] }), c)).toEqual([]);
    // an accepted reply has no reason, a rejected one has one
    expect(checkReview(review({ verdict: "drop", answers: [{ objection: "o1", accept: true, reason: "rulePasses", fix: null }] }), c).some((e) => e.includes("reason must be null"))).toBe(true);
  });

  it("an opinion may be rejected with a reason, and a minor one accepted without a fix", () => {
    const c = ctx({ objections: [objection("o1", "notShareable", "major", "opinion"), objection("o2", "tooBusy", "minor", "confirmed")] });
    expect(checkReview(review({ answers: [{ objection: "o1", accept: false, reason: "templateIntends", fix: null }, { objection: "o2", accept: true, reason: null, fix: null }] }), c)).toEqual([]);
    expect(checkReview(review({ answers: [{ objection: "o1", accept: false, reason: null, fix: null }, { objection: "o2", accept: true, reason: null, fix: null }] }), c).some((e) => e.includes("give a reason"))).toBe(true);
    expect(checkReview(review({ answers: [{ objection: "o3", accept: false, reason: "notSupported", fix: null }, { objection: "o2", accept: true, reason: null, fix: null }] }), c).some((e) => e.includes("o3 is not an objection"))).toBe(true);
  });

  it("no keep while a gate fails or a confirmed fatal objection stands; the verdict matches its fixes", () => {
    expect(checkReview(review(), ctx({ gateFails: true })).some((e) => e.includes("a gate fails"))).toBe(true);
    const fatal = ctx({ objections: [objection("o1", "slowStart", "fatal", "confirmed")] });
    expect(checkReview(review({ answers: [{ objection: "o1", accept: true, reason: null, fix: null }] }), fatal).some((e) => e.includes("confirmed fatal"))).toBe(true);
    expect(checkReview(review({ verdict: "fix" }), ctx()).some((e) => e.includes("at least one fix"))).toBe(true);
    expect(checkReview(review({ verdict: "keep", fixes: [fix("simplifyLook")] }), ctx()).some((e) => e.includes("no fixes"))).toBe(true);
    const twice = [fix("simplifyLook"), fix("simplifyLook")];
    expect(checkReview(review({ verdict: "fix", fixes: twice }), ctx()).some((e) => e.includes("twice"))).toBe(true);
  });

  it("a viewer's misread is answered: a new hook or ending before a render, never a keep after one", () => {
    const pre = ctx({ viewer: { makesSense: "no" } });
    expect(checkReview(review(), pre).some((e) => e.includes("answer it"))).toBe(true);
    const look = fix("simplifyLook");
    expect(checkReview(review({ verdict: "fix", viewerAnswer: { accept: true, fix: look }, fixes: [look] }), pre).some((e) => e.includes("rewriteHook or switchEnding"))).toBe(true);
    const hook = fix("rewriteHook", { text: "Will the ball get out?" });
    expect(checkReview(review({ verdict: "fix", viewerAnswer: { accept: true, fix: hook }, fixes: [hook] }), pre)).toEqual([]);
    const post = ctx({ stage: "post", viewer: { makesSense: "no" } });
    expect(checkReview(review({ viewerAnswer: { accept: true, fix: null } }), post).some((e) => e.includes("did not get the clip"))).toBe(true);
    expect(checkReview(review({ verdict: "fix", viewerAnswer: { accept: true, fix: look }, fixes: [look] }), post)).toEqual([]);
    // no viewer ran: nothing to answer
    expect(checkReview(review({ viewerAnswer: { accept: true, fix: null } }), ctx()).some((e) => e.includes("no viewer"))).toBe(true);
  });

  it("the reviewer's card offers on a misread only what the schema and the rules take: accept it, never reject it, then fix or drop", () => {
    const card = ROLE_SPECS.reviewer.card;
    const line = card.split("\n").find((l) => l.startsWith("viewerAnswer:"))!;
    expect(line).toMatch(/makesSense is no or partly; then accept, never reject/);
    for (const v of MAKES_SENSE) if (v !== "yes") expect(line).toContain(v); // (the values the reviewer's data shows, not the viewer's own words)
    for (const f of FIXES_FOR_MISREAD) expect(line).toContain(f);
    // the reject reasons are the objections' alone: no line offers them for the viewer's read
    expect(card).not.toMatch(/viewer's read[^\n]*reject with a reason/);
    const schema = reviewFinal({ objections: [], viewer: "misread" });
    const hook = fix("rewriteHook", { text: "Will the ball get out?" });
    for (const stage of ["pre", "post"] as const) {
      const c = ctx({ stage, viewer: { makesSense: "partly" } });
      // what the card offers goes through, before and after the render
      for (const r of [review({ verdict: "fix", viewerAnswer: { accept: true, fix: hook }, fixes: [hook] }), review({ verdict: "drop", viewerAnswer: { accept: true, fix: null } })]) {
        expect(validateJson(schema, r), stage).toEqual([]);
        expect(checkReview(r, c), stage).toEqual([]);
      }
      // what the card once offered is refused: a reason by the schema, a rejection by the rules
      expect(validateJson(schema, { ...review({ verdict: "drop" }), viewerAnswer: { accept: false, reason: "templateIntends", fix: null } }).join(" "), stage).toMatch(/reason/);
      expect(checkReview(review({ verdict: "drop", viewerAnswer: { accept: false, fix: null } }), c).some((e) => e.includes("cannot be rejected")), stage).toBe(true);
    }
  });

  it("a rewritten hook of more than 7 words is refused, and the fix compiler's refusals come back", () => {
    const long = fix("rewriteHook", { text: "one two three four five six seven eight" });
    expect(checkReview(review({ verdict: "fix", fixes: [long] }), ctx()).some((e) => e.includes("at most 7 words"))).toBe(true);
    const ok = fix("simplifyLook");
    expect(checkReview(review({ verdict: "fix", fixes: [ok] }), ctx({ compile: () => ["simplifyLook: the look is calm already"] }))).toEqual(["simplifyLook: the look is calm already"]);
  });

  it("normaliseReview lists every answer's fix among the fixes, once", () => {
    const retime = { action: "retimePayoff", targetPos: 0.8 };
    const out = normaliseReview({ verdict: "fix", answers: [{ objection: "o1", accept: true, reason: null, fix: retime }], viewerAnswer: { accept: true, fix: retime }, fixes: [] }) as ReviewResult;
    expect(out.fixes).toEqual([retime]);
  });

  it("the brainstormer's ideas differ: at most 2 on a template, distinct hooks, two formats from four ideas, the menu's variants", () => {
    const m: MenuItem[] = menu;
    const idea = (template: string, hook: string) => ({ template, mode: m.find((x) => x.template === template)!.modes[0], hook, ending: "resolved" as const, bucket: "standard" as const, angle: "", basis: "none" });
    const ok: BrainstormResult = { ideas: [idea("ring-escape", "a"), idea("pendulum-wave", "a"), idea("grow-fill", "a"), idea("drop-symphony", "a")] };
    expect(checkBrainstorm(ok, { menu: m, named: false })).toEqual([]);
    expect(checkBrainstorm({ ideas: [idea("ring-escape", "a"), idea("ring-escape", "Will it get out?"), idea("ring-escape", "Last ring standing")] }, { menu: m, named: false }).some((e) => e.includes("at most 2"))).toBe(true);
    expect(checkBrainstorm({ ideas: [idea("ring-escape", "Will it get out fast?"), idea("pendulum-wave", "Will it get there?")] }, { menu: m, named: false }).some((e) => e.includes("starts like"))).toBe(true);
    const oneFormat: BrainstormResult = { ideas: [idea("ring-escape", "a"), idea("pip-escape", "a"), idea("ring-escape", "Out in time?"), idea("pip-escape", "Can Gerald escape?")] };
    expect(checkBrainstorm(oneFormat, { menu: m, named: false }).some((e) => e.includes("2 formats"))).toBe(true);
    expect(checkBrainstorm(oneFormat, { menu: m, named: true })).toEqual([]);
    expect(checkBrainstorm({ ideas: [idea("ring-escape", "b")] }, { menu: m, named: false }).some((e) => e.includes("variants"))).toBe(true);
    expect(checkBrainstorm({ ideas: [idea("ring-escape", "one two three four five six seven eight")] }, { menu: m, named: false }).some((e) => e.includes("at most 7 words"))).toBe(true);
  });

  it("a brainstormed hook is a variant in either case or with spaces around it, else the brainstormer's own words – two of them at least (--- crew ---, review round 2)", () => {
    const m: MenuItem[] = menu;
    const idea = (hook: string) => ({ template: "ring-escape", mode: m.find((x) => x.template === "ring-escape")!.modes[0], hook, ending: "resolved" as const, bucket: "standard" as const, angle: "", basis: "none" });
    expect(["a", "A", "a ", " A\t", "Escape!", "Will it get out?"].map(hookVariantOf)).toEqual(["a", "a", "a", "a", null, null]);
    // one form for the check and the planner: "A" and "a " are the variant a
    expect(normaliseBrainstorm({ ideas: [idea("A"), idea("a "), idea("  Will it\nget out?  ")] })).toEqual({ ideas: [idea("a"), idea("a"), idea("Will it get out?")] });
    for (const hook of ["A", "a "]) expect([hook, checkBrainstorm({ ideas: [idea(hook)] }, { menu: m, named: false })]).toEqual([hook, []]);
    expect(checkBrainstorm({ ideas: [idea("B")] }, { menu: m, named: false }).some((e) => e.includes("variants"))).toBe(true);
    // a one-word hook of its own is no hook
    for (const hook of ["Escape!", "🔥 Out"]) expect([hook, checkBrainstorm({ ideas: [idea(hook)] }, { menu: m, named: false })]).toEqual([hook, [`ideas[0].hook: a hook of your own has ${OWN_HOOK_MIN_WORDS} words or more; or name a variant (a)`]]);
    expect(checkBrainstorm({ ideas: [idea("Last ring standing")] }, { menu: m, named: false })).toEqual([]);
  });

  it("the researcher's points keep only a basis the digest has; the producer's hooks are the drawn ones, each clip worded once", () => {
    const value = normaliseResearch({ points: [{ id: "r1", basis: "t9" }, { id: "r2", basis: "t1" }], stale: false }, ["t1"]) as { points: { id: string; basis: string }[] };
    expect(value.points).toEqual([{ id: "r1", basis: "t1" }]);
    expect(BRIEF_POINT_IDS.length).toBe(5);
    const locked = normaliseProducer({ clips: [{ planId: "c1", hook: "Something else" }], summary: "" }, { c1: "Will it escape?" }) as { clips: { hook: string }[] };
    expect(locked.clips[0].hook).toBe("Will it escape?");
    const clip = { planId: "c1", name: "a", title: "a", hook: "a", caption: "a", hashtags: [], platform: BOT_PLATFORMS[0] };
    expect(checkProducer({ clips: [clip], summary: "" }, ["c1"])).toEqual([]);
    expect(checkProducer({ clips: [clip, clip], summary: "" }, ["c1", "c2"])).toEqual(["clips: c1 2 times", "clips: write c2"]);
  });

  // --- crew --- (the studio's second review round, finding 18) "Four spinning rings, one gap each" on a clip of five rings was posted
  it("the producer's title and caption state only numbers the clip has, in digits or in words; a clip with no list is not checked", () => {
    const clip = { planId: "c1", name: "rings", title: "5 rings, 16 seconds", hook: "a", caption: "Five spinning rings, one gap each. Day 3: which ring falls last?", hashtags: ["#a", "#b", "#c"], platform: BOT_PLATFORMS[0] };
    const numbers = { c1: [1, 3, 5, 16, 17] };
    expect(checkProducer({ clips: [clip], summary: "" }, ["c1"], numbers)).toEqual([]);
    expect(checkProducer({ clips: [{ ...clip, title: "7 rings, 16 seconds", caption: "Four spinning rings, one gap each." }], summary: "" }, ["c1"], numbers)).toEqual([
      "clips: c1 title: 7 is not a number this clip has (1, 3, 5, 16, 17)",
      "clips: c1 caption: 4 is not a number this clip has (1, 3, 5, 16, 17)",
    ]);
    expect(checkProducer({ clips: [{ ...clip, caption: "Pięć pierścieni, 1,000 odbić" }], summary: "" }, ["c1"], numbers)).toEqual(["clips: c1 caption: 1000 is not a number this clip has (1, 3, 5, 16, 17)"]);
    // hashtags and the file name are not posted words, and a clip the panel gave no list is not checked
    expect(checkProducer({ clips: [{ ...clip, name: "rings 7", hashtags: ["#top10", "#b", "#c"] }], summary: "" }, ["c1"], numbers)).toEqual([]);
    expect(checkProducer({ clips: [{ ...clip, title: "7 rings" }], summary: "" }, ["c1"])).toEqual([]);
    // the card says so
    expect(ROLE_SPECS.producer.card).toMatch(/Every number in a title or caption is one the clip has/);
  });
});
