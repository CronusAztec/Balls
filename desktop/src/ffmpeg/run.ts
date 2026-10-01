import { spawn } from "child_process";
import fs from "fs";
import type { FfmpegRunner } from "./encoders";
import { parseProgress } from "./args";

/*
 * --- desktop-exe --- Runs ffmpeg: the bundled build (ffmpeg-static, unpacked from the asar archive) or a full build the user
 * picked in the GPU panel. Output is collected (capped), a timeout and an AbortSignal kill the process, and a transcode
 * reports its position from `-progress pipe:1`.
 */

const MAX_OUTPUT = 4 * 1024 * 1024;

/** The bundled ffmpeg's path: ffmpeg-static's, moved out of app.asar (executables cannot run from inside it). */
export function bundledFfmpegPath(staticPath: string | null | undefined): string | null {
  if (!staticPath) return null;
  return staticPath.replace(`app.asar${pathSep()}`, `app.asar.unpacked${pathSep()}`);
}

function pathSep(): string {
  return process.platform === "win32" ? "\\" : "/";
}

/** The ffmpeg to use: the user's (when the file exists), else the bundled one. */
export function resolveFfmpeg(userPath: string, bundled: string | null): { path: string; bundled: boolean } | null {
  if (userPath && fs.existsSync(userPath)) return { path: userPath, bundled: false };
  if (bundled && fs.existsSync(bundled)) return { path: bundled, bundled: true };
  return null;
}

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called with ffmpeg's position (µs) as `-progress pipe:1` reports it. */
  onProgress?: (outTimeUs: number) => void;
}

export function runFfmpeg(binary: string, args: string[], options: RunOptions = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("ffmpeg cancelled", "AbortError"));
      return;
    }
    const child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() => reject(new DOMException("ffmpeg cancelled", "AbortError")));
    };
    const timer = options.timeoutMs ? setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error(`ffmpeg timed out after ${options.timeoutMs} ms`)));
    }, options.timeoutMs) : undefined;
    options.signal?.addEventListener("abort", onAbort);
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (stdout.length < MAX_OUTPUT) stdout += text;
      if (options.onProgress) {
        const p = parseProgress(text);
        if (p.outTimeUs !== null) options.onProgress(p.outTimeUs);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => finish(() => reject(err)));
    child.on("close", (code) => finish(() => resolve({ code, stdout, stderr })));
  });
}

/** A runner bound to one ffmpeg binary (what the encoder probe takes). */
export function ffmpegRunner(binary: string): FfmpegRunner {
  return { run: (args, options) => runFfmpeg(binary, args, options) };
}
