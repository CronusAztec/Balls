/*
 * --- funnel-spin --- The rolling hiss of the Sound Vortex's ring release (the funnel clip's "continuous rolling noise": its
 * flattest, brightest band sits at 0.5–2 kHz). ORIGINAL synthesis, nothing copied: the ToneGenerator's seeded noise buffer
 * looped through a band-pass (1.2 kHz, Q 0.7) and a low-pass (4 kHz) into one gain that follows the marbles' total speed
 * (`setLevel()`, throttled to 30 Hz, gliding with `setTargetAtTime` – no new node after the start: 4 nodes). It plays beside
 * the loop voices on the master (a hard cut at a seam leaves it alone; the page stops it with the run, `stop()`), dual-mono.
 * `ToneGenerator.playLoop("hiss", undefined, level)` starts it or sets its level; `playLoop("hissStop")` fades it out.
 */

export interface RollingHissTone {
  /** The band-pass centre (Hz) and Q, the low-pass (Hz). */
  band: number;
  q: number;
  lowpass: number;
  /** The gain at level 1 (≈ −26 dB: a bed under the chimes) and the glide's time constant (s). */
  gain: number;
  timeConstant: number;
  /** Updates per second at most. */
  updateHz: number;
}

export const ROLLING_HISS: RollingHissTone = { band: 1200, q: 0.7, lowpass: 4000, gain: 0.05, timeConstant: 0.08, updateHz: 30 };

export interface RollingHissHandle {
  /** The hiss' level (0–1: the marbles' speed, `hissLevel()` of lib/physics/funnelSpin.ts) from `time`. */
  setLevel(level: number, time: number): void;
  /** Fades it out from `time` and stops its source. */
  stop(time: number): void;
  readonly nodes: number;
}

/** Starts the rolling hiss at `time`, silent until its first level (the seeded `noise` buffer looped). */
export function startRollingHiss(ctx: BaseAudioContext, out: AudioNode, time: number, noise: AudioBuffer, tone: RollingHissTone = ROLLING_HISS): RollingHissHandle {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = tone.band;
  bp.Q.value = tone.q;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = tone.lowpass;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  source.connect(bp);
  bp.connect(lp);
  lp.connect(gain);
  gain.connect(out);
  source.start(time);
  let stopped = false;
  let lastUpdate = -Infinity;
  const minGap = 1 / Math.max(1, tone.updateHz);
  return {
    nodes: 4,
    setLevel(level, at) {
      if (stopped) return;
      if (at - lastUpdate < minGap - 1e-9) return;
      lastUpdate = at;
      const l = Number.isFinite(level) ? Math.max(0, Math.min(1.5, level)) : 0;
      gain.gain.setTargetAtTime(tone.gain * l, at, tone.timeConstant);
    },
    stop(at) {
      if (stopped) return;
      stopped = true;
      gain.gain.cancelScheduledValues(at);
      gain.gain.setTargetAtTime(0, at, 0.05);
      source.stop(at + 0.4);
    },
  };
}
