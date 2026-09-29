"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { PaintPoint } from "@/lib/physics/modes";
import { segmentEndpoints, type SegmentEnds } from "@/lib/physics/obstacles";
import { drawBoxArena, drawBoxCornerFlash, drawBoxShapes, type BoxRenderOptions } from "./boxRenderer";
import { drawPendulumBobs, drawPendulumChordFlash, drawPendulumRig, drawPendulumTrails, type PendulumRenderOptions } from "./pendulumRenderer";
// --- jdm-polyrhythm ---
import { drawPolyrhythmAlignFlash, drawPolyrhythmStage, drawPolyrhythmVoices, type PolyrhythmRenderOptions } from "./polyrhythmRenderer";
// --- jdm-collisions ---
import { drawCollideArena, drawCollideBodies, drawCollideOverlay, type CollideRenderOptions } from "./collideRenderer";
// --- boris-glass ---
import { applyGlassCamera, drawGlassOverlay, drawGlassShards, drawGlassWorld, type GlassRenderOptions } from "./glassRenderer";
// --- boris-multipliers ---
import { DEFAULT_MULTIPLIER_LABELS, MULTIPLIER_DATA_KEYS, drawMultiplierHud, drawMultipliersBalls, drawMultipliersBoard, drawPickupOrbs, writeMultiplierDataset, type MultiplierLabels, type MultiplierRenderOptions } from "./multiplierRenderer";
import { formatMultiplier } from "@/lib/physics/multipliers";
import { COVERAGE_DONE } from "@/lib/physics/picturePaint";
// --- boris-faces ---
import { FaceLayer } from "./faceRenderer";
import type { CharacterRenderOptions } from "@/lib/character/character";
import type { ChirpKind } from "@/lib/audio/characterVoice";
import type { BoxView } from "@/lib/physics/modes";
// --- end boris-faces ---
import { BackgroundPainter, drawStyledParticle, drawThemedTrail, trailColorTable, type BackgroundLook } from "./themeRenderer"; // --- themes
import type { RecordingCrop } from "@/lib/recording/recorder"; // --- themes
import { DEFAULT_BACKGROUND_COLORS, type BackgroundType } from "@/lib/themes"; // --- themes
import { TeamLayer, type CanvasTeamOptions } from "./teamsRenderer"; // --- teams ---
import type { RainbowWallMode } from "@/lib/settings";
import { ACCENT } from "@/lib/site";
// --- camera --- zoom, screen shake, slow motion on near misses and the escape replay (lib/simulation/camera.ts)
import { CinematicCamera } from "./cameraRenderer";
import { DEFAULT_CAMERA_SETTINGS, type CameraSettings } from "@/lib/simulation/camera";
// --- obstacle-editor --- the creator's pegs, bumpers, blockers and spinners: drawing and pointer / Backspace editing
import { ObstacleEditorLayer, type ObstacleRenderOptions } from "./obstacleEditorRenderer";
import type { EditorObstacle } from "@/lib/physics/obstacleEditor";
import { CaptionLayer, type CanvasCaptionOptions } from "./captionsRenderer"; // --- captions ---
// --- jdm-illusions --- wobbly walls (every ring mode and the Circle Illusion) and the Circle Illusion's own drawing
import { WobbleLayer } from "./wobbleRenderer";
import { IllusionLayer, type IllusionLabels, type IllusionRenderOptions } from "./illusionRenderer";

/** Strings drawn on the canvas (mode counters, "ESCAPED!" etc.). Provided by the page so they are translated. */
export interface CanvasLabels {
  escaped: string;
  afterFrozenBalls: (n: number) => string;
  frozenCount: (n: number) => string;
  painted: (pct: number) => string;
  teleports: string;
  afterTeleports: (n: number) => string;
  shattered: string;
  segmentsDestroyed: (broken: number, total: number) => string;
  segmentsShattered: string;
  matched: string;
  segmentsCleared: (total: number) => string;
  matchColour: string;
  complete: string;
  segmentsHitInOrder: (total: number) => string;
  ballsLabel: string;
  /** Ball Drop: every ball has come to rest. */
  settled: string;
  ballsAtRest: (n: number) => string;
  /** Bouncing Shapes: every countdown reached zero. */
  boxDone: string;
  boxCounted: (n: number) => string;
  /** Pendulum Wave: the row is back in line after the last cycle. */
  pendulumDone: string;
  pendulumInLine: (n: number, cycles: number) => string;
  // --- jdm-polyrhythm ---
  /** Metronomes & Polyrhythms: every voice back in phase after the last cycle. */
  polyrhythmDone: string;
  polyrhythmAligned: (n: number, cycles: number) => string;
  /** Picture Paint HUD hints: the schedule state and the beat the ball moves to. */
  paintOnSchedule: string;
  paintBehind: string;
  paintAhead: string;
  paintBeat: (bpm: number) => string;
  // --- jdm-collisions ---
  /** Collision Playground: the caption of the anti-collision switch. */
  collideAnti?: string;
  /** --- camera --- the badge over the escape replay. */
  replay?: string;
  // --- boris-glass ---
  /** Glass Smash: the stage banner and markers ("STAGE 3"), the sign over the door, and the banner at the end. */
  glassStage?: (n: number) => string;
  glassHome?: string;
  glassHomeTitle?: string;
  glassHomeSub?: (panes: number, stages: number) => string;
  // --- boris-multipliers ---
  /** Stat words, RELEASE, HOME and SLOW-MO of the multipliers HUD, gates and orbs. */
  multipliers?: MultiplierLabels;
  /** A ball outgrew the arena (the run is over), with its size multiplier. */
  outgrew?: string;
  outgrewSub?: (size: string) => string;
  /** The multipliers board is done: "N Boris made it home", with the clones made along the way. */
  madeItHome?: (n: number) => string;
  madeItHomeSub?: (clones: number) => string;
  // --- jdm-illusions ---
  /** Circle Illusion: the whitespace picture is revealed; the cycles a lines / rings run finished after. */
  illusionRevealed?: string;
  illusionCycles?: (n: number) => string;
}

export interface CanvasHandle {
  getCanvas: () => HTMLCanvasElement | null;
  setRecording: (recording: boolean) => void;
  setAudioIntensity: (v: number) => void;
  /** Song slicer position (0–1) for the HUD progress bar; null hides the bar. */
  setSongProgress: (v: number | null) => void;
  fpsRef: React.RefObject<number>;
  /** --- boris-faces --- A wall broke (a "gap" sound event): the ball characters look shocked. */
  noteWallBreak: () => void;
  // --- themes: the recorder paints each exported frame's background through this (gradient / picture, seamless letterbox bars)
  paintRecordingBackground: (ctx: CanvasRenderingContext2D, width: number, height: number, crop: RecordingCrop) => void;
  // --- end themes
  /** --- camera --- True while the escape replay is about to play or playing: the page holds the end screen (and a recording) back. */
  holdsEndScreen: () => boolean;
}

export interface CanvasProps {
  physicsEngine: PhysicsEngine;
  audioIntensity?: number;
  showTrails: boolean;
  showGlow: boolean;
  showWallGlow: boolean;
  isPaused: boolean;
  isStarted?: boolean;
  backgroundColor?: string;
  circleColor?: string;
  wallThickness?: number;
  watermarkText?: string;
  rainbowWalls?: boolean;
  rainbowWallMode?: RainbowWallMode;
  rainbowBall?: boolean;
  lineColor?: string;
  rainbowLines?: boolean;
  ballImage?: string | null;
  ballEmoji?: string | null;
  topText?: string;
  bottomText?: string;
  textSize?: number;
  trailThickness?: number;
  reactiveBackground?: boolean;
  colorTrail?: boolean;
  simSpeed?: number;
  cameraFollow?: boolean;
  labels?: CanvasLabels;
  /** Picture Paint: data: URL of the picture the Paint mode reveals (null = the classic rainbow trail). */
  paintPicture?: string | null;
  /** Opacity of the greyscale ghost of the unrevealed picture. */
  paintGhost?: number;
  // --- boris-faces ---
  /** Ball characters: face, name label and squash (null = none); see lib/character and faceRenderer.ts. */
  character?: CharacterRenderOptions | null;
  /** Called when a cat face chirps (an ouch, a breaking wall, an escape); the page plays it through the ToneGenerator. */
  onCharacterChirp?: (kind: ChirpKind) => void;
  // --- themes (lib/themes.ts, themeRenderer.ts): the background is `backgroundColor` for "solid"; gradients run top → bottom
  backgroundType?: BackgroundType;
  backgroundColors?: readonly string[];
  /** 0–1: darkening of the background picture. */
  backgroundDim?: number;
  /** data: URL of the uploaded background picture (cover-fitted; null = none). */
  backgroundImage?: string | null;
  /** Two colours the colour trail cycles between instead of the rainbow (empty = rainbow). */
  trailColors?: readonly string[];
  // --- end themes
  // --- teams --- team colours, emoji and names on the balls, the scoreboard and the winner banner (null = no roster); see teamsRenderer.ts
  teams?: CanvasTeamOptions | null;
  /** --- camera --- Cinematic camera: zoom, shake, slow motion on near misses, escape replay (all off by default). */
  camera?: CameraSettings;
  // --- obstacle-editor ---
  /** The obstacles can be edited on the canvas (the run is not going and a layout is in play): drag to move, Backspace to delete. */
  obstacleEditing?: boolean;
  /** A drag (on release) or a delete on the canvas changed the obstacle list. */
  onObstaclesChange?: (obstacles: EditorObstacle[]) => void;
  /** --- captions --- Animated captions drawn in the exported square on the simulation clock (null = none); see captionsRenderer.ts. */
  captions?: CanvasCaptionOptions | null;
  /** --- jdm-illusions --- Wobbly Walls, 0–1: circular walls deform with a travelling wave where a ball hits them (0 = perfect circles). */
  wallWobble?: number;
}

const NO_TRAIL_COLORS: readonly string[] = []; // --- themes

const DEFAULT_LABELS: CanvasLabels = {
  escaped: "ESCAPED!",
  afterFrozenBalls: (n) => `After ${n} frozen ball${n !== 1 ? "s" : ""}`,
  frozenCount: (n) => `Frozen: ${n}`,
  painted: (pct) => `${pct}% painted`,
  teleports: "teleports",
  afterTeleports: (n) => `After ${n} teleport${n !== 1 ? "s" : ""}`,
  shattered: "SHATTERED!",
  segmentsDestroyed: (b, t) => `${b}/${t} segments destroyed`,
  segmentsShattered: "segments shattered",
  matched: "MATCHED!",
  segmentsCleared: (t) => `All ${t} segments cleared`,
  matchColour: "Match colour:",
  complete: "COMPLETE!",
  segmentsHitInOrder: (t) => `All ${t} segments hit in order`,
  ballsLabel: "balls",
  settled: "SETTLED!",
  ballsAtRest: (n) => `All ${n} balls at rest`,
  boxDone: "COUNTED DOWN!",
  boxCounted: (n) => `All ${n} shape${n !== 1 ? "s" : ""} reached zero`,
  pendulumDone: "IN LINE!",
  pendulumInLine: (n, c) => `All ${n} pendulums back in phase after ${c} cycle${c !== 1 ? "s" : ""}`,
  polyrhythmDone: "IN PHASE!", // --- jdm-polyrhythm ---
  polyrhythmAligned: (n, c) => `All ${n} voices back in phase after ${c} cycle${c !== 1 ? "s" : ""}`,
  paintOnSchedule: "on schedule",
  paintBehind: "behind schedule",
  paintAhead: "ahead of schedule",
  paintBeat: (bpm) => `♩ ${bpm} BPM`,
  // --- jdm-collisions ---
  collideAnti: "ANTI-COLLISION",
  replay: "REPLAY", // --- camera ---
  // --- boris-glass ---
  glassStage: (n) => `STAGE ${n}`,
  glassHome: "HOME",
  glassHomeTitle: "HOME!",
  glassHomeSub: (panes, stages) => `${panes} panes smashed in ${stages} stage${stages !== 1 ? "s" : ""}`,
  // --- boris-multipliers ---
  multipliers: DEFAULT_MULTIPLIER_LABELS,
  outgrew: "OUTGREW THE ARENA",
  outgrewSub: (size) => `SIZE ${size}`,
  madeItHome: (n) => `${n} Boris made it home`,
  madeItHomeSub: (clones) => `${clones} clones along the way`,
  // --- jdm-illusions ---
  illusionRevealed: "REVEALED!",
  illusionCycles: (n) => `After ${n} cycle${n !== 1 ? "s" : ""}`,
};

const TWO_PI = Math.PI * 2;
const GLOW_LAYERS = [
  { widthMult: 5, alphaMult: 0.06 },
  { widthMult: 2.5, alphaMult: 0.18 },
  { widthMult: 1, alphaMult: 0.65 },
];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  if (h.length === 3) return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
  if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  return { r: 6, g: 182, b: 212 };
}

/**
 * The canvas renderer. It runs its own requestAnimationFrame loop, advances the physics
 * engine (respecting pause and playback speed) and draws walls, mode overlays, balls,
 * trails, glow, particles, HUD text and overlays. Visual props are mirrored into a ref so
 * the loop never has to restart when they change.
 */
