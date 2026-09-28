"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function Hero() {
  const t = useTranslations("Hero");
  return (
    <section className="relative overflow-hidden bg-slate-950">
      <div
        className="absolute inset-0 pointer-events-none opacity-60"
        aria-hidden="true"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%)",
        }}
      />
      <div className="relative container mx-auto px-4 py-16 sm:py-24 text-center">
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold leading-[0.98] tracking-tight max-w-full sm:max-w-4xl mx-auto break-words hyphens-auto">
          <span className="text-slate-50">{t("title1")}</span>
          <br />
          <span className="bg-gradient-to-r from-cyan-600 to-cyan-500 bg-clip-text text-transparent">{t("title2")}</span>
        </h1>
        <p className="mt-6 max-w-2xl mx-auto text-base sm:text-lg text-slate-400 leading-relaxed">{t("subtitle")}</p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/simulator" className="px-8 py-3.5 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-cyan-600 to-cyan-500 shadow-lg shadow-cyan-600/20 hover:scale-105 active:scale-95 transition-all">
            {t("startCreating")}
          </Link>
          <a
            href="#modes"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("modes")?.scrollIntoView({ behavior: "smooth" });
            }}
            className="px-8 py-3.5 rounded-xl font-bold text-slate-300 border border-zinc-700 hover:border-cyan-500 hover:text-cyan-400 transition-all"
          >
            {t("exploreModes")}
          </a>
        </div>
      </div>
    </section>
  );
}
