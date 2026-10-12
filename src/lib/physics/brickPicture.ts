/*
 * --- brick-rebuild --- The pictures Brick Smash builds its bricks from (pure: no canvas, no engine). A picture is a colour
 * index per grid cell and a palette of at most `BR_MAX_COLOURS` colours:
 *
 *  - the built-in emblem (`emblemPicture()`): a navy field, a teal ring and an amber square – an original generated mark,
 *    no third-party artwork is bundled;
 *  - the mandala of the kaleidoscope (`mandalaPicture()`): a rainbow flower folded into the symmetry's wedge, so it has the
 *    run's own symmetry;
 *  - text-to-pixels (`textPicture()`): the typed words in a built-in 5 × 7 pixel font, word-wrapped and scaled to the grid;
 *  - an upload (`quantisePixels()`): the page cover-fits the picture into the grid (one pixel a cell) and hands its RGBA here;
 *    it is quantised to at most 8 colours – exactly, when it has no more than that – by k-means seeded with a fixed seed, so
 *    the same picture always gives the same bricks. The picture stays in the page: it never travels in a link.
 *
 * The rebuild flies the bricks back colour layer by colour layer (`layerRanks()`): the colour with the most bricks first –
 * the field, then the ring, then the accent.
 */

export interface BrickPicture {
  cols: number;
  rows: number;
  /** Colours as #rrggbb, at most BR_MAX_COLOURS. */
  palette: string[];
  /** The palette index of every cell, row-major. */
  colours: Uint8Array;
}

/** The most colours a picture keeps. */
export const BR_MAX_COLOURS = 8;
/** The emblem: navy field, teal ring, amber square (the reference clip's colours). */
export const BR_EMBLEM_PALETTE = ["#1b2350", "#2fb7b4", "#f4c55c"] as const;
/** The mandala: a navy ground, then magenta, pink, orange, yellow, green and teal. */
export const BR_MANDALA_PALETTE = ["#1d2a5c", "#d6338f", "#ff7ac0", "#ff8a2a", "#ffd23f", "#4fd36b", "#2fb7b4"] as const;
/** Text-to-pixels: navy field, teal shadow, amber letters. */
export const BR_TEXT_PALETTE = ["#1b2350", "#2fb7b4", "#f4c55c"] as const;
/** The longest text kept (characters). */
export const BR_TEXT_MAX = 40;

/**
 * The emblem in a `cols` × `rows` grid whose cells are `cellAspect` (width / height) wide: in the grid's own proportions, a
 * teal ring (radii 0.25 and 0.37 of the shorter side) around an amber square (half-side 0.12) on a navy field.
 */
export function emblemPicture(cols: number, rows: number, cellAspect = 1): BrickPicture {
  const colours = new Uint8Array(cols * rows);
  const aspect = Number.isFinite(cellAspect) && cellAspect > 0 ? cellAspect : 1;
  const w = cols * aspect;
  const h = rows;
  const m = Math.min(w, h);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * aspect - w / 2;
      const y = j + 0.5 - h / 2;
      const d = Math.hypot(x, y);
      let c = 0;
      if (d >= 0.25 * m && d <= 0.37 * m) c = 1;
      if (Math.abs(x) <= 0.12 * m && Math.abs(y) <= 0.12 * m) c = 2;
      colours[j * cols + i] = c;
    }
  }
  return { cols, rows, palette: [...BR_EMBLEM_PALETTE], colours };
}

/** The triangle wave of x (period 2, 0 → 1 → 0): the mirror fold of an angle measured in wedges. */
function triangle(x: number): number {
  const m = ((x % 2) + 2) % 2;
  return m <= 1 ? m : 2 - m;
}

/**
 * The kaleidoscope's mandala in a square `cols` × `cols` grid: a magenta core ring, orange petals with yellow rims, green tips
 * and a teal rim on navy, every cell coloured by its radius and its angle folded into the symmetry's wedge (`images` of them;
 * a mirror fold – reflections – or a rotation fold), so the picture has the run's own symmetry. `hole` is the empty centre's
 * share of the radius.
 */
