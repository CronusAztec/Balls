import type { PhysicsEngine } from "@/lib/physics/engine";
import { physicsExtrasOf } from "@/lib/physics/extras";
import { ballInteractionOf } from "@/lib/physics/interactions";
import { multiplierConfigOf } from "@/lib/physics/multipliers";
import { obstacleConfigOf } from "@/lib/physics/obstacleEditor";
import { riggedConfigOf } from "@/lib/physics/rigged";
import type { ModeId, PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";
import { effectiveBallCount } from "@/lib/teams";
import { engineTimelineOf } from "./timeline";
import type { FinderProgress, FinderRequest, FinderResult } from "./finder";
import type { InteractionKind } from "@/lib/audio/interactionTones";
import type { RaceArpeggioKind } from "@/lib/audio/raceTones";
import {
  EXTRA_ARENA_LEVEL,
  arenaParticleBudget,
  arenaViewports,
  emptyArenaMark,
  mergeArenaSettings,
  raceStandings,
  resolvedArenas,
  type ArenaMark,
  type ArenaOverride,
  type ArenaViewport,
  type RaceStandings,
} from "@/lib/splitScreen";

/*
 * --- split-screen --- The engines of a split-screen race. The first arena is the page's own engine (Simulator.tsx keeps it
 * in sync with the settings as always, plus the first arena's overrides); this runner keeps one more PhysicsEngine per
 * further arena, built from the shared settings with that arena's overrides (`mergeArenaSettings()`), each in a world of
 * its viewport's shape (`arenaViewports()`). It restarts them with the page's engine – a restart, a new mode, a found seed
 * – so every arena starts on the same frame, follows live setting changes, shares the particle budget out, drains the
 * other arenas' sounds and times the race (first escape, else finish, on each arena's simulation clock).
 */

/** How the page builds and restarts an arena's engine (Simulator.tsx: the same set-up as its own engine and the fast export's). */
export interface ArenaHooks {
  /** A new engine (it is set up by `init()` right after). */
  create(page: PhysicsEngine): PhysicsEngine;
  /** Arena `index` starts over: `settings` (the shared settings with its overrides) in `world`, with `seed` (null = random). */
  init(engine: PhysicsEngine, settings: SimulatorSettings, seed: number | null, world: { width: number; height: number }, page: PhysicsEngine): void;
  /** The page's own engine starts over (its world changed before the run started). */
  initPage(page: PhysicsEngine): void;
  /** A setting changed mid-run: the arena follows it live (besides the physics config, which the runner sends itself). */
  live(engine: PhysicsEngine, settings: SimulatorSettings): void;
}

/**
 * The physics config the page gives its engine for `s` (Simulator.tsx: the constructor and the config effects), without
 * the world size; `timeline` only when asked for (keyframes restart their clock when they arrive).
 */
export function arenaPhysicsConfig(s: SimulatorSettings, withTimeline = true): Omit<PhysicsConfig, "width" | "height"> {
  return {
    gravity: s.gravity,
    damping: 0,
    bounce: s.bounce,
    audioIntensity: 0,
    ballSpeed: s.ballSpeed,
    rotationSpeed: s.rotationEnabled ? s.rotationSpeed : 0,
    wallCount: s.wallCount,
    gapSize: s.gapSize,
    ballColor: s.ballColor,
    ballRadius: s.ballRadius,
    twoBalls: s.twoBalls,
    ballColor2: s.ballColor2,
    ballCount: effectiveBallCount(s),
    ...physicsExtrasOf(s),
    ...ballInteractionOf(s),
    ...multiplierConfigOf(s),
    ...obstacleConfigOf(s),
    ...riggedConfigOf(s),
    ...(withTimeline ? { timeline: engineTimelineOf(s) } : {}),
  };
}

/**
 * The keys of `next` whose values differ from `prev` (all of them without `prev`): a live update sends only what changed,
 * as the page's config effects do – a ball that grew (Grow, multipliers) keeps its size when, say, a colour changes.
 */
export function configPatch<T extends object>(prev: T | undefined, next: T): Partial<T> | null {
  const patch: Partial<T> = {};
  let any = false;
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (prev && Object.is(prev[key], next[key])) continue;
    patch[key] = next[key];
    any = true;
  }
  return any ? patch : null;
}

