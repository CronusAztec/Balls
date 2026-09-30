import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../scripts/viral-bot.mjs";

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

  it("exits with a usage error on bad options and never posts in a dry run", () => {
    const bad = spawnSync(process.execPath, [CLI, "--dry-run", "--post"], { cwd: ROOT, env, encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("Usage:");
    const help = spawnSync(process.execPath, [CLI, "--help"], { cwd: ROOT, env, encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--post");
  });
});
