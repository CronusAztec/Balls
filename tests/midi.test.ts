import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { MIDI_MAX_NOTES, parseMidiToFrequencies } from "@/lib/audio/midi";
import { SONGS } from "@/lib/audio/songs";
import { midiToFrequency } from "@/lib/audio/scales";

/** A format-1 Standard MIDI File built in memory: one MTrk chunk per event list ([delta ticks, ...bytes] each). */
function smf(tracks: number[][][]): ArrayBuffer {
  const bytes: number[] = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, 0x01, 0xe0];
  const varLen = (v: number) => {
    const out = [v & 0x7f];
    while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80);
    return out;
  };
  for (const events of tracks) {
    const body: number[] = [];
    for (const [delta, ...data] of events) body.push(...varLen(delta), ...data);
    body.push(0, 0xff, 0x2f, 0); // end of track
    bytes.push(0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff, ...body);
  }
  return new Uint8Array(bytes).buffer;
}

/** Channel-1 melody C5 D5 E5 F5, one note every 480 ticks. */
const MELODY = [72, 74, 76, 77].map((note, i) => [i === 0 ? 0 : 480, 0x90, note, 100]);
/** Channel-10 (GM percussion) kick 36 on the beats and closed hi-hat 42 on the off-beats; running status after the first. */
const DRUMS = [0, 1, 2, 3].flatMap((i) => [
  i === 0 ? [0, 0x99, 36, 100] : [240, 36, 100],
  [240, 42, 90],
]);

describe("MIDI parser", () => {
  it("parses every bundled melody into a note list", () => {
    for (const song of SONGS) {
      const file = path.join(process.cwd(), "public", song.file);
      const buffer = readFileSync(file);
      const notes = parseMidiToFrequencies(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      expect(notes.length, song.name).toBeGreaterThan(10);
      for (const f of notes) expect(f).toBeGreaterThan(20);
    }
  });

  // --- review fix (audio) ---
  it("keeps General MIDI drums (channel 10) out of the melody", () => {
    const notes = parseMidiToFrequencies(smf([MELODY, DRUMS]));
    expect(notes).toEqual([72, 74, 76, 77].map(midiToFrequency));
    expect(notes.some((f) => f < 100)).toBe(false); // no F#2 (92.5 Hz) hi-hat "notes"
  });

  it("still gives a note list for a drum-only file", () => {
    const notes = parseMidiToFrequencies(smf([DRUMS]));
    expect(notes.length).toBeGreaterThan(0);
  });

  it("rejects files that are not MIDI", () => {
    expect(() => parseMidiToFrequencies(new TextEncoder().encode("not a midi file").buffer)).toThrow();
  });
});

// --- review fix (security-robustness) --- crafted lengths, the format's longest quantity, and huge files
describe("MIDI parser on hostile and huge files (review fix: security-robustness)", () => {
  /** A format-1 file with one MTrk chunk holding exactly `body` (no end-of-track added). */
  const rawTrack = (body: number[]) => {
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 0, 0x60];
    const len = body.length;
    return new Uint8Array([...head, 0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...body]).buffer;
  };

  it("the 34-byte file of the review (a five-byte length that overflowed to -8) is refused at once instead of looping for ever", { timeout: 2000 }, () => {
    const crafted = rawTrack([0x00, 0xff, 0x01, 0x8f, 0xff, 0xff, 0xff, 0x78, 0x00, 0xff, 0x2f, 0x00]);
    expect(crafted.byteLength).toBe(34);
    expect(() => parseMidiToFrequencies(crafted)).toThrow(/variable-length/);
    // The same five-byte quantity as a delta time and in a sysex event
    expect(() => parseMidiToFrequencies(rawTrack([0x8f, 0xff, 0xff, 0xff, 0x78, 0x90, 60, 100]))).toThrow(/variable-length/);
    expect(() => parseMidiToFrequencies(rawTrack([0x00, 0xf0, 0x8f, 0xff, 0xff, 0xff, 0x78, 0x00]))).toThrow(/variable-length/);
  });

  it("still reads the longest quantity the format allows (FF FF FF 7F)", () => {
    const notes = parseMidiToFrequencies(smf([[[0x0fffffff, 0x90, 72, 100], [10, 0x90, 74, 100]]]));
    expect(notes).toEqual([72, 74].map(midiToFrequency));
    expect(parseMidiToFrequencies(rawTrack([0xff, 0xff, 0xff, 0x7f, 0x90, 72, 100]))).toEqual([midiToFrequency(72)]);
  });

  it("ends a track whose meta or sysex length runs past it, keeping the notes before", { timeout: 2000 }, () => {
    const meta = rawTrack([0x00, 0x90, 72, 100, 0x00, 0xff, 0x01, 0x83, 0x00, 0x41]); // a 384-byte text in a 10-byte track
    expect(parseMidiToFrequencies(meta)).toEqual([midiToFrequency(72)]);
    const sysex = rawTrack([0x00, 0x90, 74, 100, 0x00, 0xf0, 0x7f, 0x00]);
    expect(parseMidiToFrequencies(sysex)).toEqual([midiToFrequency(74)]);
  });

  it("parses a file with more notes than a call can spread (150,000 overflowed the stack) and keeps MIDI_MAX_NOTES of them", () => {
    const count = MIDI_MAX_NOTES + 5;
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 0, 0x60];
    const len = count * 4 + 4;
    const bytes = new Uint8Array(head.length + 8 + len);
    bytes.set(head, 0);
    bytes.set([0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff], head.length);
    let o = head.length + 8;
    for (let i = 0; i < count; i++) {
      bytes.set([1, 0x90, i % 2 ? 62 : 60, 100], o); // one tick apart, alternating so no repeat is collapsed
      o += 4;
    }
    bytes.set([0, 0xff, 0x2f, 0], o);
    let notes: number[] = [];
    expect(() => (notes = parseMidiToFrequencies(bytes.buffer))).not.toThrow();
    expect(notes).toHaveLength(MIDI_MAX_NOTES);
    expect(notes.slice(0, 2)).toEqual([60, 62].map(midiToFrequency));
  });

  it("refuses a truncated file instead of reading past it", () => {
    expect(() => parseMidiToFrequencies(rawTrack([0x00, 0xff, 0x01, 0x81]))).toThrow();
    expect(() => parseMidiToFrequencies(new Uint8Array([0x4d, 0x54, 0x68, 0x64]).buffer)).toThrow();
  });
});
