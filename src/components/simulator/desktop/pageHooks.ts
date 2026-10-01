import type { ModeId } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";
import type { BotCopy, BotLocale } from "@/lib/bot/copy";
import type { BotWorld } from "@/lib/bot/finderRequest";
import type { BatchRunState, CustomBatchFile, CustomBatchJob } from "../useBatchRender";
import type { FastExportState } from "../sections/FastExportSection";

/*
 * --- desktop-exe --- What the simulator page hands the Desktop group (Simulator.tsx builds it every render; the group keeps
 * the latest in a ref): its settings and how to change them, the batch renderer's `runJobs()` (the render queue renders
 * through the page's own fast export), the page's actions for the menu and shortcuts, and its upload handlers for files
 * opened from the native dialogs, dropped on the window or passed to the app.
 */
export interface DesktopPageHooks {
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  /** The preset loader (keeps the page's uploads selected). */
  applySettings: (settings: SimulatorSettings) => void;
  changeMode: (mode: ModeId) => void;
  runJobs: (jobs: CustomBatchJob[]) => Promise<CustomBatchFile[]>;
  batchRun: BatchRunState;
  cancelExport: () => void;
  fastExport: FastExportState;
  /** Recording, searching, a batch or a project import is in progress. */
  busy: boolean;
  selectMelody: (id: string | null) => Promise<void> | void;
  currentMelody: string | null;
  getWorld: () => BotWorld | null;
  pageSeed: () => number;
  copy: BotCopy;
  locale: BotLocale;
  actions: {
    startPause: () => void;
    restart: () => void;
    fastExport: () => void;
    record: () => void;
    find: () => void;
  };
  media: {
    song: (file: File) => void;
    video: (file: File) => void;
    midi: (file: File) => void;
    image: (file: File) => void;
    project: (file: File) => void;
  };
}
