/**
 * Loads the project's .env files into process.env exactly the way `next build` does, with Next's own loader (@next/env, which
 * ships with next): .env.production.local, .env.local, .env.production and .env, inline comments and `export` prefixes
 * handled, variables already set in the shell never overridden. Used by the static server and the browser scripts so they see
 * the same NEXT_PUBLIC_BASE_PATH as the build (--- review fix (site-static) --- a hand-rolled parser kept inline comments, so
 * `NEXT_PUBLIC_BASE_PATH=/Balls # sub-folder` built for /Balls and served "/Balls # sub-folder").
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);

export function loadDotEnv(cwd = process.cwd()) {
  // Resolved from next's own location: @next/env is next's dependency, not the project's.
  const { loadEnvConfig } = require(require.resolve("@next/env", { paths: [require.resolve("next/package.json")] }));
  loadEnvConfig(cwd, false, { info() {}, error: console.error });
  // The loader marks the environment as processed; a `next` started from a script must still read the files itself.
  delete process.env.__NEXT_PROCESSED_ENV;
}
