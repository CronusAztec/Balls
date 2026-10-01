import { contextBridge, ipcRenderer } from "electron";
import { BRIDGE_METHODS, DESKTOP_API_VERSION, EVENT_CHANNELS, IPC, type DesktopApi, type DesktopEventName } from "@/lib/desktop/contract";

/*
 * --- desktop-exe --- The preload script: builds `window.desktop` from the contract's method table (each method one
 * `ipcRenderer.invoke` on its channel) and exposes it through contextBridge – the page gets these functions only, never
 * ipcRenderer or Node. Context isolation is on, Node integration off, the renderer sandboxed.
 */

export function buildBridge(invoke: (channel: string, ...args: unknown[]) => Promise<unknown>, send: (channel: string, ...args: unknown[]) => void, subscribe: (channel: string, listener: (payload: unknown) => void) => () => void): DesktopApi {
  const api: Record<string, unknown> = { apiVersion: DESKTOP_API_VERSION };
  for (const [path, channel] of Object.entries(BRIDGE_METHODS)) {
    const parts = path.split(".");
    let target = api;
    for (const part of parts.slice(0, -1)) target = (target[part] ??= {}) as Record<string, unknown>;
    target[parts[parts.length - 1]] = (...args: unknown[]) => invoke(channel, ...args);
  }
  api.log = (level: string, message: string) => send(IPC.log, level, String(message).slice(0, 4000));
  api.on = (event: DesktopEventName, listener: (payload: unknown) => void) => {
    const channel = EVENT_CHANNELS[event];
    if (!channel) throw new Error(`Unknown desktop event ${String(event)}`);
    return subscribe(channel, listener);
  };
  return api as unknown as DesktopApi;
}

const bridge = buildBridge(
  (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  (channel, ...args) => ipcRenderer.send(channel, ...args),
  (channel, listener) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
);

contextBridge.exposeInMainWorld("desktop", bridge);
