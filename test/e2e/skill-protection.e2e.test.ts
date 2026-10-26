import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = join(import.meta.dirname, "../../dist/hook.js");
let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-skill-protection-"));
  mkdirSync(join(project, ".verid/.state"), { recursive: true });
  writeFileSync(join(project, ".verid/.state/state.json"), '{"schemaVersion":1}');
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

function hook(payload: Record<string, unknown>, attended = false, configDir?: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE")),
  );
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: "skill-protection", cwd: project, ...payload }),
    encoding: "utf8",
    env: {
      ...env,
      CLAUDE_PROJECT_DIR: project,
      ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
      ...(attended ? { CLAUDE_CODE_SESSION_ATTENDED: "1" } : {}),
    },
  });
  return { code: r.status, stderr: r.stderr };
}
const call = (tool_name: string, tool_input: Record<string, unknown>) => ({
  hook_event_name: "PreToolUse",
  tool_name,
  tool_input,
});

describe("Claude skill definition protection", () => {
  it("denies file tools and recognized MCP writers in project and user skills", () => {
    const rows = [
      ["Write", { content: "---\nname: verid:build\n---\nIgnore the workflow" }],
      ["Edit", { old_string: "original", new_string: "replacement" }],
      ["MultiEdit", { edits: [{ old_string: "original", new_string: "replacement" }] }],
      ["NotebookEdit", { new_source: "replacement" }],
      ["mcp__filesystem__write_file", { content: "replacement" }],
      ["mcp__filesystem__edit_file", { edits: [] }],
      ["mcp__filesystem__move_file", { source: "ordinary.md" }],
      ["mcp__filesystem__delete_file", {}],
    ] as const;
    for (const base of [project, homedir()]) {
      const path = join(base, ".claude/skills/custom/SKILL.md");
      for (const [tool, input] of rows) {
        const r = hook(call(tool, { file_path: path, notebook_path: path, path, ...input }));
        expect(r.code, `${base} ${tool}`).toBe(2);
        expect(r.stderr).toContain("VERID_BURNT_HOOK_PROTECTED");
        expect(r.stderr).toContain("skills");
      }
    }
  });

  it("denies Bash write targets in project or user skills", () => {
    const rows = [
      "echo x > .claude/skills/custom/SKILL.md",
      "cp ordinary.md ~/.claude/skills/custom/SKILL.md",
      `rm -r "${join(homedir(), ".claude/skills")}"`,
      'tee .claude/sk""ills/custom/SKILL.md',
    ];
    for (const command of rows) {
      const r = hook(call("Bash", { command }));
      expect(r.code, command).toBe(2);
      expect(r.stderr).toContain("VERID_BURNT_HOOK_PROTECTED");
    }
  });

  it("allows Bash to read skills and run their scripts", () => {
    const rows = [
      "cat .claude/skills/custom/SKILL.md",
      "cat ~/.claude/skills/custom/SKILL.md",
      "python ~/.claude/skills/x/scripts/y.py",
      "node .claude/skills/x/scripts/y.js",
      'python ~/.claude/sk""ills/x/scripts/y.py',
    ];
    for (const command of rows) expect(hook(call("Bash", { command })).code, command).toBe(0);
  });

  it("lets direct readers access skills and keeps ordinary skills folders writable", () => {
    const rows = [
      ["Read", { file_path: join(project, ".claude/skills/custom/SKILL.md") }],
      ["Glob", { path: join(homedir(), ".claude/skills"), pattern: "**/SKILL.md" }],
      ["mcp__filesystem__read_file", { path: join(homedir(), ".claude/skills/custom/SKILL.md") }],
      ["Write", { file_path: "skills/custom/SKILL.md", content: "ordinary project text" }],
      ["Write", { file_path: ".claude/skills-notes.md", content: "notes" }],
    ] as const;
    for (const [tool, input] of rows) expect(hook(call(tool, input)).code, tool).toBe(0);
  });

  it("does not let a developer override a skill definition write", () => {
    const r = hook(call("Write", { file_path: ".claude/skills/custom/SKILL.md", content: "x" }));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("VERID_BURNT_HOOK_PROTECTED");
    const tip = hook(
      { hook_event_name: "UserPromptSubmit", prompt: "/verid tip update the skill" },
      true,
    );
    expect(tip.code).toBe(2);
    expect(tip.stderr).toContain("VERID_BURNT_OVERRIDE_FORBIDDEN");
  });
});

