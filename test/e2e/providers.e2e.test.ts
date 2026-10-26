import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const CLI = join(import.meta.dirname, "../../dist/cli.js");
const HOOK = join(import.meta.dirname, "../../dist/hook.js");
let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-providers-"));
});
afterEach(() => rmSync(project, { recursive: true, force: true }));
const env = () => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CLAUDE"))),
  CODEX_HOME: join(project, "codex home"),
});
const cli = (args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: project, env: env(), encoding: "utf8" });
const read = (rel: string) => readFileSync(join(project, rel), "utf8");

describe("provider setup through the CLI", () => {
  it("permits superpowers general-purpose dispatches while retaining role rules and the TDD gate", () => {
    const setup = cli(["cook", "--yes", "--mode", "remix"]);
    expect(setup.status, setup.stderr).toBe(0);
    const hook = (tool_name: string, tool_input: Record<string, unknown>, agent = false) =>
      spawnSync(process.execPath, [HOOK], {
        cwd: project,
        env: { ...env(), CLAUDE_PROJECT_DIR: project },
        input: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: "general-purpose-setup",
          cwd: project,
          tool_name,
          tool_input,
          ...(agent && { agent_id: "general-1", agent_type: "general-purpose" }),
        }),
        encoding: "utf8",
      });
    const dispatch = hook("Agent", { subagent_type: "general-purpose", prompt: "work" });
    expect(dispatch.status, dispatch.stderr).toBe(0);
    const rows = [
      { path: "test/app.test.ts", code: "VERID_BURNT_ROLE_TESTER_ONLY" },
      { path: "src/app.ts", code: "VERID_BURNT_ROLE_CODER_ONLY" },
    ];
    for (const row of rows) {
      const write = hook("Write", { file_path: join(project, row.path), content: "code" }, true);
      expect(write.status).toBe(2);
      expect(write.stderr).toContain(row.code);
    }
    const manifest = parse(read(".verid/manifest.yaml"));
    manifest.roles.coder = ["general-purpose"];
    writeFileSync(join(project, ".verid/manifest.yaml"), JSON.stringify(manifest));
    const gated = hook("Write", { file_path: join(project, "src/app.ts"), content: "code" }, true);
    expect(gated.status).toBe(2);
    expect(gated.stderr).toContain("VERID_BURNT_TDD_NO_FAILING_TEST");
  });

  it("selects providers with repeatable flags and writes only their instruction files and wiring", () => {
    const rows = [
      { args: [], providers: ["claude-code"], claude: true, codex: false },
      { args: ["--provider", "codex"], providers: ["codex"], claude: false, codex: true },
      {
        args: ["--provider", "claude-code", "--provider", "codex"],
        providers: ["claude-code", "codex"],
        claude: true,
        codex: true,
      },
    ];
    for (const row of rows) {
      const result = cli(["cook", "--yes", ...row.args]);
      expect(result.status, result.stderr).toBe(0);
      expect(parse(read(".verid/manifest.yaml")).providers).toEqual(row.providers);
      expect(parse(read(".verid/manifest.yaml")).allowed_agents).toEqual(["general-purpose"]);
      expect(existsSync(join(project, "CLAUDE.md"))).toBe(row.claude);
      expect(existsSync(join(project, ".claude/settings.local.json"))).toBe(row.claude);
      expect(existsSync(join(project, ".claude/commands/verid/tip.md"))).toBe(row.claude);
      expect(existsSync(join(project, "AGENTS.md"))).toBe(row.codex);
      expect(existsSync(join(project, ".codex/hooks.json"))).toBe(row.codex);
      if (row.codex) {
        expect(read(".codex/hooks.json")).toContain("--provider codex");
        expect(read("codex home/config.toml")).toContain("[agents.verid_reviewer]");
        expect(parse(read(".verid/manifest.yaml")).roles.reviewer).toContain("verid_reviewer");
      }
      const commit = result.stdout.split("\n").find((line) => line.includes("Commit"));
      if (row.claude) expect(commit).toContain("CLAUDE.md");
      if (row.codex) expect(commit).toContain("AGENTS.md");
      if (!row.claude) {
        expect(result.stdout).not.toContain(".claude/commands/verid/");
        expect(result.stdout).not.toContain(".claude/settings.local.json");
        expect(result.stdout).not.toContain("Then open Claude Code");
        expect(result.stdout).not.toContain("claude plugin install");
      }
      rmSync(project, { recursive: true, force: true });
      mkdirSync(project);
    }
  });

  it("previews provider instruction creation and update without changing user content", () => {
    writeFileSync(join(project, "AGENTS.md"), "# User instructions\nKeep my notes.\n");
    const preview = cli(["cook", "--yes", "--provider", "codex", "--dry-run"]);
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toContain("~ AGENTS.md");
    expect(preview.stdout).not.toContain("settings.local.json");
    expect(read("AGENTS.md")).toBe("# User instructions\nKeep my notes.\n");
    expect(existsSync(join(project, ".verid"))).toBe(false);
    const applied = cli(["cook", "--yes", "--provider", "codex"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(read("AGENTS.md")).toContain("# User instructions\nKeep my notes.\n");
    expect(read("AGENTS.md")).toContain("<!-- verid:begin -->");
  });

  it("migrates old provider fields once and ignores cook provider flags on an existing manifest", () => {
    mkdirSync(join(project, ".verid"));
    writeFileSync(
      join(project, ".verid/manifest.yaml"),
      "# keep\nschemaVersion: 1\nmode: remix\nrepos:\n  - path: .\n    source_globs: [src/**]\n    test_globs: [test/**]\n",
    );
    const upgraded = cli(["upgrade", "--yes"]);
    expect(upgraded.status, upgraded.stderr).toBe(0);
    const manifest = parse(read(".verid/manifest.yaml"));
    expect(manifest.providers).toEqual(["claude-code"]);
    expect(manifest.allowed_skills).toEqual([]);
    expect(manifest.allowed_agents).toEqual(["general-purpose"]);
    expect(read("CLAUDE.md")).toContain("general-purpose");
    expect(read(".verid/manifest.yaml")).toContain("# keep");
    const ignored = cli(["cook", "--yes", "--provider", "codex"]);
    expect(ignored.status, ignored.stderr).toBe(0);
    expect(ignored.stdout).toContain("--provider");
    expect(parse(read(".verid/manifest.yaml")).providers).toEqual(["claude-code"]);
    expect(existsSync(join(project, "AGENTS.md"))).toBe(false);
    expect(cli(["upgrade", "--yes"]).stdout).toContain("= manifest.yaml");
  });

  it("refuses unsupported providers before writing setup files", () => {
    const result = cli(["cook", "--yes", "--provider", "cursor"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--provider");
    expect(existsSync(join(project, ".verid"))).toBe(false);
  });
});
