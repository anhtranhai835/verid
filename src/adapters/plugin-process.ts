import { spawn } from "node:child_process";
import { pluginArgs } from "../core/plugin.js";
import { killTree } from "./test-runner.js";

export const PLUGIN_TIMEOUT_MS = 300_000;

/** No shell, bounded output, and the same process-tree cleanup as test runners. */
export function runPluginCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv = {},
  input = "",
  timeoutMs = PLUGIN_TIMEOUT_MS,
): Promise<{ exit: number | null; timedOut: boolean; stdout: string; stderr: string }> {
  const [bin, ...args] = pluginArgs(command);
  return new Promise((done) => {
    const child = spawn(bin === "node" ? process.execPath : bin!, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      settled = false;
    const finish = (exit: number | null, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ exit, timedOut, stdout, stderr });
    };
    const timer = setTimeout(() => {
      killTree(child.pid);
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdin.destroy();
      finish(null, true);
    }, timeoutMs);
    child.stdout.on("data", (data) => {
      stdout += data.toString();
      if (stdout.length > 64 * 1024) {
        stderr = "output exceeds 64 KiB";
        killTree(child.pid);
        finish(null, false);
        child.stdout.destroy();
        child.stderr.destroy();
      }
    });
    child.stderr.on("data", (data) => {
      stderr = (stderr + data.toString()).slice(0, 4096);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("error", (error) => {
      stderr = error.message;
      finish(null, false);
    });
    child.on("close", (exit) => finish(exit, false));
  });
}
