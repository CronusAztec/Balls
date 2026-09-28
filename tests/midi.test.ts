import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parseMidiToFrequencies } from "@/lib/audio/midi";
import { SONGS } from "@/lib/audio/songs";

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

  it("rejects files that are not MIDI", () => {
    expect(() => parseMidiToFrequencies(new TextEncoder().encode("not a midi file").buffer)).toThrow();
  });
});