/** Where another arena's sound events are played (the page's ToneGenerator has these). */
export interface ArenaSoundSink {
  playWallHit(wallIndex?: number, frequency?: number, accent?: boolean, chord?: readonly number[], level?: number, melody?: boolean): void;
  playGapPass(): void;
  playInteraction(kind: InteractionKind): void;
  playMultiplier(total: number, melody?: boolean): void;
  playBumper(frequency?: number): void;
  playStringBattle(kind: "pluck" | "shatter", frequency?: number): void;
  playRaceArpeggio(kind: RaceArpeggioKind, root?: number): void;
  /** --- boris-vortex --- a ball swallowed by the Sound Vortex. */
  playPew(frequency?: number): void;
}

/**
 * Plays one sound event of another arena the way the page plays its own (its bounces a little softer: `EXTRA_ARENA_LEVEL`;
 * an event with `melody: false` accompanies the tune without using up a melody note, as on the page).
 */
export function playArenaSound(sink: ArenaSoundSink, ev: SoundEvent) {
  if (ev.race) return sink.playRaceArpeggio(ev.race, ev.frequency);
  if (ev.bumper) return sink.playBumper(ev.frequency);
  if (ev.sbSound) return sink.playStringBattle(ev.sbSound, ev.frequency);
  if (ev.pew) return sink.playPew(ev.frequency); // --- boris-vortex --- (not a wall hit)
  if (ev.type === "hit") sink.playWallHit(ev.wallIndex, ev.frequency, ev.accent, ev.chord, (ev.level ?? 1) * EXTRA_ARENA_LEVEL, ev.melody !== false);
  else if (ev.type === "gap") sink.playGapPass();
  else if (ev.type === "multiplier") sink.playMultiplier(ev.multiplier ?? 2, ev.melody !== false);
  else sink.playInteraction(ev.type);
}

export class MultiArenaRunner {
  private page: PhysicsEngine | null = null;
  private settings: SimulatorSettings | null = null;
  private hooks: ArenaHooks | null = null;
  /** The engines of arenas 2…n (index 0 here is arena 2). */
  private extras: PhysicsEngine[] = [];
  /** [page, ...extras] while the race is on, [page] (or nothing) otherwise – the snapshot React renders. */
  private snapshot: readonly PhysicsEngine[] = [];
  private readonly listeners = new Set<() => void>();
  /** The visible canvas (CSS px) the viewports tile; 0 × 0 until known. */
  private canvasW = 0;
  private canvasH = 0;
  private views: ArenaViewport[] = [];
  private count = 1;
  private overrides: ArenaOverride[] = [];
  /** The page engine's clock and mode after the last frame: a smaller clock or another mode means it restarted. */
  private lastPageElapsed = 0;
  private lastPageMode: ModeId | null = null;
  private marks: ArenaMark[] = [];
  private marksVersion = 0;
  private standingsCache: RaceStandings = raceStandings([]);
  private standingsVersion = -1;
  /** performance.now() when every arena had finished (−1 while one still runs). */
  private allDoneAt = -1;
  /** Walls each arena broke since the canvas last asked (index = arena; the first arena's are the page's to note). */
  private readonly wallBreaks: number[] = [];
  /** The keyframes and the physics config each arena engine got last (live updates send what changed only). */
  private readonly sentTimeline = new WeakMap<PhysicsEngine, string>();
  private readonly sentConfig = new WeakMap<PhysicsEngine, ReturnType<typeof arenaPhysicsConfig>>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** The engines to draw: [page, ...others] during a race (stable between changes of the arena count). */
  getEngines = (): readonly PhysicsEngine[] => this.snapshot;

  private publish() {
    this.snapshot = this.page && this.count > 1 && this.extras.length === this.count - 1 ? [this.page, ...this.extras] : this.page ? [this.page] : [];
    for (const l of this.listeners) l();
  }

  /** True while two or four arenas race. */
  isActive(): boolean {
    return this.count > 1 && this.extras.length === this.count - 1 && !!this.page;
  }
  arenaCount(): number {
    return this.isActive() ? this.count : 1;
  }
  /** The arenas' viewports on the canvas (empty until the canvas size is known). */
  viewports(): readonly ArenaViewport[] {
    return this.views;
  }
  /** The whole canvas (CSS px) while a race is on – the world the page's engine has in the single view – else null. */
  canvasSize(): { width: number; height: number } | null {
    return this.isActive() && this.canvasW > 0 && this.canvasH > 0 ? { width: this.canvasW, height: this.canvasH } : null;
  }
  /** The overrides of the arenas in play (labels filled in). */
  arenas(): readonly ArenaOverride[] {
    return this.overrides;
  }

  private worldOf(index: number, engine: PhysicsEngine): { width: number; height: number } {
    const vp = this.views[index];
    return vp ? vp.world : { width: engine.config.width, height: engine.config.height };
  }

