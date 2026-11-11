import { tempProject } from "../support/project.js";
import { startTaskSession } from "./helpers.js";

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, runHook } from "./in-process.js";
import { workLog } from "../../src/adapters/git.js";

// The Git rules through the hook, on real throwaway repositories. One case spawns the built hook;
// the tables run it in process.
const SESSION = "git-session";
let project: string;
let gitconfig: string;

const env = (extra: NodeJS.ProcessEnv = {}) => ({
  CLAUDE_PROJECT_DIR: project,
  GIT_CONFIG_GLOBAL: gitconfig,
  GIT_CONFIG_NOSYSTEM: "1",
  ...extra,
});

/** A repository with one commit on main, then checked out on `branch`. */
const repoAt = (folder: string, branch: string, main = "main") => {
  const dir = join(project, folder);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", main);
  writeFileSync(join(dir, "readme.txt"), "x");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "chore: start");
  if (branch !== main) git(dir, "switch", "-q", "-c", branch);
  return dir;
};

const payload = (command: string, cwd = project) =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd,
    tool_name: "Bash",
    tool_input: { command },
  });
const code = async (command: string, cwd = project) => {
  const r = await runHook(payload(command, cwd), env());
  return r.code === 0 ? "allow" : (/verid \[(\w+)\]/.exec(r.stderr)?.[1] ?? r.stderr);
};

const t = tempProject("verid-git-", {
  cwd: () => project,
  claudeProject: false,
  gitEnv: () => ({ ...process.env, ...env() }),
  bind: (p) => {
    project = p.root;
    gitconfig = join(project, "..", project.split(/[\\/]/).at(-1) + ".gitconfig");
  },
  setup: (p) => {
    writeFileSync(gitconfig, "");
    p.put(".verid/.state/state.json", '{"schemaVersion":1,"language":"en"}');
    p.put(".verid/.gitignore", ".state/\n");
  },
  teardown: () => {
    rmSync(gitconfig, { force: true });
  },
});
const { gitAt: git, putPlan: put, gitManifest: manifest } = t;

describe("Git internals remain protected", () => {
  it("refuses any write inside a repository's .git folder, by file tool or shell", async () => {
    manifest();
    repoAt(".", "feat/a");
    const write = async (file: string) => {
      const r = await runHook(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: SESSION,
          cwd: project,
          tool_name: "Write",
          tool_input: { file_path: join(project, file), content: "x" },
        }),
        env(),
      );
      return r.code === 0 ? "allow" : (/verid \[(\w+)\]/.exec(r.stderr)?.[1] ?? r.stderr);
    };
    expect({
      ref: await write(".git/refs/heads/main"),
      config: await write(".git/config"),
      gitignore: await write(".gitignore"),
      redirect: await code("echo x > .git/HEAD"),
      hooks: await code("cp evil .git/hooks/pre-commit"),
    }).toEqual({
      ref: "VERID_BURNT_GIT_INTERNALS",
      config: "VERID_BURNT_GIT_INTERNALS",
      gitignore: "allow",
      redirect: "VERID_BURNT_GIT_INTERNALS",
      hooks: "VERID_BURNT_GIT_INTERNALS",
    });
  });

  it("refuses shell commands that name a path inside .git, and writes to Git's global config", async () => {
    manifest();
    repoAt(".", "feat/a");
    const home = join(project, "home");
    const write = async (file: string) => {
      const r = await runHook(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: SESSION,
          cwd: project,
          tool_name: "Write",
          tool_input: { file_path: file, content: "x" },
        }),
        env(),
      );
      return r.code === 0 ? "allow" : (/verid \[(\w+)\]/.exec(r.stderr)?.[1] ?? r.stderr);
    };
    expect({
      "cd into .git": await code("cd .git && printf x > HEAD"),
      "hard link": await code("ln -f .git/refs/heads/main m"),
      "read .git": await code("cat .git/HEAD"),
      gitignore: await code("cat .gitignore"),
      "global gitconfig": await write(join(home, ".gitconfig")),
      "xdg git config": await write(join(home, ".config", "git", "config")),
      "shell gitconfig": await code("echo x >> ~/.gitconfig"),
    }).toEqual({
      "cd into .git": "VERID_BURNT_GIT_INTERNALS",
      "hard link": "VERID_BURNT_GIT_INTERNALS",
      "read .git": "VERID_BURNT_GIT_INTERNALS",
      gitignore: "allow",
      "global gitconfig": "VERID_BURNT_GIT_INTERNALS",
      "xdg git config": "VERID_BURNT_GIT_INTERNALS",
      "shell gitconfig": "VERID_BURNT_GIT_INTERNALS",
    });
  });
});

