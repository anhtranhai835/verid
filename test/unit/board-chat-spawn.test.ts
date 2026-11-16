import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { boardChat, launchFor, windowsArgs } from "../../src/adapters/board-chat.js";
import { kanbanManifest, tempProject } from "../support/project.js";

vi.mock("node:child_process", async (actual) => ({
  ...(await actual<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
const p = tempProject("verid chat spawn ", {
  manifest: () =>
    kanbanManifest().replace("providers:\n  - codex", "providers:\n  - claude-code\n  - codex"),
  state: {
    schemaVersion: 1,
    language: "en",
    kanban: { active: { module: "api", session: null, spec_sha256: "hash" }, sessions: {} },
  },
});

it("uses one validated command string for shell launches and an args array without a shell", async () => {
  const spacedProject = "project with spaces";
  p.put(`${spacedProject}/.verid/manifest.yaml`, p.read(".verid/manifest.yaml"));
  p.put(`${spacedProject}/.verid/.state/state.json`, p.read(".verid/.state/state.json"));
  const rows = [
    { provider: "codex", project: p.root },
    { provider: "claude-code", project: p.root },
    { provider: "claude-code", project: p.path(spacedProject) },
  ] as const;
  for (const { provider, project } of rows) {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
    const launch = launchFor(provider, "PRIVATE_PROMPT", null, project);
    const chat = boardChat(project);
    try {
      await chat.send({ task: "api", provider, text: "PRIVATE_PROMPT" });
      const options = {
        cwd: project,
        shell: process.platform === "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      };
      if (process.platform === "win32")
        expect(vi.mocked(spawn).mock.lastCall).toEqual([
          [launch.command, ...windowsArgs(launch.args)].join(" "),
          options,
        ]);
      else expect(vi.mocked(spawn).mock.lastCall).toEqual([launch.command, launch.args, options]);
      if (provider === "claude-code") {
        const settings = join(project, ".verid", ".state", "board-claude-settings.json");
        if (process.platform === "win32")
          expect(vi.mocked(spawn).mock.lastCall?.[0]).toContain(`--settings "${settings}"`);
        else expect(vi.mocked(spawn).mock.lastCall?.[1]).toContain(settings);
      }
      expect(vi.mocked(spawn).mock.lastCall?.[0]).not.toContain("PRIVATE_PROMPT");
      expect(child.stdin.read()?.toString()).toBe("PRIVATE_PROMPT");
    } finally {
      child.emit("close", 0);
    }
  }
});
