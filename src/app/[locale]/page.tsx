import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { pageClientNamespaces, pickMessages } from "@/i18n/clientMessages"; // --- review fix (performance) ---
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import Hero from "@/components/site/Hero";
import ModesOverview from "@/components/site/ModesOverview";
import AboutTool from "@/components/site/AboutTool";
import HowItWorks from "@/components/site/HowItWorks";
import Instructions from "@/components/site/Instructions";
import FeedbackCta from "@/components/site/FeedbackCta";
import Features from "@/components/site/Features";
import FAQ from "@/components/site/FAQ";
import { FAQ_KEYS } from "@/lib/faq";
import JsonLd from "@/components/site/JsonLd";
import DailyChallengeCard from "@/components/site/DailyChallengeCard"; // --- daily-gallery ---
import { SITE_NAME, SITE_URL, pageUrl } from "@/lib/site";
import { MODE_CARD_ORDER } from "@/lib/modes"; // --- review fix (ui-i18n) --- the mode count comes from the code

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const faq = await getTranslations({ locale, namespace: "FAQ" });
  const layout = await getTranslations({ locale, namespace: "Layout" });
  const v = { siteName: SITE_NAME };
  const clientMessages = pickMessages(await getMessages(), pageClientNamespaces("")); // --- review fix (performance) --- (the hero, modes, FAQ, daily card)

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_KEYS.map((k) => ({
      "@type": "Question",
      name: faq(`${k}.question`, v),
      acceptedAnswer: { "@type": "Answer", text: faq(`${k}.answer`, v) },
    })),
  };
  const appJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url: pageUrl(locale),
    description: layout("metaDescription", { count: MODE_CARD_ORDER.length }),
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any",
    browserRequirements: layout("browserRequirements"),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    featureList: [layout("featuresModes", { count: MODE_CARD_ORDER.length }), ...(layout.raw("features") as string[])],
  };

  return (
    <NextIntlClientProvider messages={clientMessages}>
      <div className="min-h-screen bg-slate-950 text-slate-50 selection:bg-cyan-500/30 font-sans">
        <JsonLd data={{ "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: `${SITE_URL}/` }} />
        <JsonLd data={appJsonLd} />
        <JsonLd data={faqJsonLd} />
        <Navbar />
        <Hero />
        {/* --- daily-gallery --- today's challenge, below the hero */}
        <DailyChallengeCard />
        <ModesOverview />
        <AboutTool />
        <HowItWorks />
        <Instructions />
        <div className="mt-5">
          <FeedbackCta />
        </div>
        <Features />
        <div className="mt-5">
          <FeedbackCta />
        </div>
        <FAQ />
        <Footer />
      </div>
    </NextIntlClientProvider>
  );
}