  private mergedOf(index: number): SimulatorSettings | null {
    return this.settings ? mergeArenaSettings(this.settings, this.overrides[index], index) : null;
  }

  private initExtra(i: number) {
    const engine = this.extras[i - 1];
    const s = this.mergedOf(i);
    if (!engine || !s || !this.hooks || !this.page) return;
    this.hooks.init(engine, s, this.overrides[i]?.seed ?? null, this.worldOf(i, engine), this.page);
    this.sentTimeline.set(engine, JSON.stringify(engineTimelineOf(s)));
    this.sentConfig.set(engine, arenaPhysicsConfig(s, false));
  }

  /**
   * The first arena's fixed seed on the page's engine: a run that has not started yet (or just restarted) with another
   * seed starts over with it – the page's own effects drop a found seed on some setting changes, the arena's stays.
   */
  private enforcePageSeed(page: PhysicsEngine) {
    const seed = this.overrides[0]?.seed;
    if (seed === undefined || page.getElapsedMs() !== 0 || page.getSeed() === (seed | 0)) return;
    page.setSeed(seed);
    this.hooks?.initPage(page);
  }

  private resetRace() {
    this.marks = [];
    for (let i = 0; i < this.count; i++) this.marks.push(emptyArenaMark());
    this.marksVersion++;
    this.allDoneAt = -1;
    this.wallBreaks.length = 0;
  }

  /**
   * The page's settings changed (Simulator.tsx calls this from an effect): the arenas are created or dropped for the
   * arena count, the particle budget shared out, and the other arenas follow – from scratch while the page's run has not
   * started (or just restarted), live otherwise.
   */
  sync(page: PhysicsEngine, settings: SimulatorSettings, hooks: ArenaHooks) {
    const wasActive = this.isActive();
    this.page = page;
    this.settings = settings;
    this.hooks = hooks;
    const count = settings.arenaCount > 1 ? settings.arenaCount : 1;
    if (count < 2) {
      // Back to one arena: the page's engine gets its whole particle budget back; the canvas' size is the page world's again.
      const changed = this.count !== 1 || this.extras.length > 0;
      if (!wasActive && this.snapshot.length === 1) {
        this.canvasW = page.config.width;
        this.canvasH = page.config.height;
      }
      this.count = 1;
      this.extras = [];
      this.overrides = [];
      this.views = [];
      page.setParticleBudget(null);
      if (changed || this.snapshot[0] !== page) this.publish();
      return;
    }
    if (!wasActive && this.canvasW <= 0) {
      // The page's world is the whole canvas until the race starts: the viewports can be laid out before the canvas reports.
      this.canvasW = page.config.width;
      this.canvasH = page.config.height;
    }
    const countChanged = count !== this.count;
    this.count = count;
    this.overrides = resolvedArenas(settings);
    this.views = this.canvasW > 0 && this.canvasH > 0 ? arenaViewports(this.canvasW, this.canvasH, count, settings.arenaLayout) : [];
    const created: number[] = [];
    while (this.extras.length < count - 1) {
      this.extras.push(hooks.create(page));
      created.push(this.extras.length);
    }
    if (this.extras.length > count - 1) this.extras.length = count - 1;
    const budget = arenaParticleBudget(count);
    page.setParticleBudget(budget);
    for (const e of this.extras) e.setParticleBudget(budget);
    // The first arena's world (its viewport's shape) and seed; a run that has not started yet starts over in them.
    const fresh = page.getElapsedMs() === 0;
    this.fitWorld(0, page, fresh);
    this.enforcePageSeed(page);
    for (let i = 1; i < count; i++) {
      const engine = this.extras[i - 1];
      if (fresh || created.includes(i)) this.initExtra(i);
      else {
        this.fitWorld(i, engine, false);
        const s = this.mergedOf(i);
        if (s) this.liveUpdate(engine, s);
      }
    }
    if (fresh || countChanged) this.resetRace();
    this.lastPageElapsed = page.getElapsedMs();
    this.lastPageMode = page.getCurrentModeName();
    if (!wasActive || countChanged || created.length > 0 || this.snapshot.length !== count) this.publish();
  }

  private liveUpdate(engine: PhysicsEngine, s: SimulatorSettings) {
    const config = arenaPhysicsConfig(s, false);
    const patch = configPatch(this.sentConfig.get(engine), config);
    this.sentConfig.set(engine, config);
    if (patch) engine.setConfig(patch);
    this.hooks?.live(engine, s);
    // New keyframes only when they changed (they restart the automation's clock when they arrive).
    const keyframes = engineTimelineOf(s);
    const sig = JSON.stringify(keyframes);
    if (this.sentTimeline.get(engine) !== sig) {
      this.sentTimeline.set(engine, sig);
      engine.setConfig({ timeline: keyframes });
    }
    const balls = effectiveBallCount(s);
    if (engine.config.ballCount !== balls) engine.setBallCount(balls);
  }

