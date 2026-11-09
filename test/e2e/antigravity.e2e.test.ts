import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { antigravityPluginInstalled } from "../../src/adapters/antigravity-settings.js";
import { runCli, runHook } from "./in-process.js";

const ROOT = join(import.meta.dirname, "../..");
const SHIM = join(ROOT, "plugin/antigravity/hooks/antigravity-hook.mjs");
let project: string;
let outside: string;
const stateFile = () => join(project, ".verid/.state/state.json");
const state = () => JSON.parse(readFileSync(stateFile(), "utf8"));
const audit = () => readFileSync(join(project, ".verid/.state/audit.jsonl"), "utf8");
const put = (rel: string, text: string) => {
  mkdirSync(join(project, rel, ".."), { recursive: true });
  writeFileSync(join(project, rel), text);
};
const manifest = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  mode: "recipe",
  providers: ["antigravity"],
  roles: {
    reviewer: ["verid-reviewer"],
    // Mapped as cook maps them for Claude Code: a single-writer host never asks for them.
    tester: ["verid:tester"],
    coder: ["verid:coder"],
  },
  repos: [
    {
      path: ".",
      source_globs: ["src/**"],
      test_globs: ["test/**"],
      test_cmd: `"${process.execPath}" "${join(import.meta.dirname, "fake-runner.mjs")}" {junit}`,
    },
  ],
  ...extra,
});

beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), "verid antigravity-"));
  outside = mkdtempSync(join(tmpdir(), "verid-not-a-project-"));
  for (const dir of [".verid/.state", "src", "test"])
    mkdirSync(join(project, dir), { recursive: true });
  put(
    ".verid/.state/state.json",
    JSON.stringify({
      schemaVersion: 1,
      tdd: { state: "PLATED", last_run: "seed", passed_acs: ["AC-1"] },
    }),
  );
  put(".verid/manifest.yaml", JSON.stringify(manifest()));
  put(".verid/design.md", "# Design\nPure addition\n");
  put(".verid/research.md", "# Research\n");
  put(".verid/spec.md", "- REQ-1: adds two numbers\n");
  put(
    ".verid/plan.md",
    "## Module: calc\n- AC-1: adds two numbers\n\n## Module: product\n- AC-9 (e2e): works end to end\n",
  );
  put(
    "scenario.json",
    JSON.stringify({ exit: 0, junit: "vitest-ac.xml", output: "passing evidence" }),
  );
  expect((await runCli(["order", "calc"], project)).code).toBe(0);
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const payload = (extra: Record<string, unknown> = {}) => ({
  conversationId: "agy-conversation",
  workspacePaths: [project],
  executionNum: 1,
  ...extra,
});
const hook = async (event: string, extra: Record<string, unknown> = {}) => {
  const r = await runHook(JSON.stringify(payload(extra)), {}, [
    "--provider",
    "antigravity",
    "--event",
    event,
  ]);
  expect(r.code).toBe(0);
  return JSON.parse(r.stdout) as Record<string, unknown>;
};
const tool = (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  hook("PreToolUse", { toolCall: { name, args, ...extra } });

describe("Antigravity hook transport", () => {
  it("lets every call through untouched outside a verid project", async () => {
    const run = (event: string) =>
      runHook(
        JSON.stringify({
          conversationId: "c",
          workspacePaths: [outside],
          toolCall: { name: "write_to_file", args: { TargetFile: join(outside, "a.ts") } },
        }),
        {},
        ["--provider", "antigravity", "--event", event],
      );
    expect(JSON.parse((await run("PreToolUse")).stdout)).toEqual({ decision: "allow" });
    expect(JSON.parse((await run("Stop")).stdout)).toEqual({ decision: "allow" });
    expect(JSON.parse((await run("SessionStart")).stdout)).toEqual({});
    expect(existsSync(join(outside, ".verid"))).toBe(false);
  });

  it("judges Antigravity's tools with verid's rules, in Antigravity's answer format", async () => {
    const rows: [string, Record<string, unknown>, string][] = [
      ["view_file", { AbsolutePath: join(project, "src/add.ts") }, "allow"],
      [
        "view_file",
        { AbsolutePath: join(project, ".verid/.state/state.json") },
        "VERID_BURNT_STATE_PROTECTED",
      ],
      [
        "write_to_file",
        { TargetFile: ".verid/manifest.yaml", CodeContent: "x" },
        "VERID_BURNT_MANIFEST_PROTECTED",
      ],
      [
        "write_to_file",
        { TargetFile: ".agents/plugins.json", CodeContent: "{}" },
        "VERID_BURNT_HOOK_PROTECTED",
      ],
      [
        "write_to_file",
        {
          TargetFile: join(homedir(), ".gemini/config/plugins/verid/hooks.json"),
          CodeContent: "{}",
        },
        "VERID_BURNT_HOOK_PROTECTED",
      ],
      [
        "view_file",
        {
          AbsolutePath: join(
            homedir(),
            ".gemini/antigravity/brain/other/.system_generated/logs/transcript.jsonl",
          ),
        },
        "VERID_BURNT_TRANSCRIPT_PROTECTED",
      ],
      [
        "run_command",
        {
          CommandLine:
            "Get-Content ~/.gemini/antigravity/brain/x/.system_generated/logs/transcript.jsonl",
        },
        "VERID_BURNT_TRANSCRIPT_PROTECTED",
      ],
      [
        "run_command",
        { CommandLine: "Set-Content -Path .verid/.state/state.json -Value {}" },
        "VERID_BURNT_STATE_PROTECTED",
      ],
      ["run_command", { CommandLine: "verid order calc" }, "VERID_BURNT_BASH_DEVELOPER_ONLY"],
      ["run_command", { CommandLine: "npm test 2>&1 | Select-String 'a > b'" }, "allow"],
      [
        "send_command_input",
        { CommandId: "1", Input: "rm -rf src" },
        "VERID_BURNT_SHELL_UNSUPPORTED",
      ],
      ["rewrite_everything", { Note: "no path" }, "VERID_BURNT_TOOL_UNSUPPORTED"],
      ["search_web", { query: "vitest junit" }, "allow"],
    ];
    for (const [name, args, expected] of rows) {
      const answer = await tool(name, args);
      if (expected === "allow") expect(answer, name).toEqual({ decision: "allow" });
      else {
        expect(answer.decision, `${name} ${JSON.stringify(args)}`).toBe("deny");
        expect(answer.reason).toContain(expected);
      }
    }
  });

  it("refuses a tool call it cannot read, and a call without its conversation", async () => {
    const missing = await runHook(
      JSON.stringify({ workspacePaths: [project], toolCall: { name: "view_file", args: {} } }),
      {},
      ["--provider", "antigravity", "--event", "PreToolUse"],
    );
    expect(JSON.parse(missing.stdout)).toMatchObject({ decision: "deny" });
    expect(JSON.parse(missing.stdout).reason).toContain("VERID_BURNT_PAYLOAD");
    const noPath = await tool("write_to_file", { CodeContent: "x" });
    expect(noPath.decision).toBe("deny");
    expect(String(noPath.reason)).toContain("VERID_BURNT_PAYLOAD");
  });

  it("makes the main agent the single writer without claiming a role", async () => {
    // On Claude Code these mappings would hand tests to the tester and code to the coder.
    const test = await tool("write_to_file", {
      TargetFile: "test/add.test.ts",
      CodeContent: "test",
    });
    expect(test).toEqual({ decision: "allow" });
    expect(state().tdd.state).toBe("RAW");
    const code = await tool("write_to_file", { TargetFile: "src/add.ts", CodeContent: "code" });
    expect(code.decision).toBe("deny");
    expect(String(code.reason)).toContain("VERID_BURNT_TDD_NO_FAILING_TEST");
    expect(String(code.reason)).not.toContain("ROLE");
    expect(state().writers).toEqual([]);
  });
});

describe("Antigravity reviews", () => {
  const dispatch = (id: string) =>
    tool("invoke_subagent", { TypeName: "verid-reviewer", Prompt: "Review calc" }, { id });
  const finished = (id: string, report: string) =>
    hook("PostToolUse", {
      toolCall: { name: "invoke_subagent", args: { TypeName: "verid-reviewer" }, id },
      toolResult: { output: report },
    });

  it("records the report of the subagent call it started, and nothing else", async () => {
    expect(await dispatch("call-1")).toEqual({ decision: "allow" });
    expect(Object.keys(state().review_jobs)).toHaveLength(1);
    // A report from another call never counts.
    await finished("call-2", "AC-1 covered\nVerdict: pass");
    expect(state().review).toBeNull();
    expect(audit()).toContain("REVIEW_STALE");
    await finished("call-1", "AC-1 covered\nVerdict: pass");
    expect(state().review).toMatchObject({
      module: "calc",
      verdict: "pass",
      agent_type: "verid-reviewer",
    });
    expect(Object.keys(state().review_jobs)).toHaveLength(0);
  });

  it("starts no review for a call verid refuses, and ignores a result without a verdict", async () => {
    put(".verid/manifest.yaml", JSON.stringify(manifest({ mode: "remix" })));
    // Remix has no module to review: the dispatch goes through and no job is started.
    expect(await dispatch("call-1")).toEqual({ decision: "allow" });
    put(".verid/manifest.yaml", JSON.stringify(manifest()));
    expect(await finished("call-1", "Looks fine to me")).toEqual({});
    expect(state().review).toBeNull();
  });
});

describe("Antigravity prompts, sessions and stops", () => {
  it("answers /verid peek without a model call, once per turn", async () => {
    const peek = await hook("PreInvocation", { lastUserInput: "/verid peek" });
    expect(peek.terminationBehavior).toBe("terminate");
    expect(JSON.stringify(peek.injectSteps)).toContain("verid: TDD");
    // The same turn asks again before its next model call: nothing more is done.
    expect(await hook("PreInvocation", { lastUserInput: "/verid peek" })).toEqual({});
    expect(
      (await hook("PreInvocation", { lastUserInput: "/verid peek", executionNum: 2 }))
        .terminationBehavior,
    ).toBe("terminate");
  });

  it("opens an exception from /verid tip and /verid confirm typed in the chat", async () => {
    const write = () => tool("write_to_file", { TargetFile: "src/add.ts", CodeContent: "code" });
    put(
      ".verid/.state/state.json",
      JSON.stringify({ ...state(), tdd: { ...state().tdd, state: "RAW" } }),
    );
    expect((await write()).decision).toBe("deny");
    const tip = await hook("PreInvocation", { lastUserInput: "/verid tip a quick spike" });
    // The code goes to the developer only, and the turn ends.
    expect(tip.terminationBehavior).toBe("terminate");
    const code = state().pending_override.code as string;
    expect(JSON.stringify(tip)).toContain(code);
    const confirm = await hook("PreInvocation", {
      lastUserInput: `/verid confirm ${code}`,
      executionNum: 2,
    });
    expect(JSON.stringify(confirm)).not.toContain("VERID_BURNT");
    expect(state().overrides).toHaveLength(1);
    expect(await write()).toEqual({ decision: "allow" });
    expect(state().overrides[0].used).toBe(true);
  });

  it("starts a session with the cycle and the single-writer rule", async () => {
    const start = await hook("SessionStart", { source: "resume" });
    const text = JSON.stringify(start);
    expect(text).toContain("verid: TDD");
    const fresh = JSON.stringify(await hook("SessionStart"));
    expect(fresh).toContain("Antigravity");
    expect(fresh).toContain("verid-reviewer");
  });

  it("holds a stop with unverified work once, then lets the next stop of that turn go", async () => {
    await hook("PreInvocation", { lastUserInput: "add the feature" });
    expect(
      await tool("write_to_file", { TargetFile: "test/add.test.ts", CodeContent: "t" }),
    ).toEqual({
      decision: "allow",
    });
    const held = await hook("Stop");
    expect(held.decision).toBe("continue");
    expect(String(held.reason)).toContain("verid: TDD");
    // Antigravity continues the same turn: the stop after a hold goes through.
    expect(await hook("PreInvocation", { lastUserInput: "add the feature" })).toEqual({});
    expect(await hook("Stop")).toEqual({ decision: "allow" });
    // A new turn is held again while the work is still unverified.
    await hook("PreInvocation", { lastUserInput: "carry on", executionNum: 2 });
    expect((await hook("Stop")).decision).toBe("continue");
  });
});

describe("Antigravity plugin entry", () => {
  it("runs verid in its own process and answers in Antigravity's format", () => {
    const run = (input: unknown) =>
      spawnSync(process.execPath, [SHIM, "PreToolUse"], {
        input: JSON.stringify(input),
        encoding: "utf8",
        cwd: outside,
      });
    const denied = run(
      payload({ toolCall: { name: "view_file", args: { AbsolutePath: stateFile() } } }),
    );
    expect(denied.status, denied.stderr).toBe(0);
    expect(JSON.parse(denied.stdout)).toMatchObject({ decision: "deny" });
    expect(JSON.parse(denied.stdout).reason).toContain("VERID_BURNT_STATE_PROTECTED");
    const free = run({
      conversationId: "c",
      workspacePaths: [outside],
      toolCall: { name: "view_file", args: {} },
    });
    expect(JSON.parse(free.stdout)).toEqual({ decision: "allow" });
  });

  it("installs the plugin with setup-antigravity and cooks a project for it", async () => {
    const home = mkdtempSync(join(tmpdir(), "verid-agy-home-"));
    const env = { HOME: home, USERPROFILE: home };
    try {
      const setup = await runCli(["setup-antigravity"], outside, env);
      expect(setup.code, setup.stderr).toBe(0);
      const dir = join(home, ".gemini/config/plugins/verid");
      expect(antigravityPluginInstalled(dir)).toBe(true);
      expect(existsSync(join(dir, "dist/hook-run.js"))).toBe(true);
      expect(existsSync(join(dir, "plugin/skills/tdd/SKILL.md"))).toBe(true);
      // Run again: nothing changes.
      expect((await runCli(["setup-antigravity"], outside, env)).stdout).toMatch(
        /\b0 (created|tạo mới)/,
      );
      const installed = spawnSync(
        process.execPath,
        [join(dir, "hooks/antigravity-hook.mjs"), "PreToolUse"],
        {
          input: JSON.stringify(
            payload({ toolCall: { name: "view_file", args: { AbsolutePath: stateFile() } } }),
          ),
          encoding: "utf8",
          cwd: outside,
        },
      );
      expect(JSON.parse(installed.stdout).reason).toContain("VERID_BURNT_STATE_PROTECTED");

      const fresh = mkdtempSync(join(tmpdir(), "verid-agy-cook-"));
      try {
        const cook = await runCli(
          ["cook", "--yes", "--provider", "antigravity", "--mode", "prep"],
          fresh,
          env,
        );
        expect(cook.code, cook.stderr).toBe(0);
        const written = parse(readFileSync(join(fresh, ".verid/manifest.yaml"), "utf8"));
        expect(written.providers).toEqual(["antigravity"]);
        expect(written.roles.reviewer).toContain("verid-reviewer");
        expect(written.roles.security).toContain("verid-security");
        expect(existsSync(join(fresh, ".claude"))).toBe(false);
        expect(existsSync(join(fresh, ".codex"))).toBe(false);
        expect(readFileSync(join(fresh, "AGENTS.md"), "utf8")).toContain(
          "invoke_subagent verid-reviewer",
        );
        const doctor = await runCli(["doctor"], fresh, env);
        expect(doctor.stdout + doctor.stderr).toMatch(/Antigravity/);
        expect(doctor.stdout + doctor.stderr).not.toMatch(/plugin is missing|thiếu hoặc đã cũ/);
      } finally {
        rmSync(fresh, { recursive: true, force: true });
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
