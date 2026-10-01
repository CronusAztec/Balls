import type { Metadata, Viewport } from "next";
import { SITE_NAME } from "@/lib/site";
// --- pwa ---
import PwaRegister from "@/components/site/PwaRegister";
import { PWA_ICON_FILES, PWA_THEME_COLOR } from "@/lib/pwa";
import { assetPath } from "@/lib/site";
// --- end pwa ---
import "../globals.css";
import { fontVariables } from "../fonts"; // --- site-redesign --- self-hosted type (no font CDN)

// --- review fix (ui-i18n) --- no title here: the language redirect ("/", page.tsx) sets its own and the 404 page renders
// its localised <title> itself (a layout title would be re-applied by Next over it after hydration)
export const metadata: Metadata = {
  robots: { index: false },
  // --- pwa --- the same manifest, icons and iOS home-screen title as the localised pages
  manifest: assetPath("/manifest.webmanifest"),
  icons: { icon: assetPath("/icon.svg"), apple: assetPath(PWA_ICON_FILES.appleTouch) },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black-translucent" },
};

// --- pwa ---
export const viewport: Viewport = { themeColor: PWA_THEME_COLOR };

/**
 * Root layout for the two locale-less pages of the static export:
 *  - "/"    redirects the visitor to their language (see page.tsx),
 *  - "/404" is the localised not-found page that scripts/postexport.mjs copies to
 *           out/404.html, which GitHub Pages serves for every unknown URL.
 * Localised pages live under app/[locale] and have their own root layout.
 */
export default function StaticLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${fontVariables}`} style={{ colorScheme: "dark" }}>
      <body className="antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
