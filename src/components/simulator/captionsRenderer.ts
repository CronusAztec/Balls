import {
  BACKGROUND_ALPHA,
  CAPTION_COLUMN,
  CaptionTracker,
  MAX_CAPTIONS,
  animateCaption,
  captionClock,
  captionPhase,
  captionStackStarts,
  holdsForAnswer,
  countdownPulse,
  countdownSeconds,
  countdownText,
  easeOutBack,
  easeOutCubic,
  emptyFrame,
  emptyPhase,
  phaseVisible,
  progressFraction,
  progressLabel,
  wallCount,
  wallCounterText,
  wrapCaptionText,
  captionAnswerText, // --- land-claim ---
  type Caption,
  type CaptionBounds,
  type CaptionEngineView,
  type CaptionRenderOptions,
} from "@/lib/captions";

/**
 * Drawing of the animated captions (lib/captions.ts), created once with the canvas loop. `draw()` runs in screen
 * space after the HUD and lays the captions out inside the centred square the recorder exports – top ones stacked
 * downwards from the top edge, bottom ones upwards from the bottom edge (both clear of the page's Top / Bottom Text),
 * center ones around the middle – so every recording has them. Their timing is the simulation clock
 * (`CaptionTracker`): a paused run holds them, 8× plays them eight times faster, and a restart starts them over –
 * except the countdown and the progress bar while a clip is being recorded, which count the clip itself
 * (`captionClock()`: real seconds since Record).
 *
 * Steady-state frames do not allocate: the wrapped lines and their widths, the fonts and the countdown / counter
 * strings are cached per caption slot and rebuilt only when their input changes.
 */

export type CanvasCaptionOptions = CaptionRenderOptions;

/** The view a frame is drawn in: its size, what the stacks keep clear of (`CaptionBounds`) and the clocks. */
export interface CaptionView extends CaptionBounds {
  width: number;
  height: number;
  /** Real milliseconds of this frame while the run plays (0 while paused), for the answer's end-screen hold. */
  dtMs: number;
  /** Real seconds since Record while a clip is being recorded, else −1 (see `captionClock()`). */
  clipTimeSec: number;
  /** --- land-claim --- The run's winner once it is known (a question's answer may name it as "[winner]"), else "". */
  winner?: string;
}

const FONT_FAMILY = "sans-serif";
const MAX_LINES = 3;

/** Wrapped lines of one text, cached until the text, the font or the width changes. */
class WrapSlot {
  private text = "";
  private font = "";
  private maxWidth = -1;
  lines: string[] = [];
  /** Widest line (px). */
  width = 0;

  get(ctx: CanvasRenderingContext2D, text: string, font: string, maxWidth: number): this {
    if (text === this.text && font === this.font && maxWidth === this.maxWidth) return this;
    this.text = text;
    this.font = font;
    this.maxWidth = maxWidth;
    ctx.font = font;
    this.lines = wrapCaptionText(text, (s) => ctx.measureText(s).width, maxWidth, MAX_LINES);
    let w = 0;
    for (const line of this.lines) w = Math.max(w, ctx.measureText(line).width);
    this.width = w;
    return this;
  }
}

/** Per caption slot: its fonts, texts and wrapped lines, kept between frames. */
class CaptionSlot {
  readonly phase = emptyPhase();
  readonly frame = emptyFrame();
  readonly main = new WrapSlot();
  readonly answer = new WrapSlot();
  fs = 0;
  font = "";
  answerFont = "";
  /** Countdown seconds / wall counts / progress percent the cached string was made for. */
  valueKey = NaN;
  valueLabel: string | null = null;
  valueType = "";
  valueText = "";
  /** Layout of this frame. */
  visible = false;
  height = 0;
  answerHeight = 0;
  boxWidth = 0;
  lineH = 0;
  answerLineH = 0;
  pad = 0;
  barH = 0;
  y = 0;
  /** What the canvas mirrors into data-caption-texts (the shown value, "question → answer"). */
  summary = "";
  private summaryText = "";
  private summaryRevealed = false;
  private bgHex = "";
  private bgRgba = "";

