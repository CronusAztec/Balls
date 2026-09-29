#!/usr/bin/env python3
"""Synthesises the built-in sound effects:

- public/wallBreak/*.wav  – wall-break sounds (pop, chime, glass)
- public/hitSounds/*.wav  – short hit samples played on every wall bounce (click, pluck, kick)

Pure Python (no numpy). Run `python3 scripts/generate-sounds.py` to regenerate.
The hit samples are pitched per wall at playback time (see src/lib/audio/sampler.ts), so
they are rendered at their natural pitch and kept short.
"""
from __future__ import annotations

import math
import random
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


# --- boris-glass ---
def glass(duration: float = 0.7) -> list[float]:
    """A pane of glass shattering: a bright noise crash and a low thump under a shower of inharmonic tinkles.

    Glass Smash plays it on every shattered pane by default (src/lib/audio/songs.ts, modeWallBreakSound()).
    """
    rng = random.Random(23)
    tinkles = []
    for k in range(26):
        onset = 0.0 if k == 0 else rng.random() ** 2 * 0.4
        f = 2200 + rng.random() * 5200
        amp = 0.25 + 0.5 * rng.random()
        decay = 18 + 30 * rng.random()
        tinkles.append((onset, amp, decay, ((f, 1.0), (f * 2.76, 0.5), (f * 5.4, 0.25))))
    out = []
    prev = 0.0
    n = int(RATE * duration)
    for i in range(n):
        t = i / RATE
        white = rng.random() * 2 - 1
        crash = (white - prev) * math.exp(-t * 14) * 0.55  # first difference: a high-passed burst
        prev = white
        s = crash + math.sin(2 * math.pi * 180 * t) * math.exp(-t * 40) * 0.35
        for onset, amp, decay, partials in tinkles:
            if t < onset:
                continue
            tt = t - onset
            env = math.exp(-tt * decay)
            if env < 1e-3:
                continue
            for f, a in partials:
                s += amp * a * math.sin(2 * math.pi * f * tt) * env * 0.12
        out.append(s)
    peak = max(abs(x) for x in out) or 1.0
    return [x * 0.9 / peak for x in out]
# --- end boris-glass ---


# ---------------------------------------------------------------- hit samples


def click(duration: float = 0.07) -> list[float]:
    """A crisp percussive tick: a short filtered-noise burst under a fast-decaying high sine."""
    rng = random.Random(7)
    out = []
    n = int(RATE * duration)
    prev = 0.0
    for i in range(n):
        t = i / RATE
        # one-pole low-pass on white noise keeps the burst from sounding harsh
        prev = prev * 0.6 + (rng.random() * 2 - 1) * 0.4
        noise = prev * math.exp(-t * 180)
        tone = math.sin(2 * math.pi * 2400 * t) * math.exp(-t * 90)
        body = math.sin(2 * math.pi * 620 * t) * math.exp(-t * 60) * 0.5
        out.append((noise * 0.7 + tone * 0.5 + body) * 0.8)
    return out


def pluck(duration: float = 0.35, freq: float = 440.0) -> list[float]:
    """Karplus-Strong plucked string at A4."""
    rng = random.Random(11)
    period = int(RATE / freq)
    ring = [rng.random() * 2 - 1 for _ in range(period)]
    out = []
    n = int(RATE * duration)
    idx = 0
    for i in range(n):
        t = i / RATE
        nxt = (idx + 1) % period
        sample = ring[idx]
        ring[idx] = (ring[idx] + ring[nxt]) * 0.5 * 0.996
        idx = nxt
        env = min(1.0, t * 400) * math.exp(-t * 6)
        out.append(sample * env * 0.85)
    return out


def kick(duration: float = 0.28) -> list[float]:
    """Electronic kick drum: a sine sweeping down from 160 Hz to 45 Hz plus a click transient."""
    out = []
    n = int(RATE * duration)
    phase = 0.0
    for i in range(n):
        t = i / RATE
        freq = 45 + 115 * math.exp(-t * 28)
        phase += 2 * math.pi * freq / RATE
        body = math.sin(phase) * math.exp(-t * 9)
        transient = math.sin(2 * math.pi * 1800 * t) * math.exp(-t * 350) * 0.4
        out.append(max(-1.0, min(1.0, (body + transient) * 1.1)) * 0.9)
    return out


def main() -> None:
    root = Path(__file__).resolve().parent.parent / "public"
    wall_break = root / "wallBreak"
    wall_break.mkdir(parents=True, exist_ok=True)
    write_wav(wall_break / "pop.wav", pop())
    write_wav(wall_break / "chime.wav", chime())
    print("wrote wallBreak/pop.wav and wallBreak/chime.wav")
    write_wav(wall_break / "glass.wav", glass())  # --- boris-glass ---
    print("wrote wallBreak/glass.wav")

    hit = root / "hitSounds"
    hit.mkdir(parents=True, exist_ok=True)
    write_wav(hit / "click.wav", click())
    write_wav(hit / "pluck.wav", pluck())
    write_wav(hit / "kick.wav", kick())
    print("wrote hitSounds/click.wav, hitSounds/pluck.wav and hitSounds/kick.wav")


if __name__ == "__main__":
    main()
