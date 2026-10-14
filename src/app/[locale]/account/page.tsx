import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import AccountPanel from "@/components/account/AccountPanel";
import { pageClientNamespaces, pickMessages } from "@/i18n/clientMessages";
import { pageMetadata } from "@/lib/seo"; // --- seo ---
import { SITE_NAME } from "@/lib/site";

/*
 * --- user-accounts --- The account page: create an account or sign in, and connect any number of TikTok, Instagram and
 * YouTube accounts. The same static page serves the website and the Windows app (app://). It is personal, so it is left out of
 * the search index and the sitemap; the live part is components/account/AccountPanel.tsx (the Account namespace).
 */

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Account" });
  return pageMetadata({ locale, path: "/account", title: t("metaTitle", { siteName: SITE_NAME }), description: t("metaDescription"), noindex: true }); // --- seo ---
}

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Account" });
  const clientMessages = pickMessages(await getMessages(), pageClientNamespaces("/account"));
  return (
    <NextIntlClientProvider messages={clientMessages}>
      <div className="min-h-screen bg-bg text-ink">
        <Navbar />
        <main id="content" className="site-container py-12 sm:py-16 lg:py-20" data-testid="account-page">
          <header className="max-w-[680px]">
            <p className="eyebrow text-ink-3">{t("eyebrow")}</p>
            <h1 className="mt-3 text-2xl font-bold text-ink lg:text-3xl">{t("title")}</h1>
            <p className="mt-4 text-lg leading-relaxed text-ink-2">{t("lede")}</p>
            <p className="mt-3 text-md leading-relaxed text-ink-3">{t("free")}</p>
          </header>
          <div className="mt-10">
            <AccountPanel />
          </div>
        </main>
        <Footer />
      </div>
    </NextIntlClientProvider>
  );
}
