import { useTranslations } from "next-intl";
import { MODE_COUNT } from "@/lib/modes"; // --- review fix (site-static) ---
import { Link } from "@/i18n/navigation";
import SectionHeading from "./SectionHeading";

function Pin({ n, className }: { n: number; className?: string }) {
  return (
    <span className={`absolute z-20 flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 text-slate-950 text-xs font-extrabold shadow-[0_0_14px_rgba(6,182,212,0.45)] ${className ?? ""}`}>
      {n}
    </span>
  );
}

function MockRow({ icon, label, pin }: { icon: string; label: string; pin?: number }) {
  return (
    <div className="relative flex items-center gap-2 rounded-lg bg-zinc-800/60 border border-zinc-700/50 px-2.5 py-2">
      {pin !== undefined && <Pin n={pin} className="-top-3 -left-3" />}
      <span className="text-xs" aria-hidden="true">
        {icon}
      </span>
      <span className="text-[11px] text-zinc-300 font-medium">{label}</span>
      <span className="ml-auto text-zinc-500 text-xs leading-none" aria-hidden="true">
        +
      </span>
    </div>
  );
}

const SETTING_KEYS = ["mode", "ballPhysics", "wallsGap", "wallBreakEffect", "visualEffects", "reactiveBackground", "spikes", "customBall", "textOverlay", "customSound", "watermark", "speed", "findSimulation", "recording", "savePreset"] as const;

export default function Instructions() {
  const t = useTranslations("Instructions");
  return (
    <section id="how-to-use" className="w-full max-w-6xl mx-auto mt-20 px-4 scroll-mt-16">
      <SectionHeading badge={t("howToUse")} title={t("title")} description={t("description")} />
      <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-start">
        <div className="lg:sticky lg:top-20">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-3 sm:p-4 shadow-2xl shadow-black/40">
            <div className="flex gap-3">
              <div className="flex-[1.7] rounded-lg bg-zinc-900/50 border border-zinc-800 p-2">
                <div className="relative aspect-video rounded-md bg-black overflow-hidden flex items-center justify-center">
                  <span className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900/70 border border-slate-700/50 text-cyan-400 text-[9px] font-bold">↻ {t("restart")}</span>
                  <span className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900/70 border border-slate-700/50 text-cyan-400 text-[9px] font-bold">
                    <Pin n={4} className="-top-3 -right-3" />
                    {t("pause")}
                  </span>
                  <div className="relative w-32 h-32 sm:w-40 sm:h-40 flex items-center justify-center">
                    <span className="absolute inset-0 rounded-full border-[3px] border-cyan-500/70" />
                    <span className="absolute inset-[13px] rounded-full border-[3px] border-cyan-400/60" />
                    <span className="absolute inset-[26px] rounded-full border-[3px] border-cyan-300/50" />
                    <span className="absolute inset-[39px] rounded-full border-[3px] border-zinc-600/60" />
                    <span className="relative w-4 h-4 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 shadow-[0_0_16px_rgba(6,182,212,0.7)]" />
                  </div>
                  <span className="absolute z-10 bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 text-slate-950 text-[10px] font-extrabold whitespace-nowrap">
                    <Pin n={3} className="-top-3 -left-3" />▶ {t("startSimulator")}
                  </span>
                  <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1 bg-slate-900/80 border border-slate-700/40 rounded-lg p-1">
                    <span className="text-[9px] font-mono text-cyan-400 px-1">12.4s</span>
                    {["1x", "2x", "4x", "8x"].map((sp, i) => (
                      <span key={sp} className={`px-1 rounded text-[8px] font-mono font-bold ${i === 1 ? "bg-cyan-500 text-slate-950" : "text-zinc-400"}`}>
                        {sp}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex-1 rounded-lg bg-zinc-900/90 border border-zinc-800 p-2.5 space-y-1.5">
                <div className="text-[11px] font-bold text-white px-0.5 pb-0.5">{t("controls")}</div>
                <div className="flex items-center gap-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/60 px-2 py-1.5">
                  <span className="text-[10px]" aria-hidden="true">
                    🔍
                  </span>
                  <span className="text-[10px] text-zinc-500">{t("searchSettings")}</span>
                </div>
                <MockRow icon="🎮" label={t("labels.mode")} pin={1} />
                <MockRow icon="🎱" label={t("labels.ballPhysics")} />
                <MockRow icon="🔵" label={t("labels.wallSettings")} />
                <MockRow icon="✨" label={t("labels.visualEffects")} pin={2} />
                <MockRow icon="🔊" label={t("labels.customSound")} />
                <MockRow icon="🎬" label={t("labels.recording")} pin={5} />
                <MockRow icon="💾" label={t("labels.savedPresets")} />
                <div className="relative pt-1">
                  <Pin n={6} className="-bottom-2 -left-3" />
                  <div className="flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 text-slate-950 text-[10px] font-extrabold py-2">🎥 {t("recordVideo")}</div>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-zinc-600">{t("mockupCaption")}</p>
        </div>
        <ol className="space-y-5">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <li key={n} className="flex gap-4">
              <span className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 text-slate-950 text-sm font-extrabold">{n}</span>
              <div>
                <h3 className="text-lg font-bold text-slate-50 leading-tight">{t(`step${n}.title`)}</h3>
                <p className="mt-1 text-sm text-slate-400 leading-relaxed">{t(`step${n}.body`, { modeCount: MODE_COUNT })}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-14">
        <h3 className="text-xl font-bold text-slate-50 mb-5 text-center">{t("whatEachControlDoes")}</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SETTING_KEYS.map((key) => (
            <div key={key} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-sm font-bold text-cyan-400">{t(`settings.${key}.name`)}</div>
              <div className="mt-1 text-xs text-slate-400 leading-relaxed">{t(`settings.${key}.what`)}</div>
            </div>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link href="/simulator" className="btn-bounce inline-flex px-7 py-3 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-blue-600 to-cyan-600">
            {t("tryItYourself")}
          </Link>
        </div>
      </div>
    </section>
  );
}
