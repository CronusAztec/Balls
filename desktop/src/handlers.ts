import { IPC, SEND_CHANNELS, checkIpcArgs, type IpcChannel } from "@/lib/desktop/contract";
import { isAppUrl } from "./protocol";

/*
 * --- desktop-exe --- The main process side of the bridge: one handler per channel of the contract (the `Record` type makes
 * a missing one a compile error), every call checked before it runs – it must come from the app's own page (app://),
 * and its arguments must pass `checkIpcArgs()`. tests/ipc.test.ts registers the table on a fake ipcMain.
 */

export type Handler = (...args: unknown[]) => unknown;
export type HandlerTable = Record<IpcChannel, Handler>;

export interface IpcMainLike {
  handle(channel: string, listener: (event: { senderFrame?: { url: string } | null }, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: { senderFrame?: { url: string } | null }, ...args: unknown[]) => void): void;
}

export class IpcRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IpcRejected";
  }
}

/** Runs a handler after the origin and argument checks (what `ipcMain.handle` calls). */
export async function guarded(channel: IpcChannel, handler: Handler, senderUrl: string | undefined, args: unknown[]): Promise<unknown> {
  if (!senderUrl || !isAppUrl(senderUrl)) throw new IpcRejected(`${channel}: not from the app's page`);
  const problem = checkIpcArgs(channel, args);
  if (problem) throw new IpcRejected(`${channel}: invalid arguments – ${problem}`);
  return handler(...args);
}

export function registerHandlers(ipcMain: IpcMainLike, table: HandlerTable, onError: (message: string) => void = () => {}): void {
  for (const channel of Object.values(IPC) as IpcChannel[]) {
    const handler = table[channel];
    if (SEND_CHANNELS.includes(channel)) {
      ipcMain.on(channel, (event, ...args) => {
        guarded(channel, handler, event.senderFrame?.url, args).catch((err) => onError(String(err)));
      });
    } else {
      ipcMain.handle(channel, (event, ...args) => guarded(channel, handler, event.senderFrame?.url, args));
    }
  }
}
