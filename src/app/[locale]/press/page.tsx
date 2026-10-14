import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ProseLayout from "@/components/site/ProseLayout";
import JsonLd from "@/components/site/JsonLd";
import { Link } from "@/i18n/navigation";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { ACCENT, ACCENT_LIGHT, SITE_NAME, assetPath } from "@/lib/site";
import { PWA_THEME_COLOR } from "@/lib/pwa";
import { MODE_CARD_ORDER } from "@/lib/modes";
import { PLANS, yearlySavingPercent } from "@/lib/billing/config";
import { faqPrices } from "@/lib/faqValues";
import { DESKTOP_VERSION } from "@/lib/desktop/release";
import { buildLabel } from "@/lib/buildInfo";
import { LEGAL_NAME, SUPPORT_EMAIL } from "@/lib/operator";
import { CHANGELOG, formatChangelogDate } from "@/content/changelog";
import { IconDownload } from "@/components/ui/icons";

/*
 * --- press --- The press page (/press): what a writer needs in one place, as a static server page with no client component. The
 * fact sheet (what it is, platforms, the number of modes, export sizes, the free version, the Pro prices from the billing config,
 * the first release, the website build label and the Windows app version, the operator and the contact), the description in three
 * lengths (the word counts are measured from the text, never typed), the logo files that already ship with the site (public/icon.svg,
 * public/icons/*.png and the home page's social card, so nothing new is bundled or precached) with the brand colours, the rules for
 * using the name, a note that Fight League names and footage are not part of the kit, and the contact: the operator's e-mail
 * when NEXT_PUBLIC_SUPPORT_EMAIL is set, else the feedback page. The text is the Press namespace; every number and name is read
 * from the code (tests/pressPage.test.ts). docs/ADS.md and docs/ads/copy.json hold the ad kit.
 */

/** The text colour of the site (`--color-ink` in globals.css, tests/pressPage.test.ts compares the two): the only swatch that is not a code constant. */
const INK = "#f2f2ed";

const LENGTHS = ["short", "medium", "long"] as const;

/** The logo files, in the order they are shown: the file under public/, the label key, the picture's box. */
const FILES = [
  { path: "/icon.svg", label: "fileSvg", kind: "mark" },
  { path: "/icons/icon-512.png", label: "filePng512", kind: "mark" },
  { path: "/icons/icon-192.png", label: "filePng192", kind: "mark" },
] as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Press" });
  const v = { siteName: SITE_NAME };
  return pageMetadata({ locale, path: "/press", title: t("metaTitle", v), description: t("metaDescription", v) }); // --- seo ---
}

