/**
 * Minimal Standard MIDI File parser. It extracts the melody as a list of frequencies:
 * one note per distinct tick (highest pitch wins when several notes start together),
 * collapsing immediate repeats. That is exactly what the tone generator needs to play
 * "the next note of the song" on every wall hit. General MIDI percussion (channel 10) is left
 * out: its note numbers pick drums (kick 36, hi-hat 42…), not pitches – unless the file has
 * nothing but drums, which then still gives a note list.
 */

interface RawNote {
  pitch: number;
  frequency: number;
  velocity: number;
  tick: number;
  /** --- review fix (audio) --- a note-on of MIDI channel 10 (status 0x99): a drum, not a pitch. */
  drum: boolean;
}

/** The most notes kept from a file: the melody plays one note per wall hit, so more could never be heard. */
export const MIDI_MAX_NOTES = 200_000;

/**
 * A variable-length quantity: at most four bytes (the format's limit, values below 2^28), accumulated arithmetically so it
 * stays a non-negative number. --- review fix (security-robustness) --- a fifth byte or one past the track's end throws:
 * `8F FF FF FF 78` overflowed the old `value << 7` to −8 and sent the parser back to the start of its track, for ever.
 */
function readVarLen(view: DataView, offset: number): [number, number] {
  let value = 0;
  let length = 0;
  let byte: number;
  do {
    if (length === 4 || offset + length >= view.byteLength) throw new Error("Malformed MIDI variable-length quantity");
    byte = view.getUint8(offset + length);
    value = value * 128 + (byte & 0x7f);
    length++;
  } while (byte & 0x80);
  return [value, length];
}

/** The notes of one track, at most `budget` of them. */
function parseTrack(buffer: ArrayBuffer, start: number, length: number, budget: number): RawNote[] {
  const view = new DataView(buffer, start, length);
  const notes: RawNote[] = [];
  let pos = 0;
  let tick = 0;
  let runningStatus = 0;
  while (pos < length) {
    const before = pos; // --- review fix (security-robustness) --- (every event moves forward: see the end of the loop)
    const [delta, deltaLen] = readVarLen(view, pos);
    pos += deltaLen;
    tick += delta;
    if (pos >= length) break;
    let status = view.getUint8(pos);
    if (status & 0x80) {
      runningStatus = status;
      pos++;
    } else {
      status = runningStatus;
    }
    const type = status & 0xf0;
    if (type === 0x90) {
      if (pos + 1 >= length) break;
      const pitch = view.getUint8(pos);
      const velocity = view.getUint8(pos + 1);
      pos += 2; // consumed whatever the channel, so running status and byte alignment stay right
      if (velocity > 0) {
        if (notes.length >= budget) break; // --- review fix (security-robustness) --- (MIDI_MAX_NOTES in all)
        notes.push({ pitch, frequency: 440 * Math.pow(2, (pitch - 69) / 12), velocity, tick, drum: (status & 0x0f) === 9 });
      }
    } else if (type === 0x80 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
      pos += 2;
    } else if (type === 0xc0 || type === 0xd0) {
      pos += 1;
    } else if (status === 0xff) {
      pos += 1; // meta type
      if (pos >= length) break;
      const [len, lenLen] = readVarLen(view, pos);
      if (pos + lenLen + len > length) break; // --- review fix (security-robustness) --- (a length past the track ends it)
      pos += lenLen + len;
    } else if (status === 0xf0 || status === 0xf7) {
      const [len, lenLen] = readVarLen(view, pos);
      if (pos + lenLen + len > length) break; // --- review fix (security-robustness) ---
      pos += lenLen + len;
    } else {
      pos += 1;
    }
    if (pos <= before) break; // --- review fix (security-robustness) --- forward progress, whatever the bytes say
  }
  return notes;
}

export function parseMidiToFrequencies(buffer: ArrayBuffer): number[] {
  const view = new DataView(buffer);
  const header = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (header !== "MThd") throw new Error("Not a valid MIDI file");
  const trackCount = view.getUint16(10);
  const all: RawNote[] = [];
  let pos = 14;
  for (let t = 0; t < trackCount && pos + 8 <= buffer.byteLength; t++) {
    const chunkType = String.fromCharCode(view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3));
    const chunkLen = view.getUint32(pos + 4);
    pos += 8;
    // --- review fix (security-robustness) --- one push per note (spreading 150,000 notes into push() overflowed the call
    // stack), and no more than MIDI_MAX_NOTES of them in all
    if (chunkType === "MTrk") for (const n of parseTrack(buffer, pos, Math.min(chunkLen, buffer.byteLength - pos), MIDI_MAX_NOTES - all.length)) all.push(n);
    pos += chunkLen;
  }
  // --- review fix (audio) --- the drums of a GM drum track are not melody notes (a drum-only file keeps them all).
  const pitched = all.filter((n) => !n.drum);
  const notes = pitched.length > 0 ? pitched : all;
  notes.sort((a, b) => a.tick - b.tick || b.pitch - a.pitch);
  const melody: RawNote[] = [];
  let lastTick = -1;
  for (const n of notes) {
    if (n.tick !== lastTick) {
      melody.push(n);
      lastTick = n.tick;
    }
  }
  const freqs: number[] = [];
  for (const n of melody) {
    if (freqs.length === 0 || Math.abs(freqs[freqs.length - 1] - n.frequency) > 0.5) freqs.push(n.frequency);
  }
  return freqs;
}

export async function loadMidiFrequencies(url: string): Promise<number[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch MIDI file: ${res.statusText}`);
  return parseMidiToFrequencies(await res.arrayBuffer());
}
