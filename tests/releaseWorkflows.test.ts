import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { deployGuard } from "../scripts/go-live-check.mjs";

/*
 * --- desktop-autorelease --- "One push updates everything": the workflows deploy the website only from the product branch, the
 * billing Worker on billing/ changes (once BILLING_AUTODEPLOY is on) and the Windows app on a version bump. Text checks (no YAML
 * dependency) of the strings that decide what runs where. The repository is private and only keeps the code: the website goes to
 * Cloudflare (a Worker serving jumpingballslive.com), the Windows app's downloads and updates to a public, releases-only GitHub repository.
 */

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const BRANCHES = `contains(fromJSON('["refs/heads/claude/optimistic-johnson-46x3qg","refs/heads/main"]'), github.ref)`;

/** The lines of one job of a workflow, from `  <job>:` to the next job. */
function jobSection(workflow: string, name: string): string {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  expect(start, name).toBeGreaterThan(-1);
  let end = start + 1;
  while (end < lines.length && !/^ {2}[\w-]+:\s*$/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n");
}

/** The job-level `if:` of a job. */
const jobIf = (section: string) => /\n {4}if: (.+)\n/.exec(section)?.[1] ?? "";

describe("deploy.yml: the website", () => {
  const deploy = read(".github/workflows/deploy.yml");

  it("deploys only from the product branch (claude/optimistic-johnson-46x3qg or main), pushed or run by hand", () => {
    expect(deploy.split(BRANCHES).length - 1).toBe(4);
    expect(deploy).toContain(`  DEPLOY: \${{ ${BRANCHES} }}\n`);
    for (const job of ["smoke", "smoke-summary", "deploy"]) expect(jobIf(jobSection(deploy, job)), job).toContain(BRANCHES);
    expect(jobIf(jobSection(deploy, "smoke-summary"))).toMatch(/^always\(\) && /);
    // a manual run from another branch no longer deploys it
    for (const m of deploy.matchAll(/\n\s+if: (.+)/g)) expect(m[1]).not.toContain("workflow_dispatch");
    expect(deploy).not.toContain("default_branch");
  });

  it("keeps every artifact for a day and never lets a full Actions storage quota fail a job (the VPS deployer reads the build job)", () => {
    // A private repository has a small artifact quota. When it was full, the last step of `build` (the site upload) failed and the
    // VPS deployer saw a red build for a commit whose lint, types, tests and build had all passed.
    for (const file of [".github/workflows/deploy.yml", ".github/workflows/smoke.yml"]) {
      const steps = read(file).split("\n      - name: ").slice(1).filter((s) => s.includes("actions/upload-artifact@"));
      expect(steps.length, file).toBeGreaterThan(0);
      for (const step of steps) {
        const name = step.split("\n")[0];
        expect(step, `${file}: ${name}`).toContain("        continue-on-error: true\n");
        expect(step, `${file}: ${name}`).toContain("          retention-days: 1\n");
      }
    }
  });

  it("lints and type-checks every push, and runs the unit tests, the build and the upload only where it deploys", () => {
    const build = jobSection(deploy, "build");
    // a private repository has 2,000 free Actions minutes a month: a feature branch costs the lint and the type check only
    expect(build).toContain("      - name: Lint\n        run: npm run lint\n");
    expect(build).toContain("      - name: Type-check\n        run: npm run typecheck\n");
    for (const step of ["Unit tests", "Production guard (billing)", "Cache the Next.js build", "Build static site", "Stamp the build", "Upload the site"]) {
      expect(build, step).toMatch(new RegExp(`      - name: ${step.replace(/[()]/g, "\\$&")}\\n        if: env\\.DEPLOY == 'true'\\n`));
    }
    // the unit tests run through the wrapper that ignores vitest's own worker-reporting timeout (scripts/test-ci.mjs)
    expect(build).toContain("        if: env.DEPLOY == 'true'\n        run: npm run test:ci\n");
  });

  it("takes the site's address from the site-url action (CUSTOM_DOMAIN, else jumpingballslive.com)", () => {
    expect(deploy).toContain("uses: ./.github/actions/site-url");
    expect(deploy).toContain("custom-domain: ${{ vars.CUSTOM_DOMAIN }}");
    expect(deploy).not.toContain("site-host:");
    expect(deploy).toContain("      - name: Work out the public URL and base path\n        id: site\n");
    expect(deploy).toContain("NEXT_PUBLIC_BASE_PATH: ${{ steps.site.outputs.base }}");
    expect(deploy).toContain("grep -E '^SITE_ORIGIN *=' billing/wrangler.toml");
    // the feedback form's GitHub channel only for a public repository with issues
    expect(deploy).toContain("NEXT_PUBLIC_GITHUB_REPO: ${{ (github.event.repository.private == false && github.event.repository.has_issues == true) && github.repository || '' }}");
  });

  it("publishes to the jumpingballslive Cloudflare Worker – never to GitHub Pages – and asks the live site for the build", () => {
    const job = jobSection(deploy, "deploy");
    expect(job).toContain("needs: [build, smoke, smoke-summary]");
    expect(job).toContain("name: site-out");
    const order = ["- name: Check the Cloudflare secrets", "- name: Download the site", "- name: Install Wrangler", "- name: Deploy to Cloudflare", "- name: The new build answers", "- name: The downloads repository answers"].map((n) => job.indexOf(n));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(job).toContain("run: npm ci --prefix billing");
    expect(job).toContain("run: npx --prefix billing wrangler deploy");
    expect(job).toContain("$URL/build.txt");
    expect(deploy).toContain('run: printf \'%s\\n\' "$GITHUB_SHA" > out/build.txt');
    expect(deploy).not.toMatch(/pages-artifact|deploy-pages|configure-pages|cloudflare-pages|wrangler@3 pages|out\/CNAME/);
    // the Worker is the one wrangler.toml names, with the domain and www attached
    const wrangler = read("wrangler.toml");
    expect(wrangler).toMatch(/^name = "jumpingballslive"$/m);
    expect(wrangler).toContain('{ pattern = "jumpingballslive.com", custom_domain = true }');
    expect(wrangler).toContain('{ pattern = "www.jumpingballslive.com", custom_domain = true }');
    expect(wrangler).toContain('directory = "./out"');
    expect(fs.existsSync(path.join(ROOT, ".github/workflows/cloudflare-deploy.yml"))).toBe(false);
  });
});

// --- ai-guard --- the desktop app's and the billing Worker's checks in the build job, and the type-check knob
/** The steps of a job, in order: each from its `      - name:` line to the next. */
const stepsOf = (section: string) => section.split("\n      - name: ").slice(1).map((s) => `      - name: ${s}`);
/** The jobs a job needs (`needs: build` or `needs: [build, smoke]`). */
const needsOf = (section: string) => (/\n {4}needs: \[?([^\]\n]+)\]?\n/.exec(section)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
/** Whether a step sets the knob (an env entry or an assignment in its script; a comment that names it does not count). */
const setsKnob = (step: string) => step.split("\n").some((l) => !/^\s*#/.test(l) && /JBL_BUILD_SKIP_TYPECHECK\s*[:=]/.test(l));
/** A step that runs `npm run typecheck` on every run of its job (no `if:` of its own). */
const typeChecks = (step: string) => /\n {8}run: npm run typecheck\n/.test(`${step}\n`) && !/\n {8}if: /.test(step);

describe("deploy.yml: the desktop app and the billing Worker in the build job", () => {
  const build = jobSection(read(".github/workflows/deploy.yml"), "build");

  it("installs both without Electron's binary, then type-checks and tests each, where it deploys, before the site is built", () => {
    const steps = stepsOf(build);
    const at = (name: string) => steps.findIndex((s) => s.startsWith(`      - name: ${name}\n`));
    const install = steps[at("Install the desktop app's and the billing Worker's dependencies")];
    const desktop = steps[at("Desktop app type check and tests")];
    const billing = steps[at("Billing Worker type check and tests")];
    for (const step of [install, desktop, billing]) expect(step).toContain("        if: env.DEPLOY == 'true'\n");
    expect(install).toContain('          ELECTRON_SKIP_BINARY_DOWNLOAD: "1"\n');
    expect(install).toContain("          npm ci --prefix desktop\n          npm ci --prefix billing\n");
    expect(desktop).toContain("        working-directory: desktop\n        run: |\n          npm run typecheck\n          npm test\n");
    expect(billing).toContain("        working-directory: billing\n        run: |\n          npm run check\n          npm test\n");
    const order = ["Unit tests", "Install the desktop app's and the billing Worker's dependencies", "Desktop app type check and tests", "Billing Worker type check and tests", "Build static site"].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // the scripts they call exist
    expect(JSON.parse(read("desktop/package.json")).scripts).toMatchObject({ typecheck: expect.any(String), test: "vitest run" });
    expect(JSON.parse(read("billing/package.json")).scripts).toMatchObject({ check: "tsc --noEmit", test: "vitest run" });
  });
});

describe("deploy.yml: the core guard and the browser checks in the build job (--- ai-guard ---)", () => {
  const build = jobSection(read(".github/workflows/deploy.yml"), "build");
  const steps = stepsOf(build);
  const at = (name: string) => steps.findIndex((s) => s.startsWith(`      - name: ${name}\n`));

  it("runs the guard's static checks on every push against the commit before it, with the whole history, never as a gate", () => {
    expect(steps[at("Check out")]).toContain("        with:\n          fetch-depth: 0\n");
    const guard = steps[at("Core guard (static checks)")];
    expect(guard, "the guard step").toBeDefined();
    expect(guard).not.toMatch(/\n {8}if: /); // every branch: about a second
    expect(guard).toContain("        continue-on-error: true\n"); // annotations, not a gate (the owner's call)
    expect(guard).toContain("          BEFORE: ${{ github.event.before }}\n");
    expect(guard).toContain('node scripts/agent/guard.mjs --plan --base "$BEFORE"');
    expect(guard).toContain('[ -n "${BEFORE//0/}" ]'); // a new branch's all-zero "before": the guard's own default base
    expect(guard).toContain("          else\n            node scripts/agent/guard.mjs --plan\n");
    // after the install (the guard bundles its plan with esbuild), before anything that can fail the job first
    expect(at("Install dependencies")).toBeLessThan(at("Core guard (static checks)"));
    expect(at("Core guard (static checks)")).toBeLessThan(at("Lint"));
  });

  it("gives the unit tests Chromium and JBL_REQUIRE_BROWSER=1, so the rendered checks fail rather than skip", () => {
    const unit = steps[at("Unit tests")];
    expect(unit).toContain('        env:\n          JBL_REQUIRE_BROWSER: "1"\n');
    for (const name of ["Read the Playwright version", "Cache Playwright's Chromium", "Install Chromium for Playwright", "Install Chromium's system libraries"]) {
      expect(at(name), name).toBeGreaterThan(-1);
      expect(at(name), name).toBeLessThan(at("Unit tests"));
      expect(steps[at(name)], name).toMatch(/\n {8}if: env\.DEPLOY == 'true'/);
    }
    // the smoke job's own cache key and install, so both jobs share one cached Chromium
    const smoke = jobSection(read(".github/workflows/deploy.yml"), "smoke");
    expect(steps[at("Cache Playwright's Chromium")]).toContain("          key: ${{ runner.os }}-playwright-${{ steps.playwright.outputs.version }}\n");
    expect(smoke).toContain("          key: ${{ runner.os }}-playwright-${{ steps.playwright.outputs.version }}\n");
    expect(steps[at("Install Chromium for Playwright")]).toContain("run: npx playwright install --with-deps chromium\n");
    // the two tests that launch Chromium honour the variable
    for (const file of ["tests/masterBus.test.ts", "tests/fightLeagueSound.test.ts"]) expect(read(file), file).toContain('process.env.JBL_REQUIRE_BROWSER === "1"');
  });
});

describe("the type-check knob (JBL_BUILD_SKIP_TYPECHECK, next.config.ts)", () => {
  it("is Next's ignoreBuildErrors only when the variable is exactly 1, and no npm script sets it", () => {
    expect(read("next.config.ts")).toContain('typescript: { ignoreBuildErrors: process.env.JBL_BUILD_SKIP_TYPECHECK === "1" },');
    for (const [name, script] of Object.entries((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts)) expect(script, name).not.toContain("JBL_BUILD_SKIP_TYPECHECK");
  });

  it("is set only by a step that comes after an `npm run typecheck` step of its job, or of a job it needs", () => {
    let setters = 0;
    for (const file of fs.readdirSync(path.join(ROOT, ".github/workflows")).map((f) => `.github/workflows/${f}`)) {
      const workflow = read(file);
      const jobs = [...workflow.matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]).filter((name) => workflow.indexOf(`\n  ${name}:`) > workflow.indexOf("\njobs:"));
      for (const job of jobs) {
        const steps = stepsOf(jobSection(workflow, job));
        steps.forEach((step, i) => {
          if (!setsKnob(step)) return;
          setters++;
          const before = steps.slice(0, i).some(typeChecks);
          const needed = needsOf(jobSection(workflow, job)).some((need) => jobs.includes(need) && stepsOf(jobSection(workflow, need)).some(typeChecks));
          expect(before || needed, `${file} ${job}: ${step.split("\n")[0].trim()} skips Next's type check with no type check before it`).toBe(true);
        });
      }
    }
    // the build job's site build and the smoke shards' builds (the smoke job needs build)
    expect(setters).toBe(2);
    expect(stepsOf(jobSection(read(".github/workflows/deploy.yml"), "build")).find((s) => s.startsWith("      - name: Build static site\n"))).toContain('          JBL_BUILD_SKIP_TYPECHECK: "1"\n');
    expect(needsOf(jobSection(read(".github/workflows/deploy.yml"), "smoke"))).toEqual(["build"]);
  });

  it("is never set by the VPS deployer: its build type-checks as before", () => {
    expect(read("deploy/vps/jbl-deploy.sh")).not.toContain("JBL_BUILD_SKIP_TYPECHECK");
  });

  it("fails a step that sets it without a type check before it (the rule above on a synthetic workflow)", () => {
    const workflow = "jobs:\n  a:\n    runs-on: x\n    steps:\n      - name: Build\n        run: npx next build\n        env:\n          JBL_BUILD_SKIP_TYPECHECK: \"1\"\n      - name: Type-check\n        run: npm run typecheck\n";
    const steps = stepsOf(jobSection(workflow, "a"));
    expect(setsKnob(steps[0])).toBe(true);
    expect(setsKnob("      - name: Build\n        # JBL_BUILD_SKIP_TYPECHECK: named in a comment\n        run: npx next build")).toBe(false);
    expect(setsKnob("      - name: Build\n        run: JBL_BUILD_SKIP_TYPECHECK=1 npx next build")).toBe(true);
    expect(steps.slice(0, 0).some(typeChecks)).toBe(false);
    expect(steps.slice(0, 2).some(typeChecks)).toBe(true);
    expect(typeChecks("      - name: Type-check\n        if: env.DEPLOY == 'true'\n        run: npm run typecheck")).toBe(false);
  });
});

describe("the live billing values both workflows build in", () => {
  const key = (text: string) => /\n {2}LICENSE_PUBLIC_KEY: \$\{\{ vars\.LICENSE_PUBLIC_KEY \|\| '([^']+)' \}\}\n/.exec(text)?.[1] ?? "";
  const url = (text: string) => /\n {2}BILLING_API_URL: \$\{\{ vars\.BILLING_API_URL \|\| '([^']+)' \}\}\n/.exec(text)?.[1] ?? "";
  const deploy = read(".github/workflows/deploy.yml");
  const desktop = read(".github/workflows/desktop.yml");

  it("are the same pair in the website's workflow and the app's, and the deploy guard accepts it", () => {
    expect(key(deploy)).not.toBe("");
    expect(url(deploy)).toMatch(/^https:\/\/jumpingballslive-billing\./);
    expect(key(desktop)).toBe(key(deploy));
    expect(url(desktop)).toBe(url(deploy));
    expect(deployGuard({ LICENSE_PUBLIC_KEY: key(deploy), BILLING_API_URL: url(deploy) }).ok).toBe(true);
    // both builds read the pair from env, so a repository variable replaces it in one place
    expect(deploy).toContain("NEXT_PUBLIC_LICENSE_PUBLIC_KEY: ${{ env.LICENSE_PUBLIC_KEY }}");
    expect(desktop).toContain("NEXT_PUBLIC_BILLING_API: ${{ env.BILLING_API_URL }}");
  });

  it("make the production guard check the pair the build uses, and the Worker allow the site's origins", () => {
    expect(deploy).toContain("      - name: Production guard (billing)\n        if: env.DEPLOY == 'true'\n        run: node scripts/go-live-check.mjs --deploy-guard\n");
    const wrangler = read("billing/wrangler.toml");
    const origins = /^SITE_ORIGIN\s*=\s*"([^"]*)"/m.exec(wrangler)?.[1].split(/[\s,]+/) ?? [];
    expect(origins).toEqual(["https://jumpingballslive.com", "https://www.jumpingballslive.com"]);
  });
});