  /** The summary of a question / text caption, rebuilt only when its text or its reveal changes; true when it changed. */
  textSummary(text: string, answer: string, revealed: boolean): boolean {
    if (text === this.summaryText && revealed === this.summaryRevealed && this.summary !== "") return false;
    this.summaryText = text;
    this.summaryRevealed = revealed;
    this.summary = revealed ? `${text} → ${answer}` : text;
    return true;
  }

  /** The background colour at the pill's opacity (cached per slot). */
  background(hex: string): string {
    if (hex !== this.bgHex) {
      this.bgHex = hex;
      this.bgRgba = rgba(hex, BACKGROUND_ALPHA);
    }
    return this.bgRgba;
  }

  fonts(fs: number) {
    if (fs === this.fs) return;
    this.fs = fs;
    this.font = `bold ${fs}px ${FONT_FAMILY}`;
    this.answerFont = `900 ${1.25 * fs}px ${FONT_FAMILY}`;
  }
}

function rgba(hex: string, alpha: number): string {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000";
  return `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${alpha})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

export class CaptionLayer {
  private readonly tracker = new CaptionTracker();
  /** One slot per caption, grown when the list grows (--- review fix (uncap-all) --- any number up to MAX_CAPTIONS; never per frame). */
  private readonly slots: CaptionSlot[] = [];
  private summaryDirty = true;
  /** Captions drawn this frame. */
  drawn = 0;
  /** The shown values joined by " | " (for the data attribute). */
  summary = "";
  /** Whether a question's answer has been revealed in this run. */
  revealed = false;
  /** Top / bottom captions on screen this frame (the REPLAY badge keeps clear of them). */
  usesTop = false;
  usesBottom = false;
  /** Real milliseconds since the answer was revealed (0 before). */
  private msSinceReveal = 0;
  /** Where the top stack starts (its first caption's upper edge) and the bottom stack (its first caption's lower edge) this frame, screen px. */
  readonly starts = { top: 0, bottom: 0 };

  /** True while a finished run should wait so the question's answer can be seen (see `holdsForAnswer()`). */
  holdsEndScreen(): boolean {
    return holdsForAnswer(this.revealed, this.tracker.state.finished, this.msSinceReveal);
  }

  /** Nothing to draw: the data attributes are cleared by the canvas. */
  clear() {
    this.msSinceReveal = 0;
    this.drawn = 0;
    this.usesTop = false;
    this.usesBottom = false;
    this.revealed = false;
    if (this.summary !== "") this.summary = "";
  }

  draw(ctx: CanvasRenderingContext2D, engine: CaptionEngineView, options: CanvasCaptionOptions, view: CaptionView) {
    const captions = options.captions;
    const count = Math.min(captions.length, MAX_CAPTIONS);
    while (this.slots.length < count) this.slots.push(new CaptionSlot());
    let wantsReveal = false;
    for (let i = 0; i < count; i++) if (captions[i].type === "question" && captions[i].answer) wantsReveal = true;
    const run = this.tracker.update(engine, wantsReveal);
    const t = run.timeSec;
    const clip = options.clipSec;
    // The countdown and the progress bar count the clip while one is recorded, the run otherwise.
    const clock = captionClock(t, view.clipTimeSec);
    const side = Math.min(view.width, view.height);
    const cx = view.width / 2;
    const cy = view.height / 2;
    const baseFs = Math.max(12, 0.045 * side);
    const maxTextW = CAPTION_COLUMN * side;
    this.revealed = wantsReveal && run.revealAtSec >= 0;
    this.msSinceReveal = this.revealed ? this.msSinceReveal + view.dtMs : 0;

    // Measure: which captions show, their texts and their heights.
    let drawn = 0;
    let topRoom = 0;
    let centerRoom = 0;
    let bottomRoom = 0;
    for (let i = 0; i < count; i++) {
      const c = captions[i];
      const slot = this.slots[i];
      const wasVisible = slot.visible;
      slot.visible = false;
      captionPhase(c, t, run.revealAtSec, slot.phase);
      if (!phaseVisible(slot.phase)) {
        if (wasVisible) this.summaryDirty = true;
        continue;
      }
      animateCaption(c.animation, c.position, slot.phase, slot.frame);
      slot.fonts(Math.round(10 * baseFs * c.style.size) / 10);
      const fs = slot.fs;
      slot.lineH = 1.22 * fs;
      slot.answerLineH = 1.25 * slot.lineH;
      slot.pad = 0.3 * fs;
      slot.barH = 0;
      slot.answerHeight = 0;
      const padX = 0.55 * fs;
      let text = "";
      if (c.type === "countdown") {
        const secs = countdownSeconds(clip, clock);
        if (secs !== slot.valueKey || slot.valueLabel !== c.text || slot.valueType !== c.type) {
          slot.valueType = c.type;
          slot.valueKey = secs;
          slot.valueLabel = c.text;
          slot.valueText = countdownText(c, clip, clock);
          this.summaryDirty = true;
        }
        text = slot.valueText;
      } else if (c.type === "wallCounter") {
        const counts = wallCount(run.wallsBroken, run.wallsTotal);
        const key = counts.broken * 1000 + counts.total;
        const label = c.text || options.labels.wall;
        if (key !== slot.valueKey || slot.valueLabel !== label || slot.valueType !== c.type) {
          slot.valueType = c.type;
          slot.valueKey = key;
          slot.valueLabel = label;
          slot.valueText = wallCounterText(c, counts.broken, counts.total, options.labels.wall) ?? "";
          this.summaryDirty = true;
        }
        text = slot.valueText;
        if (!text) {
          // No rings to count in this mode.
          if (wasVisible) this.summaryDirty = true;
          continue;
        }
      } else if (c.type === "progress") {
        const pct = Math.round(100 * progressFraction(clip, clock));
        if (pct !== slot.valueKey || slot.valueLabel !== c.text || slot.valueType !== c.type) {
          slot.valueType = c.type;
          slot.valueKey = pct;
          slot.valueLabel = c.text;
          slot.valueText = progressLabel(c, pct / 100);
          slot.summary = slot.valueText ? `${slot.valueText} ${pct}%` : `${pct}%`;
          this.summaryDirty = true;
        }
        text = slot.valueText;
        slot.barH = Math.max(6, 0.018 * side) * c.style.size;
      } else if (c.type === "question") {
        text = c.text || options.labels.question;
      } else {
        text = c.text;
        if (!text) {
          if (wasVisible) this.summaryDirty = true;
          continue;
        }
      }
      const main = slot.main.get(ctx, text, slot.font, maxTextW - 2 * padX);
      let height = main.lines.length * slot.lineH + 2 * slot.pad;
      let width = main.width;
      if (c.type === "progress") {
        width = 0.72 * side * Math.min(1.2, c.style.size) - 2 * padX;
        height = slot.barH + 2 * slot.pad + (main.lines.length > 0 ? main.lines.length * slot.lineH + 0.25 * fs : 0);
      }
      const reveal = slot.phase.reveal;
      const answerText = captionAnswerText(c.answer, view.winner); // --- land-claim --- ("[winner]" named)
      if (reveal > 0) {
        const answer = slot.answer.get(ctx, answerText, slot.answerFont, maxTextW - 2 * padX);
        slot.answerHeight = answer.lines.length * slot.answerLineH;
        height += slot.answerHeight * easeOutCubic(reveal);
        width = Math.max(width, answer.width * Math.min(1, reveal * 1.5));
      }
      if (c.type === "question" || c.type === "text") {
        if (slot.textSummary(text, answerText, reveal > 0)) this.summaryDirty = true;
      } else if (c.type !== "progress" && slot.summary !== slot.valueText) {
        slot.summary = slot.valueText;
        this.summaryDirty = true;
      }
      slot.boxWidth = width + 2 * padX;
      slot.height = height;
      slot.visible = true;
      if (!wasVisible) this.summaryDirty = true;
      drawn++;
      const gap = 0.3 * baseFs;
      const room = (height + gap) * slot.frame.room;
      if (c.position === "top") topRoom += room;
      else if (c.position === "bottom") bottomRoom += room;
      else centerRoom += room;
    }
    this.drawn = drawn;
    this.usesTop = topRoom > 0;
    this.usesBottom = bottomRoom > 0;

    // Lay out: every caption takes room in its stack as it enters, so the others make way smoothly.
    const starts = captionStackStarts(view.width, view.height, view, this.starts);
    let topY = starts.top;
    let bottomY = starts.bottom;
    let centerY = cy - centerRoom / 2;
    for (let i = 0; i < count; i++) {
      const slot = this.slots[i];
      if (!slot.visible) continue;
      const gap = 0.3 * baseFs;
      const room = slot.height * slot.frame.room;
      const position = captions[i].position;
      if (position === "top") {
        slot.y = topY + room / 2;
        topY += room + gap * slot.frame.room;
      } else if (position === "bottom") {
        slot.y = bottomY - room / 2;
        bottomY -= room + gap * slot.frame.room;
      } else {
        slot.y = centerY + room / 2;
        centerY += room + gap * slot.frame.room;
      }
    }

    // Draw.
    for (let i = 0; i < count; i++) {
      const slot = this.slots[i];
      if (slot.visible) this.drawCaption(ctx, captions[i], slot, cx, clip, clock);
    }

    if (this.summaryDirty) {
      this.summaryDirty = false;
      let summary = "";
      for (let i = 0; i < count; i++) {
        const slot = this.slots[i];
        if (!slot.visible) continue;
        summary += summary ? ` | ${slot.summary}` : slot.summary;
      }
      this.summary = summary;
    }
  }

  /** Draws one caption; `clock` is the countdown's and the progress bar's clock (`captionClock()`). */
  private drawCaption(ctx: CanvasRenderingContext2D, c: Caption, slot: CaptionSlot, cx: number, clip: number, clock: number) {
    const f = slot.frame;
    if (f.alpha <= 0.001 || f.scale <= 0.001) return;
    const fs = slot.fs;
    const h = slot.height;
    const w = slot.boxWidth;
    const pulse = c.type === "countdown" ? countdownPulse(clip, clock) : 1;
    ctx.save();
    ctx.translate(cx, slot.y + f.dy * h);
    const scale = f.scale * pulse;
    if (scale !== 1) ctx.scale(scale, scale);
    ctx.globalAlpha = Math.min(1, f.alpha);
    ctx.shadowBlur = 0;
    const bg = c.style.background;
    const top = -h / 2;
    if (c.type === "progress") {
      const labelLines = slot.main.lines;
      const barW = w - 1.1 * fs;
      const barY = h / 2 - slot.pad - slot.barH / 2;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (labelLines.length > 0) {
        ctx.font = slot.font;
        ctx.fillStyle = c.style.color;
        ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
        ctx.shadowBlur = 6;
        for (let k = 0; k < labelLines.length; k++) ctx.fillText(labelLines[k], 0, top + slot.pad + slot.lineH * (k + 0.5));
        ctx.shadowBlur = 0;
      }
      ctx.lineCap = "round";
      ctx.lineWidth = slot.barH;
      ctx.strokeStyle = bg ? slot.background(bg) : "rgba(255, 255, 255, 0.18)";
      ctx.beginPath();
      ctx.moveTo(-barW / 2, barY);
      ctx.lineTo(barW / 2, barY);
      ctx.stroke();
      const fraction = progressFraction(clip, clock);
      if (fraction > 0) {
        ctx.strokeStyle = c.style.color;
        ctx.shadowColor = c.style.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(-barW / 2, barY);
        ctx.lineTo(-barW / 2 + barW * fraction, barY);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (bg) {
      ctx.fillStyle = slot.background(bg);
      roundRect(ctx, -w / 2, top, w, h, 0.45 * fs);
      ctx.fill();
    } else {
      ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
      ctx.shadowBlur = 8;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = c.style.color;
    ctx.font = slot.font;
    const lines = slot.main.lines;
    for (let k = 0; k < lines.length; k++) ctx.fillText(lines[k], 0, top + slot.pad + slot.lineH * (k + 0.5));
    // The answer pops in under the question.
    const reveal = slot.phase.reveal;
    if (reveal > 0 && slot.answer.lines.length > 0) {
      const answerTop = top + slot.pad + lines.length * slot.lineH;
      const s = Math.max(0.01, easeOutBack(reveal));
      ctx.globalAlpha = Math.min(1, f.alpha) * Math.min(1, 2 * reveal);
      ctx.font = slot.answerFont;
      const answerLines = slot.answer.lines;
      for (let k = 0; k < answerLines.length; k++) {
        const y = answerTop + slot.answerLineH * (k + 0.5) * easeOutCubic(reveal);
        ctx.save();
        ctx.translate(0, y);
        ctx.scale(s, s);
        ctx.fillText(answerLines[k], 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}
