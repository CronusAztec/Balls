import { defineConfig } from "vitest/config";

// The Worker runs on WebCrypto and the Fetch API, both of which Node 20+ provides as globals, so the
// suite runs in the plain node environment and exercises the very same source the Worker ships.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  // The suite signs with the shared test key pair in ../tests/fixtures (one level up, in the site
  // repo). Allow Vite to read it.
  server: { fs: { allow: [".."] } },
});
