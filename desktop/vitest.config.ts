import { defineConfig } from "vitest/config";
import path from "path";

// --- desktop-exe --- The desktop app's unit tests (node environment). `@/` resolves to the site's src/, whose pure desktop
// modules (the IPC contract, the render queue, the AI loop) the app shares with the page.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 20000 },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
