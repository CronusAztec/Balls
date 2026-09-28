/**
 * Minimal Standard MIDI File parser. It extracts the melody as a list of frequencies:
 * one note per distinct tick (highest pitch wins when several notes start together),
 * collapsing immediate repeats. That is exactly what the tone generator needs to play
 * "the next note of the song" on every wall hit.
 */

interface RawNote {
  pitch: number;
  frequency: number;
  velocity: number;
  tick: number;
}

function readVarLen(view: DataView, offset: number): [number, number] {
  let value = 0;
  let length = 0;
  let byte: number;
  do {
    byte = view.getUint8(offset + length);
    value = (value << 7) | (byte & 0x7f);
    length++;
  } while (byte & 0x80);
  return [value, length];
}

function parseTrack(buffer: ArrayBuffer, start: number, length: number): RawNote[] {
  const view = new DataView(buffer, start, length);
  const notes: RawNote[] = [];
  let pos = 0;
  let tick = 0;
  let runningStatus = 0;
  while (pos < length) {
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
      pos += 2;
      if (velocity > 0) {
        notes.push({ pitch, frequency: 440 * Math.pow(2, (pitch - 69) / 12), velocity, tick });
      }
    } else if (type === 0x80 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
      pos += 2;
    } else if (type === 0xc0 || type === 0xd0) {
      pos += 1;
    } else if (status === 0xff) {
      pos += 1; // meta type
      if (pos >= length) break;
      const [len, lenLen] = readVarLen(view, pos);
      pos += lenLen + len;
    } else if (status === 0xf0 || status === 0xf7) {
      const [len, lenLen] = readVarLen(view, pos);
      pos += lenLen + len;
    } else {
      pos += 1;
    }
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
    if (chunkType === "MTrk") all.push(...parseTrack(buffer, pos, Math.min(chunkLen, buffer.byteLength - pos)));
    pos += chunkLen;
  }
  all.sort((a, b) => a.tick - b.tick || b.pitch - a.pitch);
  const melody: RawNote[] = [];
  let lastTick = -1;
  for (const n of all) {
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
