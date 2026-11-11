import { describe, expect, it, vi } from "vitest";
import { usageReport } from "../../src/core/usage.js";
import { tempProject, kanbanManifest } from "../support/project.js";
import { runCli } from "../../src/cli/main.js";
import { boardSnapshot, saveBoardDocument } from "../../src/adapters/kanban.js";
import { appendAudit } from "../../src/adapters/audit-log.js";
import { statePaths, withLock } from "../../src/adapters/state-store.js";
import { boardHtml } from "../../src/cli/board-page.js";

describe("usage ledger", () => {
  it("groups counters, unique sessions and provider tokens by module", () => {
    const events = [
      { event: "session_start", module: "api", session: "one", provider: "codex", chars: 120 },
      { event: "session_start", module: "api", session: "one", provider: "codex", chars: 30 },
      {
        event: "session_start",
        module: "api",
        session: "one",
        provider: "claude-code",
        chars: 40,
      },
      { event: "test_run", module: "api", chars: 50 },
      { event: "test_run", module: "api", chars: 60 },
      { event: "denied", module: "api", rule: "VERID_BURNT_TDD_NO_FAILING_TEST", chars: 70 },
      { event: "stop_blocked", module: "api", chars: 80 },
      { event: "subagent_stop_blocked", module: "api", chars: 10 },
      {
        event: "usage_recorded",
        module: "api",
        provider: "codex",
        input: 100,
        cached: 40,
        output: 20,
      },
      {
        event: "usage_recorded",
        module: "api",
        provider: "claude-code",
        input: 200,
        cached: 50,
        output: 30,
      },
      { event: "module_served", module: "api" },
    ];
    expect(usageReport(events)).toEqual([
      {
        module: "api",
        sessions: 2,
        taste: 2,
        denied: 1,
        stopBlocked: 2,
        chars: 460,
        tokens: { input: 300, cached: 90, output: 50, total: 350 },
      },
    ]);
  });

  it("keeps unknown tokens null, unassigned events in planning and old logs readable", () => {
    expect(
      usageReport([
        { event: "session_start", session: "old" },
        { event: "denied", rule: "OLD_RULE" },
        { event: "work_started", module: "ui" },
        { event: "test_run" },
        { event: "module_served", module: "ui" },
        { event: "unrelated", chars: 999 },
      ]),
    ).toEqual([
      {
        module: "planning",
        sessions: 1,
        taste: 1,
        denied: 1,
        stopBlocked: 0,
        chars: 0,
        tokens: null,
      },
      { module: "ui", sessions: 0, taste: 0, denied: 0, stopBlocked: 0, chars: 0, tokens: null },
    ]);
  });

  it("preserves reported zero usage", () => {
    expect(
      usageReport([
        { event: "session_start", module: "api", session: "one", provider: "codex", chars: 5 },
        {
          event: "usage_recorded",
          module: "api",
          provider: "codex",
          input: 0,
          cached: 0,
          output: 0,
        },
      ]),
    ).toEqual([
      {
        module: "api",
        sessions: 1,
        taste: 0,
        denied: 0,
        stopBlocked: 0,
        chars: 5,
        tokens: { input: 0, cached: 0, output: 0, total: 0 },
      },
    ]);
  });
});

describe("usage views", () => {
  const p = tempProject("verid-usage-", {
    claudeProject: false,
    payload: {
      model: "test",
      transcript_path: null,
      permission_mode: "default",
      turn_id: "turn",
      tool_use_id: "call",
    },
    manifest: kanbanManifest,
    state: { schemaVersion: 1, language: "en" },
    setup: (p) => {
      p.put(".verid/spec.md", "- REQ-1: Add numbers\n");
      saveBoardDocument(p.root, "split");
      vi.stubEnv("CLAUDE_PROJECT_DIR", p.root);
    },
    teardown: () => {
      vi.unstubAllEnvs();
    },
  });

  it("shows the same totals on cards and in JSON without changing state or audit", async () => {
    const paths = statePaths(p.root);
    withLock(paths, () => {
      appendAudit(paths.audit, {
        event: "session_start",
        module: "req-1",
        session: "one",
        provider: "codex",
        chars: 100,
      });
      appendAudit(paths.audit, {
        event: "usage_recorded",
        module: "req-1",
        provider: "codex",
        input: 30,
        cached: 20,
        output: 4,
      });
      appendAudit(paths.audit, {
        event: "usage_recorded",
        module: "req-1",
        provider: "codex",
        input: 50,
        cached: 40,
        output: 6,
      });
    });
    const before = [p.read(".verid/.state/state.json"), p.read(".verid/.state/audit.jsonl")];
    const result = await runCli(["usage", "req-1", "--json"]);
    expect(result.exit).toBe(0);
    const [row] = JSON.parse(result.stdout);
    expect(row.tokens).toEqual({ input: 80, cached: 60, output: 10, total: 90 });
    const snapshot = await boardSnapshot(p.root);
    expect(snapshot.tasks.find((t) => t.id === "req-1")?.usage).toEqual(row);
    expect(snapshot.tasks.find((t) => t.id === "product")?.usage).toBeNull();
    expect((await runCli(["usage", "--json", "missing"])).stdout.trim()).toBe("[]");
    expect((await runCli(["usage"])).stdout).toContain("80/60/10 (90)");
    expect([p.read(".verid/.state/state.json"), p.read(".verid/.state/audit.jsonl")]).toEqual(
      before,
    );
  });

  it("shows unknown tokens explicitly and rejects extra arguments", async () => {
    const paths = statePaths(p.root);
    withLock(paths, () => appendAudit(paths.audit, { event: "test_run", module: "req-1" }));
    expect((await runCli(["usage"])).stdout).toContain("unavailable");
    for (const args of [["--bad"], ["a", "b"], ["--json", "--json"], ["-x"]])
      expect((await runCli(["usage", ...args])).exit).toBe(2);
  });

  it("counts a repeated session start once and measures its stop hold", async () => {
    p.put(
      ".verid/manifest.yaml",
      "schemaVersion: 1\nmode: remix\nproviders: [codex]\nrepos:\n  - path: .\n    source_globs: [src/**]\n    test_globs: [test/**]\n",
    );
    const startup = await p.sessionEvent("SessionStart", "one", { source: "startup" });
    expect(startup.code, startup.stdout + startup.stderr).toBe(0);
    await p.sessionEvent("SessionStart", "one", { source: "resume" });
    p.seed({ tdd: { ...p.loadState().tdd, dirty: true } });
    const stopped = await p.sessionEvent("Stop", "one", {
      stop_hook_active: false,
      last_assistant_message: "done",
    });
    const events = p.audit();
    const contexts = events.filter((e) => e.event === "session_start");
    expect(contexts, startup.stdout + startup.stderr + JSON.stringify(events)).toHaveLength(2);
    const report = usageReport(events);
    expect(report[0]?.sessions).toBe(1);
    expect(report[0]?.stopBlocked, stopped.stdout + stopped.stderr + JSON.stringify(events)).toBe(
      1,
    );
    expect(events.find((e) => e.event === "stop_blocked")?.chars).toBeGreaterThan(0);
  });

  it("labels cards without reported tokens in readable Vietnamese", () => {
    expect(boardHtml("vi")).toContain('"tokens_none":"Token: không có"');
  });
});
