import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SITE_NAME } from "@/lib/site";
import SectionHeading from "./SectionHeading";
import { MODE_COUNT } from "@/lib/modes"; // --- review fix (site-static) ---

export default function AboutTool() {
  const t = useTranslations("AboutTool");
  const v = { siteName: SITE_NAME, modeCount: MODE_COUNT };
  const sections: [string, string][] = [
    ["h3_1", "p3"],
    ["h3_2", "p4"],
    ["h3_3", "p5"],
    ["h3_4", "p6"],
    ["h3_5", "p7"],
    ["h3_6", "p8"],
  ];
  return (
    <section id="about-tool" className="w-full max-w-3xl mx-auto mt-20 px-4 scroll-mt-16">
      <SectionHeading badge={t("badge")} title={t("title", v)} />
      <div className="space-y-5 text-[15px] sm:text-base leading-relaxed text-slate-300 text-center">
        <p>{t("p1", v)}</p>
        <p>{t("p2", v)}</p>
        {sections.map(([h, p]) => (
          <div key={h} className="space-y-5">
            <h3 className="text-xl font-bold text-slate-50 pt-4">{t(h)}</h3>
            <p>{t(p, v)}</p>
          </div>
        ))}
        <h3 className="text-xl font-bold text-slate-50 pt-4">{t("h3_7")}</h3>
        <p>
          {t("p9_before", v)}{" "}
          <Link href="/feedback" className="font-semibold hover:underline text-cyan-400">
            {t("feedbackPage")}
          </Link>{" "}
          {t("p9_after")}
        </p>
        <div className="pt-6 text-center">
          <Link href="/simulator" className="btn-bounce inline-flex px-7 py-3 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-blue-600 to-cyan-600">
            {t("cta")}
          </Link>
        </div>
      </div>
    </section>
  );
}