describe("desktop.yml: the Windows app", () => {
  const desktop = read(".github/workflows/desktop.yml");

  it("releases on a version bump pushed to the product branch, a desktop-v tag or a manual publish", () => {
    const push = /\non:\n {2}push:\n((?: {4}.+\n)+)/.exec(desktop)?.[1] ?? "";
    expect(push).toContain('    tags: ["desktop-v*"]\n');
    expect(push).toContain('    branches: ["claude/optimistic-johnson-46x3qg", "main"]\n');
    expect(push).toContain('    paths: ["desktop/package.json"]\n');
    expect(desktop).toContain("fetch-depth: 2");
    expect(desktop).toContain("run: node scripts/release/desktop-version.mjs --decide");
    expect(jobIf(jobSection(desktop, "build"))).toBe("needs.decide.outputs.build == 'true'");
    expect(jobIf(jobSection(desktop, "release"))).toBe("needs.decide.outputs.release == 'true'");
  });

  it("names its job 'Windows build': the VPS deployer takes a green check run called 'build' as its go-ahead, and that must be the website's alone", () => {
    expect(jobSection(read(".github/workflows/desktop.yml"), "build")).toMatch(/\n {4}name: Windows build\n/);
    // the check run of a job without a name is called after its id: deploy.yml's job id is "build" and it must keep no name of its own
    expect(jobSection(read(".github/workflows/deploy.yml"), "build")).not.toMatch(/\n {4}name:/);
    expect(read("deploy/vps/jbl-deploy.sh")).toContain('r.name === "build"');
  });

  it("never cancels a release build and writes only in the release job", () => {
    expect(desktop).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(/\npermissions:\n {2}contents: read\n/.test(desktop)).toBe(true);
    expect(desktop.split("contents: write").length - 1).toBe(1);
    expect(jobSection(desktop, "release")).toContain("contents: write");
  });

  it("bakes the site's real address into the app and honours DESKTOP_CUDA", () => {
    expect(desktop).toContain("uses: ./.github/actions/site-url");
    expect(desktop.split("DESKTOP_SITE_URL: ${{ steps.site.outputs.url }}").length - 1).toBe(2);
    expect(desktop).not.toContain("DESKTOP_SITE_URL: https://");
    expect(desktop).toContain("JBL_CUDA: ${{ (inputs.cuda || vars.DESKTOP_CUDA == '1') && '1' || '0' }}");
    expect(desktop).toContain("retention-days: 14");
    expect(desktop).toContain("JumpingBallsLive-Setup.exe");
    expect(desktop).toContain("JumpingBallsLive-portable.exe");
    // nothing the app is built from needs GitHub: no Pages lookup, no GitHub issues as the feedback channel
    expect(desktop).not.toContain("pages: read");
    expect(desktop).not.toContain("NEXT_PUBLIC_GITHUB_REPO");
    expect(desktop).toContain("NEXT_PUBLIC_PUBLISH_RELAY_URL: ${{ vars.PUBLISH_RELAY_URL || 'https://relay.jumpingballslive.com' }}");
  });

  it("publishes to the downloads repository first, checks it, and only then archives the release on GitHub", () => {
    const release = jobSection(desktop, "release");
    const order = [
      "- name: Check the downloads repository token",
      "- name: Download the EXEs",
      "- name: Publish to the downloads repository",
      "- name: The downloads repository serves it",
      "- name: Publish the GitHub Release",
    ].map((n) => release.indexOf(n));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(release).toContain('run: node scripts/release/publish-downloads.mjs --dir dist --version "$VERSION" --repo "$DOWNLOADS_REPO"');
    expect(release).toContain('run: node scripts/release/publish-downloads.mjs --verify --dir dist --version "$VERSION" --url "$DOWNLOADS_URL"');
    expect(desktop).toContain("DOWNLOADS_REPO: ${{ vars.DOWNLOADS_REPO || 'CronusAztec/jumpingballslive-windows' }}");
    expect(desktop).toContain("GH_TOKEN: ${{ secrets.DOWNLOADS_REPO_TOKEN }}");
    expect(release).not.toMatch(/wrangler|CLOUDFLARE|R2_BUCKET/i);
    // the installed apps' update feed is the downloads repository (electron-builder writes it into app-update.yml)
    expect(desktop).toContain("JBL_UPDATE_URL: ${{ env.DOWNLOADS_URL }}");
    // the GitHub release stays as the archive; while the repository is public it is also what apps older than 1.1.0 read
    expect(release).toContain("--generate-notes");
    expect(release).toContain("- name: Apps older than 1.1.0 see the release (public repository)\n        if: github.event.repository.private == false\n");
    expect(release).toContain("releases/latest/download/latest.yml");
  });

  it("runs the smoke's two AI jobs only on a runner with enough processors, and smoke-runs the packaged app on every runner", () => {
    // --- smoke-ai-budget --- on GitHub's 2-core runners (a private repository) llama.cpp gets one math core and the first AI
    // job produced nothing in 20 minutes, so no release went out; the smoke without the two jobs is what every runner can do
    const build = jobSection(desktop, "build");
    expect(build).toMatch(/- name: AI jobs in the smoke\?\n {8}id: smoke-ai\n/);
    expect(build).toContain('JBL_SMOKE_AI_MIN_CPUS: "4"');
    expect(build).toContain('echo "ai=true" >> "$GITHUB_OUTPUT"');
    expect(build).toContain('echo "ai=false" >> "$GITHUB_OUTPUT"');
    expect(build).toContain("- name: Smoke model (cache)\n        id: smoke-model\n        if: steps.smoke-ai.outputs.ai == 'true'\n");
    expect(build).toContain("if: steps.smoke-ai.outputs.ai == 'true' && steps.smoke-model.outputs.cache-hit != 'true'\n");
    expect(build).toContain("JBL_SMOKE_MODEL: ${{ steps.smoke-ai.outputs.ai == 'true' && format('{0}\\.cache\\smoke-model\\qwen2.5-1.5b-instruct-q4_k_m.gguf', github.workspace) || '' }}");
    // the smoke itself has no condition: it runs on every runner
    const smoke = /- name: Smoke-run the packaged app\n((?: {8}.+\n)+)/.exec(build)?.[1] ?? "";
    expect(smoke).not.toContain("\n        if:");
    expect(smoke).toContain('grep -q "SMOKE OK" smoke.log');
  });
});

