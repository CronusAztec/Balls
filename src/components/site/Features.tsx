import { useTranslations } from "next-intl";

const FEATURES: { id: string; icon: string; key: string }[] = [
  { id: "wall-break-effects", icon: "💥", key: "wallBreak" },
  { id: "rainbow-walls", icon: "🌈", key: "rainbowWalls" },
  { id: "ball-glow-wall-glow", icon: "✨", key: "glow" },
  { id: "colour-trail", icon: "🎨", key: "colorTrail" },
  { id: "reactive-background", icon: "🔮", key: "reactiveBg" },
  { id: "bouncier-mode", icon: "⚡", key: "bouncier" },
  { id: "custom-ball-image", icon: "🖼️", key: "customBall" },
  { id: "text-overlays", icon: "💬", key: "textOverlays" },
  { id: "spikes", icon: "📌", key: "spikes" },
  { id: "video-export", icon: "🎬", key: "videoExport" },
  { id: "save-presets", icon: "💾", key: "savePresets" },
  { id: "watermark", icon: "🏷️", key: "watermark" },
  { id: "custom-sound", icon: "🎵", key: "customSound" },
];

export default function Features() {
  const t = useTranslations("Features");
  const headings = useTranslations("Headings");
  return (
    <section id="features" className="w-full max-w-6xl mx-auto mt-12 px-4 scroll-mt-16">
      <h2 className="text-3xl font-black text-white mb-10 text-center tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">{headings("features")}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {FEATURES.map((f) => (
          <div key={f.id} className="bg-slate-900/40 backdrop-blur-sm border border-slate-800 rounded-2xl p-6 flex gap-5 items-start hover:border-cyan-500/20 transition-all duration-300">
            <div className="w-12 h-12 shrink-0 flex items-center justify-center bg-slate-800 rounded-xl text-2xl shadow-inner border border-slate-700/50" aria-hidden="true">
              {f.icon}
            </div>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-lg font-black text-white tracking-tight">{t(`${f.key}.name`)}</h3>
              <p className="text-sm text-slate-400 leading-relaxed font-medium">{t(`${f.key}.description`)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
