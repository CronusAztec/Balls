import type { PhysicsConfig } from "@/lib/physics/types";
import { segmentEndpoints, type SegmentEnds } from "@/lib/physics/obstacles";
import {
  OBSTACLE_LIMITS,
  clientToCanvas,
  invertAffinePoint,
  pickObstacle,
  removeObstacle,
  sanitizeObstacle,
  worldToArena,
  type Affine,
  type EditorObstacle,
  type ObstacleField,
  type Vec,
} from "@/lib/physics/obstacleEditor";
import { ACCENT } from "@/lib/site";

/**
 * Drawing and pointer editing of the obstacle editor's pegs, bumpers, blockers and spinners (lib/physics/obstacleEditor.ts)
 * for Canvas.tsx. Pegs are glowing discs, bumpers glowing rings that swell and flash white on every kick, blockers and
 * spinners bars (a spinner with its hub, turning with the simulation). Hits light an obstacle up like the walls glow.
 *
 * While the run is not going (before the start, paused) the canvas hands its pointer events here: a press on an obstacle
 * selects it and drags it (mouse, pen or touch – the canvas sets `touch-action: none` meanwhile), the move is shown live
 * through the engine's config and committed to the settings (URL, presets) on release; Backspace / Delete remove the
 * selected one. Pointer positions are mapped to world coordinates through the inverse of the transform the obstacles were
 * last drawn with (device pixel ratio, camera), then to arena radii (`worldToArena()`).
 */

/** How long a hit lights an obstacle up and a bumper flashes, in simulation ms. */
export const OBSTACLE_FLASH_MS = 320;
/** Extra reach (world px) of a press around an obstacle: fingers get more. */
const MOUSE_SLOP = 6;
const TOUCH_SLOP = 14;
const TWO_PI = Math.PI * 2;

export interface ObstacleRenderOptions {
  /** The wall colour (per obstacle index; `angle` for the rainbow gradient). */
  wallColor: (index: number, alpha?: number, angle?: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
  /** Rainbow walls in gradient mode: the colour follows the obstacle's angle around the centre. */
  gradient: boolean;
  /** The obstacles can be dragged (the run is not going): the selection and hover outlines are drawn. */
  editing: boolean;
}

/** Input types that take no typed text: Backspace / Delete mean nothing to them, so they still delete the selected obstacle. */
const NON_TEXT_INPUTS = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]);

/**
 * True when a key event on `target` edits text – a text-like input, a textarea or editable content – so Backspace /
 * Delete belong to it and must not delete the selected obstacle. A slider, a toggle, a dropdown or a button the panel
 * left focused does not count: the key deletes the obstacle selected on the canvas.
 */
export function isTextEntryTarget(target: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  return tag === "INPUT" && !NON_TEXT_INPUTS.has((target.type ?? "text").toLowerCase());
}

/** What the layer needs from the engine to show a drag live. */
export interface ObstacleEngine {
  setConfig(patch: Partial<PhysicsConfig>): void;
}

interface Drag {
  index: number;
  pointerId: number;
  offX: number;
  offY: number;
  moved: boolean;
}

export class ObstacleEditorLayer {
  /** Index of the selected obstacle (−1 = none). */
  selected = -1;
  /** Index of the obstacle under the mouse (−1 = none). */
  hover = -1;
  private drag: Drag | null = null;
  private draft: EditorObstacle[] | null = null;
  /** World → canvas-pixel transform the obstacles were last drawn with (captured only while editing). */
  private readonly m: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  private hasTransform = false;
  /** The list the selection refers to: when the panel adds or removes an obstacle, the indices shift and the selection goes. */
  private selectionDefs: readonly EditorObstacle[] | null = null;
  private readonly ends: SegmentEnds = { x1: 0, y1: 0, x2: 0, y2: 0 };
  private readonly pt: Vec = { x: 0, y: 0 };
  private readonly rel: Vec = { x: 0, y: 0 };

  /** True while a drag is going. */
  isDragging() {
    return this.drag !== null;
  }

