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

/** --- fl-overhaul --- (Stage 4) Options of the fake graph. */
export interface FakeGraphOptions {
  /**
   * The nodes Fight League's synthesiser and mixer use as well (lib/audio/flSynth.ts, flMixer.ts): biquad filters, stereo
   * panners, delays, periodic waves, an oscillator's detune and `setPeriodicWave()`, `setTargetAtTime()` on every param – off
   * by default, so every older test drives exactly the graph it was written for (sounds that need a filter stay unplayed).
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
  const param = (value = 0) => ({
    value,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
    cancelScheduledValues: () => undefined,
  });
  const ctx = {
    state: "running",
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    resume: async () => undefined,
    close: async () => undefined,
    decodeAudioData: async () => ({ duration: 0.3 }),
    createGain: () => ({ gain: { ...param(1), setValueAtTime: (value: number) => void gains.push(value) }, connect: () => undefined, disconnect: () => undefined }),
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
        frequency: param(0),
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
        playbackRate: param(1),
        connect: () => undefined,
        disconnect: () => undefined,
        onended: null as (() => void) | null,
        start: (...args: number[]) => sources.push({ startArgs: args, playbackRate: source.playbackRate.value }),
        stop: () => undefined,
      };
      return source;
    },
    createBuffer: (channels: number, length: number, sampleRate: number) => ({ duration: length / sampleRate, copyToChannel: () => undefined }),
  };
  // --- fl-overhaul --- (Stage 4) the extended graph: the extra node kinds, and how many of each kind were made
  const made: Record<string, number> = {};
  if (options.extended) {
    const count = (kind: string) => (made[kind] = (made[kind] ?? 0) + 1);
    const xparam = (value = 0) => ({ ...param(value), setTargetAtTime: () => undefined, cancelAndHoldAtTime: () => undefined });
    const node = (kind: string) => {
      count(kind);
      return { connect: () => undefined, disconnect: () => undefined };
    };
    const ext = ctx as unknown as Record<string, unknown>;
    const gain = ctx.createGain;
    const osc = ctx.createOscillator;
    const source = ctx.createBufferSource;
    const shaper = ctx.createWaveShaper;
    Object.assign(ext, {
      createGain: () => {
        const g = gain();
        count("gain");
        Object.assign(g.gain, { setTargetAtTime: () => undefined, cancelAndHoldAtTime: () => undefined });
        return g;
      },
      createOscillator: () => {
        const o = osc();
        count("oscillator");
        return Object.assign(o, { detune: xparam(0), setPeriodicWave: () => undefined });
      },
      createBufferSource: () => {
        const b = source();
        count("bufferSource");
        return Object.assign(b, { loop: false });
      },
      createWaveShaper: () => {
        count("waveShaper");
        return shaper();
      },
      createBiquadFilter: () => ({ ...node("biquad"), type: "lowpass", frequency: xparam(350), Q: xparam(1), gain: xparam(0) }),
      createStereoPanner: () => ({ ...node("stereoPanner"), pan: xparam(0) }),
      createDelay: () => ({ ...node("delay"), delayTime: xparam(0) }),
      createPeriodicWave: () => {
        count("periodicWave");
        return {};
      },
    });
  }
  return { ctx, oscillators, sources, gains, compressors, made };
}
