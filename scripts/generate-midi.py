#!/usr/bin/env python3
"""Generates the public-domain melody MIDI files in public/notes.

Each melody is written as a list of (note, beats) tuples. Notes use scientific pitch
notation ("C4", "F#5", "Bb3"); "R" is a rest. Run `python3 scripts/generate-midi.py`
after editing SONGS to regenerate the files. No third-party packages are required.
"""
from __future__ import annotations

import struct
from pathlib import Path

NOTE_INDEX = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def note_to_midi(name: str) -> int:
    letter = name[0].upper()
    rest = name[1:]
    accidental = 0
    while rest and rest[0] in "#b":
        accidental += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    octave = int(rest)
    return 12 * (octave + 1) + NOTE_INDEX[letter] + accidental


def var_len(value: int) -> bytes:
    buffer = value & 0x7F
    out = bytearray()
    value >>= 7
    while value:
        buffer <<= 8
        buffer |= (value & 0x7F) | 0x80
        value >>= 7
    while True:
        out.append(buffer & 0xFF)
        if buffer & 0x80:
            buffer >>= 8
        else:
            break
    return bytes(out)


def build_midi(melody: list[tuple[str, float]], bpm: int = 120, ticks_per_beat: int = 480) -> bytes:
    track = bytearray()
    tempo = int(60_000_000 / bpm)
    track += var_len(0) + b"\xff\x51\x03" + tempo.to_bytes(3, "big")
    track += var_len(0) + b"\xc0\x00"  # program change: piano
    pending_delta = 0
    for name, beats in melody:
        ticks = int(beats * ticks_per_beat)
        if name == "R":
            pending_delta += ticks
            continue
        pitch = note_to_midi(name)
        track += var_len(pending_delta) + bytes([0x90, pitch, 100])
        track += var_len(max(1, ticks - 5)) + bytes([0x80, pitch, 0])
        pending_delta = 5
    track += var_len(0) + b"\xff\x2f\x00"
    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, ticks_per_beat)
    return header + b"MTrk" + struct.pack(">I", len(track)) + bytes(track)


Q, E, H, W, S, DQ = 1.0, 0.5, 2.0, 4.0, 0.25, 1.5

