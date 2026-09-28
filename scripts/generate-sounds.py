#!/usr/bin/env python3
"""Synthesises the built-in wall-break sound effects (public/wallBreak/*.wav).

Pure Python (no numpy). Run `python3 scripts/generate-sounds.py` to regenerate.
"""
from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

RATE = 44100


def write_wav(path: Path, samples: list[float]) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        frames = b"".join(struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767)) for s in samples)
        w.writeframes(frames)


def pop(duration: float = 0.22) -> list[float]:
    out = []
    n = int(RATE * duration)
    for i in range(n):
        t = i / RATE
        freq = 900 * math.exp(-t * 18) + 120
        env = math.exp(-t * 22)
        click = math.exp(-t * 400) * 0.6
        out.append((math.sin(2 * math.pi * freq * t) * env * 0.8 + click * math.sin(2 * math.pi * 3000 * t)) * 0.9)
    return out


def chime(duration: float = 0.9) -> list[float]:
    out = []
    n = int(RATE * duration)
    partials = [(523.25, 1.0), (659.25, 0.7), (783.99, 0.55), (1046.5, 0.4), (1567.98, 0.2)]
    for i in range(n):
        t = i / RATE
        s = 0.0
        for k, (f, a) in enumerate(partials):
            start = k * 0.045
            if t < start:
                continue
            tt = t - start
            s += a * math.sin(2 * math.pi * f * tt) * math.exp(-tt * 4.5)
        out.append(s * 0.28)
    return out


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "public" / "wallBreak"
    out.mkdir(parents=True, exist_ok=True)
    write_wav(out / "pop.wav", pop())
    write_wav(out / "chime.wav", chime())
    print("wrote pop.wav and chime.wav")


if __name__ == "__main__":
    main()
