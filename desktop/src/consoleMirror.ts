/*
 * --- desktop-ai-fix --- node-llama-cpp reports its backend choice and its fallbacks ("[node-llama-cpp] … with Vulkan support is
 * not compatible with the current system, falling back to using no GPU") with console.warn / console.error / console.info,
 * which a Windows GUI app throws away. This mirrors those lines (the ones that carry `marker`) into main.log, without the
 * terminal colours, and never loops when the logger itself writes to the console.
 */

type Level = "info" | "warn" | "error";
type ConsoleLike = Pick<Console, "log" | "info" | "warn" | "error">;

/** A text without ANSI colour codes. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

/** Mirrors the console lines that contain `marker` into `write`; returns the function that puts the console back. */
export function mirrorConsole(target: ConsoleLike, write: (level: Level, message: string) => void, marker = "[node-llama-cpp]"): () => void {
  const originals = { log: target.log, info: target.info, warn: target.warn, error: target.error };
  let inside = false;
  const wrap = (name: keyof typeof originals, level: Level) =>
    function (this: unknown, ...args: unknown[]) {
      originals[name].apply(target, args);
      if (inside) return;
      const text = stripAnsi(args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" "));
      if (!text.includes(marker)) return;
      inside = true;
      try {
        write(level, text.trim());
      } finally {
        inside = false;
      }
    };
  target.log = wrap("log", "info");
  target.info = wrap("info", "info");
  target.warn = wrap("warn", "warn");
  target.error = wrap("error", "error");
  return () => Object.assign(target, originals);
}
