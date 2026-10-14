import type { Metadata } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import ProseLayout from "@/components/site/ProseLayout";
import ChangelogYourVersion from "@/components/site/ChangelogYourVersion";
import JsonLd from "@/components/site/JsonLd";
import { Link } from "@/i18n/navigation";
import { pageMetadata, breadcrumbJsonLd } from "@/lib/seo"; // --- seo ---
import { pageClientNamespaces, pickMessages } from "@/i18n/clientMessages";
import { CHANGELOG, entryText, formatChangelogDate, latestRelease, type ChangeKind, type ChangelogRelease } from "@/content/changelog";
import { routing, type Locale } from "@/i18n/routing";
import { SITE_NAME, SITE_URL, pageUrl } from "@/lib/site";
import { BUILD_COMMIT, buildLabel } from "@/lib/buildInfo";
import { buttonClass } from "@/components/ui/Button";
import { IconDownload } from "@/components/ui/icons";

/*
 * --- changelog --- What changed, newest first. A static, indexable reading page: a line with the newest version of the website
 * and of the Windows app, then one section per release. Each section has the product and version as its heading ("Website
 * 1.10.0", "Windows app 1.3.0"), the release's headline, its date as a <time> and the items tagged New / Improved / Fixed,
 * and an anchor (#app-1-3-0) that the Windows app, CHANGELOG.md and the release notes link to. Every release stays on the
 * page, the older ones too, with no script needed. The data is src/content/changelog.json (text is plain, {siteName} is
 * filled in by entryText); the chrome text is the Changelog namespace. The filter chips are radio buttons styled as chips: they
 * work without scripts (the site is static), the CSS hides the other product's releases.
 */

const KIND_STYLE: Record<ChangeKind, string> = { new: "text-accent", improved: "text-ink-2", fixed: "text-warn" };
const KIND_KEY = { new: "kindNew", improved: "kindImproved", fixed: "kindFixed" } as const;
const FILTERS = ["all", "site", "app"] as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Changelog" });
  const v = { siteName: SITE_NAME };
  // --- seo --- one helper builds the whole head (a page's own openGraph replaces the layout's, so it must be complete): lib/seo.ts
  return pageMetadata({ locale, path: "/changelog", title: t("metaTitle", v), description: t("metaDescription", v) });
}

export default async function ChangelogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang: Locale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "Changelog" });
  const site = await getTranslations({ locale, namespace: "SiteRedesign" });
  const v = { siteName: SITE_NAME };
  /** "Website 1.10.0" / "Windows app 1.3.0" */
  const nameOf = (r: ChangelogRelease) => t(r.product === "app" ? "releaseApp" : "releaseSite", { version: r.version });
  const url = pageUrl(locale, "/changelog");
  const newest = [latestRelease("site"), latestRelease("app")].filter((r): r is ChangelogRelease => !!r);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t("title", v),
    url,
    inLanguage: lang,
    description: t("metaDescription", v),
    dateModified: CHANGELOG[0]?.date,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE_URL}/` },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: CHANGELOG.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: `${nameOf(r)} · ${r.date}`, description: entryText(r.headline[lang]), url: `${url}#${r.id}` })),
    },
  };
  return (
    <>
      <JsonLd data={jsonLd} />
      {/* --- seo --- Home > Changelog */}
      <JsonLd data={await breadcrumbJsonLd(locale, [{ name: t("badge"), path: "/changelog" }])} />
      <ProseLayout
        eyebrow={t("badge")}
        title={t("title", v)}
        lede={t("intro", v)}
        // the newest version of each product, each a link to its section, and the build this page was made from (--- build-identity ---)
        meta={
          <>
            <span data-testid="changelog-versions">
              {newest.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && " · "}
                  <a href={`#${r.id}`} className="hover:text-accent">
                    {nameOf(r)}
                  </a>
                </span>
              ))}
            </span>
            <span className="num mt-1 block text-xs text-ink-3" data-testid="changelog-build" title={BUILD_COMMIT || undefined}>
              {t("buildLine", { build: buildLabel() })}
            </span>
          </>
        }
        toc={CHANGELOG.map((r) => ({ id: r.id, label: nameOf(r) }))}
        tocLabel={site("prose.onThisPage")}
        plain
        testId="changelog-page"
      >
        {/* Only the Windows app shows it (the bridge exists nowhere else); the client gets its own small namespace and only the ids it needs. */}
        <NextIntlClientProvider messages={pickMessages(await getMessages(), pageClientNamespaces("/changelog"))}>
          <ChangelogYourVersion appVersions={CHANGELOG.filter((r) => r.product === "app").map((r) => r.version)} />
        </NextIntlClientProvider>

        {/* The filter: three radios (siblings first, then the labels) and the list. :has() on the wrapper hides the other product. */}
        <div
          className="has-[#cl-site:checked]:[&_[data-product=app]]:hidden has-[#cl-app:checked]:[&_[data-product=site]]:hidden"
          data-testid="changelog-list"
        >
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">{t("filterLabel")}</legend>
            {FILTERS.map((f) => (
              <span key={f} className="contents">
                <input type="radio" name="changelog-filter" id={`cl-${f}`} value={f} defaultChecked={f === "all"} className="peer sr-only" />
                <label
                  htmlFor={`cl-${f}`}
                  className="inline-flex h-8 cursor-pointer items-center rounded-full border border-line px-3 text-sm font-medium whitespace-nowrap text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent [@media(pointer:coarse)]:min-h-11"
                >
                  {t(f === "all" ? "filterAll" : f === "site" ? "filterSite" : "filterApp")}
                </label>
              </span>
            ))}
          </fieldset>

          <ol className="mt-8" aria-label={t("title", v)}>
            {CHANGELOG.map((r) => (
              <li key={r.id} data-product={r.product} className="border-t border-line">
                <section id={r.id} aria-labelledby={`${r.id}-h`} className="scroll-mt-24 py-8">
                  <header>
                    <h2 id={`${r.id}-h`} className="text-lg font-bold text-ink">
                      <a href={`#${r.id}`} className="hover:text-accent">
                        {nameOf(r)}
                      </a>
                    </h2>
                    <p className="mt-1 text-md text-ink" data-testid="changelog-headline">
                      {entryText(r.headline[lang])}
                    </p>
                    <time dateTime={r.date} className="num mt-2 block text-xs text-ink-3">
                      {formatChangelogDate(r.date, lang)}
                    </time>
                  </header>
                  <ul className="mt-4">
                    {r.items.map((item, i) => (
                      <li key={i} className="grid gap-1 border-t border-line py-3 first:border-t-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4">
                        <span className={`eyebrow ${KIND_STYLE[item.kind]}`}>{t(KIND_KEY[item.kind])}</span>
                        <p className="text-md text-ink-2">{entryText(item.text[lang])}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-12 flex flex-col items-start gap-4 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[56ch] text-md text-ink-2">
            {t("outro")}{" "}
            <Link href="/feedback" className="text-ink underline decoration-accent-dim underline-offset-4 hover:text-accent">
              {t("feedback")}
            </Link>
          </p>
          <Link href="/download" className={buttonClass({ variant: "secondary", size: "md", className: "shrink-0" })}>
            <IconDownload size={16} />
            {t("download")}
          </Link>
        </div>
      </ProseLayout>
    </>
  );
}
