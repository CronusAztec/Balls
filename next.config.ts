import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * The site is a fully static export (`out/`), so it can be hosted on GitHub Pages or any
 * static file host. NEXT_PUBLIC_BASE_PATH is the sub-folder the site is served from
 * (e.g. "/Balls" for https://<user>.github.io/Balls); leave it empty for a root deployment.
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "export",
  // Every page becomes <route>/index.html so static hosts resolve links without rewrites.
  trailingSlash: true,
  basePath: basePath || undefined,
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // Static export has no image optimiser; the mode previews are plain WebP files anyway.
    unoptimized: true,
  },
};

export default withNextIntl(nextConfig);
