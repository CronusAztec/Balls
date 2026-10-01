import type { Metadata } from "next";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { pageClientNamespaces, pickMessages } from "@/i18n/clientMessages"; // --- review fix (performance) ---
import ProseLayout from "@/components/site/ProseLayout";
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

/* --- site-redesign --- the form in the reading column, on a panel under the title and the lede. */
export default async function FeedbackPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Feedback" });
  return (
    <ProseLayout title={t("title")} lede={t("subtitle")} plain>
      <div className="rounded-xl border border-line bg-surface-1 p-5 sm:p-8">
        {/* --- review fix (performance) --- the form's own messages (the layout passes only the shared ones) */}
        <NextIntlClientProvider messages={pickMessages(await getMessages(), pageClientNamespaces("/feedback"))}>
          <FeedbackForm />
        </NextIntlClientProvider>
      </div>
    </ProseLayout>
  );
}
