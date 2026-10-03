import { PluckCache, playVoice, type InstrumentId } from "@/lib/audio/instruments";
import { nextGridTime, quantizeFrequency, type QuantizeGrid, type ScaleId } from "@/lib/audio/scales";
import { INTERACTION_TONES, scheduleInteractionTone, type InteractionKind } from "./interactionTones";
import { CHIRPS, scheduleChirp, type ChirpKind } from "./characterVoice"; // --- gerald-faces ---
import { arpeggioNotes, scheduleArpeggio } from "./multiplierTones"; // --- gerald-multipliers ---
import { DEFAULT_BUMPER_FREQUENCY, scheduleBumperTone } from "./bumperTone"; // --- obstacle-editor ---
import { NoiseCache, scheduleShatterBurst, scheduleStringPluck } from "./stringBattleTones"; // --- odd-string-battle ---
import { raceArpeggioNotes, scheduleRaceNotes, type RaceArpeggioKind } from "./raceTones"; // --- jdm-race ---
import { DEFAULT_PEW_FREQUENCY, pewWaveform, schedulePewTone } from "./pewTone"; // --- gerald-vortex ---
import { scheduleSwooshTone } from "./swooshTone"; // --- gerald-journey ---
import { DEFAULT_THUD_FREQUENCY, scheduleThudTone, thudLevel } from "./thudTone"; // --- gerald-bullseye ---
import { scheduleGulpTone } from "./gulpTone"; // --- unlimited ---
import { SPLAT_SAMPLE_GAIN, SPLAT_SAMPLE_RATE, scheduleSplatTone, splatLevel } from "./splatTone"; // --- gerald-exit-splat ---
import { DEFAULT_ACCENT_FREQUENCY, beatDropVoices, scheduleHat, scheduleKick, schedulePadAccent, scheduleSnare, type BeatDropVoices } from "./beatDropTones"; // --- beat-drop ---
import type { BeatDropPadKind } from "@/lib/simulation/beatDropPlan"; // --- beat-drop ---
import { DEFAULT_HUM_FREQUENCY, scheduleConveyorClick, scheduleConveyorHum } from "./conveyorTones"; // --- gerald-conveyor ---
import { fightDucks, scheduleFightSound } from "./fightTones"; // --- fight-league ---
import type { FightSoundKind } from "@/lib/physics/types"; // --- fight-league ---
import { MusicBed } from "./musicBed";
import { HitSampler, MAX_VOICES as MAX_SAMPLE_VOICES, hitSamplePlaybackRate, resolveHitSoundSource, wallHitFrequency, type HitSampleStatus, type HitSoundMode } from "./sampler";
import { SlicePlayer } from "./slicePlayer";
import { SameTimeVoices, createMasterBus } from "./masterBus"; // --- review fix (audio) ---
import { clockedAudioContext } from "./offlineContext"; // --- fast-render ---
import { nextGridPointSec } from "@/lib/simulation/beatSource"; // --- video-beats ---
import type { BeatClockConfig } from "@/lib/simulation/beatClock"; // --- video-beats ---

/**
 * Web Audio tone generator. Wall hits play short tones (descending pitch per wall layer,
 * or the next note of a loaded melody), a custom audio clip through the HitSampler in
 * "sample" mode, or the next slice of an uploaded song when the song slicer is on; gap
 * passes play a rising four-note arpeggio or a custom audio clip; a ball merge plays a low
 * tone and a split a high one (interactionTones.ts). Everything is routed
 * through a master gain and a limiter (masterBus.ts) to the speakers and also into a
 * MediaStreamDestination so the recorder can capture the audio track.
 *
 * A wall hit is dispatched in this order: song slicer (while it has a song to play), hit
 * sample (in "sample" mode, once the clip is decoded), otherwise a synthesised voice. The
 * music settings decide how that sound is made: the instrument voice (instruments.ts;
 * melody notes keep a voice of their own), the scale every pitch is snapped to and, when
 * the beat lock is on, the BPM grid the sound – voice or sample – is delayed onto
 * (scales.ts). With the defaults – triangle tones, sine melody, chromatic, lock off – the
 * output is exactly the classic bounce sound. A hit that accompanies the tune instead of
 * being a note of it (`SoundEvent.melody` false: a paddle's wall bounce, a runner's crash)
 * skips the slicer and the melody and leaves its beat-lock slot to the tune.
 *
 * Under all of that the background music bed (musicBed.ts) plays an uploaded track into the
 * same master gain, and every bounce / wall-break sound scheduled here ducks it at the sound's
 * own audio time, so the sidechain lines up with the beat-locked sounds as well.
 */
export interface MusicSettings {
  /** Voice of the wall tones. */
  instrument: InstrumentId;
  /** Voice of the melody notes (a loaded song); sine is the classic melody sound. */
  melodyInstrument: InstrumentId;
  scale: ScaleId;
  /** Semitones above C (0 = C … 11 = B). */
  rootNote: number;
  quantizeToBeat: boolean;
  bpm: number;
  quantizeGrid: QuantizeGrid;
}

export const DEFAULT_MUSIC_SETTINGS: MusicSettings = { instrument: "triangle", melodyInstrument: "sine", scale: "chromatic", rootNote: 0, quantizeToBeat: false, bpm: 120, quantizeGrid: "1/8" };

/** The classic gap-pass arpeggio (C5 E5 G5 C6), snapped to the current scale before playing. */
const GAP_ARPEGGIO = [523.25, 659.25, 783.99, 1046.5];
/** An accented hit (a DVD logo in a corner, a full pendulum chord) plays this much louder and longer than a plain one. */
export const ACCENT_GAIN = 1.6;
export const ACCENT_LENGTH = 1.6;
/** Most notes of one chord that are voiced (a Pendulum Wave with more bobs in line shares the rest). */
export const MAX_CHORD_VOICES = 12;

/** Level of each note of an n-note chord, so a chord is louder than one note but never n times as loud. */
export function chordGain(notes: number): number {
  return 1 / Math.sqrt(Math.max(1, notes));
}

// --- jdm-collisions ---
/** The loudness factor of a hit's `level` (clamped to 0–1; anything that is not a number is a normal hit). */
export function hitLevel(level: number | undefined): number {
  if (typeof level !== "number" || !Number.isFinite(level)) return 1;
  return Math.max(0, Math.min(1, level));
}

