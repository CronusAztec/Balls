import type { Metadata } from "next";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { pageClientNamespaces, pickMessages } from "@/i18n/clientMessages"; // --- review fix (performance) ---
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import FeedbackForm from "@/components/site/FeedbackForm";
import { SITE_NAME, pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Feedback" });
  return {
    title: t("metaTitle", { siteName: SITE_NAME }),
    description: t("metaDescription", { siteName: SITE_NAME }),
    alternates: { canonical: pageUrl(locale, "/feedback"), languages: localeAlternates("/feedback") },
    robots: { index: false },
  };
}

export default async function FeedbackPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Feedback" });
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans">
      <Navbar backHref="/" />
      <main className="container mx-auto px-4 py-12 max-w-2xl">
        <div className="text-center mb-10">
          <div className="text-5xl mb-4" aria-hidden="true">
            💬
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">{t("title")}</h1>
          <p className="mt-3 text-zinc-400 max-w-lg mx-auto">{t("subtitle")}</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 sm:p-8">
          {/* --- review fix (performance) --- the form's own messages (the layout passes only the shared ones) */}
          <NextIntlClientProvider messages={pickMessages(await getMessages(), pageClientNamespaces("/feedback"))}>
            <FeedbackForm />
          </NextIntlClientProvider>
        </div>
      </main>
      <Footer />
    </div>
  );
}
