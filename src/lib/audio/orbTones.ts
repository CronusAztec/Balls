import { SCALE_INTERVALS, midiToFrequency, type ScaleId } from "./scales";

/**
 * Bouncing Orbs' sound (feature orb-grid; lib/physics/modes/orbGrid.ts). One landing is one tone – but a field of thousands of
 * orbs lands thousands of times a second, so the landings of one 60 Hz step are grouped (`groupOrbLandings()`): every row of a
 * grid (every ring of a disc or octagons) that landed is one voice – a chord of its columns' pitches (a ring: its own note) –
 * and at most `MAX_NOTES_PER_STEP` voices leave the step, the loudest (the hardest and nearest landings) first; the mode then
 * keeps at most `MAX_ORB_EVENTS_PER_FRAME` of a frame's voices (8× playback runs eight steps a frame). Pitches are degrees of
 * the Sound section's scale on its root (`orbPitchHz()`; the chromatic default plays a major pentatonic, so thousands of
 * landings never clash), low columns / outer rings low.
 *
 * The variants: **notes** (the account's default – soft hits through the ToneGenerator's own path, so the bounce instrument,
 * the scale snap, the beat lock, hit samples, a melody and the song slicer apply), **sleep** (`scheduleOrbSleep()`: very
 * soft, a long low-passed release, at most one voice every `SLEEP_MIN_GAP_SEC`), **music** (the landings compose a melody:
 * the earliest landing of a step picks the next step through the scale, `orbMusicNext()`, at most one note every
 * `MUSIC_MIN_GAP_SEC`), **metal** (`scheduleOrbClink()`: a bright inharmonic clink for metallic orbs) and silent.
 */

/** Voices one step may queue (each a chord). */
export const MAX_NOTES_PER_STEP = 2;
/** Pitches one voice (a row's chord) plays at most. */
export const MAX_CHORD_NOTES = 3;
/** Voices one rendered frame passes on at most (the loudest), whatever the playback speed. */
export const MAX_ORB_EVENTS_PER_FRAME = 6;
/** The sleep sound: at most one voice this often (about three a second). */
export const SLEEP_MIN_GAP_SEC = 0.32;
/** The composed melody: at most one note this often. */
export const MUSIC_MIN_GAP_SEC = 0.14;
/** The metal clinks: at most one voice this often (a clink is four partials a pitch: ~200 oscillators a second at most). */
export const METAL_MIN_GAP_SEC = 0.06;
/** Degrees of the scale the pitch keys span (lowest column / outer ring → 0, the other end → this). */
export const PITCH_DEGREES = 14;
/** The lowest note (MIDI, before the root): C3. */
export const BASE_MIDI = 48;
/** The melody's steps through the scale, picked by the pitch key of the step's earliest landing. */
export const MUSIC_STEPS: readonly number[] = [1, -1, 2, -2, 3, -1, 1, -3, 0, 2, -2, 4];

/** One step's landings (one entry per orb that landed): its group (row / ring), its pitch key (column / ring), loudness, time. */
export interface OrbLandings {
  count: number;
  group: Int32Array;
  pitchKey: Int32Array;
  loud: Float32Array;
  time: Float64Array;
}

/** A voice of the step: its group, summed loudness, its pitch keys (ascending), and the earliest landing's key. */
export interface OrbVoice {
  group: number;
  loud: number;
  keys: number[];
  firstKey: number;
  firstTime: number;
  landings: number;
}

/** The reusable tables of `groupOrbLandings()` (sized for `n` landings a step). */
export interface OrbGroupScratch {
  mask: number;
  key: Int32Array;
  slotOf: Int32Array;
  used: Int32Array;
  loud: Float64Array;
  first: Float64Array;
  firstKey: Int32Array;
  landings: Int32Array;
  keys: Int32Array;
  keyLoud: Float32Array;
  keyCount: Int32Array;
  minKey: Int32Array;
  maxKey: Int32Array;
  overflow: Uint8Array;
  taken: Uint8Array;
}

export function createOrbGroupScratch(n: number): OrbGroupScratch {
  let size = 16;
  while (size < 2 * n + 16) size *= 2;
  const slots = Math.max(1, n);
  return {
    mask: size - 1,
    key: new Int32Array(size),
    slotOf: new Int32Array(size),
    used: new Int32Array(slots),
    loud: new Float64Array(slots),
    first: new Float64Array(slots),
    firstKey: new Int32Array(slots),
    landings: new Int32Array(slots),
    keys: new Int32Array(slots * MAX_CHORD_NOTES),
    keyLoud: new Float32Array(slots * MAX_CHORD_NOTES),
    keyCount: new Int32Array(slots),
    minKey: new Int32Array(slots),
    maxKey: new Int32Array(slots),
    overflow: new Uint8Array(slots),
    taken: new Uint8Array(slots),
  };
}

