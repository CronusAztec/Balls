import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPosts } from "@/content/blog";
import { formatPostDate } from "@/lib/markdown";

export default function BlogPreview() {
  const t = useTranslations("Blog");
  const locale = useLocale();
  const posts = getPosts(locale);
  const latest = posts.slice(0, 3);
  return (
    <section id="blog" className="w-full max-w-6xl mx-auto mt-16 px-4 scroll-mt-16">
      <h2 className="text-2xl font-bold text-white mb-2 text-center">{t("title")}</h2>
      <p className="text-zinc-400 text-sm text-center mb-8 max-w-xl mx-auto">{t("subtitle")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {latest.map((post) => (
          <Link key={post.slug} href={`/blog/${post.slug}`} className="group bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col gap-3 hover:border-zinc-600 transition-colors">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <time dateTime={post.date}>{formatPostDate(post.date, locale)}</time>
              <span aria-hidden="true">·</span>
              <span>{post.readingTime}</span>
            </div>
            <h3 className="text-base font-semibold text-white group-hover:text-[#93d119] transition-colors leading-snug">{post.title}</h3>
            <p className="text-sm text-zinc-400 leading-relaxed line-clamp-3">{post.description}</p>
            <div className="flex flex-wrap gap-1.5 mt-auto pt-2">
              {post.tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 bg-zinc-800 text-zinc-400 text-xs rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
      {posts.length > 3 && (
        <div className="text-center mt-6">
          <Link href="/blog" className="text-sm text-[#93d119] hover:underline transition-colors">
            {t("viewAll")} →
          </Link>
        </div>
      )}
    </section>
  );
}
