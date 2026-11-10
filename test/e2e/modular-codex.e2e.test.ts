import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { developerEnv } from "./helpers.js";
import { MODULE_INPUTS } from "../../src/adapters/plan-file.js";

const CLI = join(import.meta.dirname, "../../dist/cli.js");
const RUNNER = join(import.meta.dirname, "fake-runner.mjs");
let project: string;
let taskSession = "repo-codex-session";
let taskNumber = 0;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid modular codex-"));
});
afterEach(() => rmSync(project, { recursive: true, force: true }));
const env = () => ({ ...developerEnv("CODEX"), CODEX_HOME: join(project, "user-codex") });
const cli = (...args: string[]) => {
  const result = spawnSync(
    process.execPath,
    [
      existsSync(join(project, ".verid/verid.mjs")) ? join(project, ".verid/verid.mjs") : CLI,
      ...args,
    ],
    { cwd: project, env: env(), encoding: "utf8" },
  );
  if (args[0] === "order" && result.status === 0) {
    taskSession = "task-calculator-" + ++taskNumber;
    hook("SessionStart", { source: "startup" });
  }
  return result;
};
const put = (rel: string, content: string) => {
  mkdirSync(dirname(join(project, rel)), { recursive: true });
  writeFileSync(join(project, rel), content);
};
const state = () => JSON.parse(readFileSync(join(project, ".verid/.state/state.json"), "utf8"));
const hook = (event: string, extra = {}) =>
  spawnSync(process.execPath, [join(project, ".verid/hooks/hook.js"), "--provider", "codex"], {
    cwd: project,
    env: env(),
    encoding: "utf8",
    input: JSON.stringify({
      hook_event_name: event,
      session_id: taskSession,
      cwd: project,
      model: "gpt-6.1-sol",
      transcript_path: null,
      permission_mode: "default",
      turn_id: "repo-turn",
      tool_use_id: "repo-call",
      agent_transcript_path: null,
      ...extra,
    }),
  });
const patch = (path: string) =>
  hook("PreToolUse", {
    tool_name: "apply_patch",
    tool_input: { command: `*** Begin Patch\n*** Add File: ${path}\n+content\n*** End Patch` },
  });
const reason = (result: ReturnType<typeof hook>) => {
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason as string;
};

