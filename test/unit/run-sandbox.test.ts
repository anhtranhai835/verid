import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Codex's Windows workspace-write sandbox refuses every process verid starts: spawn throws EPERM.
vi.mock("node:child_process", async (actual) => ({
  ...(await actual<typeof import("node:child_process")>()),
  spawn: () => {
    throw Object.assign(new Error("spawn EPERM"), { code: "EPERM", syscall: "spawn" });
  },
}));

const { runCommand } = await import("../../src/adapters/test-runner.js");

describe("runCommand in a sandbox that blocks processes", () => {
  it("names the sandbox instead of failing as an internal error", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "verid-sandbox-")), "run.log");
    await expect(runCommand("npm test", tmpdir(), log, 1000)).rejects.toMatchObject({
      code: "VERID_BURNT_RUN_SANDBOXED",
    });
  });
});
