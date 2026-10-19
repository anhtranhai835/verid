import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

/**
 * Runs the manifest's test command through the platform shell (cmd.exe on Windows,
 * /bin/sh elsewhere) and keeps its whole output in `logFile`. Resolves with the exit
 * code, or null when the command could not start or was killed by a signal.
 */
export function runTestCommand(
  command: string,
  cwd: string,
  logFile: string,
): Promise<number | null> {
  return new Promise((done) => {
    const log = createWriteStream(logFile);
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    let settled = false;
    const finish = (code: number | null, note?: string) => {
      if (settled) return;
      settled = true;
      if (note) log.write(note);
      log.end(() => done(code));
    };
    child.on("error", (e) => finish(null, `\nverid: ${e.message}\n`));
    child.on("close", (code) => finish(code));
  });
}

/** Quotes a path for the shell the command runs in. */
export function shellQuote(path: string): string {
  return process.platform === "win32" ? `"${path}"` : `'${path.replaceAll("'", `'\\''`)}'`;
}
