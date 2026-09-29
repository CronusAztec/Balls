import type { PhysicsEngine } from "@/lib/physics/engine";
import {
  DEFAULT_CAMERA_SETTINGS,
  REPLAY_MIN_MS,
  REPLAY_POST_ROLL_MS,
  REPLAY_SPEED,
  SHAKE_DECAY_MS,
  SlowMotion,
  allBallsOutside,
  cameraFeaturesOn,
  cameraTransform,
  createCameraFrame,
  createCameraView,
  replayDurationMs,
  replayEligible,
  replayTimeAt,
  shakeAmplitude,
  shakeOffset,
  stepCameraView,
  type CameraSettings,
  type CameraTransform,
} from "@/lib/simulation/camera";
import { ReplayBuffer, type ReplayView } from "@/lib/simulation/replay";
import { ACCENT } from "@/lib/site";

/**
 * Where the escape replay is: waiting for the run to end, holding on for the escape's post-roll, playing, or
 * played (until the run restarts).
 */
export type ReplayPhase = "idle" | "postroll" | "playing" | "done";

/** Balls (besides the followed one) that the zoom keeps in frame. */
const FIT_BALLS = 8;
const TWO_PI = Math.PI * 2;
const DATA_KEYS = ["cameraReplay", "cameraScale", "cameraTimeScale", "cameraShakes", "cameraSlowMo", "cameraReplays"] as const;
/** The replay speed next to the label ("½×" at half speed). */
const SPEED_LABEL = REPLAY_SPEED === 0.5 ? "½×" : `${REPLAY_SPEED}×`;

/**
 * The canvas side of the cinematic camera (the maths lives in lib/simulation/camera.ts and replay.ts).
 * Canvas.tsx owns one per draw loop and calls it at fixed points of its frame:
 *
 *  - `timeScale()` before feeding the engine: the slow-motion factor for this frame (the engine still runs
 *    its fixed 60 Hz steps, it just gets less wall-clock time, so the physics stay deterministic);
 *  - `afterStep()` after every `engine.update()`: records the step into the replay buffer;
 *  - `frame()` once the physics are done: new wall breaks kick the shake, new near misses start the slow
 *    motion, and the end of an escape run starts the replay;
 *  - `replayView()` while drawing: the recorded walls and balls to draw instead of the live ones;
 *  - `applyView()` in place of the classic camera follow: zoom + follow + shake, or false to let the
 *    classic follow run untouched when no camera feature needs the view;
 *  - `drawOverlay()` last, in screen space: the "REPLAY" badge (so it is part of recordings too);
 *  - `holdsEndScreen()` for the page: true while the replay is pending or playing.
 *
 * It only reads the engine – except that a wall breaking inside the replayed window spawns the wall-break
 * particles again (`spawnWallBreakByStyle`, visual only: particles use Math.random, never the seeded
 * generator, and the run is already over). Nothing here can change a run.
 */
export class CinematicCamera {
  settings: CameraSettings = DEFAULT_CAMERA_SETTINGS;
  readonly view = createCameraView();
  readonly slowMo = new SlowMotion();
  readonly replay = new ReplayBuffer();
  private readonly frameIn = createCameraFrame();
  private readonly transform: CameraTransform = { scale: 1, tx: 0, ty: 0 };
  private readonly shake = { x: 0, y: 0 };
  private shakeAge = Infinity;
  private shakeSeed = 0;
  private phase: ReplayPhase = "idle";
  private replayElapsed = 0;
  private replayStart = 0;
  private replayEnd = 0;
  private replayBreak = 0;
  private replayMask = 0;
  private finishedAt = 0;
  private current: ReplayView | null = null;
  private lastElapsed = 0;
  private lastSeed = NaN;
  private lastBreaks = -1;
  private lastMisses = -1;
  private scaleNow = 1;
  /** Shakes, slow-motion windows and replays in this run (mirrored onto the canvas as data-camera-* for tools and the smoke test). */
  private shakes = 0;
  private replays = 0;

  /** Real → simulation time factor for this frame: the slow-motion window, 1 otherwise (and around the replay). */
  timeScale(): number {
    const s = this.settings;
    this.scaleNow = s.slowMoOnNearMiss && this.phase === "idle" ? this.slowMo.timeScale(s.slowMoMs, s.slowMoFactor) : 1;
    return this.scaleNow;
  }