/** The distinct pitches a hit plays: the chord when it carries one, else the single pitch (or the wall tone). */
export function hitPitches(wallIndex: number, pitch: number | undefined, chord: readonly number[] | undefined, max = MAX_CHORD_VOICES): number[] {
  if (chord && chord.length > 1) {
    const out: number[] = [];
    for (const f of chord) {
      if (f > 0 && !out.includes(f)) out.push(f);
      if (out.length >= max) break;
    }
    if (out.length > 0) return out;
  }
  return [pitch !== undefined && pitch > 0 ? pitch : wallHitFrequency(wallIndex)];
}

export class ToneGenerator {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStreamDestination: MediaStreamAudioDestinationNode | null = null;
  private masterGain: GainNode | null = null;
  private silentOsc: OscillatorNode | null = null;
  private isPlaying = false;
  private isInitialized = false;
  private customNotes: number[] = [];
  private customNoteIndex = 0;
  private lastCustomNoteTime = 0;
  private readonly NOTE_COOLDOWN = 0.12;
  private wallBreakSoundUrl: string | null = null;
  private wallBreakBuffer: AudioBuffer | null = null;
  private wallBreakDecoding = false;
  /** --- review fix (audio) --- The wall-break clip that could not be fetched or decoded: the synthesised effects play instead and it is not fetched again. */
  private wallBreakFailedUrl: string | null = null;
  private volume = 1;
  private sampler: HitSampler | null = null;
  private hitSoundMode: HitSoundMode = "tones";
  private hitSampleUrl: string | null = null;
  private hitSamplePitchByWall = true;
  private hitSampleVolume = 1;
  private hitSampleStatusListener: ((status: HitSampleStatus) => void) | null = null;
  /** Song slicer: plays the next bit of an uploaded song on every bounce (see slicePlayer.ts). */
  private readonly slicer = new SlicePlayer();
  /** Background music bed, ducked by every bounce sound (see musicBed.ts). */
  private readonly musicBed = new MusicBed();
  private music: MusicSettings = { ...DEFAULT_MUSIC_SETTINGS };
  private readonly pluckCache = new PluckCache();
  /** AudioContext time the beat grid counts from (the moment the run started). */
  private gridOrigin = 0;
  /** Grid slot already holding a bounce sound; later hits in the same slot are dropped. */
  private lastSlotTime = -1;
  // --- video-beats --- the beat lock on a video's beats or hand-placed markers: the grid (simulation seconds) and the
  // simulation clock the hits are placed on (null = the BPM grid anchored at the run's start, as before)
  private beatSourceClock: BeatClockConfig | null = null;
  private beatSourceSimTime: (() => number) | null = null;
  // --- review fix (audio) --- the synth voices and the hit-sample voices a wall hit started at the current scheduling time
  // (same-time identical voices add up to √n × one, and one time starts at most MAX_CHORD_VOICES / MAX_SAMPLE_VOICES)
  private readonly synthStack = new SameTimeVoices(MAX_CHORD_VOICES);
  private readonly sampleStack = new SameTimeVoices(MAX_SAMPLE_VOICES);

  async start() {
    if (this.isPlaying) return;
    this.initAudioGraph();
    if (this.audioContext && this.audioContext.state === "suspended") await this.audioContext.resume();
    this.isPlaying = true;
    this.resetBeatGrid();
  }

  /** Instruments (wall tones / melody), scale and beat lock; applied to every sound scheduled from now on. */
  setMusicSettings(music: MusicSettings) {
    this.music = { ...music };
    this.lastSlotTime = -1;
  }

  getMusicSettings(): MusicSettings {
    return { ...this.music };
  }

  // --- video-beats ---
  /**
   * The beat lock follows `clock` (a media or manual beat grid; beatSource.ts) instead of the BPM: a sound is delayed to
   * the next point of that grid – subdivided by the grid setting (1/4 = the beats, 1/8 halves, 1/16 quarters) – measured
   * on the simulation clock `simTime` (seconds), so it lands where the music bed's beat is. Null restores the BPM grid.
   */
  setBeatSourceClock(clock: BeatClockConfig | null, simTime: (() => number) | null) {
    this.beatSourceClock = clock;
    this.beatSourceSimTime = clock ? simTime : null;
    this.lastSlotTime = -1;
  }
  // --- end video-beats ---

  /** Re-anchors the beat grid at "now" (call when a run starts or restarts). */
  resetBeatGrid() {
    this.gridOrigin = this.audioContext?.currentTime ?? 0;
    this.lastSlotTime = -1;
  }

  /**
   * When the beat lock is on, the AudioContext time of the next grid point (at most one grid
   * step away); otherwise `now`. The grid maths itself is the pure `nextGridTime()`.
   */
  private scheduleTime(now: number): number {
    if (!this.music.quantizeToBeat) return now;
    // --- video-beats --- on a media / manual grid: the delay to its next point on the simulation clock
    if (this.beatSourceClock && this.beatSourceSimTime) {
      const sim = this.beatSourceSimTime();
      const next = nextGridPointSec(this.beatSourceClock, sim - 0.001, this.music.quantizeGrid === "1/4" ? 1 : this.music.quantizeGrid === "1/8" ? 2 : 4);
      if (Number.isFinite(next)) return now + Math.max(0, next - sim);
    }
    return nextGridTime(now, this.music.bpm, this.music.quantizeGrid, this.gridOrigin);
  }

  private snap(frequency: number): number {
    return quantizeFrequency(frequency, this.music.scale, this.music.rootNote);
  }

