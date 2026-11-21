import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import StudioSkeleton from "@/components/simulator/studio/StudioSkeleton";
import { SkeletonModeFill, StudioLoadingHeader } from "@/components/simulator/studio/StudioLoading";
import { BASE_PATH } from "@/lib/site";
import { MODE_IDS } from "@/lib/physics/types";

/*
 * --- review fix (studio-first-open) --- The studio's layout: a Suspense boundary around the simulator page, whose fallback
 * is the page's first screen while the studio's scripts load (the studio's header and its skeleton, StudioSkeleton.tsx).
 * A client-side navigation into the studio (a mode card, the hero's pictures, Open the studio) shows it straight away: the
 * page's client components wait for the studio's scripts, and with no boundary above them the router kept the page the
 * visitor had left on screen, unchanged, for about 8 s on a phone. The fallback's client parts come from a module only this
 * layout imports (StudioLoading.tsx says why). A visit by address renders the page as before: its own skeleton is in its
 * HTML, and this fallback is not.
 */

export default async function SimulatorLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const names = Object.fromEntries(MODE_IDS.map((id) => [id, t(`Modes.${id}.name`)]));
  const labels = { mode: t("SiteRedesign.studio.mode"), start: t("Simulator.startSimulator"), failed: t("SimulatorPage.notLoaded"), reload: t("SimulatorPage.reload"), noScript: t("SimulatorPage.noScript") };
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-bg text-ink">
          <StudioLoadingHeader />
          <div id="content">
            <StudioSkeleton names={names} base={BASE_PATH} labels={labels} fill={<SkeletonModeFill names={names} base={BASE_PATH} />} />
          </div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