  /** Gives arena `index`'s engine its world; `restart` starts a run that has not begun over in it (so it matches the finder's). */
  private fitWorld(index: number, engine: PhysicsEngine, restart: boolean) {
    const vp = this.views[index];
    if (!vp) return;
    const { width, height } = vp.world;
    if (Math.abs(engine.config.width - width) < 0.01 && Math.abs(engine.config.height - height) < 0.01) return;
    engine.setConfig({ width, height });
    if (!restart || engine.getElapsedMs() !== 0) return;
    if (index === 0) this.hooks?.initPage(engine);
    else this.initExtra(index);
  }

  /**
   * The canvas reports its size (CSS px): the viewports are laid out again and every engine gets its world – from scratch
   * before the run starts, as a live resize (like a window resize on a single canvas) during it.
   */
  setCanvasSize(width: number, height: number) {
    if (!(width > 0 && height > 0) || (Math.abs(width - this.canvasW) < 0.5 && Math.abs(height - this.canvasH) < 0.5 && this.views.length === this.count)) return;
    this.canvasW = width;
    this.canvasH = height;
    if (!this.isActive() || !this.settings || !this.page) return;
    this.views = arenaViewports(width, height, this.count, this.settings.arenaLayout);
    const fresh = this.page.getElapsedMs() === 0;
    this.fitWorld(0, this.page, fresh);
    for (let i = 1; i < this.count; i++) this.fitWorld(i, this.extras[i - 1], fresh);
  }

  /**
   * Before the arenas step (every frame of the canvas): when the page's engine restarted – its clock went back, or it
   * plays another mode – the other arenas start over with it, on this very frame.
   */
  beforeFrame() {
    const page = this.page;
    if (!page || !this.isActive()) return;
    const elapsed = page.getElapsedMs();
    const mode = page.getCurrentModeName();
    if (elapsed < this.lastPageElapsed || mode !== this.lastPageMode) {
      this.enforcePageSeed(page);
      for (let i = 1; i < this.count; i++) this.initExtra(i);
      this.resetRace();
    }
    this.lastPageElapsed = elapsed;
    this.lastPageMode = mode;
  }

  /** After the arenas stepped: the race marks (first escape, finish) and when the last arena finished. */
  afterFrame(nowMs: number) {
    const page = this.page;
    if (!page || !this.isActive()) return;
    let allDone = true;
    for (let i = 0; i < this.count; i++) {
      const engine = i === 0 ? page : this.extras[i - 1];
      const mark = this.marks[i];
      if (!engine || !mark) continue;
      if (mark.escapeMs < 0) {
        const esc = engine.getFirstEscapeMs();
        if (esc >= 0) {
          mark.escapeMs = esc;
          this.marksVersion++;
        }
      }
      const done = engine.isSimulationFinished();
      if (done && mark.finishMs < 0) {
        // The step the run finished on (a frame at 8× notices it several steps late): the finder's length of the run.
        const at = engine.getFinishedAtMs();
        mark.finishMs = at >= 0 ? at : engine.getElapsedMs();
        this.marksVersion++;
      }
      if (!done) allDone = false;
    }
    if (allDone) {
      if (this.allDoneAt < 0) this.allDoneAt = nowMs;
    } else this.allDoneAt = -1;
    this.lastPageElapsed = page.getElapsedMs();
    this.lastPageMode = page.getCurrentModeName();
  }

  /** Changes whenever a mark is set (the canvas re-labels the banner then). */
  version(): number {
    return this.marksVersion;
  }
  marksOf(): readonly ArenaMark[] {
    return this.marks;
  }
  /** The race so far (recomputed only after a mark changed). */
  standings(): RaceStandings {
    if (this.standingsVersion !== this.marksVersion) {
      this.standingsCache = raceStandings(this.marks);
      this.standingsVersion = this.marksVersion;
    }
    return this.standingsCache;
  }

  /** Every arena's run is over (the page then shows its end screen, after `holding()`). True outside a race. */
  allFinished(): boolean {
    if (!this.isActive()) return true;
    for (const e of this.extras) if (!e.isSimulationFinished()) return false;
    return !!this.page?.isSimulationFinished();
  }
  /** True for `holdMs` after the last arena finished: the finished race stays on screen (and in a recording) that long. */
  holding(nowMs: number, holdMs: number): boolean {
    return this.isActive() && this.allDoneAt >= 0 && nowMs - this.allDoneAt < holdMs;
  }

