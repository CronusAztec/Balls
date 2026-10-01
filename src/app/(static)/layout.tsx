import type { Metadata, Viewport } from "next";
import { SITE_NAME } from "@/lib/site";
// --- pwa ---
import PwaRegister from "@/components/site/PwaRegister";
import { PWA_ICON_FILES, PWA_THEME_COLOR } from "@/lib/pwa";
import { assetPath } from "@/lib/site";
// --- end pwa ---
import "../globals.css";

// --- review fix (site-static) --- no `title` here: a metadata <title> hydrates after NotFoundStatic's effect and writes
// "JumpingBallsLive" back over the localised 404 title; the root redirect page sets its own (page.tsx).
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
    <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- root layout of the locale-less pages */}
        <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;700;800&family=Hanken+Grotesk:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