export function mandalaPicture(cols: number, images: number, mirror: boolean, hole: number): BrickPicture {
  const rows = cols;
  const colours = new Uint8Array(cols * rows);
  const n = Math.max(1, images);
  const wedge = (2 * Math.PI) / n;
  const h0 = Math.max(0, Math.min(0.95, hole));
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) / cols - 0.5;
      const y = (j + 0.5) / rows - 0.5;
      const d = 2 * Math.hypot(x, y);
      const theta = Math.atan2(y, x);
      const t = theta < 0 ? theta + 2 * Math.PI : theta;
      // s: 0 on a petal's axis, 1 between two petals
      const s = n <= 1 ? Math.abs(Math.sin(t * 3)) : mirror ? triangle(t / wedge) : (t % wedge) / wedge;
      const u = h0 < 1 ? (d - h0) / (1 - h0) : 0;
      let c = 0;
      if (u < 0.16) c = 1;
      else if (u < 0.28) c = 2;
      else {
        const petal = 0.38 + 0.55 * Math.pow(1 - s, 1.4);
        if (u < petal - 0.13) c = 3;
        else if (u < petal) c = 4;
        else if (s > 0.55 && u > 0.7) c = 5;
        else if (u > 0.9) c = 6;
      }
      colours[j * cols + i] = c;
    }
  }
  return { cols, rows, palette: [...BR_MANDALA_PALETTE], colours };
}

/* ------------------------------------------------------------------ text-to-pixels */

/** The built-in 5 × 7 pixel font (an original, plain bitmap): each glyph's 7 rows, 5 bits each, the left pixel first. */
const FONT: Readonly<Record<string, readonly string[]>> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};
const GLYPH_W = 5;
const GLYPH_H = 7;

/** A character as the font draws it: upper case, accents dropped (Ł as L), anything else unknown as "?". */
function glyphOf(ch: string): readonly string[] {
  const plain = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const key = plain === "Ł" ? "L" : plain.length > 0 ? plain[0] : " ";
  return FONT[key] ?? FONT["?"];
}

/** A clean text: control characters dropped, at most `BR_TEXT_MAX` characters. */
export function cleanBrickText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, BR_TEXT_MAX);
}

