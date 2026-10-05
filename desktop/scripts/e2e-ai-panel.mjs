/**
 * --- desktop-ai-fix --- An end-to-end run of the packed app's AI panel with Playwright's Electron driver (the site's
 * playwright): the app starts on its own data folder, the AI tab opens, the AI status panel renders its five rows, Run checks
 * completes, Copy report puts JSON (without any key) on the clipboard – and, with JBL_SMOKE_MODEL (a GGUF file), that model is
 * selected, a Captions job runs on it and its result is checked (one item, 3–15 hashtags that start with "#").
 *
 *   npm run pack                                                  # release/linux-unpacked (or win-unpacked on Windows)
 *   JBL_SMOKE_MODEL=/path/qwen2.5-1.5b-instruct-q4_k_m.gguf node scripts/e2e-ai-panel.mjs [path to the app's executable]
 *
 * On Linux it needs a display (xvfb-run -a). E2E_OUT (default: a temporary folder) receives a screenshot and the app's main.log.
 */
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const require = createRequire(path.join(root, "package.json"));
const { _electron: electron } = require("playwright");

const exe =
  process.argv[2] ||
  [path.join(here, "..", "release", "linux-unpacked", "jumpingballslive-desktop"), path.join(here, "..", "release", "win-unpacked", "JumpingBallsLive.exe")].find((p) => fs.existsSync(p));
if (!exe) {
  console.error("No packed app: run `npm run pack` in desktop/ first, or pass the executable's path.");
  process.exit(2);
}
const out = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), "jbl-e2e-"));
fs.mkdirSync(out, { recursive: true });
// PORTABLE_EXECUTABLE_DIR gives the app a data folder of its own (<dir>/JumpingBallsLive-data), as the portable EXE does.
const portable = fs.mkdtempSync(path.join(out, "portable-"));
const data = path.join(portable, "JumpingBallsLive-data");
const model = process.env.JBL_SMOKE_MODEL ? path.resolve(process.env.JBL_SMOKE_MODEL) : null;
if (model) {
  // The model as a picked GGUF file ("Use my own GGUF file…"), selected, on the GPU when one works.
  fs.mkdirSync(path.join(data, "models"), { recursive: true });
  const id = `custom:${path.basename(model)}`;
  fs.writeFileSync(path.join(data, "models", "custom-models.json"), JSON.stringify([{ id, name: path.basename(model), path: model, size: fs.statSync(model).size }]));
  fs.writeFileSync(path.join(data, "config.json"), JSON.stringify({ prefs: { aiProvider: "local", localModel: id, aiGpu: process.env.JBL_SMOKE_AI_GPU === "off" ? "off" : "auto" } }));
}

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name} ${extra}`);
};

const app = await electron.launch({ executablePath: exe, args: process.platform === "linux" ? ["--no-sandbox"] : [], env: { ...process.env, PORTABLE_EXECUTABLE_DIR: portable, JBL_VERBOSE: "1" }, timeout: 120000 });
let exitCode = 1;
try {
  const page = await app.firstWindow({ timeout: 120000 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("[data-desktop-group]").waitFor({ timeout: 120000 });
  await page.getByTestId("desktop-tab-ai").click();
  await page.locator('[data-testid="ai-checks"] [data-ai-check]').first().waitFor({ timeout: 30000 });
  const quick = await page.locator("[data-ai-check]").evaluateAll((els) => els.map((el) => `${el.getAttribute("data-ai-check")}:${el.getAttribute("data-level")}`));
  check("the AI status panel shows its five rows when the tab opens", quick.length === 5 && quick.map((r) => r.split(":")[0]).join(",") === "runtime,model,provider,network,lastError", `(${quick.join(", ")})`);

  const t0 = Date.now();
  await page.getByTestId("ai-run-checks").click();
  const deep = await page.locator('[data-testid="ai-checks"][data-deep="1"]').waitFor({ timeout: 600000 }).then(() => true).catch(() => false);
  const rows = await page.locator("[data-ai-check]").evaluateAll((els) => els.map((el) => `${el.getAttribute("data-ai-check")}:${el.getAttribute("data-level")} – ${el.querySelector("[data-testid^='ai-check-']")?.textContent ?? ""}`));
  check("Run checks completes every row", deep && rows.length === 5, `(${Math.round((Date.now() - t0) / 1000)} s)\n   ${rows.join("\n   ")}`);
  if (model) check("Run checks loads the selected model and answers its 8-token test", rows[1]?.startsWith("model:ok") || rows[1]?.startsWith("model:warn"), `(${rows[1] ?? "no model row"})`);

  await page.getByTestId("ai-copy-report").click();
  await page.getByTestId("ai-report-copied").waitFor({ timeout: 10000 }).catch(() => {});
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  let report = null;
  try {
    report = JSON.parse(clip);
  } catch {
    report = null;
  }
  check("Copy report puts the JSON report on the clipboard", !!report && report.report === "JumpingBallsLive AI status" && Array.isArray(report.checks) && report.checks.length === 5 && Array.isArray(report.logTail), `(${clip.length} characters)`);
  check("the report holds no API key", !/sk-[A-Za-z0-9_-]{8,}/.test(clip));

  if (model) {
    await page.getByTestId("ai-task-copy").click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="ai-run"]')?.disabled, null, { timeout: 30000 });
    const t1 = Date.now();
    await page.getByTestId("ai-run").click();
    const progress = await page.getByTestId("ai-progress").innerText({ timeout: 30000 }).catch(() => "");
    const done = await Promise.race([
      page.getByTestId("ai-copy-result").waitFor({ timeout: 900000 }).then(() => "result"),
      page.getByTestId("ai-error").waitFor({ timeout: 900000 }).then(() => "error"),
    ]).catch(() => "timeout");
    const text = done === "result" ? await page.getByTestId("ai-copy-result").innerText() : await page.getByTestId("ai-error").innerText().catch(() => done);
    const hashtags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
    const log = await page.getByTestId("ai-log").innerText().catch(() => "");
    check("Captions on the local model gives a valid result", done === "result" && hashtags.length >= 3 && hashtags.length <= 15, `(${Math.round((Date.now() - t1) / 1000)} s, progress "${progress}", ${hashtags.length} hashtags)\n   ${text.replace(/\s+/g, " ").slice(0, 300)}\n   log: ${log.replace(/\n/g, " | ")}`);
  }
  await page.screenshot({ path: path.join(out, "ai-panel.png"), fullPage: false });
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  exitCode = results.every((r) => r.ok) ? 0 : 1;
} catch (err) {
  console.error(err);
} finally {
  await app.close().catch(() => {});
  const log = path.join(data, "logs", "main.log");
  if (fs.existsSync(log)) fs.copyFileSync(log, path.join(out, "main.log"));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed – screenshot and main.log in ${out}`);
}
process.exit(exitCode);