  /**
   * Hands the other arenas' queued sound events to `play` (the page consumes the first arena's itself), or drops them
   * when only the first arena is heard – either way the queues are emptied every frame.
   */
  drainSounds(play: ((ev: SoundEvent, arena: number) => void) | null) {
    for (let i = 0; i < this.extras.length; i++) {
      const events = this.extras[i].consumeSoundEvents();
      for (const ev of events) {
        // A broken wall widens the eyes of that arena's ball faces (the page does it for the first arena's).
        if (ev.type === "gap" && !ev.race && !ev.bumper && !ev.sbSound) this.wallBreaks[i + 1] = (this.wallBreaks[i + 1] ?? 0) + 1;
        if (play) play(ev, i + 1);
      }
    }
  }

  /** How many walls arena `index` (not the first: the page notes its own) broke since the last call; the canvas' faces react. */
  takeWallBreaks(index: number): number {
    const n = this.wallBreaks[index] ?? 0;
    if (n > 0) this.wallBreaks[index] = 0;
    return n;
  }

  /** What the finder needs to search every arena (null outside a race). */
  finderPlan(): ArenaFinderPlan | null {
    if (!this.isActive() || !this.settings) return null;
    return {
      shared: { gravity: this.settings.gravity, ballSpeed: this.settings.ballSpeed, ballColor: this.settings.ballColor },
      arenas: this.overrides.slice(),
      worlds: this.views.map((v) => v.world),
    };
  }
}

/* ------------------------------------------------------------------ the finder */

/** The arenas as the finder searches them: the shared physics, each arena's overrides and world. */
export interface ArenaFinderPlan {
  shared: { gravity: number; ballSpeed: number; ballColor: string };
  arenas: ArenaOverride[];
  worlds: { width: number; height: number }[];
}

/** Arena `index`'s search: the page's request with the arena's mode, physics overrides and world. */
export function arenaFinderRequest(request: FinderRequest, plan: ArenaFinderPlan, index: number): FinderRequest {
  const arena = plan.arenas[index] ?? { label: "" };
  const world = plan.worlds[index];
  return {
    ...request,
    mode: index > 0 && arena.mode ? arena.mode : request.mode,
    physicsConfig: {
      ...request.physicsConfig,
      gravity: arena.gravity ?? plan.shared.gravity,
      ballSpeed: arena.ballSpeed ?? plan.shared.ballSpeed,
      ballColor: arena.ballColor ?? plan.shared.ballColor,
      ...(world ? { width: world.width, height: world.height } : {}),
    },
  };
}

export type FinderFn = (request: FinderRequest, onProgress: (p: FinderProgress) => void, signal?: AbortSignal) => Promise<FinderResult>;

/** The first arena's result, plus the seed found for every arena (undefined: none to search) when the race is on. */
export type ArenaFinderResult = FinderResult & { arenaSeeds?: (number | undefined)[] };

/** A search's progress, with the arena being searched in a race (undefined: the first arena – the page's). */
export type ArenaFinderProgress = FinderProgress & { arena?: number };

/**
 * Find Simulation in a split-screen race: the first arena is searched as always (the page's request), then – if it was
 * found – every other arena with its own overrides and world, one after the other; each keeps the seed found (or the
 * closest one). The result is the first arena's with the longest run's duration (the clip should last the whole race).
 * A search aborted at any point (Cancel, a mode change, a preset load) is never found – even when the first arena's
 * search had already succeeded – so the page applies nothing of it, like the single-view finder's cancelled search.
 */
export async function findArenaSeeds(find: FinderFn, request: FinderRequest, onProgress: (p: ArenaFinderProgress) => void, signal: AbortSignal | undefined, plan: ArenaFinderPlan | null): Promise<ArenaFinderResult> {
  const first = await find(request, onProgress, signal);
  if (signal?.aborted) return { ...first, found: false };
  if (!plan || plan.arenas.length < 2 || !first.found) return first;
  const seeds: (number | undefined)[] = [first.seed];
  let longest = first.duration;
  for (let i = 1; i < plan.arenas.length; i++) {
    const result = await find(arenaFinderRequest(request, plan, i), (p) => onProgress({ ...p, arena: i }), signal);
    if (signal?.aborted) return { ...first, found: false };
    const searched = !result.endless && !result.fixedDuration && result.seedsTested > 0;
    seeds.push(searched ? result.seed : undefined);
    if (searched) longest = Math.max(longest, result.duration);
  }
  return { ...first, duration: longest, arenaSeeds: seeds };
}
