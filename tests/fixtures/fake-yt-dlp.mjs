#!/usr/bin/env node
/*
 * --- inspiration --- A fake yt-dlp for tests/inspiration.test.ts: the toolbox's video tools run it instead of the real one
 * (on the PATH as `yt-dlp`, or as JBL_YTDLP), so no test reaches the network. It answers from the recorded fixtures in
 * tests/fixtures/ytdlp/ (real yt-dlp output, trimmed, channel names replaced; tiktok-page.json is shaped like it):
 *  - `--version`;
 *  - `--flat-playlist`: a `ytsearchN:` search (search.jsonl) or a hashtag Shorts feed (shorts.jsonl), --playlist-end rows;
 *  - `--skip-download`: each link's page (pages.jsonl, tiktok-page.json; any other link: an ERROR line, as yt-dlp prints
 *    for a video it cannot read);
 *  - a download (`--print after_move:filepath`): FAKE_YTDLP_CLIP copied to the --output template, the info JSON beside it.
 * It refuses a run without --ignore-config and --no-cache-dir (exit 3), and appends each argv as a JSON line to
 * FAKE_YTDLP_LOG when that is set.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "ytdlp");
const argv = process.argv.slice(2);
if (process.env.FAKE_YTDLP_LOG) fs.appendFileSync(process.env.FAKE_YTDLP_LOG, `${JSON.stringify(argv)}\n`);
if (argv.includes("--version")) {
  process.stdout.write("2099.01.01-fake\n");
  process.exit(0);
}
if (!argv.includes("--ignore-config") || !argv.includes("--no-cache-dir")) {
  process.stderr.write("ERROR: fake yt-dlp: every run needs --ignore-config and --no-cache-dir\n");
  process.exit(3);
}
const sep = argv.indexOf("--");
const targets = sep >= 0 ? argv.slice(sep + 1) : [];
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const lines = (file) => fs.readFileSync(path.join(DIR, file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const pages = [...lines("pages.jsonl"), JSON.parse(fs.readFileSync(path.join(DIR, "tiktok-page.json"), "utf8"))];
const pageOf = (url) => pages.find((p) => url.includes(p.id));
let failed = false;

if (argv.includes("--flat-playlist")) {
  const end = Number(opt("--playlist-end") ?? 1000);
  for (const t of targets) {
    const m = /^ytsearch(\d+):/.exec(t);
    const rows = m ? lines("search.jsonl").slice(0, Number(m[1])) : t.includes("/hashtag/") ? lines("shorts.jsonl") : [];
    for (const r of rows.slice(0, end)) process.stdout.write(`${JSON.stringify(r)}\n`);
  }
} else if (argv.includes("--skip-download")) {
  for (const url of targets) {
    const p = pageOf(url);
    if (p) process.stdout.write(`${JSON.stringify({ ...p, original_url: url })}\n`);
    else {
      process.stderr.write(`ERROR: [fake] ${url}: Video unavailable\n`);
      failed = true;
    }
  }
} else if (opt("--print") === "after_move:filepath") {
  const url = targets[0];
  const p = pageOf(url);
  const clip = process.env.FAKE_YTDLP_CLIP;
  if (!p || !clip || !fs.existsSync(clip)) {
    process.stderr.write(`ERROR: [fake] ${url}: ${p ? "no FAKE_YTDLP_CLIP to hand out" : "Video unavailable"}\n`);
    process.exit(1);
  }
  const template = opt("--output");
  const out = template.replace(/%\(ext\)s/g, "mp4").replace(/%%/g, "%");
  fs.copyFileSync(clip, out);
  fs.writeFileSync(out.replace(/\.mp4$/, ".info.json"), JSON.stringify({ ...p, original_url: url }));
  process.stdout.write(`${out}\n`);
} else {
  process.stderr.write("ERROR: fake yt-dlp: no recorded answer for this call\n");
  failed = true;
}
process.exit(failed ? 1 : 0);
