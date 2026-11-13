import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { expect, it } from "vitest";
import { temporaryDirectories } from "../support/temporary.js";

it.skipIf(process.platform !== "win32")(
  "retries cleanup while a child process releases its working directory",
  async () => {
    const cleanup = { maxRetries: 20, retryDelay: 25 };
    const directories = temporaryDirectories("verid-temporary-", cleanup);
    const dir = directories.create();
    const child = spawn(
      process.execPath,
      ["-e", 'process.stdout.write("ready"); setInterval(() => {}, 1000);'],
      { cwd: dir, stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    const closed = once(child, "close");
    let stop: ReturnType<typeof setTimeout> | undefined;
    try {
      await once(child.stdout, "data");
      // Windows keeps a process's working directory busy until it exits. Cleanup must
      // retry that EBUSY and let the event loop deliver the termination and close events.
      stop = setTimeout(() => child.kill(), 50);
      await directories.cleanup();
      expect(existsSync(dir)).toBe(false);
    } finally {
      clearTimeout(stop);
      child.kill();
      await closed;
      await rm(dir, { recursive: true, force: true, ...cleanup });
    }
  },
);
