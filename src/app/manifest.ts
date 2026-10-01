import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { BASE_PATH, SITE_NAME } from "@/lib/site";
import { buildWebAppManifest } from "@/lib/pwa";
import { createTranslator } from "next-intl";
import { MODE_COUNT } from "@/lib/modes"; // --- review fix (site-static) ---
import en from "../../messages/en.json";

/**
 * Rendered at build time into out/manifest.webmanifest (feature pwa). Next links it from every page
 * (`<link rel="manifest">`, also set in both root layouts' metadata). The installed app opens the default
 * locale's landing page; scripts/postexport.mjs reads the name and colours from here for the offline page.
 */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return buildWebAppManifest({
    basePath: BASE_PATH,
    name: SITE_NAME,
    description: createTranslator({ locale: "en", messages: en, namespace: "Layout" })("metaDescription", { modeCount: MODE_COUNT }), // --- review fix (site-static) --- (fills {modeCount})
    locale: routing.defaultLocale,
    simulatorLabel: en.Navbar.simulator,
  });
}
