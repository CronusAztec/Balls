/**
 * Beat detection for uploaded songs – pure DSP with no Web Audio, so it runs in unit tests, in
 * slices on the main thread (`analyzeBeatsAsync()`, which never blocks the UI for more than a few
 * milliseconds at a time) or inside a Worker.
 *
 * Pipeline:
 *  1. Onset envelope: frames of `frameSize` samples every `hopSize` samples (mono mixdown on the
 *     fly, Hann window, FFT, log-compressed magnitude spectrum); the envelope value of a frame is
 *     its half-wave-rectified spectral flux – the sum of every bin's magnitude increase against the
 *     previous frame – which rises sharply on drum hits, plucks and note attacks.
 *  2. Onsets: local maxima of the envelope above an adaptive threshold (a multiple of the local
 *     mean plus a fraction of the global maximum), at least `minOnsetGapSec` apart, refined to
 *     sub-hop precision with a parabola through the peak.
 *  3. Tempo: normalised autocorrelation of the smoothed, mean-removed envelope for lags up to
 *     `maxLagSec`. Every candidate period in the `minBpm`–`maxBpm` range is scored with a
 *     three-harmonic comb (r(L) + r(2L)/2 + r(3L)/3) minus half the peak at L/2 (a periodic signal
 *     correlates equally at every multiple of its period, so the smallest lag with a full peak is
 *     the beat, not its half-tempo alias), times a gentle log-Gaussian prior around 120 BPM; the
 *     best lag is refined with a parabola.
 *  4. Phase: the grid offset that collects the most envelope energy; then period and phase are
 *     refined by a least-squares fit of the detected onsets to the beat grid, so the hop
 *     quantisation averages out over the whole song.
 *  5. `beatTimes` is the regular grid `phase + k · period` over the song (snapped, deterministic);
 *     `onsets` keeps the raw detections.
 */

/** The parts of an AudioBuffer the analyser reads (tests pass plain objects). */
export interface AudioLike {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface BeatAnalysisOptions {
  /** Samples between two envelope frames (512 ≈ 11.6 ms at 44.1 kHz). */
  hopSize: number;
  /** FFT size, a power of two ≥ hopSize. */
  frameSize: number;
  minBpm: number;
  maxBpm: number;
  /** Longest autocorrelation lag in seconds (the comb looks up to three beat periods ahead). */
  maxLagSec: number;
  /** Two onsets closer than this are one onset. */
  minOnsetGapSec: number;
}

export const DEFAULT_BEAT_OPTIONS: BeatAnalysisOptions = { hopSize: 512, frameSize: 1024, minBpm: 60, maxBpm: 200, maxLagSec: 2.2, minOnsetGapSec: 0.05 };

export interface BeatAnalysis {
  /** Estimated tempo; 0 when the song has no usable periodicity (silence, a pad, too short). */
  bpm: number;
  /** Beat instants in song seconds on the tempo grid, from the first beat (≥ 0) to the end of the song. */
  beatTimes: number[];
  /** Raw onset instants in song seconds. */
  onsets: number[];
  /** Normalised autocorrelation at the chosen period, 0–1 (1 = a metronome). */
  confidence: number;
  /** Song length in seconds. */
  duration: number;
  /** Seconds per envelope frame (hop / sample rate). */
  hopSec: number;
}

/** Tempo prior: a log-Gaussian around this BPM, one octave wide, breaks ties between a tempo and its double / half. */
export const TEMPO_PRIOR_BPM = 120;
const TEMPO_PRIOR_OCTAVES = 1;
/** Log compression of the magnitude spectrum: log(1 + LOG_GAIN · |X| / (N/2)). */
const LOG_GAIN = 100;
const LOCAL_MEAN_SEC = 0.2;
const THRESHOLD_MEAN_FACTOR = 1.5;
const THRESHOLD_MAX_FRACTION = 0.05;
/** Below this autocorrelation the "tempo" is noise. */
const MIN_CONFIDENCE = 0.02;
/** Weight of the half-lag peak subtracted from a candidate's comb score (see the tempo step). */
const SUBHARMONIC_PENALTY = 0.5;

/* ------------------------------------------------------------------ FFT */

function isPowerOfTwo(n: number) {
  return n > 0 && (n & (n - 1)) === 0;
}

/** cos / sin tables for an in-place radix-2 FFT of size `n` (k < n/2). */
export function makeFftTables(n: number): { cos: Float32Array; sin: Float32Array } {
  const half = n >> 1;
  const cos = new Float32Array(half);
  const sin = new Float32Array(half);
  for (let k = 0; k < half; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = Math.sin((2 * Math.PI * k) / n);
  }
  return { cos, sin };
}

/** In-place iterative radix-2 complex FFT (forward, e^{-2πi kn/N}); `re.length` must be a power of two. */
export function fftInPlace(re: Float32Array, im: Float32Array, tables: { cos: Float32Array; sin: Float32Array }) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const { cos, sin } = tables;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const stride = n / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0, k = 0; j < half; j++, k += stride) {
        const wr = cos[k];
        const wi = -sin[k];
        const a = i + j;
        const b = a + half;
        const vr = re[b] * wr - im[b] * wi;
        const vi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
      }
    }
  }
}

