import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts", "relay/**/*.test.mjs" /* --- social-publish --- the self-hosted relay */] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
