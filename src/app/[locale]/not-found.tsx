import { useTranslations } from "next-intl";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("NotFound");
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans">
      <Navbar />
      <main className="container mx-auto px-4 py-24 text-center max-w-xl">
        <div className="text-7xl mb-6" aria-hidden="true">
          🎱
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight text-white">{t("title")}</h1>
        <p className="mt-4 text-zinc-400">{t("description")}</p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/" className="px-6 py-3 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-cyan-600 to-cyan-500">
            {t("home")}
          </Link>
          <Link href="/simulator" className="px-6 py-3 rounded-xl font-bold text-slate-300 border border-zinc-700 hover:border-cyan-500 hover:text-cyan-400 transition-all">
            {t("simulator")}
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
