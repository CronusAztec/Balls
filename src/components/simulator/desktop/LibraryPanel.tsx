"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import type { DesktopApi, LibraryItem } from "@/lib/desktop/contract";
import { pickedToFile } from "@/lib/desktop/bridge";
import { onPublishTargetsChange, postText, publishTargets, type PublishTarget } from "@/lib/desktop/publish";
import { Card, dangerBtn, errorText, formatBytes, formatSeconds, ghostBtn, primaryBtn } from "./ui";

import { IconVideo } from "@/components/ui/icons"; // --- site-redesign ---
/*
 * --- desktop-exe --- The Library: the clips the render queue saved, newest first – thumbnail, length, size, encoder, the
 * post copy – with Open, Show in folder, Re-render (the clip's simulator link and seed back into the queue), Copy post text,
 * Delete (from the list, or to the recycle bin) and one-click Publish through the Publish feature's targets (lib/desktop/publish.ts,
 * registered by lib/publish/desktopTargets.ts: the accounts ticked in the Publish block, and the quick share).
 */

const noTargets: PublishTarget[] = [];

export default function LibraryPanel({ bridge, items, onRefresh, onRerender }: { bridge: DesktopApi; items: LibraryItem[]; onRefresh: () => void; onRerender: (item: LibraryItem) => void }) {
  const t = useTranslations("Desktop");
  const [status, setStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const targets = useSyncExternalStore(onPublishTargetsChange, publishTargets, () => noTargets);
  useEffect(onRefresh, [onRefresh]);

  const remove = (item: LibraryItem, deleteFile: boolean) => {
    if (deleteFile && !window.confirm(t("libDeleteConfirm", { name: item.fileName }))) return;
    void bridge.library.remove(item.id, deleteFile).then(onRefresh).catch((err: unknown) => setStatus(errorText(err)));
  };
  const publish = async (target: PublishTarget, item: LibraryItem) => {
    setStatus(t("libPublishing", { target: target.label }));
    try {
      const file = pickedToFile(await bridge.library.read(item.id));
      const result = await target.publish({ item, file, title: item.meta.title, caption: item.meta.caption ?? "", hashtags: item.meta.hashtags });
      setStatus(result && result.message ? result.message : result && result.url ? t("libPublishedAt", { url: result.url }) : t("libPublished", { target: target.label }));
    } catch (err) {
      setStatus(errorText(err));
    }
  };

  return (
    <Card
      title={t("libTitle", { count: items.length })}
      testId="desktop-library"
      actions={
        <>
          <button type="button" className={ghostBtn} onClick={onRefresh}>
            {t("libRefresh")}
          </button>
          <button type="button" className={ghostBtn} onClick={() => void bridge.library.openFolder()}>
            {t("queueFolderOpen")}
          </button>
        </>
      }
    >
      {status && <p className="text-xs text-ink-2">{status}</p>}
      {items.length === 0 ? (
        <p className="text-xs text-ink-3 py-6 text-center">{t("libEmpty")}</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-line bg-surface-1/60 overflow-hidden flex flex-col" data-library-item={item.fileName}>
              <div className="relative bg-black aspect-video flex items-center justify-center">
                {item.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnail} alt={item.meta.title} className="h-full object-contain" />
                ) : (
                  <IconVideo size={28} className="text-ink-3" />
                )}
                {!item.exists && <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-danger/80 text-xs text-ink">{t("libMissing")}</span>}
              </div>
              <div className="p-2 space-y-1 text-xs flex-1 flex flex-col">
                <p className="font-semibold text-ink truncate" title={item.path}>
                  {item.fileName}
                </p>
                <p className="text-ink-3">
                  {formatSeconds(item.durationSec)} · {formatBytes(item.bytes)}
                  {item.width && item.height ? ` · ${item.width}×${item.height}` : ""}
                  {item.encoder ? ` · ${item.encoder}` : ""}
                </p>
                <p className="text-ink-3">{new Date(item.createdAt).toLocaleString()}</p>
                {item.meta.hook && <p className="text-accent-strong truncate">{item.meta.hook}</p>}
                <div className="flex gap-1.5 flex-wrap mt-auto pt-1">
                  <button type="button" className={`${primaryBtn} !py-0.5`} disabled={!item.exists} onClick={() => void bridge.library.open(item.id)}>
                    {t("libOpen")}
                  </button>
                  <button type="button" className={`${ghostBtn} !py-0.5`} disabled={!item.exists} onClick={() => void bridge.library.reveal(item.id)}>
                    {t("libReveal")}
                  </button>
                  <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => onRerender(item)}>
                    {t("libRerender")}
                  </button>
                  <button
                    type="button"
                    className={`${ghostBtn} !py-0.5`}
                    onClick={() =>
                      void navigator.clipboard?.writeText(postText(item.meta)).then(() => {
                        setCopied(item.id);
                        setTimeout(() => setCopied(null), 1500);
                      })
                    }
                  >
                    {copied === item.id ? t("copied") : t("libCopyPost")}
                  </button>
                  {/* --- desktop-exe --- publish hook: one button per target the Publish feature registered */}
                  {targets.filter((target) => !target.available || target.available(item)).map((target) => (
                    <button key={target.id} type="button" className={`${primaryBtn} !py-0.5`} disabled={!item.exists} onClick={() => void publish(target, item)}>
                      {t("libPublishTo", { target: target.label })}
                    </button>
                  ))}
                  <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => remove(item, false)}>
                    {t("libForget")}
                  </button>
                  <button type="button" className={`${dangerBtn} !py-0.5`} disabled={!item.exists} onClick={() => remove(item, true)}>
                    {t("libDelete")}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {targets.length === 0 && items.length > 0 && <p className="text-xs text-ink-3">{t("libPublishHint")}</p>}
    </Card>
  );
}