/** The text's lines word-wrapped to at most `maxChars` characters each (a longer word is cut). */
export function wrapBrickText(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const width = Math.max(1, Math.floor(maxChars));
  const lines: string[] = [];
  let line = "";
  for (let word of words) {
    while (word.length > width) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += " " + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/**
 * The text in a `cols` × `rows` grid: word-wrapped to the layout that draws the letters biggest (a whole number of cells a
 * font pixel, at least one), centred, in amber with a teal shadow one cell down and right, on navy.
 */
export function textPicture(text: string, cols: number, rows: number): BrickPicture {
  const colours = new Uint8Array(cols * rows);
  const clean = cleanBrickText(text).trim();
  if (!clean) return { cols, rows, palette: [...BR_TEXT_PALETTE], colours };
  // the layout with the biggest scale: try every line width
  let best = { scale: 0, lines: [clean] };
  for (let chars = Math.max(1, clean.length); chars >= 1; chars--) {
    const lines = wrapBrickText(clean, chars);
    const longest = Math.max(...lines.map((l) => l.length));
    const w = longest * (GLYPH_W + 1) - 1;
    const h = lines.length * (GLYPH_H + 1) - 1;
    const scale = Math.min(cols / w, rows / h);
    if (scale > best.scale) best = { scale, lines };
  }
  const scale = Math.max(1, Math.floor(best.scale));
  const lines = best.lines;
  const blockH = (lines.length * (GLYPH_H + 1) - 1) * scale;
  const top = Math.floor((rows - blockH) / 2);
  const paint = (i: number, j: number, c: number) => {
    if (i < 0 || j < 0 || i >= cols || j >= rows) return;
    const at = j * cols + i;
    if (c === 1 && colours[at] === 2) return;
    colours[at] = c;
  };
  for (const pass of [1, 2]) {
    const shift = pass === 1 ? 1 : 0;
    lines.forEach((line, li) => {
      const lineW = (line.length * (GLYPH_W + 1) - 1) * scale;
      const left = Math.floor((cols - lineW) / 2);
      const y0 = top + li * (GLYPH_H + 1) * scale;
      [...line].forEach((ch, ci) => {
        const glyph = glyphOf(ch);
        const x0 = left + ci * (GLYPH_W + 1) * scale;
        for (let gy = 0; gy < GLYPH_H; gy++) {
          for (let gx = 0; gx < GLYPH_W; gx++) {
            if (glyph[gy][gx] !== "1") continue;
            for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) paint(x0 + gx * scale + sx + shift, y0 + gy * scale + sy + shift, pass);
          }
        }
      });
    });
  }
  return { cols, rows, palette: [...BR_TEXT_PALETTE], colours };
}

/* ------------------------------------------------------------------ an upload */

/** Mulberry32: the quantiser's seeded random (a fixed seed: the same picture always gives the same bricks). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function hex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** The quantiser's fixed seed. */
export const BR_QUANTISE_SEED = 0x5eed;

/**
 * An uploaded picture's bricks: `rgba` holds `cols` × `rows` pixels (the page cover-fitted the picture into the grid, one pixel
 * a cell; a transparent pixel counts as white). A picture of at most `maxColours` distinct colours keeps them exactly (in the
 * order they first appear); a richer one is quantised by k-means (k-means++ start, 16 rounds) seeded with `seed`.
 */
export function quantisePixels(rgba: ArrayLike<number>, cols: number, rows: number, maxColours = BR_MAX_COLOURS, seed = BR_QUANTISE_SEED): BrickPicture {
  const n = cols * rows;
  const k = Math.max(1, Math.min(BR_MAX_COLOURS, Math.round(maxColours)));
  const rs = new Float64Array(n);
  const gs = new Float64Array(n);
  const bs = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    const a = (rgba[4 * p + 3] ?? 255) / 255;
    rs[p] = (rgba[4 * p] ?? 0) * a + 255 * (1 - a);
    gs[p] = (rgba[4 * p + 1] ?? 0) * a + 255 * (1 - a);
    bs[p] = (rgba[4 * p + 2] ?? 0) * a + 255 * (1 - a);
  }
  const colours = new Uint8Array(n);
  // exact: a picture of k colours or fewer
  const seen = new Map<number, number>();
  let exact = true;
  for (let p = 0; p < n && exact; p++) {
    const key = (Math.round(rs[p]) << 16) | (Math.round(gs[p]) << 8) | Math.round(bs[p]);
    let index = seen.get(key);
    if (index === undefined) {
      if (seen.size >= k) {
        exact = false;
        break;
      }
      index = seen.size;
      seen.set(key, index);
    }
    colours[p] = index;
  }
  if (exact) {
    const palette = [...seen.keys()].map((key) => hex((key >> 16) & 255, (key >> 8) & 255, key & 255));
    return { cols, rows, palette: palette.length > 0 ? palette : ["#ffffff"], colours };
  }
  // k-means++ start
  const random = mulberry32(seed);
  const cr = new Float64Array(k);
  const cg = new Float64Array(k);
  const cb = new Float64Array(k);
  const dist = new Float64Array(n).fill(Infinity);
  let first = Math.min(n - 1, Math.floor(random() * n));
  for (let c = 0; c < k; c++) {
    cr[c] = rs[first];
    cg[c] = gs[first];
    cb[c] = bs[first];
    let total = 0;
    for (let p = 0; p < n; p++) {
      const d = (rs[p] - cr[c]) ** 2 + (gs[p] - cg[c]) ** 2 + (bs[p] - cb[c]) ** 2;
      if (d < dist[p]) dist[p] = d;
      total += dist[p];
    }
    if (total <= 0) break;
    let pick = random() * total;
    first = n - 1;
    for (let p = 0; p < n; p++) {
      pick -= dist[p];
      if (pick <= 0) {
        first = p;
        break;
      }
    }
  }
  const sum = new Float64Array(4 * k);
  for (let round = 0; round < 16; round++) {
    let moved = false;
    sum.fill(0);
    for (let p = 0; p < n; p++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (rs[p] - cr[c]) ** 2 + (gs[p] - cg[c]) ** 2 + (bs[p] - cb[c]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (colours[p] !== best) moved = true;
      colours[p] = best;
      sum[4 * best] += rs[p];
      sum[4 * best + 1] += gs[p];
      sum[4 * best + 2] += bs[p];
      sum[4 * best + 3]++;
    }
    for (let c = 0; c < k; c++) {
      const count = sum[4 * c + 3];
      if (count <= 0) continue;
      cr[c] = sum[4 * c] / count;
      cg[c] = sum[4 * c + 1] / count;
      cb[c] = sum[4 * c + 2] / count;
    }
    if (!moved && round > 0) break;
  }
  const palette = Array.from({ length: k }, (_, c) => hex(cr[c], cg[c], cb[c]));
  return { cols, rows, palette, colours };
}

/**
 * The rebuild's layer of every palette colour (0 flies first): the colours with the most bricks (`mask`: the cells that are
 * bricks; all when left out) first – the field, then the ring, then the accent – ties by palette order.
 */
export function layerRanks(colours: ArrayLike<number>, paletteSize: number, mask?: ArrayLike<number>): Int32Array {
  const counts = new Float64Array(Math.max(1, paletteSize));
  for (let p = 0; p < colours.length; p++) if (!mask || mask[p]) counts[colours[p]] = (counts[colours[p]] ?? 0) + 1;
  const order = Array.from({ length: counts.length }, (_, c) => c).sort((a, b) => counts[b] - counts[a] || a - b);
  const ranks = new Int32Array(counts.length);
  order.forEach((c, rank) => (ranks[c] = rank));
  return ranks;
}
