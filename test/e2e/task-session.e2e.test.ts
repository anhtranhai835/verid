import { tempProject, kanbanManifest } from "../support/project.js";
import { readyModulePlan } from "./helpers.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { statePaths } from "../../src/adapters/state-store.js";

let project: string;
const t = tempProject("verid-task-session-", {
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
});
const { loadState: state, cli, sessionEvent: hook } = t;

async function createModules() {
  t.put(
    ".verid/plan.md",
    "## Module: req-1\nTitle: Add two numbers\nArtifacts: .verid/artifacts/03-modules/req-1\n- AC-1: Add two numbers (REQ-1)\n\n## Module: req-2\nTitle: Subtract two numbers\nArtifacts: .verid/artifacts/03-modules/req-2\n- AC-2: Subtract two numbers (REQ-2)\n\n## Module: product\nArtifacts: .verid/artifacts/03-modules/product\nDepends: req-1, req-2\n- AC-3 (e2e): Verify the complete product (REQ-1, REQ-2)\n",
  );
  for (const name of ["req-1", "req-2", "product"])
    expect((await cli("module", name)).code).toBe(0);
  readyModulePlan(project, t.read(".verid/plan.md"));
}

const patch = (session: string, path: string) =>
  hook("PreToolUse", session, {
    tool_name: "apply_patch",
    tool_input: { command: `*** Begin Patch\n*** Add File: ${path}\n+content\n*** End Patch` },
  });

it("protects the developer's mockup choice while allowing HTML drafts", async () => {
  await createModules();
  const base = ".verid/artifacts/03-modules/req-1/ui/mockups";
  expect((await patch("planning", `${base}/option-a.html`)).stdout).toBe("");
  expect((await patch("planning", `${base}/choice.json`)).stdout).toContain(
    "VERID_BURNT_STATE_PROTECTED",
  );
});

it("requires reapproval and a fresh session after the developer changes a mockup choice", async () => {
  await createModules();
  const base = ".verid/artifacts/03-modules/req-1/ui/mockups";
  t.put(`${base}/choice.json`, JSON.stringify({ choice: "option-a", note: "", at: "2026-01-01" }));
  expect((await cli("order", "req-1")).code).toBe(0);
  await hook("SessionStart", "selected", { source: "startup" });
  expect((await patch("selected", "test/new.test.ts")).stdout).toBe("");
  t.put(
    `${base}/choice.json`,
    JSON.stringify({ choice: "option-b", note: "spacing", at: "2026-01-02" }),
  );
  expect((await patch("selected", "test/new.test.ts")).stdout).toContain(
    "VERID_BURNT_TASK_SESSION",
  );
  expect((await cli("order", "req-1")).code).toBe(0);
  expect(state().kanban.active?.session).toBeNull();
  expect((await patch("selected", "test/new.test.ts")).stdout).toContain(
    "VERID_BURNT_TASK_SESSION",
  );
  await hook("SessionStart", "fresh-choice", { source: "startup" });
  expect((await patch("fresh-choice", "test/new.test.ts")).stdout).toBe("");
});

it("reports usage after a blocked write and a red to green cycle without storing output", async () => {
  await createModules();
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
  await createModules();
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
});

it("keeps TDD and independent review required, closes one task, and refuses session reuse", async () => {
  await createModules();
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

it("requires reapproval and refuses the old task session after a changed spec", async () => {
  await createModules();
  expect((await cli("order", "req-1")).code).toBe(0);
  await hook("SessionStart", "first", { source: "startup" });
  writeFileSync(
    join(project, ".verid/spec.md"),
    "- REQ-1: Add integers\n- REQ-2: Subtract integers\n",
  );
  expect((await patch("first", "test/new.test.ts")).stdout).toContain("The spec changed");
  expect((await cli("serve", "req-1")).stderr).toContain("VERID_BURNT_TASK_SESSION");
  expect((await cli("order", "req-1")).code).toBe(0);
  expect(state().kanban.active?.session).toBeNull();
  expect((await patch("first", "test/new.test.ts")).stdout).toContain("VERID_BURNT_TASK_SESSION");
  await hook("SessionStart", "fresh-spec", { source: "startup" });
  expect((await patch("fresh-spec", "test/new.test.ts")).stdout).toBe("");
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
  await createModules();
  expect((await cli("order", "req-1")).code).toBe(0);
  await hook("SessionStart", "claude-one", { source: "startup" }, "claude-code");
  expect(state().kanban.active?.session).toBe("claude-code:claude-one");
  expect((await write("other")).stderr).toContain("VERID_BURNT_TASK_SESSION");
});

it("requires a new task session after the approved plan or design changes", async () => {
  for (const document of ["plan", "design"]) {
    t.fresh();
    await createModules();
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
    expect((await cli("serve", "req-1")).stderr).toContain("VERID_BURNT_TASK_SESSION");
    expect((await cli("order", "req-1")).code).toBe(0);
    expect(state().kanban.active?.session).toBeNull();
    expect((await patch("first", "test/changed.test.ts")).stdout).toContain(
      "VERID_BURNT_TASK_SESSION",
    );
    await hook("SessionStart", "fresh", { source: "startup" });
    expect((await patch("fresh", "test/changed.test.ts")).stdout).toBe("");
  }
});

it("ignores review reports from a session that does not own the selected task", async () => {
  await createModules();
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
