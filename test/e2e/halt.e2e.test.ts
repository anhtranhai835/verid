import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { developerEnv } from "./helpers.js";
import { runCli, runHook } from "./in-process.js";

const ROOT = join(import.meta.dirname, "../..");
let project: string;
const stateFile = () => join(project, ".verid/.state/state.json");
const state = () => JSON.parse(readFileSync(stateFile(), "utf8"));
const audit = () =>
  readFileSync(join(project, ".verid/.state/audit.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-halt-"));
  mkdirSync(join(project, ".verid/.state"), { recursive: true });
  // COOKING: a failing test, so an ordinary Stop would be held.
  writeFileSync(
    stateFile(),
    JSON.stringify({
      schemaVersion: 1,
      language: "en",
      tdd: { state: "COOKING", last_run: "r1", failing: ["t"], rev: 1 },
    }),
  );
  writeFileSync(
    join(project, ".verid/manifest.yaml"),
    'schemaVersion: 1\nmode: remix\nrepos:\n  - path: "."\n    source_globs: ["src/**"]\n    test_globs: ["test/**"]\n',
  );
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

const payload = (event: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ hook_event_name: event, session_id: "s", cwd: project, ...extra });
const tool = (tool_name: string, tool_input: Record<string, unknown>) =>
  payload("PreToolUse", { tool_name, tool_input });
const hook = (input: string, args: string[] = []) =>
  runHook(input, { CLAUDE_PROJECT_DIR: project }, args);

describe("kill switch: verid halt and verid resume", () => {
  it("halts and resumes through the built CLI and hook", () => {
    const spawn = (file: string, args: string[], input?: string) => {
      const r = spawnSync(process.execPath, [join(ROOT, "dist", file), ...args], {
        cwd: project,
        env: developerEnv("CODEX"),
        encoding: "utf8",
        ...(input !== undefined && { input }),
      });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    const read = tool("Read", { file_path: join(project, "README.md") });
    const halted = spawn("cli.js", ["halt", "a dependency looks compromised"]);
    const denied = spawn("hook.js", [], read);
    const resumed = spawn("cli.js", ["resume"]);
    const allowed = spawn("hook.js", [], read);
    expect({
      halted: [halted.code, halted.stdout.split("\n")[0]],
      denied: [denied.code, denied.stderr.includes("VERID_BURNT_HALTED")],
      resumed: [resumed.code, resumed.stdout.split("\n")[0]],
      allowed: allowed.code,
    }).toEqual({
      halted: [0, "verid: halted · a dependency looks compromised"],
      denied: [2, true],
      resumed: [0, "verid: resumed"],
      allowed: 0,
    });
  });

  it("denies every tool while halted, past any /verid tip, and lets the agent stop", async () => {
    expect((await runCli(["halt"], project)).code).toBe(0);
    const rows = [
      ["Read", tool("Read", { file_path: join(project, "README.md") })],
      ["Write", tool("Write", { file_path: join(project, "src/a.ts"), content: "x" })],
      ["Bash", tool("Bash", { command: "ls" })],
      ["Skill", tool("Skill", { skill: "verid:tdd" })],
      ["MCP", tool("mcp__fs__read_file", { path: join(project, "README.md") })],
    ] as const;
    const verdicts: Record<string, [number, boolean]> = {};
    for (const [name, input] of rows) {
      const r = await hook(input);
      verdicts[name] = [r.code, r.stderr.includes("VERID_BURNT_HALTED")];
    }
    expect(verdicts).toEqual({
      Read: [2, true],
      Write: [2, true],
      Bash: [2, true],
      Skill: [2, true],
      MCP: [2, true],
    });
    const tip = await runHook(payload("UserPromptSubmit", { prompt: "/verid tip resume work" }), {
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_CODE_SESSION_ATTENDED: "1",
    });
    expect(tip.stderr).not.toContain("VERID_BURNT_HALTED");
    expect((await hook(rows[0][1])).code).toBe(2);
    const stop = await hook(payload("Stop", { stop_hook_active: false }));
    const subagent = await hook(
      payload("SubagentStop", {
        agent_id: "a",
        agent_type: "verid:coder",
        stop_hook_active: false,
      }),
    );
    expect({ stop: stop.code, subagent: subagent.code }).toEqual({ stop: 0, subagent: 0 });
  });

  it("tells the agent at session start and on each prompt that the developer halted verid", async () => {
    expect((await runCli(["halt", "check the lockfile"], project)).code).toBe(0);
    const start = await hook(payload("SessionStart", { source: "startup" }));
    const prompt = await hook(payload("UserPromptSubmit", { prompt: "go on" }));
    for (const r of [start, prompt]) {
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("verid: halted · check the lockfile");
      expect(r.stdout).toContain("The developer halted verid");
    }
  });

  it("denies Codex tools with a JSON decision while halted", async () => {
    expect((await runCli(["halt"], project)).code).toBe(0);
    const r = await runHook(
      JSON.stringify({
        session_id: "c",
        transcript_path: null,
        cwd: project,
        hook_event_name: "PreToolUse",
        model: "m",
        permission_mode: "default",
        turn_id: "t",
        tool_name: "Bash",
        tool_input: { command: "ls" },
        tool_use_id: "u",
      }),
      {},
      ["--provider", "codex"],
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(r.stdout).toContain("VERID_BURNT_HALTED");
  });

  it("is the developer's alone, audited, and halts again with a new reason", async () => {
    const rows = [
      ["halt", { CLAUDECODE: "1" }],
      ["resume", { CLAUDECODE: "1" }],
      ["halt", { CODEX_THREAD_ID: "t" }],
    ] as const;
    for (const [command, env] of rows) {
      const r = await runCli([command], project, env);
      expect([r.code, r.stderr.includes("VERID_BURNT_HALT_IN_AGENT")], command).toEqual([2, true]);
    }
    expect(state().halted ?? null).toBeNull();
    expect((await runCli(["halt", "first"], project)).code).toBe(0);
    expect((await runCli(["halt", "second"], project)).code).toBe(0);
    expect(state().halted.reason).toBe("second");
    expect((await runCli(["resume"], project)).code).toBe(0);
    const again = await runCli(["resume"], project);
    expect([again.code, again.stdout.split("\n")[0]]).toEqual([0, "verid: not halted"]);
    expect(state().halted).toBeNull();
    expect(audit().map((e) => [e.event, e.reason ?? null])).toEqual(
      expect.arrayContaining([
        ["halted", "first"],
        ["halted", "second"],
        ["resumed", null],
      ]),
    );
  });
});
