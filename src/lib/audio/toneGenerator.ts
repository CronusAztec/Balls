import { PluckCache, playVoice, type InstrumentId } from "@/lib/audio/instruments";
import { nextGridTime, quantizeFrequency, type QuantizeGrid, type ScaleId } from "@/lib/audio/scales";
import { INTERACTION_TONES, scheduleInteractionTone, type InteractionKind } from "./interactionTones";
import { CHIRPS, scheduleChirp, type ChirpKind } from "./characterVoice"; // --- boris-faces ---
import { arpeggioNotes, scheduleArpeggio } from "./multiplierTones"; // --- boris-multipliers ---
import { DEFAULT_BUMPER_FREQUENCY, scheduleBumperTone } from "./bumperTone"; // --- obstacle-editor ---
import { MusicBed } from "./musicBed";
import { HitSampler, MAX_VOICES as MAX_SAMPLE_VOICES, hitSamplePlaybackRate, resolveHitSoundSource, wallHitFrequency, type HitSampleStatus, type HitSoundMode } from "./sampler";
import { SlicePlayer } from "./slicePlayer";

/**
 * Web Audio tone generator. Wall hits play short tones (descending pitch per wall layer,
 * or the next note of a loaded melody), a custom audio clip through the HitSampler in
 * "sample" mode, or the next slice of an uploaded song when the song slicer is on; gap
 * passes play a rising four-note arpeggio or a custom audio clip; a ball merge plays a low
 * tone and a split a high one (interactionTones.ts). Everything is routed
 * through a master gain and also into a MediaStreamDestination so the recorder can
 * capture the audio track.
 *
 * A wall hit is dispatched in this order: song slicer (while it has a song to play), hit
 * sample (in "sample" mode, once the clip is decoded), otherwise a synthesised voice. The
 * music settings decide how that sound is made: the instrument voice (instruments.ts;
 * melody notes keep a voice of their own), the scale every pitch is snapped to and, when
 * the beat lock is on, the BPM grid the sound – voice or sample – is delayed onto
 * (scales.ts). With the defaults – triangle tones, sine melody, chromatic, lock off – the
 * output is exactly the classic bounce sound.
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
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.volume;
        this.masterGain.connect(this.audioContext.destination);
      }
      if (!this.mediaStreamDestination) {
        this.mediaStreamDestination = this.audioContext.createMediaStreamDestination();
        this.masterGain.connect(this.mediaStreamDestination);
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
    this.hitSampleVolume = Math.max(0, Math.min(1, volume));
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
   */
  playWallHit(wallIndex = 0, frequency?: number, accent = false, chord?: readonly number[], level = 1) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleHit(wallIndex, frequency, accent, chord, level));
      return;
    }
    this.scheduleHit(wallIndex, frequency, accent, chord, level);
  }

  private scheduleHit(wallIndex: number, pitch?: number, accent = false, chord?: readonly number[], level = 1) {
    // --- jdm-collisions --- a per-hit loudness (soft collision notes); 1 leaves every other hit as it was.
    const softness = hitLevel(level);
    if (!this.audioContext || !this.masterGain) return;
    const now = this.audioContext.currentTime;
    // 1. The song slicer takes over the bounce sound while it has a song to play.
    if (this.slicer.trigger(this.audioContext, this.masterGain)) {
      this.musicBed.duck(now);
      return;
    }
    // 2. Sample mode: the clip, pitched per wall and placed on the beat grid like every other sound.
    if (resolveHitSoundSource(this.hitSoundMode, !!this.sampler?.isReady()) === "sample") {
      const time = this.scheduleTime(now);
      if (this.music.quantizeToBeat && Math.abs(time - this.lastSlotTime) < 1e-6) return;
      this.lastSlotTime = time;
      // Without "pitch by wall" every copy of a chord would play at the same rate, and n identical copies only add up
      // √n times louder (and take every voice): the clip then plays once for the whole chord.
      const pitches = this.hitSamplePitchByWall ? hitPitches(wallIndex, pitch, chord, MAX_SAMPLE_VOICES) : [pitch];
      const level = (accent ? ACCENT_GAIN : 1) * chordGain(pitches.length);
      for (const f of pitches) this.sampler!.play(hitSamplePlaybackRate(wallIndex, this.hitSamplePitchByWall, pitches.length > 1 || pitch !== undefined ? f : undefined), time, level * softness);
      this.musicBed.duck(time);
      return;
    }
    // 3. A synthesised voice: the next melody note or the wall tone, snapped to the scale.
    try {
      let notes: number[];
      let duration: number;
      let gain: number;
      const melody = this.customNotes.length > 0;
      if (melody) {
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
      // Beat lock: one bounce sound per grid slot, so the export sits cleanly on the beat.
      if (this.music.quantizeToBeat && Math.abs(time - this.lastSlotTime) < 1e-6) return;
      this.lastSlotTime = time;
      if (melody) {
        this.lastCustomNoteTime = now;
        this.customNoteIndex++;
      }
      // Melody notes keep their own voice (sine by default), so a song sounds as it always did.
      const instrument = melody ? this.music.melodyInstrument : this.music.instrument;
      for (const frequency of notes) playVoice(this.audioContext, this.masterGain, instrument, { frequency: this.snap(frequency), time, duration, gain }, this.pluckCache);
      this.musicBed.duck(time);
    } catch (err) {
      console.error("Error playing wall hit sound:", err);
    }
  }

  playGapPass() {
    if (this.wallBreakSoundUrl) {
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

  // --- boris-faces ---
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
  // --- end boris-faces ---

  // --- boris-multipliers ---
  /**
   * A stat multiplier stacked (a pickup orb, a gate): a rising arpeggio that climbs with the new `total`
   * (multiplierTones.ts). It goes the way a bounce goes – the next slice while the song slicer plays, the hit sample
   * transposed to every note in sample mode, otherwise the bounce instrument (a loaded melody roots it on its next note
   * with the melody voice) – snapped to the scale, its first note on the beat grid (one slot), ducking the music bed.
   */
  playMultiplier(total: number) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleMultiplier(total));
      return;
    }
    this.scheduleMultiplier(total);
  }

  private scheduleMultiplier(total: number) {
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
      const root = melody ? this.customNotes[this.customNoteIndex % this.customNotes.length] : undefined;
      if (melody) {
        this.customNoteIndex++;
        this.lastCustomNoteTime = now;
      }
      const notes = arpeggioNotes(total, root);
      if (resolveHitSoundSource(this.hitSoundMode, !!this.sampler?.isReady()) === "sample") {
        for (const note of notes) this.sampler!.play(hitSamplePlaybackRate(0, true, this.snap(note.frequency)), time + note.offset, note.gain / 0.25);
      } else {
        scheduleArpeggio(this.audioContext, this.masterGain, melody ? this.music.melodyInstrument : this.music.instrument, notes, time, (f) => this.snap(f), this.pluckCache);
      }
      this.musicBed.duck(time);
    } catch (err) {
      console.error("Error playing the multiplier arpeggio:", err);
    }
  }
  // --- end boris-multipliers ---

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

  setWallBreakSound(url: string | null) {
    this.wallBreakSoundUrl = url;
    this.wallBreakBuffer = null;
    this.wallBreakDecoding = false;
    if (url) void this.decodeWallBreakSound(url);
  }

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
      const data = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(data);
      if (this.wallBreakSoundUrl === url) this.wallBreakBuffer = buffer;
    } catch (err) {
      console.error("Failed to decode wall-break sound:", err);
    } finally {
      this.wallBreakDecoding = false;
    }
  }

  private playWallBreakBuffer() {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") void this.audioContext.resume();
    if (!this.wallBreakBuffer) {
      if (this.wallBreakSoundUrl) void this.decodeWallBreakSound(this.wallBreakSoundUrl);
      return;
    }
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
}