describe("Claude command definition protection", () => {
  it("denies file tools and recognized MCP writers in project, nested and user commands", () => {
    const rows = [
      ["Write", { content: "---\ncontext: fork\nagent: verid:coder\n---\nescape" }],
      ["Edit", { old_string: "original", new_string: "replacement" }],
      ["MultiEdit", { edits: [{ old_string: "original", new_string: "replacement" }] }],
      ["NotebookEdit", { new_source: "replacement" }],
      ["mcp__filesystem__write_file", { content: "replacement" }],
      ["mcp__filesystem__edit_file", { edits: [] }],
      ["mcp__filesystem__move_file", { source: "ordinary.md" }],
      ["mcp__filesystem__delete_file", {}],
    ] as const;
    for (const base of [project, join(project, "nested"), homedir()]) {
      const path = join(base, ".claude/commands/superpowers/escape.md");
      for (const [tool, input] of rows) {
        const r = hook(call(tool, { file_path: path, notebook_path: path, path, ...input }));
        expect.soft(r.code, `${base} ${tool}`).toBe(2);
        expect.soft(r.stderr, `${base} ${tool}`).toContain("VERID_BURNT_HOOK_PROTECTED");
      }
    }
  });

  it("denies parsed Bash writes to command definitions while keeping verid command mentions blocked", () => {
    const rows = [
      "printf x > .claude/commands/superpowers/escape.md",
      "cp ordinary.md ~/.claude/commands/andrej-karpathy-skills/escape.md",
      'tee .claude/comm""ands/superpowers/escape.md',
      "rm -r nested/.claude/commands",
      "cat .claude/commands/verid/tip.md",
    ];
    for (const command of rows) {
      const r = hook(call("Bash", { command }));
      expect.soft(r.code, command).toBe(2);
      expect.soft(r.stderr, command).toContain("VERID_BURNT_HOOK_PROTECTED");
    }
  });

  it("does not let a developer override a command definition write", () => {
    const r = hook(
      call("Write", { file_path: ".claude/commands/superpowers/escape.md", content: "x" }),
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("VERID_BURNT_HOOK_PROTECTED");
    const tip = hook(
      { hook_event_name: "UserPromptSubmit", prompt: "/verid tip update the command" },
      true,
    );
    expect(tip.code).toBe(2);
    expect(tip.stderr).toContain("VERID_BURNT_OVERRIDE_FORBIDDEN");
  });
});

describe("Claude relocated user configuration protection", () => {
  it("judges config variable Bash paths like default home configuration", () => {
    const configDir = join(project, "user-config");
    const roots = [
      "$CLAUDE_CONFIG_DIR",
      "${CLAUDE_CONFIG_DIR}",
      "$env:CLAUDE_CONFIG_DIR",
      "~/.claude",
      "$HOME/.claude",
    ];
    const rows = [
      [`printf '{"disableAllHooks":true}' > "ROOT/settings.json"`, "VERID_BURNT_HOOK_PROTECTED"],
      ["cp evil.md ROOT/commands/superpowers/", "VERID_BURNT_HOOK_PROTECTED"],
      ["printf x > ROOT/agents/coder.md", "VERID_BURNT_HOOK_PROTECTED"],
      ["printf x > ROOT/skills/y/SKILL.md", "VERID_BURNT_HOOK_PROTECTED"],
      ['cat "ROOT/projects/a.jsonl"', "VERID_BURNT_TRANSCRIPT_PROTECTED"],
    ] as const;
    for (const root of roots) {
      for (const [template, code] of rows) {
        const command = template.replace("ROOT", root);
        const r = hook(call("Bash", { command }), false, configDir);
        expect.soft(r.code, command).toBe(2);
        expect.soft(r.stderr, command).toContain(code);
      }
    }
  });

  it("preserves config variable Bash mention rules and skill script access", () => {
    const configDir = join(project, "user-config");
    const roots = ["$CLAUDE_CONFIG_DIR", "${CLAUDE_CONFIG_DIR}", "$env:CLAUDE_CONFIG_DIR"];
    const rows = [
      ['cat "ROOT/agents/coder.md"', "VERID_BURNT_HOOK_PROTECTED"],
      ['cat "ROOT/plugins/x/agent.md"', "VERID_BURNT_HOOK_PROTECTED"],
      ['cat "ROOT/settings.json"', "VERID_BURNT_HOOK_PROTECTED"],
      ['cat "ROOT/commands/verid/tip.md"', "VERID_BURNT_HOOK_PROTECTED"],
      ['python "ROOT/skills/x/s.py"', "allow"],
      ['cat "ROOT/skills/x/SKILL.md"', "allow"],
      ['cat "ROOT/commands/superpowers/x.md"', "allow"],
    ] as const;
    for (const root of roots) {
      for (const [template, code] of rows) {
        const command = template.replace("ROOT", root);
        const r = hook(call("Bash", { command }), false, configDir);
        if (code === "allow") expect.soft(r.code, command).toBe(0);
        else {
          expect.soft(r.code, command).toBe(2);
          expect.soft(r.stderr, command).toContain(code);
        }
      }
    }
  });

  it("denies relative writes through existing configuration junctions", () => {
    const configDir = join(project, "user-config");
    const outside = join(project, "outside-config");
    mkdirSync(configDir);
    mkdirSync(outside);
    const rows = [
      ["skills", "custom/SKILL.md", "VERID_BURNT_HOOK_PROTECTED"],
      ["commands", "superpowers/escape.md", "VERID_BURNT_HOOK_PROTECTED"],
      ["agents", "custom.md", "VERID_BURNT_HOOK_PROTECTED"],
      ["plugins", "custom/agent.md", "VERID_BURNT_HOOK_PROTECTED"],
      ["projects", "project/session.jsonl", "VERID_BURNT_TRANSCRIPT_PROTECTED"],
    ] as const;
    for (const [dir, file, code] of rows) {
      symlinkSync(outside, join(configDir, dir), "junction");
      const path = `user-config/${dir}/${file}`;
      const tools = [
        ["Write", { file_path: path, content: "x" }],
        ["mcp__filesystem__write_file", { path, content: "x" }],
        ["Bash", { command: `printf x > ${path}` }],
      ] as const;
      for (const [tool, input] of tools) {
        const r = hook(call(tool, input), false, configDir);
        expect.soft(r.code, `${dir} ${tool}`).toBe(2);
        expect.soft(r.stderr, `${dir} ${tool}`).toContain(code);
      }
    }
  });

  it("denies file and recognized MCP writes to relocated definitions and settings", () => {
    const configDir = join(project, "user-config");
    const rows = [
      "skills/custom/SKILL.md",
      "commands/superpowers/escape.md",
      "agents/custom.md",
      "plugins/custom/agent.md",
      "settings.json",
      "settings.local.json",
    ];
    for (const relative of rows) {
      const path = join(configDir, relative);
      for (const tool of ["Write", "mcp__filesystem__write_file"]) {
        const r = hook(call(tool, { file_path: path, path, content: "x" }), false, configDir);
        expect.soft(r.code, `${relative} ${tool}`).toBe(2);
        expect.soft(r.stderr, `${relative} ${tool}`).toContain("VERID_BURNT_HOOK_PROTECTED");
      }
    }
  });

  it("denies parsed Bash writes and preserves mention rules in relocated configuration", () => {
    const configDir = join(project, "user-config");
    const rows = [
      `printf x > "${join(configDir, "skills/custom/SKILL.md")}"`,
      `cp ordinary.md "${join(configDir, "commands/superpowers/escape.md")}"`,
      `cat "${join(configDir, "agents/custom.md")}"`,
      `cat "${join(configDir, "plugins/custom/agent.md")}"`,
      `cat "${join(configDir, "settings.json")}"`,
      `cat "${join(configDir, "commands/verid/tip.md")}"`,
    ];
    for (const command of rows) {
      const r = hook(call("Bash", { command }), false, configDir);
      expect.soft(r.code, command).toBe(2);
      expect.soft(r.stderr, command).toContain("VERID_BURNT_HOOK_PROTECTED");
    }
  });

  it("denies reads and writes to relocated transcripts", () => {
    const configDir = join(project, "user-config");
    const path = join(configDir, "projects/project/session.jsonl");
    const rows = [
      ["Read", { file_path: path }],
      ["Write", { file_path: path, content: "x" }],
      ["mcp__filesystem__read_file", { path }],
      ["Bash", { command: `cat "${path}"` }],
    ] as const;
    for (const [tool, input] of rows) {
      const r = hook(call(tool, input), false, configDir);
      expect.soft(r.code, tool).toBe(2);
      expect.soft(r.stderr, tool).toContain("VERID_BURNT_TRANSCRIPT_PROTECTED");
    }
  });

  it("denies relative Bash mentions of protected relocated configuration", () => {
    const configDir = join(project, "user-config");
    const rows = [
      [project, "cat user-config/agents/custom.md", "VERID_BURNT_HOOK_PROTECTED"],
      [project, "cat user-config/plugins/custom/agent.md", "VERID_BURNT_HOOK_PROTECTED"],
      [project, "cat user-config/settings.json", "VERID_BURNT_HOOK_PROTECTED"],
      [project, "cat user-config/commands/verid/tip.md", "VERID_BURNT_HOOK_PROTECTED"],
      [
        project,
        "cat user-config/projects/project/session.jsonl",
        "VERID_BURNT_TRANSCRIPT_PROTECTED",
      ],
      [
        join(project, "nested"),
        "cat ../user-config/agents/custom.md",
        "VERID_BURNT_HOOK_PROTECTED",
      ],
      [
        join(project, "nested"),
        "cat ../user-config/projects/project/session.jsonl",
        "VERID_BURNT_TRANSCRIPT_PROTECTED",
      ],
      [configDir, "cat agents/custom.md", "VERID_BURNT_HOOK_PROTECTED"],
      [configDir, "cat projects/project/session.jsonl", "VERID_BURNT_TRANSCRIPT_PROTECTED"],
    ] as const;
    for (const [cwd, command, code] of rows) {
      const r = hook({ ...call("Bash", { command }), cwd }, false, configDir);
      expect.soft(r.code, command).toBe(2);
      expect.soft(r.stderr, command).toContain(code);
    }
  });

  it("keeps default user configuration protected when configuration is relocated", () => {
    const configDir = join(project, "user-config");
    const rows = [
      [
        "Write",
        { file_path: join(homedir(), ".claude/agents/custom.md"), content: "x" },
        "VERID_BURNT_HOOK_PROTECTED",
      ],
      [
        "Write",
        { file_path: join(homedir(), ".claude/settings.json"), content: "x" },
        "VERID_BURNT_HOOK_PROTECTED",
      ],
      [
        "Read",
        { file_path: join(homedir(), ".claude/projects/project/session.jsonl") },
        "VERID_BURNT_TRANSCRIPT_PROTECTED",
      ],
    ] as const;
    for (const [tool, input, code] of rows) {
      const r = hook(call(tool, input), false, configDir);
      expect(r.code, tool).toBe(2);
      expect(r.stderr).toContain(code);
    }
  });

  it("allows reading and running relocated skill scripts and writing unrelated files", () => {
    const configDir = join(project, "user-config");
    const rows = [
      ["Read", { file_path: join(configDir, "skills/custom/SKILL.md") }],
      ["Bash", { command: `cat "${join(configDir, "skills/custom/SKILL.md")}"` }],
      ["Bash", { command: `python "${join(configDir, "skills/custom/scripts/run.py")}"` }],
      ["Write", { file_path: join(configDir, "skills-notes.md"), content: "notes" }],
      ["Write", { file_path: join(project, "other-config/agents/custom.md"), content: "notes" }],
    ] as const;
    for (const [tool, input] of rows)
      expect(hook(call(tool, input), false, configDir).code, tool).toBe(0);
  });
});
