import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { FL_DIVISIONS, FL_ROSTER } from "@/lib/physics/modes/fightLeagueRoster";
import { EV_HEAVY, FB_CLASH, FB_VS, FL_EVENT_CAP, fighterPitch, fightLeagueSettingsOf, resolveFightLeagueSettings, telegraphMs, type FightLeagueSettings } from "@/lib/physics/modes/fightLeague";
import { flBannerName } from "@/lib/physics/modes/fightLeagueFx";
import { FL_CAT_BLOCK, FL_CAT_HIT, FL_CAT_NOTE, FL_CAT_SHOOT, FL_CAT_SWING, FL_TICK_CUES, FL_TICK_SLOTS, FL_TICK_URGENT, FlTickBudget } from "@/lib/physics/modes/fightLeagueSound";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { flRecipeProblems, parseFlRecipe, recipeDurationMs, scheduleFlRecipe } from "@/lib/audio/flSynth";
import { flAvoidListProblems } from "@/lib/audio/flAvoidList"; // --- low-findings-2 ---
import { FL_ANNOUNCER, FL_BANNER_SOUNDS, FL_DIVISION_TINTS, FL_FAMILIES, FL_FAMILY_SETS, FL_MATCH_SOUNDS, FL_PRIMITIVE_SOUNDS, FL_SIGNATURES, FL_TIER_PEAK, FL_TRIM_F, FL_TRIM_HOLD_SEC, FL_TRIM_R, flAllRecipes, flSaberHz, flTierOf, flTrimKey } from "@/lib/audio/flRecipes";
import { FL_RECIPE_TRIMS } from "@/lib/audio/flRecipeTrims";
import { NO_FL_CLIPS, flResolved, resolveFlSound, type FlClipLookup, type FlSoundSettings } from "@/lib/audio/flSoundResolve";
import { FL_BUS_RATE, FL_BUS_VOICES, FL_MAX_LOOPS, FlMixer } from "@/lib/audio/flMixer";
import { FL_CLIP_MAX_BYTES, FL_CLIP_MAX_SEC, FlClipStore, encodeWav16, exportFlClipSet, flClipLookup, importFlClipSet, indexedDbClipBackend, memoryClipBackend, parseWav16, prepareFlClip, sniffAudioFormat, type DecodedAudio, type FlClipRecord } from "@/lib/audio/flClips";
import { playFightEvent } from "@/lib/audio/flDispatch";
import { unzip } from "@/lib/recording/unzip";
import { zipStore } from "@/lib/recording/zip";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { playArenaSound, type ArenaSoundSink } from "@/lib/simulation/multi";
import { EXTRA_ARENA_LEVEL } from "@/lib/splitScreen";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { FIGHT_LEAGUE_KEYS } from "@/components/simulator/sections/FightLeagueSection";
import { fakeGraph } from "./fakeAudio";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- fl-overhaul --- (Stage 4) Fight League's sound: the recipe tables (flRecipes.ts) through the synthesiser (flSynth.ts),
 * the trims, the 147 fighters' signature sets, the match's stings and the announcer; the cues the mode writes (fightLeague.ts)
 * – resolved without the legacy fallback for every match type, in the tick of their banners, within the per-tick budget and the
 * same at any frame rate; the resolver's order (flSoundResolve.ts), the mixer (flMixer.ts), the ToneGenerator's cue path and
 * its offline twin, the one dispatch (flDispatch.ts) on the page, in the fast export and in the other arenas; the custom clips
 * (flClips.ts: refusals, a fake IndexedDB, the set's ZIP round trip); the settings, the messages and the repository's audio.
 * Rendered peaks are checked in Chromium when it can start (skipped otherwise; a failure with JBL_REQUIRE_BROWSER=1). No dependency beyond the repo's (fakeAudio.ts).
 */

const ROOT = path.resolve(__dirname, "..");
const WORLD = { width: 800, height: 450 };
const STEP = 1000 / 60;
const SETS: FlSoundSettings[] = [
  { set: "signature", announcer: true, custom: true },
  { set: "kinds", announcer: true, custom: true },
];

function fightEngine(fl: Partial<FightLeagueSettings> = {}, seed = 1): PhysicsEngine {
  const s = defaultSettings("fightLeague");
  const config: PhysicsConfig = physicsConfigOfSettings(s, WORLD);
  const modeSettings: ModeSettings = { ...modeSettingsOfSettings(s), fightLeague: resolveFightLeagueSettings({ ...fightLeagueSettingsOf(s), ...fl }) };
  return createEngineForSettings(config, "fightLeague", modeSettings, seed);
}

/** A cue with the simulation time of the frame that flushed it. */
interface Timed {
  ms: number;
  ev: SoundEvent;
}

/** Plays `engine` at `frameMs` frames until `untilMs`, or its end and `afterMs` past it: every sound event and the frame's time. */
function play(engine: PhysicsEngine, untilMs = 60_000, frameMs = STEP, afterMs = 3500): Timed[] {
  const out: Timed[] = [];
  let end = -1;
  for (const ev of engine.consumeSoundEvents()) out.push({ ms: engine.getElapsedMs(), ev });
  while (engine.getElapsedMs() < untilMs - 1e-6) {
    engine.update(frameMs, 0);
    for (const ev of engine.consumeSoundEvents()) out.push({ ms: engine.getElapsedMs(), ev });
    if (end < 0 && engine.isSimulationFinished()) end = engine.getElapsedMs();
    if (end >= 0 && engine.getElapsedMs() >= end + afterMs) break;
  }
  return out;
}
const cues = (events: Timed[]) => events.filter((t) => t.ev.flCue).map((t) => t.ev);
const r4 = (n: number | undefined) => (n === undefined ? "" : Math.round(n * 1e4) / 1e4);
const cueKey = (ev: SoundEvent) => [ev.flCue, ev.flRow, ev.flFighter, ev.flId, ev.flWeapon, ev.flStyle, ev.flShape, ev.flPrim, ev.flVariant, ev.flLoop, r4(ev.flSec), r4(ev.flDelay), r4(ev.flLevel), r4(ev.flVar), r4(ev.flSlow), r4(ev.flPan), ev.fight, r4(ev.frequency)].join("|");
const what = (ev: SoundEvent) => `${ev.flCue}${ev.flRow ? `:${ev.flRow}` : ""}${ev.flPrim ? `@${ev.flPrim}` : ""}${ev.flWeapon ? `/${ev.flWeapon}` : ""}${ev.flShape ? `~${ev.flShape}` : ""} (${ev.flId ?? "match"})`;

/* ------------------------------------------------------------------ the tables */

describe("fight league sound recipes (flRecipes.ts, flSynth.ts)", () => {
  it("parses every row of every table, schedules nodes for it without throwing, and keeps a one-shot within 1.4 s – its declared length", () => {
    const graph = fakeGraph({ extended: true });
    const ctx = graph.ctx as unknown as BaseAudioContext;
    const bad: string[] = [];
    const all = flAllRecipes();
    expect(all.length).toBeGreaterThan(600);
    for (const e of all) {
      const where = `${e.table} ${e.key} ${e.role}`;
      try {
        const r = parseFlRecipe(e.text);
        const problems = flRecipeProblems(r, { F: 330, R: 523.25, H: e.h });
        if (problems.length) bad.push(`${where}: ${problems.join("; ")}`);
        if (!r.held) {
          const ms = recipeDurationMs(r);
          if (ms > 1400) bad.push(`${where}: ${ms.toFixed(0)} ms > 1400`);
          if (Math.abs(ms - r.ms) > Math.max(25, 0.08 * r.ms)) bad.push(`${where}: lasts ${ms.toFixed(0)} ms, declares ${r.ms}`);
        }
        const before = graph.oscillators.length + graph.sources.length;
        const out = scheduleFlRecipe(ctx, ctx.destination as AudioNode, r, 1, { F: 329.63, R: 523.25, H: e.h, sustainSec: r.held ? 0.5 : undefined });
        if (!(out.nodes >= 1) || graph.oscillators.length + graph.sources.length <= before) bad.push(`${where}: no node`);
        if (!(out.end > 1)) bad.push(`${where}: ends at ${out.end}`);
      } catch (err) {
        bad.push(`${where}: ${(err as Error).message}`);
      }
    }
    expect(bad).toEqual([]);
  });

  // --- low-findings-2 --- the avoid-list's source gestures a row could reproduce by its shape: none in any table
  it("passes the avoid-list: no row of any table sweeps a chip tone up like the plumber's jump, revs like the spin-dash or rings the coin's fourth", () => {
    const bad: string[] = [];
    for (const e of flAllRecipes()) {
      const problems = flAvoidListProblems(e.text, { F: 330, R: 523.25, H: e.h });
      if (problems.length) bad.push(`${e.table} ${e.key} ${e.role}: ${problems.join("; ")}`);
    }
    expect(bad).toEqual([]);
    // the gestures it finds: the two signature rows it replaced, and a coin-like fourth
    expect(flAvoidListProblems("intro(120) p25 330>990/110 d120 p.46")[0]).toMatch(/^jump/);
    expect(flAvoidListProblems("telegraph(400) saw 200>500/120 a28/.6 lp2500 e5/120 p.3 x3/130^1.25 + pn bp800>2000/400 e300/100 p.68")[0]).toMatch(/^rev/);
    expect(flAvoidListProblems("coin(300) sqr 987.77 d80 p.3 + sqr 1318.5 d200 p.3 @80")[0]).toMatch(/^coin/);
    // and not a quicker zip, a smaller chirp, a slow riser or a fifth
    for (const ok of ["ricochet(60) p25 400>1000/50 d60 p.4", "chipChirp(101) p25 F*2>F*4/80 d100 p.42", "fire(490) sqr H>H*4/400 lp1500>4000/400 e10/480 p.1", "two(300) sqr 880 d80 p.3 + sqr 1320 d200 p.3 @80"]) expect([ok, flAvoidListProblems(ok)]).toEqual([ok, []]);
    // the replacements keep their characters: a chip boing for the plumber, a spool-up under rushing air for the hedgehog
    expect(FL_SIGNATURES.mario.roles?.intro).toMatch(/^intro\(120\) p25 /);
    expect(FL_SIGNATURES.sonic.roles?.telegraph).toMatch(/^telegraph\(400\) tri F>F\*3/);
  });

  it("has a fresh trim for every row at its pitch (re-run scripts/fl-sound-trims.mjs after changing a recipe)", () => {
    const missing = flAllRecipes().filter((e) => !(flTrimKey(e.text, e.h) in FL_RECIPE_TRIMS));
    expect(missing.map((e) => `${e.table} ${e.key} ${e.role}`)).toEqual([]);
    for (const v of Object.values(FL_RECIPE_TRIMS)) expect(v >= 0.05 && v <= 20).toBe(true);
    expect([FL_TIER_PEAK.oneShot, FL_TIER_PEAK.charge, FL_TIER_PEAK.sustain]).toEqual([0.4, 0.3, 0.25]);
  });

  it("gives every one of the 147 fighters a signature set – roles of its own or a family set at a pitch – and every division its tint", () => {
    expect(FL_ROSTER).toHaveLength(147);
    expect(Object.keys(FL_SIGNATURES).sort()).toEqual(FL_ROSTER.map((r) => r.id).sort());
    for (const r of FL_ROSTER) {
      const sig = FL_SIGNATURES[r.id];
      const own = Object.keys(sig.roles ?? {}).length;
      expect([r.id, !!sig.family || own > 0]).toEqual([r.id, true]);
      if (sig.family) expect([r.id, (FL_FAMILIES as readonly string[]).includes(sig.family)]).toEqual([r.id, true]);
      if (sig.h !== undefined) expect([r.id, sig.h > 20 && sig.h < 5000]).toEqual([r.id, true]);
    }
    expect(Object.keys(FL_DIVISION_TINTS).sort()).toEqual([...FL_DIVISIONS].sort());
    // The energy blades: the family set at the blade colour's hum (red low, green mid, blue higher)
    for (const id of ["luke", "vader", "yoda", "maul", "obiwan", "kyloren"]) expect([id, FL_SIGNATURES[id].family]).toEqual([id, "saber"]);
    expect(flSaberHz("#ef4444")).toBeLessThan(flSaberHz("#4ade80"));
    expect(flSaberHz("#4ade80")).toBeLessThan(flSaberHz("#60a5fa"));
    for (const fam of FL_FAMILIES) expect([fam, Object.keys(FL_FAMILY_SETS[fam]).length > 0]).toEqual([fam, true]);
  });

  it("writes the avoid-list in the recipes' header (a review list), and every name stays plain text", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/lib/audio/flRecipes.ts"), "utf8");
    const header = src.slice(0, src.indexOf("export type FlWeaponRole"));
    for (const phrase of ["AVOID-LIST", "ORIGINAL SYNTHESIS ONLY", "No sample, rip, re-recording or re-synthesis", "No voice line", "three notes or more", "two-note figure", "custom clip slots"]) expect([phrase, header.includes(phrase)]).toEqual([phrase, true]);
    const account = ["ball", "thing", "sim"].join("");
    const game = ["ball", "fight", "league"].join(" ");
    expect(src.toLowerCase()).not.toContain(account);
    expect(src.toLowerCase()).not.toContain(game);
  });

  it("has an announcer row for every banner kind (Stage 3's and Stage 5's) and the match's stings", () => {
    for (let kind = FB_VS; kind <= FB_CLASH; kind++) {
      const name = flBannerName(kind)!;
      const row = FL_BANNER_SOUNDS[name];
      expect([name, !!row && typeof FL_ANNOUNCER[row.announcer]]).toEqual([name, "string"]);
      if (row.match) expect([name, row.match in FL_MATCH_SOUNDS]).toEqual([name, true]);
    }
    for (const name of ["upset", "comeback", "game", "seriesPoint", "seriesWin", "rematch", "matchPoint", "roundOf16", "quarterFinal", "semiFinal", "final", "champion", "bossDefeated", "bossSurvives", "phase2", "wave", "challenger", "finish"]) {
      const row = FL_BANNER_SOUNDS[name];
      expect([name, !!row && typeof FL_ANNOUNCER[row.announcer]]).toEqual([name, "string"]);
    }
    for (const row of ["fight", "firstBlood", "ko", "finalKo", "doubleKo", "time", "draw", "wins", "perfect", "clutch", "upset", "comeback", "game", "seriesPoint", "roundOf16", "quarterFinal", "semiFinal", "final", "champion", "bossDefeated", "bossSurvives", "suddenDeath", "rematch", "matchPoint"]) expect([row, typeof FL_ANNOUNCER[row]]).toEqual([row, "string"]);
    for (const row of ["vs", "tick", "clock", "ko", "finalKo", "win", "doubleKo", "time", "draw", "lowHp", "suddenDeath", "rematch", "matchPoint", "round", "champion", "bossDefeated", "upset", "comeback", "game", "seriesPoint", "advance", "timeWarp"]) expect([row, typeof FL_MATCH_SOUNDS[row]]).toEqual([row, "string"]);
    // the countdown's ticks climb R, R·1.122, R·1.26 (flVariant 0–2)
    const tick = (v: number) => resolveFlSound({ type: "hit", wallIndex: 0, flCue: "match", flRow: "tick", flVariant: v })!.voices[0].rMul;
    expect([tick(0), tick(1), tick(2)]).toEqual([1, 1.122, 1.26]);
  });

  // --- fl-heavy --- (Stop The World) the CRITICAL sting: the one new row of the heavy-hit spec, on the match bus
  it("has the 'critical' sting: a one-shot of at most 700 ms on the match bus (a driven sub drop, a crack, a thwack, a body thud, three taps), legal, trimmed and resolved under both sets", () => {
    const text = FL_MATCH_SOUNDS.critical;
    expect(typeof text).toBe("string");
    const r = parseFlRecipe(text!);
    expect([r.role, r.held, flTierOf("critical", text!)]).toEqual(["critical", false, "oneShot"]);
    expect(r.ms).toBeLessThanOrEqual(700);
    const ms = recipeDurationMs(r);
    expect(ms).toBeLessThanOrEqual(700);
    expect(Math.abs(ms - r.ms)).toBeLessThanOrEqual(Math.max(25, 0.08 * r.ms));
    expect(flRecipeProblems(r)).toEqual([]);
    expect(flAvoidListProblems(r)).toEqual([]);
    expect(flTrimKey(text!, 440) in FL_RECIPE_TRIMS).toBe(true);
    // its layers: the sub drop 70 → 24 Hz at drive 3, the band-passed white crack, the mid thwack, the brown body, three taps from 120 ms
    expect(r.layers.map((l) => l.src)).toEqual(["sin", "wn", "sin", "bn", "sin"]);
    const [sub, crack, thwack, body, taps] = r.layers;
    expect([sub.glide!.f0.k, sub.glide!.f1!.k, sub.drive]).toEqual([70, 24, 3]);
    expect([crack.filters[0].type, crack.env!.a + crack.env!.d]).toEqual(["bandpass", 35]);
    expect(thwack.glide!.f1!.k).toBeLessThan(thwack.glide!.f0.k);
    expect(body.filters[0].type).toBe("lowpass");
    expect([taps.glide!.f0.k, taps.at, taps.rep!.n, taps.rep!.every]).toEqual([1320, 120, 3, 55]);
    // resolved directly on the match bus under both sets (the attacker's stamp adds no layer), silent under the legacy set
    const ev: SoundEvent = { type: "hit", wallIndex: 0, melody: false, flCue: "match", flRow: "critical", flFighter: 0, flId: "captainfalcon", flPitch: fighterPitch(0), flPan: -0.3, flVar: 0.2 };
    for (const s of SETS) {
      const res = resolveFlSound(ev, NO_FL_CLIPS, s)!;
      expect([s.set, res.source, flResolved(res, s)]).toEqual([s.set, "match", true]);
      expect(res.voices.map((v) => [v.source, v.bus, v.tier, v.held, v.loop, v.delay, v.gain, v.rMul, v.recipe])).toEqual([["match", "match", "oneShot", false, false, 0, 1, 1, text]]);
    }
    expect(resolveFlSound({ type: "hit", wallIndex: 0, flCue: "match", flRow: "critical" })!.voices[0].bus).toBe("match");
    expect(resolveFlSound(ev, NO_FL_CLIPS, { set: "legacy", announcer: true, custom: true })!.source).toBe("silent");
    // the banners' table does not call it: no banner is CRITICAL (the callout is the hit's own)
    expect(Object.values(FL_BANNER_SOUNDS).some((row) => row.match === "critical")).toBe(false);
  });
});

