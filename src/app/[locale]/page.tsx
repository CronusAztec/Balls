import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import Hero from "@/components/site/Hero";
import ModesOverview from "@/components/site/ModesOverview";
import HowItWorks from "@/components/site/HowItWorks";
import FAQ from "@/components/site/FAQ";
import { FAQ_KEYS } from "@/lib/faq";
import JsonLd from "@/components/site/JsonLd";
import DailyChallengeCard from "@/components/site/DailyChallengeCard"; // --- daily-gallery ---
import { SITE_NAME, SITE_URL, pageUrl } from "@/lib/site";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const faq = await getTranslations({ locale, namespace: "FAQ" });
  const layout = await getTranslations({ locale, namespace: "Layout" });
  const v = { siteName: SITE_NAME };

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
    description: layout("metaDescription"),
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any",
    browserRequirements: layout("browserRequirements"),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    featureList: layout.raw("features"),
  };

  // --- site-redesign --- hero (with the live preview), today's challenge, the modes wall, how it works, the FAQ
  return (
    <div className="min-h-screen bg-bg text-ink">
      <JsonLd data={{ "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: `${SITE_URL}/` }} />
      <JsonLd data={appJsonLd} />
      <JsonLd data={faqJsonLd} />
      <Navbar />
      <main id="content">
        <Hero />
        {/* --- daily-gallery --- today's challenge, below the hero */}
        <DailyChallengeCard />
        <ModesOverview />
        <HowItWorks />
        <FAQ />
      </main>
      <Footer />
    </div>
  );
}
