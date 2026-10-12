import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/*
 * --- desktop-autorelease --- "One push updates everything": the workflows deploy the website only from the product branch, the
 * billing Worker on billing/ changes (once BILLING_AUTODEPLOY is on) and the Windows app on a version bump. Text checks (no YAML
 * dependency) of the strings that decide what runs where.
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
    expect(deploy.split(BRANCHES).length - 1).toBe(5);
    expect(deploy).toContain(`  DEPLOY: \${{ ${BRANCHES} }}\n`);
    for (const job of ["smoke", "smoke-summary", "deploy", "deploy-cloudflare"]) expect(jobIf(jobSection(deploy, job)), job).toContain(BRANCHES);
    expect(jobIf(jobSection(deploy, "smoke-summary"))).toMatch(/^always\(\) && /);
    // a manual run from another branch no longer deploys it
    for (const m of deploy.matchAll(/\n\s+if: (.+)/g)) expect(m[1]).not.toContain("workflow_dispatch");
    expect(deploy).not.toContain("default_branch");
  });

  it("takes the site's address from the site-url action and writes out/CNAME for a custom domain", () => {
    expect(deploy).toContain("uses: ./.github/actions/site-url");
    expect(deploy).toContain("custom-domain: ${{ vars.CUSTOM_DOMAIN }}");
    expect(deploy).toContain("site-host: ${{ vars.SITE_HOST }}");
    expect(deploy).toContain("      - name: Work out the public URL and base path\n        id: site\n");
    expect(deploy).toContain("out/CNAME");
    expect(deploy).toContain("if: steps.site.outputs.domain != ''");
    expect(deploy).toContain("NEXT_PUBLIC_BASE_PATH: ${{ steps.site.outputs.base }}");
    expect(deploy).toContain("grep -E '^SITE_ORIGIN *=' billing/wrangler.toml");
  });

  it("publishes to GitHub Pages, or to Cloudflare Pages when SITE_HOST says so, and checks the site answers", () => {
    const pages = jobSection(deploy, "deploy");
    const cloudflare = jobSection(deploy, "deploy-cloudflare");
    expect(jobIf(pages)).toContain("vars.SITE_HOST != 'cloudflare-pages'");
    expect(jobIf(cloudflare)).toContain("vars.SITE_HOST == 'cloudflare-pages'");
    expect(cloudflare).toContain("needs: [build, smoke, smoke-summary]");
    expect(cloudflare).toContain("wrangler@3 pages deploy out");
    expect(cloudflare).toContain("name: site-out");
    expect(pages).toContain("- name: The site answers");
    expect(deploy).toContain("if: env.DEPLOY == 'true' && steps.site.outputs.host == 'github-pages'");
    expect(deploy).toContain("if: env.DEPLOY == 'true' && steps.site.outputs.host == 'cloudflare-pages'");
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

  it("never cancels a release build and writes only in the release job", () => {
    expect(desktop).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(/\npermissions:\n {2}contents: read\n/.test(desktop)).toBe(true);
    expect(desktop.split("contents: write").length - 1).toBe(1);
    expect(jobSection(desktop, "release")).toContain("contents: write");
  });

  it("bakes the site's real address into the app, honours DESKTOP_CUDA and checks what installed apps will read", () => {
    expect(desktop).toContain("uses: ./.github/actions/site-url");
    expect(desktop.split("DESKTOP_SITE_URL: ${{ steps.site.outputs.url }}").length - 1).toBe(2);
    expect(desktop).not.toContain("DESKTOP_SITE_URL: https://");
    expect(desktop).toContain("JBL_CUDA: ${{ (inputs.cuda || vars.DESKTOP_CUDA == '1') && '1' || '0' }}");
    expect(desktop).toContain("--generate-notes");
    expect(desktop).toContain("releases/latest/download/latest.yml");
    expect(desktop).toContain("retention-days: 14");
    expect(desktop).toContain("JumpingBallsLive-Setup.exe");
    expect(desktop).toContain("JumpingBallsLive-portable.exe");
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
  it("is a composite action with the four outputs", () => {
    const action = read(".github/actions/site-url/action.yml");
    expect(action).toContain("using: composite");
    for (const output of ["url", "base", "domain", "host"]) expect(action).toMatch(new RegExp(`\\n {2}${output}:\\n {4}description: `));
    expect(action).toContain("CUSTOM_DOMAIN");
    expect(action).toContain('gh api "repos/${GITHUB_REPOSITORY}/pages"');
  });

  it("has npm run release:desktop and docs/RELEASING.md that names it", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["release:desktop"]).toBe("node scripts/release/desktop-version.mjs");
    const doc = read("docs/RELEASING.md");
    expect(doc).toContain("npm run release:desktop");
    for (const heading of ["What updates when", "Ship a website change", "Release the Windows app", "Ship a Worker change", "Reading the Actions tab", "Roll back", "Your own domain", "Hosting", "Code signing (optional)", "Variables and secrets"]) {
      expect(doc, heading).toMatch(new RegExp(`\\n## ${heading.replace(/[()]/g, "\\$&")}\\n`));
    }
    expect(read("README.md")).toContain("docs/RELEASING.md");
  });
});