  getPhase(): ReplayPhase {
    return this.phase;
  }

  isReplaying() {
    return this.phase === "playing";
  }

  /** The page keeps the end screen (and a running recording) back while this is true: the replay is about to play or playing. */
  holdsEndScreen() {
    return this.phase === "postroll" || this.phase === "playing";
  }

  /** The recorded scene to draw instead of the live walls and balls, or null while live. */
  replayView(): ReplayView | null {
    return this.phase === "playing" ? this.current : null;
  }

  /** A restart or a mode change sends the engine clock back (or draws a new seed): forget the replay and the running effects. */
  private checkRestart(engine: PhysicsEngine) {
    const elapsed = engine.getElapsedMs();
    const seed = engine.getSeed();
    if (elapsed < this.lastElapsed || seed !== this.lastSeed) {
      this.replay.clear();
      this.phase = "idle";
      this.current = null;
      this.replayElapsed = 0;
      this.slowMo.reset();
      this.slowMo.started = 0;
      this.shakeAge = Infinity;
      this.shakes = 0;
      this.replays = 0;
      this.lastBreaks = engine.getWallBreakSerial();
      this.lastMisses = engine.getNearMissSerial();
    }
    this.lastElapsed = elapsed;
    this.lastSeed = seed;
  }

  private recording(engine: PhysicsEngine) {
    return this.settings.replayOnEscape && (this.phase === "idle" || this.phase === "postroll") && replayEligible(engine.getCurrentModeName());
  }

  /** After every engine.update(): records the step for the escape replay (only while a replay can follow). */
  afterStep(engine: PhysicsEngine) {
    this.checkRestart(engine);
    if (!this.recording(engine)) return;
    const t = engine.getElapsedMs();
    const walls = engine.getCircularWalls();
    const balls = engine.getBalls();
    this.replay.record(t, balls, walls, engine.getWallRotations(), engine.getBrokenWalls(), engine.getWallBreakSerial());
    let outer = 0;
    for (let i = 0; i < walls.length; i++) if (walls[i].radius > outer) outer = walls[i].radius;
    this.replay.noteEscape(t, allBallsOutside(balls, engine.config.width / 2, engine.config.height / 2, outer));
  }

  private kickShake(seed: number) {
    this.shakeAge = 0;
    this.shakeSeed = seed;
    this.shakes++;
  }

  /**
   * Once per frame after the physics. `running` is false while the run is paused or not started: the
   * shake, the slow-motion window and the replay only advance while it plays.
   */
  frame(engine: PhysicsEngine, frameMs: number, running: boolean) {
    this.checkRestart(engine);
    const s = this.settings;
    const live = this.phase === "idle";
    const breaks = engine.getWallBreakSerial();
    if (this.lastBreaks < 0 || breaks < this.lastBreaks) this.lastBreaks = breaks;
    else if (breaks > this.lastBreaks) {
      this.lastBreaks = breaks;
      if (s.screenShake > 0 && live) this.kickShake(breaks);
    }
    const misses = engine.getNearMissSerial();
    if (this.lastMisses < 0 || misses < this.lastMisses) this.lastMisses = misses;
    else if (misses > this.lastMisses) {
      this.lastMisses = misses;
      if (s.slowMoOnNearMiss && live) this.slowMo.trigger(s.slowMoMs);
    }
    if (!running) return;
    this.shakeAge += frameMs;
    this.slowMo.advance(frameMs, s.slowMoMs);

    if (this.phase === "idle") {
      if (s.replayOnEscape && replayEligible(engine.getCurrentModeName()) && engine.isSimulationFinished()) {
        this.finishedAt = engine.getElapsedMs();
        this.phase = "postroll";
      }
    }
    if (this.phase === "postroll") {
      // Keep recording until the escape's post-roll is in the buffer (Classic has it long before its run ends;
      // Accumulation, Portal and Colour Match end the moment the ball is out), then play.
      if (!s.replayOnEscape) this.phase = "done";
      else if (this.replay.isFrozen() || engine.getElapsedMs() - this.finishedAt >= REPLAY_POST_ROLL_MS) this.startReplay(engine);
    } else if (this.phase === "playing") {
      this.replayElapsed += frameMs;
      if (!s.replayOnEscape || this.replayElapsed >= replayDurationMs(this.replayEnd - this.replayStart)) {
        this.phase = "done";
        this.current = null;
      }
    }
    if (this.phase === "playing") this.sampleReplay(engine);
  }

