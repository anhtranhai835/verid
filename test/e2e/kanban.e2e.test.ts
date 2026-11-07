import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { boardSnapshot, saveBoardDocument } from "../../src/adapters/kanban.js";
import { readState, statePaths } from "../../src/adapters/state-store.js";
import { startBoard } from "../../src/cli/board.js";
import { defaultRoles } from "../../src/core/manifest.js";
import { runCli, runHook } from "./in-process.js";

let project: string;
let server: Awaited<ReturnType<typeof startBoard>> | undefined;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-kanban-"));
  mkdirSync(join(project, ".verid/.state"), { recursive: true });
  mkdirSync(join(project, "test"));
  mkdirSync(join(project, "src"));
  writeFileSync(
    join(project, ".verid/.state/state.json"),
    JSON.stringify({ schemaVersion: 1, language: "en" }),
  );
  writeFileSync(
    join(project, ".verid/manifest.yaml"),
    stringify({
      schemaVersion: 1,
      workflow: "kanban",
      mode: "prep",
      providers: ["codex"],
      roles: defaultRoles(["codex"]),
      architecture: "none",
      repos: [
        {
          path: ".",
          source_globs: ["src/**"],
          test_globs: ["test/**"],
          test_cmd: `"${process.execPath}" "${join(import.meta.dirname, "fake-runner.mjs")}" {junit}`,
        },
      ],
    }),
  );
  writeFileSync(join(project, ".verid/research.md"), "# Research\nAgreed scope\n");
  writeFileSync(join(project, ".verid/design.md"), "# Design\nPure functions\n");
  writeFileSync(
    join(project, ".verid/spec.md"),
    "- REQ-1: Add two numbers\n- REQ-2: Subtract two numbers\n",
  );
});
afterEach(async () => {
  if (server) {
    server.server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.server.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  }
  rmSync(project, { recursive: true, force: true });
});
const state = () => readState(statePaths(project));
const cli = (...args: string[]) => runCli(args, project);
const hook = (event: string, session: string, extra = {}, provider = "codex") =>
  runHook(
    JSON.stringify({
      hook_event_name: event,
      cwd: project,
      session_id: session,
      model: "test",
      transcript_path: null,
      permission_mode: "default",
      turn_id: "turn",
      tool_use_id: "call",
      ...extra,
    }),
    {},
    provider === "codex" ? ["--provider", "codex"] : [],
  );
const patch = (session: string, path: string) =>
  hook("PreToolUse", session, {
    tool_name: "apply_patch",
    tool_input: { command: `*** Begin Patch\n*** Add File: ${path}\n+content\n*** End Patch` },
  });

it("uses developer-selected order and binds a new session, preserving resume and compact", async () => {
  await hook("SessionStart", "planning", { source: "startup" });
  saveBoardDocument(project, "split");
  expect((await cli("order", "req-2")).code).toBe(0);
  expect(state().kanban.active).toMatchObject({ module: "req-2", session: null });
  expect((await patch("planning", "test/subtract.test.ts")).stdout).toContain(
    "VERID_BURNT_TASK_SESSION",
  );
  await hook("SessionStart", "planning", { source: "clear" });
  expect(state().kanban.active?.session).toBeNull();
  const startup = await hook("SessionStart", "task-two", { source: "startup" });
  expect(startup.stdout).toContain("task req-2; ONE TASK PER SESSION");
  expect(state().kanban.active?.session).toBe("codex:task-two");
  expect((await patch("task-two", "test/subtract.test.ts")).stdout).toBe("");
  for (const source of ["resume", "compact", "clear"]) {
    expect((await hook("SessionStart", "task-two", { source })).stdout).toContain("task req-2");
    expect(state().kanban.active?.module).toBe("req-2");
  }
  await hook("SessionStart", "concurrent", { source: "startup" });
  expect((await patch("concurrent", "test/other.test.ts")).stdout).toContain(
    "VERID_BURNT_TASK_SESSION",
  );
  expect((await cli("order", "req-1")).stderr).toContain("VERID_BURNT_MODULE_OPEN");
  expect((await boardSnapshot(project)).tasks.find((task) => task.id === "req-2")?.column).toBe(
    "progress",
  );
});

