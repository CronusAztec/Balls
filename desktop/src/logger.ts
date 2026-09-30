import fs from "fs";
import path from "path";

/*
 * --- desktop-exe --- The app's log: main.log in the data folder's logs/ (rotated to main.old.log past 5 MB), one line per
 * event with an ISO time and a level; the page's warnings and errors come in through `desktop.log()`. Help → Open logs shows
 * the folder. API keys never reach it (the cloud layer never logs requests).
 */

const MAX_BYTES = 5 * 1024 * 1024;

export class Logger {
  readonly file: string;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "main.log");
  }

  write(level: "info" | "warn" | "error", message: string): void {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message.replace(/\s+/g, " ").slice(0, 4000)}\n`;
    try {
      const size = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
      if (size > MAX_BYTES) fs.renameSync(this.file, path.join(path.dirname(this.file), "main.old.log"));
      fs.appendFileSync(this.file, line);
    } catch {
      /* logging must never take the app down */
    }
    if (level === "error") console.error(line.trim());
    else if (process.env.JBL_VERBOSE) console.log(line.trim());
  }

  info = (message: string) => this.write("info", message);
  warn = (message: string) => this.write("warn", message);
  error = (message: string) => this.write("error", message);
}