/**
 * Groups one step's landings into voices: one per group (a grid's row, a ring), the loudest `maxVoices` of them by summed
 * loudness, each with up to `maxChord` pitch keys – the keys that landed, or, when more landed, `maxChord` keys spread evenly
 * from its lowest to its highest. Writes the voices into `out` (objects reused) and returns how many. Allocation-free once
 * warm (`scratch` sized for the step's landings).
 */
export function groupOrbLandings(landings: OrbLandings, maxVoices: number, maxChord: number, scratch: OrbGroupScratch, out: OrbVoice[]): number {
  const n = landings.count;
  if (n <= 0 || maxVoices <= 0) return 0;
  const S = scratch;
  const chord = Math.max(1, Math.min(MAX_CHORD_NOTES, maxChord));
  let slots = 0;
  for (let k = 0; k < n; k++) {
    const g = landings.group[k];
    let h = (Math.imul(g + 1, 0x9e3779b1) >>> 0) & S.mask;
    while (S.key[h] !== 0 && S.key[h] !== g + 1) h = (h + 1) & S.mask;
    let slot: number;
    if (S.key[h] === 0) {
      if (slots >= S.used.length) continue; // (a scratch sized too small: the extra groups stay silent)
      S.key[h] = g + 1;
      slot = slots++;
      S.slotOf[h] = slot;
      S.used[slot] = h;
      S.loud[slot] = 0;
      S.first[slot] = Infinity;
      S.firstKey[slot] = 0;
      S.landings[slot] = 0;
      S.keyCount[slot] = 0;
      S.minKey[slot] = 2147483647;
      S.maxKey[slot] = -2147483648;
      S.overflow[slot] = 0;
      S.taken[slot] = 0;
    } else slot = S.slotOf[h];
    const loud = landings.loud[k];
    const key = landings.pitchKey[k];
    S.loud[slot] += loud;
    S.landings[slot]++;
    const t = landings.time[k];
    if (t < S.first[slot] || (t === S.first[slot] && key < S.firstKey[slot])) {
      S.first[slot] = t;
      S.firstKey[slot] = key;
    }
    if (key < S.minKey[slot]) S.minKey[slot] = key;
    if (key > S.maxKey[slot]) S.maxKey[slot] = key;
    const base = slot * MAX_CHORD_NOTES;
    const count = S.keyCount[slot];
    let found = false;
    for (let j = 0; j < count; j++) {
      if (S.keys[base + j] === key) {
        if (loud > S.keyLoud[base + j]) S.keyLoud[base + j] = loud;
        found = true;
        break;
      }
    }
    if (!found) {
      if (count < chord) {
        S.keys[base + count] = key;
        S.keyLoud[base + count] = loud;
        S.keyCount[slot] = count + 1;
      } else S.overflow[slot] = 1;
    }
  }
  // The loudest groups first (ties: the earlier landing, then the lower group).
  const made = Math.min(maxVoices, slots);
  for (let v = 0; v < made; v++) {
    let best = -1;
    for (let s = 0; s < slots; s++) {
      if (S.taken[s]) continue;
      if (best < 0 || S.loud[s] > S.loud[best] || (S.loud[s] === S.loud[best] && (S.first[s] < S.first[best] || (S.first[s] === S.first[best] && S.key[S.used[s]] < S.key[S.used[best]])))) best = s;
    }
    S.taken[best] = 1;
    const voice = (out[v] ??= { group: 0, loud: 0, keys: [], firstKey: 0, firstTime: 0, landings: 0 });
    voice.group = S.key[S.used[best]] - 1;
    voice.loud = S.loud[best];
    voice.firstKey = S.firstKey[best];
    voice.firstTime = S.first[best];
    voice.landings = S.landings[best];
    voice.keys.length = 0;
    if (S.overflow[best]) {
      const lo = S.minKey[best];
      const hi = S.maxKey[best];
      for (let j = 0; j < chord; j++) voice.keys.push(chord > 1 ? Math.round(lo + ((hi - lo) * j) / (chord - 1)) : lo);
    } else {
      const base = best * MAX_CHORD_NOTES;
      for (let j = 0; j < S.keyCount[best]; j++) voice.keys.push(S.keys[base + j]);
    }
    voice.keys.sort((a, b) => a - b);
    for (let j = voice.keys.length - 1; j > 0; j--) if (voice.keys[j] === voice.keys[j - 1]) voice.keys.splice(j, 1);
  }
  // Empty the hash table for the next step (only the slots this step used).
  for (let s = 0; s < slots; s++) S.key[S.used[s]] = 0;
  return made;
}

