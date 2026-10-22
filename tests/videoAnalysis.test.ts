import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { CUT_THRESHOLD, PCM_RATE, SAMPLE_BYTES, VIDEO_DEMUXERS, audioStatsArgs, cutsArgs, infoArgs, inputArgs, lastFramesArgs, pcmArgs, sampleFramesArgs } from "@/lib/videoAnalysis/ffmpegArgs";
import { parseCuts, parseDurationSec, parseIntegratedLufs, parseMediaInfo, parseSilences, pcmSamples, splitFrames } from "@/lib/videoAnalysis/ffmpegParse";
import { MOTION_MIN, buildVideoFeatures, loopSeamDiff, lumaOf, meanSaturation, pictureFeatures, soundFeatures } from "@/lib/videoAnalysis/features";
import { integratedLoudness } from "@/lib/audio/loudness";
import { resolveFfmpeg } from "../scripts/agent/analyse.mjs";

// --- agent-cli --- (video analysis) The analyser's pure halves (src/lib/videoAnalysis) and the CLI's `analyse` end to end on
// a clip with known cuts, tempo and loudness that ffmpeg makes here: local files only, every field within tolerance.

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "agent", "cli.mjs");

/** A solid rgb24 16 × 16 picture. */
const solid = (r: number, g: number, b: number) => {
  const out = new Uint8Array(SAMPLE_BYTES);
  for (let i = 0; i < 256; i++) out.set([r, g, b], 3 * i);
  return out;
};

/** Clicks: a 1 kHz burst of 30 ms every `period` seconds from `first`, at `amplitude`, `seconds` long. */
function clicks(rate: number, seconds: number, { first = 0.25, period = 0.5, amplitude = 0.5 } = {}) {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let t0 = first; t0 < seconds; t0 += period) {
    const start = Math.round(t0 * rate);
    for (let i = 0; i < Math.round(0.03 * rate) && start + i < out.length; i++) out[start + i] = amplitude * Math.sin((2 * Math.PI * 1000 * i) / rate);
  }
  return out;
}

describe("ffmpeg arguments (--- agent-cli ---)", () => {
  const file = "/repo/.agent-out/inbox/clip.mp4";

  it("open only a local file, only as a video container, never through another protocol", () => {
    expect(inputArgs(file, { maxSec: 300 })).toEqual(["-protocol_whitelist", "file", "-format_whitelist", VIDEO_DEMUXERS, "-t", "300", "-i", `file:${file}`]);
    expect(inputArgs(file, undefined, 0.5)).toEqual(["-protocol_whitelist", "file", "-format_whitelist", VIDEO_DEMUXERS, "-sseof", "-0.5", "-i", `file:${file}`]);
    for (const args of [infoArgs(file), sampleFramesArgs(file, 2, { maxSec: 60 }), lastFramesArgs(file), cutsArgs(file, "cuts.txt", { maxSec: 60 }), audioStatsArgs(file, { maxSec: 60 }), pcmArgs(file, { maxSec: 60 })]) {
      expect(args[args.indexOf("-i") + 1]).toBe(`file:${file}`);
      expect(args).toContain("-protocol_whitelist");
      expect(args.filter((a) => a === "-i")).toHaveLength(1);
    }
    expect(() => inputArgs("/x\ny.mp4")).toThrow(/control character/);
    expect(() => cutsArgs(file, "../cuts.txt", { maxSec: 1 })).toThrow(/bare file name/);
  });

  it("sample 16 × 16 RGB pictures, cut on scdet, measure loudness and silence, and decode mono PCM", () => {
    expect(sampleFramesArgs(file, 2, { maxSec: 60 })).toEqual(expect.arrayContaining(["-vf", "fps=2,scale=16:16:flags=area,format=rgb24", "-f", "rawvideo", "pipe:1"]));
    expect(cutsArgs(file, "cuts.txt", { maxSec: 60 })).toContain(`scale=64:-2,scdet=threshold=${CUT_THRESHOLD}:sc_pass=1,metadata=print:file=cuts.txt`);
    expect(audioStatsArgs(file, { maxSec: 60 })).toContain("silencedetect=noise=-50dB:duration=0.3,ebur128=framelog=quiet");
    expect(pcmArgs(file, { maxSec: 60 })).toEqual(expect.arrayContaining(["-ac", "1", "-ar", String(PCM_RATE), "-f", "f32le", "pipe:1"]));
  });
});

