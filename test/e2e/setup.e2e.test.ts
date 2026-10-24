import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = join(import.meta.dirname, "../..");
const CLI = join(root, "dist/cli.js");
const HOOK = join(root, "dist/hook.js");
let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-setup-"));
});
afterEach(() => rmSync(project, { recursive: true, force: true }));
const env = () =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE")));
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(project, rel)), { recursive: true });
  writeFileSync(join(project, rel), text);
};
const read = (rel: string) => readFileSync(join(project, rel), "utf8");
const cli = (args: string[], extra = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: project,
    env: { ...env(), ...extra },
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const snapshot = () =>
  Object.fromEntries(
    readdirSync(project, { recursive: true }).map((name) => {
      const path = join(project, String(name));
      return [
        String(name),
        statSync(path).isDirectory()
          ? "directory"
          : [readFileSync(path, "hex"), statSync(path).mtimeMs],
      ];
    }),
  );
const legacy = () => {
  put(
    ".verid/manifest.yaml",
    [
      "# keep my comment",
      "schemaVersion: 1",
      "mode: remix",
      "roles:",
      "  reviewer: [my:reviewer]",
      "repos:",
      "  - path: .",
      "    source_globs: [src/**]",
      "    test_globs: ['**/test/**']",
      "    test_cmd: npx vitest run --reporter=junit --outputFile={junit}",
      "",
    ].join("\n"),
  );
  put(".verid/.state/state.json", '{"schemaVersion":1,"language":"en"}\n');
  put(
    ".claude/settings.local.json",
    JSON.stringify({
      permissions: { allow: ["Read"] },
      hooks: {
        PreToolUse: [
          { hooks: [{ type: "command", command: "node", args: ["C:/old/verid/dist/hook.js"] }] },
        ],
      },
    }),
  );
  put(".claude/commands/verid/tip.md", "old command\n");
  put(".claude/commands/mine.md", "my command\n");
};

describe("setup commands", () => {
  it("previews cook and upgrade without changing any file, timestamp or cache", () => {
    const rows = [
      { old: false, args: ["cook", "--mode", "prep", "--dry-run"] },
      { old: false, args: ["cook", "--dry-run"] },
      { old: true, args: ["cook", "--yes", "--dry-run"] },
      { old: true, args: ["upgrade", "--dry-run"] },
    ];
    for (const row of rows) {
      if (row.old) legacy();
      const before = snapshot();
      const r = cli(row.args);
      expect(r.code, r.err).toBe(0);
      expect(r.out).toContain("├──");
      expect(r.out).toContain("manifest.yaml");
      expect(r.out).toContain("tip.md");
      expect(r.out).not.toContain("Apply?");
      expect(snapshot()).toEqual(before);
    }
  });

  it("accepts cook defaults with --yes and preserves the existing non-terminal flag path", () => {
    const rows = [
      { args: ["cook", "--yes"], mode: "prep" },
      { args: ["cook", "--mode", "remix"], mode: "remix" },
    ];
    for (const { args, mode } of rows) {
      rmSync(join(project, ".verid"), { recursive: true, force: true });
      const r = cli(args);
      expect(r.code, r.err).toBe(0);
      expect(parse(read(".verid/manifest.yaml")).mode).toBe(mode);
      expect(r.out).toContain("+ manifest.yaml");
      expect(r.out).not.toContain("Apply?");
    }
  });

  it("writes only previewed setup files and leaves manifest caching to the hook", () => {
    const rows = [
      { old: false, args: ["cook", "--yes"] },
      { old: true, args: ["upgrade", "--yes"] },
    ];
    for (const row of rows) {
      rmSync(join(project, ".verid"), { recursive: true, force: true });
      if (row.old) legacy();
      const r = cli(row.args);
      expect(r.code, r.err).toBe(0);
      expect(r.out).toContain("state.json");
      expect(readdirSync(join(project, ".verid/.state"))).toEqual(["state.json"]);
    }
  });

  it("prints each setup file and the command header only once", () => {
    const rows = [
      { args: ["cook", "--yes"], header: "verid cook (" },
      { args: ["upgrade", "--yes"], header: "verid upgrade (" },
    ];
    for (const { args, header } of rows) {
      const r = cli(args);
      expect(r.code, r.err).toBe(0);
      expect(r.out.split(header)).toHaveLength(2);
      expect(
        r.out.split("\n").filter((line) => /[+~=] settings\.local\.json$/.test(line)),
      ).toHaveLength(1);
      expect(r.out).not.toMatch(/^\s+(created|updated|kept)\s+/m);
    }
  });

  it("refuses upgrade without a terminal or --yes and writes nothing", () => {
    legacy();
    const before = snapshot();
    const r = cli(["upgrade"]);
    expect(r.code, r.err).toBe(2);
    expect(r.err).toContain("--yes");
    expect(r.err).toContain("terminal");
    expect(snapshot()).toEqual(before);
  });

  it("upgrades the old manifest and commands and refreshes every installed hook path", () => {
    legacy();
    const r = cli(["upgrade", "--yes"]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("~ manifest.yaml");
    expect(r.out).toContain("~ tip.md");
    const text = read(".verid/manifest.yaml");
    expect(text).toContain("# keep my comment");
    const manifest = parse(text);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.roles).toEqual({
      reviewer: ["my:reviewer"],
      researcher: ["verid:researcher"],
      architect: ["verid:architect"],
      planner: ["verid:planner"],
      qa: ["verid:qa"],
    });
    expect(manifest.repos[0].test_cmd).toBeUndefined();
    expect(manifest.repos[0].e2e_globs).toEqual(["**/e2e/**", "**/*.e2e.*"]);
    expect(manifest.repos[0].ignore_globs).toContain(".claude/**");
    expect(read(".claude/commands/verid/tip.md")).toContain("disable-model-invocation: true");
    expect(read(".claude/commands/mine.md")).toBe("my command\n");
    const settings = JSON.parse(read(".claude/settings.local.json"));
    expect(settings.permissions).toEqual({ allow: ["Read"] });
    for (const event of [
      "PreToolUse",
      "UserPromptSubmit",
      "Stop",
      "SubagentStop",
      "SessionStart",
    ]) {
      expect(settings.hooks[event]).toHaveLength(1);
      expect(relative(root, settings.hooks[event][0].hooks[0].args[0]).replaceAll("\\", "/")).toBe(
        "dist/hook.js",
      );
    }
    const before = snapshot();
    expect(cli(["upgrade", "--yes"]).code).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it("refuses upgrade inside Claude Code and requires an existing manifest", () => {
    const rows = [
      { extra: {}, code: "VERID_BURNT_MANIFEST_MISSING" },
      { extra: { CLAUDECODE: "1" }, code: "VERID_BURNT_INIT_IN_AGENT" },
    ];
    for (const row of rows) {
      const r = cli(["upgrade", "--yes"], row.extra);
      expect(r.code).toBe(2);
      expect(r.err).toContain(row.code);
      expect(existsSync(join(project, ".verid"))).toBe(false);
    }
  });

  it("keeps upgrade out of the agent's Bash through the real hook", () => {
    put(".verid/.state/state.json", '{"schemaVersion":1}');
    const rows = [
      "verid upgrade --yes",
      "verid.cmd upgrade --dry-run",
      'node "C:/x/verid/dist/cli.js" upgrade',
    ];
    for (const command of rows) {
      const r = spawnSync(process.execPath, [HOOK], {
        cwd: project,
        env: { ...env(), CLAUDE_PROJECT_DIR: project },
        encoding: "utf8",
        input: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: "setup",
          cwd: project,
          tool_name: "Bash",
          tool_input: { command },
        }),
      });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("VERID_BURNT_BASH_DEVELOPER_ONLY");
      expect(r.stderr).toContain("`upgrade`");
    }
  });
});