it("keeps TDD and independent review required, closes one task, and refuses session reuse", async () => {
  saveBoardDocument(project, "split");
  expect((await cli("order", "req-1")).code).toBe(0);
  await hook("SessionStart", "first", { source: "startup" });
  expect((await patch("first", "src/add.ts")).stdout).toContain("VERID_BURNT_TDD_NO_FAILING_TEST");
  expect((await cli("serve", "req-1")).code).toBe(2);
  expect((await patch("first", "test/add.test.ts")).stdout).toBe("");
  writeFileSync(join(project, "test/add.test.ts"), "// AC-1 adds two numbers\n");
  writeFileSync(
    join(project, "scenario.json"),
    JSON.stringify({ exit: 1, junit: "vitest-add-assert.xml", output: "red" }),
  );
  expect((await cli("taste")).code).toBe(1);
  expect((await patch("first", "src/add.ts")).stdout).toBe("");
  writeFileSync(join(project, "src/add.ts"), "export const add = (a, b) => a + b;\n");
  writeFileSync(
    join(project, "scenario.json"),
    JSON.stringify({ exit: 0, junit: "vitest-ac.xml", output: "green" }),
  );
  expect((await cli("taste")).code).toBe(0);
  expect((await cli("serve", "req-1")).stderr).toContain("VERID_BURNT_SERVE_NOT_READY");
  await hook("SubagentStop", "first", {
    agent_id: "review",
    agent_type: "verid_reviewer",
    stop_hook_active: false,
    last_assistant_message: "AC-1 checked against spec, code and tests.\nVerdict: pass",
    agent_transcript_path: null,
  });
  expect(state().review?.verdict).toBe("pass");
  const served = await cli("serve", "req-1");
  expect(served.code, served.stderr).toBe(0);
  expect(state().kanban.active).toBeNull();
  expect((await patch("first", "test/next.test.ts")).stdout).toContain("VERID_BURNT_TASK_SESSION");
  expect((await cli("order", "req-2")).code).toBe(0);
  expect(state().tdd).toMatchObject({ state: "RAW", last_run: null, passed_acs: [] });
  await hook("SessionStart", "first", { source: "startup" });
  expect(state().kanban.active?.session).toBeNull();
  await hook("SessionStart", "second", { source: "startup" });
  expect(state().kanban.active?.session).toBe("codex:second");
});

it("requires reapproval after a changed spec and prevents resetting documents during an open task", async () => {
  saveBoardDocument(project, "split");
  expect(() => saveBoardDocument(project, "split")).toThrow("Đã có plan");
  expect((await cli("order", "req-1")).code).toBe(0);
  await hook("SessionStart", "first", { source: "startup" });
  expect(() => saveBoardDocument(project, "plan", "changed")).toThrow("Đang có task");
  writeFileSync(
    join(project, ".verid/spec.md"),
    "- REQ-1: Add integers\n- REQ-2: Subtract integers\n",
  );
  expect((await patch("first", "test/new.test.ts")).stdout).toContain("Spec đã thay đổi");
  expect((await cli("serve", "req-1")).stderr).toContain("VERID_BURNT_TASK_SESSION");
  expect((await cli("order", "req-1")).code).toBe(0);
  expect(state().kanban.active?.session).toBeNull();
  expect((await patch("first", "test/new.test.ts")).stdout).toContain("VERID_BURNT_TASK_SESSION");
});

it("enforces the same task boundary on Claude Code and does not allow implementation without selection", async () => {
  const manifest = readFileSync(join(project, ".verid/manifest.yaml"), "utf8").replace(
    "- codex",
    "- claude-code",
  );
  writeFileSync(join(project, ".verid/manifest.yaml"), manifest);
  const write = (id: string) =>
    hook(
      "PreToolUse",
      id,
      {
        tool_name: "Write",
        tool_input: { file_path: join(project, "test/calc.test.ts"), content: "test" },
      },
      "claude-code",
    );
  expect((await write("planning")).stderr).toContain("VERID_BURNT_TASK_SESSION");
  saveBoardDocument(project, "split");
  expect((await cli("order", "req-1")).code).toBe(0);
  await hook("SessionStart", "claude-one", { source: "startup" }, "claude-code");
  expect(state().kanban.active?.session).toBe("claude-code:claude-one");
  expect((await write("other")).stderr).toContain("VERID_BURNT_TASK_SESSION");
});

