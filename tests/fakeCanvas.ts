/**
 * --- free-watermark --- A minimal fake <canvas> for the compositor and the watermark painter in Node (tests/freeWatermark.test.ts,
 * the recorder tests): every 2D-context call is logged with its arguments (`ctx.calls`), `measureText()` estimates widths from
 * the font size, and `getImageData()` reports ink only once something was drawn on that context – so a layer the painter
 * left blank reads as blank. `fakeDocument()` hands these out from `createElement("canvas")` and keeps every one it made.
 */

export interface FakeCall {
  name: string;
  args: unknown[];
}

export interface FakeContext {
  canvas: FakeCanvas;
  calls: FakeCall[];
  drawn: boolean;
  font: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  globalCompositeOperation: string;
  textAlign: string;
  textBaseline: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  [method: string]: unknown;
}

export interface FakeCanvas {
  width: number;
  height: number;
  ctx: FakeContext;
  getContext: (kind: string) => FakeContext;
  captureStream: (fps?: number) => { getVideoTracks: () => unknown[] };
  /** Set to make every getImageData() read blank, as a sabotaged canvas would. */
  blank?: boolean;
}

const DRAWING = new Set(["fill", "stroke", "fillRect", "fillText", "strokeText", "drawImage"]);

export function fakeCanvas(width = 300, height = 150): FakeCanvas {
  const canvas = { width, height } as FakeCanvas;
  const calls: FakeCall[] = [];
  const ctx = {
    canvas,
    calls,
    drawn: false,
    font: "10px sans-serif",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    textAlign: "start",
    textBaseline: "alphabetic",
    shadowColor: "rgba(0, 0, 0, 0)",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  } as FakeContext;
  const log = (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
      if (DRAWING.has(name)) ctx.drawn = true;
      return undefined;
    };
  for (const name of ["save", "restore", "translate", "rotate", "scale", "setTransform", "beginPath", "closePath", "moveTo", "lineTo", "arc", "arcTo", "rect", "fill", "stroke", "fillRect", "clearRect", "fillText", "strokeText", "drawImage", "clip"]) ctx[name] = log(name);
  ctx.measureText = (text: string) => {
    calls.push({ name: "measureText", args: [text] });
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
    return { width: 0.56 * String(text).length * size };
  };
  ctx.createLinearGradient = (...args: unknown[]) => {
    calls.push({ name: "createLinearGradient", args });
    return { addColorStop: () => undefined };
  };
  ctx.createPattern = (...args: unknown[]) => {
    calls.push({ name: "createPattern", args });
    return { pattern: args[0] };
  };
  ctx.getImageData = (x: number, y: number, w: number, h: number) => {
    calls.push({ name: "getImageData", args: [x, y, w, h] });
    const data = new Uint8ClampedArray(Math.max(1, w * h) * 4);
    if (ctx.drawn && !canvas.blank) data.fill(200);
    return { data, width: w, height: h };
  };
  canvas.ctx = ctx;
  canvas.getContext = () => ctx;
  canvas.captureStream = () => ({ getVideoTracks: () => [] });
  return canvas;
}

/** A stand-in `document` whose createElement("canvas") makes fake canvases (all kept in `made`, in order). */
export function fakeDocument() {
  const made: FakeCanvas[] = [];
  return {
    made,
    createElement: (tag: string) => {
      if (tag !== "canvas") return {};
      const canvas = fakeCanvas();
      made.push(canvas);
      return canvas;
    },
  };
}

/** The drawImage calls of a context whose image is `image` (or every one). */
export function drawsOf(ctx: FakeContext, image?: unknown): FakeCall[] {
  return ctx.calls.filter((c) => c.name === "drawImage" && (image === undefined || c.args[0] === image));
}
