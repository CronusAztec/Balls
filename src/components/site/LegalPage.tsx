import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";

export const LEGAL_LAST_UPDATED = "2026-07-20";

export default function LegalPage({ title, lastUpdatedLabel, locale, children }: { title: string; lastUpdatedLabel: string; locale: string; children: React.ReactNode }) {
  const date = new Date(LEGAL_LAST_UPDATED + "T00:00:00Z").toLocaleDateString(locale === "pl" ? "pl-PL" : locale === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans">
      <Navbar />
      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">{title}</h1>
        <p className="mt-2 text-sm text-zinc-500">
          {lastUpdatedLabel}: {date}
        </p>
        <div className="mt-8 space-y-6 text-[15px] sm:text-base leading-relaxed text-slate-300 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-50 [&_h2]:pt-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_a]:text-cyan-400 [&_a]:font-semibold hover:[&_a]:underline">{children}</div>
      </main>
      <Footer />
    </div>
  );
}