/** How many words a text has once its placeholders are filled (what the label of a description says). */
const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export default async function PressPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Press" });
  const site = await getTranslations({ locale, namespace: "SiteRedesign" });
  const v = { siteName: SITE_NAME };
  const prices = faqPrices(locale);
  const values = { ...v, count: MODE_CARD_ORDER.length, ...prices, percent: yearlySavingPercent(PLANS) };
  const firstSite = [...CHANGELOG].reverse().find((r) => r.product === "site");
  const link = (href: string) =>
    function RichLink(chunks: React.ReactNode) {
      return (
        <Link href={href} className="text-ink underline decoration-accent-dim underline-offset-4 hover:text-accent">
          {chunks}
        </Link>
      );
    };
  const anchor = (href: string) =>
    function RichAnchor(chunks: React.ReactNode) {
      return (
        <a href={href} className="text-ink underline decoration-accent-dim underline-offset-4 hover:text-accent">
          {chunks}
        </a>
      );
    };
  const contactLink = SUPPORT_EMAIL ? (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="text-ink underline decoration-accent-dim underline-offset-4 hover:text-accent" data-testid="press-contact-email">
      {SUPPORT_EMAIL}
    </a>
  ) : (
    <Link href="/feedback" className="text-ink underline decoration-accent-dim underline-offset-4 hover:text-accent" data-testid="press-contact-feedback">
      {t("facts.contactFeedback")}
    </Link>
  );
  const facts: [string, React.ReactNode][] = [
    [t("facts.whatLabel"), t("facts.whatValue")],
    [t("facts.platformsLabel"), t("facts.platformsValue")],
    [t("facts.modesLabel"), t("facts.modesValue", values)],
    [t("facts.exportLabel"), t("facts.exportValue")],
    [t("facts.languagesLabel"), t("facts.languagesValue")],
    [t("facts.freeLabel"), t("facts.freeValue")],
    [t("facts.priceLabel"), t("facts.priceValue", values)],
    ...(firstSite ? ([[t("facts.releasedLabel"), <time key="released" dateTime={firstSite.date}>{formatChangelogDate(firstSite.date, locale)}</time>]] as [string, React.ReactNode][]) : []),
    [t("facts.websiteLabel"), <span key="website" className="num" data-testid="press-website-version">{buildLabel()}</span>],
    [t("facts.appLabel"), <span key="app" className="num" data-testid="press-app-version">{DESKTOP_VERSION}</span>],
    ...(LEGAL_NAME ? ([[t("facts.operatorLabel"), LEGAL_NAME]] as [string, React.ReactNode][]) : []),
    [t("facts.contactLabel"), contactLink],
  ];
  const swatches = [
    { label: t("brand.colourAccent"), hex: ACCENT },
    { label: t("brand.colourAccentLight"), hex: ACCENT_LIGHT },
    { label: t("brand.colourBackground"), hex: PWA_THEME_COLOR },
    { label: t("brand.colourText"), hex: INK },
  ];
  const sections = [
    { id: "facts", label: t("facts.title") },
    { id: "about", label: t("about.title") },
    { id: "brand", label: t("brand.title") },
    { id: "usage", label: t("usage.title") },
    { id: "not-included", label: t("notIncluded.title") },
    { id: "contact", label: t("contact.title") },
  ];
  const breadcrumbs = await breadcrumbJsonLd(locale, [{ name: t("badge"), path: "/press" }]); // --- seo --- Home > Press
  const h2 = "text-xl font-bold text-ink";
  const sectionClass = "scroll-mt-24 border-t border-line pt-10";
  return (
    <>
      <JsonLd data={breadcrumbs} />
      <ProseLayout
        eyebrow={t("badge")}
        title={t("title", v)}
        lede={t("intro")}
        meta={
          <span data-testid="press-versions">
            {t("metaWebsite", { label: buildLabel() })} · {t("metaApp", { version: DESKTOP_VERSION })}
          </span>
        }
        toc={sections}
        tocLabel={site("prose.onThisPage")}
        plain
        testId="press-page"
      >
        <div className="space-y-14">
          <section id="facts" aria-labelledby="press-facts" className="scroll-mt-24">
            <h2 id="press-facts" className={h2}>
              {t("facts.title")}
            </h2>
            <dl className="mt-5 border-t border-line" data-testid="press-facts">
              {facts.map(([label, value]) => (
                <div key={label} className="grid gap-1 border-b border-line py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="eyebrow text-ink-3">{label}</dt>
                  <dd className="text-md text-ink-2">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-md text-ink-2">{t.rich("facts.note", { changelog: link("/changelog"), download: link("/download") })}</p>
          </section>

          <section id="about" aria-labelledby="press-about" className={sectionClass}>
            <h2 id="press-about" className={h2}>
              {t("about.title")}
            </h2>
            <p className="mt-3 text-md text-ink-2">{t("about.intro")}</p>
            <ul className="mt-5 space-y-4" data-testid="press-boilerplate">
              {LENGTHS.map((length) => {
                const text = t(`about.${length}`, values);
                return (
                  <li key={length} className="rounded-xl border border-line bg-surface-1 p-5" data-testid={`press-boilerplate-${length}`}>
                    <p className="eyebrow text-ink-3">{t(`about.${length}Label`, { words: countWords(text) })}</p>
                    <p className="mt-3 select-all text-md leading-relaxed text-ink">{text}</p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section id="brand" aria-labelledby="press-brand" className={sectionClass}>
            <h2 id="press-brand" className={h2}>
              {t("brand.title")}
            </h2>
            <p className="mt-3 text-md text-ink-2">{t("brand.intro")}</p>
            <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="press-downloads">
              {FILES.map((file) => (
                <li key={file.path}>
                  <a
                    href={assetPath(file.path)}
                    download
                    className="flex h-full flex-col gap-3 rounded-xl border border-line bg-surface-1 p-3 transition-colors duration-150 hover:border-line-strong"
                  >
                    <span className="flex h-24 items-center justify-center rounded-md bg-bg">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={assetPath(file.path)} alt={t("brand.logoAlt", v)} width={64} height={64} className="h-16 w-16" />
                    </span>
                    <span className="flex items-start gap-2 text-sm font-medium text-ink">
                      <IconDownload size={16} className="mt-0.5 shrink-0 text-ink-3" />
                      {t(`brand.${file.label}`)}
                    </span>
                  </a>
                </li>
              ))}
              <li>
                <a
                  href={assetPath(`/og/${locale}/home.png`)}
                  download
                  className="flex h-full flex-col gap-3 rounded-xl border border-line bg-surface-1 p-3 transition-colors duration-150 hover:border-line-strong"
                >
                  <span className="flex h-24 items-center justify-center overflow-hidden rounded-md bg-bg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={assetPath(`/og/${locale}/home.png`)} alt={t("brand.cardAlt", v)} width={1200} height={630} loading="lazy" className="h-full w-auto object-contain" />
                  </span>
                  <span className="flex items-start gap-2 text-sm font-medium text-ink">
                    <IconDownload size={16} className="mt-0.5 shrink-0 text-ink-3" />
                    {t("brand.fileCard")}
                  </span>
                </a>
              </li>
            </ul>
            <p className="mt-3 text-sm text-ink-3">{t("brand.filesNote")}</p>
            <h3 className="mt-8 text-base font-medium text-ink">{t("brand.coloursTitle")}</h3>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="press-colours">
              {swatches.map((swatch) => (
                <li key={swatch.hex}>
                  <span className="block h-14 rounded-md border border-line" style={{ backgroundColor: swatch.hex }} />
                  <p className="mt-2 text-md text-ink">{swatch.label}</p>
                  <p className="num text-xs text-ink-3">{swatch.hex}</p>
                </li>
              ))}
            </ul>
          </section>

          <section id="usage" aria-labelledby="press-usage" className={sectionClass}>
            <h2 id="press-usage" className={h2}>
              {t("usage.title")}
            </h2>
            <ul className="mt-5 border-t border-line" data-testid="press-usage">
              {(t.raw("usage.items") as string[]).map((_, i) => (
                <li key={i} className="border-b border-line py-3 text-md text-ink-2">
                  {t(`usage.items.${i}`, v)}
                </li>
              ))}
            </ul>
          </section>

          <section id="not-included" aria-labelledby="press-not-included" className="scroll-mt-24 rounded-xl border border-line-strong bg-surface-1 p-6" data-testid="press-not-included">
            <h2 id="press-not-included" className="font-sans text-lg font-medium tracking-normal text-ink">
              {t("notIncluded.title")}
            </h2>
            <p className="mt-3 text-md text-ink-2">{t.rich("notIncluded.body", { contact: anchor("#contact") })}</p>
          </section>

          <section id="contact" aria-labelledby="press-contact" className={sectionClass} data-testid="press-contact">
            <h2 id="press-contact" className={h2}>
              {t("contact.title")}
            </h2>
            <p className="mt-3 text-md text-ink-2">
              {SUPPORT_EMAIL
                ? t.rich("contact.withEmail", { email: SUPPORT_EMAIL, mail: (chunks) => <a href={`mailto:${SUPPORT_EMAIL}`} className="text-ink underline decoration-accent-dim underline-offset-4 hover:text-accent">{chunks}</a> })
                : t.rich("contact.withoutEmail", { ...v, feedback: link("/feedback") })}
            </p>
            {LEGAL_NAME && <p className="mt-2 text-md text-ink-2">{t("contact.operator", { ...v, name: LEGAL_NAME })}</p>}
          </section>
        </div>
      </ProseLayout>
    </>
  );
}