describe("billing-deploy.yml: the payment Worker", () => {
  const billing = read(".github/workflows/billing-deploy.yml");

  it("deploys by hand, and on product-branch pushes that change billing/ once BILLING_AUTODEPLOY is 1", () => {
    expect(billing).toContain("  workflow_dispatch:\n");
    expect(billing).toContain('    branches: ["claude/optimistic-johnson-46x3qg", "main"]\n');
    expect(billing).toContain('    paths: ["billing/**", ".github/workflows/billing-deploy.yml"]\n');
    expect(jobIf(jobSection(billing, "deploy"))).toBe("github.event_name == 'workflow_dispatch' || vars.BILLING_AUTODEPLOY == '1'");
    expect(billing).toContain("cancel-in-progress: false");
  });

  it("checks the secrets, the KV id and the custom domain first, and the live Worker afterwards", () => {
    const guard = billing.indexOf("- name: Check the secrets and wrangler.toml");
    const deploy = billing.indexOf("- name: Deploy with Wrangler");
    const health = billing.indexOf("- name: Health check");
    expect(guard).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(guard);
    expect(health).toBeGreaterThan(deploy);
    expect(billing).toContain('grep -q "REPLACE_WITH_YOUR_KV_NAMESPACE_ID" wrangler.toml');
    expect(billing).toContain("SITE_ORIGIN");
    expect(billing).toContain("for path in /health /config; do");
    expect(billing).toContain("cloudflare/wrangler-action@v3");
  });
});

