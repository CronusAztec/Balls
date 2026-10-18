/*
 * --- social-autopilot --- The autopilot's settings at rest: the `autopilot` block of the app's electron-store, every change
 * from the page sanitised field by field (src/lib/desktop/autopilot.ts: unknown keys dropped, 1..5 a day, "HH:MM" quiet
 * hours, a known language, a planning run at most every 1..48 h). The planner itself runs in the page while the app is
 * open and only proposes; the main process holds the settings and the queue, and never plans or posts on its own.
 */

import type { AutopilotLanguage, AutopilotSettings } from "@/lib/desktop/contract";
import { resolveAutopilot, sanitizeAutopilot } from "@/lib/desktop/autopilot";

export interface AutopilotStoreDeps {
  settings: () => unknown;
  setSettings: (settings: AutopilotSettings) => void;
  /** The app's language: the caption language until the user picks one. */
  defaultLanguage: AutopilotLanguage;
  log?: (level: "info" | "warn" | "error", message: string) => void;
}

export class AutopilotStore {
  constructor(private readonly deps: AutopilotStoreDeps) {}

  get(): AutopilotSettings {
    return resolveAutopilot(this.deps.settings(), this.deps.defaultLanguage);
  }

  /** The valid part of the patch over the stored settings; the result is stored and returned. */
  set(patch: unknown): AutopilotSettings {
    const before = this.get();
    const next = { ...before, ...sanitizeAutopilot(patch) };
    this.deps.setSettings(next);
    if (next.enabled !== before.enabled) this.deps.log?.("info", `autopilot ${next.enabled ? "on" : "off"}: ${next.channels.length} channel(s), ${next.perDay} a day, quiet ${next.quietFrom}–${next.quietTo}, every ${next.proposeHours} h (it only proposes)`);
    return next;
  }
}
