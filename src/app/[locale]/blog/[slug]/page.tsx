import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import JsonLd from "@/components/site/JsonLd";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getAllSlugs, getPost } from "@/content/blog";
import { formatPostDate, renderMarkdown } from "@/lib/markdown";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { localeAlternates } from "../../layout";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => getAllSlugs().map((slug) => ({ locale, slug })));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = getPost(locale, slug);
  if (!post) return {};
  return {
    title: `${post.title} – ${SITE_NAME}`,
    description: post.description,
    alternates: { canonical: `${SITE_URL}/${locale}/blog/${slug}`, languages: localeAlternates(`/blog/${slug}`) },
    openGraph: { title: post.title, description: post.description, type: "article", publishedTime: post.date, url: `${SITE_URL}/${locale}/blog/${slug}` },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const post = getPost(locale, slug);
  if (!post) notFound();
  const t = await getTranslations({ locale, namespace: "Blog" });
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.description,
          datePublished: post.date,
          inLanguage: post.locale,
          author: { "@type": "Organization", name: SITE_NAME },
          publisher: { "@type": "Organization", name: SITE_NAME },
          mainEntityOfPage: `${SITE_URL}/${locale}/blog/${slug}`,
        }}
      />
      <Navbar backHref="/blog" backLabel={t("back")} />
      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <article>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <time dateTime={post.date}>{formatPostDate(post.date, locale)}</time>
            <span aria-hidden="true">·</span>
            <span>{post.readingTime}</span>
          </div>
          <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">{post.title}</h1>
          <div className="flex flex-wrap gap-1.5 mt-4">
            {post.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 bg-zinc-800 text-zinc-400 text-xs rounded-full">
                {tag}
              </span>
            ))}
          </div>
          <div className="prose-article mt-8">{renderMarkdown(post.content)}</div>
        </article>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-zinc-800 pt-6">
          <Link href="/blog" className="text-sm text-zinc-400 hover:text-white transition-colors">
            {t("back")}
          </Link>
          <Link href="/simulator" className="btn-bounce inline-flex px-5 py-2.5 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-blue-600 to-cyan-600 text-sm">
            {t("tryNow")}
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