/* ------------------------------------------------------------------ the cues */

const MATCHES: [string, Partial<FightLeagueSettings>, number][] = [
  ["Thor vs Loki", { fighters: ["thor", "loki"] }, 7],
  ["a free-for-all of four", { fighters: ["thor", "loki", "random", "random"], match: "ffa4" }, 11],
  ["a 2v2", { fighters: ["vader", "luke", "goku", "mario"], match: "2v2" }, 3],
  ["four shooters", { fighters: ["ironman", "doomslayer", "legolas", "jinx"], match: "ffa4", hp: 150 }, 1],
];

describe("fight league cues (fightLeague.ts → flSoundResolve.ts)", () => {
  it("resolves every cue of Thor vs Loki, a free-for-all of four, a 2v2 and four shooters with the signature and the kinds sets (no legacy fallback)", { timeout: 60_000 }, () => {
    for (const [name, fl, seed] of MATCHES) {
      const list = cues(play(fightEngine(fl, seed), 60_000));
      const kinds = new Set(list.map((ev) => ev.flCue));
      for (const k of ["hit", "charge", "telegraph", "fire", "match", "announcer"]) expect([name, k, kinds.has(k as SoundEvent["flCue"])]).toEqual([name, k, true]);
      expect([name, kinds.has(name === "four shooters" ? "shoot" : "swing")]).toEqual([name, true]);
      for (const s of SETS) {
        const failed = [...new Set(list.filter((ev) => !flResolved(resolveFlSound(ev, NO_FL_CLIPS, s), s)).map(what))];
        expect([name, s.set, failed]).toEqual([name, s.set, []]);
      }
    }
  });

  it("resolves every cue of every one of the 147 fighters' duels (against Gerald) with both sets", { timeout: 120_000 }, () => {
    const failed = new Set<string>();
    for (const r of FL_ROSTER) {
      const engine = fightEngine({ fighters: [r.id, r.id === "gerald" ? "thor" : "gerald"], hp: 200 }, 3);
      while (engine.getElapsedMs() < 30_000 && !engine.isSimulationFinished()) {
        engine.update(STEP, 0);
        for (const ev of engine.consumeSoundEvents()) {
          if (!ev.flCue) continue;
          for (const s of SETS) if (!flResolved(resolveFlSound(ev, NO_FL_CLIPS, s), s)) failed.add(`${s.set} ${what(ev)}`);
        }
      }
    }
    expect([...failed]).toEqual([]);
  });

  it("writes the stings and calls in the ticks of their banners: VS at 0, the count at 450 / 800 / 1150 ms, FIGHT! at 1.5 s, the winner's fanfare with its call 0.3 s in", () => {
    const events = play(fightEngine({ fighters: ["thor", "loki"] }, 7), 60_000);
    const at = (row: string, cue: "match" | "announcer" = "match") => events.filter((t) => t.ev.flCue === cue && t.ev.flRow === row);
    expect(at("vs").map((t) => t.ms)).toEqual([0]);
    expect(at("tick").map((t) => [Math.round(t.ms / STEP), t.ev.flVariant])).toEqual([
      [Math.ceil(450 / STEP - 1e-6), 0],
      [Math.ceil(800 / STEP - 1e-6), 1],
      [Math.ceil(1150 / STEP - 1e-6), 2],
    ]);
    expect(at("fight", "announcer").map((t) => Math.round(t.ms))).toEqual([1500]);
    const win = at("win");
    const wins = at("wins", "announcer");
    expect(win).toHaveLength(1);
    expect(wins).toHaveLength(1);
    expect(wins[0].ms).toBe(win[0].ms);
    expect((wins[0].ev.flDelay ?? 0) - (win[0].ev.flDelay ?? 0)).toBeCloseTo(0.3, 9);
    expect(win[0].ev.flId).toBeDefined();
    // a KO verdict: the final KO's sting with the legacy KO and win chord, its call, the finale's time warp
    const fin = at("finalKo");
    expect(fin).toHaveLength(1);
    expect([fin[0].ev.fight, fin[0].ev.chord?.length]).toEqual(["ko", 4]);
    expect(at("finalKo", "announcer")).toHaveLength(1);
    expect(at("timeWarp")).toHaveLength(1);
  });

  it("charges as the meter crosses 0.85, telegraphs with its class, fires, holds for the effect's duration and ends a burst", () => {
    const row = FL_ROSTER.find((r) => r.ability.effects.length === 1 && r.ability.effects[0].p === "damageBurst")!;
    expect(row).toBeDefined();
    const effect = row.ability.effects[0] as { p: "damageBurst"; dur: number };
    const events = play(fightEngine({ fighters: [row.id, "thor"], hp: 300 }, 2), 40_000);
    const mine = events.filter((t) => t.ev.flId === row.id && t.ev.flPrim === "damageBurst");
    const first = (cue: string) => mine.find((t) => t.ev.flCue === cue);
    const charge = first("charge");
    const tele = first("telegraph");
    const fire = first("fire");
    const hold = first("sustain");
    const end = first("end");
    expect([!!charge, !!tele, !!fire, !!hold, !!end]).toEqual([true, true, true, true, true]);
    expect(charge!.ms).toBeLessThanOrEqual(tele!.ms);
    expect(tele!.ev.flSec).toBeCloseTo(telegraphMs(row.ability) / 1000, 9);
    expect(fire!.ms - tele!.ms).toBeGreaterThanOrEqual(telegraphMs(row.ability) - STEP);
    expect(hold!.ev.flSec).toBeCloseTo(effect.dur, 9);
    expect(end!.ms - fire!.ms).toBeGreaterThanOrEqual(1000 * effect.dur - STEP);
    expect(end!.ms - fire!.ms).toBeLessThanOrEqual(1000 * effect.dur + 2 * STEP);
    // the legacy kind rides along: the telegraph's swell
    expect([tele!.ev.fight, tele!.ev.level]).toEqual(["ability", 0.8]);
  });

  it("hums the energy blades from FIGHT! (ignited), renews their lease every 30 ticks, and retracts the loser's at its KO", () => {
    const events = play(fightEngine({ fighters: ["vader", "luke"] }, 4), 60_000, STEP, 1000);
    const loops = events.filter((t) => t.ev.flCue === "loopStart");
    const ignite = loops.filter((t) => t.ev.flVariant === 1);
    expect(ignite.map((t) => [Math.round(t.ms), t.ev.flId]).sort()).toEqual([
      [1500, "luke"],
      [1500, "vader"],
    ]);
    const renewals = loops.filter((t) => t.ev.flVariant === 0 && t.ev.flId === "vader").map((t) => t.ms);
    expect(renewals.length).toBeGreaterThan(3);
    for (let i = 1; i < renewals.length; i++) expect(Math.round((renewals[i] - renewals[i - 1]) / STEP)).toBe(30);
    for (const t of loops) expect(resolveFlSound(t.ev)!.voices[0].loop).toBe(true);
    const retract = events.filter((t) => t.ev.flCue === "loopStop" && t.ev.flVariant === 1);
    expect(retract).toHaveLength(1);
    expect(resolveFlSound(retract[0].ev)!.voices.map((v) => v.recipe!.split("(")[0])).toEqual(["retract"]);
  });

  it("sounds a fighter's low HP once (never in the winner's hold), the cap's clock in its last five seconds and sudden death", () => {
    const events = play(fightEngine({ fighters: ["thor", "loki"], hp: 400, timeCap: 8 }, 5), 40_000);
    const clock = events.filter((t) => t.ev.flCue === "match" && t.ev.flRow === "clock");
    expect(clock.map((t) => [Math.round((t.ms - 1500) / 1000), t.ev.flVariant])).toEqual([
      [3, 0],
      [4, 0],
      [5, 0],
      [6, 0],
      [7, 1],
    ]);
    expect(events.filter((t) => t.ev.flCue === "match" && t.ev.flRow === "suddenDeath")).toHaveLength(1);
    expect(events.filter((t) => t.ev.flCue === "announcer" && t.ev.flRow === "suddenDeath")).toHaveLength(1);
    // low HP: at most once a fighter
    const duel = play(fightEngine({ fighters: ["thor", "loki"] }, 7), 60_000);
    const low = duel.filter((t) => t.ev.flCue === "match" && t.ev.flRow === "lowHp").map((t) => t.ev.flId);
    expect(low.length).toBeGreaterThan(0);
    expect(new Set(low).size).toBe(low.length);
  });

  // --- fl-heavy --- (Stop The World) the heavy hits' cues: the giant hit's thump for every heavy blow, the CRITICAL sting for a critical one
  /** `id` against `foe` at the 100 HP setting, `id` casting almost at once (cast speed 40) and the foe never (0.05). */
  const heavyEngine = (id: string, foe: string, seed: number) => fightEngine({ fighters: [id, foe, "random", "random"], cast: [40, 0.05, 1, 1], hp: 100, timeCap: 0 }, seed);
  /** Steps `engine` a 60 Hz tick at a time to `untilMs` (or the fight's end), handing `each` the tick's cues and its new events (kind, slot, aux); `true` stops. */
  function heavyTicks(engine: PhysicsEngine, untilMs: number, each: (cues: SoundEvent[], events: { kind: number; slot: number; aux: number; value: number }[]) => boolean | void) {
    const v = engine.getFightLeagueView();
    let serial = v.eventSerial;
    while (engine.getElapsedMs() < untilMs - 1e-6 && !engine.isSimulationFinished()) {
      engine.update(STEP, 0);
      const events: { kind: number; slot: number; aux: number; value: number }[] = [];
      for (let s = Math.max(serial, v.eventSerial - FL_EVENT_CAP); s < v.eventSerial; s++) {
        const e = v.events[s % FL_EVENT_CAP];
        events.push({ kind: e.kind, slot: e.slot, aux: e.aux, value: e.value });
      }
      serial = v.eventSerial;
      if (each(engine.consumeSoundEvents(), events) === true) break;
    }
  }
  const isThump = (c: SoundEvent) => c.flCue === "impact" && c.flPrim === "giantHit";
  const isCritical = (c: SoundEvent) => c.flCue === "match" && c.flRow === "critical";

  it("thumps a heavy blow in its tick – Hulk Smash at HP 100 (a quarter of the bar): one urgent giant-hit impact at level 1 from a shockwave hit that was silent before, no 'critical' – resolved under both sets", () => {
    const engine = heavyEngine("hulk", "gerald", 1);
    let tick: SoundEvent[] | null = null;
    let heavies: { kind: number; slot: number; aux: number; value: number }[] = [];
    heavyTicks(engine, 30_000, (cues, events) => {
      heavies = events.filter((e) => e.kind === EV_HEAVY && e.slot === 1 && e.aux === 0);
      if (heavies.length === 0) return;
      tick = cues;
      return true;
    });
    expect(tick).not.toBeNull();
    expect(heavies.map((e) => Math.round(e.value * 1e3) / 1e3)).toEqual([25.001]);
    const thumps = tick!.filter(isThump);
    expect(thumps).toHaveLength(1);
    const thump = thumps[0];
    // the attacker's stamp, full level (the hit's own level saturates too: 0.45 + 25 / 20), its pitch, the blunt legacy kind
    expect([thump.flFighter, thump.flId, thump.flLevel, thump.level, thump.frequency, thump.flPitch, thump.fight]).toEqual([0, "hulk", 1, 1, fighterPitch(0), fighterPitch(0), "blunt"]);
    expect(typeof thump.flPan).toBe("number");
    expect(Math.abs(thump.flPan!)).toBeLessThanOrEqual(1);
    expect(tick!.filter(isCritical)).toHaveLength(0);
    // the only hit sound of the attacker in the tick (the shockwave's own hits are silent: the thump replaces nothing)
    expect(tick!.filter((c) => c.flFighter === 0 && (c.flCue === "hit" || c.flCue === "impact"))).toHaveLength(1);
    for (const s of SETS) {
      const res = resolveFlSound(thump, NO_FL_CLIPS, s)!;
      expect([s.set, flResolved(res, s), res.voices[0].bus, res.voices[0].tier]).toEqual([s.set, true, "ability", "oneShot"]);
    }
    expect(resolveFlSound(thump, NO_FL_CLIPS, SETS[1])!.voices[0].recipe).toBe(FL_PRIMITIVE_SOUNDS.giantHit.impact);
  });

  it("stings a critical blow in its tick – the Falcon Punch at HP 100 (half the bar): the thump plus one 'critical' match cue stamped with the attacker, never on the lethal blow, every cue resolved, the same at 30 and 144 fps", { timeout: 60_000 }, () => {
    const engine = heavyEngine("captainfalcon", "gerald", 1);
    let tick: SoundEvent[] | null = null;
    let heavy: { kind: number; slot: number; aux: number; value: number } | undefined;
    let lethal = false;
    let lethalCriticals = 0;
    heavyTicks(engine, 60_000, (cues, events) => {
      const crit = cues.filter(isCritical);
      if (!tick && crit.length > 0) {
        tick = cues;
        heavy = events.find((e) => e.kind === EV_HEAVY && e.slot === 1);
      }
      if (events.some((e) => e.kind === EV_HEAVY && e.slot === 1 && e.aux === 2)) {
        lethal = true;
        lethalCriticals += crit.length;
        return true;
      }
    });
    expect(tick).not.toBeNull();
    expect(heavy?.aux).toBe(1);
    expect(heavy?.value).toBeCloseTo(50, 6);
    const crits = tick!.filter(isCritical);
    expect(crits).toHaveLength(1);
    const crit = crits[0];
    expect([crit.flFighter, crit.flId, crit.flPitch, crit.flSlow, crit.flDelay]).toEqual([0, "captainfalcon", fighterPitch(0), undefined, undefined]);
    expect(crit.flVar! >= 0 && crit.flVar! < 1).toBe(true);
    const thumps = tick!.filter(isThump);
    expect(thumps.map((c) => [c.flFighter, c.flId, c.flLevel])).toEqual([[0, "captainfalcon", 1]]);
    // the sting and the thump are urgent: both pass the tick whatever else landed (the cat() classifier of the budget test calls both urgent)
    for (const s of SETS) for (const c of tick!) expect([s.set, what(c), flResolved(resolveFlSound(c, NO_FL_CLIPS, s), s)]).toEqual([s.set, what(c), true]);
    for (const s of SETS) expect(resolveFlSound(crit, NO_FL_CLIPS, s)!.voices.map((v) => [v.bus, v.recipe])).toEqual([["match", FL_MATCH_SOUNDS.critical]]);
    // the lethal blow carries no 'critical' (the KO stings own it)
    expect([lethal, lethalCriticals]).toEqual([true, 0]);
    // stamped in the hit's 60 Hz tick, never from frame time: the same cue keys at 30 and 144 fps
    const keys = (frameMs: number) => {
      const e = heavyEngine("captainfalcon", "gerald", 1);
      const out: string[] = e.consumeSoundEvents().map(cueKey);
      while (e.getElapsedMs() < 20_000 - 1e-6) {
        e.update(frameMs, 0);
        for (const ev of e.consumeSoundEvents()) out.push(cueKey(ev));
      }
      return out;
    };
    const slow = keys(1000 / 30);
    const fast = keys(1000 / 144);
    expect(slow.filter((k) => k.startsWith("match|critical|")).length).toBeGreaterThan(0);
    expect(slow.filter((k) => k.startsWith("impact||0|")).length).toBeGreaterThan(0);
    expect(fast).toEqual(slow);
  });

  it("keeps at most 6 budgeted cues a tick – 3 hits, 2 shots, 1 swing, 1 block, 1 note – and lets every urgent one through", { timeout: 60_000 }, () => {
    const engine = fightEngine({ fighters: ["ironman", "doomslayer", "legolas", "jinx"], match: "ffa4", hp: 150 }, 1);
    const cat = (ev: SoundEvent) => {
      if (!ev.flCue) return ev.fight ? "x" : "note";
      if (ev.flCue === "hit" || ev.flCue === "graze" || ev.flCue === "snag" || (ev.flCue === "impact" && ev.flPrim !== "giantHit" && ev.flPrim !== "wall")) return "hit";
      if (ev.flCue === "shoot" || ev.flCue === "return" || ev.flCue === "ricochet" || ev.flCue === "blink" || (ev.flCue === "fuse" && !ev.flPrim)) return "shoot";
      if (ev.flCue === "swing") return "swing";
      if (ev.flCue === "block" || ev.flCue === "clash" || ev.flCue === "immune") return "block";
      return "urgent";
    };
    let worst = 0;
    let casts = 0;
    let telegraphs = 0;
    while (engine.getElapsedMs() < 30_000 && !engine.isSimulationFinished()) {
      engine.update(STEP, 0);
      const counts: Record<string, number> = {};
      for (const ev of engine.consumeSoundEvents()) {
        const c = cat(ev);
        counts[c] = (counts[c] ?? 0) + 1;
        if (ev.flCue === "telegraph") telegraphs++;
      }
      expect((counts.hit ?? 0) <= 3 && (counts.shoot ?? 0) <= 2 && (counts.swing ?? 0) <= 1 && (counts.block ?? 0) <= 1 && (counts.note ?? 0) <= 1).toBe(true);
      worst = Math.max(worst, (counts.hit ?? 0) + (counts.shoot ?? 0) + (counts.swing ?? 0) + (counts.block ?? 0) + (counts.note ?? 0));
    }
    expect(worst).toBeLessThanOrEqual(FL_TICK_CUES);
    expect(worst).toBeGreaterThanOrEqual(3);
    for (const f of engine.getFightLeagueView().fighters) casts += f.casts;
    expect(telegraphs).toBeGreaterThanOrEqual(casts);
    expect(casts).toBeGreaterThan(0);
  });

  it("budgets a tick: the strongest of a category (a tie keeps the earlier), its priority order, the urgent ones always, the closed ticks in order", () => {
    const b = new FlTickBudget();
    const ev = (n: number): SoundEvent => ({ type: "hit", wallIndex: n, flCue: "hit" });
    for (let i = 0; i < 10; i++) b.offer(FL_CAT_HIT, i % 5, ev(i));
    b.offer(FL_CAT_SHOOT, 1, ev(20));
    b.offer(FL_CAT_SHOOT, 1, ev(21));
    b.offer(FL_CAT_SHOOT, 1, ev(22));
    b.offer(FL_CAT_SWING, 1, ev(30));
    b.offer(FL_CAT_BLOCK, 1, ev(40));
    b.offer(FL_CAT_NOTE, 1, ev(50));
    for (let i = 0; i < 5; i++) b.urgentCue({ type: "hit", wallIndex: 60 + i, flCue: "fire", flPrim: "beam", flFighter: i });
    b.urgentCue({ type: "hit", wallIndex: 99, flCue: "fire", flPrim: "beam", flFighter: 0 }); // the same cue twice in a tick: once
    b.endTick();
    b.offer(FL_CAT_NOTE, 1, ev(70));
    b.endTick();
    const out: number[] = [];
    expect(b.drain((e) => out.push(e.wallIndex))).toBe(5 + FL_TICK_CUES + 1);
    // urgent first; the hits keep their strongest three (energies 4, 4, 3: an equal one arriving later loses), then the block,
    // two shots, the swing (the note does not fit the six)
    expect(out.slice(0, 5)).toEqual([60, 61, 62, 63, 64]);
    expect(out.slice(5, 8).sort((a, c) => a - c)).toEqual([4, 8, 9]);
    expect(out.slice(8, 11)).toEqual([40, 20, 21]);
    expect(out[11]).toBe(70); // the next tick's note (the swing and this tick's note did not fit)
    expect(FL_TICK_SLOTS).toEqual([3, 1, 2, 1, 1]);
    expect(b.drain(() => undefined)).toBe(0);
  });

  // --- fl-heavy --- (Stop The World) the heavy hits' cues through the budget: a 60 s fight of fake cues
  it("holds the tick budget through a 60 s heavy fight of fake cues: a shockwave's three thumps and three criticals pass as one of each per attacker a tick, the weapon hits keep their three, the urgent ones lead the flush", () => {
    const b = new FlTickBudget();
    const hit = (i: number): SoundEvent => ({ type: "hit", wallIndex: i, flCue: "hit", flFighter: i & 3, flWeapon: "fists", flPan: 0 });
    let heavyCount = 0;
    let turns = 0;
    let worst = 0;
    let drained = 0;
    for (let tick = 0; tick < 3600; tick++) {
      for (let i = 0; i < 6; i++) b.offer(FL_CAT_HIT, 4 + (i % 3), hit(i));
      b.offer(FL_CAT_SWING, 1, { type: "hit", wallIndex: 90, flCue: "swing", flFighter: 1, flWeapon: "sword" });
      // a heavy blow every 400 ms (FL_IMPACT_GAP_MS): the attacker's shockwave lands on three foes, each a critical
      const heavy = tick % 24 === 0;
      if (heavy) {
        for (let foe = 1; foe <= 3; foe++) {
          b.urgentCue({ type: "hit", wallIndex: 10 + foe, flCue: "impact", flPrim: "giantHit", flLevel: 1, flFighter: 0, flPan: 0.3 * foe - 0.6, fight: "blunt", frequency: fighterPitch(0), level: 1 });
          b.urgentCue({ type: "hit", wallIndex: 20 + foe, flCue: "match", flRow: "critical", flFighter: 0, flPan: 0.3 * foe - 0.6 });
        }
      }
      // a lead turn every 2.5 s (FL_TURN_GAP_MS): the 'comeback' sting
      const turn = tick % 150 === 149;
      if (turn) b.urgentCue({ type: "hit", wallIndex: 40, flCue: "match", flRow: "comeback", flFighter: 2 });
      b.endTick();
      const out: SoundEvent[] = [];
      drained += b.drain((ev) => out.push(ev));
      const urgent = out.filter((ev) => ev.flCue === "impact" || ev.flCue === "match");
      const budgeted = out.length - urgent.length;
      worst = Math.max(worst, budgeted);
      expect(budgeted).toBeLessThanOrEqual(FL_TICK_CUES);
      expect(urgent.length).toBeLessThanOrEqual(FL_TICK_URGENT);
      expect(out.filter((ev) => ev.flCue === "hit")).toHaveLength(3);
      expect(out.filter((ev) => ev.flCue === "swing")).toHaveLength(1);
      if (heavy) {
        heavyCount++;
        expect(urgent.filter((ev) => ev.flCue === "impact").map((ev) => ev.wallIndex)).toEqual([11]);
        expect(urgent.filter((ev) => ev.flRow === "critical").map((ev) => ev.wallIndex)).toEqual([21]);
        expect(out.slice(0, 2).map((ev) => `${ev.flCue}:${ev.flRow ?? ev.flPrim}`)).toEqual(["impact:giantHit", "match:critical"]);
      } else expect(urgent.filter((ev) => ev.flRow !== "comeback")).toHaveLength(0);
      if (turn) turns++;
      expect(urgent.filter((ev) => ev.flRow === "comeback")).toHaveLength(turn ? 1 : 0);
    }
    expect([heavyCount, turns, worst, b.pending()]).toEqual([150, 24, 4, 0]);
    expect(drained).toBe(3600 * 4 + 150 * 2 + 24);
  });

  it("picks the same cues at 30 and 144 fps (20 seeds)", { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= 20; seed++) {
      const fl: Partial<FightLeagueSettings> = { fighters: ["random", "random"], sameDivision: false };
      const at = (frameMs: number) => {
        const engine = fightEngine(fl, seed);
        const out: string[] = engine.consumeSoundEvents().map(cueKey);
        while (engine.getElapsedMs() < 12_000 - 1e-6) {
          engine.update(frameMs, 0);
          for (const ev of engine.consumeSoundEvents()) out.push(cueKey(ev));
        }
        return out;
      };
      const slow = at(1000 / 30);
      const fast = at(1000 / 144);
      expect([seed, slow.length > 20, fast.length]).toEqual([seed, true, slow.length]);
      expect([seed, fast]).toEqual([seed, slow]);
    }
  });
});

