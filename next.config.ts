import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { nextEnv, resolveBuildInfo } from "./scripts/lib/build-info.cjs"; // --- build-identity ---

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * The site is a fully static export (`out/`), so it can be hosted on GitHub Pages or any
 * static file host. NEXT_PUBLIC_BASE_PATH is the sub-folder the site is served from
 * (e.g. "/Balls" for https://<user>.github.io/Balls); leave it empty for a root deployment.
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "export",
  // --- build-identity --- the release version, commit and commit date of THIS build, inlined as NEXT_PUBLIC_BUILD_* (src/lib/buildInfo.ts
  // reads them: the footer's stamp, the jbl-build meta tag, the Windows app's "Website build" row). Collected here because every build
  // path runs this file (npx next build on the VPS and in Actions, npm run build in the Windows job). Deliberately NOT done: generateBuildId.
  // Next re-rolls its own random build id until it contains no "ad" (ad blockers would match the /_next/static/<id>/ URLs), but never
  // re-rolls an id we supply, and a 12-character commit hash contains "ad" in about 4 cases in 100: on a site about to run ads that could get files blocked.
  env: nextEnv(resolveBuildInfo()),
  // Every page becomes <route>/index.html so static hosts resolve links without rewrites.
  trailingSlash: true,
  basePath: basePath || undefined,
  reactStrictMode: true,
  poweredByHeader: false,
  // --- code-obfuscation --- never ship browser source maps (they would undo the obfuscation of the export); off by
  // default, set explicitly so a change is deliberate. scripts/obfuscate.mjs also deletes any stray .map from out/.
  productionBrowserSourceMaps: false,
  images: {
    // Static export has no image optimiser; the mode previews are plain WebP files anyway.
    unoptimized: true,
  },
  // --- ai-guard --- JBL_BUILD_SKIP_TYPECHECK=1 skips Next's own type check (about 95 of a build's 130 s) for a build whose
  // commit an explicit `npm run typecheck` (or the core guard's lane A) has just checked: the CI build and smoke-shard steps
  // and `npm run guard:browser`. Unset – `npm run build`, the VPS deployer – the build type-checks exactly as before.
  // tests/releaseWorkflows.test.ts pins where it may be set.
  typescript: { ignoreBuildErrors: process.env.JBL_BUILD_SKIP_TYPECHECK === "1" },
};

export default withNextIntl(nextConfig);
