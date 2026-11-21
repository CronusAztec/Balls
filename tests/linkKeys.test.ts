/**
 * --- link-keys --- Every setting has a link key of its own. A mode's or a feature's writer (lib/settings.ts
 * settingsToSearchParams and the feature writers it calls) picks its keys by hand, so two of them can pick the same one: Sand
 * Plate's note length was written as `sps`, the splat barrier's size already was, and a ring mode's link then carried the note
 * length as its splat size (a Sand Plate link set the splat size too). This changes one setting at a time from Classic's
 * defaults (where every writer writes what differs from them) and checks that no link key answers to two settings.
 */
import { describe, expect, it } from "vitest";
import { RANGES, defaultSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";

describe("link keys (--- link-keys ---)", () => {
  it("are one setting's each: a ranged number or a switch changed alone writes keys no other setting writes", () => {
    const base = defaultSettings("classic") as unknown as Record<string, unknown>;
    const plain = settingsToSearchParams(base as never);
    const owners = new Map<string, string[]>();
    const note = (setting: string, params: URLSearchParams) => {
      const keys = new Set<string>();
      for (const [key, value] of params) if (plain.get(key) !== value) keys.add(key);
      for (const key of plain.keys()) if (!params.has(key)) keys.add(key);
      for (const key of keys) owners.set(key, [...(owners.get(key) ?? []), setting]);
    };
    let numbers = 0;
    for (const [setting, range] of Object.entries(RANGES as unknown as Record<string, { min: number; max: number; step: number }>)) {
      const value = base[setting];
      if (typeof value !== "number") continue;
      const next = Math.round((value + range.step <= range.max ? value + range.step : value - range.step) * 1000) / 1000;
      note(setting, settingsToSearchParams({ ...base, [setting]: next } as never));
      numbers++;
    }
    let switches = 0;
    for (const [setting, value] of Object.entries(base)) {
      if (typeof value !== "boolean") continue;
      note(setting, settingsToSearchParams({ ...base, [setting]: !value } as never));
      switches++;
    }
    expect(numbers).toBeGreaterThan(300);
    expect(switches).toBeGreaterThan(50);
    expect(owners.size).toBeGreaterThan(400);
    expect([...owners].filter(([, settings]) => settings.length > 1).map(([key, settings]) => `${key}: ${settings.join(", ")}`)).toEqual([]);
  });

  it("keep the splat size and Sand Plate's note length apart, both ways", () => {
    const ring = settingsToSearchParams({ ...defaultSettings("classic"), splatBarrier: true, splatSize: 1.25 });
    expect(ring.get("sps")).toBe("1.25");
    expect(settingsFromSearchParams(ring).splatSize).toBe(1.25);
    const plate = settingsToSearchParams({ ...defaultSettings("sandPlate"), spNoteSec: 3 });
    expect(plate.get("spt")).toBe("3");
    expect(plate.has("sps")).toBe(false);
    const back = settingsFromSearchParams(plate);
    expect([back.spNoteSec, back.splatSize]).toEqual([3, defaultSettings("sandPlate").splatSize]);
  });
});