/* ------------------------------------------------------------------ the resolver */

describe("fight league sound resolution (flSoundResolve.ts)", () => {
  const base = (patch: Partial<SoundEvent>): SoundEvent => ({ type: "hit", wallIndex: 0, melody: false, ...patch });
  const clips = (keys: string[]): FlClipLookup => ({ clip: (id, slot) => (keys.includes(`${id}:${slot}`) ? { key: `${id}:${slot}`, sec: 1 } : null) });

  it("plays the fighter's clip first, then its signature (its own role, then its family at its pitch) with its division's tint, then the kind's or the primitive's row", () => {
    const hit = base({ flCue: "hit", flId: "thor", flWeapon: "hammer", fight: "blunt" });
    expect(resolveFlSound(hit, clips(["thor:hit"]))!.voices.map((v) => [v.source, v.clip])).toEqual([["clip", "thor:hit"]]);
    expect(resolveFlSound(hit)!.source).toBe("signature");
    expect(resolveFlSound(hit, NO_FL_CLIPS, { set: "kinds", announcer: true, custom: true })!.source).toBe("weapon");
    // the clips switch off: the signature again
    expect(resolveFlSound(hit, clips(["thor:hit"]), { set: "signature", announcer: true, custom: false })!.source).toBe("signature");
    // a family set at the fighter's pitch
    const swing = resolveFlSound(base({ flCue: "swing", flId: "deadpool", flWeapon: "sword" }))!;
    expect([swing.source, swing.voices[0].h]).toEqual(["family", 1100]);
    // the division's tint on top: the hero stab on a Marvel cast, the chip chirp on a Nintendo charge
    const fire = resolveFlSound(base({ flCue: "fire", flId: "thor", flPrim: "lightning" }))!;
    expect(fire.voices.map((v) => v.source)).toEqual(["signature", "tint"]);
    expect(resolveFlSound(base({ flCue: "charge", flId: "mario", flPrim: "invulnerable" }))!.voices.map((v) => v.source)).toEqual(["signature", "tint"]);
    // the primitive's row for a fighter without one of its own
    expect(resolveFlSound(base({ flCue: "telegraph", flId: "loki", flPrim: "decoys" }))!.source).toBe("primitive");
    // an energy blade's swing: the saber family at its colour's hum
    expect(resolveFlSound(base({ flCue: "swing", flId: "luke", flWeapon: "sword", flStyle: "glow" }))!.voices[0].h).toBe(98);
    // an ability's volley hits like its projectile's kind
    expect(resolveFlSound(base({ flCue: "hit", flId: "loki", flShape: "arrow", flPrim: "volley" }), NO_FL_CLIPS, { set: "kinds", announcer: true, custom: true })!.voices[0].recipe).toContain("sin 900>300/25");
  });

  it("resolves the match and the announcer directly, silences what is silent by design, and plays the old kind with the legacy set", () => {
    const win = resolveFlSound(base({ flCue: "match", flRow: "win", flId: "godzilla" }))!;
    expect(win.voices.map((v) => [v.source, v.bus])).toEqual([
      ["match", "match"],
      ["signature", "match"],
    ]);
    expect(win.voices[1].delay).toBeCloseTo(0.25, 9);
    expect(resolveFlSound(base({ flCue: "match", flRow: "intro", flId: "thor" }))!.source).toBe("silent");
    expect(resolveFlSound(base({ flCue: "match", flRow: "intro", flId: "trex" }))!.voices[0].source).toBe("tint"); // the monsters' roar
    expect(resolveFlSound(base({ flCue: "announcer", flRow: "fight" }))!.voices[0].bus).toBe("announcer");
    expect(resolveFlSound(base({ flCue: "announcer", flRow: "fight" }), NO_FL_CLIPS, { set: "signature", announcer: false, custom: true })!.source).toBe("silent");
    expect(resolveFlSound(base({ flCue: "announcer", flRow: "nope" }))).toBeNull();
    expect(resolveFlSound(base({ flCue: "sustain", flId: "thor", flPrim: "heal", flSec: 2 }))!.source).toBe("silent");
    const legacy: FlSoundSettings = { set: "legacy", announcer: true, custom: true };
    expect(resolveFlSound(base({ flCue: "hit", flId: "thor", flWeapon: "hammer", fight: "blunt", frequency: 330, level: 0.7 }), NO_FL_CLIPS, legacy)!.legacy).toEqual({ kind: "blunt", frequency: 330, level: 0.7 });
    expect(resolveFlSound(base({ flCue: "swing", flId: "thor", flWeapon: "hammer" }), NO_FL_CLIPS, legacy)!.source).toBe("silent");
    const fin = resolveFlSound(base({ flCue: "match", flRow: "finalKo", fight: "ko", frequency: 82.41, level: 1, chord: [261.63, 329.63, 392, 523.25] }), NO_FL_CLIPS, legacy)!;
    expect([fin.legacy!.kind, fin.legacy!.chord!.length]).toEqual(["ko", 4]);
    // an old-style event (no cue) is the legacy kind – a fallback the cue tests count as a miss
    expect(flResolved(resolveFlSound(base({ fight: "gun" })))).toBe(false);
  });
});