describe("the site-url action, the release helper and the docs", () => {
  it("is a composite action with the three outputs, jumpingballslive.com unless CUSTOM_DOMAIN says otherwise, and no GitHub Pages", () => {
    const action = read(".github/actions/site-url/action.yml");
    expect(action).toContain("using: composite");
    for (const output of ["url", "base", "domain"]) expect(action).toMatch(new RegExp(`\\n {2}${output}:\\n {4}description: `));
    expect(action).toContain("CUSTOM_DOMAIN");
    expect(action).toContain('domain="jumpingballslive.com"');
    // no lookup of GitHub's Pages settings and no <owner>.github.io fallback: the site is on Cloudflare
    expect(action).not.toContain("gh api");
    expect(action).not.toContain("github.io");
    expect(action).not.toContain("GH_TOKEN");
  });

  it("has npm run release:desktop and docs/RELEASING.md that names it", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["release:desktop"]).toBe("node scripts/release/desktop-version.mjs");
    const doc = read("docs/RELEASING.md");
    expect(doc).toContain("npm run release:desktop");
    for (const heading of ["What updates when", "Ship a website change", "Release the Windows app", "Ship a Worker change", "Reading the Actions tab", "Roll back", "Your own domain", "Hosting", "The downloads repository", "Making the repository private", "Code signing (optional)", "Variables and secrets"]) {
      expect(doc, heading).toMatch(new RegExp(`\\n## ${heading.replace(/[()]/g, "\\$&")}\\n`));
    }
    expect(read("README.md")).toContain("docs/RELEASING.md");
  });
});
