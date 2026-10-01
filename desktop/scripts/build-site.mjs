/**
 * --- desktop-exe --- Builds the site for the app: the same static export as GitHub Pages, but for the root of the app://
 * origin (NEXT_PUBLIC_BASE_PATH=""), with share links pointing at the public site. The export lands in ../out, which
 * electron-builder copies into the app's resources (extraResources "site").
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = {
  ...process.env,
  NEXT_PUBLIC_BASE_PATH: "",
  NEXT_PUBLIC_SITE_URL: process.env.DESKTOP_SITE_URL || "https://cronusaztec.github.io/Balls",
  NEXT_PUBLIC_GITHUB_REPO: process.env.NEXT_PUBLIC_GITHUB_REPO || "CronusAztec/Balls",
};
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["run", "build"], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
