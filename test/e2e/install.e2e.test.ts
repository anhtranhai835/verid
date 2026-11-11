import { tempDirs, TEST_ROOT as root } from "../support/project.js";
const tempDir = tempDirs("verid-installed-", "suite");
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { developerEnv } from "./helpers.js";

const SESSION = "11111111-2222-3333-4444-555555555555";

// A developer's terminal: no CLAUDE_* variables at all.
const cleanEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...developerEnv(),
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

describe("npm skill distribution", () => {
  it("packs every bundled skill with its licenses and debugging support files", () => {
    const cache = tempDir("verid-pack-cache-");
    const result = sh(
      "npm pack --dry-run --json --ignore-scripts",
      root,
      cleanEnv({ npm_config_cache: cache }),
    );
    expect(result.code, result.stderr).toBe(0);
    const files = JSON.parse(result.stdout)[0].files.map((file: { path: string }) => file.path);
    for (const name of [
      "ba",
      "modules",
      "design",
      "plan",
      "build",
      "tdd",
      "debugging",
      "review",
      "security",
      "edge-cases",
      "problem-solving",
      "predict",
      "backend-development",
      "frontend-development",
      "databases",
      "devops",
      "mobile-development",
      "web-testing",
      "react-best-practices",
      "mcp-builder",
      "context-engineering",
      "ui-ux-pro-max",
      "security-scan",
      "docs-seeker",
    ])
      expect(files).toContain(`plugin/skills/${name}/SKILL.md`);
    for (const name of [
      "brainstormer",
      "technical-researcher",
      "code-simplifier",
      "docs-manager",
      "ui-ux-designer",
      "project-manager",
      "debugger",
    ])
      expect(files).toContain(`plugin/agents/${name}.md`);
    for (const name of ["tdd", "debugging", "design", "plan", "review"])
      expect(files).toContain(`plugin/skills/${name}/LICENSE`);
    for (const name of [
      "root-cause-tracing.md",
      "defense-in-depth.md",
      "condition-based-waiting.md",
      "condition-based-waiting-example.ts",
      "find-polluter.sh",
    ])
      expect(files).toContain(`plugin/skills/debugging/${name}`);
    expect(files).not.toContain("plugin/skills/debugging/CREATION-LOG.md");
    for (const path of [
      "plugin/templates/workflow.md",
      "plugin/templates/module/spec/spec.md",
      "docs/modular-cook.md",
      "dist/cli.js",
      "CHANGELOG.md",
    ])
      expect(files).toContain(path);
    // The release tarball carries the built CLI, not the sources, tests or release tooling.
    expect(
      files.filter((path: string) => /^(src|test|scripts|plans|\.github|\.verid)\//.test(path)),
    ).toEqual([]);
  }, 60_000);

  // npm skips the private check on --dry-run, so publish for real to a closed local port with a
  // dummy token: the version lookup fails at once without retries, then npm refuses to upload.
  it("refuses to publish because the package is private", () => {
    const result = sh(
      'npm publish --ignore-scripts --fetch-retries=0 --no-update-notifier --registry http://127.0.0.1:9/ "--//127.0.0.1:9/:_authToken=dummy"',
      root,
      cleanEnv({ npm_config_cache: tempDir("verid-publish-cache-") }),
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("EPRIVATE");
  }, 60_000);
});

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
