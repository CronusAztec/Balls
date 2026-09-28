import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import { Link } from "@/i18n/navigation";
import { getPosts } from "@/content/blog";
import { formatPostDate } from "@/lib/markdown";
import { SITE_NAME, pageUrl } from "@/lib/site";
import { localeAlternates } from "../layout";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Blog" });
  return {
    title: t("metaTitle", { siteName: SITE_NAME }),
    description: t("metaDescription"),
    alternates: { canonical: pageUrl(locale, "/blog"), languages: localeAlternates("/blog") },
  };
}

export default async function BlogIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Blog" });
  const posts = getPosts(locale);
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans">
      <Navbar backHref="/" />
      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <h1 className="text-4xl font-extrabold tracking-tight text-white text-center">{t("title")}</h1>
        <p className="mt-3 text-zinc-400 text-center max-w-xl mx-auto">{t("subtitle")}</p>
        <div className="mt-10 space-y-5">
          {posts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="group block bg-zinc-900 border border-zinc-800 rounded-xl p-6 hover:border-zinc-600 transition-colors">
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <time dateTime={post.date}>{formatPostDate(post.date, locale)}</time>
                <span aria-hidden="true">·</span>
                <span>{post.readingTime}</span>
              </div>
              <h2 className="mt-2 text-xl font-bold text-white group-hover:text-[#93d119] transition-colors leading-snug">{post.title}</h2>
              <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{post.description}</p>
              <div className="flex flex-wrap gap-1.5 mt-4">
                {post.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 bg-zinc-800 text-zinc-400 text-xs rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
