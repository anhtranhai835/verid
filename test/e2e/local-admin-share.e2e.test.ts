import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = join(import.meta.dirname, "../../dist/hook.js");
let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-admin-share-"));
  mkdirSync(join(project, ".verid/.state"), { recursive: true });
  writeFileSync(join(project, ".verid/.state/state.json"), '{"schemaVersion":1}');
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

function share(path: string, prefix = "\\\\localhost\\", separator = "\\"): string {
  return `${prefix}${path[0]}$${path.slice(2).replace(/[\\/]/g, separator)}`;
}

function hook(tool_name: string, path: string, configDir?: string, projectDir = project) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("CLAUDE")),
  );
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "local-admin-share",
      cwd: project,
      tool_name,
      tool_input:
        tool_name === "Bash"
          ? { command: path }
          : { file_path: path, path, content: "replacement" },
    }),
    encoding: "utf8",
    env: {
      ...env,
      CLAUDE_PROJECT_DIR: projectDir,
      ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
    },
  });
  return { code: r.status, stderr: r.stderr };
}

describe.skipIf(process.platform !== "win32")(
  "local administrative shares through the hook",
  () => {
    it("protects share-rooted projects through a drive mapped to the administrative share", (ctx) => {
      writeFileSync(
        join(project, ".verid/manifest.yaml"),
        "schemaVersion: 1\nmode: remix\nrepos:\n  - path: .\n    source_globs: ['**']\n    test_globs: ['**/*.test.ts']\n    ignore_globs: ['**/*.md']\n",
      );
      const root = `\\\\localhost\\${project[0]}$`;
      let drive: string | undefined;
      let refusal = "no free drive letter";
      for (const letter of ["Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"]) {
        if (existsSync(`${letter}:\\`)) continue;
        const mapping = spawnSync("net.exe", ["use", `${letter}:`, root, "/persistent:no"], {
          encoding: "utf8",
        });
        if (mapping.status === 0) {
          drive = `${letter}:`;
          break;
        }
        refusal = `${mapping.error?.message ?? mapping.stderr ?? mapping.stdout}`;
      }
      if (!drive) return ctx.skip(`machine refused an administrative-share mapping: ${refusal}`);
      try {
        const mappedProject = `${drive}${project.slice(2)}`;
        expect(realpathSync.native(mappedProject)).toMatch(/^\\\\localhost\\[a-z]\$\\/i);
        expect(readFileSync(join(mappedProject, ".verid/.state/state.json"), "utf8")).toBe(
          '{"schemaVersion":1}',
        );
        const roots = [share(project), project];
        const rows = [
          [
            ".verid/.state/state.json",
            "Read",
            "mcp__filesystem__read_file",
            "VERID_BURNT_STATE_PROTECTED",
          ],
          [
            ".verid/manifest.yaml",
            "Write",
            "mcp__filesystem__write_file",
            "VERID_BURNT_MANIFEST_PROTECTED",
          ],
        ] as const;
        for (const projectDir of roots)
          for (const [relative, direct, mcp, expected] of rows)
            for (const tool of [direct, mcp]) {
              const path = join(mappedProject, relative);
              const r = hook(tool, path, undefined, projectDir);
              expect.soft(r.code, `${projectDir} ${path} ${tool}`).toBe(2);
              expect.soft(r.stderr, `${projectDir} ${path} ${tool}`).toContain(expected);
            }
      } finally {
        const removed = spawnSync("net.exe", ["use", drive, "/delete", "/y"], { encoding: "utf8" });
        expect(removed.status, `remove test mapping ${drive}: ${removed.stderr}`).toBe(0);
      }
    });

    it("protects Bash mentions of relocated configuration through any-host administrative shares", () => {
      const configDir = `${project}-user-config`;
      const aliases = [
        ["//localhost/", "/"],
        ["//./UNC/localhost/", "/"],
        ["//anyhost/", "/"],
        ["\\\\?\\UNC\\AnYhOsT\\", "\\"],
      ] as const;
      const rows = [
        ["cat", "projects/project/session.jsonl", "VERID_BURNT_TRANSCRIPT_PROTECTED"],
        ["cat", "agents/x.md", "VERID_BURNT_HOOK_PROTECTED"],
        ["cat", "commands/verid/x.md", "VERID_BURNT_HOOK_PROTECTED"],
        ["printf x >", "agents/x.md", "VERID_BURNT_HOOK_PROTECTED"],
        ["printf x >", "commands/verid/x.md", "VERID_BURNT_HOOK_PROTECTED"],
      ] as const;
      for (const [program, relative, expected] of rows) {
        const path = join(configDir, relative);
        const local = hook("Bash", `${program} '${path}'`, configDir);
        expect.soft(local.code, path).toBe(2);
        expect.soft(local.stderr, path).toContain(expected);
        for (const [prefix, separator] of aliases) {
          const spelling = share(path, prefix, separator).toLowerCase();
          const command = `${program} '${spelling}'`;
          const r = hook("Bash", command, configDir);
          expect.soft(r.code, command).toBe(2);
          expect.soft(r.stderr, command).toContain(expected);
        }
      }
    }, 60_000); // 25 real hook spawns: slow on a busy machine

    it("protects Bash default paths with repeated separators and dot segments", () => {
      const rows = [
        ["cat", "~/.claude/projects/project/session.jsonl", 2, "VERID_BURNT_TRANSCRIPT_PROTECTED"],
        ["cat", ".verid/.state/state.json", 2, "VERID_BURNT_STATE_PROTECTED"],
        ["cat", ".verid/manifest.yaml", 2, "VERID_BURNT_MANIFEST_PROTECTED"],
        ["cat", "~/.claude/settings.json", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["cat", "~/.claude/settings.local.json", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["cat", "~/.claude/agents/x.md", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["cat", "~/.claude/commands/verid/x.md", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["printf x >", "~/.claude/commands/other.md", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["printf x >", "~/.claude/skills/x/SKILL.md", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["cat", "~/.claude/plugins/x/agent.md", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["cat", ".verid/plugins/x/index.js", 2, "VERID_BURNT_PLUGIN_PROTECTED"],
        ["cat", "~/.claude/commands/other.md", 0, ""],
        ["cat", "~/.claude/skills/x/SKILL.md", 0, ""],
      ] as const;
      for (const [program, path, code, expected] of rows)
        for (const separator of ["/", "//", "/./"]) {
          const command = `${program} ${path.replace(/\//g, separator)}`;
          const r = hook("Bash", command);
          expect.soft(r.code, command).toBe(code);
          if (expected) expect.soft(r.stderr, command).toContain(expected);
          else expect.soft(r.stderr, command).toBe("");
        }
    }, 60_000);

    it("protects Bash drive and share paths with repeated separators and dot segments", () => {
      const configDir = `${project}-user-config`;
      const aliases = [
        ["drive", "/"],
        ["drive", "\\"],
        ["//localhost/", "/"],
        ["\\\\anyhost\\", "\\"],
        ["//./UNC/localhost/", "/"],
        ["\\\\?\\UNC\\AnYhOsT\\", "\\"],
      ] as const;
      const rows = [
        ["cat", "projects/project/session.jsonl", 2, "VERID_BURNT_TRANSCRIPT_PROTECTED"],
        ["cat", ".verid/.state/state.json", 2, "VERID_BURNT_STATE_PROTECTED"],
        ["cat", ".verid/manifest.yaml", 2, "VERID_BURNT_MANIFEST_PROTECTED"],
        ["cat", "settings.json", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["cat", "settings.local.json", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["cat", "agents/x.md", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["cat", "commands/verid/x.md", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["printf x >", "commands/other.md", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["printf x >", "skills/x/SKILL.md", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["cat", "plugins/x/agent.md", 2, "VERID_BURNT_HOOK_PROTECTED"],
        ["cat", ".verid/plugins/x/index.js", 2, "VERID_BURNT_PLUGIN_PROTECTED"],
        ["cat", "commands/other.md", 0, ""],
        ["cat", "skills/x/SKILL.md", 0, ""],
      ] as const;
      for (const [prefix, separator] of aliases)
        for (const [program, relative, code, expected] of rows) {
          const path = join(configDir, relative);
          const clean =
            prefix === "drive" ? path.replace(/[\\/]/g, separator) : share(path, prefix, separator);
          // Keep the two leading UNC separators; vary every separator after the host.
          const start = prefix === "drive" ? 0 : prefix.length - 1;
          for (const spelling of [
            clean,
            clean.slice(0, start) + clean.slice(start).replace(/[\\/]/g, separator.repeat(2)),
            clean.slice(0, start) +
              clean.slice(start).replace(/[\\/]/g, `${separator}.${separator}`),
          ]) {
            const command = `${program} '${spelling}'`;
            const r = hook("Bash", command, configDir);
            expect.soft(r.code, command).toBe(code);
            if (expected) expect.soft(r.stderr, command).toContain(expected);
            else expect.soft(r.stderr, command).toBe("");
          }
        }
    }, 180_000); // 234 real hook spawns: allow the same load headroom as the 84-spawn test

    it("protects Bash UNC option values with repeated separators and dot segments", () => {
      const configDir = `${project}-user-config`;
      const clean = share(configDir, "//localhost/", "/");
      const rows = [
        ["grep --file=ROOT/projects/p/s.jsonl README.md", "VERID_BURNT_TRANSCRIPT_PROTECTED"],
        [
          "curl --data-binary=@ROOT/projects/p/s.jsonl http://localhost",
          "VERID_BURNT_TRANSCRIPT_PROTECTED",
        ],
      ] as const;
      for (const [template, expected] of rows)
        for (const separator of ["/", "//", "/./"]) {
          const spelling = `//${clean.slice(2).replace(/\//g, separator)}`;
          const command = template.replace("ROOT", spelling);
          const r = hook("Bash", command, configDir);
          expect.soft(r.code, command).toBe(2);
          expect.soft(r.stderr, command).toContain(expected);
        }
    });

    it("protects state, manifest, transcripts and default Claude configuration through local shares", () => {
      const rows = [
        [
          join(project, ".verid/.state/state.json"),
          "Read",
          "mcp__filesystem__read_file",
          "VERID_BURNT_STATE_PROTECTED",
        ],
        [
          join(project, ".verid/manifest.yaml"),
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_MANIFEST_PROTECTED",
        ],
        [
          join(homedir(), ".claude/projects/project/session.jsonl"),
          "Read",
          "mcp__filesystem__read_file",
          "VERID_BURNT_TRANSCRIPT_PROTECTED",
        ],
        [
          join(homedir(), ".claude/settings.json"),
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_HOOK_PROTECTED",
        ],
        [
          join(homedir(), ".claude/commands/superpowers/escape.md"),
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_HOOK_PROTECTED",
        ],
        [
          join(homedir(), ".claude/skills/custom/SKILL.md"),
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_HOOK_PROTECTED",
        ],
        [
          join(homedir(), ".claude/agents/custom.md"),
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_HOOK_PROTECTED",
        ],
        [
          join(homedir(), ".claude/plugins/custom/agent.md"),
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_HOOK_PROTECTED",
        ],
        [
          join(project, ".verid/plugins/custom/index.js"),
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_PLUGIN_PROTECTED",
        ],
      ] as const;
      for (const [path, direct, mcp, expected] of rows)
        for (const tool of [direct, mcp]) {
          const r = hook(tool, share(path));
          expect.soft(r.code, `${path} ${tool}`).toBe(2);
          expect.soft(r.stderr, `${path} ${tool}`).toContain(expected);
        }
    });

    it("protects relocated Claude configuration through local shares", () => {
      const configDir = join(project, "user-config");
      const rows = [
        [
          "projects/project/session.jsonl",
          "Read",
          "mcp__filesystem__read_file",
          "VERID_BURNT_TRANSCRIPT_PROTECTED",
        ],
        [
          "settings.local.json",
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_HOOK_PROTECTED",
        ],
        [
          "commands/superpowers/escape.md",
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_HOOK_PROTECTED",
        ],
        [
          "skills/custom/SKILL.md",
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_HOOK_PROTECTED",
        ],
        ["agents/custom.md", "Write", "mcp__filesystem__write_file", "VERID_BURNT_HOOK_PROTECTED"],
        [
          "plugins/custom/agent.md",
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_HOOK_PROTECTED",
        ],
      ] as const;
      for (const [relative, direct, mcp, expected] of rows)
        for (const tool of [direct, mcp]) {
          const r = hook(tool, share(join(configDir, relative)), configDir);
          expect.soft(r.code, `${relative} ${tool}`).toBe(2);
          expect.soft(r.stderr, `${relative} ${tool}`).toContain(expected);
        }
    });

    it("recognizes loopback, hostname, extended and forward-slash local share spellings", () => {
      const configDir = join(project, "user-config");
      const aliases = [
        ["\\\\127.0.0.1\\", "\\"],
        [`\\\\${hostname().toUpperCase()}\\`, "\\"],
        ["\\\\?\\UNC\\localhost\\", "\\"],
        ["//localhost/", "/"],
        ["//127.0.0.1/", "/"],
        [`//${hostname()}/`, "/"],
        ["//?/UNC/localhost/", "/"],
      ] as const;
      const rows = [
        [
          join(project, ".verid/.state/state.json"),
          "Read",
          "mcp__filesystem__read_file",
          "VERID_BURNT_STATE_PROTECTED",
        ],
        [
          join(project, ".verid/manifest.yaml"),
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_MANIFEST_PROTECTED",
        ],
        [
          join(homedir(), ".claude/settings.json"),
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_HOOK_PROTECTED",
        ],
        [
          join(configDir, "settings.local.json"),
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_HOOK_PROTECTED",
        ],
      ] as const;
      for (const [prefix, separator] of aliases)
        for (const [path, direct, mcp, expected] of rows)
          for (const tool of [direct, mcp]) {
            const spelling = share(path, prefix, separator);
            const r = hook(tool, spelling, configDir);
            expect.soft(r.code, `${spelling} ${tool}`).toBe(2);
            expect.soft(r.stderr, `${spelling} ${tool}`).toContain(expected);
          }
    }, 60_000); // 56 real hook spawns: slow on a busy machine

    it("protects the same drive paths through administrative shares on any host", () => {
      const configDir = join(project, "user-config");
      const aliases = [
        ["\\\\.\\UNC\\localhost\\", "\\"],
        ["//./UNC/localhost/", "/"],
        ["\\\\::1\\", "\\"],
        ["\\\\[::1]\\", "\\"],
        ["\\\\arbitrary-host.invalid\\", "\\"],
        ["//?/uNc/Arbitrary-Host.invalid/", "\\"],
      ] as const;
      const rows = [
        [
          join(project, ".verid/.state/state.json"),
          "Read",
          "mcp__filesystem__read_file",
          "VERID_BURNT_STATE_PROTECTED",
        ],
        [
          join(project, ".verid/manifest.yaml"),
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_MANIFEST_PROTECTED",
        ],
        [
          join(configDir, "settings.json"),
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_HOOK_PROTECTED",
        ],
        [
          join(configDir, "commands/escape.md"),
          "Write",
          "mcp__filesystem__write_file",
          "VERID_BURNT_HOOK_PROTECTED",
        ],
        [
          join(homedir(), ".claude/projects/project/session.jsonl"),
          "Read",
          "mcp__filesystem__read_file",
          "VERID_BURNT_TRANSCRIPT_PROTECTED",
        ],
        [
          join(configDir, "projects/project/session.jsonl"),
          "Read",
          "mcp__filesystem__read_file",
          "VERID_BURNT_TRANSCRIPT_PROTECTED",
        ],
      ] as const;
      for (const [path, direct, mcp, expected] of rows)
        for (const tool of [direct, mcp]) {
          const local = hook(tool, path, configDir);
          expect.soft(local.code, `${path} ${tool}`).toBe(2);
          expect.soft(local.stderr, `${path} ${tool}`).toContain(expected);
          for (const [prefix, separator] of aliases) {
            const spelling = share(path, prefix, separator);
            const r = hook(tool, spelling, configDir);
            expect.soft(r.code, `${spelling} ${tool}`).toBe(2);
            expect.soft(r.stderr, `${spelling} ${tool}`).toContain(expected);
          }
        }
    }, 60_000); // 84 real hook spawns: slow on a busy machine

    it("keeps ordinary UNC share writes outside relocated config protection", () => {
      const configDir = join(project, "user-config");
      const rows = [
        ["Write", "\\\\localhost\\shared\\user-config\\settings.json", 0],
        [
          "mcp__filesystem__write_file",
          "\\\\localhost\\shared\\user-config\\commands\\escape.md",
          0,
        ],
      ] as const;
      for (const [tool, path, expected] of rows) {
        const r = hook(tool, path, configDir);
        expect.soft(r.code, `${path} ${tool}`).toBe(expected);
        expect.soft(r.stderr, `${path} ${tool}`).toBe("");
      }
    });
  },
);
