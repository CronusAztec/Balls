import { describe, expect, it } from "vitest";
import { BED_FADE_SEC, DEFAULT_MUSIC_OPTIONS, DUCK_FLOOR, MusicBed, bedFadeAt, duckEnvelope, duckedLevel, normalizeMusicOptions, playbackPosition, resolveOffset, scheduleDuck, type DuckParam } from "@/lib/audio/musicBed";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";

/* ------------------------------------------------------------------ envelope maths */

describe("ducking envelope", () => {
  it("drops to 1 - ducking, never below the exponential-ramp floor", () => {
    expect(duckedLevel(0)).toBe(1);
    expect(duckedLevel(0.25)).toBeCloseTo(0.75);
    expect(duckedLevel(1)).toBe(DUCK_FLOOR);
    expect(duckedLevel(-3)).toBe(1);
    expect(duckedLevel(7)).toBe(DUCK_FLOOR);
    expect(duckedLevel(Number.NaN)).toBe(1);
  });

  it("starts at the ducked level and is fully recovered after the release time", () => {
    expect(duckEnvelope(0, 0.5, 200)).toBeCloseTo(0.5);
    expect(duckEnvelope(200, 0.5, 200)).toBe(1);
    expect(duckEnvelope(5000, 0.5, 200)).toBe(1);
    expect(duckEnvelope(-10, 0.5, 200)).toBeCloseTo(0.5);
  });

  it("recovers monotonically along Web Audio's exponential curve", () => {
    let prev = 0;
    for (let ms = 0; ms <= 300; ms += 10) {
      const g = duckEnvelope(ms, 0.8, 300);
      expect(g).toBeGreaterThanOrEqual(prev);
      expect(g).toBeLessThanOrEqual(1);
      prev = g;
    }
    // exponentialRampToValueAtTime: v(t) = v0 * (v1 / v0)^(t / T), so halfway the gain is sqrt(v0).
    expect(duckEnvelope(150, 0.8, 300)).toBeCloseTo(Math.sqrt(0.2));
    // The first half of the release recovers less than the second half in linear terms (it is exponential, not linear).
    expect(duckEnvelope(150, 0.8, 300) - duckEnvelope(0, 0.8, 300)).toBeLessThan(duckEnvelope(300, 0.8, 300) - duckEnvelope(150, 0.8, 300));
  });

  it("is flat when ducking is off", () => {
    for (const ms of [0, 50, 500]) expect(duckEnvelope(ms, 0, 250)).toBe(1);
  });

  it("tolerates a zero or negative release", () => {
    expect(duckEnvelope(0, 0.5, 0)).toBeCloseTo(0.5);
    expect(duckEnvelope(1, 0.5, 0)).toBe(1);
    expect(duckEnvelope(1, 0.5, -100)).toBe(1);
  });
});