/** Magnitude spectrum (bins 0 … N/2) of one real frame; a small helper for tests and tools. */
export function magnitudeSpectrum(frame: Float32Array): Float32Array {
  const n = frame.length;
  if (!isPowerOfTwo(n)) throw new Error("frame length must be a power of two");
  const re = Float32Array.from(frame);
  const im = new Float32Array(n);
  fftInPlace(re, im, makeFftTables(n));
  const out = new Float32Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  return out;
}

/* ------------------------------------------------------------------ analyser */

function normalizeOptions(options: Partial<BeatAnalysisOptions>): BeatAnalysisOptions {
  const o = { ...DEFAULT_BEAT_OPTIONS, ...options };
  o.hopSize = Math.max(64, Math.round(o.hopSize));
  let frame = 256;
  while (frame < Math.max(o.frameSize, o.hopSize)) frame <<= 1;
  o.frameSize = frame;
  o.minBpm = Math.max(20, o.minBpm);
  o.maxBpm = Math.max(o.minBpm + 1, o.maxBpm);
  o.maxLagSec = Math.max(60 / o.minBpm, o.maxLagSec);
  o.minOnsetGapSec = Math.max(0, o.minOnsetGapSec);
  return o;
}

function emptyAnalysis(duration: number, hopSec: number): BeatAnalysis {
  return { bpm: 0, beatTimes: [], onsets: [], confidence: 0, duration, hopSec };
}

/** Sub-sample offset (−0.5 … 0.5) of the true peak of a parabola through three samples with the maximum in the middle. */
function parabolicOffset(left: number, mid: number, right: number): number {
  const denom = left - 2 * mid + right;
  if (denom >= 0) return 0;
  const d = (0.5 * (left - right)) / denom;
  return Math.max(-0.5, Math.min(0.5, d));
}

/**
 * Incremental analyser: `step()` computes a few envelope frames at a time (so a caller can yield
 * to the browser in between), `finish()` runs the tempo and phase estimation on the envelope.
 */
export class BeatAnalyzer {
  readonly options: BeatAnalysisOptions;
  readonly totalFrames: number;
  readonly hopSec: number;
  readonly duration: number;
  private frame = 0;
  private readonly channels: Float32Array[] = [];
  private readonly sampleCount: number;
  private readonly envelope: Float64Array;
  private readonly window: Float32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly tables: { cos: Float32Array; sin: Float32Array };
  private readonly prevMag: Float32Array;
  private readonly frameCentreSec: number;
  private result: BeatAnalysis | null = null;

