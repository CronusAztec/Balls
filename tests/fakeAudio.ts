/**
 * A minimal fake Web Audio graph for driving a real ToneGenerator in tests (tests/toneGenerator.test.ts, the rhythm
 * modes' melody checks): every oscillator the generator starts (its type, frequency and start time – the near-silent 1 Hz
 * keep-alive excepted), every buffer source (its start arguments and playback rate), every value set on a gain and the
 * master bus's limiter (masterBus.ts).
 * `currentTime` is writable, so a test plays the clock. Install it with
 * `vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } })`.
 */

export interface OscLog {
  type: string;
  frequency: number;
  startAt: number;
}
export interface SourceLog {
  startArgs: number[];
  playbackRate: number;
}
// --- loop-foundation --- every automation event of every AudioParam (the glide's exponential ramp, envelopes, setTargetAtTime)
export interface RampLog {
  kind: "set" | "linear" | "exp" | "target" | "cancel";
  value: number;
  time: number;
  /** The parameter's name: "gain", "frequency", "Q", "playbackRate", "param". */
  param: string;
}
// --- end loop-foundation ---

/** --- fl-overhaul --- (Stage 4) Options of the fake graph. */
export interface FakeGraphOptions {
  /**
   * The nodes Fight League's synthesiser and mixer use as well (lib/audio/flSynth.ts, flMixer.ts): stereo panners, delays,
   * periodic waves, an oscillator's detune and `setPeriodicWave()`, and a count of every node kind made (`made`; the base
   * graph has the biquad filters and `setTargetAtTime()` already) – off by default, so every older test drives exactly the
   * graph it was written for (a Fight League cue that needs a detune stays unplayed there).
   */
  extended?: boolean;
}

export function fakeGraph(options: FakeGraphOptions = {}) {
  const oscillators: OscLog[] = [];
  const sources: SourceLog[] = [];
  /** Every value set on a gain node's AudioParam (envelopes, sample levels), so a test can see how loud a sound was. */
  const gains: number[] = [];
  /** Every DynamicsCompressorNode made (the master bus's limiter), with its parameters. */
  const compressors: { threshold: { value: number }; knee: { value: number }; ratio: { value: number }; attack: { value: number }; release: { value: number } }[] = [];
  // --- loop-foundation --- the params log their automation (`ramps`), and a BiquadFilterNode exists (`filters`); there is still
  // no StereoPanner: a sound that made one would throw here (the loop sounds are dual-mono)
  const ramps: RampLog[] = [];
  const filters: { type: string; frequency: { value: number }; Q: { value: number } }[] = [];
  const param = (value = 0, name = "param") => ({
    value,
    setValueAtTime: (v: number, t: number) => void ramps.push({ kind: "set", value: v, time: t, param: name }),
    linearRampToValueAtTime: (v: number, t: number) => void ramps.push({ kind: "linear", value: v, time: t, param: name }),
    exponentialRampToValueAtTime: (v: number, t: number) => void ramps.push({ kind: "exp", value: v, time: t, param: name }),
    setTargetAtTime: (v: number, t: number) => void ramps.push({ kind: "target", value: v, time: t, param: name }),
    cancelScheduledValues: (t: number) => void ramps.push({ kind: "cancel", value: Number.NaN, time: t, param: name }),
  });
  // --- end loop-foundation ---
  const ctx = {
    state: "running",
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    resume: async () => undefined,
    close: async () => undefined,
    decodeAudioData: async () => ({ duration: 0.3 }),
    createGain: () => {
      const gain = param(1, "gain");
      const set = gain.setValueAtTime;
      return {
        gain: {
          ...gain,
          setValueAtTime: (value: number, t = 0) => {
            gains.push(value);
            set(value, t); // --- loop-foundation --- (logged as a ramp too)
          },
        },
        connect: () => undefined,
        disconnect: () => undefined,
      };
    },
    // --- loop-foundation ---
    createBiquadFilter: () => {
      const node = { type: "lowpass", frequency: param(350, "frequency"), Q: param(1, "Q"), gain: param(0, "gain"), connect: () => undefined, disconnect: () => undefined };
      filters.push(node);
      return node;
    },
    // --- end loop-foundation ---
    createDynamicsCompressor: () => {
      const node = { threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25), connect: () => undefined, disconnect: () => undefined };
      compressors.push(node);
      return node;
    },
    createWaveShaper: () => ({ curve: null as Float32Array | null, oversample: "none", connect: () => undefined, disconnect: () => undefined }),
    createAnalyser: () => ({ fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 128, connect: () => undefined, disconnect: () => undefined }),
    createMediaStreamDestination: () => ({ stream: {}, connect: () => undefined }),
    createOscillator: () => {
      const osc = {
        type: "sine",
        frequency: param(0, "frequency"),
        connect: () => undefined,
        disconnect: () => undefined,
        onended: null as (() => void) | null,
        start: (when = 0) => {
          // The near-silent keep-alive oscillator runs at 1 Hz and is never a bounce sound.
          if (osc.frequency.value !== 1) oscillators.push({ type: osc.type, frequency: osc.frequency.value, startAt: when });
        },
        stop: () => undefined,
      };
      return osc;
    },
    createBufferSource: () => {
      const source = {
        buffer: null as unknown,
        context: ctx,
        loop: false, // --- loop-foundation ---
        loopStart: 0,
        loopEnd: 0,
        playbackRate: param(1, "playbackRate"),
        connect: () => undefined,
        disconnect: () => undefined,
        onended: null as (() => void) | null,
        start: (...args: number[]) => sources.push({ startArgs: args, playbackRate: source.playbackRate.value }),
        stop: () => undefined,
      };
      return source;
    },
    createBuffer: (channels: number, length: number, sampleRate: number) => ({ duration: length / sampleRate, length, sampleRate, numberOfChannels: channels, copyToChannel: () => undefined, getChannelData: () => new Float32Array(length) }),
  };
  // --- fl-overhaul --- (Stage 4) the extended graph: the extra node kinds, and how many of each kind were made (every param
  // logs its automation into `ramps` as the base graph's do; the filters stay in `filters`)
  const made: Record<string, number> = {};
  if (options.extended) {
    const count = (kind: string) => (made[kind] = (made[kind] ?? 0) + 1);
    const node = (kind: string) => {
      count(kind);
      return { connect: () => undefined, disconnect: () => undefined };
    };
    const ext = ctx as unknown as Record<string, unknown>;
    const gain = ctx.createGain;
    const osc = ctx.createOscillator;
    const source = ctx.createBufferSource;
    const shaper = ctx.createWaveShaper;
    const biquad = ctx.createBiquadFilter;
    Object.assign(ext, {
      createGain: () => {
        count("gain");
        return gain();
      },
      createOscillator: () => {
        const o = osc();
        count("oscillator");
        return Object.assign(o, { detune: param(0, "detune"), setPeriodicWave: () => undefined });
      },
      createBufferSource: () => {
        count("bufferSource");
        return source();
      },
      createWaveShaper: () => {
        count("waveShaper");
        return shaper();
      },
      createBiquadFilter: () => {
        count("biquad");
        return biquad();
      },
      createStereoPanner: () => ({ ...node("stereoPanner"), pan: param(0, "pan") }),
      createDelay: () => ({ ...node("delay"), delayTime: param(0, "delayTime") }),
      createPeriodicWave: () => {
        count("periodicWave");
        return {};
      },
    });
  }
  // --- end fl-overhaul ---
  return { ctx, oscillators, sources, gains, compressors, ramps, filters, made };
}
