import { describe, expect, it } from "vitest";
import { buildProject, parseProject, serializeProject } from "@/lib/project";
import { decodeShareCode, encodeShareCode } from "@/lib/shareCode";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { DEFAULT_FAST_EXPORT_FPS } from "@/lib/recording/fastRenderPlan";

// Integration of fast-render with project-files: the fast export's frame rate (`fastExportFps`, URL `xfps`) is an ordinary
// setting, so project files and short share codes must carry it and snap a foreign value onto 30 / 60 on the way in.
describe("fast export frame rate in project files and share codes", () => {
  it("survives a project file and is snapped to 30 or 60 when the file holds another value", () => {
    const settings = { ...defaultSettings("classic"), fastExportFps: 30, recordingResolution: "1080x1920" };
    const parsed = parseProject(serializeProject(buildProject({ name: "fps", settings })));
    expect(parsed.ok && parsed.project.settings.fastExportFps).toBe(30);
    expect(parsed.ok && parsed.project.settings.recordingResolution).toBe("1080x1920");

    const raw = JSON.parse(serializeProject(buildProject({ name: "odd", settings }))) as { settings: Record<string, unknown> };
    for (const [value, expected] of [[24, 30], [50, 50], [120, 120], ["fast", DEFAULT_FAST_EXPORT_FPS]] as const) { // --- uncap-all --- any frame rate from 30 up
      raw.settings.fastExportFps = value;
      const odd = parseProject(JSON.stringify(raw));
      expect(odd.ok && odd.project.settings.fastExportFps).toBe(expected);
    }
  });

  it("travels in a short share code (xfps) like in the long link", async () => {
    const settings = { ...defaultSettings("shatter"), fastExportFps: 30 };
    const params = settingsToSearchParams(settings);
    expect(params.get("xfps")).toBe("30");
    const code = await encodeShareCode(params);
    expect(code).toBeTruthy();
    const decoded = await decodeShareCode(code!);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(settingsFromSearchParams(decoded.params).fastExportFps).toBe(30);
    // The default rate is left out of both links.
    expect(settingsToSearchParams(defaultSettings("shatter")).has("xfps")).toBe(false);
  });
});
