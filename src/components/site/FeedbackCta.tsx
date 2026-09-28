import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function FeedbackCta() {
  const t = useTranslations("Feedback");
  return (
    <div className="container mx-auto px-4 pb-6 max-w-3xl">
      <Link href="/feedback" className="group flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-cyan-500/5 border border-cyan-500/15 hover:border-cyan-500/40 hover:bg-cyan-500/10 transition-all duration-300">
        <span className="text-sm text-zinc-400 group-hover:text-zinc-200 transition-colors">{t("cta")}</span>
        <span className="text-cyan-400 group-hover:translate-x-0.5 transition-transform duration-200" aria-hidden="true">
          →
        </span>
      </Link>
    </div>
  );
}
