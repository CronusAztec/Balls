"use client";

import { useTranslations } from "next-intl";
import type { DesktopAiApi } from "./useDesktopAi";
import { Card, ghostBtn, primaryBtn } from "./ui";

/*
 * --- desktop-ai-fix --- The AI tab's first-run card: no model is on this PC and no cloud key is stored, so nothing can
 * answer yet (1.0.2 only showed a disabled Run). Two ways out: download the default model (once, about 2 GB – then it works
 * offline) or use a cloud provider with your own key. Hidden as soon as a model is ready, downloading, or a key is stored.
 */

/** The model the card downloads: the selected catalog model, else the first one of the catalog. */
export function setupModel(models: DesktopAiApi["models"]): DesktopAiApi["models"][number] | null {
  return models.find((m) => m.selected && !m.custom) ?? models.find((m) => !m.custom) ?? null;
}

/** Whether the card shows: nothing ready, nothing downloading, no key. */
export function needsSetup(ai: Pick<DesktopAiApi, "models" | "progress" | "status">): boolean {
  if (!ai.status || ai.status.cloud.hasKey) return false;
  if (ai.models.length === 0) return false;
  const busy = (id: string) => ["downloading", "verifying"].includes(ai.progress[id]?.state ?? "");
  return !ai.models.some((m) => m.state === "ready" || m.state === "downloading" || m.state === "verifying" || busy(m.id));
}

export default function AiSetupCard({ ai }: { ai: DesktopAiApi }) {
  const tx = useTranslations("DesktopAiFix");
  const model = setupModel(ai.models);
  if (!model) return null;
  const size = `${Math.max(1, Math.round(model.size / 1e9))} GB`;
  return (
    <Card title={tx("setupTitle")} testId="ai-setup">
      <p className="text-xs text-ink-2">{tx("setupBody")}</p>
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          className={primaryBtn}
          onClick={() => {
            ai.useProvider("local");
            ai.download(model.id);
          }}
          data-testid="ai-setup-download"
          data-model={model.id}
        >
          {tx("setupDownload", { size })}
        </button>
        <button type="button" className={ghostBtn} onClick={() => ai.useProvider("cloud")} data-testid="ai-setup-cloud">
          {tx("setupCloud")}
        </button>
      </div>
    </Card>
  );
}