describe("ffmpeg output parsers (--- agent-cli ---)", () => {
  const banner = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'file:/r/clip.mp4':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 125 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 180x320 [SAR 1:1 DAR 9:16], 86 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 29 kb/s (default)
At least one output file must be specified`;

  it("reads the banner: duration, size, rate, codec and sound – a ±90° rotation swaps the size", () => {
    expect(parseMediaInfo(banner)).toEqual({ durationSec: 62.5, fps: 30, width: 180, height: 320, videoCodec: "h264", hasVideo: true, hasAudio: true });
    const phone = `  Duration: 00:00:10.01, start: 0.000000, bitrate: 9000 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 1920x1080, 8000 kb/s, 29.97 fps, 29.97 tbr, 600 tbn (default)
    Side data:
      displaymatrix: rotation of -90.00 degrees`;
    expect(parseMediaInfo(phone)).toMatchObject({ width: 1080, height: 1920, fps: 29.97, videoCodec: "hevc", hasAudio: false });
    expect(parseDurationSec("Duration: N/A, bitrate: N/A")).toBeNull();
    expect(parseMediaInfo("nothing here")).toEqual({ durationSec: null, fps: null, width: null, height: null, videoCodec: null, hasVideo: false, hasAudio: false });
  });

  it("reads scdet's cuts, ebur128's integrated loudness and silencedetect's spans", () => {
    expect(parseCuts("frame:0    pts:30720   pts_time:2\nlavfi.scd.mafd=41.1\nlavfi.scd.score=41.1\nlavfi.scd.time=2\nframe:1 pts:61440 pts_time:4\nlavfi.scd.time=4\nlavfi.scd.time=2\n")).toEqual([2, 4]);
    expect(parseIntegratedLufs("[Parsed_ebur128_1 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -15.3 LUFS\n    Threshold: -25.3 LUFS\n")).toBe(-15.3);
    expect(parseIntegratedLufs("  Integrated loudness:\n    I: -70.0 LUFS")).toBeNull();
    expect(parseIntegratedLufs("Summary:\n    I:         -inf LUFS")).toBeNull();
    const stderr = "[silencedetect @ 0x1] silence_start: 0.5\n[silencedetect @ 0x1] silence_end: 1.25 | silence_duration: 0.75\n[silencedetect @ 0x1] silence_start: 5.5\n";
    expect(parseSilences(stderr, 6)).toEqual([{ start: 0.5, end: 1.25 }, { start: 5.5, end: 6 }]);
    expect(parseSilences(stderr)).toEqual([{ start: 0.5, end: 1.25 }]);
  });

  it("cuts raw pictures and little-endian float PCM out of stdout", () => {
    const raw = new Uint8Array(2 * SAMPLE_BYTES + 5);
    expect(splitFrames(raw, SAMPLE_BYTES)).toHaveLength(2);
    const pcm = new Uint8Array(new Float32Array([0.5, -0.25]).buffer);
    expect([...pcmSamples(new Uint8Array([...pcm, 1, 2]))]).toEqual([0.5, -0.25]);
  });
});

describe("VideoFeatures (--- agent-cli ---)", () => {
  it("measures luma, saturation, darkness, motion and the loop seam on 16 × 16 samples", () => {
    expect(lumaOf(solid(255, 255, 255))[0]).toBeCloseTo(1, 6);
    expect(meanSaturation(solid(255, 0, 0))).toBe(1);
    expect(meanSaturation(solid(128, 128, 128))).toBe(0);
    const black = solid(0, 0, 0);
    const white = solid(255, 255, 255);
    const red = solid(255, 0, 0);
    const p = pictureFeatures([black, black, white, white, red], 2);
    expect(p.motion).toEqual([0, 0, 1, 0, 0.701]);
    expect(p.firstMotionSec).toBe(1); // sample 2 at 2 per second
    expect(p.peakMotionPos).toBe(0.5); // sample 2 of 0–4
    expect(p.meanLuma).toBeCloseTo((0 + 0 + 1 + 1 + 0.299) / 5, 4);
    expect(p.meanSat).toBe(0.2);
    expect(p.darkShare).toBe(0.4);
    expect(pictureFeatures([black, solid(2, 2, 2)], 2).firstMotionSec).toBeNull(); // under MOTION_MIN
    expect(MOTION_MIN).toBeGreaterThan(2 / 255);
    expect(loopSeamDiff(black, white)).toBe(1);
    expect(loopSeamDiff(black, undefined)).toBeNull();
    expect(pictureFeatures([], 2)).toEqual({ motion: [], firstMotionSec: null, peakMotionPos: null, meanLuma: null, meanSat: null, darkShare: null });
  });

  it("finds the tempo and the first sound of clicks with the app's own beat detector", () => {
    const s = soundFeatures(clicks(PCM_RATE, 8), PCM_RATE);
    expect(s.bpm).not.toBeNull();
    expect(Math.abs((s.bpm ?? 0) - 120)).toBeLessThanOrEqual(2);
    expect(s.firstSoundSec).toBeCloseTo(0.25, 1);
    expect(s.onsetsPerSec).toBeGreaterThan(1);
    expect(soundFeatures(new Float32Array(100), PCM_RATE)).toEqual({ bpm: null, bpmConfidence: null, onsetsPerSec: null, firstSoundSec: null });
  });

  it("builds the record: cuts per minute, silence inside the window, sound fields only with sound", () => {
    const info = { durationSec: 6, fps: 30, width: 180, height: 320, videoCodec: "h264", hasVideo: true, hasAudio: true };
    const f = buildVideoFeatures({ info, sampleHz: 2, maxSec: 300, frames: [solid(0, 0, 0), solid(255, 0, 0)], lastFrame: solid(255, 0, 0), cuts: [2, 4, 9], lufs: -15.34, silences: [{ start: 5, end: 7 }], sound: { bpm: 120, bpmConfidence: 0.8, onsetsPerSec: 2, firstSoundSec: 0.25 } });
    expect(f).toMatchObject({ v: 1, durationSec: 6, analysedSec: 6, cuts: [2, 4], cutsPerMin: 20, lufs: -15.3, bpm: 120, silenceSec: 1, loopSeamDiff: 0.299 });
    const mute = buildVideoFeatures({ info: { ...info, hasAudio: false }, sampleHz: 2, maxSec: 3, frames: [], cuts: [], lufs: -10, silences: [], sound: null });
    expect(mute).toMatchObject({ analysedSec: 3, hasAudio: false, lufs: null, bpm: null, silenceSec: null, meanLuma: null });
  });
});

describe("analyse end to end (--- agent-cli ---)", () => {
  const dir = path.join(ROOT, ".agent-out", `test-videoAnalysis-${process.pid}`);
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = (json: unknown) => {
    const r = spawnSync(process.execPath, [CLI, "analyse", "--json", JSON.stringify(json)], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
    return { code: r.status, out: JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}") };
  };

  it("refuses URLs, data: URIs and files outside the repository – nothing is fetched or opened", () => {
    for (const p of ["https://example.com/clip.mp4", "http://localhost/clip.mp4", "data:video/mp4;base64,AAAA", "file:///etc/hosts", "/etc/hosts", "../outside.mp4"]) {
      const r = cli({ path: p });
      expect(r.code, p).toBe(1);
      expect(r.out.ok, p).toBe(false);
      expect(r.out.error, p).toMatch(/URL or a data: URI|outside the repository/);
    }
  });

  it("measures a clip with known cuts, tempo and loudness within tolerance", () => {
    fs.mkdirSync(dir, { recursive: true });
    const clip = path.join(dir, "clip.mp4");
    const ffmpeg = resolveFfmpeg();
    if (!ffmpeg) {
      fs.writeFileSync(clip, "not a video");
      const r = cli({ path: path.relative(ROOT, clip) });
      expect(r.out.error).toMatch(/No ffmpeg found/);
      return;
    }
    // the sound: clicks at 120 bpm from 0.25 s, stereo 44.1 kHz, written as WAV; its loudness measured by the app's own meter
    const rate = 44100;
    const mono = clicks(rate, 6);
    const wav = Buffer.alloc(44 + mono.length * 4);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + mono.length * 4, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 4, 28);
    wav.writeUInt16LE(4, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(mono.length * 4, 40);
    for (let i = 0; i < mono.length; i++) {
      const v = Math.round(Math.max(-1, Math.min(1, mono[i])) * 32767);
      wav.writeInt16LE(v, 44 + 4 * i);
      wav.writeInt16LE(v, 46 + 4 * i);
    }
    fs.writeFileSync(path.join(dir, "clicks.wav"), wav);
    const expectedLufs = integratedLoudness([mono, mono], rate);
    // the picture: 2 s black, 2 s of ffmpeg's moving test pattern, 2 s red – cuts at 2 s and 4 s
    const make = spawnSync(
      ffmpeg.path,
      ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=180x320:r=30:d=2", "-f", "lavfi", "-i", "testsrc2=s=180x320:r=30:d=2", "-f", "lavfi", "-i", "color=c=red:s=180x320:r=30:d=2", "-i", path.join(dir, "clicks.wav"), "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a", "-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", clip],
      { encoding: "utf8", timeout: 60_000 },
    );
    expect(make.status, make.stderr).toBe(0);
    const r = cli({ path: path.relative(ROOT, clip) });
    expect(r.code, JSON.stringify(r.out)).toBe(0);
    const f = r.out.result.features;
    expect(r.out.result.file).toBe(path.relative(ROOT, clip).split(path.sep).join("/"));
    expect(Math.abs(f.durationSec - 6)).toBeLessThanOrEqual(0.1);
    expect(f).toMatchObject({ v: 1, fps: 30, width: 180, height: 320, hasAudio: true, sampleHz: 2 });
    expect(f.cuts).toHaveLength(2);
    expect(Math.abs(f.cuts[0] - 2)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(f.cuts[1] - 4)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(f.cutsPerMin - 20)).toBeLessThanOrEqual(1);
    expect(Math.abs(f.motion.length - 12)).toBeLessThanOrEqual(1);
    expect(Math.abs(f.firstMotionSec - 2)).toBeLessThanOrEqual(0.5);
    expect(f.peakMotionPos).toBeGreaterThan(0.2);
    expect(f.peakMotionPos).toBeLessThan(0.8);
    expect(f.darkShare).toBeGreaterThan(0.3);
    expect(f.darkShare).toBeLessThan(0.5);
    expect(f.meanSat).toBeGreaterThan(0.4);
    expect(f.meanSat).toBeLessThan(0.8);
    expect(f.meanLuma).toBeGreaterThan(0.15);
    expect(f.meanLuma).toBeLessThan(0.35);
    expect(f.loopSeamDiff).toBeGreaterThan(0.2); // black first, red last: no seamless loop
    expect(Math.abs(f.lufs - expectedLufs)).toBeLessThanOrEqual(1);
    expect(Math.abs(f.bpm - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(f.firstSoundSec - 0.25)).toBeLessThanOrEqual(0.05);
    expect(f.onsetsPerSec).toBeGreaterThan(1);
    expect(f.silenceSec).toBeGreaterThan(4.5);
    expect(f.silenceSec).toBeLessThan(6);
    // the file is read where it is: nothing copied next to it, the analyser's scratch folder gone
    expect(fs.readdirSync(dir).sort()).toEqual(["clicks.wav", "clip.mp4"]);
  }, 120_000);
});