  constructor(buffer: AudioLike, options: Partial<BeatAnalysisOptions> = {}) {
    this.options = normalizeOptions(options);
    const { hopSize, frameSize } = this.options;
    const sampleRate = buffer.sampleRate > 0 ? buffer.sampleRate : 44100;
    for (let c = 0; c < buffer.numberOfChannels; c++) this.channels.push(buffer.getChannelData(c));
    this.sampleCount = buffer.length;
    this.hopSec = hopSize / sampleRate;
    this.duration = buffer.length / sampleRate;
    this.frameCentreSec = frameSize / 2 / sampleRate;
    this.totalFrames = buffer.length >= frameSize ? Math.floor((buffer.length - frameSize) / hopSize) + 1 : buffer.length > 0 ? 1 : 0;
    this.envelope = new Float64Array(this.totalFrames);
    this.window = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frameSize);
    this.re = new Float32Array(frameSize);
    this.im = new Float32Array(frameSize);
    this.tables = makeFftTables(frameSize);
    this.prevMag = new Float32Array(frameSize / 2 + 1);
  }

  /** 0–1, how much of the envelope has been computed. */
  get progress(): number {
    return this.totalFrames > 0 ? this.frame / this.totalFrames : 1;
  }

  /** Computes up to `maxFrames` more envelope frames; returns true once the envelope is complete. */
  step(maxFrames = 256): boolean {
    const end = Math.min(this.totalFrames, this.frame + Math.max(1, maxFrames));
    while (this.frame < end) this.processFrame(this.frame++);
    return this.frame >= this.totalFrames;
  }

  /** Finishes the envelope if needed and returns the tempo, beat grid and onsets (cached). */
  finish(): BeatAnalysis {
    if (this.result) return this.result;
    while (!this.step(4096)) {
      /* run to the end */
    }
    this.result = this.estimate();
    return this.result;
  }

  private processFrame(index: number) {
    const { hopSize, frameSize } = this.options;
    const start = index * hopSize;
    const channels = this.channels;
    const nc = channels.length;
    const inv = nc > 0 ? 1 / nc : 0;
    const re = this.re;
    const im = this.im;
    const window = this.window;
    const total = this.sampleCount;
    for (let j = 0; j < frameSize; j++) {
      const at = start + j;
      let s = 0;
      if (at < total) {
        for (let c = 0; c < nc; c++) s += channels[c][at];
        s *= inv;
      }
      re[j] = s * window[j];
      im[j] = 0;
    }
    fftInPlace(re, im, this.tables);
    const bins = frameSize / 2;
    const scale = LOG_GAIN / bins;
    const prev = this.prevMag;
    let flux = 0;
    for (let k = 0; k <= bins; k++) {
      const m = Math.log1p(scale * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
      const d = m - prev[k];
      if (d > 0) flux += d;
      prev[k] = m;
    }
    // The first frame has nothing to rise from (a full-spectrum "onset" against silence would swamp the picker).
    this.envelope[index] = index === 0 ? 0 : flux;
  }

  private estimate(): BeatAnalysis {
    const env = this.envelope;
    const n = env.length;
    const hopSec = this.hopSec;
    const { minBpm, maxBpm, maxLagSec, minOnsetGapSec } = this.options;
    if (n < 8) return emptyAnalysis(this.duration, hopSec);
    let globalMax = 0;
    for (let i = 0; i < n; i++) if (env[i] > globalMax) globalMax = env[i];
    if (!(globalMax > 0)) return emptyAnalysis(this.duration, hopSec);

    // ---- onsets: adaptive-threshold peak picking
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + env[i];
    const m = Math.max(1, Math.round(LOCAL_MEAN_SEC / hopSec));
    const minGap = Math.max(1, Math.round(minOnsetGapSec / hopSec));
    const onsetFrames: number[] = [];
    let lastOnset = -Infinity;
    for (let i = 1; i < n - 1; i++) {
      const v = env[i];
      if (v < env[i - 1] || v <= env[i + 1]) continue;
      const a = Math.max(0, i - m);
      const b = Math.min(n - 1, i + m);
      const mean = (prefix[b + 1] - prefix[a]) / (b - a + 1);
      if (v <= THRESHOLD_MEAN_FACTOR * mean + THRESHOLD_MAX_FRACTION * globalMax) continue;
      if (i - lastOnset < minGap) continue;
      onsetFrames.push(i + parabolicOffset(env[i - 1], v, env[i + 1]));
      lastOnset = i;
    }
    const onsets = onsetFrames.map((f) => f * hopSec + this.frameCentreSec);

    // ---- tempo: autocorrelation of the smoothed, mean-removed envelope, comb-scored with a 120 BPM prior.
    // The smoothing (a 5-tap Gaussian) widens the one-frame spikes of sharp attacks, so a period that falls
    // between two integer lags still shows a nearly full autocorrelation peak.
    const smooth = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = env[Math.max(0, i - 2)];
      const b = env[Math.max(0, i - 1)];
      const d = env[Math.min(n - 1, i + 1)];
      const e = env[Math.min(n - 1, i + 2)];
      smooth[i] = 0.1 * a + 0.2 * b + 0.4 * env[i] + 0.2 * d + 0.1 * e;
    }
    let mean = 0;
    for (let i = 0; i < n; i++) mean += smooth[i];
    mean /= n;
    const maxLag = Math.min(n - 2, Math.round(maxLagSec / hopSec));
    if (maxLag < 2) return { ...emptyAnalysis(this.duration, hopSec), onsets };
    const r = new Float64Array(maxLag + 1);
    for (let lag = 0; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0, e = n - lag; i < e; i++) s += (smooth[i] - mean) * (smooth[i + lag] - mean);
      r[lag] = s / (n - lag);
    }
    if (!(r[0] > 0)) return { ...emptyAnalysis(this.duration, hopSec), onsets };
    for (let lag = 1; lag <= maxLag; lag++) r[lag] /= r[0];
    r[0] = 1;
    /** Autocorrelation at a fractional lag (linear interpolation; 0 beyond the window). */
    const rAt = (lag: number) => {
      if (lag < 0 || lag > maxLag) return 0;
      const i = Math.floor(lag);
      if (i >= maxLag) return r[maxLag];
      const f = lag - i;
      return r[i] * (1 - f) + r[i + 1] * f;
    };
    const lagMin = 60 / maxBpm / hopSec;
    const lagMax = 60 / minBpm / hopSec;
    let best = -1;
    let bestScore = -Infinity;
    for (let L = Math.max(2, Math.ceil(lagMin)); L <= Math.min(maxLag, Math.floor(lagMax)); L++) {
      // Harmonics support a candidate; a strong peak at half the lag means the candidate is itself a
      // multiple of the real period (a periodic signal correlates equally at every multiple), so it is penalised.
      let score = r[L] + rAt(2 * L) / 2 + rAt(3 * L) / 3 - SUBHARMONIC_PENALTY * Math.max(0, rAt(L / 2));
      const bpm = 60 / (L * hopSec);
      const octaves = Math.log2(bpm / TEMPO_PRIOR_BPM) / TEMPO_PRIOR_OCTAVES;
      score *= Math.exp(-0.5 * octaves * octaves);
      if (score > bestScore) {
        bestScore = score;
        best = L;
      }
    }
    if (best < 0 || !(r[best] > MIN_CONFIDENCE)) return { ...emptyAnalysis(this.duration, hopSec), onsets };
    const confidence = Math.max(0, Math.min(1, r[best]));
    let periodFrames = best;
    if (best > 0 && best < maxLag) periodFrames += parabolicOffset(r[best - 1], r[best], r[best + 1]);
    let period = periodFrames * hopSec;

    // ---- phase: the grid offset that collects the most envelope energy (quarter-frame steps)
    const P = periodFrames;
    let bestPhase = 0;
    let bestSum = -1;
    for (let phi = 0; phi < P; phi += 0.25) {
      let s = 0;
      for (let t = phi; t < n - 1; t += P) {
        const i0 = Math.floor(t);
        const f = t - i0;
        s += env[i0] * (1 - f) + env[i0 + 1] * f;
      }
      if (s > bestSum) {
        bestSum = s;
        bestPhase = phi;
      }
    }
    let phase = bestPhase * hopSec + this.frameCentreSec;

    // ---- refine period and phase on the onsets that sit on the grid (least squares over the whole song)
    for (let iteration = 0; iteration < 2; iteration++) {
      let count = 0;
      let sk = 0;
      let st = 0;
      let skk = 0;
      let skt = 0;
      let kMin = Infinity;
      let kMax = -Infinity;
      for (const t of onsets) {
        const k = Math.round((t - phase) / period);
        const residual = t - (phase + k * period);
        if (Math.abs(residual) > 0.15 * period) continue;
        count++;
        sk += k;
        st += t;
        skk += k * k;
        skt += k * t;
        if (k < kMin) kMin = k;
        if (k > kMax) kMax = k;
      }
      if (count < 4 || kMax - kMin < 2) break;
      const denom = count * skk - sk * sk;
      if (!(denom > 0)) break;
      const slope = (count * skt - sk * st) / denom;
      const intercept = (st - slope * sk) / count;
      if (!(slope > 0) || Math.abs(slope / period - 1) > 0.08) break;
      period = slope;
      phase = intercept;
    }

    // ---- the snapped grid over the song
    const bpm = 60 / period;
    let first = phase - Math.floor(phase / period) * period;
    if (first < 0) first += period;
    const beatTimes: number[] = [];
    for (let t = first, k = 0; t < this.duration && k < 200000; t = first + ++k * period) beatTimes.push(t);
    return { bpm, beatTimes, onsets, confidence, duration: this.duration, hopSec };
  }
}

