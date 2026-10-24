import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { verifyAuditChain } from "../../src/adapters/audit-log.js";
import { inputHash } from "../../src/adapters/claude-code.js";

const ROOT = resolve(import.meta.dirname, "../..");
const CLI = join(ROOT, "dist/cli.js");
const HOOK = join(ROOT, "dist/hook.js");
const RUNNER = join(import.meta.dirname, "fake-runner.mjs");
let project: string;
let fixture: string;
const env = (extra: NodeJS.ProcessEnv = {}) => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("CLAUDE") && !key.startsWith("GIT_"),
    ),
  ),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: join(project, "gitconfig"),
  XDG_CONFIG_HOME: project,
  CLAUDE_PROJECT_DIR: project,
  ...extra,
});
const put = (path: string, text: string) => {
  mkdirSync(resolve(project, path, ".."), { recursive: true });
  writeFileSync(join(project, path), text);
};
const json = (path: string) => JSON.parse(readFileSync(join(project, path), "utf8"));
const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: project,
    env: env(extra),
    encoding: "utf8",
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
const hook = (
  tool: string,
  input: Record<string, unknown>,
  event = "PreToolUse",
  extra: NodeJS.ProcessEnv = {},
) => {
  const r = spawnSync(process.execPath, [HOOK], {
    cwd: project,
    env: env(extra),
    encoding: "utf8",
    input: JSON.stringify({
      hook_event_name: event,
      cwd: project,
      session_id: "plugin-session",
      tool_name: tool,
      tool_input: input,
      ...input,
    }),
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
const audit = (): Record<string, any>[] =>
  readFileSync(join(project, ".verid/.state/audit.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
const pluginManifest = (
  events: Record<string, string> = {
    "module-opened": "record.mjs",
    "module-served": "record.mjs",
    taste: "record.mjs",
    "drive-stuck": "record.mjs",
    "drive-done": "record.mjs",
  },
) => ({ name: "board", version: "1.0.0", events, requires: ["node"] });
const recordScript = `import fs from 'node:fs'; import path from 'node:path';
let raw = ''; for await (const c of process.stdin) raw += c;
fs.appendFileSync(path.join(process.env.VERID_PLUGIN_DATA, 'events.jsonl'), JSON.stringify({payload:JSON.parse(raw), cwd:process.cwd(), data:process.env.VERID_PLUGIN_DATA})+'\\n');
console.log(JSON.stringify({decision:'allow',updates:[{state:'PLATED'}]}));`;
const events = (): Record<string, any>[] =>
  readFileSync(join(project, ".verid/plugin-data/board/events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-plugins-"));
  fixture = join(project, "fixture");
  writeFileSync(join(project, "gitconfig"), "");
  mkdirSync(fixture);
  writeFileSync(join(fixture, "verid-plugin.json"), JSON.stringify(pluginManifest()));
  writeFileSync(join(fixture, "record.mjs"), recordScript);
  put(".verid/.state/state.json", '{"schemaVersion":1,"language":"en"}');
  put(
    ".verid/manifest.yaml",
    `schemaVersion: 1\nmode: prep\nrepos:\n  - path: .\n    test_cmd: ${JSON.stringify(`"${process.execPath}" "${RUNNER}" {junit}`)}\n    source_globs: ["src/**"]\n    test_globs: ["test/**"]\n`,
  );
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

it("adds a local copy, lists declarations, checks tools and removes code while preserving data", () => {
  const added = cli(["plugin", "add", "./fixture", "--yes"]);
  expect(added.code, added.stderr).toBe(0);
  expect(added.stdout).toContain("board 1.0.0");
  expect(added.stdout).toContain("module-opened");
  expect(added.stdout).toContain("node");
  expect(json(".verid/plugins.json")).toEqual([
    { name: "board", source: "file:./fixture", resolved: "1.0.0" },
  ]);
  expect(readFileSync(join(project, ".verid/.gitignore"), "utf8")).toContain("plugins/\n");
  expect(cli(["plugin", "list"]).stdout).toContain("board 1.0.0");
  expect(cli(["plugin", "doctor"]).code).toBe(0);
  expect(cli(["plugin", "run", "module-opened"]).code).toBe(0);
  expect(cli(["plugin", "remove", "board"]).code).toBe(0);
  expect(json(".verid/plugins.json")).toEqual([]);
  expect(existsSync(join(project, ".verid/plugins/board"))).toBe(false);
  expect(existsSync(join(project, ".verid/plugin-data/board/events.jsonl"))).toBe(true);
  expect(cli(["plugin", "list"]).stdout).not.toContain("board 1.0.0");
});

it("requires explicit consent for every source before registering or executing it", () => {
  const r = cli(["plugin", "add", "file:./fixture"]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("VERID_BURNT_PLUGIN_CONFIRM");
  expect(existsSync(join(project, ".verid/plugins.json"))).toBe(false);
  expect(existsSync(join(project, ".verid/plugin-data/board/events.jsonl"))).toBe(false);
});

it("refuses every plugin subcommand inside Claude Code before parsing or touching sources", () => {
  const rows = [["add", "x"], ["remove", "board"], ["list"], ["doctor"], ["run", "taste"], ["bad"]];
  for (const args of rows) {
    const r = cli(["plugin", ...args], { CLAUDECODE: "1" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("VERID_BURNT_PLUGIN_IN_AGENT");
  }
});

it("refuses missing required tools, unsafe scripts and duplicate names without replacing installed code", () => {
  expect(cli(["plugin", "add", "file:./fixture", "--yes"]).code).toBe(0);
  const installed = readFileSync(join(project, ".verid/plugins/board/record.mjs"), "utf8");
  const rows = [
    [{ ...pluginManifest(), requires: ["verid-no-such-tool-123"] }, "VERID_BURNT_PLUGIN_REQUIRES"],
    [pluginManifest({ taste: "../outside.mjs" }), "VERID_BURNT_PLUGIN_INVALID"],
    [pluginManifest(), "VERID_BURNT_PLUGIN_INVALID"],
  ] as const;
  for (const [manifest, code] of rows) {
    writeFileSync(join(fixture, "verid-plugin.json"), JSON.stringify(manifest));
    const r = cli(["plugin", "add", "./fixture", "--yes"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(code);
    expect(readFileSync(join(project, ".verid/plugins/board/record.mjs"), "utf8")).toBe(installed);
  }
});

it("restores missing pinned local plugins through cook and upgrade, and dry-run writes nothing", () => {
  for (const command of ["cook", "upgrade"]) {
    put(
      ".verid/plugins.json",
      JSON.stringify([{ name: "board", source: "file:./fixture", resolved: "1.0.0" }]),
    );
    rmSync(join(project, ".verid/plugins"), { recursive: true, force: true });
    const preview = cli([command, "--dry-run"]);
    expect(preview.code, preview.stderr).toBe(0);
    expect(preview.stdout).toContain("board");
    expect(existsSync(join(project, ".verid/plugins/board"))).toBe(false);
    const restored = cli([command, "--yes"]);
    expect(restored.code, restored.stderr).toBe(0);
    expect(existsSync(join(project, ".verid/plugins/board/record.mjs"))).toBe(true);
    expect(json(".verid/plugins.json")).toEqual([
      { name: "board", source: "file:./fixture", resolved: "1.0.0" },
    ]);
  }
});

it("does not restore plugins without consent, or accept a changed local version", () => {
  put(
    ".verid/plugins.json",
    JSON.stringify([{ name: "board", source: "file:./fixture", resolved: "1.0.0" }]),
  );
  const skipped = cli(["cook"]);
  expect(skipped.code).toBe(1);
  expect(skipped.stderr).toContain("VERID_BURNT_PLUGIN_CONFIRM");
  expect(existsSync(join(project, ".verid/plugins/board"))).toBe(false);
  writeFileSync(
    join(fixture, "verid-plugin.json"),
    JSON.stringify({ ...pluginManifest(), version: "2.0.0" }),
  );
  const mismatch = cli(["cook", "--yes"]);
  expect(mismatch.code).toBe(1);
  expect(mismatch.stderr).toContain("VERID_BURNT_PLUGIN_INVALID");
});

it("delivers sample JSON and an absolute data environment without accepting a plugin decision", () => {
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  const rows = ["module-opened", "module-served", "taste", "drive-stuck", "drive-done"];
  for (const event of rows) expect(cli(["plugin", "run", event]).code).toBe(0);
  expect(events().map((e) => [e.payload.event, e.payload.sample])).toEqual([
    ["module-opened", true],
    ["module-served", true],
    ["taste", true],
    ["drive-stuck", true],
    ["drive-done", true],
  ]);
  expect(events()[0]?.data).toBe(join(project, ".verid/plugin-data/board"));
  expect(events()[0]?.cwd).toBe(join(project, ".verid/plugins/board"));
  expect(json(".verid/.state/state.json").tdd).toBeUndefined();
  expect(cli(["plugin", "run", "bogus"]).code).toBe(2);
});

it("records failure and crash as warnings while manual module decisions stay successful", () => {
  const rows = [
    ["process.exit(7)", "exit"],
    ["throw new Error('crash')", "exit"],
  ];
  put(".verid/design.md", "# Design\n");
  put(".verid/plan.md", "## Module: calc\n- AC-1: sums\n");
  for (const [script, reason] of rows) {
    writeFileSync(join(fixture, "record.mjs"), script!);
    expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
    const ordered = cli(["order", "calc"]);
    expect(ordered.code, ordered.stderr).toBe(0);
    expect(ordered.stderr).toContain("VERID_BURNT_PLUGIN_EVENT");
    expect(json(".verid/.state/state.json").modules.calc.served_at).toBe(null);
    expect(
      audit()
        .filter((e) => e.event === "plugin_failed")
        .at(-1)?.reason,
    ).toBe(reason);
    expect(cli(["plugin", "remove", "board"]).code).toBe(0);
  }
  expect(verifyAuditChain(join(project, ".verid/.state/audit.jsonl")).ok).toBe(true);
});

it("protects plugin files and data through the real hook and refuses /verid tip", () => {
  const rows = [
    ["Write", { file_path: ".verid/plugins.json" }],
    ["Edit", { file_path: ".verid/plugins/board/record.mjs" }],
    ["Write", { file_path: ".verid/plugin-data/board/config.json" }],
    ["Bash", { command: "echo x > .verid/plugins.json" }],
    ["Bash", { command: "mv .verid/plugins elsewhere" }],
    ["Bash", { command: "p=.verid/plugins.json; echo x > $p" }],
    ["Bash", { command: "rm -r .verid" }],
    ["mcp__filesystem__write_file", { path: ".verid/plugins/board/record.mjs" }],
    ["mcp__filesystem__remove_directory", { path: ".verid" }],
  ] as const;
  for (const [tool, input] of rows) {
    const r = hook(tool, input);
    expect(r.code, JSON.stringify(input)).toBe(2);
    expect(r.stderr).toContain("VERID_BURNT_PLUGIN_PROTECTED");
    const tip = hook("", { prompt: "/verid tip update plugin" }, "UserPromptSubmit", {
      CLAUDE_CODE_SESSION_ATTENDED: "1",
    });
    expect(tip.code).toBe(2);
    expect(tip.stderr).toContain("VERID_BURNT_OVERRIDE_FORBIDDEN");
  }
  expect(hook("Read", { file_path: ".verid/plugins.json" }).code).toBe(0);
});

it("keeps reviewed developer-command bypass forms out of the real hook's Bash", () => {
  const rows = [
    "node cli.js plugin add x",
    'env -i PATH="$PATH" node cli.js plugin add x',
    'cmd //c "@verid plugin add x"',
    "verid.cmd plugin run x",
  ];
  for (const command of rows) {
    const r = hook("Bash", { command });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("VERID_BURNT_PLUGIN_PROTECTED");
  }
});

it.skipIf(process.platform !== "win32")(
  "denies NTFS stream aliases for new and existing protected targets through the real hook",
  () => {
    const rows = [
      [".verid/plugins.json::$DATA", ".verid/plugins.json", "VERID_BURNT_PLUGIN_PROTECTED"],
      [
        ".verid/plugins::$INDEX_ALLOCATION/evil/verid-plugin.json",
        ".verid/plugins/evil/verid-plugin.json",
        "VERID_BURNT_PLUGIN_PROTECTED",
      ],
      [
        ".verid/plugin-data::$INDEX_ALLOCATION/x",
        ".verid/plugin-data/x",
        "VERID_BURNT_PLUGIN_PROTECTED",
      ],
      [".claude/settings.json::$DATA", ".claude/settings.json", "VERID_BURNT_HOOK_PROTECTED"],
      [".verid/.state::$INDEX_ALLOCATION/x", ".verid/.state/x", "VERID_BURNT_STATE_PROTECTED"],
      [".verid/manifest.yaml::$DATA", ".verid/manifest.yaml", "VERID_BURNT_MANIFEST_PROTECTED"],
      [".env::$DATA", ".env", "VERID_BURNT_SECRET_PROTECTED"],
    ] as const;
    for (const existing of [false, true]) {
      for (const [path, plain, code] of rows) {
        if (existing && !existsSync(join(project, plain))) put(plain, "[]");
        for (const tool of ["Write", "mcp__filesystem__write_file"]) {
          const result = hook(tool, { file_path: path, path });
          const label = `${tool} ${path} existing=${existing}`;
          expect.soft(result.code, label).toBe(2);
          expect.soft(result.stderr, label).toContain(code);
        }
      }
    }
  },
);

it("denies named plugin Bash aliases through the real hook", () => {
  const rows = [
    "cd .verid && cp ../x.json plugins.json",
    "git -C .verid checkout HEAD~1 -- plugins.json",
    "git checkout HEAD~1 -- .verid/./plugins.json",
    "git checkout HEAD~1 -- .verid\\.\\plugins.json",
    "cd .verid && rm -rf plugin-data",
    "cat backup-plugins.json.txt",
    "echo plugin-data-backup",
  ];
  for (const command of rows) {
    const result = hook("Bash", { command });
    expect.soft(result.code, command).toBe(2);
    expect.soft(result.stderr, command).toContain("VERID_BURNT_PLUGIN_PROTECTED");
  }
});

it("allows workspace git commits and application plugins paths through the real hook", () => {
  const rows = [
    "git -C .verid add -A",
    "git -C .verid commit -m x",
    "git -C .verid status --porcelain",
    "cd .verid && git add plan.md && git commit -m plan",
    "git add .verid",
    "ls .verid",
    "git add plugins/auth.ts",
    "npx vitest run plugins/",
  ];
  for (const command of rows) {
    const result = hook("Bash", { command });
    expect.soft(result.code, `${command}: ${result.stderr}`).toBe(0);
  }
});

it("denies versioned and scoped developer commands through the real hook", () => {
  const rows = [
    ["env -i PATH=$PATH npx verid@1.1.0 plugin add ./x --yes", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["npx verid@latest plugin run x", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["npx verid@latest cook", "VERID_BURNT_BASH_DEVELOPER_ONLY"],
    ["npx @anhtranhai835/verid@1.1.0 stock", "VERID_BURNT_BASH_DEVELOPER_ONLY"],
    [
      'env -i PATH="$PATH" npm exec verid -- plugin add ./evil --yes',
      "VERID_BURNT_PLUGIN_PROTECTED",
    ],
    [
      'env -i PATH="$PATH" npm exec @anhtranhai835/verid@1.1.0 -- plugin add ./evil --yes',
      "VERID_BURNT_PLUGIN_PROTECTED",
    ],
    ["npx verid -- plugin add ./evil --yes", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["pnpm exec verid -- plugin", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["npm x -y verid -- cook", "VERID_BURNT_BASH_DEVELOPER_ONLY"],
    [
      'env -i PATH="$PATH" npm x -y @anhtranhai835/verid@1.1.0 -- cook --yes',
      "VERID_BURNT_BASH_DEVELOPER_ONLY",
    ],
    ['env -i PATH="$PATH" npm exec verid -- upgrade --yes', "VERID_BURNT_BASH_DEVELOPER_ONLY"],
  ] as const;
  for (const [command, code] of rows) {
    const result = hook("Bash", { command });
    expect.soft(result.code, command).toBe(2);
    expect.soft(result.stderr, command).toContain(code);
  }
});

it("keeps plugin commands denied with an active exact-action Bash developer override", () => {
  const rows = [
    "CLAUDECODE= verid plugin add ./evil --yes",
    "env -i PATH=$PATH npx verid@1.1.0 plugin add ./x --yes",
    'env -i PATH="$PATH" npm exec verid -- plugin add ./evil --yes',
  ];
  for (const command of rows) {
    const input = { command };
    const override = {
      session: "plugin-session",
      rule: "VERID_BURNT_BASH_DEVELOPER_ONLY",
      tool: "Bash",
      target: command,
      input_hash: inputHash(input),
      reason: "approved harmless Bash false positive",
      created_at: new Date().toISOString(),
      used: false,
    };
    put(".verid/.state/state.json", JSON.stringify({ schemaVersion: 1, overrides: [override] }));
    const result = hook("Bash", input);
    expect.soft(result.code, command).toBe(2);
    expect.soft(result.stderr, command).toContain("VERID_BURNT_PLUGIN_PROTECTED");
    expect.soft(json(".verid/.state/state.json").overrides[0].used, command).toBe(false);
  }
});

it("rejects installed script links at execution even when the manifest itself is valid", () => {
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  const outside = join(project, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "record.mjs"), "process.exit(0)");
  symlinkSync(outside, join(project, ".verid/plugins/board/linked"), "junction");
  put(
    ".verid/plugins/board/verid-plugin.json",
    JSON.stringify(pluginManifest({ taste: "linked/record.mjs" })),
  );
  const r = cli(["plugin", "run", "taste"]);
  expect(r.code).toBe(0);
  expect(r.stderr).toContain("VERID_BURNT_PLUGIN_EVENT");
  expect(audit().at(-1)?.event).toBe("plugin_failed");
  expect(cli(["plugin", "doctor"]).code).toBe(1);
});

it("installs a local bare git source and restores the recorded commit after its branch moves", () => {
  const git = (cwd: string, args: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=t@t", ...args], {
      cwd,
      env: env(),
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.trim();
  };
  git(fixture, ["init", "--quiet", "--initial-branch=master"]);
  git(fixture, ["add", "."]);
  git(fixture, ["commit", "-qm", "fixture"]);
  const commit = git(fixture, ["rev-parse", "HEAD"]);
  const bare = join(project, "board.git");
  git(project, ["clone", "--bare", "--", fixture, bare]);
  const added = cli(["plugin", "add", "git:./board.git", "--yes"]);
  expect(added.code, added.stderr).toBe(0);
  expect(json(".verid/plugins.json")[0].resolved).toBe(commit);
  writeFileSync(join(fixture, "record.mjs"), "process.exit(9)");
  git(fixture, ["add", "."]);
  git(fixture, ["commit", "-qm", "moved"]);
  const moved = git(fixture, ["rev-parse", "HEAD"]);
  expect(moved).not.toBe(commit);
  git(fixture, ["push", "--", bare, "HEAD:refs/heads/master"]);
  expect(git(bare, ["rev-parse", "HEAD"])).toBe(moved);
  rmSync(join(project, ".verid/plugins/board"), { recursive: true, force: true });
  const restored = cli(["upgrade", "--yes"]);
  expect(restored.code, restored.stderr).toBe(0);
  expect(json(".verid/plugins.json")[0].resolved).toBe(commit);
  expect(readFileSync(join(project, ".verid/plugins/board/record.mjs"), "utf8")).toBe(recordScript);
  expect(existsSync(join(project, ".verid/plugins/board/.git"))).toBe(false);
});

const autoProject = () => {
  put(".verid/research.md", "# Research\n");
  put(".verid/design.md", "# Design\n");
  put(
    ".verid/plan.md",
    "## Module: calc\n- AC-1: sums\n\n## Module: product\n- AC-9 (e2e): works\n",
  );
  put(
    ".verid/manifest.yaml",
    readFileSync(join(project, ".verid/manifest.yaml"), "utf8").replace(
      "mode: prep",
      'mode: prep\ndrive: auto\nroles:\n  reviewer: ["verid:reviewer"]\n  tester: ["verid:tester"]\n  coder: ["verid:coder"]',
    ),
  );
  expect(cli(["order"]).code).toBe(0);
};
const review = () =>
  hook(
    "",
    { agent_id: "r1", agent_type: "verid:reviewer", last_assistant_message: "Verdict: pass" },
    "SubagentStop",
  );

const INTEGRITY = ".verid/.state/plugin-integrity.json";
const tamperedScript = `${recordScript}\nfs.writeFileSync(path.join(process.env.VERID_PLUGIN_DATA, 'tampered-ran'), 'ran');`;
const tempGit = (cwd: string, args: string[]) => {
  const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=t@t", ...args], {
    cwd,
    env: env(),
    encoding: "utf8",
    windowsHide: true,
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
};

it("records plugin approvals in protected state on developer add, remove and restore", () => {
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  const approved = json(INTEGRITY);
  expect(approved.manifest_sha256).toBe(
    createHash("sha256")
      .update(readFileSync(join(project, ".verid/plugins.json")))
      .digest("hex"),
  );
  expect(approved.plugins.board.sha256).toMatch(/^[a-f0-9]{64}$/);
  for (const tool of [
    "Read",
    "Write",
    "mcp__filesystem__read_file",
    "mcp__filesystem__write_file",
  ]) {
    const result = hook(tool, { file_path: INTEGRITY, path: INTEGRITY });
    expect(result.code, result.stderr).toBe(2);
    expect(result.stderr).toContain("VERID_BURNT_STATE_PROTECTED");
  }
  expect(cli(["plugin", "remove", "board"]).code).toBe(0);
  expect(json(INTEGRITY).plugins).toEqual({});
  expect(json(INTEGRITY).manifest_sha256).not.toBe(approved.manifest_sha256);
  expect(cli(["plugin", "run", "taste"]).stderr).toBe("");
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  rmSync(join(project, ".verid/plugins/board"), { recursive: true, force: true });
  const restored = cli(["cook", "--yes"]);
  expect(restored.code, restored.stderr).toBe(0);
  expect(cli(["plugin", "doctor"]).code).toBe(0);
  expect(cli(["plugin", "run", "taste"]).stderr).toBe("");
  expect(events()).toHaveLength(1);
});

const resetAutoPluginRow = (state: string) => {
  put(".verid/.state/state.json", state);
  for (const file of [
    ".verid/plugin-data/board/events.jsonl",
    ".verid/.state/plugin-drive.json",
    ".verid/blocked.md",
  ])
    rmSync(join(project, file), { force: true });
};
const prepareIntegrityChanges = () => {
  autoProject();
  writeFileSync(join(fixture, "another.mjs"), recordScript);
  mkdirSync(join(fixture, "support"));
  writeFileSync(join(fixture, "support/helper.json"), "original");
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  return readFileSync(join(project, ".verid/.state/state.json"), "utf8");
};
const checkIntegrityChange = (change: string, state: string) => {
  resetAutoPluginRow(state);
  expect(cli(["plugin", "run", "taste"]).stderr).toBe("");
  const registry = readFileSync(join(project, ".verid/plugins.json"), "utf8");
  const before = readFileSync(join(project, INTEGRITY), "utf8");
  switch (change) {
    case "script content":
      put(".verid/plugins/board/record.mjs", tamperedScript);
      break;
    case "nested dependency":
      put(".verid/plugins/board/support/helper.json", "changed");
      break;
    case "added file":
      put(".verid/plugins/board/new.mjs", "new");
      break;
    case "removed file":
      rmSync(join(project, ".verid/plugins/board/support/helper.json"));
      break;
    case "renamed file":
      renameSync(
        join(project, ".verid/plugins/board/another.mjs"),
        join(project, ".verid/plugins/board/moved.mjs"),
      );
      break;
    case "registry bytes":
      put(".verid/plugins.json", `${registry}\n`);
      break;
    case "registry source": {
      const entries = json(".verid/plugins.json");
      entries[0].source = "file:./elsewhere";
      put(".verid/plugins.json", JSON.stringify(entries));
      break;
    }
    case "missing approval":
      rmSync(join(project, INTEGRITY));
      break;
    case "corrupt approval":
      put(INTEGRITY, "broken");
      break;
  }
  for (const event of Object.keys(pluginManifest().events)) {
    const result = cli(["plugin", "run", event]);
    expect.soft(result.code, result.stderr).toBe(0);
    expect.soft(result.stderr).toContain("VERID_BURNT_PLUGIN_INTEGRITY");
    expect.soft(result.stderr).toContain("verid plugin add");
  }
  const doctor = cli(["plugin", "doctor"]);
  expect.soft(doctor.code, doctor.stderr).toBe(1);
  expect.soft(doctor.stderr).toContain("VERID_BURNT_PLUGIN_INTEGRITY");
  const observed = review();
  expect.soft(observed.code, observed.stderr).toBe(0);
  expect.soft(observed.stderr).toContain("VERID_BURNT_PLUGIN_INTEGRITY");
  expect.soft(events()).toHaveLength(1);
  expect.soft(existsSync(join(project, ".verid/plugin-data/board/tampered-ran"))).toBe(false);
  expect
    .soft(
      audit()
        .filter((entry) => entry.event === "plugin_failed")
        .at(-1)?.reason,
    )
    .toBe("integrity");
  if (change !== "missing approval" && change !== "corrupt approval")
    expect.soft(readFileSync(join(project, INTEGRITY), "utf8")).toBe(before);
  put(".verid/plugins.json", registry);
  const preview = cli(["cook", "--dry-run"]);
  expect(preview.code, preview.stderr).toBe(0);
  if (change !== "registry bytes" && change !== "registry source")
    expect(preview.stdout).toContain("board");
  const restored = cli(["cook", "--yes"]);
  expect(restored.code, restored.stderr).toBe(0);
  expect(cli(["plugin", "doctor"]).code).toBe(0);
  expect(cli(["plugin", "run", "taste"]).stderr).toBe("");
  expect(events()).toHaveLength(2);
  expect(verifyAuditChain(join(project, ".verid/.state/audit.jsonl")).ok).toBe(true);
};

it("refuses script and nested dependency content changes in CLI and hook events until developer restore", () => {
  const rows = ["script content", "nested dependency"] as const;
  const state = prepareIntegrityChanges();
  for (const change of rows) checkIntegrityChange(change, state);
});

it("refuses added, removed and renamed plugin files in CLI and hook events until developer restore", () => {
  const rows = ["added file", "removed file", "renamed file"] as const;
  const state = prepareIntegrityChanges();
  for (const change of rows) checkIntegrityChange(change, state);
});

it("refuses registry byte and source changes in CLI and hook events until developer restore", () => {
  const rows = ["registry bytes", "registry source"] as const;
  const state = prepareIntegrityChanges();
  for (const change of rows) checkIntegrityChange(change, state);
});

it("refuses missing and corrupt approvals in CLI and hook events until developer restore", () => {
  const rows = ["missing approval", "corrupt approval"] as const;
  const state = prepareIntegrityChanges();
  for (const change of rows) checkIntegrityChange(change, state);
});

const prepareTreeReplacement = (kind: "git" | "workspace git" | "copy" | "tar") => {
  autoProject();
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  const workspace = kind === "workspace git";
  const cwd = workspace ? join(project, ".verid") : project;
  if (kind === "git" || workspace) {
    tempGit(cwd, ["init", "--quiet"]);
    const targets = workspace
      ? ["plugins", "plugins.json"]
      : [".verid/plugins", ".verid/plugins.json"];
    tempGit(cwd, ["add", "-f", "--", ...targets]);
    tempGit(cwd, ["commit", "-qm", "approved"]);
    const approved = tempGit(cwd, ["rev-parse", "HEAD"]);
    put(".verid/plugins/board/record.mjs", tamperedScript);
    tempGit(cwd, ["add", "-f", "--", ...targets]);
    tempGit(cwd, ["commit", "-qm", "evil"]);
    tempGit(cwd, ["branch", "evil"]);
    tempGit(cwd, ["reset", "--hard", approved]);
    mkdirSync(join(project, ".verid/x"), { recursive: true });
  } else {
    cpSync(join(project, ".verid/plugins"), join(project, "evil/plugins"), { recursive: true });
    put("evil/plugins/board/record.mjs", tamperedScript);
    if (kind === "tar") {
      const packed = spawnSync("tar", ["-cf", "evil.tar", "-C", "evil", "."], {
        cwd: project,
        encoding: "utf8",
        windowsHide: true,
      });
      expect(packed.status, packed.stderr).toBe(0);
    }
  }
  return readFileSync(join(project, ".verid/.state/state.json"), "utf8");
};
const checkTreeReplacement = (command: string, state: string) => {
  resetAutoPluginRow(state);
  const workspace = command.includes("-C .verid") || command.startsWith("cd .verid");
  const cwd = workspace ? join(project, ".verid") : project;
  const allowed = hook("Bash", { command });
  expect(allowed.code, allowed.stderr).toBe(0);
  if (command.startsWith("git") || command.startsWith("cd")) {
    const args = command.startsWith("cd")
      ? ["checkout", "evil", "--", "."]
      : command.split(" ").slice(1);
    tempGit(command.startsWith("cd") ? cwd : project, args);
  } else if (command.startsWith("tar")) {
    const extracted = spawnSync("tar", ["-xf", "evil.tar", "-C", ".verid/."], {
      cwd: project,
      encoding: "utf8",
      windowsHide: true,
    });
    expect(extracted.status, extracted.stderr).toBe(0);
  } else {
    // Deterministic destination-tree writes also cover hosts without rsync or unzip (Windows).
    cpSync(join(project, "evil"), join(project, ".verid"), { recursive: true });
  }
  expect(readFileSync(join(project, ".verid/plugins/board/record.mjs"), "utf8")).toBe(
    tamperedScript,
  );
  const result = cli(["plugin", "run", "taste"]);
  expect.soft(result.stderr).toContain("VERID_BURNT_PLUGIN_INTEGRITY");
  const observed = review();
  expect.soft(observed.code, observed.stderr).toBe(0);
  expect.soft(observed.stderr).toContain("VERID_BURNT_PLUGIN_INTEGRITY");
  expect.soft(existsSync(join(project, ".verid/plugin-data/board/events.jsonl"))).toBe(false);
  expect.soft(existsSync(join(project, ".verid/plugin-data/board/tampered-ran"))).toBe(false);
  expect
    .soft(
      audit()
        .filter((entry) => entry.event === "plugin_failed")
        .at(-1),
    )
    .toMatchObject({ reason: "integrity" });
  const restored = cli(["upgrade", "--yes"]);
  expect(restored.code, restored.stderr).toBe(0);
  expect(cli(["plugin", "run", "taste"]).stderr).toBe("");
  expect(events()).toHaveLength(1);
  expect(existsSync(join(project, ".verid/plugin-data/board/tampered-ran"))).toBe(false);
  put(".verid/blocked.md", "developer needed");
  const stopped = hook("", {}, "Stop");
  expect(stopped.code, stopped.stderr).toBe(0);
  expect(stopped.stderr).not.toContain("VERID_BURNT_PLUGIN_INTEGRITY");
  expect(events().map((entry) => entry.payload.event)).toEqual(["taste", "drive-stuck"]);
  expect(verifyAuditChain(join(project, ".verid/.state/audit.jsonl")).ok).toBe(true);
};

it("blocks execution after repository restore and checkout replace the approved plugin tree", () => {
  const rows = ["git restore --source=evil -- .verid/.", "git checkout evil -- .verid/."];
  const state = prepareTreeReplacement("git");
  for (const command of rows) checkTreeReplacement(command, state);
});

it("blocks execution after plugin tree checkout through normalized repository paths", () => {
  const rows = ["git checkout evil -- ./.verid/./", "git checkout evil -- .verid/x/../plugins"];
  const state = prepareTreeReplacement("git");
  for (const command of rows) checkTreeReplacement(command, state);
});

it("blocks execution after workspace git reset and checkout replace the approved plugin tree", () => {
  const rows = [
    "git -C .verid/. reset --hard evil",
    "git -C .verid/. checkout evil -- .",
    "cd .verid/. && git checkout evil -- .",
  ];
  const state = prepareTreeReplacement("workspace git");
  for (const command of rows) checkTreeReplacement(command, state);
});

it("blocks execution after archive extraction replaces the approved plugin tree", () => {
  const rows = ["tar -xf evil.tar -C .verid/.", "unzip -o evil.zip -d .verid/."];
  const state = prepareTreeReplacement("tar");
  for (const command of rows) checkTreeReplacement(command, state);
});

it("blocks execution after copying a replacement plugin tree", () => {
  const rows = ["rsync -a evil/ .verid/."];
  const state = prepareTreeReplacement("copy");
  for (const command of rows) checkTreeReplacement(command, state);
});

it("runs reviewed source again after developer remove and plugin add re-approval", () => {
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  const before = json(INTEGRITY).plugins.board.sha256;
  put(".verid/plugins/board/record.mjs", tamperedScript);
  expect(cli(["plugin", "run", "taste"]).stderr).toContain("VERID_BURNT_PLUGIN_INTEGRITY");
  expect(existsSync(join(project, ".verid/plugin-data/board/events.jsonl"))).toBe(false);
  writeFileSync(join(fixture, "record.mjs"), `${recordScript}\n// developer reviewed update`);
  expect(cli(["plugin", "remove", "board"]).code).toBe(0);
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  expect(json(INTEGRITY).plugins.board.sha256).not.toBe(before);
  expect(cli(["plugin", "run", "taste"]).stderr).toBe("");
  expect(events()).toHaveLength(1);
  expect(existsSync(join(project, ".verid/plugin-data/board/tampered-ran"))).toBe(false);
});

it("delivers auto open, close and done from the real hook once per transition", () => {
  autoProject();
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  expect(review().code).toBe(0);
  expect(events().map((e) => [e.payload.event, e.payload.module ?? null])).toEqual([
    ["module-opened", "calc"],
  ]);
  for (const [module, ac] of [
    ["calc", "AC-1"],
    ["product", "AC-9"],
  ]) {
    const state = json(".verid/.state/state.json");
    state.tdd = {
      ...state.tdd,
      state: "PLATED",
      last_run: "run1",
      dirty: false,
      passed_acs: [ac],
      passed_e2e_acs: [ac],
    };
    put(".verid/.state/state.json", JSON.stringify(state));
    expect(review().code, module).toBe(0);
  }
  expect(events().map((e) => [e.payload.event, e.payload.module ?? null])).toEqual([
    ["module-opened", "calc"],
    ["module-served", "calc"],
    ["module-opened", "product"],
    ["module-served", "product"],
    ["drive-done", null],
  ]);
  expect(hook("", {}, "Stop").code).toBe(0);
  expect(events()).toHaveLength(5);
});

it("times out hook events within a shared budget and keeps the auto Stop denial", () => {
  autoProject();
  writeFileSync(join(fixture, "record.mjs"), "setInterval(() => {}, 1000)");
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  writeFileSync(
    join(fixture, "verid-plugin.json"),
    JSON.stringify({ ...pluginManifest(), name: "other" }),
  );
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  const state = json(".verid/.state/state.json");
  state.auto.plan_sha256 = createHash("sha256")
    .update(readFileSync(join(project, ".verid/plan.md")))
    .digest("hex");
  put(".verid/.state/state.json", JSON.stringify(state));
  const started = Date.now();
  const stopped = hook("", {}, "Stop");
  expect(stopped.code, stopped.stderr).toBe(2);
  expect(stopped.stderr).toContain("VERID_BURNT_PLUGIN_EVENT");
  expect(Date.now() - started).toBeLessThan(4000);
  expect(
    audit()
      .filter((e) => e.event === "plugin_failed")
      .at(-1)?.reason,
  ).toBe("timeout");
  expect(
    audit()
      .filter((e) => e.event === "plugin_failed")
      .map((e) => e.plugin),
  ).toEqual(["board", "other"]);
  expect(json(".verid/.state/state.json").auto.stop_holds).toBe(0);
  expect(hook("Write", { file_path: "src/a.ts" }).code).toBe(2);
});

it("kills plugin descendants on hook timeout while preserving the Stop denial", () => {
  autoProject();
  const state = json(".verid/.state/state.json");
  state.auto.plan_sha256 = createHash("sha256")
    .update(readFileSync(join(project, ".verid/plan.md")))
    .digest("hex");
  put(".verid/.state/state.json", JSON.stringify(state));
  writeFileSync(
    join(fixture, "record.mjs"),
    `import { spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
const ready = path.join(process.env.VERID_PLUGIN_DATA, 'child.ready');
const child = spawn(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], "ready"); setTimeout(() => {}, 15000)', ready], {stdio: 'ignore', windowsHide: true});
fs.writeFileSync(path.join(process.env.VERID_PLUGIN_DATA, 'child.pid'), String(child.pid));
setInterval(() => {}, 1000);`,
  );
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  let pid: number | undefined;
  try {
    const result = hook("", {}, "Stop");
    pid = Number(readFileSync(join(project, ".verid/plugin-data/board/child.pid"), "utf8"));
    expect(Number.isInteger(pid) && pid > 0).toBe(true);
    expect(readFileSync(join(project, ".verid/plugin-data/board/child.ready"), "utf8")).toBe(
      "ready",
    );
    expect(result.code, result.stderr).toBe(2);
    expect(result.stderr).toContain("VERID_BURNT_PLUGIN_EVENT");
    expect(
      audit()
        .filter((entry) => entry.event === "plugin_failed")
        .at(-1)?.reason,
    ).toBe("timeout");
    let stopped = "alive";
    try {
      process.kill(pid, 0);
    } catch (error) {
      stopped = (error as NodeJS.ErrnoException).code ?? "unknown";
    }
    expect(stopped).toBe("ESRCH");
  } finally {
    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Already gone. */
      }
    }
  }
});

it("reports drive-stuck as an observer and ignores malicious plugin stdout", () => {
  autoProject();
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  put(".verid/blocked.md", "need developer");
  const stopped = hook("", {}, "Stop");
  expect(stopped.code).toBe(0);
  expect(events().map((e) => [e.payload.event, e.payload.reason])).toEqual([
    ["drive-stuck", "blocked"],
  ]);
  expect(
    hook("Write", { file_path: "test/a.test.ts", agent_id: "t1", agent_type: "verid:tester" })
      .stderr,
  ).toContain("VERID_BURNT_AUTO_STUCK");
  expect(hook("", {}, "Stop").code).toBe(0);
  expect(events()).toHaveLength(1);
});

it("does not dispatch plugins when verid cannot read its own auto state", () => {
  autoProject();
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  put(".verid/.state/state.json", "invalid");
  const r = hook("Write", { file_path: "src/a.ts" });
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("VERID_BURNT_STATE_CORRUPT");
  expect(existsSync(join(project, ".verid/plugin-data/board/events.jsonl"))).toBe(false);
});

it("delivers manual module open and serve payloads after the decision is saved", () => {
  writeFileSync(join(fixture, "record.mjs"), recordScript + "\nprocess.exit(7)");
  put(".verid/design.md", "# Design\n");
  put(".verid/plan.md", "## Module: calc\n- AC-1: sums\n");
  put(
    ".verid/manifest.yaml",
    readFileSync(join(project, ".verid/manifest.yaml"), "utf8").replace(
      "mode: prep",
      'mode: prep\nroles:\n  reviewer: ["verid:reviewer"]',
    ),
  );
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  expect(cli(["order", "calc"]).code).toBe(0);
  const state = json(".verid/.state/state.json");
  state.tdd = {
    ...state.tdd,
    state: "PLATED",
    last_run: "run1",
    dirty: false,
    passed_acs: ["AC-1"],
  };
  put(".verid/.state/state.json", JSON.stringify(state));
  expect(review().code).toBe(0);
  const served = cli(["serve", "calc"]);
  expect(served.code).toBe(0);
  expect(served.stderr).toContain("VERID_BURNT_PLUGIN_EVENT");
  expect(events().map((e) => [e.payload.event, e.payload.module])).toEqual([
    ["module-opened", "calc"],
    ["module-served", "calc"],
  ]);
  expect(json(".verid/.state/state.json").modules.calc.served_at).not.toBeNull();
});

it("delivers taste outcomes and counts without changing passing or failing evidence", () => {
  writeFileSync(join(fixture, "record.mjs"), recordScript + "\nprocess.exit(7)");
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  const rows = [
    [0, "vitest-green.xml", true, { passed: 3, failed: 0, skipped: 1 }, 0],
    [1, "vitest-red-assert.xml", false, { passed: 1, failed: 2, skipped: 1 }, 1],
  ] as const;
  for (const [exit, junit, passed, counts, expected] of rows) {
    put("scenario.json", JSON.stringify({ exit, junit, output: "fixture" }));
    const r = cli(["taste"]);
    expect(r.code, r.stderr).toBe(expected);
    expect(r.stderr).toContain("VERID_BURNT_PLUGIN_EVENT");
    expect(events().at(-1)?.payload).toEqual({ event: "taste", passed, counts });
    expect(json(".verid/.state/state.json").tdd.last_run).not.toBeNull();
  }
});

it("delivers an auto close on Stop while preserving the hold for the next module", () => {
  autoProject();
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  const state = json(".verid/.state/state.json");
  state.auto.plan_sha256 = createHash("sha256")
    .update(readFileSync(join(project, ".verid/plan.md")))
    .digest("hex");
  state.tdd = {
    ...state.tdd,
    state: "PLATED",
    last_run: "run1",
    dirty: false,
    passed_acs: ["AC-1"],
  };
  state.review = {
    module: "calc",
    agent_type: "verid:reviewer",
    file: "review.md",
    sha256: "hash",
    at: "2026-10-24T10:00:00Z",
    verdict: "pass",
  };
  put(".verid/.state/state.json", JSON.stringify(state));
  const r = hook("", {}, "Stop");
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("product");
  expect(r.stdout).not.toContain("decision");
  expect(events().map((e) => [e.payload.event, e.payload.module])).toEqual([
    ["module-served", "calc"],
    ["module-opened", "product"],
  ]);
  expect(json(".verid/.state/state.json").modules.calc.served_at).not.toBeNull();
});

it("logs observer setup errors without changing an already computed Stop denial", () => {
  autoProject();
  expect(cli(["plugin", "add", "./fixture", "--yes"]).code).toBe(0);
  expect(review().code).toBe(0);
  put(".verid/.state/plugin-drive.json", "broken");
  const r = hook("", {}, "Stop");
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("VERID_BURNT_PLUGIN_EVENT");
  expect(
    audit()
      .filter((e) => e.event === "plugin_failed")
      .at(-1)?.reason,
  ).toBe("observer");
  expect(events().map((e) => e.payload.event)).toEqual(["module-opened"]);
});

it("refuses linked data directories before publishing any new plugin registration", () => {
  const outside = join(project, "outside-data");
  mkdirSync(outside);
  symlinkSync(outside, join(project, ".verid/plugin-data"), "junction");
  const r = cli(["plugin", "add", "./fixture", "--yes"]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("VERID_BURNT_PLUGIN_INVALID");
  expect(existsSync(join(project, ".verid/plugins.json"))).toBe(false);
  expect(existsSync(join(project, ".verid/plugins/board"))).toBe(false);
});

it("reports missing local sources as plugin errors without registering anything", () => {
  const r = cli(["plugin", "add", "file:./missing-plugin", "--yes"]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("VERID_BURNT_PLUGIN_INVALID");
  expect(existsSync(join(project, ".verid/plugins.json"))).toBe(false);
});

it("refuses a data file where a directory is required before publishing plugin code", () => {
  put(".verid/plugin-data/board", "keep this");
  const r = cli(["plugin", "add", "./fixture", "--yes"]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("VERID_BURNT_PLUGIN_INVALID");
  expect(existsSync(join(project, ".verid/plugins.json"))).toBe(false);
  expect(existsSync(join(project, ".verid/plugins/board"))).toBe(false);
  expect(readFileSync(join(project, ".verid/plugin-data/board"), "utf8")).toBe("keep this");
});

it("resolves an added local source from the invoking subdirectory and records a restorable project path", () => {
  const nested = join(project, "nested");
  mkdirSync(nested);
  cpSync(fixture, join(nested, "fixture"), { recursive: true });
  const r = spawnSync(process.execPath, [CLI, "plugin", "add", "./fixture", "--yes"], {
    cwd: nested,
    env: env(),
    encoding: "utf8",
  });
  expect(r.status, r.stderr).toBe(0);
  expect(json(".verid/plugins.json")).toEqual([
    { name: "board", source: "file:nested/fixture", resolved: "1.0.0" },
  ]);
  rmSync(join(project, ".verid/plugins/board"), { recursive: true, force: true });
  expect(cli(["cook", "--yes"]).code).toBe(0);
  expect(existsSync(join(project, ".verid/plugins/board/record.mjs"))).toBe(true);
});

it("refuses untrusted committed sources during setup before fetching or executing code", () => {
  const rows = [
    "git:-evil",
    "git:\\\\host\\share",
    "git:file://host/share",
    "npm:--prefix=outside",
  ];
  for (const source of rows) {
    put(".verid/plugins.json", JSON.stringify([{ name: "board", source, resolved: "1.0.0" }]));
    const r = cli(["cook", "--yes"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("VERID_BURNT_PLUGIN_INVALID");
    expect(existsSync(join(project, ".verid/plugins"))).toBe(false);
  }
});
