import { useTranslations } from "next-intl";
import { modesForFilter } from "@/lib/siteDesign";

/* --- site-redesign --- How it works: three numbered steps in one row, the numerals large and quiet. */
export default function HowItWorks() {
  const t = useTranslations("HowItWorks");
  const headings = useTranslations("Headings");
  const count = modesForFilter("all").length;
  return (
    <section className="border-t border-line" aria-labelledby="how-title">
      <div className="site-container py-16 sm:py-20">
        <h2 id="how-title" className="text-2xl font-bold text-ink">
          {headings("howItWorks")}
        </h2>
        <ol className="mt-10 grid grid-cols-1 border-t border-line md:grid-cols-3">
          {(["step1", "step2", "step3"] as const).map((step, i) => (
            <li key={step} className="border-b border-line py-8 md:border-b-0 md:border-l md:px-8 md:first:border-l-0 md:first:pl-0">
              <span className="num block text-3xl leading-none text-ink-3" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-6 text-lg font-medium text-ink">{t(`${step}.title`)}</h3>
              <p className="mt-2 max-w-[36ch] text-md text-ink-2">{t(`${step}.description`, { count })}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
