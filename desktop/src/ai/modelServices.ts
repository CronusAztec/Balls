import { describeError } from "@/lib/desktop/errors";
import { ModelManager, type ManagerOptions } from "../models/manager";
import { AiService, type AiServiceDeps } from "./service";

/*
 * --- review fix (desktop-ai-fix) --- The model manager and the AI service, wired together the way main.ts runs them. A
 * finished download is selected when the selected model is not ready (1.0.2 kept Run disabled after downloading any model
 * but the preselected one) INSIDE the download, before its "ready" event: the page refreshes its AI status once, on that
 * event, so 1.0.3's selection – started after the download had returned, behind two passes over the model files – came
 * too late, and the page kept Run disabled with "Download or pick a model first". desktop/tests/aiFix.test.ts drives this
 * wiring through a real download and answers the page's refresh at the moment the event arrives.
 */

export interface ModelServicesOptions {
  /** The model manager's options (the ready hook is this module's). */
  manager: Omit<ManagerOptions, "onReady">;
  /** The AI service's dependencies (the model lookups are this module's: the manager's files). */
  service: Omit<AiServiceDeps, "modelPath" | "readyModels">;
}

export function createModelServices(options: ModelServicesOptions): { models: ModelManager; ai: AiService } {
  const log = options.service.log ?? (() => {});
  const models = new ModelManager({
    ...options.manager,
    // (only called by a download, which needs the IPC handlers – `ai` exists by then)
    onReady: async (id) => {
      try {
        await ai.ensureSelectedModel(id);
      } catch (err) {
        log("warn", `selecting ${id}: ${describeError(err)}`);
      }
    },
  });
  const ai = new AiService({
    ...options.service,
    modelPath: (id) => models.readyPath(id),
    readyModels: async () => (await models.list(options.service.prefs().localModel)).filter((m) => m.state === "ready").map((m) => m.id),
  });
  return { models, ai };
}