  private startReplay(engine: PhysicsEngine) {
    const buffer = this.replay;
    buffer.freeze();
    const start = buffer.windowStart();
    const end = buffer.endTime();
    if (!(buffer.size > 1 && end - start >= REPLAY_MIN_MS)) {
      this.phase = "done";
      return;
    }
    this.phase = "playing";
    this.replayStart = start;
    this.replayEnd = end;
    this.replayElapsed = 0;
    this.replays++;
    this.slowMo.reset();
    this.shakeAge = Infinity;
    this.current = buffer.sample(start, engine.getCircularWalls());
    this.replayBreak = this.current ? this.current.breakSerial : 0;
    this.replayMask = this.current ? this.current.brokenMask : 0;
  }

  /** The replayed scene for this frame; a wall that breaks inside the window shakes the view and bursts again. */
  private sampleReplay(engine: PhysicsEngine) {
    const view = this.replay.sample(replayTimeAt(this.replayElapsed, this.replayStart, this.replayEnd), engine.getCircularWalls());
    this.current = view;
    if (!view) return;
    if (view.breakSerial > this.replayBreak) {
      this.replayBreak = view.breakSerial;
      if (this.settings.screenShake > 0) this.kickShake(this.replayBreak);
    }
    const fresh = view.brokenMask & ~this.replayMask;
    this.replayMask = view.brokenMask;
    if (fresh === 0 || view.balls.length === 0) return;
    const cx = engine.config.width / 2;
    const cy = engine.config.height / 2;
    for (let w = 0; w < view.walls.length; w++) {
      if (!(fresh & (1 << w))) continue;
      // The burst goes where the ball crossing that wall is: the replayed ball nearest to its ring.
      const radius = view.walls[w].radius;
      let best = view.balls[0];
      let bestDist = Infinity;
      for (let k = 0; k < view.balls.length; k++) {
        const b = view.balls[k];
        const d = Math.abs(Math.hypot(b.x - cx, b.y - cy) - radius);
        if (d < bestDist) {
          bestDist = d;
          best = b;
        }
      }
      engine.spawnWallBreakByStyle(w, best.x, best.y);
    }
  }

  /** The camera needs the view: zoom (or a zoom still easing out), shake or the replay. */
  private ownsView() {
    const s = this.settings;
    return s.cameraZoom > 0 || s.screenShake > 0 || this.phase === "playing" || Math.abs(this.view.scale - 1) > 1e-3;
  }

  /**
   * Applies this frame's view transform – follow and zoom toward the first ball (the replayed one during the
   * replay), plus the shake – and returns true. Returns false when no camera feature needs the view: the
   * classic camera follow then runs as it always did, and the view picks up from its offset (`classicX/Y`,
   * the classic translation) so switching between the two never jumps.
   */
  applyView(ctx: CanvasRenderingContext2D, engine: PhysicsEngine, cameraFollow: boolean, cx: number, cy: number, arena: number, minDim: number, classicX: number, classicY: number): boolean {
    if (!this.ownsView()) {
      this.view.offsetX = -classicX;
      this.view.offsetY = -classicY;
      this.view.scale = 1;
      return false;
    }
    const s = this.settings;
    const f = this.frameIn;
    const replay = this.replayView();
    const balls = replay ? replay.balls : engine.getBalls();
    f.centerX = cx;
    f.centerY = cy;
    f.arena = arena;
    f.halfView = minDim / 2;
    f.zoom = s.cameraZoom;
    f.follow = cameraFollow || s.cameraZoom > 0;
    f.hasTarget = balls.length > 0;
    f.spread = 0;
    if (f.hasTarget) {
      const b = balls[0];
      f.targetX = b.x;
      f.targetY = b.y;
      // Keep the other balls in play (inside the arena) in frame when zooming.
      if (s.cameraZoom > 0) {
        const n = Math.min(balls.length, FIT_BALLS + 1);
        const inside = 1.2 * arena;
        for (let i = 1; i < n; i++) {
          const o = balls[i];
          if (Math.hypot(o.x - cx, o.y - cy) > inside) continue;
          const d = Math.hypot(o.x - b.x, o.y - b.y) + o.radius;
          if (d > f.spread) f.spread = d;
        }
      }
    }
    stepCameraView(this.view, f);
    let sx = 0;
    let sy = 0;
    if (s.screenShake > 0 && this.shakeAge < SHAKE_DECAY_MS) {
      shakeOffset(this.shakeAge, shakeAmplitude(s.screenShake, minDim), this.shakeSeed, this.shake);
      sx = this.shake.x;
      sy = this.shake.y;
    }
    const t = cameraTransform(this.view, cx, cy, sx, sy, this.transform);
    ctx.translate(t.tx, t.ty);
    if (t.scale !== 1) ctx.scale(t.scale, t.scale);
    return true;
  }

