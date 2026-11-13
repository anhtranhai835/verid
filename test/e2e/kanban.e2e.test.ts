import { tempProject, kanbanManifest } from "../support/project.js";
import { readyModulePlan } from "./helpers.js";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { join } from "node:path";
import { expect, it, vi } from "vitest";

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

it("protects the developer's mockup choice while allowing HTML drafts", async () => {
  split();
  const base = ".verid/artifacts/03-modules/req-1/ui/mockups";
  expect((await patch("planning", `${base}/option-a.html`)).stdout).toBe("");
  expect((await patch("planning", `${base}/choice.json`)).stdout).toContain(
    "VERID_BURNT_STATE_PROTECTED",
  );
});

it("requires reapproval and a fresh session after the developer changes a mockup choice", async () => {
  split();
  const base = ".verid/artifacts/03-modules/req-1/ui/mockups";
  t.put(`${base}/choice.json`, JSON.stringify({ choice: "option-a", note: "", at: "2026-01-01" }));
  expect((await cli("order", "req-1")).code).toBe(0);
  await hook("SessionStart", "selected", { source: "startup" });
  expect((await patch("selected", "test/new.test.ts")).stdout).toBe("");
  t.put(
    `${base}/choice.json`,
    JSON.stringify({ choice: "option-b", note: "spacing", at: "2026-01-02" }),
  );
  expect(
    (await boardSnapshot(project)).tasks.find((task) => task.id === "req-1")?.needsReapproval,
  ).toBe(true);
  expect((await patch("selected", "test/new.test.ts")).stdout).toContain(
    "VERID_BURNT_TASK_SESSION",
  );
  expect((await cli("order", "req-1")).code).toBe(0);
  expect(state().kanban.active?.session).toBeNull();
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
  expect(startup.stdout).toContain("Run verid context req-2 first");
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

it("refuses a document it cannot use, in the project's language", () => {
  const spec = (text: string) => writeFileSync(join(project, ".verid/spec.md"), text);
  const rows = [
    ["# Spec without requirements\n", "The spec needs requirements"],
    ["- REQ-1: Add\n- REQ-1: Add again\n", "requirement REQ-1 twice"],
    ["- REQ-1: Add [NEEDS CLARIFICATION: which numbers]\n", "NEEDS CLARIFICATION"],
  ] as const;
  for (const [text, message] of rows) {
    spec(text);
    expect(() => saveBoardDocument(project, "split"), text).toThrow(message);
  }
  spec("- REQ-1: Add two numbers\n- REQ-2: Subtract two numbers\n");
  expect(() => saveBoardDocument(project, "plan", " \n")).toThrow("must not be empty");
  expect(() => saveBoardDocument(project, "plan", "## Module: add\n\nTitle: Add\n")).toThrow(
    "at least one acceptance criterion",
  );
  expect(() =>
    saveBoardDocument(
      project,
      "plan",
      "## Module: add\n\nTitle: Add\n\n- AC-1: Adds (REQ-1, REQ-9)\n",
    ),
  ).toThrow("No AC yet for: REQ-2. IDs not in the spec: REQ-9.");
});

it("requires reapproval after a changed spec and prevents resetting documents during an open task", async () => {
  split();
  expect(() => saveBoardDocument(project, "split")).toThrow("A plan already exists");
  expect((await cli("order", "req-1")).code).toBe(0);
  await hook("SessionStart", "first", { source: "startup" });
  expect(() => saveBoardDocument(project, "plan", "changed")).toThrow("A task is open");
  writeFileSync(
    join(project, ".verid/spec.md"),
    "- REQ-1: Add integers\n- REQ-2: Subtract integers\n",
  );
  expect((await patch("first", "test/new.test.ts")).stdout).toContain("The spec changed");
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
      "The plan or design changed",
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
    const result = await cli(command, ...(task ? [task] : []));
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
  expect((await duplicate.json()).error).toContain("already has an AI session");
});

it("opens the browser with a one-time link, never the API token another process could read", async () => {
  split();
  server = await startBoard(project, async () => ({ exit: 0, stdout: "", stderr: "" }));
  // The link goes on the browser's command line and in the terminal, where a local process sees it.
  expect(server.url).not.toContain(server.token);
  const code = new URL(server.url).searchParams.get("open");
  expect(code).toMatch(/^[0-9a-f]{32,}$/);
  const read = (headers: Record<string, string>) =>
    fetch(`${server!.origin}/api/board`, { headers });
  expect((await read({ Authorization: `Bearer ${code}` })).status).toBe(401);
  const opened = await fetch(server.url, { redirect: "manual" });
  expect(opened.status).toBe(303);
  const cookie = opened.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Strict/i);
  expect((await read({ Cookie: cookie.split(";")[0]! })).status).toBe(200);
  // A second reader of the same link gets no credential.
  const again = await fetch(server.url, { redirect: "manual" });
  expect(again.status).toBe(403);
  expect(again.headers.get("set-cookie")).toBeNull();
  expect((await read({ Cookie: "verid_board=wrong" })).status).toBe(401);
});

it("serves the board and its task reasons in the project's language", async () => {
  split();
  expect((await cli("order", "req-1")).code).toBe(0);
  server = await startBoard(project, async () => ({ exit: 0, stdout: "", stderr: "" }));
  const page = await (await fetch(server.origin)).text();
  expect(page).toContain('<html lang="en">');
  expect(page).not.toMatch(/[À-ỹ]/);
  const reasons = (await boardSnapshot(project)).tasks.map((task) => task.reason ?? "");
  expect(reasons.join("\n")).toContain("Finish req-1 before selecting the next task");
  expect(reasons.join("\n")).not.toMatch(/[À-ỹ]/);
  const denied = await fetch(`${server.origin}/api/board`);
  expect((await denied.json()).error).not.toMatch(/[À-ỹ]/);
});

// What the board runs for order and serve: the real CLI. Signing passes no task.
const runCli = async (command: "order" | "serve", task?: string) => {
  const result = await cli(command, ...(task ? [task] : []));
  return { exit: result.code, stdout: result.stdout, stderr: result.stderr };
};
const noBrain = () =>
  t.put(".verid/manifest.yaml", `${t.read(".verid/manifest.yaml")}drive: no-brain\n`);
const api = (board: NonNullable<typeof server>) => {
  const headers = {
    Authorization: `Bearer ${board.token}`,
    "Content-Type": "application/json",
    Origin: board.origin,
  };
  return {
    post: (input: unknown) =>
      fetch(`${board.origin}/api/action`, { method: "POST", headers, body: JSON.stringify(input) }),
    get: (path: string) => fetch(`${board.origin}${path}`, { headers }),
  };
};
// Stands in for the provider CLI: names its thread, echoes the prompt it read on stdin.
const fakeChat = (launches: Launch[]) => (launch: Launch, cwd: string) => {
  launches.push(launch);
  const script = `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.stringify({type:"thread.started",thread_id:"t-1"}));console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"got "+s}}))})`;
  return spawn(process.execPath, ["-e", script], { cwd, stdio: ["pipe", "pipe", "pipe"] });
};

it("gives big-brain drive no board chat and no sign button: the developer signs in a terminal", async () => {
  split();
  const launches: Launch[] = [];
  server = await startBoard(project, runCli, 0, fakeChat(launches));
  const { post, get } = api(server);
  const board = await (await get("/api/board")).json();
  expect((await post({ action: "select", task: "req-1", revision: board.revision })).status).toBe(
    200,
  );
  expect((await get("/api/chat")).status).toBe(409);
  const chat = await post({ action: "chat", task: "req-1", text: "build", provider: "codex" });
  expect(chat.status).toBe(409);
  expect(launches).toEqual([]);
  const now = await boardSnapshot(project);
  expect((await post({ action: "sign", revision: now.revision })).status).toBe(409);
  expect(state().auto.signed).toBeNull();
  expect(state().kanban.active?.module).toBe("req-1");
});

it("shows spec and plan read-only: the board refuses to write them", async () => {
  split();
  server = await startBoard(project, runCli);
  const { post } = api(server);
  const before = ["spec", "plan"].map((file) => t.read(`.verid/${file}.md`));
  const { revision } = await boardSnapshot(project);
  for (const action of ["spec", "plan"]) {
    const refused = await post({ action, content: "- REQ-1: changed\n", revision });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain("read-only");
  }
  expect(["spec", "plan"].map((file) => t.read(`.verid/${file}.md`))).toEqual(before);
  const page = await (await fetch(server.origin)).text();
  expect(page).not.toContain('id="save-doc"');
  expect(page).toMatch(/<textarea[^>]*id="editor"[^>]*readonly/);
});

it("signs research and design from the no-brain board as verid order does, and refuses without them", async () => {
  noBrain();
  split();
  rmSync(join(project, ".verid/research.md"));
  server = await startBoard(project, runCli);
  const { post } = api(server);
  let board = await boardSnapshot(project);
  expect(board.drive).toBe("auto");
  expect(board.documents).toMatchObject({ research: "", design: expect.stringContaining("Pure") });
  const missing = await post({ action: "sign", revision: board.revision });
  expect(missing.status).toBe(409);
  expect((await missing.json()).error).toContain("research.md");
  expect(state().auto.signed).toBeNull();

  t.put(".verid/research.md", "# Research\nAgreed scope\n");
  t.put(".verid/summary.md", "# What you sign\nPlain words for the owner\n");
  board = await boardSnapshot(project);
  expect(board.documents?.summary).toContain("Plain words for the owner");
  expect(board.signed).toBe(false);
  const signed = await post({ action: "sign", revision: board.revision });
  expect(signed.status, await signed.clone().text()).toBe(200);
  expect((await signed.json()).signed).toBe(true);
  const fromBoard = state().auto.signed;
  expect(fromBoard).toMatchObject({
    research_sha256: expect.any(String),
    design_sha256: expect.any(String),
  });
  // The terminal's verid order records the same signature for the same documents.
  expect((await cli("order")).code).toBe(0);
  expect({ ...state().auto.signed, at: fromBoard!.at }).toEqual(fromBoard);
});

it("chats on the no-brain board in one queue session: new session first, then the same one", async () => {
  noBrain();
  split();
  const launches: Launch[] = [];
  server = await startBoard(project, runCli, 0, fakeChat(launches));
  const { post, get } = api(server);
  const status = async () => (await get("/api/chat")).json();
  const idle = async () => {
    for (let i = 0; i < 100 && (await status()).running; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    return status();
  };
  const chat = (text: string) => post({ action: "chat", text, provider: "codex" });
  expect((await post({ action: "chat", text: "x", provider: "claude-code" })).status).toBe(400);

  expect((await chat("build a calculator")).status).toBe(200);
  const first = await idle();
  expect(launches[0]!.args).not.toContain("resume");
  expect(launches[0]!.stdin).toBe("build a calculator");
  expect(first.lines).toEqual(
    expect.arrayContaining([
      { role: "you", text: "build a calculator" },
      { role: "ai", text: "got build a calculator" },
    ]),
  );
  expect(first.task).toBeNull();

  expect((await chat("continue")).status).toBe(200);
  await idle();
  expect(launches[1]!.args.slice(0, 2)).toEqual(["exec", "resume"]);
  expect(launches[1]!.args).toContain("t-1");
});

it("starts the AI on a card dragged into Cooking, and refuses a card that is not on the board", async () => {
  noBrain();
  split();
  const launches: Launch[] = [];
  server = await startBoard(project, runCli, 0, fakeChat(launches));
  const { post, get } = api(server);
  const board = await boardSnapshot(project);
  const task = board.tasks[0]!;
  expect((await post({ action: "run", task: "nope", provider: "codex" })).status).toBe(409);
  const run = await post({ action: "run", task: task.id, provider: "codex" });
  expect(run.status, await run.clone().text()).toBe(200);
  expect(launches).toHaveLength(1);
  expect(launches[0]!.stdin).toContain(`verid context ${task.id}`);
  for (let i = 0; i < 100 && (await (await get("/api/chat")).json()).running; i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
});

it("refuses sign to a caller without the board's credential, including one holding the launch link", async () => {
  noBrain();
  split();
  server = await startBoard(project, runCli);
  const code = new URL(server.url).searchParams.get("open");
  const body = JSON.stringify({
    action: "sign",
    revision: (await boardSnapshot(project)).revision,
  });
  const sign = (auth: Record<string, string>) =>
    fetch(`${server!.origin}/api/action`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json", Origin: server!.origin },
      body,
    });
  for (const auth of [{}, { Authorization: `Bearer ${code}` }, { Cookie: `verid_board=${code}` }])
    expect((await sign(auth)).status).toBe(401);
  // The browser took the link first; whoever reads it from a process list later gets nothing.
  expect((await fetch(server.url, { redirect: "manual" })).status).toBe(303);
  const late = await fetch(server.url, { redirect: "manual" });
  expect(late.headers.get("set-cookie")).toBeNull();
  expect(state().auto.signed).toBeNull();
  // An agent's own shell cannot start a board of its own.
  vi.stubEnv("CLAUDECODE", "1");
  try {
    await expect(startBoard(project, runCli)).rejects.toThrow("verid board");
  } finally {
    vi.unstubAllEnvs();
  }
});

it("draws the no-brain kitchen with the waiter explaining a real hook denial; big-brain stays plain", async () => {
  split();
  server = await startBoard(project, runCli);
  const plain = await (await fetch(server.origin)).text();
  expect(plain).not.toContain('id="kitchen"');
  expect((await boardSnapshot(project)).kitchen).toBeNull();

  noBrain();
  await hook("SessionStart", "kitchen", { source: "startup" });
  await patch("kitchen", "src/add.ts");
  const rule = state().last_denied?.rule;
  expect(rule).toMatch(/^VERID_BURNT_/);
  const page = await (await fetch(server.origin)).text();
  expect(page).toContain('id="kitchen"');
  const { kitchen } = await boardSnapshot(project);
  // Research and design are on the table, unsigned: the waiter has the floor.
  expect(kitchen?.role).toBe("waiter");
  expect(kitchen?.waiter?.say).toContain(rule);
  expect(kitchen?.waiter?.next).toBeTruthy();
  expect(kitchen?.pass.length).toBeGreaterThan(0);
  expect(new Set(kitchen?.pass.map((plate) => plate.station))).toEqual(new Set(["order"]));
});