  private initAudioGraph() {
    if (this.isInitialized) return;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = this.audioContext || new Ctor();
      if (!this.masterGain) {
        // --- review fix (audio) --- the master gain feeds the speakers and the recording through the limiter (masterBus.ts)
        this.mediaStreamDestination = this.mediaStreamDestination || this.audioContext.createMediaStreamDestination();
        this.masterGain = createMasterBus(this.audioContext, [this.audioContext.destination, this.mediaStreamDestination], this.volume);
      }
      // The music bed shares the master gain too, so it is heard and recorded like every other sound.
      this.musicBed.attach(this.audioContext, this.masterGain);
      // A near-silent oscillator keeps the recorded audio track alive between hits.
      if (!this.silentOsc && this.mediaStreamDestination) {
        this.silentOsc = this.audioContext.createOscillator();
        this.silentOsc.frequency.value = 1;
        const g = this.audioContext.createGain();
        g.gain.value = 0.001;
        this.silentOsc.connect(g);
        g.connect(this.mediaStreamDestination);
        this.silentOsc.start();
      }
      if (!this.analyser) {
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;
        this.analyser.connect(this.masterGain);
      }
      if (!this.sampler) {
        // Hit samples share the master gain, so they reach the speakers and the recording.
        this.sampler = new HitSampler(this.audioContext, this.masterGain);
        this.sampler.setVolume(this.hitSampleVolume);
        this.sampler.setStatusListener(this.hitSampleStatusListener);
      }
      this.isInitialized = true;
      this.ensureHitSampleLoaded();
    } catch (err) {
      console.error("Failed to create audio context:", err);
    }
  }

  /* ------------------------------------------------------------ hit samples */

  /** "tones" (synth / melody) or "sample" (the clip set with setHitSample). */
  setHitSoundMode(mode: HitSoundMode) {
    this.hitSoundMode = mode;
    if (mode === "sample") this.ensureHitSampleLoaded();
  }

  /** Asset path or blob: URL of the clip to play on every wall hit (null clears it). */
  setHitSample(url: string | null) {
    if (this.hitSampleUrl === url) return;
    this.hitSampleUrl = url;
    if (!url) {
      void this.sampler?.load(null);
      return;
    }
    if (this.hitSoundMode === "sample") this.ensureHitSampleLoaded();
  }

  setHitSamplePitchByWall(enabled: boolean) {
    this.hitSamplePitchByWall = enabled;
  }

  setHitSampleVolume(volume: number) {
    this.hitSampleVolume = Math.max(0, Number.isFinite(volume) ? volume : 1); // --- uncap-all --- past 1 amplifies the clip (it may clip)
    this.sampler?.setVolume(this.hitSampleVolume);
  }

  /**
   * Decodes the selected clip once sample mode is on. Creates the audio graph if needed
   * (initAudioGraph calls back here once the sampler exists); the sampler itself dedupes
   * repeated loads of the same URL.
   */
  private ensureHitSampleLoaded() {
    if (this.hitSoundMode !== "sample" || !this.hitSampleUrl) return;
    if (!this.isInitialized) {
      this.initAudioGraph();
      return;
    }
    const sampler = this.sampler;
    if (!sampler || sampler.getLoadedUrl() === this.hitSampleUrl) return;
    void sampler.load(this.hitSampleUrl);
  }

  isHitSampleReady(): boolean {
    return !!this.sampler?.isReady();
  }

  /** "idle" | "loading" | "ready" | "error" for the selected clip; an "error" means the tones are playing instead. */
  getHitSampleStatus(): HitSampleStatus {
    return this.sampler?.getStatus() ?? "idle";
  }

  /** Reports every change of `getHitSampleStatus()` (also across audio-graph rebuilds), so the panel can show it. */
  setHitSampleStatusListener(listener: ((status: HitSampleStatus) => void) | null) {
    this.hitSampleStatusListener = listener;
    this.sampler?.setStatusListener(listener);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.volume;
  }

  getAudioStream(): MediaStream | null {
    return this.mediaStreamDestination?.stream || null;
  }

  setCustomNotes(notes: number[]) {
    this.customNotes = notes;
    this.customNoteIndex = 0;
    this.lastCustomNoteTime = 0;
  }
  clearCustomNotes() {
    this.setCustomNotes([]);
  }
  hasCustomNotes() {
    return this.customNotes.length > 0;
  }
  resetCustomNoteIndex() {
    this.customNoteIndex = 0;
    this.lastCustomNoteTime = 0;
  }
  getCustomNoteCount() {
    return this.customNotes.length;
  }

  /* ------------------------------------------------------------ song slicer & music bed */

  getSlicer() {
    return this.slicer;
  }

  /** The background music bed (transport and options are driven by the Simulator). */
  getMusicBed() {
    return this.musicBed;
  }

  /** Decodes an uploaded audio file (MP3, OGG, WAV, M4A…) with the browser's audio decoder. */
  async decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
    this.initAudioGraph();
    if (!this.audioContext) throw new Error("Web Audio is not available");
    return this.audioContext.decodeAudioData(data);
  }

  /** Song position of the slicer as a 0–1 fraction, or null while the slicer is not in use. */
  getSliceProgress(): number | null {
    if (!this.slicer.isActive()) return null;
    return this.slicer.getProgress(this.audioContext?.currentTime ?? 0);
  }

  /**
   * A wall (or obstacle) bounce. `frequency` is an optional pitch in Hz chosen by the mode (Ball Drop maps
   * it from the ball's size); without it the wall index picks the classic descending tone. Either way the
   * pitch is snapped to the current scale, a hit sample is transposed to it and a loaded melody still plays
   * its next note instead. An `accent` (a DVD logo hitting a corner) plays louder and longer – voice, melody
   * note or sample alike. A `chord` (Pendulum Wave bobs in line) plays all its pitches at once as one sound:
   * one beat-grid slot, one duck, the level shared out with `chordGain()`; a melody still plays one note, and so
   * does a hit sample that is not pitched by wall (the copies would all sound the same).
   * `level` (0–1, default 1) scales the loudness of this one hit – voice, melody note or sample (the Collision
   * Playground's soft collision notes, softer still for gentle impacts; see `hitLevel()`).
   * `melody` false (--- jdm-rhythm-runner --- `SoundEvent.melody`): a hit that accompanies the tune instead of being a
   * note of it – a paddle's wall or ceiling bounce, a miss, a runner's crash. It skips the song slicer and the melody (it
   * plays its own pitch or chord with the bounce instrument, or the hit sample), waits out no melody cooldown and never
   * takes a beat-lock slot (it is still dropped from a slot the tune already holds), so it never uses up or silences a
   * note of the song.
   */
  playWallHit(wallIndex = 0, frequency?: number, accent = false, chord?: readonly number[], level = 1, melody = true) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleHit(wallIndex, frequency, accent, chord, level, melody));
      return;
    }
    this.scheduleHit(wallIndex, frequency, accent, chord, level, melody);
  }

  private scheduleHit(wallIndex: number, pitch?: number, accent = false, chord?: readonly number[], level = 1, melody = true) {
    // --- jdm-collisions --- a per-hit loudness (soft collision notes); 1 leaves every other hit as it was.
    const softness = hitLevel(level);
    if (!this.audioContext || !this.masterGain) return;
    const now = this.audioContext.currentTime;
    // 1. The song slicer takes over the bounce sound while it has a song to play (not for an accompaniment hit).
    if (melody && this.slicer.trigger(this.audioContext, this.masterGain)) {
      this.musicBed.duck(now);
      return;
    }
    // 2. Sample mode: the clip, pitched per wall and placed on the beat grid like every other sound.
    if (resolveHitSoundSource(this.hitSoundMode, !!this.sampler?.isReady()) === "sample") {
      const time = this.scheduleTime(now);
      if (this.music.quantizeToBeat && Math.abs(time - this.lastSlotTime) < 1e-6) return;
      if (melody) this.lastSlotTime = time; // an accompaniment hit leaves its slot to the tune
      // Without "pitch by wall" every copy of a chord would play at the same rate, and n identical copies only add up
      // √n times louder (and take every voice): the clip then plays once for the whole chord.
      const pitches = this.hitSamplePitchByWall ? hitPitches(wallIndex, pitch, chord, MAX_SAMPLE_VOICES) : [pitch];
      const level = (accent ? ACCENT_GAIN : 1) * chordGain(pitches.length);
      for (const f of pitches) {
        const rate = hitSamplePlaybackRate(wallIndex, this.hitSamplePitchByWall, pitches.length > 1 || pitch !== undefined ? f : undefined);
        const stack = this.sampleStack.add(time, "sample", rate); // --- review fix (audio) --- same-time copies add up to √n
        if (stack > 0) this.sampler!.play(rate, time, level * softness * stack);
      }
      this.musicBed.duck(time);
      return;
    }
    // 3. A synthesised voice: the next melody note or the wall tone, snapped to the scale.
    try {
      let notes: number[];
      let duration: number;
      let gain: number;
      const melodyNote = melody && this.customNotes.length > 0;
      if (melodyNote) {
        if (now - this.lastCustomNoteTime < this.NOTE_COOLDOWN) return;
        notes = [this.customNotes[this.customNoteIndex % this.customNotes.length]];
        duration = 0.25;
        gain = 0.35;
      } else {
        notes = hitPitches(wallIndex, pitch, chord);
        duration = 0.15;
        gain = 0.25 * chordGain(notes.length);
      }
      if (accent) {
        gain = Math.min(0.6, gain * ACCENT_GAIN);
        duration *= ACCENT_LENGTH;
      }
      if (softness !== 1) gain *= softness;
      const time = this.scheduleTime(now);
      // Beat lock: one bounce sound per grid slot, so the export sits cleanly on the beat (an accompaniment hit only
      // fills a free slot, it never takes one from the tune).
      if (this.music.quantizeToBeat && Math.abs(time - this.lastSlotTime) < 1e-6) return;
      if (melody) this.lastSlotTime = time;
      if (melodyNote) {
        this.lastCustomNoteTime = now;
        this.customNoteIndex++;
      }
      // Melody notes keep their own voice (sine by default), so a song sounds as it always did.
      const instrument = melodyNote ? this.music.melodyInstrument : this.music.instrument;
      for (const frequency of notes) {
        const snapped = this.snap(frequency);
        // --- review fix (audio) --- hits of one frame on one wall start in phase: n of them add up to √n × one, not n ×
        const stack = this.synthStack.add(time, instrument, snapped);
        if (stack > 0) playVoice(this.audioContext, this.masterGain, instrument, { frequency: snapped, time, duration, gain: gain * stack }, this.pluckCache);
      }
      this.musicBed.duck(time);
    } catch (err) {
      console.error("Error playing wall hit sound:", err);
    }
  }

  playGapPass() {
    if (this.useWallBreakClip()) {
      this.playWallBreakBuffer();
      return;
    }
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleGapPass());
      return;
    }
    this.scheduleGapPass();
  }

  private scheduleGapPass() {
    if (!this.audioContext || !this.masterGain) return;
    try {
      const start = this.scheduleTime(this.audioContext.currentTime);
      GAP_ARPEGGIO.forEach((freq, i) => {
        const osc = this.audioContext!.createOscillator();
        const g = this.audioContext!.createGain();
        osc.type = "sine";
        osc.frequency.value = this.snap(freq);
        osc.connect(g);
        g.connect(this.masterGain!);
        const t = start + 0.06 * i;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
        osc.start(t);
        osc.stop(t + 0.25);
      });
      this.musicBed.duck(start);
    } catch (err) {
      console.error("Error playing gap pass sound:", err);
    }
  }

  /** Ball interaction sounds: a low tone when two balls merge, a high one when a ball splits (see interactionTones.ts). */
  playInteraction(kind: InteractionKind) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleInteraction(kind));
      return;
    }
    this.scheduleInteraction(kind);
  }

  private scheduleInteraction(kind: InteractionKind) {
    if (!this.audioContext || !this.masterGain) return;
    try {
      // On the beat grid and snapped to the scale like every other sound, and it ducks the music bed too.
      const time = this.scheduleTime(this.audioContext.currentTime);
      scheduleInteractionTone(this.audioContext, this.masterGain, INTERACTION_TONES[kind], time, (f) => this.snap(f));
      this.musicBed.duck(time);
    } catch (err) {
      console.error(`Error playing ${kind} sound:`, err);
    }
  }

  // --- gerald-faces ---
  /** Cat face: a meow-like chirp for an ouch, a breaking wall or an escape (see characterVoice.ts). */
  playCharacterChirp(kind: ChirpKind) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleCharacterChirp(kind));
      return;
    }
    this.scheduleCharacterChirp(kind);
  }

  private scheduleCharacterChirp(kind: ChirpKind) {
    if (!this.audioContext || !this.masterGain) return;
    try {
      // On the beat grid and snapped to the scale like every other sound, and it ducks the music bed too.
      const time = this.scheduleTime(this.audioContext.currentTime);
      scheduleChirp(this.audioContext, this.masterGain, CHIRPS[kind], time, (f) => this.snap(f));
      this.musicBed.duck(time);
    } catch (err) {
      console.error(`Error playing the ${kind} chirp:`, err);
    }
  }
  // --- end gerald-faces ---

  // --- gerald-multipliers ---
  /**
   * A stat multiplier stacked (a pickup orb, a gate): a rising arpeggio that climbs with the new `total`
   * (multiplierTones.ts). It goes the way a bounce goes – the next slice while the song slicer plays, the hit sample
   * transposed to every note in sample mode, otherwise the bounce instrument (a loaded melody roots it on its next note
   * with the melody voice) – snapped to the scale, its first note on the beat grid (one slot), ducking the music bed.
   * `melody` false (--- jdm-rhythm-runner --- `SoundEvent.melody`, Paddle Keep-Up's streak chime): the arpeggio
   * accompanies the tune – no slice, no melody root, the bounce instrument, no beat-lock slot of its own – like an
   * accompaniment hit (`playWallHit()`), so it never uses up a note of the song.
   */
  playMultiplier(total: number, melody = true) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleMultiplier(total, melody));
      return;
    }
    this.scheduleMultiplier(total, melody);
  }

  private scheduleMultiplier(total: number, melody = true) {
    if (!this.audioContext || !this.masterGain) return;
    try {
      const now = this.audioContext.currentTime;
      if (melody && this.slicer.trigger(this.audioContext, this.masterGain)) {
        this.musicBed.duck(now);
        return;
      }
      const time = this.scheduleTime(now);
      if (this.music.quantizeToBeat && Math.abs(time - this.lastSlotTime) < 1e-6) return;
      if (melody) this.lastSlotTime = time;
      const melodyNote = melody && this.customNotes.length > 0;
      const root = melodyNote ? this.customNotes[this.customNoteIndex % this.customNotes.length] : undefined;
      if (melodyNote) {
        this.customNoteIndex++;
        this.lastCustomNoteTime = now;
      }
      const notes = arpeggioNotes(total, root);
      if (resolveHitSoundSource(this.hitSoundMode, !!this.sampler?.isReady()) === "sample") {
        for (const note of notes) this.sampler!.play(hitSamplePlaybackRate(0, true, this.snap(note.frequency)), time + note.offset, note.gain / 0.25);
      } else {
        scheduleArpeggio(this.audioContext, this.masterGain, melodyNote ? this.music.melodyInstrument : this.music.instrument, notes, time, (f) => this.snap(f), this.pluckCache);
      }
      this.musicBed.duck(time);
    } catch (err) {
      console.error("Error playing the multiplier arpeggio:", err);
    }
  }
  // --- end gerald-multipliers ---

  // --- obstacle-editor ---
  /**
   * A bumper of the obstacle editor kicked a ball: the pinball ding (bumperTone.ts) at `frequency`, snapped to the
   * scale, on the beat grid when the beat lock is on (sharing the one-sound-per-slot rule of the bounces) and ducking
   * the music bed. It is an effect like the gap-pass arpeggio, so it plays whatever the hit sound mode is.
   */
  playBumper(frequency = DEFAULT_BUMPER_FREQUENCY) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleBumper(frequency));
      return;
    }
    this.scheduleBumper(frequency);
  }

  private scheduleBumper(frequency: number) {
    if (!this.audioContext || !this.masterGain) return;
    try {
      const time = this.scheduleTime(this.audioContext.currentTime);
      if (this.music.quantizeToBeat && Math.abs(time - this.lastSlotTime) < 1e-6) return;
      this.lastSlotTime = time;
      scheduleBumperTone(this.audioContext, this.masterGain, frequency, time, (f) => this.snap(f));
      this.musicBed.duck(time);
    } catch (err) {
      console.error("Error playing the bumper sound:", err);
    }
  }
  // --- end obstacle-editor ---

  // --- odd-string-battle ---
  private readonly noiseCache = new NoiseCache();

  /**
   * A String Battle effect (stringBattleTones.ts): a cut thread's pluck at `frequency` – a Karplus–Strong string, or the
   * hit sample transposed to it in sample mode – or a ball's shatter – the chosen wall-break clip when there is one, else
   * a glassy noise burst. Snapped to the scale, on the beat grid when the beat lock is on, ducking the music bed – an
   * effect like the gap arpeggio and the bumper ding, so it never steals a bounce's slot.
   */
  playStringBattle(kind: "pluck" | "shatter", frequency?: number) {
    if (kind === "shatter" && this.useWallBreakClip()) {
      this.playWallBreakBuffer();
      return;
    }
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleStringBattle(kind, frequency));
      return;
    }
    this.scheduleStringBattle(kind, frequency);
  }

  private scheduleStringBattle(kind: "pluck" | "shatter", frequency?: number) {
    if (!this.audioContext || !this.masterGain) return;
    try {
      const time = this.scheduleTime(this.audioContext.currentTime);
      if (kind === "pluck") {
        const pitch = frequency !== undefined && frequency > 0 ? frequency : 440;
        if (resolveHitSoundSource(this.hitSoundMode, !!this.sampler?.isReady()) === "sample") this.sampler!.play(hitSamplePlaybackRate(0, true, this.snap(pitch)), time, 0.9);
        else scheduleStringPluck(this.audioContext, this.masterGain, pitch, time, (f) => this.snap(f), this.pluckCache);
      } else scheduleShatterBurst(this.audioContext, this.masterGain, time, this.noiseCache.get(this.audioContext));
      this.musicBed.duck(time);
    } catch (err) {
      console.error(`Error playing the string battle ${kind}:`, err);
    }
  }
  // --- end odd-string-battle ---

  // --- jdm-race ---
  /**
   * A tune of the Square Racing Grand Prix (raceTones.ts): the rising chime of a pass or the winner's fanfare, rooted on
   * `root` (Hz) when given. It goes the way a bounce goes – the next slice while the song slicer plays, the hit sample
   * transposed to every note in sample mode, otherwise the bounce instrument (a loaded melody roots it on its next note
   * with the melody voice) – snapped to the scale, its first note on the beat grid (one slot), ducking the music bed.
   */
  playRaceArpeggio(kind: RaceArpeggioKind, root?: number) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleRaceArpeggio(kind, root));
      return;
    }
    this.scheduleRaceArpeggio(kind, root);
  }

  private scheduleRaceArpeggio(kind: RaceArpeggioKind, root?: number) {
    if (!this.audioContext || !this.masterGain) return;
    try {
      const now = this.audioContext.currentTime;
      if (this.slicer.trigger(this.audioContext, this.masterGain)) {
        this.musicBed.duck(now);
        return;
      }
      const time = this.scheduleTime(now);
      if (this.music.quantizeToBeat && Math.abs(time - this.lastSlotTime) < 1e-6) return;
      this.lastSlotTime = time;
      const melody = this.customNotes.length > 0;
      let base = root;
      if (melody) {
        base = this.customNotes[this.customNoteIndex % this.customNotes.length];
        this.customNoteIndex++;
        this.lastCustomNoteTime = now;
      }
      const notes = raceArpeggioNotes(kind, base);
      if (resolveHitSoundSource(this.hitSoundMode, !!this.sampler?.isReady()) === "sample") {
        for (const note of notes) this.sampler!.play(hitSamplePlaybackRate(0, true, this.snap(note.frequency)), time + note.offset, note.gain / 0.25);
      } else {
        scheduleRaceNotes(this.audioContext, this.masterGain, melody ? this.music.melodyInstrument : this.music.instrument, notes, time, (f) => this.snap(f), this.pluckCache);
      }
      this.musicBed.duck(time);
    } catch (err) {
      console.error(`Error playing the race ${kind}:`, err);
    }
  }
  // --- end jdm-race ---

  // --- gerald-vortex ---
  /**
   * A ball swallowed by the Sound Vortex: the "pew" (pewTone.ts) – a fast downward sweep from `frequency`, snapped to the
   * scale, in the waveform of the bounce instrument, on the beat grid when the beat lock is on, ducking the music bed. It
   * is an effect like the gap arpeggio (it never takes a bounce's beat-grid slot); a chosen wall-break clip plays instead.
   */
  playPew(frequency = DEFAULT_PEW_FREQUENCY) {
    if (this.useWallBreakClip()) {
      this.playWallBreakBuffer();
      return;
    }
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.schedulePew(frequency));
      return;
    }
    this.schedulePew(frequency);
  }

  private schedulePew(frequency: number) {
    if (!this.audioContext || !this.masterGain) return;
    try {
      const time = this.scheduleTime(this.audioContext.currentTime);
      schedulePewTone(this.audioContext, this.masterGain, frequency, time, (f) => this.snap(f), pewWaveform(this.music.instrument));
      this.musicBed.duck(time);
    } catch (err) {
      console.error("Error playing the pew:", err);
    }
  }
  // --- end gerald-vortex ---

  // --- gerald-journey ---
  /**
   * A Journey stage transition: the swoosh (swooshTone.ts) – band-passed noise sweeping up with a quiet sine glide under
   * it. An effect, not a note (never snapped, never a melody note, a hit sample or a song slice, never a bounce's beat-grid
   * slot): on the beat grid when the beat lock is on, ducking the music bed.
   */
  playSwoosh() {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleSwoosh());
      return;
    }
    this.scheduleSwoosh();
  }

  private scheduleSwoosh() {
    if (!this.audioContext || !this.masterGain) return;
    try {
      const time = this.scheduleTime(this.audioContext.currentTime);
      scheduleSwooshTone(this.audioContext, this.masterGain, time, this.noiseCache.get(this.audioContext));
      this.musicBed.duck(time);
    } catch (err) {
      console.error("Error playing the swoosh:", err);
    }
  }
  // --- end gerald-journey ---
  // --- gerald-bullseye ---
  /**
   * A Bullseye landing: the thud (thudTone.ts) at `frequency` – the ring's pitch –, `level` loud (0–1), snapped to the
   * scale, on the beat grid when the beat lock is on (it never takes a bounce's slot), ducking the music bed; in sample
   * mode the hit sample plays instead, two octaves above the thud's pitch.
   */
  playThud(frequency = DEFAULT_THUD_FREQUENCY, level = 1) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleThud(frequency, level));
      return;
    }
    this.scheduleThud(frequency, level);
  }

  private scheduleThud(frequency: number, level: number) {
    if (!this.audioContext || !this.masterGain) return;
    try {
      const time = this.scheduleTime(this.audioContext.currentTime);
      // The sample plays two octaves above the thud (a bass pitch would stretch the clip six times over).
      if (resolveHitSoundSource(this.hitSoundMode, !!this.sampler?.isReady()) === "sample") this.sampler!.play(hitSamplePlaybackRate(0, true, 4 * this.snap(frequency)), time, thudLevel(level));
      else scheduleThudTone(this.audioContext, this.masterGain, frequency, time, (f) => this.snap(f), level);
      this.musicBed.duck(time);
    } catch (err) {
      console.error("Error playing the thud:", err);
    }
  }
  // --- end gerald-bullseye ---
  // --- unlimited ---
  /**
   * A ball ate the arena (No limits): the gulp (gulpTone.ts) – a diving swallow, a chomp and a blip. An effect, not a note
   * (never snapped, never a melody note, a hit sample or a song slice): on the beat grid when the beat lock is on, ducking
   * the music bed.
   */
  playArenaEaten() {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleArenaEaten());
      return;
    }
    this.scheduleArenaEaten();
  }

  private scheduleArenaEaten() {
    if (!this.audioContext || !this.masterGain) return;
    try {
      const time = this.scheduleTime(this.audioContext.currentTime);
      scheduleGulpTone(this.audioContext, this.masterGain, time, this.noiseCache.get(this.audioContext));
      this.musicBed.duck(time);
    } catch (err) {
      console.error("Error playing the gulp:", err);
    }
  }
  // --- end unlimited ---

  // --- beat-drop ---
  private readonly bdVoices: BeatDropVoices = { kick: 0, snare: 0, hat: 0, accent: 0 };

  /**
   * A Beat Drop drum hit (beatDropTones.ts): the event's drum – the kick (louder on the downbeat, `accent`), the snare or the
   * off-beat hat – and the accent of the pad the ball landed on (`pad`) at `frequency`, snapped to the scale. It accompanies
   * the tune: it never uses up a melody note or a slicer slice and takes no beat-lock slot (the landing's note, when the mode
   * plays one, is an ordinary hit). With a music bed loaded the bed leads – only the downbeat's kick and the accents play
   * (`beatDropVoices()`). On the beat grid when the beat lock is on; the kick and the accent duck the music bed.
   */
  playBeatDrop(drum: string | undefined, pad: BeatDropPadKind | undefined, frequency?: number, accent = false, level = 1) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleBeatDrop(drum, pad, frequency, accent, level));
      return;
    }
    this.scheduleBeatDrop(drum, pad, frequency, accent, level);
  }

  private scheduleBeatDrop(drum: string | undefined, pad: BeatDropPadKind | undefined, frequency: number | undefined, accent: boolean, level: number) {
    if (!this.audioContext || !this.masterGain) return;
    try {
      const ctx = this.audioContext;
      const out = this.masterGain;
      const time = this.scheduleTime(ctx.currentTime);
      const v = beatDropVoices(drum, !!pad, this.musicBed.hasTrack(), accent, this.bdVoices);
      const l = hitLevel(level);
      const noise = this.noiseCache.get(ctx);
      if (v.kick > 0) scheduleKick(ctx, out, time, v.kick * l);
      if (v.snare > 0) scheduleSnare(ctx, out, time, noise, v.snare * l);
      if (v.hat > 0) scheduleHat(ctx, out, time, noise, v.hat * l);
      if (v.accent > 0 && pad) schedulePadAccent(ctx, out, pad, this.snap(frequency !== undefined && frequency > 0 ? frequency : DEFAULT_ACCENT_FREQUENCY), time, noise, v.accent * l);
      if (v.kick > 0 || v.accent > 0) this.musicBed.duck(time);
    } catch (err) {
      console.error("Error playing the beat drop hit:", err);
    }
  }
  // --- end beat-drop ---

  // --- gerald-conveyor ---
  /**
   * The Conveyor Belt's machinery (conveyorTones.ts): "hum" – the belt's motor while it carries a ball, `seconds` long, at
   * `frequency` – or "click" – a ball dropping off the belt (or a respawn dropping in). Machinery, not notes: never snapped,
   * never a melody note, a hit sample or a song slice, never a bounce's beat-grid slot; on the beat grid when the beat lock is
   * on; the click ducks the music bed (the hum sits under it).
   */
  playConveyor(kind: "hum" | "click", seconds?: number, frequency?: number, level = 1) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleConveyor(kind, seconds, frequency, level));
      return;
    }
    this.scheduleConveyor(kind, seconds, frequency, level);
  }

  private scheduleConveyor(kind: "hum" | "click", seconds: number | undefined, frequency: number | undefined, level: number) {
    if (!this.audioContext || !this.masterGain) return;
    try {
      const ctx = this.audioContext;
      const time = this.scheduleTime(ctx.currentTime);
      if (kind === "hum") scheduleConveyorHum(ctx, this.masterGain, frequency !== undefined && frequency > 0 ? frequency : DEFAULT_HUM_FREQUENCY, time, seconds ?? 1, hitLevel(level));
      else {
        scheduleConveyorClick(ctx, this.masterGain, time, this.noiseCache.get(ctx), hitLevel(level));
        this.musicBed.duck(time);
      }
    } catch (err) {
      console.error("Error playing the conveyor:", err);
    }
  }
  // --- end gerald-conveyor ---

  // --- gerald-exit-splat ---
  /** Splats played so far: each reads the noise from a little further on, so consecutive splats differ. */
  private splatCount = 0;

  /**
   * A splat of the splat barrier landed (splatTone.ts): a short wet noise burst with a low "blop", `level` loud (0–1). An
   * effect, not a note (never snapped, never a melody note or a song slice): on the beat grid when the beat lock is on,
   * without taking a bounce's slot, ducking the music bed; in sample mode the hit sample plays instead, an octave down and
   * softer – the wet version of the bounce.
   */
  playSplat(level = 0.6) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleSplat(level));
      return;
    }
    this.scheduleSplat(level);
  }

  private scheduleSplat(level: number) {
    if (!this.audioContext || !this.masterGain) return;
    try {
      const time = this.scheduleTime(this.audioContext.currentTime);
      if (resolveHitSoundSource(this.hitSoundMode, !!this.sampler?.isReady()) === "sample") this.sampler!.play(SPLAT_SAMPLE_RATE, time, SPLAT_SAMPLE_GAIN * splatLevel(level));
      else scheduleSplatTone(this.audioContext, this.masterGain, time, this.noiseCache.get(this.audioContext), level, 0.0173 * this.splatCount++);
      this.musicBed.duck(time);
    } catch (err) {
      console.error("Error playing the splat:", err);
    }
  }
  // --- end gerald-exit-splat ---

  // --- fight-league ---
  /** Fight League sounds played so far: each reads the noise from a little further on, so consecutive hits differ. */
  private fightCount = 0;

  /**
   * A Fight League sound (fightTones.ts): a weapon hit of its kind at the hitting fighter's pitch (snapped to the scale), an
   * ability's swell or a KO. An effect, not a note (never a melody note, a hit sample or a song slice): on the beat grid when
   * the beat lock is on; the hits duck the music bed.
   */
  playFight(kind: FightSoundKind, frequency?: number, level = 1) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleFight(kind, frequency, level));
      return;
    }
    this.scheduleFight(kind, frequency, level);
  }

  private scheduleFight(kind: FightSoundKind, frequency: number | undefined, level: number) {
    if (!this.audioContext || !this.masterGain) return;
    try {
      const ctx = this.audioContext;
      const time = this.scheduleTime(ctx.currentTime);
      scheduleFightSound(ctx, this.masterGain, kind, frequency ?? 440, time, this.noiseCache.get(ctx), hitLevel(level), (f) => this.snap(f), 0.0173 * this.fightCount++);
      if (fightDucks(kind)) this.musicBed.duck(time);
    } catch (err) {
      console.error("Error playing the fight sound:", err);
    }
  }
  // --- end fight-league ---

  setWallBreakSound(url: string | null) {
    this.wallBreakSoundUrl = url;
    this.wallBreakBuffer = null;
    this.wallBreakDecoding = false;
    this.wallBreakFailedUrl = null; // choosing a clip (again) tries it (again)
    if (url) void this.decodeWallBreakSound(url);
  }

  // --- review fix (audio) ---
  /**
   * True when the chosen wall-break clip is decoded and plays instead of the synthesised effect (the gap arpeggio, the
   * shatter burst, the pew). While it is still decoding – or when it failed – the effect plays, so a break is never silent;
   * a missing clip starts its decode, once: one that failed is not fetched again.
   */
  private useWallBreakClip(): boolean {
    const url = this.wallBreakSoundUrl;
    if (!url) return false;
    if (this.wallBreakBuffer) return true;
    if (this.wallBreakFailedUrl !== url) void this.decodeWallBreakSound(url);
    return false;
  }
  // --- end review fix (audio) ---

  private async decodeWallBreakSound(url: string) {
    if (this.wallBreakDecoding) return;
    this.wallBreakDecoding = true;
    this.initAudioGraph();
    const ctx = this.audioContext;
    if (!ctx) {
      this.wallBreakDecoding = false;
      return;
    }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`); // --- review fix (audio) ---
      const data = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(data);
      if (this.wallBreakSoundUrl === url) this.wallBreakBuffer = buffer;
    } catch (err) {
      // --- review fix (audio) --- a context closed meanwhile (the generator stopped) is not the clip's fault; otherwise the
      // clip is marked as failed: the synthesised effects play instead and it is not fetched again (the upload says so).
      if (this.audioContext === ctx) {
        if (this.wallBreakSoundUrl === url) this.wallBreakFailedUrl = url;
        console.warn("Failed to decode wall-break sound (the synthesised effect plays instead):", err);
      }
    } finally {
      this.wallBreakDecoding = false;
    }
  }

  private playWallBreakBuffer() {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") void this.audioContext.resume();
    if (!this.wallBreakBuffer) return; // callers check useWallBreakClip() first
    try {
      const source = this.audioContext.createBufferSource();
      source.buffer = this.wallBreakBuffer;
      source.connect(this.masterGain);
      const time = this.scheduleTime(this.audioContext.currentTime);
      source.start(time);
      this.musicBed.duck(time);
    } catch (err) {
      console.error("Error playing wall-break sound:", err);
    }
  }

  stop() {
    if (this.sampler) {
      this.sampler.dispose();
      this.sampler = null;
    }
    this.slicer.stop();
    this.musicBed.detach();
    if (this.silentOsc) {
      this.silentOsc.stop();
      this.silentOsc.disconnect();
      this.silentOsc = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
    this.mediaStreamDestination = null;
    this.masterGain = null;
    this.pluckCache.clear();
    this.noiseCache.clear(); // --- odd-string-battle ---
    this.lastSlotTime = -1;
    this.isInitialized = false;
    this.isPlaying = false;
  }

  getAnalyser() {
    return this.analyser;
  }
  isActive() {
    return this.isPlaying;
  }

  // --- fast-render ---
  /**
   * A copy of this generator that renders into `context` – an OfflineAudioContext (fast export, lib/recording/fastRender.ts)
   * – instead of the speakers: the same volume, instruments, scale, beat lock (its grid starts with the clip), melody (from
   * its first note), hit sample, wall-break clip, song slicer (from the start of the song) and music bed (playing from its
   * start offset at 0 s), all read on `clock` (seconds of the clip) through `clockedAudioContext()`. Every sound then takes
   * the code path it takes on the page (`playWallHit()`, `playGapPass()`, …). Resolves once the hit sample and the
   * wall-break clip are decoded for the offline context.
   */
  async createOfflineTwin(context: BaseAudioContext, clock: () => number): Promise<ToneGenerator> {
    const twin = new ToneGenerator();
    const ctx = clockedAudioContext(context, clock);
    const master = createMasterBus(context, [context.destination], this.volume); // --- review fix (audio) --- the live mix's bus
    twin.audioContext = ctx;
    twin.masterGain = master;
    twin.volume = this.volume;
    twin.music = { ...this.music };
    twin.customNotes = this.customNotes.slice();
    twin.lastCustomNoteTime = -Infinity;
    twin.hitSoundMode = this.hitSoundMode;
    twin.hitSampleUrl = this.hitSampleUrl;
    twin.hitSamplePitchByWall = this.hitSamplePitchByWall;
    twin.hitSampleVolume = this.hitSampleVolume;
    twin.sampler = new HitSampler(ctx, master);
    twin.sampler.setVolume(this.hitSampleVolume);
    twin.wallBreakSoundUrl = this.wallBreakSoundUrl;
    twin.wallBreakBuffer = this.wallBreakBuffer;
    twin.wallBreakFailedUrl = this.wallBreakFailedUrl; // --- review fix (audio) --- a clip that failed on the page is not tried again
    twin.slicer.setOptions(this.slicer.getOptions());
    twin.slicer.setBuffer(this.slicer.getBuffer());
    twin.slicer.setEnabled(this.slicer.isActive());
    twin.musicBed.attach(ctx, master);
    twin.musicBed.setOptions(this.musicBed.getOptions());
    twin.musicBed.setBuffer(this.musicBed.getBuffer());
    twin.isInitialized = true;
    twin.isPlaying = true;
    twin.resetBeatGrid();
    if (this.beatSourceClock) twin.setBeatSourceClock(this.beatSourceClock, clock); // --- video-beats --- (the export's clock is the simulation's)
    if (twin.hitSoundMode === "sample" && twin.hitSampleUrl) await twin.sampler.load(twin.hitSampleUrl);
    if (twin.wallBreakSoundUrl && !twin.wallBreakBuffer && twin.wallBreakFailedUrl !== twin.wallBreakSoundUrl) await twin.decodeWallBreakSound(twin.wallBreakSoundUrl);
    twin.musicBed.play();
    return twin;
  }
  // --- end fast-render ---
}
