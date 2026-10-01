import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { EncoderProbe, RenderProgressEvent, SaveRenderRequest, SavedRender } from "@/lib/desktop/contract";
import { safeFileBase } from "@/lib/desktop/fileNames";
import { buildInfoArgs, buildThumbnailArgs, buildTranscodeArgs, parseDuration, parseVideoSize } from "./ffmpeg/args";
import type { runFfmpeg } from "./ffmpeg/run";
import { uniquePath, type Library } from "./library";

/*
 * --- desktop-exe --- Saving a rendered clip: the fast export's bytes go straight to the output folder (no download dialog);
 * when the job asks for a platform preset, an upscale or another codec, ffmpeg re-encodes them on the GPU encoder the
 * probe chose (progress and cancel per job) and the intermediate file is removed. Then the library gets the clip with
 * its length, size and a thumbnail.
 */

export interface RenderDeps {
  outputFolder: () => string;
  ffmpeg: () => string | null;
  probe: () => Promise<EncoderProbe>;
  run: typeof runFfmpeg;
  library: Library;
  emit: (event: RenderProgressEvent) => void;
  log: (message: string) => void;
}

export class RenderSaver {
  private readonly jobs = new Map<string, AbortController>();

  constructor(private readonly deps: RenderDeps) {}

  cancel(jobId: string): void {
    this.jobs.get(jobId)?.abort();
  }

  async save(request: SaveRenderRequest): Promise<SavedRender> {
    const controller = new AbortController();
    this.jobs.set(request.jobId, controller);
    const folder = request.folder || this.deps.outputFolder();
    await fs.mkdir(folder, { recursive: true });
    const base = safeFileBase(request.name);
    const bytes = request.data instanceof Uint8Array ? request.data : new Uint8Array(request.data as ArrayBuffer);
    const ffmpeg = this.deps.ffmpeg();
    let finalPath: string;
    let encoder: string | null = null;
    let tempPath: string | null = null;
    try {
      this.deps.emit({ jobId: request.jobId, phase: "saving", progress: 0 });
      if (!request.transcode) {
        finalPath = uniquePath(folder, base, request.extension, existsSync);
        await fs.writeFile(finalPath, bytes);
      } else {
        if (!ffmpeg) throw new Error("ffmpeg is not available: pick an ffmpeg build in the GPU panel or render with the native preset");
        const probe = await this.deps.probe();
        encoder = probe.chosen[request.transcode.codec];
        if (!encoder) throw new Error(`No working ${request.transcode.codec.toUpperCase()} encoder in this ffmpeg build`);
        tempPath = path.join(folder, `.${base}-${randomUUID().slice(0, 8)}.render.${request.extension}`);
        await fs.writeFile(tempPath, bytes);
        finalPath = uniquePath(folder, base, "mp4", existsSync);
        const durationUs = Math.max(1, (request.durationSec ?? 1) * 1_000_000);
        this.deps.emit({ jobId: request.jobId, phase: "encoding", progress: 0 });
        const args = buildTranscodeArgs(tempPath, finalPath, request.transcode, encoder);
        this.deps.log(`transcode ${request.jobId}: ffmpeg ${args.join(" ")}`);
        const result = await this.deps.run(ffmpeg, args, { signal: controller.signal, onProgress: (us) => this.deps.emit({ jobId: request.jobId, phase: "encoding", progress: Math.min(1, us / durationUs) }) });
        if (result.code !== 0) {
          await fs.rm(finalPath, { force: true });
          throw new Error(`ffmpeg failed (${result.code}): ${result.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" ").slice(0, 400)}`);
        }
      }
      // Length, size and a thumbnail (ffmpeg when there is one).
      let durationSec = request.durationSec;
      let size: { width: number; height: number } | null = null;
      let thumbnailFile: string | null = null;
      if (ffmpeg) {
        this.deps.emit({ jobId: request.jobId, phase: "thumbnail", progress: 0 });
        const info = await this.deps.run(ffmpeg, buildInfoArgs(finalPath), { timeoutMs: 20000 }).catch(() => null);
        if (info) {
          durationSec = parseDuration(info.stderr) ?? durationSec;
          size = parseVideoSize(info.stderr);
        }
        const thumb = path.join(path.dirname(this.deps.library.thumbnailPathFor("x")), `${randomUUID()}.jpg`);
        await fs.mkdir(path.dirname(thumb), { recursive: true });
        const at = durationSec ? Math.min(1.5, durationSec / 2) : 0;
        const made = await this.deps.run(ffmpeg, buildThumbnailArgs(finalPath, thumb, at), { timeoutMs: 20000 }).catch(() => null);
        if (made?.code === 0 && existsSync(thumb)) thumbnailFile = thumb;
      }
      const stat = await fs.stat(finalPath);
      const item = await this.deps.library.add({ path: finalPath, bytes: stat.size, durationSec, width: size?.width ?? null, height: size?.height ?? null, encoder, meta: request.meta, thumbnailFile });
      return { path: finalPath, bytes: stat.size, durationSec, encoder, item };
    } finally {
      if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => {});
      this.jobs.delete(request.jobId);
    }
  }
}