SONGS: dict[str, tuple[int, list[tuple[str, float]]]] = {
    "fur-elise": (140, [
        ("E5", E), ("D#5", E), ("E5", E), ("D#5", E), ("E5", E), ("B4", E), ("D5", E), ("C5", E), ("A4", Q), ("R", E),
        ("C4", E), ("E4", E), ("A4", E), ("B4", Q), ("R", E), ("E4", E), ("G#4", E), ("B4", E), ("C5", Q), ("R", E),
        ("E4", E), ("E5", E), ("D#5", E), ("E5", E), ("D#5", E), ("E5", E), ("B4", E), ("D5", E), ("C5", E), ("A4", Q), ("R", E),
        ("C4", E), ("E4", E), ("A4", E), ("B4", Q), ("R", E), ("E4", E), ("C5", E), ("B4", E), ("A4", Q),
    ]),
    "ode-to-joy": (120, [
        ("E4", Q), ("E4", Q), ("F4", Q), ("G4", Q), ("G4", Q), ("F4", Q), ("E4", Q), ("D4", Q),
        ("C4", Q), ("C4", Q), ("D4", Q), ("E4", Q), ("E4", DQ), ("D4", E), ("D4", H),
        ("E4", Q), ("E4", Q), ("F4", Q), ("G4", Q), ("G4", Q), ("F4", Q), ("E4", Q), ("D4", Q),
        ("C4", Q), ("C4", Q), ("D4", Q), ("E4", Q), ("D4", DQ), ("C4", E), ("C4", H),
        ("D4", Q), ("D4", Q), ("E4", Q), ("C4", Q), ("D4", Q), ("E4", E), ("F4", E), ("E4", Q), ("C4", Q),
        ("D4", Q), ("E4", E), ("F4", E), ("E4", Q), ("D4", Q), ("C4", Q), ("D4", Q), ("G3", H),
    ]),
    "twinkle-twinkle": (110, [
        ("C4", Q), ("C4", Q), ("G4", Q), ("G4", Q), ("A4", Q), ("A4", Q), ("G4", H),
        ("F4", Q), ("F4", Q), ("E4", Q), ("E4", Q), ("D4", Q), ("D4", Q), ("C4", H),
        ("G4", Q), ("G4", Q), ("F4", Q), ("F4", Q), ("E4", Q), ("E4", Q), ("D4", H),
        ("G4", Q), ("G4", Q), ("F4", Q), ("F4", Q), ("E4", Q), ("E4", Q), ("D4", H),
        ("C4", Q), ("C4", Q), ("G4", Q), ("G4", Q), ("A4", Q), ("A4", Q), ("G4", H),
        ("F4", Q), ("F4", Q), ("E4", Q), ("E4", Q), ("D4", Q), ("D4", Q), ("C4", H),
    ]),
    "happy-birthday": (120, [
        ("G4", E), ("G4", E), ("A4", Q), ("G4", Q), ("C5", Q), ("B4", H),
        ("G4", E), ("G4", E), ("A4", Q), ("G4", Q), ("D5", Q), ("C5", H),
        ("G4", E), ("G4", E), ("G5", Q), ("E5", Q), ("C5", Q), ("B4", Q), ("A4", Q),
        ("F5", E), ("F5", E), ("E5", Q), ("C5", Q), ("D5", Q), ("C5", H),
    ]),
    "canon-in-d": (100, [
        ("F#5", Q), ("E5", Q), ("D5", Q), ("C#5", Q), ("B4", Q), ("A4", Q), ("B4", Q), ("C#5", Q),
        ("D5", Q), ("C#5", Q), ("B4", Q), ("A4", Q), ("G4", Q), ("F#4", Q), ("G4", Q), ("E4", Q),
        ("D4", E), ("F#4", E), ("A4", E), ("G4", E), ("F#4", E), ("D4", E), ("F#4", E), ("E4", E),
        ("D4", E), ("B3", E), ("D4", E), ("A4", E), ("G4", E), ("B4", E), ("A4", E), ("G4", E),
        ("F#4", E), ("D4", E), ("E4", E), ("C#5", E), ("D5", E), ("F#5", E), ("A5", E), ("A4", E),
        ("B4", E), ("G4", E), ("A4", E), ("F#4", E), ("D4", E), ("D5", E), ("D5", DQ), ("C#5", E),
    ]),
    "jingle-bells": (130, [
        ("E4", Q), ("E4", Q), ("E4", H), ("E4", Q), ("E4", Q), ("E4", H),
        ("E4", Q), ("G4", Q), ("C4", DQ), ("D4", E), ("E4", W),
        ("F4", Q), ("F4", Q), ("F4", DQ), ("F4", E), ("F4", Q), ("E4", Q), ("E4", Q), ("E4", E), ("E4", E),
        ("E4", Q), ("D4", Q), ("D4", Q), ("E4", Q), ("D4", H), ("G4", H),
        ("E4", Q), ("E4", Q), ("E4", H), ("E4", Q), ("E4", Q), ("E4", H),
        ("E4", Q), ("G4", Q), ("C4", DQ), ("D4", E), ("E4", W),
        ("F4", Q), ("F4", Q), ("F4", DQ), ("F4", E), ("F4", Q), ("E4", Q), ("E4", Q), ("E4", E), ("E4", E),
        ("G4", Q), ("G4", Q), ("F4", Q), ("D4", Q), ("C4", W),
    ]),
    "greensleeves": (120, [
        ("A4", Q), ("C5", H), ("D5", Q), ("E5", DQ), ("F5", E), ("E5", Q), ("D5", H), ("B4", Q),
        ("G4", DQ), ("A4", E), ("B4", Q), ("C5", H), ("A4", Q), ("A4", DQ), ("G#4", E), ("A4", Q),
        ("B4", H), ("G#4", Q), ("E4", H), ("A4", Q), ("C5", H), ("D5", Q), ("E5", DQ), ("F5", E), ("E5", Q),
        ("D5", H), ("B4", Q), ("G4", DQ), ("A4", E), ("B4", Q), ("C5", DQ), ("B4", E), ("A4", Q),
        ("G#4", DQ), ("F#4", E), ("G#4", Q), ("A4", H), ("A4", Q),
    ]),
    "turkish-march": (130, [
        ("B4", S), ("A4", S), ("G#4", S), ("A4", S), ("C5", E), ("R", E),
        ("D5", S), ("C5", S), ("B4", S), ("C5", S), ("E5", E), ("R", E),
        ("F5", S), ("E5", S), ("D#5", S), ("E5", S), ("B5", S), ("A5", S), ("G#5", S), ("A5", S),
        ("B5", S), ("A5", S), ("G#5", S), ("A5", S), ("C6", Q), ("A5", E), ("C6", E),
        ("G5", E), ("A5", E), ("B5", E), ("A5", E), ("G5", E), ("A5", E), ("B5", E), ("A5", E), ("G5", E), ("A5", E),
        ("B5", E), ("A5", E), ("G5", E), ("F#5", E), ("E5", Q),
    ]),
    "mountain-king": (120, [
        ("D4", E), ("E4", E), ("F4", E), ("G4", E), ("A4", E), ("F4", E), ("A4", Q),
        ("G#4", E), ("E4", E), ("G#4", Q), ("G4", E), ("D#4", E), ("G4", Q),
        ("D4", E), ("E4", E), ("F4", E), ("G4", E), ("A4", E), ("F4", E), ("A4", E), ("D5", E),
        ("C5", E), ("A4", E), ("F4", E), ("A4", E), ("C5", H),
        ("A4", E), ("B4", E), ("C5", E), ("D5", E), ("E5", E), ("C5", E), ("E5", Q),
        ("F5", E), ("C#5", E), ("F5", Q), ("E5", E), ("C5", E), ("E5", Q),
        ("A4", E), ("B4", E), ("C5", E), ("D5", E), ("E5", E), ("C5", E), ("E5", E), ("A5", E),
        ("G5", E), ("E5", E), ("C5", E), ("E5", E), ("G5", H),
    ]),
    "william-tell": (150, [
        ("E4", E), ("E4", S), ("E4", S), ("E4", E), ("E4", S), ("E4", S),
        ("E4", E), ("G4", E), ("E4", E), ("C4", E),
        ("E4", E), ("G4", E), ("C5", Q), ("E5", E), ("D5", S), ("C5", S), ("B4", E), ("A4", E),
        ("G4", E), ("A4", E), ("B4", E), ("C5", E), ("D5", E), ("E5", E), ("D5", E), ("C5", E),
        ("D5", E), ("C5", E), ("B4", E), ("A4", E), ("G4", E), ("A4", E), ("B4", E), ("C5", E),
        ("G4", E), ("E4", E), ("C4", E), ("E4", E), ("G4", E), ("C5", Q),
    ]),
    "entertainer": (140, [
        ("D4", E), ("D#4", E), ("E4", E), ("C5", Q), ("E4", E), ("C5", Q), ("E4", E), ("C5", DQ),
        ("C5", E), ("D5", E), ("D#5", E), ("E5", E), ("C5", E), ("D5", E), ("E5", Q), ("B4", E), ("D5", Q), ("C5", DQ),
        ("D4", E), ("D#4", E), ("E4", E), ("C5", Q), ("E4", E), ("C5", Q), ("E4", E), ("C5", DQ),
        ("A4", E), ("G4", E), ("F#4", E), ("A4", E), ("C5", E), ("E5", Q), ("D5", E), ("C5", E), ("A4", E), ("D5", H),
    ]),
    "moonlight-sonata": (60, [
        ("G#3", S), ("C#4", S), ("E4", S), ("G#3", S), ("C#4", S), ("E4", S), ("G#3", S), ("C#4", S), ("E4", S),
        ("G#3", S), ("C#4", S), ("E4", S), ("A3", S), ("C#4", S), ("E4", S), ("A3", S), ("C#4", S), ("E4", S),
        ("A3", S), ("D4", S), ("F#4", S), ("A3", S), ("D4", S), ("F#4", S),
        ("G#3", S), ("B#3", S), ("F#4", S), ("G#3", S), ("C#4", S), ("E4", S),
        ("G#3", S), ("C#4", S), ("D#4", S), ("F#3", S), ("B#3", S), ("D#4", S),
        ("G#4", E), ("G#4", DQ), ("G#4", S), ("A4", E), ("G#4", E), ("F#4", E), ("E4", Q),
    ]),
}


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "public" / "notes"
    out.mkdir(parents=True, exist_ok=True)
    for name, (bpm, melody) in SONGS.items():
        data = build_midi(melody, bpm)
        (out / f"{name}.mid").write_bytes(data)
        print(f"wrote {name}.mid ({len(data)} bytes, {sum(1 for n,_ in melody if n != 'R')} notes)")


if __name__ == "__main__":
    main()