it("runs the built repo hook on Codex through module order, RED/GREEN and a read-only review", () => {
  const cooked = cli(
    "cook",
    "--yes",
    "--mode",
    "prep",
    "--provider",
    "codex",
    "--workflow",
    "modular",
    "--resources",
    "repo",
    "--test-cmd",
    `"${process.execPath}" "${RUNNER}" {junit}`,
  );
  expect(cooked.status, cooked.stderr).toBe(0);
  expect(existsSync(join(project, "user-codex/config.toml"))).toBe(false);
  const session = hook("SessionStart", { source: "startup" });
  expect(session.status, session.stderr).toBe(0);
  expect(session.stdout).toContain("Codex");
  expect(session.stdout).toContain("hooks/cli.js");
  expect(reason(patch(".verid/verid.mjs"))).toContain("VERID_BURNT_HOOK_PROTECTED");
  const developerCall = hook("PreToolUse", {
    tool_name: "Bash",
    tool_input: { command: "node .verid/verid.mjs order calculator" },
  });
  expect(reason(developerCall)).toContain("VERID_BURNT_BASH_DEVELOPER_ONLY");
  expect(reason(patch(".verid/skills/ba/SKILL.md"))).toContain("VERID_BURNT_HOOK_PROTECTED");
  expect(reason(patch("src/add.ts"))).toContain("VERID_BURNT_TASK_SESSION");
  expect(cli("module", "calculator").status).toBe(0);
  put(".verid/research.md", "# Research\nAgreed calculator module\n");
  put(".verid/spec.md", "- REQ-1: The calculator shall add two numbers. (source: developer)\n");
  put(".verid/design.md", "# Design\nA pure add function.\n");
  put(
    ".verid/plan.md",
    "## Module: calculator\nArtifacts: .verid/artifacts/03-modules/calculator\n- AC-1: adds two numbers (REQ-1)\n",
  );
  expect(cli("order", "calculator").stderr).toContain("resolve the module draft");
  for (const input of MODULE_INPUTS)
    put(
      `.verid/artifacts/03-modules/calculator/${input}`,
      `Agreed: ${input}. Source: developer.\n`,
    );
  const order = cli("order", "calculator");
  expect(order.status, order.stderr).toBe(0);
  expect(reason(patch("src/add.ts"))).toContain("VERID_BURNT_TDD_NO_FAILING_TEST");
  expect(patch("test/add.test.ts").stdout).toBe("");
  put("test/add.test.ts", "// AC-1 adds two numbers\n");
  put("scenario.json", JSON.stringify({ exit: 1, junit: "vitest-add-assert.xml", output: "red" }));
  const red = cli("taste");
  expect(red.status, red.stderr).toBe(1);
  expect(state().tdd.state).toBe("COOKING");
  expect(patch("src/add.ts").stdout).toBe("");
  put("src/add.ts", "export const add = (a: number, b: number) => a + b;\n");
  put("scenario.json", JSON.stringify({ exit: 0, junit: "vitest-green.xml", output: "green" }));
  const green = cli("taste");
  expect(green.status, green.stderr).toBe(0);
  expect(state().tdd.state).toBe("PLATED");
  const reviewerWrite = hook("PreToolUse", {
    agent_id: "review-1",
    agent_type: "verid_reviewer",
    tool_name: "apply_patch",
    tool_input: { command: "*** Begin Patch\n*** Add File: src/forged.ts\n+code\n*** End Patch" },
  });
  expect(reason(reviewerWrite)).toContain("VERID_BURNT_ROLE_READ_ONLY");
  hook("SubagentStart", { agent_id: "review-1", agent_type: "verid_reviewer" });
  const reviewed = hook("SubagentStop", {
    agent_id: "review-1",
    agent_type: "verid_reviewer",
    stop_hook_active: false,
    last_assistant_message:
      "AC-1 checked against the spec, design, diff and tests.\nSecurity: no findings.\nVerdict: pass",
  });
  expect(reviewed.status, reviewed.stderr).toBe(0);
  expect(state().review).toMatchObject({
    module: "calculator",
    agent_type: "verid_reviewer",
    verdict: "pass",
  });
  put(".verid/artifacts/03-modules/calculator/spec/spec.md", "Changed public contract\n");
  expect(reason(patch("src/changed.ts"))).toContain("VERID_BURNT_TASK_SESSION");
  const staleServe = cli("serve", "calculator");
  expect(staleServe.status).toBe(2);
  expect(staleServe.stderr).toContain("VERID_BURNT_TASK_SESSION");
}, 60_000);

it("runs its repo CLI after moving the project without a verid installation on PATH", () => {
  const cooked = cli(
    "cook",
    "--yes",
    "--mode",
    "prep",
    "--workflow",
    "modular",
    "--resources",
    "repo",
    "--provider",
    "codex",
  );
  expect(cooked.status, cooked.stderr).toBe(0);
  const moved = `${project}-moved`;
  renameSync(project, moved);
  project = moved;
  const isolated = Object.fromEntries(
    Object.entries(env()).filter(([key]) => key.toLowerCase() !== "path"),
  );
  isolated.PATH = dirname(process.execPath);
  isolated.NODE_PATH = "";
  const local = (...args: string[]) =>
    spawnSync(process.execPath, [join(project, ".verid/verid.mjs"), ...args], {
      cwd: project,
      env: isolated,
      encoding: "utf8",
    });
  const setup = local("cook", "--yes");
  expect(setup.status, setup.stderr).toBe(0);
  expect(readFileSync(join(project, ".codex/hooks.json"), "utf8")).toContain("--provider codex");
  const module = local("module", "offline");
  expect(module.status, module.stderr).toBe(0);
  expect(existsSync(join(project, ".verid/artifacts/03-modules/offline/spec/spec.md"))).toBe(true);
  const help = local("help");
  expect(help.status, help.stderr).toBe(0);
  expect(help.stdout).toContain("module <name>");
  expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toContain("node .verid/verid.mjs");
}, 60_000);