it.each(["plan", "design"])(
  "requires a new task session after the approved %s changes",
  async (document) => {
    saveBoardDocument(project, "split");
    expect((await cli("order", "req-1")).code).toBe(0);
    await hook("SessionStart", "first", { source: "startup" });
    const file = join(project, `.verid/${document}.md`);
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        document === "plan" ? "Title: Add two numbers" : "Pure functions",
        "Changed approved scope",
      ),
    );
    expect((await patch("first", "test/changed.test.ts")).stdout).toContain(
      "Plan hoặc design đã thay đổi",
    );
    expect(
      (await boardSnapshot(project)).tasks.find((task) => task.id === "req-1")?.needsReapproval,
    ).toBe(true);
    expect((await cli("serve", "req-1")).stderr).toContain("VERID_BURNT_TASK_SESSION");
    expect((await cli("order", "req-1")).code).toBe(0);
    expect(state().kanban.active?.session).toBeNull();
    expect((await patch("first", "test/changed.test.ts")).stdout).toContain(
      "VERID_BURNT_TASK_SESSION",
    );
    await hook("SessionStart", "fresh", { source: "startup" });
    expect((await patch("fresh", "test/changed.test.ts")).stdout).toBe("");
  },
);

it("ignores review reports from a session that does not own the selected task", async () => {
  saveBoardDocument(project, "split");
  expect((await cli("order", "req-1")).code).toBe(0);
  await hook("SessionStart", "owner", { source: "startup" });
  await hook("SubagentStop", "old-task", {
    agent_id: "late-review",
    agent_type: "verid_reviewer",
    stop_hook_active: false,
    last_assistant_message: "AC-1 checked.\nVerdict: pass",
    agent_transcript_path: null,
  });
  expect(state().review).toBeNull();
  expect(readFileSync(statePaths(project).audit, "utf8")).toContain("task_subagent_ignored");
});

it("serves a protected local board with real selection and rejects CSRF, stale revisions and premature completion", async () => {
  saveBoardDocument(project, "split");
  server = await startBoard(project, async (command, task) => {
    const result = await cli(command, task);
    return { exit: result.code, stdout: result.stdout, stderr: result.stderr };
  });
  const headers = {
    Authorization: `Bearer ${server.token}`,
    "Content-Type": "application/json",
    Origin: server.origin,
  };
  expect((await fetch(server.origin)).status).toBe(200);
  expect((await fetch(`${server.origin}/api/board`)).status).toBe(401);
  const snapshot = await (await fetch(`${server.origin}/api/board`, { headers })).json();
  expect(snapshot.tasks).toHaveLength(3);
  const post = (input: unknown, custom = headers) =>
    fetch(`${server!.origin}/api/action`, {
      method: "POST",
      headers: custom,
      body: JSON.stringify(input),
    });
  expect(
    (
      await post(
        { action: "select", task: "req-2", revision: snapshot.revision },
        { ...headers, Origin: "https://example.com" },
      )
    ).status,
  ).toBe(403);
  expect((await post({ action: "select", task: "req-2", revision: "old" })).status).toBe(409);
  const selected = await post({ action: "select", task: "req-2", revision: snapshot.revision });
  expect(selected.status, await selected.clone().text()).toBe(200);
  const next = await selected.json();
  expect(next.tasks.find((task: { id: string }) => task.id === "req-2").column).toBe("selected");
  expect(state().kanban.active?.module).toBe("req-2");
  const prompt = await post({ action: "prompt", task: "req-2", revision: next.revision });
  expect((await prompt.json()).prompt).toContain("NEW session for task req-2 only");
  expect((await post({ action: "serve", task: "req-2", revision: next.revision })).status).toBe(
    409,
  );
  await hook("SessionStart", "selected-task", { source: "startup" });
  const owned = await boardSnapshot(project);
  const duplicate = await post({ action: "prompt", task: "req-2", revision: owned.revision });
  expect(duplicate.status).toBe(400);
  expect((await duplicate.json()).error).toContain("Tiếp tục session hiện tại");
});