describe("verid menu --commits: the module's work history for the reviewer", () => {
  it("excludes tracked packets from the workspace's separate .verid Git root", () => {
    const folder = repoAt(".verid", "main");
    const base = git(folder, "rev-parse", "HEAD");
    put(".verid/review/work.md", "stale review packet\n");
    put(".verid/design.md", "current design\n");
    git(folder, "add", "-A");
    git(folder, "commit", "-q", "-m", "chore: design and old packet");
    const text = workLog(project, { ".verid": { main: "main", base } }).join("\n");
    expect(text).toContain("current design");
    expect(text).not.toContain("stale review packet");
    expect(text).not.toContain("review/work.md");
  });

  it("writes a readable review packet and prints only its fixed relative path", async () => {
    manifest('roles:\n  reviewer: ["verid:reviewer"]\n');
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", "# Design\n");
    put(".verid/spec.md", "- REQ-1: arithmetic\n");
    put(".verid/plan.md", "## Module: calc\n- AC-1: sums\n");
    repoAt(".", "main");
    expect((await runCli(["order", "calc"], project, env())).code).toBe(0);
    await startTaskSession(project, SESSION);
    put("src/calc.ts", "export const sum = (a: number, b: number) => a + b;\n");
    put(".env", "TOKEN=packet-secret\n");
    const stateFile = join(project, ".verid/.state/state.json");
    const prior = readFileSync(stateFile, "utf8");
    const result = await runCli(["menu", "--commits", "--file"], project, env());
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe(".verid/review/work.md\n");
    const packet = readFileSync(join(project, ".verid/review/work.md"), "utf8");
    expect(packet).toContain("module calc");
    expect(packet).toContain(".verid/plan.md");
    expect(packet).toContain("src/calc.ts");
    expect(packet).not.toContain("packet-secret");
    expect(readFileSync(stateFile, "utf8")).toBe(prior);
    const next = await runCli(["menu", "--commits", "--file"], project, env());
    expect(next.stdout).toBe(".verid/review/work.md\n");
    expect(readFileSync(join(project, ".verid/review/work.md"), "utf8")).not.toContain(
      "--- a/.verid/review",
    );
    const read = await runHook(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: SESSION,
        cwd: project,
        tool_name: "Read",
        tool_input: { file_path: ".verid/review/work.md" },
        agent_id: "reviewer",
        agent_type: "verid:reviewer",
      }),
      env(),
    );
    expect(read.code, read.stderr).toBe(0);
  });

  it("protects review packets from file, MCP and shell writes, including directory removal", async () => {
    manifest();
    const rows = [
      ["Write", { file_path: ".verid/review/work.md", content: "forged" }],
      ["mcp__filesystem__write_file", { path: ".verid/review/work.md", content: "forged" }],
      ["Bash", { command: "echo forged > .verid/review/work.md" }],
      ["Bash", { command: "rm -rf .verid/review" }],
      ["Write", { file_path: ".VERID/Review/work.md", content: "forged" }],
      ["Write", { file_path: join(project, ".verid/review/work.md"), content: "forged" }],
    ] as const;
    for (const [tool_name, tool_input] of rows) {
      const result = await runHook(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: SESSION,
          cwd: project,
          tool_name,
          tool_input,
        }),
        env(),
      );
      expect(result.code, tool_name).toBe(2);
      expect(result.stderr, tool_name).toContain("VERID_BURNT_STATE_PROTECTED");
      expect(result.stderr, tool_name).not.toContain(project);
    }
  });

  it("prints every commit since the base with its message and diff, and the uncommitted diff, never secrets", async () => {
    manifest('roles:\n  reviewer: ["verid:reviewer"]\n');
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", "# Design\n");
    put(".verid/spec.md", "- REQ-1: arithmetic\n");
    put(".verid/plan.md", "## Module: calc\n- AC-1: sums\n");
    repoAt(".", "main");
    const before = await runCli(["menu", "--commits"], project, env());
    expect((await runCli(["order", "calc"], project, env())).code).toBe(0);
    await startTaskSession(project, SESSION);
    git(project, "switch", "-q", "-c", "feat/calc");
    put("src/calc.ts", "export const sum = (a: number) => a + 1;\n");
    put(".env", "TOKEN=hunter2\n");
    put("config/db-credentials.json", '{"password":"swordfish"}\n');
    git(project, "add", "-A");
    git(project, "commit", "-q", "-m", "feat(calc): add sums\n\nBody line.");
    put("src/calc.ts", "export const sum = (a: number, b: number) => a + b;\n");
    git(project, "commit", "-q", "-am", "fix(calc): take two numbers");
    put("src/calc.ts", "export const sum = (a: number, b: number) => a + b; // uncommitted\n");
    put(".env", "TOKEN=changed-secret\n");
    put("src/new-secret.pem", "-----BEGIN KEY-----\n");
    const r = await runCli(["menu", "--commits"], project, env());
    expect({
      "before an order": before.stdout.includes("no open module"),
      code: r.code,
      messages: ["feat(calc): add sums", "Body line.", "fix(calc): take two numbers"].every((m) =>
        r.stdout.includes(m),
      ),
      "committed diff": r.stdout.includes("+export const sum = (a: number, b: number) => a + b;"),
      "uncommitted diff": r.stdout.includes("// uncommitted"),
      secrets: ["hunter2", "swordfish", "changed-secret", "BEGIN KEY"].filter((s) =>
        r.stdout.includes(s),
      ),
      "secret files named, not shown": r.stdout.includes(".env"),
      state: r.stdout.includes(".state"),
      "no state change": readFileSync(join(project, ".verid/.state/state.json"), "utf8").includes(
        '"calc"',
      ),
    }).toEqual({
      "before an order": true,
      code: 0,
      messages: true,
      "committed diff": true,
      "uncommitted diff": true,
      secrets: [],
      "secret files named, not shown": false,
      state: false,
      "no state change": true,
    });
  });
});