const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  {
    physicsEngine,
    audioIntensity = 0,
    showTrails,
    showGlow,
    showWallGlow,
    isPaused,
    isStarted = false,
    backgroundColor = "#0a0a0a",
    circleColor = "#06b6d4",
    wallThickness = 2,
    watermarkText = "",
    rainbowWalls = false,
    rainbowWallMode = "pulse",
    rainbowBall = false,
    lineColor = "#ffffff",
    rainbowLines = false,
    ballImage = null,
    ballEmoji = null,
    topText = "",
    bottomText = "",
    textSize = 1,
    trailThickness = 0.8,
    reactiveBackground = false,
    colorTrail = false,
    simSpeed = 1,
    cameraFollow = false,
    labels,
    paintPicture = null,
    paintGhost = 0.12,
    character = null,
    onCharacterChirp,
    // --- themes
    backgroundType = "solid",
    backgroundColors = DEFAULT_BACKGROUND_COLORS,
    backgroundDim = 0.35,
    backgroundImage = null,
    trailColors = NO_TRAIL_COLORS,
    // --- end themes
    teams = null, // --- teams ---
    camera = DEFAULT_CAMERA_SETTINGS, // --- camera ---
    obstacleEditing = false, // --- obstacle-editor ---
    onObstaclesChange,
    captions = null, // --- captions ---
    wallWobble = 0, // --- jdm-illusions ---
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef(Date.now());
  const elapsedRef = useRef(0);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageLoadedRef = useRef(false);
  const emojiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recordingRef = useRef(false);
  const labelsRef = useRef<CanvasLabels | undefined>(labels);
  const sizeRef = useRef({ width: 800, height: 600 });
  const fpsRef = useRef(60);
  const lastFpsSampleRef = useRef(0);
  const lastFrameRef = useRef(0);
  const camXRef = useRef(0);
  const camYRef = useRef(0);
  const audioRef = useRef(audioIntensity);
  const songProgressRef = useRef<number | null>(null);
  /** Picture Paint: the decoded picture (null until it loads, or without one). */
  const paintImageRef = useRef<HTMLImageElement | null>(null);
  labelsRef.current = labels;
  // --- boris-faces --- the characters' options and chirp callback, read by the draw loop; the face layer lives with the loop
  const characterRef = useRef<CharacterRenderOptions | null>(character);
  characterRef.current = character;
  const chirpRef = useRef(onCharacterChirp);
  chirpRef.current = onCharacterChirp;
  const facesRef = useRef<FaceLayer | null>(null);
  // --- teams --- the roster options, read by the draw loop
  const teamsRef = useRef<CanvasTeamOptions | null>(teams);
  teamsRef.current = teams;
  // --- camera --- the camera settings the draw loop reads; the camera itself lives with the loop
  const cameraRef = useRef<CameraSettings>(camera);
  cameraRef.current = camera;
  const cinematicRef = useRef<CinematicCamera | null>(null);
  // --- end camera ---
  // --- obstacle-editor --- the editing layer (selection, drag) shared by the draw loop and the pointer handlers, and the props it reads
  const obstacleLayerRef = useRef<ObstacleEditorLayer | null>(null);
  const obstacleEditingRef = useRef(obstacleEditing);
  obstacleEditingRef.current = obstacleEditing;
  const onObstaclesChangeRef = useRef(onObstaclesChange);
  onObstaclesChangeRef.current = onObstaclesChange;
  // --- end obstacle-editor ---
  // --- captions --- the caption options, read by the draw loop
  const captionsRef = useRef<CanvasCaptionOptions | null>(captions);
  captionsRef.current = captions;
  const captionLayerRef = useRef<CaptionLayer | null>(null);
  // --- jdm-illusions --- the Wobbly Walls amount, read by the draw loop
  const wobbleAmountRef = useRef(wallWobble);
  wobbleAmountRef.current = wallWobble;
  // --- themes: the look the draw loop reads, the decoded background picture and the painter (shared with the recorder)
  const themeLookRef = useRef({ backgroundType, backgroundColors, backgroundDim, trailColors });
  useEffect(() => {
    themeLookRef.current = { backgroundType, backgroundColors, backgroundDim, trailColors };
  }, [backgroundType, backgroundColors, backgroundDim, trailColors]);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const bgPainterRef = useRef<BackgroundPainter | null>(null);
  const bgPainter = () => (bgPainterRef.current ??= new BackgroundPainter());
  const backgroundLook = (): BackgroundLook => {
    const look = themeLookRef.current;
    return { type: look.backgroundType, colors: look.backgroundColors, dim: look.backgroundDim, image: bgImageRef.current };
  };
  useEffect(() => {
    if (!backgroundImage) {
      bgImageRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      bgImageRef.current = img;
    };
    img.onerror = () => {
      bgImageRef.current = null;
    };
    img.src = backgroundImage;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [backgroundImage]);
  // --- end themes

  const propsRef = useRef({
    showTrails,
    showGlow,
    showWallGlow,
    isPaused,
    isStarted,
    backgroundColor,
    circleColor,
    wallThickness,
    watermarkText,
    rainbowWalls,
    rainbowWallMode,
    rainbowBall,
    lineColor,
    rainbowLines,
    topText,
    bottomText,
    textSize,
    trailThickness,
    reactiveBackground,
    colorTrail,
    simSpeed,
    cameraFollow,
    paintGhost,
  });
  useEffect(() => {
    propsRef.current = {
      showTrails,
      showGlow,
      showWallGlow,
      isPaused,
      isStarted,
      backgroundColor,
      circleColor,
      wallThickness,
      watermarkText,
      rainbowWalls,
      rainbowWallMode,
      rainbowBall,
      lineColor,
      rainbowLines,
      topText,
      bottomText,
      textSize,
      trailThickness,
      reactiveBackground,
      colorTrail,
      simSpeed,
      cameraFollow,
      paintGhost,
    };
  }, [
    showTrails,
    showGlow,
    showWallGlow,
    isPaused,
    isStarted,
    backgroundColor,
    circleColor,
    wallThickness,
    watermarkText,
    rainbowWalls,
    rainbowWallMode,
    rainbowBall,
    lineColor,
    rainbowLines,
    topText,
    bottomText,
    textSize,
    trailThickness,
    reactiveBackground,
    colorTrail,
    simSpeed,
    cameraFollow,
    paintGhost,
  ]);

  const circleRgbRef = useRef(hexToRgb(circleColor));
  useEffect(() => {
    circleRgbRef.current = hexToRgb(circleColor);
  }, [circleColor]);

  useEffect(() => {
    audioRef.current = audioIntensity;
  }, [audioIntensity]);

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    setRecording: (v: boolean) => {
      recordingRef.current = v;
    },
    setAudioIntensity: (v: number) => {
      audioRef.current = v;
    },
    setSongProgress: (v: number | null) => {
      songProgressRef.current = v;
    },
    fpsRef,
    noteWallBreak: () => facesRef.current?.noteWallBreak(), // --- boris-faces ---
    // --- themes
    paintRecordingBackground: (c: CanvasRenderingContext2D, width: number, height: number, crop: RecordingCrop) => {
      bgPainter().paintExport(c, width, height, crop, backgroundLook());
    },
    // --- end themes
    holdsEndScreen: () => (cinematicRef.current?.holdsEndScreen() ?? false) || (captionLayerRef.current?.holdsEndScreen() ?? false), // --- camera --- (--- captions --- and the question's answer)
  }));

  useEffect(() => {
    if (ballImage) {
      const img = new Image();
      img.onload = () => {
        imageRef.current = img;
        imageLoadedRef.current = true;
      };
      img.onerror = () => {
        imageRef.current = null;
        imageLoadedRef.current = false;
      };
      img.src = ballImage;
    } else {
      imageRef.current = null;
      imageLoadedRef.current = false;
    }
  }, [ballImage]);

  // Picture Paint: decode the uploaded picture once; the draw loop builds its layers from it.
  useEffect(() => {
    if (!paintPicture) {
      paintImageRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      paintImageRef.current = img;
    };
    img.onerror = () => {
      paintImageRef.current = null;
    };
    img.src = paintPicture;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [paintPicture]);

  useEffect(() => {
    if (ballEmoji) {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 128;
      const g = c.getContext("2d")!;
      g.clearRect(0, 0, 128, 128);
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "172.8px serif";
      g.fillText(ballEmoji, 64, 74.24);
      emojiCanvasRef.current = c;
    } else {
      emojiCanvasRef.current = null;
    }
  }, [ballEmoji]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const engine = physicsEngine;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      sizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      engine.setConfig({ width: rect.width, height: rect.height });
    };
    resize();
    window.addEventListener("resize", resize);

    const alphaCache = new Map<string, string>();
    const ballSpriteCache = new Map<string, HTMLCanvasElement>();
    const glowSpriteCache = new Map<string, HTMLCanvasElement>();
    let accumulator = 0;
    // Scratch space for the obstacle pass (Ball Drop): the age of the latest hit per obstacle and a bar's endpoints.
    let obstacleHitAges = new Float64Array(0);
    const ends: SegmentEnds = { x1: 0, y1: 0, x2: 0, y2: 0 };
    // Bouncing Shapes: the renderer's options, refreshed per frame (one object for the life of the loop).
    const boxRender: BoxRenderOptions = { wallColor: () => "#fff", wallThickness: 2, showWallGlow: true, showGlow: false, showTrails: true, trailThickness: 0.8 };
    // Pendulum Wave: the renderer's options and the scratch placement the trails are sampled into (one object each for the life of the loop).
    const pendulumRender: PendulumRenderOptions = { wallColor: () => "#fff", wallThickness: 2, showGlow: false };
    const pendulumTrailPoint = { x: 0, y: 0, angle: 0 };
    // --- boris-faces --- ball characters (faces, name label, squash); the Box / Pendulum / Polyrhythm / Collide bodies get faces through drawOverlays()
    const faces = new FaceLayer();
    facesRef.current = faces;
    const teamLayer = new TeamLayer(); // --- teams ---
    const scoreboardBox = { x: 0, y: 0, w: 0, h: 0 }; // --- boris-multipliers --- where the scoreboard goes this frame (the HUD keeps clear)
    let multHudTop = -1;
    const boxHueColors: string[] = [];
    const boxBodyColor = (ball: { id: number }) => {
      const st = engine.getBoxView().shapes.get(ball.id);
      const hue = st ? ((Math.round(st.hue) % 360) + 360) % 360 : 0;
      return (boxHueColors[hue] ??= `hsl(${hue}, 88%, 60%)`);
    };
    const bobBodyColor = (ball: { color: string }) => ball.color;
    // --- jdm-polyrhythm --- Metronomes & Polyrhythms: the renderer's options, refreshed per frame.
    const polyRender: PolyrhythmRenderOptions = { wallColor: () => "#fff", wallThickness: 2, showGlow: false };
    // --- jdm-collisions --- Collision Playground: the renderer's options, refreshed per frame.
    const collideRender: CollideRenderOptions = { wallColor: () => "#fff", wallThickness: 2, showWallGlow: true, showGlow: false, showTrails: true, trailThickness: 0.8 };
    // --- camera --- the cinematic camera (view transform, slow-motion clock, escape replay) of this loop
    const cam = new CinematicCamera();
    cinematicRef.current = cam;
    const captionLayer = new CaptionLayer(); // --- captions ---
    captionLayerRef.current = captionLayer;
    // --- boris-glass --- Glass Smash: the renderer's options, refreshed per frame.
    const glassRender: GlassRenderOptions = { wallColor: () => "#fff", wallThickness: 2, showGlow: false, stageLabel: DEFAULT_LABELS.glassStage!, homeLabel: DEFAULT_LABELS.glassHome! };
    // --- boris-multipliers --- the board / orbs / HUD renderer's options, refreshed per frame.
    const multRender: MultiplierRenderOptions = { wallColor: () => "#fff", wallThickness: 2, showWallGlow: true, showGlow: false, showTrails: true, rainbowBall: false, time: 0 };
    // --- obstacle-editor --- the editor obstacles' renderer options, refreshed per frame, and the layer that draws and edits them
    const obstacleRender: ObstacleRenderOptions = { wallColor: () => "#fff", wallThickness: 2, showWallGlow: true, gradient: false, editing: false };
    const obstacleLayer = (obstacleLayerRef.current ??= new ObstacleEditorLayer());
    // --- jdm-illusions --- the wobbly walls (contacts → displacement waves) and the Circle Illusion's layers, with their per-frame options
    const wobble = new WobbleLayer();
    const illusionLayer = new IllusionLayer();
    const illusionRender: IllusionRenderOptions = { wallColor: () => "#fff", rainbow: false, wallThickness: 2, showGlow: false, showTrails: true, trailThickness: 0.8, dpr, nowMs: 0 };
    const illusionLabels: IllusionLabels = { revealed: DEFAULT_LABELS.illusionRevealed!, painted: DEFAULT_LABELS.painted };
    /** Writes a data-* attribute only when it changed (the HUD state is mirrored onto the element for tools and tests). */
    const setCanvasData = (key: string, value: string) => {
      if (canvas.dataset[key] !== value) canvas.dataset[key] = value;
    };

    /*
     * Picture Paint layers, all in device pixels over the arena's bounding square: the picture cover-fitted
     * into the circle (`source`), its greyscale ghost, the brush mask the dabs are stamped into incrementally
     * (never redrawn from scratch) and the reveal (`source` through the mask), re-composited only when new
     * dabs arrived. Rebuilt when the picture or the arena size changes; cleared when the run restarts.
     */
    interface PaintLayers {
      image: HTMLImageElement;
      size: number;
      source: HTMLCanvasElement;
      ghost: HTMLCanvasElement;
      mask: HTMLCanvasElement;
      maskCtx: CanvasRenderingContext2D;
      reveal: HTMLCanvasElement;
      revealCtx: CanvasRenderingContext2D;
      /** Paint points already stamped into the mask. */
      stamped: number;
      /** The paint run the mask belongs to (`PicturePaintState.generation`). */
      generation: number;
      dirty: boolean;
    }
    let paintLayers: PaintLayers | null = null;
    const layerCanvas = (size: number) => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      return c;
    };
    const ensurePaintLayers = (image: HTMLImageElement, size: number): PaintLayers | null => {
      if (paintLayers && paintLayers.image === image && paintLayers.size === size) return paintLayers;
      const iw = image.naturalWidth || image.width;
      const ih = image.naturalHeight || image.height;
      if (!(iw > 0 && ih > 0)) return null;
      const source = layerCanvas(size);
      const ghost = layerCanvas(size);
      const mask = layerCanvas(size);
      const reveal = layerCanvas(size);
      const sctx = source.getContext("2d");
      const gctx = ghost.getContext("2d");
      const maskCtx = mask.getContext("2d");
      const revealCtx = reveal.getContext("2d");
      if (!sctx || !gctx || !maskCtx || !revealCtx) return null;
      // Cover-fit: the shorter side fills the diameter, centred, clipped to the circle.
      sctx.beginPath();
      sctx.arc(size / 2, size / 2, size / 2, 0, TWO_PI);
      sctx.clip();
      const fit = Math.max(size / iw, size / ih);
      sctx.drawImage(image, (size - iw * fit) / 2, (size - ih * fit) / 2, iw * fit, ih * fit);
      // The ghost of what is still hidden: greyscale, through the canvas filter where it exists and by hand elsewhere.
      if (typeof gctx.filter === "string") {
        gctx.filter = "grayscale(1)";
        gctx.drawImage(source, 0, 0);
        gctx.filter = "none";
      } else {
        gctx.drawImage(source, 0, 0);
        const data = gctx.getImageData(0, 0, size, size);
        const d = data.data;
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          d[i] = d[i + 1] = d[i + 2] = l;
        }
        gctx.putImageData(data, 0, 0);
      }
      maskCtx.fillStyle = "#ffffff";
      paintLayers = { image, size, source, ghost, mask, maskCtx, reveal, revealCtx, stamped: 0, generation: -1, dirty: true };
      return paintLayers;
    };
    /** Stamps the dabs recorded since the last frame into the mask – one path, one fill – in device pixels. */
    const stampPaintDabs = (layers: PaintLayers, points: PaintPoint[], originX: number, originY: number, scale: number) => {
      if (layers.stamped >= points.length) return;
      const m = layers.maskCtx;
      m.beginPath();
      for (let i = layers.stamped; i < points.length; i++) {
        const pt = points[i];
        const x = (pt.x - originX) * scale;
        const y = (pt.y - originY) * scale;
        const r = Math.max(0.5, pt.r * scale);
        m.moveTo(x + r, y);
        m.arc(x, y, r, 0, TWO_PI);
      }
      m.fill();
      layers.stamped = points.length;
      layers.dirty = true;
    };

    const withAlpha = (color: string, alpha: number) => {
      const key = `${color}_${alpha.toFixed(2)}`;
      const cached = alphaCache.get(key);
      if (cached) return cached;
      let out: string;
      if (color.startsWith("hsl")) out = color.replace(")", `, ${alpha})`).replace("hsl(", "hsla(");
      else {
        const { r, g, b } = hexToRgb(color);
        out = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
      if (alphaCache.size > 2000) alphaCache.clear();
      alphaCache.set(key, out);
      return out;
    };

    const draw = () => {
      const now = performance.now();
      if (now - lastFrameRef.current < 15) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastFrameRef.current = now;
      const frameMs = Math.min(now - lastTimeRef.current, 100);
      lastTimeRef.current = now;
      const p = propsRef.current;
      cam.settings = cameraRef.current; // --- camera ---

      if (!p.isPaused && p.isStarted) {
        accumulator += frameMs * p.simSpeed * cam.timeScale(); // --- camera: slow motion feeds the engine less time; its fixed steps stay the same
        if (accumulator > 250) accumulator = 250;
        while (accumulator >= 16.666) {
          engine.update(16.666, audioRef.current);
          cam.afterStep(engine); // --- camera: the escape replay's ring buffer
          accumulator -= 16.666;
        }
      }
      cam.frame(engine, frameMs, !p.isPaused && !!p.isStarted); // --- camera: shake on wall breaks, slow motion on near misses, the replay at the end
      elapsedRef.current += frameMs;
      const time = elapsedRef.current;
      // --- camera --- while the escape replay plays, the recorded walls and balls are drawn instead of the live ones;
      // with slow motion on, the balls and walls between the last two physics steps (a slowed clock runs a step only
      // every few frames, so the raw positions would stand still and jump)
      const replay = cam.replayView();
      const slow = replay ? null : cam.slowView(engine, accumulator / 16.666);
      const walls = replay ? replay.walls : slow ? slow.walls : engine.getCircularWalls();
      const rotations = replay ? replay.rotations : slow ? slow.rotations : engine.getWallRotations();
      const broken = replay ? replay.broken : engine.getBrokenWalls();
      const drawnBalls = replay ? replay.balls : slow ? slow.balls : engine.getBalls();
      const circleAlpha = (a: number) => {
        const { r, g, b } = circleRgbRef.current;
        return `rgba(${r}, ${g}, ${b}, ${a})`;
      };

      /** Colour for wall `index`, optionally with alpha and (for gradient mode) an angle. */
      const wallColor = (index: number, alpha?: number, angle?: number) => {
        if (!p.rainbowWalls) return alpha !== undefined ? circleAlpha(alpha) : p.circleColor;
        if (p.rainbowWallMode === "gradient" && angle !== undefined) {
          const hue = Math.floor((((0.03 * time) % 360) + (angle / TWO_PI) * 360) % 360);
          return alpha !== undefined ? `hsla(${hue}, 100%, 60%, ${alpha})` : `hsl(${hue}, 100%, 60%)`;
        }
        const hue = Math.floor((((0.05 * time) % 360) + (walls.length > 1 ? (index / walls.length) * 360 : 0)) % 360);
        return alpha !== undefined ? `hsla(${hue}, 100%, 60%, ${alpha})` : `hsl(${hue}, 100%, 60%)`;
      };

      // Background
      ctx.fillStyle = p.backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const size = sizeRef.current;
      // --- themes: a gradient or picture background over the solid fill (the reactive flashes below still land on top)
      const themeLook = themeLookRef.current;
      if (themeLook.backgroundType !== "solid") bgPainter().paint(ctx, size.width, size.height, backgroundLook(), dpr);
      setCanvasData("background", themeLook.backgroundType === "image" && !bgImageRef.current ? "solid" : themeLook.backgroundType);
      setCanvasData("particleStyle", engine.getParticleStyle());
      // --- end themes
      const cx = size.width / 2;
      const cy = size.height / 2;
      const arena = (Math.min(size.width, size.height) / 2) * 0.85;

      if (p.reactiveBackground) {
        const hits = engine.getWallHits();
        const obstacleHits = engine.getObstacleHits();
        const nowMs = Date.now();
        const maxR = 0.7 * Math.max(size.width, size.height);
        const hueBase = 0.05 * time;
        let drawn = 0;
        const flash = (angle: number, age: number) => {
          const alpha = (1 - age / 400) * 0.15;
          const hue = Math.floor(((180 * angle) / Math.PI + hueBase) % 360);
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
          grad.addColorStop(0, `hsla(${hue},100%,60%,${alpha.toFixed(3)})`);
          grad.addColorStop(0.5, `hsla(${hue},80%,40%,${(0.4 * alpha).toFixed(3)})`);
          grad.addColorStop(1, `hsla(${hue},60%,20%,0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, size.width, size.height);
        };
        for (let i = hits.length - 1; i >= 0 && drawn < 3; i--) {
          const hit = hits[i];
          const age = nowMs - hit.timestamp;
          if (age >= 400) continue;
          drawn++;
          flash(hit.angle, age);
        }
        // Obstacle hits (Ball Drop) flash too, coloured by where the contact sits around the centre.
        for (let i = obstacleHits.length - 1; i >= 0 && drawn < 3; i--) {
          const hit = obstacleHits[i];
          const age = nowMs - hit.timestamp;
          if (age >= 400) continue;
          drawn++;
          flash(Math.atan2(hit.y - cy, hit.x - cx), age);
        }
      }

      ctx.save();
      ctx.lineWidth = p.wallThickness;
      ctx.globalAlpha = 0.6;
      ctx.save();
      const isMult = engine.isMultipliersMode(); // --- boris-multipliers --- the board has its own scrolling camera (below)
      if (!isMult && cam.applyView(ctx, engine, p.cameraFollow, cx, cy, arena, Math.min(size.width, size.height), camXRef.current, camYRef.current)) {
        // --- camera --- zoom, shake or the replay own the view; the classic follow picks up from where it is
        camXRef.current = -cam.view.offsetX;
        camYRef.current = -cam.view.offsetY;
      } else if (p.cameraFollow && !isMult) {
        const balls = drawnBalls;
        if (balls.length > 0) {
          const b = balls[0];
          const limit = 0.5 * arena;
          const tx = Math.max(-limit, Math.min(limit, cx - b.x));
          const ty = Math.max(-limit, Math.min(limit, cy - b.y));
          camXRef.current += (tx - camXRef.current) * 0.08;
          camYRef.current += (ty - camYRef.current) * 0.08;
          ctx.translate(camXRef.current, camYRef.current);
        }
      } else {
        camXRef.current = 0;
        camYRef.current = 0;
        if (isMult) {
          // --- boris-multipliers --- no zoom or shake on the board: the view stays the board's own
          cam.view.offsetX = 0;
          cam.view.offsetY = 0;
          cam.view.scale = 1;
        }
      }
      // --- boris-glass --- Glass Smash scrolls the world down the shaft with its own camera: the view Camera Follow or the
      // cinematic camera set up above is dropped (back to the state saved before it, saved again for the camera restore).
      const glassView = engine.isGlassMode() ? engine.getGlassView() : null;
      if (glassView) {
        ctx.restore();
        ctx.save();
        applyGlassCamera(ctx, glassView);
      }
      // --- boris-multipliers --- the multipliers board scrolls down with its lowest ball (the mode's own, simulation-timed camera)
      const multBoard = isMult ? engine.getMultipliersView() : null;
      const multView = engine.getMultiplierView();
      const multLabels = (labelsRef.current ?? DEFAULT_LABELS).multipliers ?? DEFAULT_MULTIPLIER_LABELS;
      const multTop = multBoard ? multBoard.cameraY : 0;
      const multBottom = multTop + size.height;
      if (multBoard) ctx.translate(0, -multBoard.cameraY);
      // --- end boris-multipliers ---

      // --- jdm-illusions --- the Circle Illusion's view, and this frame's wobbly walls: new contacts, the simulation time, the amount
      const illusionView = engine.isIllusionMode() ? engine.getIllusionView() : null;
      wobble.beginFrame(engine.getWallContacts(), engine.getElapsedMs(), illusionView ? Math.max(wobbleAmountRef.current, illusionView.intrinsicWobble) : wobbleAmountRef.current);

      let conicCache: { time: number; alpha: number | undefined; gradient: CanvasGradient } | null = null;
      const conicGradient = (alpha?: number) => {
        if (conicCache && conicCache.time === time && conicCache.alpha === alpha) return conicCache.gradient;
        const g = ctx.createConicGradient(0, cx, cy);
        const base = (0.03 * time) % 360;
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          const hue = Math.floor((base + 360 * t) % 360);
          g.addColorStop(t, alpha !== undefined ? `hsla(${hue},100%,60%,${alpha})` : `hsl(${hue},100%,60%)`);
        }
        conicCache = { time, alpha, gradient: g };
        return g;
      };
      const strokeArc = (index: number, radius: number, from: number, to: number, alpha?: number) => {
        ctx.strokeStyle = p.rainbowWalls && p.rainbowWallMode === "gradient" ? conicGradient(alpha) : wallColor(index, alpha);
        if (wobble.strokeArc(ctx, index, cx, cy, radius, from, to)) return; // --- jdm-illusions --- a wobbling wall follows its displacement wave
        ctx.beginPath();
        ctx.arc(cx, cy, radius, from, to);
        ctx.stroke();
      };

      const isShatter = engine.isShatterMode();
      const shatterSegments = isShatter ? engine.getShatterSegments() : null;

      // Walls
      for (let i = 0; i < walls.length; i++) {
        if (broken.has(i)) continue;
        const wall = walls[i];
        const rot = rotations[i] || 0;
        if (isShatter && shatterSegments && shatterSegments[i]) {
          const thickness = Math.max(6, p.wallThickness + 4);
          for (const seg of shatterSegments[i]) {
            if (seg.hp <= 0) continue;
            const inset = (seg.endAngle - seg.startAngle) * 0.25;
            const a0 = seg.startAngle + rot + inset / 2;
            const a1 = seg.endAngle + rot - inset / 2;
            const mid = (a0 + a1) / 2;
            const rIn = wall.radius - thickness / 2;
            const rOut = wall.radius + thickness / 2;
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = wallColor(i, undefined, p.rainbowWalls && p.rainbowWallMode === "gradient" ? ((mid % TWO_PI) + TWO_PI) % TWO_PI : undefined);
            if (wobble.fillSector(ctx, i, cx, cy, rIn, rOut, a0, a1, wall.radius)) continue; // --- jdm-illusions ---
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a0) * rOut, cy + Math.sin(a0) * rOut);
            ctx.arc(cx, cy, rOut, a0, a1);
            ctx.lineTo(cx + Math.cos(a1) * rIn, cy + Math.sin(a1) * rIn);
            ctx.arc(cx, cy, rIn, a1, a0, true);
            ctx.closePath();
            ctx.fill();
          }
        } else {
          let cursor = 0;
          for (const gap of wall.gaps) {
            const start = gap.startAngle + rot;
            if (start > cursor + rot) strokeArc(i, wall.radius, cursor + rot, start);
            cursor = gap.endAngle;
          }
          if (cursor < TWO_PI) strokeArc(i, wall.radius, cursor + rot, TWO_PI + rot);
        }
      }
      ctx.globalAlpha = 1;

      // Obstacles (pegs, bars and straight walls – Ball Drop) in the wall colour; recent hits glow like the walls.
      const obstacles = engine.getObstacles();
      if (obstacles.length > 0) {
        const nowMs = Date.now();
        if (obstacleHitAges.length < obstacles.length) obstacleHitAges = new Float64Array(obstacles.length);
        obstacleHitAges.fill(Infinity, 0, obstacles.length);
        if (p.showWallGlow) {
          for (const hit of engine.getObstacleHits()) {
            const age = nowMs - hit.timestamp;
            if (hit.index < obstacles.length && age < obstacleHitAges[hit.index]) obstacleHitAges[hit.index] = age;
          }
        }
        const gradientHue = p.rainbowWalls && p.rainbowWallMode === "gradient";
        ctx.save();
        ctx.lineCap = "round";
        for (let i = 0; i < obstacles.length; i++) {
          const o = obstacles[i];
          const angle = gradientHue ? ((Math.atan2(o.y - cy, o.x - cx) % TWO_PI) + TWO_PI) % TWO_PI : undefined;
          const age = obstacleHitAges[i];
          const strength = age < 1000 ? 1 - (age / 1000) * (age / 1000) : 0;
          if (o.kind === "circle") {
            if (strength > 0.01) {
              for (const layer of GLOW_LAYERS) {
                ctx.globalAlpha = layer.alphaMult > 0.2 ? 0.85 : 0.5;
                ctx.fillStyle = wallColor(i, strength * layer.alphaMult, angle);
                ctx.beginPath();
                ctx.arc(o.x, o.y, o.radius + (2 + 2 * strength) * layer.widthMult, 0, TWO_PI);
                ctx.fill();
              }
            }
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = wallColor(i, undefined, angle);
            ctx.beginPath();
            ctx.arc(o.x, o.y, o.radius, 0, TWO_PI);
            ctx.fill();
          } else {
            segmentEndpoints(o, ends);
            const width = Math.max(o.thickness, p.wallThickness);
            if (strength > 0.01) {
              for (const layer of GLOW_LAYERS) {
                ctx.globalAlpha = layer.alphaMult > 0.2 ? 0.85 : 0.5;
                ctx.strokeStyle = wallColor(i, strength * layer.alphaMult, angle);
                ctx.lineWidth = width + (4 + 4 * strength) * layer.widthMult;
                ctx.beginPath();
                ctx.moveTo(ends.x1, ends.y1);
                ctx.lineTo(ends.x2, ends.y2);
                ctx.stroke();
              }
            }
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = wallColor(i, undefined, angle);
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(ends.x1, ends.y1);
            ctx.lineTo(ends.x2, ends.y2);
            ctx.stroke();
          }
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // --- obstacle-editor --- the creator's pegs, bumpers, blockers and spinners (ring modes), under the balls; editable while the run is not going
      const editorField = engine.getEditorObstacles();
      if (editorField) {
        obstacleRender.wallColor = wallColor;
        obstacleRender.wallThickness = p.wallThickness;
        obstacleRender.showWallGlow = p.showWallGlow;
        obstacleRender.gradient = p.rainbowWalls && p.rainbowWallMode === "gradient";
        obstacleRender.editing = obstacleEditingRef.current && !replay;
        obstacleLayer.draw(ctx, editorField, engine.getElapsedMs(), obstacleRender);
      }
      // --- end obstacle-editor ---

      // Bouncing Shapes: the box, its walls glowing on recent hits like the rings do.
      const isBox = engine.isBoxMode();
      if (isBox) {
        boxRender.wallColor = wallColor;
        boxRender.wallThickness = p.wallThickness;
        boxRender.showWallGlow = p.showWallGlow;
        boxRender.showGlow = p.showGlow;
        boxRender.showTrails = p.showTrails;
        boxRender.trailThickness = p.trailThickness;
        drawBoxArena(ctx, engine.getBoxView(), boxRender);
      }

      // Pendulum Wave: the fading trails under everything, then the rig (bar and pivots, ring, radial guides, rails or floor).
      const isPendulum = engine.isPendulumMode();
      if (isPendulum) {
        pendulumRender.wallColor = wallColor;
        pendulumRender.wallThickness = p.wallThickness;
        pendulumRender.showGlow = p.showGlow;
        const view = engine.getPendulumView();
        drawPendulumTrails(ctx, view, pendulumTrailPoint);
        drawPendulumRig(ctx, view, pendulumRender);
      }

      // --- jdm-polyrhythm --- Metronomes & Polyrhythms: the stage (rings / polygons, chords, semicircles, metronome bodies, spiral).
      const isPoly = engine.isPolyrhythmMode();
      if (isPoly) {
        polyRender.wallColor = wallColor;
        polyRender.wallThickness = p.wallThickness;
        polyRender.showGlow = p.showGlow;
        drawPolyrhythmStage(ctx, engine.getPolyrhythmView(), polyRender);
      }

      // --- jdm-collisions --- Collision Playground: the container (or the lollipop track), glowing after a hit.
      const isCollide = engine.isCollideMode();
      if (isCollide) {
        collideRender.wallColor = wallColor;
        collideRender.wallThickness = p.wallThickness;
        collideRender.showWallGlow = p.showWallGlow;
        collideRender.showGlow = p.showGlow;
        collideRender.showTrails = p.showTrails;
        collideRender.trailThickness = p.trailThickness;
        drawCollideArena(ctx, engine.getCollideView(), collideRender);
      }

      // --- jdm-illusions --- Circle Illusion: the big circle and its diameters, the rings, the nested circles, or the white arena and its paint.
      if (illusionView) {
        illusionRender.wallColor = wallColor;
        illusionRender.rainbow = p.rainbowWalls;
        illusionRender.wallThickness = p.wallThickness;
        illusionRender.showGlow = p.showGlow;
        illusionRender.showTrails = p.showTrails;
        illusionRender.trailThickness = p.trailThickness;
        illusionRender.nowMs = engine.getElapsedMs();
        illusionLayer.drawStage(ctx, illusionView, illusionRender, wobble);
      }

      // --- boris-glass --- Glass Smash: stage markers, panes, cracks and the HOME doorway under the ball.
      if (glassView) {
        const GL = labelsRef.current ?? DEFAULT_LABELS;
        glassRender.wallColor = wallColor;
        glassRender.wallThickness = p.wallThickness;
        glassRender.showGlow = p.showGlow;
        glassRender.stageLabel = GL.glassStage ?? DEFAULT_LABELS.glassStage!;
        glassRender.homeLabel = GL.glassHome ?? DEFAULT_LABELS.glassHome!;
        glassRender.multLabels = GL.multipliers ?? DEFAULT_MULTIPLIER_LABELS; // --- boris-multipliers --- the gate labels
        drawGlassWorld(ctx, glassView, glassRender, glassView.cameraY - 40, glassView.cameraY + size.height + 40);
      }
      // --- boris-multipliers --- the multipliers board (gates, pegs, bumpers, blockers, HOME) and the pickup orbs of the ring modes
      multRender.wallColor = wallColor;
      multRender.wallThickness = p.wallThickness;
      multRender.showWallGlow = p.showWallGlow;
      multRender.showGlow = p.showGlow;
      multRender.showTrails = p.showTrails;
      multRender.rainbowBall = p.rainbowBall;
      multRender.time = time;
      if (multBoard) drawMultipliersBoard(ctx, multBoard, multRender, multLabels, multTop, multBottom);
      if (multView.orbs.length > 0) drawPickupOrbs(ctx, multView, engine.getElapsedMs(), multLabels, time);

      // Color Match segments
      if (engine.isColorMatchMode()) {
        const segments = engine.getColorMatchSegments();
        if (walls.length > 0 && !broken.has(0)) {
          const rot = rotations[0] || 0;
          const radius = walls[0].radius;
          ctx.lineWidth = Math.max(10, p.wallThickness + 8);
          for (const seg of segments) {
            if (seg.broken) continue;
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = seg.color;
            if (wobble.strokeArc(ctx, 0, cx, cy, radius, seg.startAngle + rot + 0.005, seg.endAngle + rot - 0.005)) continue; // --- jdm-illusions ---
            ctx.beginPath();
            ctx.arc(cx, cy, radius, seg.startAngle + rot + 0.005, seg.endAngle + rot - 0.005);
            ctx.stroke();
          }
          ctx.save();
          ctx.globalAlpha = 0.4;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          for (const seg of segments) {
            if (seg.broken) continue;
            const a = seg.startAngle + rot;
            const r0 = radius - p.wallThickness / 2 - 4;
            const r1 = radius + p.wallThickness / 2 + 4;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
            ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
            ctx.stroke();
          }
          ctx.restore();
          ctx.globalAlpha = 1;
        }
      }

      // Paint: the rainbow trail – or, with a picture loaded, the picture revealed through the brush mask (Picture Paint)
      if (engine.isPaintMode()) {
        const points = engine.getPaintPoints();
        const balls = engine.getBalls();
        const radius = balls.length > 0 ? balls[0].radius : 8;
        const lineWidth = 2 * radius;
        const paint = engine.getPaintState();
        const picture = paint.picture ? paintImageRef.current : null;
        const baseRadii = engine.getWallBaseRadii();
        const R = baseRadii.length > 0 ? baseRadii[0] : walls.length > 0 ? walls[0].radius : arena;
        const layers = picture ? ensurePaintLayers(picture, Math.max(2, Math.round(2 * R * dpr))) : null;
        if (layers) {
          if (layers.generation !== paint.generation) {
            layers.maskCtx.clearRect(0, 0, layers.size, layers.size);
            layers.stamped = 0;
            layers.dirty = true;
            layers.generation = paint.generation;
          }
          stampPaintDabs(layers, points, cx - R, cy - R, dpr);
          if (layers.dirty) {
            const rc = layers.revealCtx;
            rc.globalCompositeOperation = "source-over";
            rc.clearRect(0, 0, layers.size, layers.size);
            rc.drawImage(layers.source, 0, 0);
            rc.globalCompositeOperation = "destination-in";
            rc.drawImage(layers.mask, 0, 0);
            rc.globalCompositeOperation = "source-over";
            layers.dirty = false;
          }
          const x0 = cx - R;
          const y0 = cy - R;
          if (paint.coverage >= COVERAGE_DONE) {
            // Finished: the whole picture, crisp, until the end screen takes over.
            ctx.drawImage(layers.source, x0, y0, 2 * R, 2 * R);
          } else {
            if (p.paintGhost > 0) {
              ctx.globalAlpha = p.paintGhost;
              ctx.drawImage(layers.ghost, x0, y0, 2 * R, 2 * R);
              ctx.globalAlpha = 1;
            }
            ctx.drawImage(layers.reveal, x0, y0, 2 * R, 2 * R);
          }
        } else if (points.length > 0) {
          ctx.globalAlpha = 0.75;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.lineWidth = lineWidth;
          const maxJump = 3 * lineWidth;
          const maxJump2 = maxJump * maxJump;
          let i = 0;
          while (i < points.length) {
            const start = points[i];
            ctx.strokeStyle = start.color;
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            let j = i + 1;
            while (j < points.length) {
              const prev = points[j - 1];
              const cur = points[j];
              const dx = cur.x - prev.x;
              const dy = cur.y - prev.y;
              if (dx * dx + dy * dy > maxJump2) break;
              if (cur.color !== prev.color) {
                ctx.lineTo(cur.x, cur.y);
                ctx.stroke();
                ctx.strokeStyle = cur.color;
                ctx.beginPath();
                ctx.moveTo(cur.x, cur.y);
              } else ctx.lineTo(cur.x, cur.y);
              j++;
            }
            ctx.stroke();
            i = j;
          }
          const last = points[points.length - 1];
          ctx.fillStyle = last.color;
          ctx.beginPath();
          ctx.arc(last.x, last.y, radius, 0, TWO_PI);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // Target segments
      if (engine.isCountdownMode()) {
        const total = engine.getCountdownTotal();
        const target = engine.getCountdownTarget();
        const hit = engine.getCountdownHit();
        const flashes = engine.getCountdownWrongFlashes();
        const map = engine.getCountdownSegmentMap();
        const wall = walls[0];
        if (wall) {
          const step = TWO_PI / total;
          const radius = wall.radius;
          const thickness = Math.max(8, 0.06 * radius);
          const labelR = radius + Math.max(12, 0.08 * radius);
          const fontSize = Math.max(10, 0.03 * Math.min(size.width, size.height));
          const startAngle = -Math.PI / 2;
          const flashBySegment: Record<number, number> = {};
          for (const f of flashes) {
            const t = Math.min(1, Math.max(0, f.time / 400));
            if (flashBySegment[f.segment] === undefined || t > flashBySegment[f.segment]) flashBySegment[f.segment] = t;
          }
          const pulse = 0.5 + 0.3 * Math.sin(0.005 * time);
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          for (let s = 0; s < total; s++) {
            const number = map[s] ?? total - s;
            const a0 = startAngle + s * step;
            const a1 = a0 + step;
            const mid = (a0 + a1) / 2;
            const flash = flashBySegment[number];
            let color: string, alpha: number, shadow: string, blur: number;
            if (hit.has(number)) [color, alpha, shadow, blur] = ["#22c55e", 0.7, "#22c55e", 12];
            else if (number === target) [color, alpha, shadow, blur] = ["#facc15", pulse, "#facc15", 12];
            else if (flash !== undefined) [color, alpha, shadow, blur] = ["#ef4444", 0.3 + 0.6 * flash, "#ef4444", 12 * flash];
            else [color, alpha, shadow, blur] = ["#333333", 0.4, "", 0];
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = color;
            ctx.lineWidth = thickness;
            if (shadow) {
              ctx.shadowColor = shadow;
              ctx.shadowBlur = blur;
            }
            ctx.beginPath();
            wobble.pathArc(ctx, 0, cx, cy, radius, a0 + 0.02, a1 - 0.02); // --- jdm-illusions --- (the segments follow a wobbling wall)
            ctx.stroke();
            ctx.restore();
            const lx = cx + labelR * Math.cos(mid);
            const ly = cy + labelR * Math.sin(mid);
            ctx.save();
            if (hit.has(number)) {
              ctx.fillStyle = "#22c55e";
              ctx.globalAlpha = 0.9;
            } else if (number === target) {
              ctx.fillStyle = "#facc15";
              ctx.globalAlpha = 1;
              ctx.shadowColor = "#facc15";
              ctx.shadowBlur = 8;
            } else {
              ctx.fillStyle = "#666666";
              ctx.globalAlpha = 0.6;
            }
            ctx.fillText(String(number), lx, ly);
            ctx.restore();
          }
          ctx.save();
          ctx.strokeStyle = "#555555";
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.3;
          const rIn = radius - thickness / 2;
          const rOut = radius + thickness / 2;
          for (let s = 0; s < total; s++) {
            const a = startAngle + s * step;
            ctx.beginPath();
            ctx.moveTo(cx + rIn * Math.cos(a), cy + rIn * Math.sin(a));
            ctx.lineTo(cx + rOut * Math.cos(a), cy + rOut * Math.sin(a));
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // Portals
      if (engine.isPortalMode()) {
        const portals = engine.getPortals();
        const wall = walls[0];
        if (wall && !broken.has(0)) {
          for (const portal of portals) {
            if (portal.exhausted) continue;
            const drawPortal = (angle: number) => {
              const a0 = angle - portal.halfWidth;
              const a1 = angle + portal.halfWidth;
              ctx.save();
              ctx.lineWidth = Math.max(6, 0.04 * wall.radius);
              ctx.strokeStyle = portal.color;
              ctx.shadowColor = portal.color;
              ctx.shadowBlur = 16;
              ctx.globalAlpha = 0.85;
              ctx.beginPath();
              ctx.arc(cx, cy, wall.radius, a0, a1);
              ctx.stroke();
              ctx.lineWidth = Math.max(3, 0.02 * wall.radius);
              ctx.globalAlpha = 0.4;
              ctx.beginPath();
              ctx.arc(cx, cy, wall.radius - Math.max(4, 0.025 * wall.radius), a0, a1);
              ctx.stroke();
              ctx.restore();
              const px = cx + wall.radius * Math.cos(angle);
              const py = cy + wall.radius * Math.sin(angle);
              ctx.save();
              ctx.fillStyle = portal.color;
              ctx.shadowColor = portal.color;
              ctx.shadowBlur = 10;
              ctx.globalAlpha = 0.9;
              ctx.translate(px, py);
              ctx.rotate(angle);
              const d = Math.max(4, 0.025 * wall.radius);
              ctx.beginPath();
              ctx.moveTo(0, -d);
              ctx.lineTo(d, 0);
              ctx.lineTo(0, d);
              ctx.lineTo(-d, 0);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            };
            drawPortal(portal.angleA);
            drawPortal(portal.angleB);
            const r = 0.92 * wall.radius;
            ctx.save();
            ctx.strokeStyle = portal.color;
            ctx.globalAlpha = 0.15;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 6]);
            ctx.beginPath();
            ctx.moveTo(cx + r * Math.cos(portal.angleA), cy + r * Math.sin(portal.angleA));
            ctx.lineTo(cx + r * Math.cos(portal.angleB), cy + r * Math.sin(portal.angleB));
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }
        }
      }

      // Spikes
      if (engine.isAccumulationMode() && engine.getSpikesEnabled()) {
        const angles = engine.getSpikeAngles();
        const length = engine.getSpikeLength();
        const wall = walls[0];
        const rot = rotations[0] || 0;
        if (wall && !broken.has(0) && angles.length > 0) {
          ctx.fillStyle = "#FF4444";
          ctx.globalAlpha = 0.85;
          for (const a of angles) {
            const t = a + rot;
            const outer = wall.radius;
            const inner = outer - length;
            ctx.beginPath();
            ctx.moveTo(cx + outer * Math.cos(t - 0.06), cy + outer * Math.sin(t - 0.06));
            ctx.lineTo(cx + outer * Math.cos(t + 0.06), cy + outer * Math.sin(t + 0.06));
            ctx.lineTo(cx + inner * Math.cos(t), cy + inner * Math.sin(t));
            ctx.closePath();
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }

      // Wall glow on recent hits
      if (p.showWallGlow) {
        const hits = engine.getWallHits();
        const nowMs = Date.now();
        const latest: Record<number, number> = {};
        for (const h of hits) if (latest[h.wallIndex] === undefined || h.timestamp > latest[h.wallIndex]) latest[h.wallIndex] = h.timestamp;
        for (const key of Object.keys(latest)) {
          const wi = Number(key);
          const age = nowMs - latest[wi];
          if (age >= 1000) continue;
          const t = age / 1000;
          const strength = 1 - t * t;
          if (strength < 0.01 || wi >= walls.length || broken.has(wi)) continue;
          const wall = walls[wi];
          const rot = rotations[wi];
          if (isShatter && shatterSegments && shatterSegments[wi]) {
            const thickness = Math.max(6, p.wallThickness + 4);
            const arcs: { sA: number; eA: number }[] = [];
            for (const seg of shatterSegments[wi]) {
              if (seg.hp <= 0) continue;
              const inset = (seg.endAngle - seg.startAngle) * 0.25;
              arcs.push({ sA: seg.startAngle + rot + inset / 2, eA: seg.endAngle + rot - inset / 2 });
            }
            if (arcs.length === 0) continue;
            for (const layer of GLOW_LAYERS) {
              const alpha = strength * layer.alphaMult;
              ctx.fillStyle = p.rainbowWalls ? (p.rainbowWallMode === "gradient" ? conicGradient(alpha) : wallColor(wi, alpha)) : circleAlpha(alpha);
              ctx.globalAlpha = layer.alphaMult > 0.2 ? 0.85 : 0.5;
              for (const arc of arcs) {
                const rIn = wall.radius - (thickness / 2) * layer.widthMult - 1;
                const rOut = wall.radius + (thickness / 2) * layer.widthMult + 1;
                if (wobble.fillSector(ctx, wi, cx, cy, rIn, rOut, arc.sA, arc.eA, wall.radius)) continue; // --- jdm-illusions ---
                ctx.beginPath();
                ctx.arc(cx, cy, rOut, arc.sA, arc.eA);
                ctx.arc(cx, cy, rIn, arc.eA, arc.sA, true);
                ctx.closePath();
                ctx.fill();
              }
            }
            ctx.globalAlpha = 1;
          } else {
            const arcs: { start: number; end: number }[] = [];
            let cursor = 0;
            for (const gap of wall.gaps) {
              const start = gap.startAngle + rot;
              if (start > cursor + rot) arcs.push({ start: cursor + rot, end: start });
              cursor = gap.endAngle;
            }
            if (cursor < TWO_PI) arcs.push({ start: cursor + rot, end: TWO_PI + rot });
            for (const layer of GLOW_LAYERS) {
              ctx.lineWidth = (4 + 4 * strength) * layer.widthMult;
              const alpha = strength * layer.alphaMult;
              ctx.strokeStyle = p.rainbowWalls ? (p.rainbowWallMode === "gradient" ? conicGradient(alpha) : wallColor(wi, alpha)) : circleAlpha(alpha);
              ctx.globalAlpha = layer.alphaMult > 0.2 ? 0.85 : 0.5;
              for (const arc of arcs) {
                if (wobble.strokeArc(ctx, wi, cx, cy, wall.radius, arc.start, arc.end)) continue; // --- jdm-illusions ---
                ctx.beginPath();
                ctx.arc(cx, cy, wall.radius, arc.start, arc.end);
                ctx.stroke();
              }
            }
            ctx.globalAlpha = 1;
          }
        }
      }

      // Lines mode strings
      const drawStrings = (points: { x: number; y: number }[]) => {
        const balls = drawnBalls; // --- camera: the strings end at the ball where it is drawn (replayed or between steps)
        const ball = balls.length > 0 ? balls[0] : null;
        const colorAt = (i: number) => {
          if (!p.rainbowLines) return p.lineColor;
          const base = (0.03 * time) % 360;
          const spread = points.length > 1 ? (i / points.length) * 360 : 0;
          return `hsl(${(base + spread) % 360}, 100%, 60%)`;
        };
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const color = colorAt(i);
          if (ball) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.moveTo(pt.x, pt.y);
            ctx.lineTo(ball.x, ball.y);
            ctx.stroke();
          }
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.5, 0, TWO_PI);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      };
      if (engine.isLinesMode()) drawStrings(engine.getBouncePoints());

      // Frozen balls (Accumulation)
      if (engine.isAccumulationMode()) {
        for (const f of engine.getFrozenBalls()) {
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = f.color;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.radius, 0, TWO_PI);
          ctx.fill();
          ctx.strokeStyle = "rgba(150, 200, 255, 0.5)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // Center dot (Grow / Lines) and Grow strings
      const isGrow = engine.isGrowMode();
      const isLines = engine.isLinesMode();
      if (isGrow || isLines) {
        const state = isGrow ? engine.getGrowState() : engine.getLinesState();
        if (state.centerDotEnabled) {
          const r = state.centerDotRadius;
          ctx.save();
          ctx.shadowColor = "#ffffff";
          ctx.shadowBlur = 12;
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, TWO_PI);
          ctx.fill();
          const grad = ctx.createRadialGradient(cx - 0.3 * r, cy - 0.3 * r, 0, cx, cy, r);
          grad.addColorStop(0, "rgba(255,255,255,0.6)");
          grad.addColorStop(0.5, "rgba(255,255,255,0.1)");
          grad.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, TWO_PI);
          ctx.fill();
          ctx.restore();
        }
        if (isGrow && engine.getGrowState().linesEnabled) drawStrings(engine.getGrowBouncePoints());
      }

      // Balls
      const balls = drawnBalls; // --- camera: the replayed balls and trails during the escape replay, or the balls between steps in slow motion
      const isColorMatch = engine.isColorMatchMode();
      const matchColor = isColorMatch ? engine.getColorMatchBallColor() : null;
      const rainbowColors: string[] = [];
      if (p.rainbowBall && !isColorMatch) {
        const base = (0.08 * time) % 360;
        for (let i = 0; i < balls.length; i++) {
          rainbowColors.push(`hsl(${Math.floor((base + (balls.length > 1 ? (i / balls.length) * 360 : 0)) % 360)}, 100%, 55%)`);
        }
      }
      const personality = engine.getPersonalityState();
      // Picture Paint: the beat envelope scales the glow and draws a pulse ring around the ball.
      const paintBeat = engine.isPaintMode() ? engine.getPaintState() : null;
      const beatEnvelope = paintBeat && paintBeat.beatActive ? paintBeat.envelope : 1;
      // --- boris-faces --- advance the characters on the simulation clock; a cat face may chirp
      const chirp = faces.beginFrame(engine, characterRef.current, { started: p.isStarted });
      if (chirp) chirpRef.current?.(chirp);
      const hasSprite = !!emojiCanvasRef.current || (imageLoadedRef.current && !!imageRef.current);
      teamLayer.beginFrame(engine, teamsRef.current); // --- teams ---
      const customImage = imageLoadedRef.current && !!imageRef.current; // --- teams --- a custom picture beats the team emoji
      // Bouncing Shapes draws its own squares / circles / plates (with countdown numbers) instead of the balls.
      if (isBox) drawBoxShapes(ctx, balls, engine.getBoxView(), boxRender);
      else if (isPendulum) drawPendulumBobs(ctx, balls, engine.getPendulumView(), pendulumRender);
      else if (isPoly) drawPolyrhythmVoices(ctx, engine.getPolyrhythmView(), polyRender); // --- jdm-polyrhythm ---
      // --- jdm-collisions --- Collision Playground: hundreds of orbs (or lollipops) batched by colour.
      else if (isCollide) drawCollideBodies(ctx, balls, engine.getCollideView(), collideRender);
      else if (isMult) drawMultipliersBalls(ctx, balls, multRender, multTop, multBottom); // --- boris-multipliers --- hundreds of balls, batched
      else if (illusionView) illusionLayer.drawBodies(ctx, balls, illusionView, illusionRender, wobble); // --- jdm-illusions --- balls, the innermost circle, painters
      else balls.forEach((ball, index) => {
        // --- teams --- a team ball wears its team colour (Color Match keeps the colour to match) and its emoji
        const teamColor = isColorMatch ? null : teamLayer.colorOf(ball);
        const teamSprite = isColorMatch || customImage ? null : teamLayer.spriteOf(ball);
        const color = isColorMatch && matchColor ? matchColor : teamColor ?? (p.rainbowBall ? rainbowColors[index] : ball.color);
        // Trail
        if (p.showTrails && index < 30 && ball.trail.length > 1) {
          const intensity = personality.trailIntensity;
          const len = ball.trail.length;
          const at = (i: number) => ball.trail[(ball.trailIndex + i) % len];
          const themedTrail = p.colorTrail ? trailColorTable(themeLookRef.current.trailColors) : null; // --- themes: a theme's trail colours replace the rainbow hues
          if (themedTrail) drawThemedTrail(ctx, ball, themedTrail, p.trailThickness, time, index, intensity); // --- themes
          else if (p.colorTrail) {
            for (let i = 1; i < len; i++) {
              const t = i / len;
              const hue = Math.floor((0.1 * time + 15 * i + 60 * index) % 360);
              const alpha = Math.min(1, (0.1 + 0.5 * t) * intensity);
              ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${alpha})`;
              ctx.lineWidth = ball.radius * p.trailThickness * (0.3 + 0.7 * t);
              ctx.beginPath();
              ctx.moveTo(at(i - 1).x, at(i - 1).y);
              ctx.lineTo(at(i).x, at(i).y);
              ctx.stroke();
            }
          } else {
            ctx.strokeStyle = color;
            ctx.lineWidth = ball.radius * p.trailThickness;
            ctx.globalAlpha = Math.min(1, 0.3 * intensity);
            ctx.beginPath();
            ctx.moveTo(at(0).x, at(0).y);
            for (let i = 1; i < len; i++) ctx.lineTo(at(i).x, at(i).y);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
        // Glow
        if (p.showGlow) {
          const pulse = 1 + 0.15 * Math.sin(time * personality.glowPulseRate * 0.001 * TWO_PI) * personality.glowScale;
          const scale = personality.glowScale * pulse;
          const glowR = 2 * ball.radius * scale * beatEnvelope;
          const r = Math.round(ball.radius);
          const key = `${color}_${r}`;
          if (p.rainbowBall || isColorMatch) {
            const grad = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, glowR);
            grad.addColorStop(0, color);
            grad.addColorStop(0.5, withAlpha(color, 0.27));
            grad.addColorStop(1, withAlpha(color, 0));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, glowR, 0, TWO_PI);
            ctx.fill();
          } else {
            let sprite = glowSpriteCache.get(key);
            if (!sprite) {
              sprite = document.createElement("canvas");
              sprite.width = 4 * r;
              sprite.height = 4 * r;
              const g = sprite.getContext("2d")!;
              const grad = g.createRadialGradient(2 * r, 2 * r, 0, 2 * r, 2 * r, 2 * r);
              grad.addColorStop(0, color);
              grad.addColorStop(0.5, withAlpha(color, 0.27));
              grad.addColorStop(1, withAlpha(color, 0));
              g.fillStyle = grad;
              g.beginPath();
              g.arc(2 * r, 2 * r, 2 * r, 0, TWO_PI);
              g.fill();
              if (glowSpriteCache.size > 1000) glowSpriteCache.clear();
              glowSpriteCache.set(key, sprite);
            }
            ctx.drawImage(sprite, ball.x - glowR, ball.y - glowR, 2 * glowR, 2 * glowR);
          }
        }
        const fading = ball.lifetime !== undefined && ball.lifetime < 1000;
        if (fading) {
          ctx.save();
          ctx.globalAlpha = ball.lifetime! / 1000;
        }
        // --- boris-faces --- squash-and-stretch around the body, the cat's ears behind it
        const squashed = faces.pushSquash(ctx, ball);
        faces.drawBehind(ctx, ball, color, hasSprite || !!teamSprite, index);
        // Body: emoji, image or shaded disc
        if (teamSprite) {
          // --- teams --- the team's emoji, turned by the spin like the custom emoji
          ctx.save();
          ctx.translate(ball.x, ball.y);
          if (ball.angle !== 0) ctx.rotate(ball.angle);
          ctx.beginPath();
          ctx.arc(0, 0, ball.radius, 0, TWO_PI);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(teamSprite, -ball.radius, -ball.radius, 2 * ball.radius, 2 * ball.radius);
          ctx.restore();
        } else if (emojiCanvasRef.current) {
          ctx.save();
          ctx.translate(ball.x, ball.y);
          if (ball.angle !== 0) ctx.rotate(ball.angle); // the "spin" physics extra turns the sprite
          ctx.beginPath();
          ctx.arc(0, 0, ball.radius, 0, TWO_PI);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(emojiCanvasRef.current, -ball.radius, -ball.radius, 2 * ball.radius, 2 * ball.radius);
          ctx.restore();
        } else if (imageLoadedRef.current && imageRef.current) {
          ctx.save();
          ctx.translate(ball.x, ball.y);
          if (ball.angle !== 0) ctx.rotate(ball.angle); // the "spin" physics extra turns the sprite
          ctx.beginPath();
          ctx.arc(0, 0, ball.radius, 0, TWO_PI);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(imageRef.current, -ball.radius, -ball.radius, 2 * ball.radius, 2 * ball.radius);
          ctx.restore();
        } else {
          const r = Math.round(ball.radius);
          const key = `${color}_${r}`;
          if (p.rainbowBall || isColorMatch) {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ball.radius, 0, TWO_PI);
            ctx.fill();
            const hl = ctx.createRadialGradient(ball.x - 0.3 * ball.radius, ball.y - 0.3 * ball.radius, 0, ball.x - 0.3 * ball.radius, ball.y - 0.3 * ball.radius, ball.radius);
            hl.addColorStop(0, "rgba(255, 255, 255, 0.5)");
            hl.addColorStop(0.5, "rgba(255, 255, 255, 0.1)");
            hl.addColorStop(1, "rgba(255, 255, 255, 0)");
            ctx.fillStyle = hl;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ball.radius, 0, TWO_PI);
            ctx.fill();
          } else {
            let sprite = ballSpriteCache.get(key);
            if (!sprite) {
              sprite = document.createElement("canvas");
              sprite.width = 2 * r;
              sprite.height = 2 * r;
              const g = sprite.getContext("2d")!;
              g.fillStyle = color;
              g.beginPath();
              g.arc(r, r, r, 0, TWO_PI);
              g.fill();
              const hl = g.createRadialGradient(0.7 * r, 0.7 * r, 0, 0.7 * r, 0.7 * r, r);
              hl.addColorStop(0, "rgba(255, 255, 255, 0.5)");
              hl.addColorStop(0.5, "rgba(255, 255, 255, 0.1)");
              hl.addColorStop(1, "rgba(255, 255, 255, 0)");
              g.fillStyle = hl;
              g.beginPath();
              g.arc(r, r, r, 0, TWO_PI);
              g.fill();
              if (ballSpriteCache.size > 1000) ballSpriteCache.clear();
              ballSpriteCache.set(key, sprite);
            }
            ctx.drawImage(sprite, ball.x - ball.radius, ball.y - ball.radius, 2 * ball.radius, 2 * ball.radius);
          }
        }
        // --- boris-faces --- the face on the body (squashed with it), then the name label under the ball
        faces.drawFront(ctx, ball, color, hasSprite || !!teamSprite, index);
        if (squashed) ctx.restore();
        faces.drawLabel(ctx, ball, index);
        // --- teams --- a ring in the team colour where the body does not wear it, and the team's name above its first ball
        if (teamLayer.isActive()) teamLayer.drawBallExtras(ctx, ball, !isColorMatch && !teamSprite && !hasSprite, !!teamSprite);
        // Personality ring (tension indicator)
        if (personality.state !== "calm" && !emojiCanvasRef.current) {
          const hue =
            personality.state === "aggressive" ? 10 : personality.state === "chaotic" ? 280 : personality.state === "unstable" ? 45 : personality.state === "overcharged" ? 55 : 200;
          const alpha = 0.3 + 0.5 * personality.tension;
          const pulse = 1 + 0.3 * Math.sin(time * personality.glowPulseRate * 0.001 * TWO_PI);
          ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${alpha})`;
          ctx.lineWidth = 1.5 + personality.tension;
          ctx.beginPath();
          ctx.arc(ball.x, ball.y, ball.radius + 2 * pulse, 0, TWO_PI);
          ctx.stroke();
        }
        if (paintBeat && paintBeat.beatActive && paintBeat.pulse > 0.02) {
          ctx.strokeStyle = withAlpha(ACCENT, 0.15 + 0.6 * paintBeat.pulse);
          ctx.lineWidth = 1.5 + 2 * paintBeat.pulse;
          ctx.beginPath();
          ctx.arc(ball.x, ball.y, ball.radius * (1.3 + 0.9 * paintBeat.pulse) + 2, 0, TWO_PI);
          ctx.stroke();
        }
        if (fading) ctx.restore();
        ctx.globalAlpha = 1;
      });
      // --- boris-faces --- faces on the shapes / bobs / voices / orbs the Bouncing Shapes, Pendulum Wave, Metronomes &
      // Polyrhythms and Collision Playground renderers drew (the ball colour is the body colour of all but the shapes)
      if (faces.isActive() && (isBox || isPendulum || isPoly || isCollide || isMult)) {
        const boxView: BoxView | null = isBox ? engine.getBoxView() : null;
        faces.drawOverlays(ctx, balls, isBox ? boxBodyColor : bobBodyColor, boxView ? { shape: boxView.shape, countdown: boxView.countdown > 0 } : null);
      }
      // --- jdm-illusions --- faces on the Circle Illusion's balls (on the innermost of the nested circles)
      if (faces.isActive() && illusionView) faces.drawOverlays(ctx, illusionLayer.faceBalls(balls, illusionView), bobBodyColor, null);

      // --- boris-glass --- the shards of shattered panes fly over the ball.
      if (glassView) drawGlassShards(ctx, glassView, glassView.cameraY - 40, glassView.cameraY + size.height + 40);

      // Wall-break flashes and shockwaves
      for (const flash of engine.getWallBreakFlashes()) {
        const a = (flash.life / flash.maxLife) * 0.6;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 8 * (flash.life / flash.maxLife);
        ctx.shadowColor = "#FFFFFF";
        ctx.shadowBlur = 30 * a;
        ctx.beginPath();
        ctx.arc(cx, cy, flash.wallRadius, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
      }
      for (const wave of engine.getShockwaves()) {
        const a = (wave.life / wave.maxLife) * 0.5;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = wave.color;
        ctx.lineWidth = 2 + 3 * (wave.life / wave.maxLife);
        ctx.shadowColor = wave.color;
        ctx.shadowBlur = 15 * a;
        ctx.beginPath();
        ctx.arc(wave.x, wave.y, wave.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
      }
      // Particles
      for (const part of engine.getParticles()) {
        ctx.save();
        ctx.translate(part.x, part.y);
        ctx.rotate(part.rotation);
        const life = part.life / part.maxLife;
        ctx.globalAlpha = life;
        // --- themes: sparks, petals, pixels and bubbles draw themselves (themeRenderer.ts)
        if (part.style !== undefined) {
          drawStyledParticle(ctx, part, life);
          ctx.restore();
          continue;
        }
        // --- end themes
        if (part.type === "shard") {
          ctx.fillStyle = part.color;
          if (life > 0.3) {
            ctx.shadowColor = "#88CCFF";
            ctx.shadowBlur = 3;
          }
          const s = part.size;
          ctx.beginPath();
          ctx.moveTo(-0.5 * s, -0.2 * s);
          ctx.lineTo(0.1 * s, -0.5 * s);
          ctx.lineTo(0.5 * s, 0.1 * s);
          ctx.lineTo(0.2 * s, 0.4 * s);
          ctx.lineTo(-0.3 * s, 0.3 * s);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 0.5;
          ctx.stroke();
        } else if (part.type === "spark") {
          ctx.fillStyle = "#FFFFFF";
          ctx.shadowColor = "#FFFFFF";
          ctx.shadowBlur = 4;
          ctx.beginPath();
          ctx.arc(0, 0, part.size, 0, TWO_PI);
          ctx.fill();
        } else if (part.type === "burst") {
          // Merge / split bursts: glowing dots in the ball's own colour
          ctx.fillStyle = part.color;
          ctx.shadowColor = part.color;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(0, 0, part.size, 0, TWO_PI);
          ctx.fill();
        } else {
          ctx.fillStyle = part.color;
          ctx.fillRect(-part.size / 2, -part.size / 4, part.size, part.size / 2);
          if (life > 0.6) {
            ctx.shadowColor = part.color;
            ctx.shadowBlur = 4;
          }
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.restore(); // camera

      // Bouncing Shapes: a DVD logo in a corner lights up the whole frame (screen space, part of the recording).
      if (isBox) drawBoxCornerFlash(ctx, size.width, size.height, engine.getBoxView());
      // Pendulum Wave: a big chord (most of the row in line) lights up the frame too.
      if (isPendulum) drawPendulumChordFlash(ctx, size.width, size.height, engine.getPendulumView());
      // --- jdm-polyrhythm --- every voice ticking at once lights up the frame.
      if (isPoly) drawPolyrhythmAlignFlash(ctx, size.width, size.height, engine.getPolyrhythmView());
      // --- jdm-collisions --- Collision Playground: the flash and caption of the anti-collision switch.
      if (isCollide) drawCollideOverlay(ctx, size.width, size.height, engine.getCollideView(), (labelsRef.current ?? DEFAULT_LABELS).collideAnti ?? DEFAULT_LABELS.collideAnti ?? "");
      // --- boris-glass --- Glass Smash: the stage dots and the "STAGE n" banner (screen space, part of the recording).
      if (glassView) drawGlassOverlay(ctx, glassView, glassRender);
      // --- jdm-illusions --- Circle Illusion: the alignment / reveal flash, the paint counter and "REVEALED!" (screen space, part of the recording).
      if (illusionView) {
        const IL = labelsRef.current ?? DEFAULT_LABELS;
        illusionLabels.revealed = IL.illusionRevealed ?? DEFAULT_LABELS.illusionRevealed!;
        illusionLabels.painted = IL.painted;
        illusionLayer.drawOverlay(ctx, size.width, size.height, illusionView, engine.getElapsedMs(), illusionLabels);
      }
      // --- teams --- live, a canvas about as wide as it is tall has the page's Restart / Pause buttons over its top corners:
      // the scoreboard moves below them (the multipliers HUD, drawn before it, keeps clear of where it will be)
      const teamInset = !recordingRef.current && (size.width - Math.min(size.width, size.height)) / 2 < 170 ? 52 : 0;
      // --- boris-multipliers --- stat badges, SLOW-MO and the HOME counter, inside the square the recorder crops to (so exports
      // have them), clear of the teams' scoreboard in a top corner of the same square
      multHudTop = -1;
      if (multView.active) {
        const sq = Math.min(size.width, size.height);
        const avoid = teamLayer.isActive() && teamLayer.scoreboardRect(ctx, size.width, size.height, teamInset, scoreboardBox) ? scoreboardBox : null;
        multHudTop = drawMultiplierHud(ctx, multView, multLabels, cx - sq / 2, cy - sq / 2, sq, engine.getElapsedMs(), multBoard, avoid);
      }

      // HUD: mode counters in the centre
      {
        const L = labelsRef.current ?? DEFAULT_LABELS;
        const minDim = Math.min(size.width, size.height);
        const blocks: { height: number; draw: (y: number) => void }[] = [];
        const bigBanner = (text: string, sub: string, color: string) => {
          const fs = Math.max(24, 0.08 * minDim);
          const sfs = 0.4 * fs;
          blocks.push({
            height: fs + 1.2 * sfs,
            draw: (y) => {
              ctx.save();
              ctx.font = `bold ${fs}px sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillStyle = color;
              ctx.shadowColor = color;
              ctx.shadowBlur = 20;
              ctx.fillText(text, cx, y + 0.5 * fs);
              ctx.shadowBlur = 0;
              ctx.font = `${sfs}px sans-serif`;
              ctx.fillStyle = "#aaa";
              ctx.fillText(sub, cx, y + fs + 0.6 * sfs);
              ctx.restore();
            },
          });
        };
        if (engine.isAccumulationMode()) {
          const frozen = engine.getFrozenBalls().length;
          if (engine.hasAccumulationEscaped()) bigBanner(L.escaped, L.afterFrozenBalls(frozen), "#4ECDC4");
          else {
            const timer = engine.getAccumulationTimer();
            const max = engine.getAccumulationTimerMax();
            const seconds = Math.max(0, timer / 1000);
            const ratio = Math.max(0, timer / max);
            const fs = Math.max(18, 0.06 * minDim);
            const sfs = 0.45 * fs;
            blocks.push({
              height: fs + (frozen > 0 ? 1.2 * sfs : 0),
              draw: (y) => {
                ctx.save();
                ctx.font = `bold ${fs}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = `rgb(${Math.round(255 * (1 - ratio))}, ${Math.round(255 * ratio)}, 80)`;
                ctx.fillText(seconds.toFixed(1) + "s", cx, y + 0.5 * fs);
                if (frozen > 0) {
                  ctx.font = `${sfs}px sans-serif`;
                  ctx.fillStyle = "#999";
                  ctx.fillText(L.frozenCount(frozen), cx, y + fs + 0.6 * sfs);
                }
                ctx.restore();
              },
            });
          }
        }
        if (engine.isPaintMode()) {
          const paint = engine.getPaintState();
          const coverage = paint.coverage;
          const fs = Math.max(16, 0.05 * minDim);
          const pct = Math.round(100 * coverage);
          const done = coverage >= COVERAGE_DONE;
          const color = done ? "#4ECDC4" : "#ffffff";
          // Picture Paint: a second line with the beat the ball moves to and the schedule (on schedule / behind / ahead)
          const hints: string[] = [];
          if (paint.picture && paint.beatActive) hints.push(L.paintBeat(Math.round(paint.bpm)));
          if (paint.picture && paint.pace && !done) hints.push(paint.pace === "behind" ? L.paintBehind : paint.pace === "ahead" ? L.paintAhead : L.paintOnSchedule);
          const hint = hints.join(" · ");
          const hintColor = paint.pace === "behind" ? "#f59e0b" : paint.pace === "ahead" ? "#38bdf8" : ACCENT;
          const sfs = 0.5 * fs;
          blocks.push({
            height: fs + (hint ? 1.4 * sfs : 0),
            draw: (y) => {
              ctx.save();
              ctx.font = `bold ${fs}px sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              const text = L.painted(pct);
              const w = ctx.measureText(text).width + 0.8 * fs;
              const h = 1.4 * fs;
              const x0 = cx - w / 2;
              const y0 = y + 0.5 * fs - h / 2;
              const rad = h / 2;
              ctx.globalAlpha = 0.55;
              ctx.fillStyle = "#000000";
              ctx.beginPath();
              ctx.moveTo(x0 + rad, y0);
              ctx.lineTo(x0 + w - rad, y0);
              ctx.arcTo(x0 + w, y0, x0 + w, y0 + rad, rad);
              ctx.arcTo(x0 + w, y0 + h, x0 + w - rad, y0 + h, rad);
              ctx.lineTo(x0 + rad, y0 + h);
              ctx.arcTo(x0, y0 + h, x0, y0 + h - rad, rad);
              ctx.arcTo(x0, y0, x0 + rad, y0, rad);
              ctx.closePath();
              ctx.fill();
              ctx.globalAlpha = 0.9;
              ctx.fillStyle = color;
              if (done) {
                ctx.shadowColor = color;
                ctx.shadowBlur = 15;
              }
              ctx.fillText(text, cx, y + 0.5 * fs);
              if (hint) {
                ctx.shadowBlur = 0;
                ctx.font = `600 ${sfs}px sans-serif`;
                ctx.fillStyle = hintColor;
                ctx.fillText(hint, cx, y + fs + 0.9 * sfs);
              }
              ctx.restore();
            },
          });
        }
        if (engine.isPortalMode()) {
          const count = engine.getPortalTeleportCount();
          if (engine.hasPortalEscaped()) bigBanner(L.escaped, L.afterTeleports(count), "#6c5ce7");
          else {
            const fs = Math.max(18, 0.06 * minDim);
            const sfs = 0.45 * fs;
            blocks.push({
              height: fs + 1.2 * sfs,
              draw: (y) => {
                ctx.save();
                ctx.font = `bold ${fs}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = "#6c5ce7";
                ctx.fillText(String(count), cx, y + 0.5 * fs);
                ctx.font = `${sfs}px sans-serif`;
                ctx.fillStyle = "#888";
                ctx.fillText(L.teleports, cx, y + fs + 0.5 * sfs);
                ctx.restore();
              },
            });
          }
        }
        // --- boris-multipliers --- the outgrow finish and the "N Boris made it home" banner (auto-fitted to the square)
        const fitBanner = (text: string, sub: string, color: string) => {
          const base = Math.max(24, 0.08 * minDim);
          ctx.font = `bold ${base}px sans-serif`;
          const fs = Math.min(base, (0.9 * minDim * base) / Math.max(1, ctx.measureText(text).width));
          const sfs = 0.4 * base;
          blocks.push({
            height: fs + 1.2 * sfs,
            draw: (y) => {
              ctx.save();
              ctx.font = `bold ${fs}px sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              // A dark outline keeps the banner readable over a ball that fills the arena.
              ctx.lineJoin = "round";
              ctx.lineWidth = Math.max(3, 0.12 * fs);
              ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
              ctx.strokeText(text, cx, y + 0.5 * fs);
              ctx.fillStyle = color;
              ctx.shadowColor = color;
              ctx.shadowBlur = 20;
              ctx.fillText(text, cx, y + 0.5 * fs);
              ctx.shadowBlur = 0;
              ctx.font = `${sfs}px sans-serif`;
              ctx.lineWidth = Math.max(2, 0.15 * sfs);
              ctx.strokeText(sub, cx, y + fs + 0.6 * sfs);
              ctx.fillStyle = "#eee";
              ctx.fillText(sub, cx, y + fs + 0.6 * sfs);
              ctx.restore();
            },
          });
        };
        if (multView.outgrown) fitBanner(L.outgrew ?? DEFAULT_LABELS.outgrew ?? "", (L.outgrewSub ?? DEFAULT_LABELS.outgrewSub!)(formatMultiplier(multView.size)), "#c4b5fd");
        else if (multBoard && multBoard.done) fitBanner((L.madeItHome ?? DEFAULT_LABELS.madeItHome!)(multBoard.home), (L.madeItHomeSub ?? DEFAULT_LABELS.madeItHomeSub!)(multBoard.clones), "#a3e635");
        // --- end boris-multipliers ---
        if (engine.isShatterMode() && engine.hasShatterEscaped()) {
          const prog = engine.getShatterProgress();
          bigBanner(L.shattered, L.segmentsDestroyed(prog.broken, prog.total), "#ef4444");
        }
        if (engine.isDropMode()) {
          const prog = engine.getDropProgress();
          if (prog.finished) bigBanner(L.settled, L.ballsAtRest(prog.total), "#a3e635");
        }
        if (isBox) {
          const prog = engine.getBoxProgress();
          if (prog.finished) bigBanner(L.boxDone, L.boxCounted(prog.total), "#a3e635");
        }
        if (isPendulum) {
          const prog = engine.getPendulumProgress();
          if (prog.finished) bigBanner(L.pendulumDone, L.pendulumInLine(prog.count, prog.total), "#a3e635");
        }
        // --- jdm-polyrhythm ---
        if (isPoly) {
          const prog = engine.getPolyrhythmProgress();
          if (prog.finished) bigBanner(L.polyrhythmDone, L.polyrhythmAligned(prog.count, prog.total), "#a3e635");
        }
        // --- jdm-illusions --- lines / rings run for a set number of cycles: the figure is back where it started.
        if (illusionView && illusionView.finished && illusionView.type !== "whitespace") bigBanner(L.complete, (L.illusionCycles ?? DEFAULT_LABELS.illusionCycles!)(illusionView.cyclesDone), "#a3e635");
        // --- boris-glass --- Glass Smash: Boris is HOME.
        if (glassView && glassView.homeReached) {
          const prog = engine.getGlassProgress();
          bigBanner(L.glassHomeTitle ?? DEFAULT_LABELS.glassHomeTitle!, (L.glassHomeSub ?? DEFAULT_LABELS.glassHomeSub!)(prog.shattered, prog.stages), "#a3e635");
        }
        if (isColorMatch) {
          const prog = engine.getColorMatchProgress();
          const ballColor = engine.getColorMatchBallColor();
          if (engine.hasColorMatchEscaped()) bigBanner(L.matched, L.segmentsCleared(prog.total), "#22c55e");
          else {
            const fs = Math.max(18, 0.045 * minDim);
            const sfs = 0.5 * fs;
            const dot = 0.4 * sfs;
            blocks.push({
              height: fs + sfs + (2 * dot + 6) + 4,
              draw: (y) => {
                ctx.save();
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.font = `bold ${fs}px sans-serif`;
                ctx.fillStyle = "#fff";
                ctx.fillText(`${prog.broken} / ${prog.total}`, cx, y + 0.5 * fs);
                const ly = y + fs + 0.6 * sfs;
                ctx.font = `${sfs}px sans-serif`;
                ctx.fillStyle = "#aaa";
                ctx.fillText(L.matchColour, cx, ly);
                const dy = ly + 0.5 * sfs + dot + 4;
                ctx.fillStyle = ballColor;
                ctx.shadowColor = ballColor;
                ctx.shadowBlur = 6;
                ctx.beginPath();
                ctx.arc(cx, dy, dot, 0, TWO_PI);
                ctx.fill();
                ctx.restore();
              },
            });
          }
        }
        if (engine.isCountdownMode()) {
          const target = engine.getCountdownTarget();
          const total = engine.getCountdownTotal();
          const hitCount = engine.getCountdownHit().size;
          if (engine.isCountdownComplete()) bigBanner(L.complete, L.segmentsHitInOrder(total), "#22c55e");
          else {
            const fs = Math.max(28, 0.1 * minDim);
            const sfs = 0.25 * fs;
            blocks.push({
              height: fs + 1.1 * sfs,
              draw: (y) => {
                ctx.save();
                ctx.font = `bold ${fs}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = "#facc15";
                ctx.shadowColor = "#facc15";
                ctx.shadowBlur = 15;
                ctx.fillText(String(target), cx, y + 0.5 * fs);
                ctx.shadowBlur = 0;
                ctx.font = `${sfs}px sans-serif`;
                ctx.fillStyle = "#888";
                ctx.fillText(`${hitCount}/${total}`, cx, y + fs + 0.5 * sfs);
                ctx.restore();
              },
            });
          }
        }
        if (replay) blocks.length = 0; // --- camera --- the mode banners wait for the end of the escape replay
        const totalH = blocks.reduce((s, b) => s + b.height, 0) + 8 * Math.max(0, blocks.length - 1);
        let y = cy - totalH / 2;
        for (const b of blocks) {
          b.draw(y);
          y += b.height + 8;
        }
        if (p.watermarkText) {
          ctx.save();
          const fs = Math.max(14, 0.045 * minDim);
          ctx.font = `bold ${fs}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.globalAlpha = 0.15;
          ctx.fillStyle = "#ffffff";
          const wy = blocks.length > 0 ? cy + totalH / 2 + 8 + 0.8 * fs : cy;
          ctx.fillText(p.watermarkText, cx, wy);
          ctx.restore();
        }
      }

      // --- teams --- the scoreboard in a corner of the exported square and, when the run is over, the winner banner with confetti
      if (teamLayer.isActive()) {
        teamLayer.drawOverlay(ctx, engine, {
          width: size.width,
          height: size.height,
          dtMs: !p.isPaused && p.isStarted ? frameMs : 0,
          inset: teamInset,
          // The mode's own banner in the middle – an escape, or --- boris-multipliers --- OUTGREW THE ARENA – moves the winner's lower.
          modeBanner: (engine.isShatterMode() && engine.hasShatterEscaped()) || (isColorMatch && engine.hasColorMatchEscaped()) || multView.outgrown,
          holdBanner: cam.holdsEndScreen(), // --- camera --- the winner banner waits for the escape replay
        });
      }

      // Top / bottom text (the recorder draws its own copy at export resolution)
      if ((p.topText || p.bottomText) && !recordingRef.current) {
        ctx.save();
        const fs = Math.max(14, 0.045 * Math.min(size.width, size.height)) * p.textSize;
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = 0.95;
        const pad = 0.6 * fs;
        ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
        ctx.shadowBlur = 8;
        if (p.topText) ctx.fillText(p.topText, cx, cy - arena - pad);
        if (p.bottomText) ctx.fillText(p.bottomText, cx, cy + arena + pad);
        ctx.restore();
      }

      // --- captions --- countdown, wall counter, progress bar, question and text captions inside the exported square (so
      // recordings have them), animated on the simulation clock; live, they keep clear of the page's buttons and the scoreboard
      const captionOptions = captionsRef.current;
      if (captionOptions) {
        const side = Math.min(size.width, size.height);
        const live = !recordingRef.current && (size.width - side) / 2 < 170;
        captionLayer.draw(ctx, engine, captionOptions, { width: size.width, height: size.height, insetTop: live ? 52 : 0, insetBottom: live ? 56 : 0, topMin: teamLayer.isActive() ? teamLayer.scoreboardBottom : 0, dtMs: !p.isPaused && p.isStarted ? frameMs : 0 });
      } else captionLayer.clear();

      // Song slicer: thin progress bar along the bottom edge (part of the recording too)
      const songProgress = songProgressRef.current;
      if (songProgress !== null) {
        const barW = 2 * arena;
        const x0 = cx - barW / 2;
        const y0 = size.height - 6;
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + barW, y0);
        ctx.stroke();
        if (songProgress > 0) {
          ctx.strokeStyle = ACCENT;
          ctx.shadowColor = ACCENT;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + barW * songProgress, y0);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Audio-reactive outer ring
      const intensity = audioRef.current;
      if (intensity > 0.3) {
        ctx.strokeStyle = `rgba(6, 182, 212, ${0.5 * intensity})`;
        ctx.lineWidth = 3 + 4 * intensity;
        ctx.beginPath();
        ctx.arc(cx, cy, arena + 20 * intensity, 0, TWO_PI);
        ctx.stroke();
      }
      // --- camera --- the REPLAY badge (screen space, part of the recording too); at the bottom when the top text or the
      // teams' scoreboard is there (below the scoreboard when the bottom text is in use too)
      const scoreboardBottom = teamLayer.isActive() ? teamLayer.scoreboardBottom : 0; // --- teams ---
      const replayAtBottom = (!!p.topText || scoreboardBottom > 0 || (captionLayer.usesTop && !captionLayer.usesBottom)) && !p.bottomText; // --- captions --- (top captions)
      cam.drawOverlay(ctx, size.width, size.height, (labelsRef.current ?? DEFAULT_LABELS).replay ?? "REPLAY", replayAtBottom, replayAtBottom ? 0 : scoreboardBottom);
      ctx.restore();

      // Picture Paint: mirror what the HUD shows onto the element (data-paint-*) so tools and the smoke test can read it.
      if (engine.isPaintMode()) {
        const paint = engine.getPaintState();
        setCanvasData("paintCoverage", String(Math.round(100 * paint.coverage)));
        setCanvasData("paintPicture", paint.picture ? "1" : "0");
        setCanvasData("paintPace", paint.pace ?? "");
        setCanvasData("paintBeat", paint.beatActive ? String(Math.round(paint.bpm)) : "0");
      } else if (canvas.dataset.paintCoverage !== undefined) {
        for (const key of ["paintCoverage", "paintPicture", "paintPace", "paintBeat"]) delete canvas.dataset[key];
      }
      // Bouncing Shapes: hit, corner and finished-shape counts (data-box-*) for tools and the smoke test.
      if (isBox) {
        const view = engine.getBoxView();
        setCanvasData("boxHits", String(view.totalHits));
        setCanvasData("boxCorners", String(view.cornerHits));
        setCanvasData("boxDone", String(view.doneCount));
      } else if (canvas.dataset.boxHits !== undefined) {
        for (const key of ["boxHits", "boxCorners", "boxDone"]) delete canvas.dataset[key];
      }
      // Pendulum Wave: note, chord and cycle counts (data-pendulum-*) for tools and the smoke test.
      if (isPendulum) {
        const view = engine.getPendulumView();
        setCanvasData("pendulumNotes", String(view.noteCount));
        setCanvasData("pendulumChords", String(view.chordCount));
        setCanvasData("pendulumCycles", String(view.cyclesDone));
      } else if (canvas.dataset.pendulumNotes !== undefined) {
        for (const key of ["pendulumNotes", "pendulumChords", "pendulumCycles"]) delete canvas.dataset[key];
      }
      // --- jdm-polyrhythm --- voice, tick, alignment and cycle counts (data-poly-*) for tools and the smoke test.
      if (isPoly) {
        const view = engine.getPolyrhythmView();
        setCanvasData("polyVoices", String(view.count));
        setCanvasData("polyTicks", String(view.tickCount));
        setCanvasData("polyAlignments", String(view.alignCount));
        setCanvasData("polyCycles", String(view.cyclesDone));
        setCanvasData("polyLayout", view.settings.layout);
      } else if (canvas.dataset.polyTicks !== undefined) {
        for (const key of ["polyVoices", "polyTicks", "polyAlignments", "polyCycles", "polyLayout"]) delete canvas.dataset[key];
      }

      // --- boris-faces --- the characters (face style, the first ball's expression, faces drawn, label) as data-face-* for tools and the smoke test
      if (faces.isActive()) {
        setCanvasData("face", faces.face());
        setCanvasData("faceExpression", faces.primaryExpression());
        setCanvasData("faceCount", String(faces.facesDrawn));
        setCanvasData("nameLabel", faces.labelShown);
      } else if (canvas.dataset.face !== undefined) {
        for (const key of ["face", "faceExpression", "faceCount", "nameLabel"]) delete canvas.dataset[key];
      }
      // --- jdm-collisions --- Collision Playground: bodies, collisions, notes and the anti-collision state (data-collide-*) for tools and the smoke test.
      if (isCollide) {
        const view = engine.getCollideView();
        setCanvasData("collideBodies", String(view.count));
        setCanvasData("collideCollisions", String(view.collisions));
        setCanvasData("collideNotes", String(view.notes));
        setCanvasData("collideAnti", view.antiActive ? "1" : "0");
      } else if (canvas.dataset.collideBodies !== undefined) {
        for (const key of ["collideBodies", "collideCollisions", "collideNotes", "collideAnti"]) delete canvas.dataset[key];
      }
      // --- jdm-illusions --- Circle Illusion (data-illusion-*) and the wobbly walls (data-wobble: walls wobbling this frame) for tools and the smoke test
      if (illusionView) {
        const iv = illusionView;
        setCanvasData("illusionType", iv.type);
        setCanvasData("illusionBodies", String(iv.count));
        setCanvasData("illusionNotes", String(iv.noteCount));
        setCanvasData("illusionCycles", String(iv.cyclesDone));
        setCanvasData("illusionAlignments", String(iv.alignCount));
        setCanvasData("illusionCollisions", String(iv.collisions));
        setCanvasData("illusionCoverage", String(Math.floor(100 * iv.coverage)));
        setCanvasData("illusionPattern", iv.pattern ? iv.pattern.id : "");
        setCanvasData("illusionFinished", iv.finished ? "1" : "0");
        setCanvasData("illusionCircleError", iv.circleError.toFixed(3));
        setCanvasData("illusionProbe", iv.pattern ? `${Math.round(iv.pattern.probeX)},${Math.round(iv.pattern.probeY)}` : "");
        setCanvasData("illusionPaper", iv.type === "whitespace" ? `${Math.round(iv.cx)},${Math.round(iv.cy + 0.85 * iv.radius)}` : "");
      } else if (canvas.dataset.illusionType !== undefined) {
        for (const key of ["illusionType", "illusionBodies", "illusionNotes", "illusionCycles", "illusionAlignments", "illusionCollisions", "illusionCoverage", "illusionPattern", "illusionFinished", "illusionCircleError", "illusionProbe", "illusionPaper"]) delete canvas.dataset[key];
      }
      if (wobble.on) setCanvasData("wobble", String(wobble.wobbling));
      else if (canvas.dataset.wobble !== undefined) delete canvas.dataset.wobble;
      // --- end jdm-illusions ---
      cam.syncData(canvas); // --- camera --- replay phase, view scale, time scale and the shake / slow-motion / replay counts (data-camera-*)
      // --- obstacle-editor --- obstacles in play, editing, the selection, hits, bumper kicks and the first spinner's angle (data-obstacle*) for tools and the smoke test
      if (editorField) {
        setCanvasData("obstacles", String(editorField.count));
        setCanvasData("obstacleEditing", obstacleRender.editing ? "1" : "0");
        setCanvasData("obstacleSelected", String(obstacleLayer.selected));
        setCanvasData("obstacleHits", String(editorField.hitCount));
        setCanvasData("bumperHits", String(editorField.bumpCount));
        const spinner = editorField.kinds.indexOf("spinner");
        const spinItem = spinner >= 0 ? editorField.items[spinner] : null;
        setCanvasData("spinnerAngle", spinItem && spinItem.kind === "segment" ? String(Math.round((spinItem.angle * 180) / Math.PI)) : "");
      } else if (canvas.dataset.obstacles !== undefined) {
        for (const key of ["obstacles", "obstacleEditing", "obstacleSelected", "obstacleHits", "bumperHits", "spinnerAngle"]) delete canvas.dataset[key];
      }

      // --- teams --- teams in play, per-team "bounces/walls/escapes", the winner, the names drawn and the scoreboard (data-team-*) for tools and the smoke test
      if (teamLayer.isActive()) {
        const o = teamsRef.current;
        setCanvasData("teams", String(teamLayer.teamsInPlay()));
        setCanvasData("teamStats", teamLayer.statsText(engine));
        setCanvasData("teamWinner", teamLayer.winnerText());
        setCanvasData("teamLabels", String(teamLayer.labelsDrawn));
        setCanvasData("scoreboard", o && o.showScoreboard ? o.position : "off");
        setCanvasData("scoreboardBottom", String(Math.round(teamLayer.scoreboardBottom))); // --- boris-multipliers --- the HUD starts below it
      } else if (canvas.dataset.teams !== undefined) {
        for (const key of ["teams", "teamStats", "teamWinner", "teamLabels", "scoreboard", "scoreboardBottom"]) delete canvas.dataset[key];
      }
      // --- captions --- captions drawn, the values they show ("0:27 | Wall 2/7 | Will it escape? → YES!") and the answer's reveal (data-caption-*)
      if (captionOptions) {
        setCanvasData("captions", String(captionLayer.drawn));
        setCanvasData("captionTexts", captionLayer.summary);
        setCanvasData("captionReveal", captionLayer.revealed ? "1" : "0");
      } else if (canvas.dataset.captions !== undefined) {
        for (const key of ["captions", "captionTexts", "captionReveal"]) delete canvas.dataset[key];
      }
      // --- boris-glass --- Glass Smash: stage, hits, shattered / total panes, HOME, the camera and the gate rows gone through (data-glass-*) for tools and the smoke test.
      if (glassView) {
        const prog = engine.getGlassProgress();
        setCanvasData("glassStage", String(prog.stage));
        setCanvasData("glassStages", String(prog.stages));
        setCanvasData("glassHits", String(prog.hits));
        setCanvasData("glassShattered", String(prog.shattered));
        setCanvasData("glassPanes", String(prog.panes));
        setCanvasData("glassHome", prog.home ? "1" : "0");
        setCanvasData("glassCamera", String(Math.round(glassView.cameraY)));
        setCanvasData("glassGates", String(prog.gates)); // --- boris-multipliers ---
      } else if (canvas.dataset.glassStage !== undefined) {
        for (const key of ["glassStage", "glassStages", "glassHits", "glassShattered", "glassPanes", "glassHome", "glassCamera", "glassGates"]) delete canvas.dataset[key];
      }
      // --- boris-multipliers --- the badges (data-mult-speed / -size / -damage / -balls …), pickups, slow-mo, outgrow and the board's counters
      if (multView.active) {
        if (!multBoard && canvas.dataset.multHome !== undefined) for (const key of ["multHome", "multActive", "multClones", "multGates", "multDone"]) delete canvas.dataset[key];
        writeMultiplierDataset(multView, multBoard, setCanvasData);
        setCanvasData("multHudTop", String(Math.round(multHudTop))); // the first badge row (−1: none shown), clear of the scoreboard
      } else if (canvas.dataset.multSpeed !== undefined) {
        for (const key of MULTIPLIER_DATA_KEYS) delete canvas.dataset[key];
      }

      // FPS estimate
      if (lastFpsSampleRef.current === 0) lastFpsSampleRef.current = now;
      const delta = now - lastFpsSampleRef.current;
      lastFpsSampleRef.current = now;
      if (delta > 0) fpsRef.current = 0.9 * fpsRef.current + (1000 / delta) * 0.1;
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [physicsEngine]);

  // --- obstacle-editor --- Backspace / Delete remove the selected obstacle while the run is not going; the selection goes when it starts
  useEffect(() => {
    if (!obstacleEditing) {
      obstacleLayerRef.current?.clear(canvasRef.current, onObstaclesChangeRef.current);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const commit = onObstaclesChangeRef.current;
      if (commit && obstacleLayerRef.current?.deleteSelected(physicsEngine.getEditorObstacles(), commit)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [obstacleEditing, physicsEngine]);
  /** Pointer editing (mouse, pen, touch): press on an obstacle to select and drag it; the move is committed on release. */
  const onObstaclePointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const layer = obstacleLayerRef.current;
    if (!canvas || !layer || !obstacleEditingRef.current) return;
    const field = physicsEngine.getEditorObstacles();
    if (e.type === "pointerdown") {
      if (layer.pointerDown(e.nativeEvent, canvas, field)) e.preventDefault();
    } else if (e.type === "pointermove") {
      layer.pointerMove(e.nativeEvent, canvas, field, physicsEngine);
    } else if (e.type === "pointerleave") {
      if (!layer.isDragging()) {
        layer.hover = -1;
        canvas.style.cursor = "";
      }
    } else {
      const commit = onObstaclesChangeRef.current;
      if (commit) layer.pointerUp(e.nativeEvent, canvas, commit);
    }
  };
  // --- end obstacle-editor ---

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full rounded-lg"
      style={{ display: "block", touchAction: obstacleEditing ? "none" : undefined }}
      onPointerDown={onObstaclePointer}
      onPointerMove={onObstaclePointer}
      onPointerUp={onObstaclePointer}
      onPointerCancel={onObstaclePointer}
      onPointerLeave={onObstaclePointer}
    />
  );
});

export default Canvas;
