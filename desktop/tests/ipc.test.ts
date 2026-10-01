import { describe, expect, it, vi } from "vitest";
import { BRIDGE_METHODS, DESKTOP_API_VERSION, EVENT_CHANNELS, IPC, SEND_CHANNELS, type DesktopApi, type IpcChannel } from "@/lib/desktop/contract";
import { IpcRejected, guarded, registerHandlers, type HandlerTable } from "../src/handlers";

/* --- desktop-exe --- the IPC contract: the preload exposes exactly the contract's methods on their channels, the main
   process handles every channel, and every call is checked (origin, arguments) before it runs */

const exposed: { name: string; api: DesktopApi }[] = [];
const invoked: { channel: string; args: unknown[] }[] = [];
const sent: { channel: string; args: unknown[] }[] = [];
const listeners = new Map<string, ((event: unknown, payload: unknown) => void)[]>();

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (name: string, api: DesktopApi) => exposed.push({ name, api }) },
  ipcRenderer: {
    invoke: async (channel: string, ...args: unknown[]) => (invoked.push({ channel, args }), `answer:${channel}`),
    send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }),
    on: (channel: string, l: (event: unknown, payload: unknown) => void) => listeners.set(channel, [...(listeners.get(channel) ?? []), l]),
    removeListener: (channel: string, l: (event: unknown, payload: unknown) => void) => listeners.set(channel, (listeners.get(channel) ?? []).filter((x) => x !== l)),
  },
}));

describe("preload bridge", () => {
  it("exposes window.desktop with every contract method on its channel", async () => {
    await import("../src/preload");
    expect(exposed).toHaveLength(1);
    const { name, api } = exposed[0];
    expect(name).toBe("desktop");
    expect(api.apiVersion).toBe(DESKTOP_API_VERSION);
    for (const [path, channel] of Object.entries(BRIDGE_METHODS)) {
      const fn = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], api) as (...a: unknown[]) => Promise<unknown>;
      expect(typeof fn).toBe("function");
      await expect(fn("arg")).resolves.toBe(`answer:${channel}`);
      expect(invoked.at(-1)).toEqual({ channel, args: ["arg"] });
    }
    api.log("warn", "careful");
    expect(sent).toEqual([{ channel: IPC.log, args: ["warn", "careful"] }]);
    // Events: subscribe, receive the payload (not the IPC event), unsubscribe.
    const got: unknown[] = [];
    const off = api.on("menu", (action) => got.push(action));
    listeners.get(EVENT_CHANNELS.menu)?.forEach((l) => l({ sender: "x" }, "queue"));
    off();
    listeners.get(EVENT_CHANNELS.menu)?.forEach((l) => l({}, "ai"));
    expect(got).toEqual(["queue"]);
    expect(() => api.on("nope" as never, () => {})).toThrow(/Unknown desktop event/);
    // Nothing of Electron or Node leaks into the page.
    expect(Object.keys(api).sort()).toEqual(["ai", "apiVersion", "dialogs", "gpu", "info", "journal", "library", "log", "on", "openLogs", "prefs", "render", "update"]);
  });
});

describe("main process handlers", () => {
  const table = Object.fromEntries(Object.values(IPC).map((c) => [c, vi.fn((...args: unknown[]) => ({ channel: c, args }))])) as unknown as HandlerTable;
  const page = { senderFrame: { url: "app://jumpingballslive/en/simulator/" } };

  it("registers every channel: requests with handle, log with on", () => {
    const handled: string[] = [];
    const on: string[] = [];
    registerHandlers({ handle: (c) => handled.push(c), on: (c) => on.push(c) }, table);
    expect([...handled, ...on].sort()).toEqual(Object.values(IPC).sort());
    expect(on).toEqual([...SEND_CHANNELS]);
  });

  it("runs a call from the app's page with valid arguments", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    registerHandlers({ handle: (c, l) => handlers.set(c, l as never), on: () => {} }, table);
    await expect(handlers.get(IPC.pickMedia)!(page, "song")).resolves.toEqual({ channel: IPC.pickMedia, args: ["song"] });
    await expect(handlers.get(IPC.libraryRemove)!(page, "id-1", true)).resolves.toMatchObject({ args: ["id-1", true] });
  });

  it("rejects other origins and invalid arguments before the handler runs", async () => {
    const handler = vi.fn();
    await expect(guarded(IPC.gpuStatus as IpcChannel, handler, "https://evil.example/", [])).rejects.toBeInstanceOf(IpcRejected);
    await expect(guarded(IPC.gpuStatus as IpcChannel, handler, undefined, [])).rejects.toThrow(/not from the app/);
    await expect(guarded(IPC.pickMedia as IpcChannel, handler, page.senderFrame.url, ["exe"])).rejects.toThrow(/invalid arguments/);
    await expect(guarded(IPC.renderSave as IpcChannel, handler, page.senderFrame.url, [{ jobId: "j", name: "a", folder: "", extension: "mp4", data: "not bytes", meta: {} }])).rejects.toThrow(/bytes/);
    await expect(guarded(IPC.aiSetCloud as IpcChannel, handler, page.senderFrame.url, [{ provider: "openai", baseUrl: "http://attacker.example", model: "m", use: true }])).rejects.toThrow(/https/);
    expect(handler).not.toHaveBeenCalled();
  });
});
