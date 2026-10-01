import { describe, expect, it } from "vitest";
import { gpuStatusOf, gpuSwitches, hardwareAccelerated, preferredVendor, summariseGpuInfo, vendorOf } from "../src/gpu";

/* --- desktop-exe --- the GPU switches and the GPU panel's read-out */

describe("GPU switches", () => {
  it("enables GPU rasterisation, WebGPU and hardware video on Windows", () => {
    const names = gpuSwitches("win32", false).map(([n]) => n);
    expect(names).toEqual(expect.arrayContaining(["ignore-gpu-blocklist", "enable-gpu-rasterization", "enable-zero-copy", "force_high_performance_gpu", "enable-unsafe-webgpu", "enable-features"]));
    const features = gpuSwitches("win32", false).find(([n]) => n === "enable-features")?.[1] ?? "";
    expect(features).toContain("PlatformHEVCEncoderSupport");
    expect(gpuSwitches("linux", false).find(([n]) => n === "enable-features")?.[1]).toContain("VaapiVideoEncoder");
  });
  it("turns the GPU off in safe mode", () => {
    expect(gpuSwitches("win32", true)).toEqual([["disable-gpu"], ["disable-gpu-compositing"]]);
  });
});

describe("GPU read-out", () => {
  const info = {
    gpuDevice: [
      { active: false, vendorId: 0x8086, deviceId: 0x9bc4, driverVendor: "Intel", driverVersion: "31.0" },
      { active: true, vendorId: 0x10de, deviceId: 0x2684, driverVersion: "560.94", deviceString: "NVIDIA GeForce RTX 4090" },
    ],
    auxAttributes: { glRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  };
  it("names the devices, active first", () => {
    const devices = summariseGpuInfo(info);
    expect(devices.map((d) => [d.vendor, d.name, d.active])).toEqual([
      ["nvidia", "NVIDIA GeForce RTX 4090", true],
      ["intel", "Intel 0x9bc4", false],
    ]);
    expect(summariseGpuInfo({ gpuDevice: [{ active: true, vendorId: 0x1002, deviceId: 0x744c }], auxAttributes: { glRenderer: "ANGLE (AMD, Radeon RX 7900 XTX)" } })[0].name).toBe("AMD, Radeon RX 7900 XTX");
    expect(summariseGpuInfo(null)).toEqual([]);
    expect(vendorOf(0x1002)).toBe("amd");
    expect(vendorOf(0x1234)).toBe("other");
  });
  it("reads Chromium's feature status and picks the vendor for ffmpeg", () => {
    const status = gpuStatusOf(info, { video_encode: "enabled", video_decode: "enabled_on", webgpu: "unavailable_software" }, gpuSwitches("win32", false), false);
    expect(status).toMatchObject({ hardwareVideoEncode: true, hardwareVideoDecode: true, webgpu: false, disabled: false });
    expect(status.switches).toContain("--ignore-gpu-blocklist");
    expect(hardwareAccelerated("disabled_software")).toBe(false);
    expect(preferredVendor(status.devices)).toBe("nvidia");
    expect(preferredVendor([{ vendor: "microsoft", vendorId: 0x1414, deviceId: 0x8c, name: "Basic", driver: "", active: true }, { vendor: "amd", vendorId: 0x1002, deviceId: 1, name: "AMD", driver: "", active: false }])).toBe("amd");
    expect(preferredVendor([])).toBeNull();
  });
});
