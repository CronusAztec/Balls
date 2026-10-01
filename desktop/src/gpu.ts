import type { GpuDevice, GpuStatus, GpuVendor } from "@/lib/desktop/contract";

/*
 * --- desktop-exe --- The GPU side of the app: the Chromium switches it launches with (GPU rasterisation, zero-copy, the
 * discrete GPU on laptops, WebGPU, hardware video encoding) and the GPU panel's read-out of `app.getGPUInfo()` /
 * `app.getGPUFeatureStatus()`. Pure, so tests/gpu.test.ts checks both without Electron.
 */

/** The switches for `app.commandLine.appendSwitch()`, in order; `safeMode` (a broken driver) turns the GPU off instead. */
export function gpuSwitches(platform: NodeJS.Platform, safeMode: boolean): [string, string?][] {
  if (safeMode) return [["disable-gpu"], ["disable-gpu-compositing"]];
  const features = platform === "win32"
    ? ["PlatformHEVCEncoderSupport", "MediaFoundationAV1Encoding", "MediaFoundationD3D11VideoCapture"]
    : platform === "linux"
      ? ["VaapiVideoEncoder", "VaapiVideoDecoder", "VaapiIgnoreDriverChecks", "AcceleratedVideoDecodeLinuxGL", "AcceleratedVideoEncoder"]
      : [];
  const switches: [string, string?][] = [
    ["ignore-gpu-blocklist"],
    ["enable-gpu-rasterization"],
    ["enable-zero-copy"],
    ["force_high_performance_gpu"],
    ["enable-unsafe-webgpu"],
  ];
  // Chromium ignores feature names it does not know, so the list may name features of newer or older versions.
  if (features.length) switches.push(["enable-features", features.join(",")]);
  return switches;
}

const VENDORS: Record<number, GpuVendor> = { 0x10de: "nvidia", 0x1002: "amd", 0x1022: "amd", 0x8086: "intel", 0x1414: "microsoft", 0x106b: "apple" };

export function vendorOf(vendorId: number): GpuVendor {
  return VENDORS[vendorId] ?? "other";
}

const VENDOR_NAMES: Record<GpuVendor, string> = { nvidia: "NVIDIA", amd: "AMD", intel: "Intel", microsoft: "Microsoft Basic Render", apple: "Apple", other: "GPU" };

interface RawGpuDevice {
  active?: boolean;
  vendorId?: number;
  deviceId?: number;
  driverVendor?: string;
  driverVersion?: string;
  vendorString?: string;
  deviceString?: string;
}

/** The GPU panel's devices from `app.getGPUInfo("complete" | "basic")` (the active one first). */
export function summariseGpuInfo(info: unknown): GpuDevice[] {
  const raw = (info && typeof info === "object" ? (info as { gpuDevice?: RawGpuDevice[]; auxAttributes?: { glRenderer?: string } }) : {}) ?? {};
  const renderer = typeof raw.auxAttributes?.glRenderer === "string" ? raw.auxAttributes.glRenderer : "";
  const devices = (Array.isArray(raw.gpuDevice) ? raw.gpuDevice : []).map((d): GpuDevice => {
    const vendorId = Number(d.vendorId) || 0;
    const deviceId = Number(d.deviceId) || 0;
    const vendor = vendorOf(vendorId);
    const fromRenderer = d.active && renderer ? renderer.replace(/^ANGLE \(|\)$/g, "") : "";
    const name = d.deviceString || fromRenderer || `${VENDOR_NAMES[vendor]} 0x${deviceId.toString(16).padStart(4, "0")}`;
    return { vendor, vendorId, deviceId, name, driver: [d.driverVendor, d.driverVersion].filter(Boolean).join(" "), active: d.active === true };
  });
  return devices.sort((a, b) => Number(b.active) - Number(a.active));
}

/** A feature Chromium runs on the GPU ("enabled", "enabled_on", "enabled_force"…), not in software. */
export function hardwareAccelerated(value: string | undefined): boolean {
  return typeof value === "string" && value.startsWith("enabled");
}

export function gpuStatusOf(info: unknown, features: Record<string, string>, switches: [string, string?][], safeMode: boolean): GpuStatus {
  return {
    devices: summariseGpuInfo(info),
    features,
    hardwareVideoEncode: hardwareAccelerated(features.video_encode),
    hardwareVideoDecode: hardwareAccelerated(features.video_decode),
    webgpu: hardwareAccelerated(features.webgpu),
    switches: switches.map(([name, value]) => (value ? `--${name}=${value}` : `--${name}`)),
    disabled: safeMode,
  };
}

/** The vendor the ffmpeg encoder choice favours: the active GPU's, else the first discrete one's. */
export function preferredVendor(devices: readonly GpuDevice[]): GpuVendor | null {
  const active = devices.find((d) => d.active && d.vendor !== "microsoft");
  if (active) return active.vendor;
  return devices.find((d) => ["nvidia", "amd", "intel"].includes(d.vendor))?.vendor ?? null;
}
