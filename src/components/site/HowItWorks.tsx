import { useTranslations } from "next-intl";
import { MODE_CARD_ORDER } from "@/lib/modes"; // --- review fix (ui-i18n) --- the mode count comes from the code

export default function HowItWorks() {
  const t = useTranslations("HowItWorks");
  const headings = useTranslations("Headings");
  return (
    <section className="w-full max-w-4xl mx-auto mt-16 px-4">
      <h2 className="text-2xl font-bold text-white mb-10 text-center">{headings("howItWorks")}</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {(["step1", "step2", "step3"] as const).map((step, i) => (
          <div key={step} className="flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-slate-950 text-lg font-extrabold shadow-[0_0_24px_rgba(6,182,212,0.3)]">{i + 1}</div>
            <h3 className="text-lg font-semibold text-white">{t(`${step}.title`)}</h3>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-xs">{t(`${step}.description`, { count: MODE_CARD_ORDER.length })}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
