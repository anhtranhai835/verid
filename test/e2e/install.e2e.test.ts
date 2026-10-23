import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Installs verid the ways README.md gives, each into a throwaway prefix so this machine's own
// setup is untouched, then uses the `verid` command a developer gets on their PATH.
const root = join(import.meta.dirname, "..", "..");
const SESSION = "11111111-2222-3333-4444-555555555555";

const dirs: string[] = [];
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A developer's terminal: no CLAUDE_* variables at all.
const cleanEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE"))),
  ...extra,
});

// Windows names it Path: setting PATH beside it would leave two.
function withBin(bin: string): NodeJS.ProcessEnv {
  const env = cleanEnv();
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  return { ...env, [key]: `${bin}${delimiter}${env[key] ?? ""}` };
}

// Through a shell, as the developer types it: on Windows that finds the .cmd or .exe shim.
function sh(command: string, cwd: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync(command, { cwd, env, shell: true, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const hasBun = sh("bun --version", root, cleanEnv()).code === 0;

const installs = [
  {
    name: "npm",
    available: true,
    install: () => {
      const prefix = tempDir("verid-npm-");
      expect(sh(`npm install -g --prefix "${prefix}" "${root}"`, root, cleanEnv()).code).toBe(0);
      return process.platform === "win32" ? prefix : join(prefix, "bin");
    },
  },
  {
    name: "bun",
    available: hasBun,
    install: () => {
      const home = tempDir("verid-bun-");
      expect(sh("bun link", root, cleanEnv({ BUN_INSTALL: home })).code).toBe(0);
      return join(home, "bin");
    },
  },
];

describe.each(installs)("verid installed with $name", ({ available, install }) => {
  it.skipIf(!available)(
    "is on the PATH: cook sets a project up, peek sees the hooks, and the hooks block",
    () => {
      const env = withBin(install());
      const project = tempDir("verid-installed-");
      // A project cook recognises: vitest and a src/ folder.
      writeFileSync(
        join(project, "package.json"),
        JSON.stringify({ devDependencies: { vitest: "^5.0.0" } }),
      );
      mkdirSync(join(project, "src"));

      expect(sh("verid cook --mode remix", project, env)).toMatchObject({ code: 0, stderr: "" });
      // status warns on stderr when this machine's hooks are not registered
      expect(sh("verid peek", project, env)).toMatchObject({ code: 0, stderr: "" });

      // The PreToolUse command cook registered, run as Claude Code runs it.
      const settings = JSON.parse(
        readFileSync(join(project, ".claude", "settings.local.json"), "utf8"),
      );
      const handler = settings.hooks.PreToolUse.at(-1).hooks.at(-1);
      // cook maps verid's coder: production code comes from that subagent.
      const write = {
        agent_id: "a1b2c3",
        agent_type: "verid:coder",
        session_id: SESSION,
        transcript_path: join(project, "transcript.jsonl"),
        cwd: project,
        permission_mode: "acceptEdits",
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: join(project, "src", "a.ts"), content: "x" },
      };
      const r = spawnSync(handler.command, handler.args, {
        cwd: project,
        input: JSON.stringify(write),
        env: { ...env, CLAUDE_PROJECT_DIR: project },
        encoding: "utf8",
      });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("verid [VERID_BURNT_TDD_NO_FAILING_TEST]");
    },
    120_000,
  );
});
