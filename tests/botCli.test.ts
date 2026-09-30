import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { mp4Args, parseArgs, retargetTextFiles, transcodeClips } from "../scripts/viral-bot.mjs";

/**
 * The headless CLI (scripts/viral-bot.mjs): its options, and a real --dry-run in Node – the planner bundled with esbuild,
 * no browser – that writes the caption files, manifest.json and posting-schedule.md, the same for the same date.
 */

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "viral-bot.mjs");
const env = { ...process.env, NEXT_PUBLIC_SITE_URL: "https://example.com/Balls", IG_ACCESS_TOKEN: "", IG_USER_ID: "" };

describe("viral-bot CLI", () => {
  it("parses its options and refuses bad ones", () => {
    expect(parseArgs([])).toMatchObject({ count: 3, platform: "reels", out: "bot-output", family: "all", bucket: "auto", ending: "auto", locale: "en", dryRun: false, post: false });
    expect(parseArgs(["--count", "5", "--platform", "shorts", "--out", "x", "--date", "2026-10-01", "--family", "escape", "--ending", "resolved", "--dry-run"])).toMatchObject({ count: 5, platform: "shorts", out: "x", date: "2026-10-01", family: "escape", ending: "resolved", dryRun: true });
    expect(parseArgs(["--count=2", "--locale=pl", "--bucket=long", "--post"])).toMatchObject({ count: 2, locale: "pl", bucket: "long", post: true });
    expect(parseArgs(["--post-only", "--out", "done"])).toMatchObject({ postOnly: true, post: false, out: "done" });
    for (const bad of [["--count", "0"], ["--count", "21"], ["--platform", "vine"], ["--date", "tomorrow"], ["--family", "chess"], ["--nope"], ["--dry-run", "--post"], ["--dry-run", "--post-only"], ["--post", "--post-only"], ["--out"]]) expect(() => parseArgs(bad)).toThrow();
  });

  it("--dry-run plans in Node without a browser and writes the captions, the manifest and the schedule – the same for the same date", () => {
    const out1 = fs.mkdtempSync(path.join(os.tmpdir(), "bot-dry-"));
    const out2 = fs.mkdtempSync(path.join(os.tmpdir(), "bot-dry-"));
    try {
      const args = ["--dry-run", "--count", "3", "--platform", "reels", "--date", "2026-10-02", "--max-seeds", "4"];
      const log = execFileSync(process.execPath, [CLI, ...args, "--out", out1], { cwd: ROOT, env, encoding: "utf8" });
      execFileSync(process.execPath, [CLI, ...args, "--out", out2], { cwd: ROOT, env, encoding: "utf8" });
      expect(log).toContain("Nothing rendered, nothing posted");
      const files = fs.readdirSync(out1).sort();
      expect(files).toContain("manifest.json");
      expect(files).toContain("posting-schedule.md");
      expect(files.filter((f) => f.endsWith(".txt"))).toHaveLength(3);
      expect(files.some((f) => /\.(mp4|webm)$/.test(f))).toBe(false);
      const manifest = JSON.parse(fs.readFileSync(path.join(out1, "manifest.json"), "utf8"));
      expect(manifest.format).toBe("jumpingballslive-bot-manifest");
      expect(manifest.date).toBe("2026-10-02");
      expect(manifest.clips).toHaveLength(3);
      for (const clip of manifest.clips) {
        expect(clip.status).toBe("planned");
        expect(files).toContain(clip.captionFile);
        expect(clip.captionFile).toBe(`${clip.episode}-${clip.recipe}-${clip.seed}.txt`);
        expect(clip.shareUrl.startsWith("https://example.com/Balls/en/simulator/?")).toBe(true);
        expect(clip.score).toBeGreaterThan(0);
      }
      expect(fs.readFileSync(path.join(out2, "manifest.json"), "utf8")).toBe(fs.readFileSync(path.join(out1, "manifest.json"), "utf8"));
      expect(fs.readFileSync(path.join(out1, "posting-schedule.md"), "utf8")).toContain("| 1 |");
    } finally {
      fs.rmSync(out1, { recursive: true, force: true });
      fs.rmSync(out2, { recursive: true, force: true });
    }
  }, 120000);

  describe("WebM clips become MP4 for Instagram (a Chromium without H.264 + AAC encoders renders WebM)", () => {
    const silent = { log: () => {}, warn: () => {} };
    /** A stand-in ffmpeg: answers -version, logs its arguments and copies the input to the output (or fails with FAKE_FAIL). */
    const fakeFfmpeg = (dir: string, fail = false) => {
      const file = path.join(dir, fail ? "ffmpeg-fail" : "ffmpeg");
      fs.writeFileSync(
        file,
        `#!${process.execPath}
const fs = require("fs");
const args = process.argv.slice(2);
if (args[0] === "-version") { console.log("ffmpeg version fake"); process.exit(0); }
fs.appendFileSync(${JSON.stringify(path.join(dir, "calls.log"))}, JSON.stringify(args) + "\\n");
if (${fail}) { console.error("Unknown encoder 'libx264'"); process.exit(1); }
fs.copyFileSync(args[args.indexOf("-i") + 1], args[args.length - 1]);
`,
      );
      fs.chmodSync(file, 0o755);
      return file;
    };
    const setUp = () => {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), "bot-mp4-"));
      fs.writeFileSync(path.join(out, "ep004-1-ring-escape-42.webm"), Buffer.alloc(2048, 1));
      fs.writeFileSync(path.join(out, "ep004-2-polyrhythm-7.mp4"), Buffer.alloc(1024, 2));
      const manifest = { format: "jumpingballslive-bot-manifest", clips: [{ file: "ep004-1-ring-escape-42.webm", status: "done" }, { file: "ep004-2-polyrhythm-7.mp4", status: "done" }, { file: null, status: "failed" }] };
      fs.writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      fs.writeFileSync(path.join(out, "posting-schedule.md"), "| 1 | 12:00 | ep004-1-ring-escape-42.webm | ring-escape |\n| 2 | 18:00 | ep004-2-polyrhythm-7.mp4 | polyrhythm |\n");
      const rendered = [
        { id: "ep004-1-ring-escape-42", status: "done", file: "ep004-1-ring-escape-42.webm", durationSec: 20, bytes: 2048 },
        { id: "ep004-2-polyrhythm-7", status: "done", file: "ep004-2-polyrhythm-7.mp4", durationSec: 20, bytes: 1024 },
        { id: "ep004-3-maze-race-9", status: "failed", file: null, durationSec: null, bytes: null },
      ];
      return { out, rendered };
    };

    it("converts every WebM to H.264 + AAC MP4 with ffmpeg and points manifest.json and the schedule at it", () => {
      const { out, rendered } = setUp();
      try {
        const ffmpeg = fakeFfmpeg(out);
        const { renames, missing } = transcodeClips(out, rendered, { ffmpeg, fps: { "ep004-1-ring-escape-42": 60 }, log: silent });
        expect(missing).toBe(false);
        expect(renames).toEqual({ "ep004-1-ring-escape-42.webm": "ep004-1-ring-escape-42.mp4" });
        expect(rendered[0]).toMatchObject({ file: "ep004-1-ring-escape-42.mp4", bytes: 2048 });
        expect(rendered[1].file).toBe("ep004-2-polyrhythm-7.mp4");
        expect(fs.existsSync(path.join(out, "ep004-1-ring-escape-42.mp4"))).toBe(true);
        expect(fs.existsSync(path.join(out, "ep004-1-ring-escape-42.webm"))).toBe(false);
        const calls = fs.readFileSync(path.join(out, "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual(mp4Args(path.join(out, "ep004-1-ring-escape-42.webm"), path.join(out, "ep004-1-ring-escape-42.mp4"), 60));
        for (const flag of ["libx264", "yuv420p", "aac", "+faststart"]) expect(calls[0]).toContain(flag);
        expect(calls[0][calls[0].indexOf("-r") + 1]).toBe("60");
        retargetTextFiles(out, renames);
        const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
        expect(manifest.clips.map((c: { file: string | null }) => c.file)).toEqual(["ep004-1-ring-escape-42.mp4", "ep004-2-polyrhythm-7.mp4", null]);
        const schedule = fs.readFileSync(path.join(out, "posting-schedule.md"), "utf8");
        expect(schedule).toContain("ep004-1-ring-escape-42.mp4");
        expect(schedule).not.toContain(".webm");
      } finally {
        fs.rmSync(out, { recursive: true, force: true });
      }
    });

    it("keeps the WebM (and says why) without ffmpeg or when it fails", () => {
      const { out, rendered } = setUp();
      try {
        const warnings: string[] = [];
        const log = { log: () => {}, warn: (m: string) => warnings.push(m) };
        const none = transcodeClips(out, rendered, { ffmpeg: path.join(out, "no-such-ffmpeg"), log });
        expect(none).toEqual({ renames: {}, missing: true });
        expect(warnings.join(" ")).toMatch(/ffmpeg was not found/);
        const failed = transcodeClips(out, rendered, { ffmpeg: fakeFfmpeg(out, true), log });
        expect(failed).toEqual({ renames: {}, missing: false });
        expect(warnings.join(" ")).toMatch(/could not convert/);
        expect(rendered[0].file).toBe("ep004-1-ring-escape-42.webm");
        expect(fs.existsSync(path.join(out, "ep004-1-ring-escape-42.webm"))).toBe(true);
        expect(fs.existsSync(path.join(out, "ep004-1-ring-escape-42.mp4"))).toBe(false);
      } finally {
        fs.rmSync(out, { recursive: true, force: true });
      }
    });
  });

  it("exits with a usage error on bad options and never posts in a dry run", () => {
    const bad = spawnSync(process.execPath, [CLI, "--dry-run", "--post"], { cwd: ROOT, env, encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("Usage:");
    const help = spawnSync(process.execPath, [CLI, "--help"], { cwd: ROOT, env, encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--post");
  });
});
