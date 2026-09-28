/**
 * Loads KEY=VALUE pairs from .env.local and .env into process.env (the files `next build`
 * reads), without overriding variables already set in the shell. Used by the static server
 * and the browser scripts so they see the same NEXT_PUBLIC_BASE_PATH as the build.
 */
import fs from "fs";
import path from "path";

export function loadDotEnv(cwd = process.cwd()) {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
