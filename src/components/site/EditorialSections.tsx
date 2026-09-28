import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import SectionHeading from "./SectionHeading";
import Accordion from "./Accordion";
import { MODE_CARD_ORDER } from "@/lib/modes";

/** Physics explainer, mode descriptions, pro tips and troubleshooting shown under the simulator. */
export default function EditorialSections() {
  const t = useTranslations("Editorial");
  const modes = useTranslations("Modes");
  const tips = ["FindSimulation", "LayerEffects", "TextHooks", "ClipLength", "Presets", "Speed"];
  const troubles = ["Export", "Audio", "Speed", "Settings", "Midi"];
  return (
    <>
      <section className="w-full max-w-6xl mx-auto mt-16 px-4">
        <SectionHeading badge={t("physicsBadge")} title={t("physicsTitle")} />
        <div className="space-y-5 text-[15px] sm:text-base leading-relaxed text-slate-300">
          <p>{t("physicsP1")}</p>
          <p>{t("physicsP2")}</p>
          <p>{t("physicsP3")}</p>
        </div>
      </section>
      <section className="w-full max-w-6xl mx-auto mt-16 px-4">
        <SectionHeading badge={t("modesBadge")} title={t("modesTitle")} />
        <div className="grid sm:grid-cols-2 gap-4 text-[14px] leading-relaxed text-slate-300">
          {MODE_CARD_ORDER.map((id) => (
            <div key={id} className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 space-y-2">
              <h3 className="font-bold text-white text-base">{modes(`${id}.name`)}</h3>
              <p>{t(`mode${id.charAt(0).toUpperCase()}${id.slice(1)}`)}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="w-full max-w-6xl mx-auto mt-16 px-4">
        <SectionHeading badge={t("tipsBadge")} title={t("tipsTitle")} />
        <div className="space-y-5 text-[15px] sm:text-base leading-relaxed text-slate-300">
          {tips.map((tip) => (
            <div key={tip} className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 space-y-2">
              <h3 className="font-bold text-white">{t(`tip${tip}Title`)}</h3>
              <p>{t(`tip${tip}Body`)}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="w-full max-w-6xl mx-auto mt-16 px-4">
        <SectionHeading badge={t("troubleBadge")} title={t("troubleTitle")} />
        <Accordion
          items={[
            ...troubles.map((k) => ({ question: t(`trouble${k}Q`), answer: <p>{t(`trouble${k}A`)}</p> })),
            {
              question: t("troubleStuckQ"),
              answer: (
                <p>
                  <Link href="/feedback" className="text-cyan-400 font-semibold hover:underline">
                    {t("troubleStuckA")}
                  </Link>
                </p>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
