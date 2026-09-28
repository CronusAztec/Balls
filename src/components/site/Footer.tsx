import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SITE_DOMAIN } from "@/lib/site";

export default function Footer({ showShortcuts = false }: { showShortcuts?: boolean }) {
  const t = useTranslations("Footer");
  const nav = useTranslations("Navbar");
  const links: { href: string; label: string }[] = [
    { href: "/about", label: t("about") },
    { href: "/tiktok-ball-videos", label: t("tiktok") },
    { href: "/blog", label: nav("blog") },
    { href: "/privacy", label: t("privacy") },
    { href: "/terms", label: t("terms") },
    { href: "/disclaimer", label: t("disclaimer") },
    { href: "/feedback", label: t("feedback") },
  ];
  return (
    <footer className="mt-16 border-t border-zinc-800 py-6">
      <div className="container mx-auto px-4 text-center text-zinc-500 text-sm">
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-zinc-600" aria-label="Footer">
          {links.map((link, i) => (
            <span key={link.href} className="contents">
              {i > 0 && <span aria-hidden="true">·</span>}
              <Link href={link.href} className="hover:text-zinc-400 transition-colors">
                {link.label}
              </Link>
            </span>
          ))}
        </nav>
        {showShortcuts && (
          <p className="mt-4 text-zinc-600 text-xs hidden sm:block">
            {t("shortcuts")}: <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400 text-xs border border-zinc-700">Space</kbd> {t("pauseResume")} ·{" "}
            <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400 text-xs border border-zinc-700">R</kbd> {t("restart")}
          </p>
        )}
        <p className="mt-4">
          © {new Date().getFullYear()} {SITE_DOMAIN}
        </p>
      </div>
    </footer>
  );
}