/** The scale the orbs play: the Sound section's, or a major pentatonic while it is chromatic. */
export function orbScaleIntervals(scale: ScaleId): readonly number[] {
  return SCALE_INTERVALS[scale === "chromatic" ? "pentatonic" : scale];
}

/**
 * The pitch (Hz) of pitch key `key` of `0 … maxKey` (`maxKey` < 0: `key` is a degree already): the key's degree of the scale
 * over `PITCH_DEGREES`, from C3 + the root, `octave` octaves up (metal) or down (sleep).
 */
export function orbPitchHz(key: number, maxKey: number, scale: ScaleId, root: number, octave: number): number {
  const intervals = orbScaleIntervals(scale);
  const degree = maxKey < 0 ? Math.round(key) : maxKey > 0 ? Math.round((Math.max(0, Math.min(maxKey, key)) / maxKey) * PITCH_DEGREES) : 0;
  const len = intervals.length;
  const oct = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return midiToFrequency(BASE_MIDI + (((root % 12) + 12) % 12) + 12 * (oct + octave) + intervals[idx]);
}

/** The melody's next degree: the step `MUSIC_STEPS` picks for the landing's key, reflected into 0 … PITCH_DEGREES. */
export function orbMusicNext(degree: number, key: number): number {
  const steps = MUSIC_STEPS;
  let d = degree + steps[((key % steps.length) + steps.length) % steps.length];
  const top = PITCH_DEGREES;
  if (d < 0) d = -d;
  if (d > top) d = 2 * top - d;
  return Math.max(0, Math.min(top, d));
}

/** A voice's loudness (0–1) from its summed landing loudness, by sound variant (the sleep sound stays very soft). */
export function orbLevel(loud: number, sound: string): number {
  const l = loud > 0 ? Math.min(1, Math.sqrt(loud) * 0.6) : 0;
  switch (sound) {
    case "sleep":
      return 0.1 + 0.25 * l;
    case "metal":
      return 0.12 + 0.48 * l;
    case "music":
      return 0.3 + 0.45 * l;
    default:
      return 0.14 + 0.5 * l;
  }
}

/* ------------------------------------------------------------------ synthesis */

/** The hit sample's loudness for the orbs' own sounds in sample mode (the sleep sound stays soft). */
export const ORB_SAMPLE_GAIN: Readonly<Record<"sleep" | "metal", number>> = { sleep: 0.35, metal: 0.8 };
/** The sleep sound's release (s) and low-pass cut-off (Hz). */
export const SLEEP_RELEASE_SEC = 1.8;
export const SLEEP_CUTOFF_HZ = 900;
/** The clink's partials (ratios to the pitch), their levels and decays (s): a small metal bell. */
export const CLINK_PARTIALS: readonly { ratio: number; gain: number; decay: number }[] = [
  { ratio: 1, gain: 1, decay: 0.42 },
  { ratio: 2.756, gain: 0.5, decay: 0.2 },
  { ratio: 5.404, gain: 0.26, decay: 0.1 },
  { ratio: 8.933, gain: 0.12, decay: 0.05 },
];

/**
 * The sleep sound: per pitch a soft sine pair (one 4 cents sharp) through a low-pass at `SLEEP_CUTOFF_HZ`, a slow attack and a
 * long exponential release – a pillow, not a tap. `level` 0–1.
 */
export function scheduleOrbSleep(ctx: BaseAudioContext, destination: AudioNode, frequencies: readonly number[], time: number, level: number) {
  const n = Math.max(1, frequencies.length);
  const peak = (0.16 * Math.max(0, level)) / Math.sqrt(n);
  if (!(peak > 0)) return;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = SLEEP_CUTOFF_HZ;
  filter.Q.value = 0.4;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peak, time + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + SLEEP_RELEASE_SEC);
  filter.connect(gain);
  gain.connect(destination);
  for (const f of frequencies) {
    if (!(f > 0)) continue;
    for (const detune of [0, 4]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + SLEEP_RELEASE_SEC + 0.05);
    }
  }
}

/** The metal clink: per pitch the inharmonic partials of `CLINK_PARTIALS`, each with its own fast decay. `level` 0–1. */
export function scheduleOrbClink(ctx: BaseAudioContext, destination: AudioNode, frequencies: readonly number[], time: number, level: number) {
  const n = Math.max(1, frequencies.length);
  const peak = (0.11 * Math.max(0, level)) / Math.sqrt(n);
  if (!(peak > 0)) return;
  for (const f of frequencies) {
    if (!(f > 0)) continue;
    for (const p of CLINK_PARTIALS) {
      const freq = f * p.ratio;
      if (freq > 18000) continue;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(peak * p.gain, time + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, time + p.decay);
      osc.connect(g);
      g.connect(destination);
      osc.start(time);
      osc.stop(time + p.decay + 0.02);
    }
  }
}
