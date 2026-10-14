import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { pageClientNamespaces, pickMessages } from "@/i18n/clientMessages"; // --- review fix (performance) ---
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import Hero from "@/components/site/Hero";
import ModesOverview from "@/components/site/ModesOverview";
import HowItWorks from "@/components/site/HowItWorks";
import FAQ from "@/components/site/FAQ";
import { FAQ_KEYS } from "@/lib/faq";
import { faqPrices } from "@/lib/faqValues"; // --- legal-copy ---
import JsonLd from "@/components/site/JsonLd";
import DailyChallengeCard from "@/components/site/DailyChallengeCard"; // --- daily-gallery ---
import { SITE_NAME } from "@/lib/site";
import { organizationJsonLd, webApplicationJsonLd, webSiteJsonLd } from "@/lib/seo"; // --- seo ---
import { MODE_CARD_ORDER } from "@/lib/modes"; // --- review fix (ui-i18n) --- the mode count comes from the code

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const faq = await getTranslations({ locale, namespace: "FAQ" });
  const layout = await getTranslations({ locale, namespace: "Layout" });
  const prices = faqPrices(locale); // --- legal-copy --- FAQ q1 names the Pro prices: they come from the plans
  const v = { siteName: SITE_NAME, ...prices };
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
  // --- seo --- (builders in lib/seo.ts) the web application with its language and picture; the organisation and the site, at this language's entry page
  const appJsonLd = webApplicationJsonLd({
    locale,
    description: layout("metaDescription", { count: MODE_CARD_ORDER.length }),
    browserRequirements: layout("browserRequirements"),
    featureList: [layout("featuresModes", { count: MODE_CARD_ORDER.length }), ...(layout.raw("features") as string[])],
  });

  // --- site-redesign --- hero (with the live preview), today's challenge, the modes wall, how it works, the FAQ
  return (
    <NextIntlClientProvider messages={clientMessages}>
      <div className="min-h-screen bg-bg text-ink">
        <JsonLd data={webSiteJsonLd(locale)} />
        <JsonLd data={organizationJsonLd()} />
        <JsonLd data={appJsonLd} />
        <JsonLd data={faqJsonLd} />
        <Navbar />
        <main id="content">
          <Hero />
          {/* --- daily-gallery --- today's challenge, below the hero */}
          <DailyChallengeCard />
          <ModesOverview />
          <HowItWorks />
          <FAQ {...prices} />
        </main>
        <Footer />
      </div>
    </NextIntlClientProvider>
  );
}
