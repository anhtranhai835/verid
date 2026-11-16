import { describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli/main.js";
import { kanbanManifest, tempProject } from "../support/project.js";

// Codex has no attended prompt, so its developer opens an exception from their own terminal.
describe("verid tip from the developer's terminal", () => {
  const p = tempProject("verid-tip-", {
    claudeProject: false,
    manifest: kanbanManifest,
    state: { schemaVersion: 1, language: "en" },
    setup: (p) => {
      vi.stubEnv("CLAUDE_PROJECT_DIR", p.root);
    },
    teardown: () => {
      vi.unstubAllEnvs();
    },
  });
  const denied = (rule: string) =>
    p.seed({
      last_denied: {
        session: "codex-thread",
        tool: "apply_patch",
        target: "test/clean.test.ts",
        input_hash: "abc",
        rule,
        at: "2026-11-16T00:00:00.000Z",
      },
    });

  it("allows the last denied action once, only outside an agent and only for overridable rules", async () => {
    denied("VERID_BURNT_TDD_TEST_FROZEN");
    for (const agent of ["CLAUDECODE", "CODEX_THREAD_ID"]) {
      vi.stubEnv(agent, "1");
      const r = await runCli(["tip", "the cleanup order in AC-1 is wrong"]);
      expect(r.exit, agent).toBe(2);
      expect(r.stderr, agent).toContain("VERID_BURNT_TIP_IN_AGENT");
      vi.stubEnv(agent, "");
    }
    expect(p.state().overrides ?? []).toEqual([]);

    const r = await runCli(["tip", "the cleanup order in AC-1 is wrong"]);
    expect(r.exit, r.stderr).toBe(0);
    expect(r.stdout).toContain("test/clean.test.ts");
    expect(p.state().overrides).toMatchObject([
      {
        session: "codex-thread",
        tool: "apply_patch",
        input_hash: "abc",
        rule: "VERID_BURNT_TDD_TEST_FROZEN",
        reason: "the cleanup order in AC-1 is wrong",
        used: false,
      },
    ]);
    expect(p.audit().at(-1)).toMatchObject({ event: "override_created", via: "terminal" });

    denied("VERID_BURNT_STATE_PROTECTED");
    const invariant = await runCli(["tip", "please"]);
    expect(invariant.exit).toBe(2);
    expect(invariant.stderr).toContain("VERID_BURNT_OVERRIDE_FORBIDDEN");
    expect((await runCli(["tip"])).exit).toBe(2);
  });
});
