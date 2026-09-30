import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parseMidiToFrequencies } from "@/lib/audio/midi";
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
