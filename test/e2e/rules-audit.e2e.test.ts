import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli, runHook, runReview } from "./in-process.js";

let project: string;
const put = (file: string, text: string) => {
  mkdirSync(dirname(join(project, file)), { recursive: true });
  writeFileSync(join(project, file), text);
};
const state = () => JSON.parse(readFileSync(join(project, ".verid/.state/state.json"), "utf8"));
const save = (value: unknown) => put(".verid/.state/state.json", JSON.stringify(value));
const manifest = (extra = "") =>
  put(
    ".verid/manifest.yaml",
    `schemaVersion: 1
mode: prep
${extra}roles:
  reviewer: ["verid:reviewer"]
  tester: ["verid:tester"]
  coder: ["verid:coder"]
repos:
  - path: "."
    source_globs: ["src/**"]
    test_globs: ["test/**"]
    architecture_check:
      command: "node missing-checker.js"
      inputs: ["package.json"]
`,
  );
const hook = (event: string, extra: Record<string, unknown> = {}) =>
  (event === "SubagentStop" ? runReview : runHook)(
    JSON.stringify({
      hook_event_name: event,
      session_id: "rules",
      cwd: project,
      ...extra,
    }),
    { CLAUDE_PROJECT_DIR: project },
  );
const write = (path: string) =>
  hook("PreToolUse", {
    agent_id: "coder-1",
    agent_type: "verid:coder",
    tool_name: "Write",
    tool_input: { file_path: join(project, path), content: "x" },
  });
const review = () =>
  hook("SubagentStop", {
    agent_id: "reviewer-1",
    agent_type: "verid:reviewer",
    last_assistant_message: "Verdict: pass",
  });
const evidence = () => {
  const s = state();
  save({
    ...s,
    tdd: {
      ...s.tdd,
      state: "PLATED",
      last_run: "run",
      failing: [],
      dirty: false,
      passed_acs: ["AC-1"],
      passed_e2e_acs: [],
    },
  });
};

const git = (...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@test", ...args], {
    cwd: project,
    encoding: "utf8",
    windowsHide: true,
  });
  expect(r.status, r.stderr).toBe(0);
};

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-rules-"));
  save({ schemaVersion: 1, language: "en" });
  manifest();
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