describe("scheduleDuck", () => {
  type Call = [method: string, value: number, time: number];
  const record = (withHold = false) => {
    const calls: Call[] = [];
    const param: DuckParam = {
      cancelScheduledValues: (t) => calls.push(["cancel", 0, t]),
      setValueAtTime: (v, t) => calls.push(["set", v, t]),
      exponentialRampToValueAtTime: (v, t) => calls.push(["ramp", v, t]),
    };
    if (withHold) param.cancelAndHoldAtTime = (t) => calls.push(["hold", 0, t]);
    return { calls, param };
  };

  it("cancels pending ramps, drops instantly and ramps back to 1 over the release", () => {
    const { calls, param } = record();
    expect(scheduleDuck(param, 12.5, 0.4, 250)).toBe(true);
    expect(calls).toEqual([
      ["cancel", 0, 12.5],
      ["set", 0.6, 12.5],
      ["ramp", 1, 12.75],
    ]);
  });

  it("holds a running recovery at the trigger time where the browser supports it", () => {
    const { calls, param } = record(true);
    scheduleDuck(param, 3, 0.5, 100);
    expect(calls.map((c) => c[0])).toEqual(["hold", "set", "ramp"]);
    expect(calls[0][2]).toBe(3);
  });

  it("never ramps from zero (full ducking uses the floor)", () => {
    const { calls, param } = record();
    scheduleDuck(param, 1, 1, 100);
    expect(calls[1]).toEqual(["set", DUCK_FLOOR, 1]);
    expect(calls[2]).toEqual(["ramp", 1, 1.1]);
  });

  it("does nothing when ducking is off", () => {
    const { calls, param } = record();
    expect(scheduleDuck(param, 3, 0, 250)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("re-triggering restarts the envelope from the ducked level", () => {
    const { calls, param } = record();
    scheduleDuck(param, 1, 0.5, 400);
    scheduleDuck(param, 1.1, 0.5, 400);
    expect(calls.filter((c) => c[0] === "cancel").map((c) => c[2])).toEqual([1, 1.1]);
    expect(calls.filter((c) => c[0] === "set").map((c) => c[2])).toEqual([1, 1.1]);
    expect(calls.filter((c) => c[0] === "ramp").map((c) => c[2])).toEqual([1.4, 1.5]);
  });
});

/* ------------------------------------------------------------------ offsets */

describe("music bed offsets", () => {
  it("wraps the start offset for looping tracks and clamps it otherwise", () => {
    expect(resolveOffset(0, 10, true)).toBe(0);
    expect(resolveOffset(4, 10, true)).toBe(4);
    expect(resolveOffset(14, 10, true)).toBeCloseTo(4);
    expect(resolveOffset(4, 10, false)).toBe(4);
    expect(resolveOffset(10, 10, false)).toBeNull();
    expect(resolveOffset(25, 10, false)).toBeNull();
  });

  it("treats negative, NaN and empty inputs as the start of the track", () => {
    expect(resolveOffset(-5, 10, false)).toBe(0);
    expect(resolveOffset(Number.NaN, 10, true)).toBe(0);
    expect(resolveOffset(1, 0, true)).toBeNull();
  });

  it("tracks the position across pause/resume", () => {
    expect(playbackPosition(2, 3, 10, false)).toBe(5);
    expect(playbackPosition(2, 30, 10, false)).toBe(10);
    expect(playbackPosition(2, 30, 10, true)).toBeCloseTo(2);
    expect(playbackPosition(8, 5, 10, true)).toBeCloseTo(3);
    expect(playbackPosition(0, -1, 10, true)).toBe(0);
    expect(playbackPosition(1, 1, 0, true)).toBe(0);
  });
});

describe("normalizeMusicOptions", () => {
  it("clamps every field and keeps the base value for invalid numbers", () => {
    const base = DEFAULT_MUSIC_OPTIONS;
    expect(normalizeMusicOptions({ volume: 3, ducking: -1, releaseMs: 0, startOffset: -4, loop: false }, base)).toEqual({ volume: 3, ducking: 0, releaseMs: 1, startOffset: 0, loop: false }); // --- uncap-all --- (volume has no maximum)
    expect(normalizeMusicOptions({ volume: Number.NaN, releaseMs: Number.POSITIVE_INFINITY }, base)).toEqual(base);
    expect(normalizeMusicOptions({}, base)).toEqual(base);
  });
});

/* ------------------------------------------------------------------ the player */

type ParamCall = [method: string, value: number, time: number];

function fakeParam(value: number) {
  const calls: ParamCall[] = [];
  return {
    value,
    calls,
    setValueAtTime: (v: number, t: number) => calls.push(["set", v, t]),
    linearRampToValueAtTime: (v: number, t: number) => calls.push(["linear", v, t]),
    exponentialRampToValueAtTime: (v: number, t: number) => calls.push(["exp", v, t]),
    setTargetAtTime: (v: number, t: number) => calls.push(["target", v, t]),
    cancelScheduledValues: (t: number) => calls.push(["cancel", 0, t]),
  };
}

interface FakeSource {
  buffer: unknown;
  loop: boolean;
  onended: (() => void) | null;
  started: { when: number; offset: number; loop: boolean } | null;
  stoppedAt: number | null;
}

/** Minimal stand-in for the Web Audio objects the MusicBed touches; logs gains and sources. */
function fakeAudio(time: number) {
  const gains: ReturnType<typeof fakeParam>[] = [];
  const sources: FakeSource[] = [];
  const ctx = {
    currentTime: time,
    state: "running",
    resume: async () => undefined,
    createGain: () => {
      const gain = fakeParam(1);
      gains.push(gain);
      return { gain, connect: () => undefined, disconnect: () => undefined };
    },
    createBufferSource: () => {
      const source = {
        buffer: null as unknown,
        loop: false,
        onended: null as (() => void) | null,
        started: null as FakeSource["started"],
        stoppedAt: null as number | null,
        connect: () => undefined,
        disconnect: () => undefined,
        start(when: number, offset: number) {
          source.started = { when, offset, loop: source.loop };
        },
        stop(when: number) {
          source.stoppedAt = when;
        },
      };
      sources.push(source);
      return source;
    },
  };
  return {
    ctx: ctx as unknown as AudioContext,
    destination: {} as AudioNode,
    /** attach() creates the duck stage first and the volume stage second. */
    gains,
    sources,
    tick(t: number) {
      ctx.currentTime = t;
    },
  };
}

describe("MusicBed", () => {
  const track = { duration: 10 } as AudioBuffer;
  const setup = (time = 100) => {
    const audio = fakeAudio(time);
    const bed = new MusicBed();
    bed.attach(audio.ctx, audio.destination);
    bed.setBuffer(track);
    return { audio, bed, duck: audio.gains[0], volume: audio.gains[1] };
  };

  it("plays from the start offset, pauses keeping its position, resumes there and restarts from the offset", () => {
    const { audio, bed } = setup();
    bed.setOptions({ startOffset: 2 });
    expect(bed.play()).toBe(true);
    expect(bed.isPlaying()).toBe(true);
    expect(audio.sources[0].started).toEqual({ when: 0, offset: 2, loop: true });
    expect(audio.sources[0].buffer).toBe(track);
    audio.tick(103);
    expect(bed.getPosition()).toBeCloseTo(5);
    bed.pause();
    expect(bed.isPlaying()).toBe(false);
    expect(audio.sources[0].stoppedAt).toBeCloseTo(103 + BED_FADE_SEC); // faded out, not cut
    audio.tick(110);
    expect(bed.getPosition()).toBeCloseTo(5); // holds while paused
    expect(bed.play()).toBe(true);
    expect(audio.sources[1].started?.offset).toBeCloseTo(5);
    audio.tick(111);
    bed.restart();
    expect(audio.sources[1].stoppedAt).toBeCloseTo(111 + BED_FADE_SEC);
    expect(audio.sources[2].started?.offset).toBe(2);
    expect(bed.isPlaying()).toBe(true);
  });

  it("wraps the position of a looping track and goes quiet at the end of a non-looping one until the next restart", () => {
    const { audio, bed } = setup();
    bed.setOptions({ startOffset: 8 });
    bed.play();
    audio.tick(105);
    expect(bed.getPosition()).toBeCloseTo(3); // 8 + 5 wrapped around the 10 s track
    bed.setOptions({ loop: false, startOffset: 0 });
    expect(audio.sources[0].loop).toBe(false); // applied to the sounding source
    bed.restart();
    expect(audio.sources[1].started).toEqual({ when: 0, offset: 0, loop: false });
    audio.sources[1].onended?.(); // the track played to its end
    expect(bed.isPlaying()).toBe(false);
    expect(bed.getPosition()).toBe(10);
    expect(bed.play()).toBe(false); // nothing left to play…
    expect(audio.sources).toHaveLength(2);
    bed.restart(); // …until the run restarts
    expect(audio.sources[2].started?.offset).toBe(0);
    expect(bed.isPlaying()).toBe(true);
  });

  it("never starts a non-looping track past its end", () => {
    const { audio, bed } = setup();
    bed.setOptions({ loop: false, startOffset: 12 });
    expect(bed.play()).toBe(false);
    expect(audio.sources).toHaveLength(0);
    bed.setOptions({ loop: true });
    expect(bed.play()).toBe(true);
    expect(audio.sources[0].started?.offset).toBeCloseTo(2);
  });

  it("keeps the wrapped position when Loop is switched off on a track that already wrapped, so pause/resume carries on", () => {
    const { audio, bed } = setup();
    bed.play(); // loop on, from 0
    audio.tick(114); // 14 s into the 10 s track: the looping source wrapped and sounds at 4 s
    expect(bed.getPosition()).toBeCloseTo(4);
    bed.setOptions({ loop: false });
    expect(audio.sources[0].loop).toBe(false);
    expect(bed.getPosition()).toBeCloseTo(4); // the source carries on from its wrapped playhead, not from the end
    audio.tick(115);
    bed.pause();
    expect(bed.getPosition()).toBeCloseTo(5);
    expect(bed.play()).toBe(true); // resumes instead of treating the track as finished
    expect(audio.sources).toHaveLength(2);
    expect(audio.sources[1].started?.offset).toBeCloseTo(5);
    expect(audio.sources[1].started?.loop).toBe(false);
    audio.tick(120);
    expect(bed.getPosition()).toBeCloseTo(10); // a source that never looped clamps at the end…
    audio.sources[1].onended?.(); // …and ends there
    expect(bed.isPlaying()).toBe(false);
    expect(bed.play()).toBe(false);
    bed.restart();
    expect(audio.sources[2].started).toEqual({ when: 0, offset: 0, loop: false });
  });

  it("follows a source that starts without looping and is switched to loop mid-run", () => {
    const { audio, bed } = setup();
    bed.setOptions({ loop: false, startOffset: 3 });
    bed.play();
    audio.tick(104);
    bed.setOptions({ loop: true }); // the sounding source loops from now on
    expect(audio.sources[0].loop).toBe(true);
    audio.tick(112); // 3 + 12 = 15 s of playback: wrapped once
    expect(bed.getPosition()).toBeCloseTo(5);
    bed.setOptions({ loop: false }); // once looped, the wrap is remembered even with Loop off again
    bed.pause();
    expect(bed.getPosition()).toBeCloseTo(5);
    expect(bed.play()).toBe(true);
    expect(audio.sources[1].started?.offset).toBeCloseTo(5);
    expect(audio.sources[1].started?.loop).toBe(false);
  });

  it("ducks the duck stage at the sound's time, once per time, only while playing", () => {
    const { audio, bed, duck } = setup();
    bed.setOptions({ ducking: 0.5, releaseMs: 200 });
    bed.duck(100);
    expect(duck.calls).toEqual([]); // silent bed: nothing to duck
    bed.play();
    bed.duck(100.5); // a beat-locked sound a little ahead of "now"
    expect(duck.calls).toEqual([
      ["cancel", 0, 100.5],
      ["set", 0.5, 100.5],
      ["exp", 1, 100.7],
    ]);
    bed.duck(100.5); // two hits in the same frame share one duck
    expect(duck.calls).toHaveLength(3);
    audio.tick(105);
    bed.duck(101); // a time in the past is scheduled now, never behind the clock
    expect(duck.calls.slice(3)).toEqual([
      ["cancel", 0, 105],
      ["set", 0.5, 105],
      ["exp", 1, 105.2],
    ]);
    bed.setOptions({ ducking: 0 });
    bed.duck(106);
    expect(duck.calls).toHaveLength(6);
    bed.pause();
    bed.setOptions({ ducking: 1 });
    bed.duck(107);
    expect(duck.calls).toHaveLength(6); // paused: nothing to duck
  });

  it("smooths volume changes on the volume stage and fades every start", () => {
    const { audio, bed, volume } = setup();
    expect(volume.value).toBe(DEFAULT_MUSIC_OPTIONS.volume);
    bed.setOptions({ volume: 0.3 });
    expect(volume.calls).toEqual([["target", 0.3, 100]]);
    bed.play();
    const fade = audio.gains[2];
    expect(fade.calls).toEqual([
      ["set", 0, 100],
      ["linear", 1, 100 + BED_FADE_SEC],
    ]);
  });

  it("notifies a listener when playback starts, pauses, stops and ends on its own", () => {
    const { audio, bed } = setup();
    const seen: boolean[] = [];
    bed.setPlayingListener((playing) => seen.push(playing));
    bed.play();
    bed.pause();
    bed.play();
    bed.stop();
    bed.setOptions({ loop: false });
    bed.play();
    audio.sources.at(-1)?.onended?.();
    expect(seen).toEqual([true, false, true, false, true, false]);
  });

  it("keeps the track across detach and plays again once re-attached", () => {
    const { audio, bed } = setup();
    bed.play();
    bed.detach();
    expect(bed.isPlaying()).toBe(false);
    expect(bed.isAttached()).toBe(false);
    expect(bed.hasTrack()).toBe(true);
    expect(bed.play()).toBe(false);
    expect(bed.getDuckGain()).toBe(1);
    const fresh = fakeAudio(500);
    bed.attach(fresh.ctx, fresh.destination);
    expect(bed.play()).toBe(true);
    expect(fresh.sources[0].started?.offset).toBe(0);
    expect(audio.sources).toHaveLength(1);
  });

  it("swaps the track mid-run without stopping the music, and removing it goes silent", () => {
    const { audio, bed } = setup();
    bed.setOptions({ startOffset: 1 });
    bed.play();
    audio.tick(104);
    const other = { duration: 30 } as AudioBuffer;
    bed.setBuffer(other);
    expect(bed.isPlaying()).toBe(true);
    expect(audio.sources[0].stoppedAt).toBeCloseTo(104 + BED_FADE_SEC);
    expect(audio.sources[1].buffer).toBe(other);
    expect(audio.sources[1].started?.offset).toBe(1);
    expect(bed.getDuration()).toBe(30);
    bed.setBuffer(null);
    expect(bed.isPlaying()).toBe(false);
    expect(bed.hasTrack()).toBe(false);
    expect(bed.play()).toBe(false);
  });
});

/* ------------------------------------------------------------------ settings */

// --- review fix (audio) ---
describe("music bed fade out", () => {
  it("knows the fade stage's gain: the fade in, then 1", () => {
    expect(bedFadeAt(-1)).toBe(0);
    expect(bedFadeAt(0)).toBe(0);
    expect(bedFadeAt(BED_FADE_SEC / 3)).toBeCloseTo(1 / 3, 12);
    expect(bedFadeAt(BED_FADE_SEC)).toBe(1);
    expect(bedFadeAt(60)).toBe(1);
  });

  it("fades a stopped bed out from where its fade in got to, not from the param's last rendered value", () => {
    const audio = fakeAudio(100);
    const bed = new MusicBed();
    bed.attach(audio.ctx, audio.destination);
    bed.setBuffer({ duration: 10 } as AudioBuffer);
    bed.play();
    const fade = audio.gains[2]; // duck, volume, then the source's fade stage
    audio.tick(100 + BED_FADE_SEC / 3);
    bed.pause(); // a third of the way into the fade in
    const cancel = fade.calls.findIndex(([m]) => m === "cancel");
    expect(fade.calls[cancel + 1][0]).toBe("set");
    expect(fade.calls[cancel + 1][1]).toBeCloseTo(1 / 3, 9); // the param's value reads 1 here
    expect(fade.calls[cancel + 2]).toEqual(["linear", 0, 100 + BED_FADE_SEC / 3 + BED_FADE_SEC]);
    audio.tick(101);
    bed.play();
    audio.tick(105);
    bed.stop(); // long after the fade in: from 1
    const later = audio.gains[3].calls;
    expect(later[later.findIndex(([m]) => m === "cancel") + 1]).toEqual(["set", 1, 105]);
  });
});

describe("music bed settings", () => {
  it("has sensible defaults inside the slider ranges", () => {
    const d = defaultSettings();
    expect(d.musicVolume).toBe(0.5);
    expect(d.musicDucking).toBe(0.6);
    expect(d.musicDuckRelease).toBe(250);
    expect(d.musicLoop).toBe(true);
    expect(d.musicStartOffset).toBe(0);
    expect(RANGES.musicDuckRelease).toEqual({ min: 50, max: 1000, step: 10 });
    expect(d.musicVolume).toBeLessThanOrEqual(RANGES.musicVolume.max);
    expect(d.musicDuckRelease).toBeGreaterThanOrEqual(RANGES.musicDuckRelease.min);
  });

  it("round-trips through the URL with short keys", () => {
    const s = { ...defaultSettings("classic"), musicVolume: 0.3, musicDucking: 1, musicDuckRelease: 500, musicLoop: false, musicStartOffset: 12.5 };
    const params = settingsToSearchParams(s);
    expect(params.get("mv")).toBe("0.3");
    expect(params.get("md")).toBe("1");
    expect(params.get("mdr")).toBe("500");
    expect(params.get("mloop")).toBe("0");
    expect(params.get("mso")).toBe("12.5");
    expect(settingsFromSearchParams(params)).toEqual(s);
    const defaults = settingsToSearchParams(defaultSettings("classic"));
    for (const key of ["mv", "md", "mdr", "mloop", "mso"]) expect(defaults.has(key)).toBe(false);
  });

  it("clamps out-of-range URL values to the slider ranges", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mv=7&md=-1&mdr=5&mso=9999&mloop=0"));
    expect(s.musicVolume).toBe(7); // --- uncap-all --- (no maximum)
    expect(s.musicDucking).toBe(0);
    expect(s.musicDuckRelease).toBe(50);
    expect(s.musicStartOffset).toBe(9999);
    expect(s.musicLoop).toBe(false);
  });

  it("validates presets: old presets get the defaults, bad values are clamped or replaced", () => {
    const old = presetToSettings({ mode: "portal", gravity: 100 });
    expect(old.musicVolume).toBe(0.5);
    expect(old.musicDuckRelease).toBe(250);
    expect(old.musicLoop).toBe(true);
    const bad = presetToSettings({ mode: "classic", musicVolume: 4, musicDucking: "loud", musicDuckRelease: -20, musicLoop: "yes", musicStartOffset: 5 } as unknown as Partial<SimulatorSettings>);
    expect(bad.musicVolume).toBe(4); // --- uncap-all --- (no maximum)
    expect(bad.musicDucking).toBe(0.6);
    expect(bad.musicDuckRelease).toBe(50);
    expect(bad.musicLoop).toBe(true);
    expect(bad.musicStartOffset).toBe(5);
    expect(presetToSettings({ mode: "classic", musicLoop: false }).musicLoop).toBe(false);
  });
});