/** Analyses a whole buffer synchronously (tests, tools, Workers). */
export function analyzeBeats(buffer: AudioLike, options: Partial<BeatAnalysisOptions> = {}): BeatAnalysis {
  return new BeatAnalyzer(buffer, options).finish();
}

export interface AsyncBeatOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  /** Milliseconds of work per slice before yielding to the browser. */
  sliceMs?: number;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function yieldToBrowser(fn: () => void) {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (typeof g.requestIdleCallback === "function") g.requestIdleCallback(() => fn(), { timeout: 50 });
  else setTimeout(fn, 0);
}

/**
 * Analyses a buffer in slices of a few milliseconds between idle callbacks (or timeouts), so a
 * three-minute song is done within seconds while the simulator keeps rendering at 60 fps.
 * Rejects with an AbortError when `signal` fires.
 */
export function analyzeBeatsAsync(buffer: AudioLike, options: Partial<BeatAnalysisOptions> = {}, { signal, onProgress, sliceMs = 6 }: AsyncBeatOptions = {}): Promise<BeatAnalysis> {
  return new Promise((resolve, reject) => {
    const analyzer = new BeatAnalyzer(buffer, options);
    const run = () => {
      if (signal?.aborted) {
        reject(new DOMException("Beat analysis cancelled", "AbortError"));
        return;
      }
      const started = now();
      let done = false;
      do done = analyzer.step(64);
      while (!done && now() - started < sliceMs);
      onProgress?.(analyzer.progress);
      if (!done) {
        yieldToBrowser(run);
        return;
      }
      try {
        resolve(analyzer.finish());
      } catch (err) {
        reject(err);
      }
    };
    yieldToBrowser(run);
  });
}