describe("rules and audit without relaxing TDD", () => {
  it("keeps state, Git internals, MCP configuration and unapproved code protected", async () => {
    const rows = [
      [".verid", "VERID_BURNT_STATE_PROTECTED"],
      [".verid/.state/state.json", "VERID_BURNT_STATE_PROTECTED"],
      [".git/hooks/pre-commit", "VERID_BURNT_GIT_INTERNALS"],
      [".claude.json", "VERID_BURNT_HOOK_PROTECTED"],
      [".mcp.json", "VERID_BURNT_HOOK_PROTECTED"],
      [".env", "VERID_BURNT_SECRET_PROTECTED"],
      ["src/a.ts", "VERID_BURNT_PLAN_NOT_APPROVED"],
    ];
    for (const [path, code] of rows) {
      const r = await write(path!);
      expect(r.code, path).toBe(2);
      expect(r.stderr, path).toContain(code);
    }
  });

  it("allows plan order and unknown dispatches, and records their warnings for menu", async () => {
    expect((await write(".verid/plan.md")).code).toBe(0);
    for (const [tool_name, tool_input] of [
      ["Skill", { skill: "custom:skill" }],
      ["Agent", { subagent_type: "custom:agent" }],
    ] as const)
      expect((await hook("PreToolUse", { tool_name, tool_input })).code).toBe(0);
    const log = readFileSync(join(project, ".verid/.state/audit.jsonl"), "utf8");
    for (const code of [
      "PLAN_NO_RESEARCH",
      "PLAN_NO_SPEC",
      "PLAN_NO_DESIGN",
      "SKILL_NOT_ALLOWED",
      "AGENT_NOT_ALLOWED",
    ])
      expect(log).toContain(code);
    const menu = await runCli(["menu"], project);
    expect(menu.code).toBe(0);
    expect(menu.stdout).toContain("audit:");
  });

  it("allows Git conventions without parsing shell refs or requiring a repository", async () => {
    const commands = [
      "git commit -m 'feat: x'",
      "git push origin HEAD:main",
      "git switch -c custom-branch",
      'git -C "$REPO" commit -m x',
    ];
    for (const command of commands) {
      const r = await hook("PreToolUse", { tool_name: "Bash", tool_input: { command } });
      expect(r.code, r.stderr).toBe(0);
    }
  });

  it("does not turn a failed advisory log write into a tool denial", async () => {
    put(".verid/.state/audit.jsonl", "invalid prior log\n");
    const r = await hook("PreToolUse", {
      tool_name: "Skill",
      tool_input: { skill: "custom:skill" },
    });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("audit unavailable");
  });

  it("serves reviewed passing work on main despite dirty Git and an architecture warning", async () => {
    put(".verid/research.md", "research");
    put(".verid/design.md", "design");
    put(".verid/plan.md", "## Module: calc\n- AC-1: adds\n");
    const git = (...args: string[]) => {
      const r = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@test", ...args], {
        cwd: project,
        encoding: "utf8",
        windowsHide: true,
      });
      expect(r.status, r.stderr).toBe(0);
    };
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-q", "-m", "chore: start");
    expect((await runCli(["order", "calc"], project)).code).toBe(0);
    put("src/a.ts", "export const value = 1;");
    git("add", "src/a.ts");
    git("commit", "-q", "-m", "bad message");
    evidence();
    expect((await review()).code).toBe(0);
    // Changing a design is advisory and does not revoke the signed module.
    put(".verid/design.md", "updated design");
    const r = await runCli(["serve", "calc"], project);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toContain("audit:");
    expect(r.stdout + r.stderr).toContain("bad message");
    expect(state().modules.calc.served_at).toBeTruthy();
  });

  it("opens and closes auto modules without Git, branch creation or merge waits", async () => {
    manifest("drive: auto\n");
    put(".verid/research.md", "research");
    put(".verid/design.md", "design");
    put(
      ".verid/plan.md",
      "## Module: calc\n- AC-1: adds\n## Module: product\n- AC-2 (e2e): works\n",
    );
    expect((await runCli(["order"], project)).code).toBe(0);
    put(".verid/research.md", "updated research");
    expect((await runCli(["doctor"], project)).stdout).toContain("RESEARCH_CHANGED");
    expect((await review()).code).toBe(0); // plan
    expect((await write("src/a.ts")).stderr).toContain("TDD_NO_FAILING_TEST");
    evidence();
    expect((await review()).code).toBe(0); // calc
    expect(state().modules.calc?.served_at).toBeTruthy();
    expect(existsSync(join(project, ".git"))).toBe(false);
    const menu = await runCli(["menu"], project);
    expect(menu.stdout).toContain("product · cooking");
    expect(menu.stdout).not.toContain("squash-merge");
  });

  it("keeps a closed auto module's history warnings visible after opening the next module", async () => {
    manifest("drive: auto\n");
    put(".verid/research.md", "research");
    put(".verid/design.md", "design");
    put(
      ".verid/plan.md",
      "## Module: calc\n- AC-1: adds\n## Module: product\n- AC-2 (e2e): works\n",
    );
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-q", "-m", "chore: start");
    expect((await runCli(["order"], project)).code).toBe(0);
    expect((await review()).code).toBe(0);
    put("src/a.ts", "export const value = 1;");
    git("add", "src/a.ts");
    git("commit", "-q", "-m", "bad message");
    evidence();
    expect((await review()).code).toBe(0);
    expect(state().modules.calc.served_at).toBeTruthy();
    const events = readFileSync(join(project, ".verid/.state/audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      events.find((event) => event.event === "module_served" && event.module === "calc").warnings,
    ).toEqual(expect.arrayContaining([expect.stringContaining("bad message")]));
    expect((await runCli(["doctor"], project)).stdout).toContain("bad message");
  });

  it("reports a missing Git audit base instead of silently recording an empty history", async () => {
    manifest("drive: auto\n");
    put(".verid/research.md", "research");
    put(".verid/design.md", "design");
    put(".verid/plan.md", "## Module: product\n- AC-1 (e2e): works\n");
    // A repository without a commit has no usable main base, but Git remains advisory.
    git("init", "-q", "-b", "main");
    expect((await runCli(["order"], project)).code).toBe(0);
    expect((await review()).code).toBe(0);
    const log = readFileSync(join(project, ".verid/.state/audit.jsonl"), "utf8");
    expect(log).toContain("GIT_WORK_BASE");
    expect((await runCli(["doctor"], project)).stdout).toContain("GIT_WORK_BASE");
  });

  it("creates architecture rule profiles and preserves edited rules during upgrade", async () => {
    rmSync(join(project, ".verid/manifest.yaml"));
    const cooked = await runCli(
      ["cook", "--yes", "--mode", "prep", "--architecture", "clean"],
      project,
    );
    expect(cooked.code, cooked.stderr).toBe(0);
    const file = join(project, ".verid/rules/architecture.md");
    expect(readFileSync(file, "utf8")).toContain("use cases");
    for (const name of ["git", "workflow"])
      expect(existsSync(join(project, `.verid/rules/${name}.md`))).toBe(true);
    expect(readFileSync(join(project, ".verid/manifest.yaml"), "utf8")).toContain(
      "architecture: clean",
    );
    writeFileSync(file, "my architecture rules");
    const upgraded = await runCli(["upgrade", "--yes"], project);
    expect(upgraded.code, upgraded.stderr).toBe(0);
    expect(readFileSync(file, "utf8")).toBe("my architecture rules");
  });

  it("accepts several small feature commits without warning about their count", async () => {
    put(".verid/research.md", "research");
    put(".verid/spec.md", "- REQ-1: Add and subtract numbers\n");
    put(".verid/design.md", "Pure calculator functions");
    put(".verid/plan.md", "## Module: calc\n- AC-1: calculates (REQ-1)\n");
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-q", "-m", "chore: initialize calculator");
    git("switch", "-q", "-c", "feat/calculator");
    expect((await runCli(["order", "calc"], project)).code).toBe(0);
    expect(state().modules.calc.work["."].base).toBeTruthy();
    put("src/add.ts", "export const add = (a: number, b: number) => a + b;\n");
    git("add", "src/add.ts");
    git("commit", "-q", "-m", "feat(calc): add numbers");
    put("src/subtract.ts", "export const subtract = (a: number, b: number) => a - b;\n");
    git("add", "src/subtract.ts");
    git("commit", "-q", "-m", "feat(calc): subtract numbers");
    const result = await runCli(["menu"], project);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("GIT_COMMITS");
    expect(result.stdout + result.stderr).not.toContain("GIT_COMMIT_MESSAGE");
  });

  it("lets the main thread write verid's documents when source globs cover everything", async () => {
    put(
      ".verid/manifest.yaml",
      'schemaVersion: 1\nmode: prep\nroles:\n  reviewer: ["verid:reviewer"]\n  tester: ["verid:tester"]\n  coder: ["verid:coder"]\nrepos:\n  - path: "."\n    source_globs: ["**"]\n    test_globs: ["test/**"]\n',
    );
    const main = (path: string) =>
      hook("PreToolUse", {
        tool_name: "Write",
        tool_input: { file_path: join(project, path), content: "x" },
      });
    const rows = [
      [".verid/research.md", "exit 0"],
      [".verid/log/calc.md", "exit 0"],
      [".verid/feedback.md", "exit 0"],
      [".verid/lib.ts", "VERID_BURNT_ROLE_CODER_ONLY"],
      [".verid/.state/state.json", "VERID_BURNT_STATE_PROTECTED"],
      ["src/a.ts", "VERID_BURNT_ROLE_CODER_ONLY"],
    ] as const;
    const got: Record<string, string> = {};
    for (const [path] of rows) {
      const r = await main(path);
      got[path] = r.code === 0 ? "exit 0" : (/verid \[(\w+)\]/.exec(r.stderr)?.[1] ?? r.stderr);
    }
    expect(got).toEqual(Object.fromEntries(rows));
  });

  it("shows what a module waits for, suggests its dependencies first and warns on out-of-order plans and orders", async () => {
    put(".verid/research.md", "research");
    put(".verid/spec.md", "# Spec\n");
    put(".verid/design.md", "design");
    put(
      ".verid/plan.md",
      "## Module: web\nDepends: api\n- AC-1: shows\n## Module: api\n- AC-2: serves\n",
    );
    const menu = (await runCli(["menu"], project)).stdout;
    expect(menu).toContain("  web · planned · 0/1 ACs · waits for api");
    expect(menu).toMatch(/order api/);
    expect((await runCli(["doctor"], project)).stdout).toContain(
      "[DEPENDS] web: depends on api, which comes later in the plan",
    );
    const ordered = await runCli(["order", "web"], project);
    expect(ordered.code, ordered.stderr).toBe(0);
    expect(ordered.stdout).toContain("verid: module web waits for api, which is not served yet");
    const doctor = (await runCli(["doctor"], project)).stdout;
    expect(doctor).toContain("[ORDER_DEPENDS] web: api not served");
  });

  it("warns about spec requirements no AC cites and citations the spec lacks, and asks its questions", async () => {
    put(".verid/research.md", "research");
    put(".verid/design.md", "design");
    put(
      ".verid/spec.md",
      "# Spec\n- REQ-1: When x, the system shall y.\n- SEC-1: The system shall z.\n[NEEDS CLARIFICATION: which locale?]\n",
    );
    put(".verid/plan.md", "## Module: calc\n- AC-1: adds (REQ-1, REQ-9)\n");
    const menu = await runCli(["menu"], project);
    expect(menu.code, menu.stderr).toBe(0);
    expect(menu.stdout).toMatch(/^verid: audit: \d+ warning\(s\)$/m);
    expect(menu.stdout).toContain("  ? spec.md:4 which locale?");
    const doctor = (await runCli(["doctor"], project)).stdout;
    for (const text of [
      "[SPEC_UNCOVERED] SEC-1: no AC or Review Focus line in .verid/plan.md cites it",
      "[SPEC_UNKNOWN] REQ-9: cited in .verid/plan.md but not in .verid/spec.md",
    ])
      expect(doctor, text).toContain(text);
    put(".verid/plan.md", "## Module: calc\n- AC-1: adds (REQ-1, SEC-1)\n");
    expect((await runCli(["doctor"], project)).stdout).not.toContain("[SPEC_");
  });

  it("creates .verid/docs for the developer's documents and leaves the folder alone afterwards", async () => {
    rmSync(join(project, ".verid/manifest.yaml"));
    const cooked = await runCli(["cook", "--yes", "--mode", "prep"], project);
    expect(cooked.code, cooked.stderr).toBe(0);
    const note = join(project, ".verid/docs/README.md");
    expect(readFileSync(note, "utf8")).toContain("only the developer");
    rmSync(note);
    put(".verid/docs/brd.md", "my requirements");
    const upgraded = await runCli(["upgrade", "--yes"], project);
    expect(upgraded.code, upgraded.stderr).toBe(0);
    expect(existsSync(note)).toBe(false);
    expect(readFileSync(join(project, ".verid/docs/brd.md"), "utf8")).toBe("my requirements");
  });
});