/* ------------------------------------------------------------------ the mixer and the generator */

describe("fight league mixer (flMixer.ts) and the ToneGenerator's cue path", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("caps a bus's voices (stealing the oldest), plays the same recipe of a fighter once within 40 ms, and ducks the bed under a sting", () => {
    const graph = fakeGraph({ extended: true });
    const ctx = graph.ctx as unknown as BaseAudioContext;
    const duck = vi.fn();
    const mixer = new FlMixer(ctx, ctx.destination as AudioNode, { duckBed: duck });
    const p = (time: number, fighter = "0:0") => ({ time, F: 329.63, R: 523.25, level: 0.6, pan: 0, variant: 0.5, slow: 1, fighter });
    const hit = resolveFlSound(base2({ flCue: "hit", flId: "loki", flWeapon: "cards" }))!;
    expect(mixer.play(hit, p(0))).toBe(1);
    expect(mixer.play(hit, p(0.02))).toBe(0); // merged
    expect(mixer.play(hit, p(0.05))).toBe(1);
    for (let i = 0; i < 12; i++) mixer.play(hit, p(0.1 + 0.02 * i, `0:${i + 1}`));
    expect(mixer.activeVoices(0)).toBeLessThanOrEqual(FL_BUS_VOICES.hit);
    // a burst denser than the bus's rate plays its first voices only
    const before = mixer.started;
    for (let i = 0; i < 10; i++) mixer.play(hit, p(0.6 + 0.001 * i, `1:${i}`));
    expect(mixer.started - before).toBe(FL_BUS_RATE.hit);
    expect(duck).not.toHaveBeenCalled();
    mixer.play(resolveFlSound(base2({ flCue: "match", flRow: "ko" }))!, p(0.2, "0:"));
    expect(duck).toHaveBeenCalled();
    duck.mockClear();
    mixer.play(resolveFlSound(base2({ flCue: "match", flRow: "tick" }))!, p(0.3, "0:"));
    expect(duck).not.toHaveBeenCalled(); // a short tick ducks nothing
  });

  // --- fl-heavy --- (Stop The World) the CRITICAL sting on the match bus: a sting (over 0.2 s) ducks the bed, the same attacker's second within 40 ms merges
  it("plays the 'critical' sting on the match bus beside the thump: it ducks the bed, one attacker's second within 40 ms merges, another attacker's plays", () => {
    const graph = fakeGraph({ extended: true });
    const ctx = graph.ctx as unknown as BaseAudioContext;
    const duck = vi.fn();
    const mixer = new FlMixer(ctx, ctx.destination as AudioNode, { duckBed: duck });
    const p = (time: number, fighter: string) => ({ time, F: 329.63, R: 523.25, level: 1, pan: -0.3, variant: 0.5, slow: 1, fighter });
    const crit = resolveFlSound(base2({ flCue: "match", flRow: "critical", flId: "captainfalcon", flFighter: 0 }))!;
    const thump = resolveFlSound(base2({ flCue: "impact", flPrim: "giantHit", flId: "captainfalcon", flFighter: 0, flLevel: 1 }))!;
    const before = graph.oscillators.length + graph.sources.length;
    expect(mixer.play(thump, p(0, "0:0"))).toBeGreaterThanOrEqual(1);
    expect(mixer.play(crit, p(0, "0:0"))).toBe(1);
    expect(graph.oscillators.length + graph.sources.length).toBeGreaterThan(before);
    expect(duck).toHaveBeenCalled();
    expect(mixer.play(crit, p(0.02, "0:0"))).toBe(0); // merged: one sting per attacker within 40 ms
    expect(mixer.play(crit, p(0.03, "0:2"))).toBe(1); // another attacker's critical in the same breath plays (the bus holds two)
    expect(mixer.activeVoices(0.05)).toBeGreaterThanOrEqual(2);
  });

  it("keeps a loop on its lease: a renewal starts nothing, a stop ends it, at most four at once", () => {
    const graph = fakeGraph({ extended: true });
    const ctx = graph.ctx as unknown as BaseAudioContext;
    const mixer = new FlMixer(ctx, ctx.destination as AudioNode);
    const loop = (key: string, id: string) => mixer.play(resolveFlSound(base2({ flCue: "loopStart", flId: id, flWeapon: "sword", flStyle: "glow", flLoop: 0, flVariant: 0 }))!, { time: 0, F: 330, R: 523.25, level: 1, pan: 0, variant: 0.5, slow: 1, fighter: key, loopKey: key, sustainSec: 1.5 });
    expect(loop("0:1", "vader")).toBe(1);
    expect(loop("0:1", "vader")).toBe(0);
    expect(mixer.loopCount()).toBe(1);
    for (let i = 2; i <= FL_MAX_LOOPS + 2; i++) loop(`0:${i}`, "luke");
    expect(mixer.loopCount()).toBe(FL_MAX_LOOPS);
    mixer.stop("0:", 0, true);
    expect(mixer.loopCount()).toBe(0);
  });

  it("plays a cue through the ToneGenerator (the legacy kind with the legacy set), drops a swing pushed past 120 ms by the beat lock, and gives the offline twin its own mixer", async () => {
    const graph = fakeGraph({ extended: true });
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    expect(tone.getFightMixer()).not.toBeNull();
    graph.ctx.currentTime = 1;
    const count = () => graph.oscillators.length + graph.sources.length;
    let before = count();
    tone.playFightCue(base2({ flCue: "hit", flId: "thor", flWeapon: "hammer", flPitch: 1046.5, flLevel: 1, fight: "blunt", frequency: 330, level: 0.8 }));
    expect(count()).toBeGreaterThan(before);
    tone.setFightSoundSettings({ set: "legacy" });
    before = count();
    const spy = vi.spyOn(tone, "playFight");
    tone.playFightCue(base2({ flCue: "hit", flId: "thor", flWeapon: "hammer", fight: "blunt", frequency: 330, level: 0.8 }));
    expect(count()).toBeGreaterThan(before); // the old fightTones kind
    expect(spy).not.toHaveBeenCalled(); // (scheduled directly, not re-dispatched)
    tone.setFightSoundSettings({ set: "signature", announcer: false });
    expect(tone.getFightSoundSettings()).toEqual({ set: "signature", announcer: false, custom: true });
    // the beat lock: at 30 BPM in quarters the next grid point is up to 2 s away – a swing then is dropped, a hit waits for it
    tone.setMusicSettings({ ...tone.getMusicSettings(), quantizeToBeat: true, bpm: 30, quantizeGrid: "1/4" });
    tone.resetBeatGrid();
    graph.ctx.currentTime = 1.5;
    before = count();
    tone.playFightCue(base2({ flCue: "swing", flId: "thor", flWeapon: "hammer" }));
    expect(count()).toBe(before);
    tone.playFightCue(base2({ flCue: "hit", flId: "loki", flWeapon: "cards" }));
    expect(count()).toBeGreaterThan(before);
    expect(Math.min(...graph.oscillators.slice(-1).map((o) => o.startAt), ...graph.sources.slice(-1).map((s) => s.startArgs[0]))).toBeGreaterThanOrEqual(2 - 1e-6);
    const twin = await tone.createOfflineTwin(graph.ctx as unknown as BaseAudioContext, () => 0);
    expect(twin.getFightMixer()).not.toBeNull();
    expect(twin.getFightMixer()).not.toBe(tone.getFightMixer());
    expect(twin.getFightSoundSettings()).toEqual(tone.getFightSoundSettings());
  });
});

