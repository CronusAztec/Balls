import type { DesktopPrefs } from "@/lib/desktop/contract";

/*
 * --- desktop-exe --- The app's preferences (electron-store keeps them in config.json of the data folder): defaults and the
 * check every change from the page goes through – unknown keys are dropped, every value must have its default's type and
 * the enumerated ones a known value.
 */

export const DEFAULT_PREFS: DesktopPrefs = {
  outputFolder: "",
  preferHardware: true,
  ffmpegPath: "",
  encoderOverride: "",
  closeToTray: true,
  autoUpdate: true,
  aiProvider: "local",
  localModel: "llama-3.2-3b-instruct-q4km",
  aiGpu: "auto",
};

const ENUMS: Partial<Record<keyof DesktopPrefs, readonly string[]>> = {
  aiProvider: ["local", "cloud"],
  aiGpu: ["auto", "off"],
};

/** The valid part of a patch from the page (unknown keys and wrongly typed values dropped). */
export function sanitizePrefs(patch: unknown): Partial<DesktopPrefs> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!(key in DEFAULT_PREFS)) continue;
    const fallback = DEFAULT_PREFS[key as keyof DesktopPrefs];
    if (typeof value !== typeof fallback) continue;
    const allowed = ENUMS[key as keyof DesktopPrefs];
    if (allowed && !allowed.includes(value as string)) continue;
    if (typeof value === "string" && value.length > 1000) continue;
    out[key] = value;
  }
  return out as Partial<DesktopPrefs>;
}

/** Stored preferences over the defaults (a damaged store falls back field by field). */
export function resolvePrefs(stored: unknown): DesktopPrefs {
  return { ...DEFAULT_PREFS, ...sanitizePrefs(stored) };
}

/* ------------------------------------------------------------------ window state */

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export const DEFAULT_WINDOW: WindowState = { width: 1440, height: 920, maximized: false };

interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The window bounds to open with: the remembered ones when at least 100×100 px of the title bar region is on one of today's
 * displays (a monitor may have been unplugged), else centred on the primary display; never larger than the display.
 */
export function restoreWindowState(saved: unknown, displays: readonly Area[], primary: Area): WindowState {
  const s = saved && typeof saved === "object" ? (saved as Partial<WindowState>) : {};
  const width = Math.round(Math.max(800, Math.min(Number(s.width) || DEFAULT_WINDOW.width, primary.width)));
  const height = Math.round(Math.max(600, Math.min(Number(s.height) || DEFAULT_WINDOW.height, primary.height)));
  const maximized = s.maximized === true;
  if (typeof s.x === "number" && typeof s.y === "number" && Number.isFinite(s.x) && Number.isFinite(s.y)) {
    const x = s.x;
    const y = s.y;
    const visible = displays.some((d) => {
      const overlapW = Math.min(x + width, d.x + d.width) - Math.max(x, d.x);
      const overlapH = Math.min(y + 100, d.y + d.height) - Math.max(y, d.y);
      return overlapW >= 100 && overlapH >= 50;
    });
    if (visible) return { x: Math.round(x), y: Math.round(y), width, height, maximized };
  }
  return { x: Math.round(primary.x + (primary.width - width) / 2), y: Math.round(primary.y + (primary.height - height) / 2), width, height, maximized };
}
