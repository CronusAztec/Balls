import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";
import "../globals.css";

export const metadata: Metadata = {
  title: SITE_NAME,
  robots: { index: false },
};

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
      <body className="antialiased">{children}</body>
    </html>
  );
}
