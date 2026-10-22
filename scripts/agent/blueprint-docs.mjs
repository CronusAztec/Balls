#!/usr/bin/env node
/**
 * --- blueprint --- Writes docs/agents/BLUEPRINTS.md from the code (src/lib/blueprint/docs.ts renderBlueprintDocs: the
 * vocabulary, the ceilings, the Lite form and the catalog with each entry's check), or with --check says whether the committed
 * file is current (exit 1 when it is not). `npm run blueprints:docs` runs it; tests/blueprintDocs.test.ts fails while the file
 * is stale. The guide is the only file it writes.
 */
import fs from "fs";
import path from "path";
import { loadBlueprintKit } from "./bundle.mjs";
import { ROOT, isMainModule } from "./paths.mjs";

async function main() {
  const check = process.argv.includes("--check");
  const bk = await loadBlueprintKit();
  const file = path.join(ROOT, bk.BLUEPRINT_DOCS_FILE);
  const markdown = bk.renderBlueprintDocs();
  let current = null;
  try {
    current = fs.readFileSync(file, "utf8");
  } catch {
    current = null;
  }
  if (check) {
    const ok = current === markdown;
    process.stdout.write(ok ? `${bk.BLUEPRINT_DOCS_FILE} is current\n` : `${bk.BLUEPRINT_DOCS_FILE} is stale: run npm run blueprints:docs\n`);
    process.exit(ok ? 0 : 1);
  }
  if (current === markdown) {
    process.stdout.write(`${bk.BLUEPRINT_DOCS_FILE} is current\n`);
    return;
  }
  fs.writeFileSync(file, markdown);
  process.stdout.write(`wrote ${bk.BLUEPRINT_DOCS_FILE} (${markdown.length} characters)\n`);
}

if (isMainModule(import.meta.url)) await main();