function base2(patch: Partial<SoundEvent>): SoundEvent {
  return { type: "hit", wallIndex: 0, melody: false, ...patch };
}

/* ------------------------------------------------------------------ the dispatch */

describe("fight league sound routing (flDispatch.ts): the page, the fast export, the other arenas", () => {
  it("sends a cue to playFightCue, an old-style event (or a sink without cues) to playFight, and drops a new cue an old sink cannot play", () => {
    const cue = base2({ flCue: "swing", flId: "thor", flWeapon: "hammer" });
    const sink = { playFightCue: vi.fn(), playFight: vi.fn() };
    expect(playFightEvent(sink, cue, 1, 0)).toBe(true);
    expect(sink.playFightCue).toHaveBeenCalledWith(cue, 1, 0);
    const old = { playFight: vi.fn() };
    expect(playFightEvent(old, base2({ flCue: "hit", fight: "blunt", frequency: 300, level: 0.5 }), 0.6)).toBe(true);
    expect(old.playFight).toHaveBeenCalledWith("blunt", 300, 0.3);
    expect(playFightEvent(old, cue)).toBe(true);
    expect(old.playFight).toHaveBeenCalledTimes(1);
    expect(playFightEvent(old, base2({}))).toBe(false);
    // the fast export's dispatch and the other arenas' (a little softer, their arena's loops apart)
    const audio = { playFightCue: vi.fn(), playFight: vi.fn() } as unknown as ToneGenerator;
    playSoundEvent(audio, cue, () => undefined);
    expect((audio as unknown as { playFightCue: ReturnType<typeof vi.fn> }).playFightCue).toHaveBeenCalledWith(cue, 1, 0);
    const arena = { playFightCue: vi.fn() } as unknown as ArenaSoundSink;
    playArenaSound(arena, cue, 2);
    expect((arena as unknown as { playFightCue: ReturnType<typeof vi.fn> }).playFightCue).toHaveBeenCalledWith(cue, EXTRA_ARENA_LEVEL, 2);
    // the page's sound loop uses the same dispatch (and the other arenas' with their index)
    const page = fs.readFileSync(path.join(ROOT, "src/components/simulator/Simulator.tsx"), "utf8");
    expect(page).toContain("playFightEvent(audio, ev, 1)");
    expect(page).toContain("playArenaSound(audio, ev, arena)");
    expect(page).not.toContain("audio.playFight(");
  });
});

