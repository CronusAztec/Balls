import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Accordion from "./Accordion";

/*
 * The guide under the studio: four tips and the troubleshooting rows. --- copy-pass --- the physics block and the mode list
 * were removed (the mode picker and the landing cards carry each mode's one-liner, Modes.<id>.description).
 */
export default function EditorialSections() {
  const t = useTranslations("Editorial");
  const tips = ["FindSimulation", "TextHooks", "ClipLength", "Speed"];
  const troubles = ["Export", "Audio", "Speed", "Settings", "Midi"];
  const block = "grid gap-6 border-t border-line py-14 sm:py-16 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-12";
  const head = (id: string, badge: string, title: string) => (
    <div className="lg:sticky lg:top-24 lg:self-start">
      <p className="eyebrow text-ink-3">{badge}</p>
      <h2 id={id} className="mt-3 text-xl font-bold text-ink">
        {title}
      </h2>
    </div>
  );
  return (
    <div className="site-container" data-testid="studio-guide">
      <section className={block} aria-labelledby="guide-tips">
        {head("guide-tips", t("tipsBadge"), t("tipsTitle"))}
        <ol className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
          {tips.map((tip, i) => (
            <li key={tip} className="flex gap-4 border-t border-line py-5">
              <span className="num w-6 shrink-0 text-md text-ink-3" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="text-md font-medium text-ink">{t(`tip${tip}Title`)}</h3>
                <p className="mt-1 text-md text-ink-2">{t(`tip${tip}Body`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className={block} aria-labelledby="guide-trouble">
        {head("guide-trouble", t("troubleBadge"), t("troubleTitle"))}
        <Accordion
          items={[
            ...troubles.map((k) => ({ question: t(`trouble${k}Q`), answer: <p>{t(`trouble${k}A`)}</p> })),
            {
              question: t("troubleStuckQ"),
              answer: (
                <p>
                  <Link href="/feedback" className="font-medium text-accent hover:text-accent-strong">
                    {t("troubleStuckA")}
                  </Link>
                </p>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
