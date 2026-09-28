import { HitSampler, hitSamplePlaybackRate, resolveHitSoundSource, wallHitFrequency, type HitSoundMode } from "./sampler";
import { SlicePlayer } from "./slicePlayer";

/**
 * Web Audio tone generator. Wall hits play short tones (descending pitch per wall layer,
 * or the next note of a loaded melody), a custom audio clip through the HitSampler in
 * "sample" mode, or the next slice of an uploaded song when the song slicer is on; gap
 * passes play a rising four-note arpeggio or a custom audio clip.
 * Everything is routed through a master gain and also into a MediaStreamDestination so
 * the recorder can capture the audio track.
 */
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
  /** Song slicer: plays the next bit of an uploaded song on every bounce (see slicePlayer.ts). */
  private readonly slicer = new SlicePlayer();

  async start() {
    if (this.isPlaying) return;
    this.initAudioGraph();
    if (this.audioContext && this.audioContext.state === "suspended") await this.audioContext.resume();
    this.isPlaying = true;
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

  /* ------------------------------------------------------------ song slicer */

  getSlicer() {
    return this.slicer;
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

  playWallHit(wallIndex = 0) {
    this.initAudioGraph();
    if (!this.audioContext || !this.masterGain) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => this.scheduleHit(wallIndex));
      return;
    }
    this.scheduleHit(wallIndex);
  }

  private scheduleHit(wallIndex: number) {
    if (!this.audioContext || !this.masterGain) return;
    // The song slicer takes over the bounce sound while it has a song to play.
    if (this.slicer.trigger(this.audioContext, this.masterGain)) return;
    const now = this.audioContext.currentTime;
    if (resolveHitSoundSource(this.hitSoundMode, !!this.sampler?.isReady()) === "sample") {
      this.sampler!.play(hitSamplePlaybackRate(wallIndex, this.hitSamplePitchByWall), now);
      return;
    }
    try {
      let frequency: number;
      let duration: number;
      let gain: number;
      let type: OscillatorType;
      if (this.customNotes.length > 0) {
        if (now - this.lastCustomNoteTime < this.NOTE_COOLDOWN) return;
        this.lastCustomNoteTime = now;
        frequency = this.customNotes[this.customNoteIndex % this.customNotes.length];
        this.customNoteIndex++;
        type = "sine";
        duration = 0.25;
        gain = 0.35;
      } else {
        frequency = wallHitFrequency(wallIndex);
        type = "triangle";
        duration = 0.15;
        gain = 0.25;
      }
      const osc = this.audioContext.createOscillator();
      const g = this.audioContext.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      osc.connect(g);
      g.connect(this.masterGain);
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.01, now + duration);
      osc.start(now);
      osc.stop(now + duration);
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
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const osc = this.audioContext!.createOscillator();
        const g = this.audioContext!.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        osc.connect(g);
        g.connect(this.masterGain!);
        const t = this.audioContext!.currentTime + 0.06 * i;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
        osc.start(t);
        osc.stop(t + 0.25);
      });
    } catch (err) {
      console.error("Error playing gap pass sound:", err);
    }
  }

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
      source.start();
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