/* ------------------------------------------------------------------ the custom clips */

/** An in-memory IndexedDB with what flClips.ts uses (open with an upgrade, an object store, put / delete / getAll). */
function fakeIndexedDb(): IDBFactory {
  const dbs = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();
  const request = <T>(fn: () => T) => {
    const r = { result: undefined as T | undefined, error: null as unknown, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
    queueMicrotask(() => {
      try {
        r.result = fn();
        r.onsuccess?.();
      } catch (err) {
        r.error = err;
        r.onerror?.();
      }
    });
    return r;
  };
  return {
    open(name: string) {
      const r = { result: null as unknown, error: null as unknown, onupgradeneeded: null as (() => void) | null, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
      queueMicrotask(() => {
        const fresh = !dbs.has(name);
        if (fresh) dbs.set(name, new Map());
        const stores = dbs.get(name)!;
        r.result = {
          objectStoreNames: { contains: (s: string) => stores.has(s) },
          createObjectStore: (s: string) => stores.set(s, new Map()),
          transaction: (s: string) => ({
            objectStore: () => {
              const m = stores.get(s)!;
              return {
                put: (v: { key: string }) => request(() => (m.set(v.key, structuredClone(v)), v.key)),
                delete: (k: string) => request(() => void m.delete(k)),
                getAll: () => request(() => [...m.values()].map((v) => structuredClone(v))),
              };
            },
          }),
        };
        if (fresh) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  } as unknown as IDBFactory;
}

/** The test's decoder: the WAV reader (a browser decodes the other formats). */
async function decodeWav(bytes: ArrayBuffer): Promise<DecodedAudio> {
  const wav = parseWav16(bytes);
  if (!wav) throw new Error("not decodable");
  return { sampleRate: wav.sampleRate, numberOfChannels: wav.channels.length, length: wav.channels[0].length, getChannelData: (c) => wav.channels[c] };
}

function tone(sec: number, rate = 8000, hz = 440, amp = 0.5): ArrayBuffer {
  const d = new Float32Array(Math.round(sec * rate));
  for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return encodeWav16([d], rate);
}

describe("fight league custom clips (flClips.ts)", () => {
  it("knows the audio files by their magic bytes", () => {
    const b = (s: string, at = 0) => {
      const u = new Uint8Array(16);
      for (let i = 0; i < s.length; i++) u[at + i] = s.charCodeAt(i);
      return u;
    };
    const riff = b("RIFF");
    riff.set(b("WAVE").subarray(0, 4), 8);
    expect([sniffAudioFormat(riff), sniffAudioFormat(b("OggS")), sniffAudioFormat(b("fLaC")), sniffAudioFormat(b("ID3")), sniffAudioFormat(Uint8Array.of(0xff, 0xfb, 0x90, 0)), sniffAudioFormat(b("ftyp", 4)), sniffAudioFormat(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3))]).toEqual(["wav", "ogg", "flac", "mpeg", "mpeg", "mp4", "webm"]);
    expect(sniffAudioFormat(b("hello world"))).toBeNull();
  });

  it("refuses a file over 2 MB, one that is not audio, one the browser cannot decode or that is silent; trims the rest to 3 s", async () => {
    const big = new ArrayBuffer(FL_CLIP_MAX_BYTES + 1);
    new Uint8Array(big).set(new Uint8Array(tone(0.01)).subarray(0, 12));
    expect(await prepareFlClip("big.wav", big, "thor", "hit", decodeWav)).toEqual({ ok: false, error: "tooLarge" });
    expect(await prepareFlClip("notes.txt", new TextEncoder().encode("hello world, not audio").buffer as ArrayBuffer, "thor", "hit", decodeWav)).toEqual({ ok: false, error: "badFile" });
    const ogg = new Uint8Array(64);
    ogg.set([0x4f, 0x67, 0x67, 0x53]);
    expect(await prepareFlClip("broken.ogg", ogg.buffer, "thor", "hit", decodeWav)).toEqual({ ok: false, error: "badFile" });
    expect(await prepareFlClip("silence.wav", tone(0.5, 8000, 440, 0), "thor", "hit", decodeWav)).toEqual({ ok: false, error: "badFile" });
    expect(await prepareFlClip("x.wav", tone(0.5), "nobody", "hit", decodeWav)).toEqual({ ok: false, error: "badFile" });
    const res = await prepareFlClip("long.wav", tone(5), "thor", "hit", decodeWav);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect([res.record.key, res.record.sec, res.record.name]).toEqual(["thor:hit", FL_CLIP_MAX_SEC, "long.wav"]);
    expect(parseWav16(res.record.bytes)!.channels[0].length).toBe(FL_CLIP_MAX_SEC * 8000);
    expect(res.record.peak).toBeCloseTo(0.5, 2);
  });

  it("keeps the clips in IndexedDB (database jbl-fl-clips, store clips, key fighter:slot) and tells its subscribers", async () => {
    const store = new FlClipStore(indexedDbClipBackend(fakeIndexedDb()));
    const seen: string[][] = [];
    store.subscribe((r) => seen.push(r.map((x) => x.key).sort()));
    const a = (await prepareFlClip("a.wav", tone(0.2), "thor", "hit", decodeWav)) as { ok: true; record: FlClipRecord };
    const b = (await prepareFlClip("b.wav", tone(0.2, 8000, 660), "loki", "win", decodeWav)) as { ok: true; record: FlClipRecord };
    await store.put(a.record);
    await store.put(b.record);
    expect((await store.list()).map((r) => r.key).sort()).toEqual(["loki:win", "thor:hit"]);
    // a second store over the same database reads them back
    const again = new FlClipStore(indexedDbClipBackend(fakeIndexedDb()));
    expect(await again.list()).toEqual([]);
    await store.remove("loki:win");
    expect((await store.list()).map((r) => r.key)).toEqual(["thor:hit"]);
    expect(seen.at(-1)).toEqual(["thor:hit"]);
    const lookup = flClipLookup(await store.list());
    expect([lookup.clip("thor", "hit")?.key, lookup.clip("thor", "ko")]).toEqual(["thor:hit", null]);
    // a record that is not a clip (an unknown fighter, other bytes) is never read back
    const mem = memoryClipBackend();
    await mem.put({ ...a.record, key: "nobody:hit", fighterId: "nobody" });
    await mem.put({ ...a.record, bytes: new TextEncoder().encode("not a wav").buffer as ArrayBuffer });
    expect(await new FlClipStore(mem).list()).toEqual([]);
  });

  it("exports the set as <name>.jumpingballslive.zip (the WAV files and clips.json) and imports it back, refusing what it must", async () => {
    const recs = [(await prepareFlClip("Thor hit.wav", tone(0.3), "thor", "hit", decodeWav)) as { ok: true; record: FlClipRecord }, (await prepareFlClip("Loki ko.wav", tone(0.4, 11025, 330), "loki", "ko", decodeWav)) as { ok: true; record: FlClipRecord }].map((r) => r.record);
    const { fileName, bytes } = exportFlClipSet(recs, "My fight set!");
    expect(fileName).toBe("My-fight-set.jumpingballslive.zip");
    const names = (await unzip(bytes)).map((e) => e.name).sort();
    expect(names).toEqual(["clips.json", "clips/loki-ko.wav", "clips/thor-hit.wav"]);
    const back = await importFlClipSet(bytes, decodeWav);
    expect(back.refused).toEqual([]);
    expect(back.records.map((r) => [r.key, r.name, r.sec, r.bytes.byteLength])).toEqual(recs.map((r) => [r.key, r.name, r.sec, r.bytes.byteLength]));
    // not a set; an unsafe path inside an archive
    await expect(importFlClipSet(zipCat([{ name: "other.json", data: new TextEncoder().encode("{}") }]), decodeWav)).rejects.toThrow();
    await expect(unzip(zipCat([{ name: "../evil.wav", data: new Uint8Array(4) }]))).rejects.toThrow(/unsafe/);
  });
});

function zipCat(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts = zipStore(entries);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* ------------------------------------------------------------------ settings, messages, the repository */

describe("fight league sound settings, messages and the repository's audio", () => {
  it("carries the sound set, the announcer and the custom clips switch in the link (flSnd, flAnn, flCS), never in the fight's key", () => {
    const s = { ...defaultSettings("fightLeague"), flSound: "kinds" as const, flAnnouncer: false, flCustomSounds: false };
    const params = settingsToSearchParams(s);
    expect([params.get("flSnd"), params.get("flAnn"), params.get("flCS")]).toEqual(["kinds", "0", "0"]);
    const back = settingsFromSearchParams(params);
    expect([back.flSound, back.flAnnouncer, back.flCustomSounds]).toEqual(["kinds", false, false]);
    const plain = settingsToSearchParams(defaultSettings("fightLeague"));
    expect([plain.has("flSnd"), plain.has("flAnn"), plain.has("flCS")]).toEqual([false, false, false]);
    expect(settingsFromSearchParams(new URLSearchParams("mode=fightLeague&flSnd=loud")).flSound).toBe("signature");
    const page = fs.readFileSync(path.join(ROOT, "src/components/simulator/Simulator.tsx"), "utf8");
    const key = page.split("\n").find((l) => l.includes("const flFightKey"))!;
    expect(key).not.toMatch(/flSound|flAnnouncer|flCustomSounds/);
  });

  it("has the Sound group's and the clip panel's keys in every language, found by the settings search", () => {
    const keys = ["flSoundGroup", "flSoundGroupTip", "flSound", "flSoundTip", "flSoundSignature", "flSoundKinds", "flSoundLegacy", "flAnnouncer", "flAnnouncerTip", "flCustomSounds", "flCustomSoundsTip", "flClipPanel", "flClipPanelTip", "flClipSlots_swing", "flClipSlots_hit", "flClipSlots_ability", "flClipSlots_ko", "flClipSlots_intro", "flClipSlots_win", "flClipRightsNote", "flClipExport", "flClipImport", "flClipTooLarge", "flClipBadFile"];
    for (const [lang, m] of [["en", en], ["pl", pl], ["es", es]] as const) {
      const controls = (m as unknown as Record<string, Record<string, string>>).Controls;
      for (const k of keys) expect([lang, k, typeof controls[k]]).toEqual([lang, k, "string"]);
    }
    for (const k of ["flSoundGroup", "flSound", "flAnnouncer", "flCustomSounds", "flClipPanel"]) expect(FIGHT_LEAGUE_KEYS).toContain(k);
  });

  it("tracks audio files only under public/hitSounds/ and public/wallBreak/, and ignores the owner's fight sounds and clip sets", () => {
    const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter((f) => /\.(wav|mp3|ogg|m4a|flac|webm|aac)$/i.test(f));
    expect(tracked.filter((f) => !f.startsWith("public/hitSounds/") && !f.startsWith("public/wallBreak/"))).toEqual([]);
    const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
    expect(ignore).toContain("fight-sounds/");
    expect(ignore).toContain("*.jumpingballslive.zip");
  });
});

/* ------------------------------------------------------------------ rendered in Chromium */

async function bundleFlLib(): Promise<string> {
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    stdin: {
      contents: `
        import { scheduleFlRecipe, parseFlRecipe, recipeDurationMs } from "@/lib/audio/flSynth";
        import { flAllRecipes } from "@/lib/audio/flRecipes";
        import { flTrim } from "@/lib/audio/flMixer";
        window.flLib = { scheduleFlRecipe, parseFlRecipe, recipeDurationMs, flAllRecipes, flTrim };
      `,
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    alias: { "@": path.join(ROOT, "src") },
    define: { "process.env.NEXT_PUBLIC_BASE_PATH": '""', "process.env.NEXT_PUBLIC_SITE_URL": '""', "process.env.NEXT_PUBLIC_SITE_DOMAIN": '""' },
    logLevel: "error",
  });
  return result.outputFiles[0].text;
}

describe("fight league sound rendered in Chromium", () => {
  it("brings every 12th row to its tier's peak through its trim (one-shot 0.40, charge 0.30, held 0.25)", { timeout: 180_000 }, async (ctx) => {
    let browser: import("playwright").Browser | null = null;
    try {
      const code = await bundleFlLib();
      const { chromium } = await import("playwright");
      browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
      const page = await browser.newPage();
      await page.setContent("<!doctype html><html><body></body></html>");
      await page.addScriptTag({ content: code });
      const rows = await page.evaluate(
        async ({ F, R, hold }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lib = (window as any).flLib;
          const all = lib.flAllRecipes();
          const out: { where: string; ratio: number }[] = [];
          for (let i = 0; i < all.length; i += 12) {
            const e = all[i];
            const r = lib.parseFlRecipe(e.text);
            const held = r.held || e.tier === "sustain";
            const sec = lib.recipeDurationMs(r, held ? hold * 1000 : undefined) / 1000 + 0.3;
            const off = new OfflineAudioContext(2, Math.ceil(Math.min(4, Math.max(0.2, sec)) * 48000), 48000);
            const g = off.createGain();
            g.gain.value = lib.flTrim(e.text, e.h);
            g.connect(off.destination);
            lib.scheduleFlRecipe(off, g, r, 0.01, { F, R, H: e.h, variant: 0.5, sustainSec: held ? hold : undefined });
            const buf = await off.startRendering();
            let peak = 0;
            for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
            const target = e.tier === "charge" ? 0.3 : e.tier === "sustain" ? 0.25 : 0.4;
            out.push({ where: `${e.table} ${e.key} ${e.role}`, ratio: peak / target });
          }
          return out;
        },
        { F: FL_TRIM_F, R: FL_TRIM_R, hold: FL_TRIM_HOLD_SEC },
      );
      expect(rows.length).toBeGreaterThan(40);
      expect(rows.filter((r) => !(r.ratio > 0.9 && r.ratio < 1.1)).map((r) => `${r.where}: ${r.ratio.toFixed(3)}`)).toEqual([]);
    } catch (err) {
      if (!browser) {
        // --- ai-guard --- JBL_REQUIRE_BROWSER=1 (the core guard sets it) makes a missing Chromium a failure, never a silent skip
        if (process.env.JBL_REQUIRE_BROWSER === "1") throw new Error(`JBL_REQUIRE_BROWSER=1: Chromium did not start for the rendered fight sound checks: ${String(err)}`);
        console.warn("Chromium is not available – the rendered fight sound checks are skipped:", err);
        return ctx.skip();
      }
      throw err;
    } finally {
      await browser?.close();
    }
  });
});