  /**
   * The "REPLAY" badge – a blinking red dot, the label, the speed and a progress bar – centred at the top
   * of the square the recorder exports, or at its bottom when the top text is in use there. `topMin` (screen
   * px) keeps a badge at the top below something already drawn there – the teams' scoreboard.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, label: string, atBottom: boolean, topMin = 0) {
    if (this.phase !== "playing") return;
    const minDim = Math.min(width, height);
    const fs = Math.max(11, 0.034 * minDim);
    const speed = SPEED_LABEL;
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = `900 ${fs}px sans-serif`;
    const labelW = ctx.measureText(label).width;
    ctx.font = `700 ${0.8 * fs}px sans-serif`;
    const speedW = ctx.measureText(speed).width;
    const dot = 0.28 * fs;
    const pad = 0.55 * fs;
    const gapW = 0.45 * fs;
    const w = pad + 2 * dot + gapW + labelW + gapW + speedW + pad;
    const h = 1.8 * fs;
    const margin = 0.6 * fs;
    const x = width / 2 - w / 2;
    const y = atBottom ? height / 2 + minDim / 2 - margin - h - 0.35 * fs - 2 : Math.max(height / 2 - minDim / 2 + margin, topMin > 0 ? topMin + 0.5 * margin : 0);
    // Pill
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.moveTo(x + h / 2, y);
    ctx.lineTo(x + w - h / 2, y);
    ctx.arc(x + w - h / 2, y + h / 2, h / 2, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x + h / 2, y + h);
    ctx.arc(x + h / 2, y + h / 2, h / 2, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fill();
    // Blinking red dot
    ctx.globalAlpha = 0.55 + 0.45 * Math.cos((TWO_PI * this.replayElapsed) / 900);
    ctx.fillStyle = "#ef4444";
    ctx.shadowColor = "#ef4444";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x + pad + dot, y + h / 2, dot, 0, TWO_PI);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Label and speed
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 ${fs}px sans-serif`;
    const tx = x + pad + 2 * dot + gapW;
    ctx.fillText(label, tx, y + h / 2);
    ctx.fillStyle = ACCENT;
    ctx.font = `700 ${0.8 * fs}px sans-serif`;
    ctx.fillText(speed, tx + labelW + gapW, y + h / 2);
    // Progress bar under the pill
    const duration = replayDurationMs(this.replayEnd - this.replayStart);
    const progress = duration > 0 ? Math.min(1, this.replayElapsed / duration) : 1;
    const by = y + h + 0.35 * fs;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + h / 2, by, w - h, 2);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = ACCENT;
    ctx.fillRect(x + h / 2, by, (w - h) * progress, 2);
    ctx.restore();
  }

  /**
   * Mirrors the camera state onto the canvas element (data-camera-*) while any camera feature is on, for tools
   * and the smoke test: the replay phase, the view scale, the time scale and the shake / slow-motion / replay
   * counts. Removed again when the camera is off.
   */
  syncData(canvas: HTMLCanvasElement) {
    const data = canvas.dataset;
    if (!cameraFeaturesOn(this.settings) && this.phase === "idle") {
      if (data.cameraReplay !== undefined) for (const key of DATA_KEYS) delete data[key];
      return;
    }
    setData(data, "cameraReplay", this.phase);
    setData(data, "cameraScale", this.view.scale.toFixed(2));
    setData(data, "cameraTimeScale", this.scaleNow.toFixed(2));
    setData(data, "cameraShakes", String(this.shakes));
    setData(data, "cameraSlowMo", String(this.slowMo.started));
    setData(data, "cameraReplays", String(this.replays));
  }
}

/** Writes a data-* attribute only when it changed. */
function setData(data: DOMStringMap, key: (typeof DATA_KEYS)[number], value: string) {
  if (data[key] !== value) data[key] = value;
}