  /**
   * Forgets the selection, hover and any drag (the run started, the obstacles left play); a drag cut short that already
   * moved its obstacle is committed through `commit`, so the settings match what the engine shows.
   */
  clear(canvas?: HTMLCanvasElement | null, commit?: (obstacles: EditorObstacle[]) => void) {
    const cut = this.drag?.moved ? this.draft : null;
    this.selected = -1;
    this.hover = -1;
    this.drag = null;
    this.draft = null;
    if (cut && commit) commit(cut);
    this.hasTransform = false;
    this.selectionDefs = null;
    if (canvas && canvas.style.cursor) canvas.style.cursor = "";
  }

  /** Draws the obstacles; call inside the world (camera) transform. `simNowMs` is the engine's elapsed time. */
  draw(ctx: CanvasRenderingContext2D, field: ObstacleField, simNowMs: number, o: ObstacleRenderOptions) {
    const items = field.items;
    const defs = field.definitions;
    if (defs !== this.selectionDefs) {
      if (!this.drag && this.selectionDefs && defs.length !== this.selectionDefs.length) this.selected = -1;
      this.selectionDefs = defs;
    }
    if (this.selected >= items.length) this.selected = -1;
    if (this.hover >= items.length) this.hover = -1;
    if (o.editing) {
      const t = ctx.getTransform();
      this.m.a = t.a;
      this.m.b = t.b;
      this.m.c = t.c;
      this.m.d = t.d;
      this.m.e = t.e;
      this.m.f = t.f;
      this.hasTransform = true;
    } else this.hasTransform = false;
    const { cx, cy } = field.frame;
    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const kind = field.kinds[i];
      const age = simNowMs - field.lastHitMs[i];
      const flash = age >= 0 && age < OBSTACLE_FLASH_MS ? 1 - age / OBSTACLE_FLASH_MS : 0;
      const glow = o.showWallGlow ? flash : 0;
      const angle = o.gradient ? ((Math.atan2(item.y - cy, item.x - cx) % TWO_PI) + TWO_PI) % TWO_PI : undefined;
      const outline = o.editing && (i === this.selected || i === this.hover) ? (i === this.selected ? 0.55 : 0.25) : 0;
      if (item.kind === "circle") {
        const bumper = kind === "bumper";
        const r = item.radius * (bumper ? 1 + 0.22 * flash : 1);
        if (outline > 0) {
          ctx.globalAlpha = outline;
          ctx.fillStyle = ACCENT;
          ctx.beginPath();
          ctx.arc(item.x, item.y, r + 7, 0, TWO_PI);
          ctx.fill();
        }
        // The halo: always a soft glow, brighter for a moment after a hit.
        ctx.globalAlpha = 1;
        ctx.fillStyle = o.wallColor(i, 0.1 + 0.35 * glow + (bumper ? 0.35 * flash : 0), angle);
        ctx.beginPath();
        ctx.arc(item.x, item.y, r + 4 + 8 * Math.max(glow, bumper ? flash : 0), 0, TWO_PI);
        ctx.fill();
        if (bumper) {
          const lw = Math.max(2, r * 0.3);
          ctx.globalAlpha = 0.95;
          ctx.strokeStyle = o.wallColor(i, undefined, angle);
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.arc(item.x, item.y, Math.max(1, r - lw / 2), 0, TWO_PI);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = `rgba(255, 255, 255, ${(0.2 + 0.75 * flash).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(item.x, item.y, Math.max(1, r - lw), 0, TWO_PI);
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(item.x, item.y, Math.max(1.5, r * 0.16), 0, TWO_PI);
          ctx.fill();
        } else {
          ctx.globalAlpha = 0.92;
          ctx.fillStyle = o.wallColor(i, undefined, angle);
          ctx.beginPath();
          ctx.arc(item.x, item.y, r, 0, TWO_PI);
          ctx.fill();
          // A small highlight so a peg reads as a solid ball-bearing rather than a flat dot.
          ctx.globalAlpha = 0.35 + 0.4 * glow;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(item.x - r * 0.3, item.y - r * 0.3, r * 0.35, 0, TWO_PI);
          ctx.fill();
        }
      } else {
        segmentEndpoints(item, this.ends);
        const e = this.ends;
        const width = Math.max(item.thickness, o.wallThickness);
        if (outline > 0) {
          ctx.globalAlpha = outline;
          ctx.strokeStyle = ACCENT;
          ctx.lineWidth = width + 12;
          ctx.beginPath();
          ctx.moveTo(e.x1, e.y1);
          ctx.lineTo(e.x2, e.y2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = o.wallColor(i, 0.12 + 0.4 * glow, angle);
        ctx.lineWidth = width + 6 + 10 * glow;
        ctx.beginPath();
        ctx.moveTo(e.x1, e.y1);
        ctx.lineTo(e.x2, e.y2);
        ctx.stroke();
        ctx.globalAlpha = 0.92;
        ctx.strokeStyle = o.wallColor(i, undefined, angle);
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(e.x1, e.y1);
        ctx.lineTo(e.x2, e.y2);
        ctx.stroke();
        if (kind === "spinner") {
          // The hub the bar turns around.
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#0a0a0a";
          ctx.beginPath();
          ctx.arc(item.x, item.y, width * 0.75 + 1.5, 0, TWO_PI);
          ctx.fill();
          ctx.strokeStyle = o.wallColor(i, undefined, angle);
          ctx.lineWidth = Math.max(1.5, width * 0.35);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** The world point under a pointer, through the inverse of the last drawing transform; false before one is known. */
  private worldPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): boolean {
    if (!this.hasTransform) return false;
    clientToCanvas(clientX, clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height, this.pt);
    return invertAffinePoint(this.m, this.pt.x, this.pt.y, this.pt);
  }

  /** A press: selects the obstacle under it and starts dragging it. Returns true when it took the press. */
  pointerDown(e: PointerEvent, canvas: HTMLCanvasElement, field: ObstacleField | null): boolean {
    if (!field || !this.worldPoint(canvas, e.clientX, e.clientY)) return false;
    const index = pickObstacle(field.items, this.pt.x, this.pt.y, e.pointerType === "touch" ? TOUCH_SLOP : MOUSE_SLOP);
    this.selected = index;
    if (index < 0) return false;
    const item = field.items[index];
    this.drag = { index, pointerId: e.pointerId, offX: item.x - this.pt.x, offY: item.y - this.pt.y, moved: false };
    this.draft = field.definitions.slice();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone already */
    }
    canvas.style.cursor = "grabbing";
    return true;
  }

  /** A move: drags the grabbed obstacle (shown live through the engine) or updates the hover outline and cursor. */
  pointerMove(e: PointerEvent, canvas: HTMLCanvasElement, field: ObstacleField | null, engine: ObstacleEngine) {
    if (!field || !this.worldPoint(canvas, e.clientX, e.clientY)) return;
    const drag = this.drag;
    if (drag && drag.pointerId === e.pointerId && this.draft && drag.index < this.draft.length) {
      worldToArena(field.frame, this.pt.x + drag.offX, this.pt.y + drag.offY, this.rel);
      const { min, max } = OBSTACLE_LIMITS.position;
      const moved = sanitizeObstacle({ ...this.draft[drag.index], x: Math.max(min, Math.min(max, this.rel.x)), y: Math.max(min, Math.min(max, this.rel.y)) });
      if (!moved) return;
      const next = this.draft.slice();
      next[drag.index] = moved;
      this.draft = next;
      drag.moved = true;
      engine.setConfig({ editorObstacles: next });
      return;
    }
    if (drag) return;
    const index = pickObstacle(field.items, this.pt.x, this.pt.y, e.pointerType === "touch" ? TOUCH_SLOP : MOUSE_SLOP);
    this.hover = index;
    const cursor = index >= 0 ? "grab" : "";
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
  }

  /** The press ends: a drag that moved is committed to the settings through `commit`. */
  pointerUp(e: PointerEvent, canvas: HTMLCanvasElement, commit: (obstacles: EditorObstacle[]) => void) {
    const drag = this.drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const draft = this.draft;
    this.drag = null;
    this.draft = null;
    canvas.style.cursor = this.hover >= 0 ? "grab" : "";
    if (drag.moved && draft) commit(draft);
  }

  /** Backspace / Delete: removes the selected obstacle through `commit`. Returns true when it removed one. */
  deleteSelected(field: ObstacleField | null, commit: (obstacles: EditorObstacle[]) => void): boolean {
    if (!field || this.drag || this.selected < 0 || this.selected >= field.definitions.length) return false;
    const next = removeObstacle(field.definitions, this.selected);
    this.selected = -1;
    this.hover = -1;
    commit(next);
    return true;
  }
}
