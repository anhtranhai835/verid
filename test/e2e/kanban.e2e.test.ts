import { tempProject, kanbanManifest } from "../support/project.js";
import { readyModulePlan } from "./helpers.js";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { join } from "node:path";
import { expect, it } from "vitest";

import type { Launch } from "../../src/adapters/board-chat.js";
import { boardSnapshot, saveBoardDocument } from "../../src/adapters/kanban.js";
import { statePaths } from "../../src/adapters/state-store.js";
import { startBoard } from "../../src/cli/board.js";

let project: string;
let server: Awaited<ReturnType<typeof startBoard>> | undefined;
const t = tempProject("verid-kanban-", {
  cwd: () => project,
  claudeProject: false,
  review: true,
  state: { schemaVersion: 1, language: "en" },
  manifest: kanbanManifest,
  payload: {
    model: "test",
    transcript_path: null,
    permission_mode: "default",
    turn_id: "turn",
    tool_use_id: "call",
  },
  bind: (p) => {
    project = p.root;
  },
  setup: (p) => {
    mkdirSync(p.path("src"));
    mkdirSync(p.path("test"));
    p.put(".verid/research.md", "# Research\nAgreed scope\n");
    p.put(".verid/design.md", "# Design\nPure functions\n");
    p.put(".verid/spec.md", "- REQ-1: Add two numbers\n- REQ-2: Subtract two numbers\n");
  },
  teardown: async () => {
    if (server) {
      server.server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server!.server.close((error) => (error ? reject(error) : resolve())),
      );
      server = undefined;
    }
  },
});
const { loadState: state, cli, sessionEvent: hook } = t;

const split = () => {
  saveBoardDocument(project, "split");
  const file = join(project, ".verid/plan.md");
  readyModulePlan(project, readFileSync(file, "utf8"));
};

const patch = (session: string, path: string) =>
  hook("PreToolUse", session, {
    tool_name: "apply_patch",
    tool_input: { command: `*** Begin Patch\n*** Add File: ${path}\n+content\n*** End Patch` },
  });

it("reports usage after a blocked write and a red to green cycle without storing output", async () => {
  split();
  await cli("order", "req-1");
  await hook("SessionStart", "usage-task", { source: "startup" });
  await patch("usage-task", "src/add.ts");
  await patch("usage-task", "test/add.test.ts");
  t.put("test/add.test.ts", "// AC-1 adds two numbers\n");
  t.put(
    "scenario.json",
    JSON.stringify({ exit: 1, junit: "vitest-add-assert.xml", output: "PRIVATE_TEST_OUTPUT" }),
  );
  expect((await cli("taste")).code).toBe(1);
  await patch("usage-task", "src/add.ts");
  t.put("src/add.ts", "export const add = (a, b) => a + b;\n");
  t.put(
    "scenario.json",
    JSON.stringify({ exit: 0, junit: "vitest-ac.xml", output: "PRIVATE_TEST_OUTPUT" }),
  );
  expect((await cli("taste")).code).toBe(0);
  const before = t.read(".verid/.state/state.json");
  const audit = t.read(".verid/.state/audit.jsonl");
  const result = await cli("usage", "req-1", "--json");
  expect(result.code, result.stderr).toBe(0);
  const [row] = JSON.parse(result.stdout);
  expect(row).toMatchObject({
    module: "req-1",
    sessions: 1,
    taste: 2,
    denied: 1,
    stopBlocked: 0,
    tokens: null,
  });
  expect(row.chars).toBeGreaterThan(0);
  expect((await cli("usage")).stdout).toContain("unavailable");
  expect((await cli("usage", "missing", "--json")).stdout.trim()).toBe("[]");
  expect(t.read(".verid/.state/state.json")).toBe(before);
  expect(t.read(".verid/.state/audit.jsonl")).toBe(audit);
  expect(audit).not.toContain("PRIVATE_TEST_OUTPUT");
});

it("uses developer-selected order and binds a new session, preserving resume and compact", async () => {
  await hook("SessionStart", "planning", { source: "startup" });
  split();
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
  split();
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
  split();
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
  split();
  expect((await cli("order", "req-1")).code).toBe(0);
  await hook("SessionStart", "claude-one", { source: "startup" }, "claude-code");
  expect(state().kanban.active?.session).toBe("claude-code:claude-one");
  expect((await write("other")).stderr).toContain("VERID_BURNT_TASK_SESSION");
});

it.each(["plan", "design"])(
  "requires a new task session after the approved %s changes",
  async (document) => {
    split();
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
  split();
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
  split();
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

it("chats with the selected task's AI from the board: new session first, then the bound one", async () => {
  split();
  const launches: Launch[] = [];
  // Stands in for the provider CLI: names its thread, echoes the prompt it read on stdin.
  const fake = `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.stringify({type:"thread.started",thread_id:"t-1"}));console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"got "+s}}))})`;
  server = await startBoard(
    project,
    async (command, task) => {
      const result = await cli(command, task);
      return { exit: result.code, stdout: result.stdout, stderr: result.stderr };
    },
    0,
    (launch, cwd) => {
      launches.push(launch);
      return spawn(process.execPath, ["-e", fake], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    },
  );
  const headers = {
    Authorization: `Bearer ${server.token}`,
    "Content-Type": "application/json",
    Origin: server.origin,
  };
  const post = (input: unknown) =>
    fetch(`${server!.origin}/api/action`, { method: "POST", headers, body: JSON.stringify(input) });
  const status = async () => (await fetch(`${server!.origin}/api/chat`, { headers })).json();
  const idle = async () => {
    for (let i = 0; i < 100 && (await status()).running; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    return status();
  };
  const chat = (text: string) => post({ action: "chat", task: "req-1", text, provider: "codex" });

  const early = await chat("start");
  expect(early.status).toBe(409);
  expect((await early.json()).error).toContain("Chọn task");
  const board = await (await fetch(`${server.origin}/api/board`, { headers })).json();
  expect((await post({ action: "select", task: "req-1", revision: board.revision })).status).toBe(
    200,
  );
  expect(
    (await post({ action: "chat", task: "req-1", text: "x", provider: "claude-code" })).status,
  ).toBe(400);

  expect((await chat("build req-1")).status).toBe(200);
  const first = await idle();
  expect(launches[0]!.args).not.toContain("resume");
  expect(launches[0]!.stdin).toBe("build req-1");
  expect(first.lines).toEqual(
    expect.arrayContaining([
      { role: "you", text: "build req-1" },
      { role: "ai", text: "got build req-1" },
    ]),
  );
  // verid's own SessionStart hook binds the new thread to the task, as the real CLI's would.
  await hook("SessionStart", "t-1", { source: "startup" });
  expect(state().kanban.active?.session).toBe("codex:t-1");
  expect((await status()).locked).toBe("codex");

  expect((await chat("continue")).status).toBe(200);
  await idle();
  expect(launches[1]!.args.slice(0, 2)).toEqual(["exec", "resume"]);
  expect(launches[1]!.args).toContain("t-1");
});
