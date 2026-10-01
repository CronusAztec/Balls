/**
 * --- review fix (audio) --- The master bus shared by the live mix and the fast export's offline mix, so both sound the same:
 *
 *   master gain (volume) → limiter (DynamicsCompressorNode) → trim gain → soft clip (WaveShaperNode) → outputs
 *
 * Every sound, the music bed and the hit samples go into the master gain. Hits of one frame start together and – on one wall –
 * at one pitch and phase, so they add up coherently; without a limiter a handful of them clipped the speakers, the recording
 * and the encoded export. The compressor is set up as a limiter just under full scale: threshold −3 dB, a hard knee (the
 * default 30 dB knee would compress everything from −33 dB up and not limit), ratio 20, the fastest attack. It adds a
 * "makeup" gain to everything by design (Web Audio spec: (1 / curve(1))^0.6), which the trim gain takes off again, so a
 * sound below the threshold – a normal bounce – keeps its level. The soft clip is a sample-exact safety net for what the
 * compressor's attack lets through: the identity below 0.9 and a tanh knee above it that never reaches 1. (The compressor
 * delays the mix by its 6 ms look-ahead – well under a video frame.)
 *
 * `SameTimeVoices` (below) stops the coherent stacking at the source: the n-th identical voice started at the same time
 * only adds what makes n of them √n times as loud as one (the rule of `chordGain()`), and one scheduling time starts at
 * most a fixed number of voices.
 */

export const LIMITER_THRESHOLD_DB = -3;
export const LIMITER_KNEE_DB = 0;
export const LIMITER_RATIO = 20;
export const LIMITER_ATTACK_SEC = 0;
export const LIMITER_RELEASE_SEC = 0.1;
/**
 * Chromium's compressor starts out fully gain-reduced and releases to unity over its release time, so the first ~0.1 s of a
 * context – the start of every fast export – would be faded in. It releases instantly for this long first (measured: 30 ms
 * is enough), then with LIMITER_RELEASE_SEC.
 */
export const LIMITER_SETTLE_SEC = 0.05;
/** Where the soft clip leaves the identity. */
export const SOFT_CLIP_KNEE = 0.9;

/**
 * The makeup gain a DynamicsCompressorNode applies to its whole output (Web Audio spec, "makeup gain"): the inverse of the
 * compression curve at full scale, to the power 0.6. With a hard knee the curve above the threshold T is T·(x/T)^(1/ratio).
 */
export function compressorMakeupGain(thresholdDb = LIMITER_THRESHOLD_DB, ratio = LIMITER_RATIO): number {
  const threshold = Math.pow(10, thresholdDb / 20);
  const fullRange = threshold >= 1 ? 1 : threshold * Math.pow(1 / threshold, 1 / Math.max(1, ratio));
  return Math.pow(1 / fullRange, 0.6);
}

/** The soft-clip transfer curve: y = x up to ±SOFT_CLIP_KNEE, then a tanh knee that stays below 1 (odd-symmetric). */
export function softClip(x: number): number {
  const a = Math.abs(x);
  if (a <= SOFT_CLIP_KNEE) return x;
  const room = 1 - SOFT_CLIP_KNEE;
  return Math.sign(x) * (SOFT_CLIP_KNEE + room * Math.tanh((a - SOFT_CLIP_KNEE) / room));
}

/** The soft clip sampled for a WaveShaperNode (its curve spans inputs −1…1; anything beyond clamps to the ends). */
export function softClipCurve(points = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) curve[i] = softClip((2 * i) / (points - 1) - 1);
  return curve;
}

/**
 * Builds the master bus on `ctx` and connects its end to every node of `outputs` (the speakers and the recorder's stream, or
 * the offline context's destination). Returns the master gain, set to `volume`: the node every sound connects to. Pass the
 * real context (not a clocked view of it: the settling of the limiter is timed on the context's own clock). A
 * context without a compressor or a wave shaper (a minimal test stand-in) goes straight from the master gain to the outputs.
 */
export function createMasterBus(ctx: BaseAudioContext, outputs: readonly AudioNode[], volume: number): GainNode {
  const master = ctx.createGain();
  master.gain.value = volume;
  let tail: AudioNode = master;
  if (typeof ctx.createDynamicsCompressor === "function") {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER_THRESHOLD_DB;
    limiter.knee.value = LIMITER_KNEE_DB;
    limiter.ratio.value = LIMITER_RATIO;
    limiter.attack.value = LIMITER_ATTACK_SEC;
    limiter.release.setValueAtTime(0, ctx.currentTime);
    limiter.release.setValueAtTime(LIMITER_RELEASE_SEC, ctx.currentTime + LIMITER_SETTLE_SEC);
    const trim = ctx.createGain();
    trim.gain.value = 1 / compressorMakeupGain();
    master.connect(limiter);
    limiter.connect(trim);
    tail = trim;
  }
  if (typeof ctx.createWaveShaper === "function") {
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = "none";
    tail.connect(clip);
    tail = clip;
  }
  for (const out of outputs) tail.connect(out);
  return master;
}

/**
 * The voices already started at one scheduling time, by (voice, pitch): a fixed-size table with no allocation per hit that
 * starts over whenever the time changes. `add()` returns the gain factor of one more voice – √k − √(k−1) for the k-th
 * identical one, so n identical voices add up to √n × one – or 0 once `maxVoices` voices share the time (the voice is
 * then left out).
 */
export class SameTimeVoices {
  private time = Number.NaN;
  private total = 0;
  private size = 0;
  private readonly kinds: string[];
  private readonly pitches: Float64Array;
  private readonly counts: Uint16Array;

  constructor(private readonly maxVoices: number) {
    this.kinds = new Array<string>(maxVoices).fill("");
    this.pitches = new Float64Array(maxVoices);
    this.counts = new Uint16Array(maxVoices);
  }

  add(time: number, kind: string, pitch: number): number {
    if (!(Math.abs(time - this.time) < 1e-6)) {
      this.time = time;
      this.total = 0;
      this.size = 0;
    }
    if (this.total >= this.maxVoices) return 0;
    this.total++;
    let i = 0;
    while (i < this.size && !(this.kinds[i] === kind && Math.abs(this.pitches[i] - pitch) < 1e-6)) i++;
    if (i === this.size) {
      this.kinds[i] = kind;
      this.pitches[i] = pitch;
      this.counts[i] = 0;
      this.size++;
    }
    const k = ++this.counts[i];
    return Math.sqrt(k) - Math.sqrt(k - 1);
  }
}
