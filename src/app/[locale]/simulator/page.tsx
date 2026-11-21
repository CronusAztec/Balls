import type { Metadata } from "next";
import { Suspense } from "react";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl"; // --- review fix (performance) --- (--- studio-first-open --- the catalogue but the server-only namespaces)
import { pickMessages, studioClientNamespaces } from "@/i18n/clientMessages"; // --- studio-first-open ---
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import Simulator from "@/components/simulator/Simulator";
import StudioSkeleton from "@/components/simulator/studio/StudioSkeleton"; // --- studio-first-open ---
import EditorialSections from "@/components/site/EditorialSections";
import { BASE_PATH, SITE_NAME } from "@/lib/site";
import JsonLd from "@/components/site/JsonLd"; // --- seo ---
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { MODE_CARD_ORDER } from "@/lib/modes"; // --- review fix (ui-i18n) --- the mode count comes from the code
import { MODE_IDS } from "@/lib/physics/types"; // --- studio-first-open --- (the skeleton names the mode a link opens)

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "SimulatorPage" });
  const count = MODE_CARD_ORDER.length;
  return pageMetadata({ locale, path: "/simulator", title: t("metaTitle", { siteName: SITE_NAME, count }), description: t("metaDescription", { count }) }); // --- seo ---
}

export default async function SimulatorPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const breadcrumbs = await breadcrumbJsonLd(locale, [{ name: t("SimulatorPage.heading"), path: "/simulator" }]); // --- seo ---
  // --- site-redesign --- the studio fills the first screen under the header; the guide (physics, modes, tips, help) reads below.
  // --- review fix (performance) --- the simulator's panel reads nearly every namespace: this page gets the whole catalogue
  // (the layout passes only the shared namespaces)
  // --- studio-first-open --- ... but the namespaces only server components read (i18n/clientMessages.ts), and while the
  // studio's script loads its skeleton shows the mode's poster and name, a disabled Start and a load bar, and says so when the
  // studio does not load (StudioSkeleton.tsx)
  const messages = await getMessages();
  const modeNames = Object.fromEntries(MODE_IDS.map((id) => [id, t(`Modes.${id}.name`)]));
  const skeletonLabels = { mode: t("SiteRedesign.studio.mode"), start: t("Simulator.startSimulator"), failed: t("SimulatorPage.notLoaded"), reload: t("SimulatorPage.reload"), noScript: t("SimulatorPage.noScript") };
  return (
    <NextIntlClientProvider messages={pickMessages(messages, studioClientNamespaces(Object.keys(messages)))}>
      <div className="min-h-screen bg-bg text-ink">
        <JsonLd data={breadcrumbs} />
        <Navbar variant="studio" />
        {/* --- review fix (site-static) --- the page's main heading for search and screen readers, outside the Suspense boundary */}
        {/* --- site-nav --- in a landmark of its own (the page's main is inside the studio, which renders in the browser only): a
            heading outside every landmark is passed over by landmark navigation */}
        <section aria-label={t("SimulatorPage.heading")}>
          <h1 className="sr-only">{t("SimulatorPage.heading")}</h1>
        </section>
        <div id="content">
          <Suspense fallback={<StudioSkeleton names={modeNames} base={BASE_PATH} labels={skeletonLabels} />}>
            <Simulator />
          </Suspense>
        </div>
        <EditorialSections />
        <Footer shortcuts="studio" />
      </div>
    </NextIntlClientProvider>
  );
}
