/**
 * --- desktop-exe --- Builds the site for the app: the same static export as the website, but for the root of the app://
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
  NEXT_PUBLIC_SITE_URL: process.env.DESKTOP_SITE_URL || "https://jumpingballslive.com",
  // GitHub is not a channel of the app: the repository is private and has no public issues (the feedback form uses
  // NEXT_PUBLIC_FEEDBACK_ENDPOINT / NEXT_PUBLIC_FEEDBACK_EMAIL / NEXT_PUBLIC_SUPPORT_EMAIL, which desktop.yml passes).
  NEXT_PUBLIC_GITHUB_REPO: process.env.NEXT_PUBLIC_GITHUB_REPO || "",
};
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["run", "build"], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
