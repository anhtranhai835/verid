import { expect, it } from "vitest";
import { decide, type Action, type PolicyContext } from "../../src/core/policy.js";
import { isOverridable, type RuleCode } from "../../src/core/errors.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  mcpFiles,
  normalizePath,
  policyContext,
  toAction,
  writtenPath,
} from "../../src/adapters/claude-code.js";

const ctx: PolicyContext = {
  stateDir: "/p/.verid/.state",
  manifestPath: "/p/.verid/manifest.yaml",
  transcriptsDir: "/home/u/.claude/projects",
  distDir: "/tools/dist",
  planPath: "/p/.verid/plan.md",
  researchMissing: false,
  designMissing: false,
};

it("adds plugin to the existing developer command rule, including its reviewed bypass forms", () => {
  const rows = [
    ["verid plugin list", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["node cli.js plugin add x", "VERID_BURNT_PLUGIN_PROTECTED"],
    ['env -i PATH="$PATH" node cli.js plugin add x', "VERID_BURNT_PLUGIN_PROTECTED"],
    ['cmd //c "@verid plugin add x"', "VERID_BURNT_PLUGIN_PROTECTED"],
    ["verid.cmd plugin run x", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["verid cook", "VERID_BURNT_BASH_DEVELOPER_ONLY"],
    ["verid upgrade", "VERID_BURNT_BASH_DEVELOPER_ONLY"],
    ["node cli.js order x", "VERID_BURNT_BASH_DEVELOPER_ONLY"],
  ] as const;
  for (const [command, expected] of rows) {
    const result = decide({ kind: "bash", command }, ctx);
    expect(result.kind === "deny" && result.code, command).toBe(expected);
  }
});

it("protects plugin sources, code and data without allowing an override or blocking file reads", () => {
  const rows = [
    ["/p/.verid/plugins.json", "write", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["/p/.verid/plugins/board/run.mjs", "write", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["/p/.verid/plugin-data/board/config.json", "write", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["/p/.verid/plugins", "write", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["/p/.verid", "write", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["/p/.verid./plugins.json.", "write", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["/p/.verid/plugins. /board/run.mjs", "write", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["/p/.verid/plugins.json", "read", "allow"],
    ["/p/.verid/plugins/board/run.mjs", "read", "allow"],
    ["/p/.verid/plugins-notes.md", "write", "allow"],
  ] as const;
  for (const [path, access, expected] of rows) {
    const action: Action = { kind: "file", tool: "Write", path, display: path, access };
    const result = decide(action, ctx, new Set(["VERID_BURNT_PLUGIN_PROTECTED" as RuleCode]));
    expect(result.kind === "deny" ? result.code : result.kind, path).toBe(expected);
  }
  expect(isOverridable("VERID_BURNT_PLUGIN_PROTECTED" as RuleCode)).toBe(false);
});

it("adds non-overridable Bash protection without narrowing the existing text rules", () => {
  const rows = [
    ["echo x > .verid/plugins.json", "VERID_BURNT_PLUGIN_PROTECTED"],
    [
      "node -e \"require('fs').writeFileSync('.verid/plugins/board/a.mjs','x')\"",
      "VERID_BURNT_PLUGIN_PROTECTED",
    ],
    ["rm -rf .verid/plugin-data", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["cat .verid/plugins.json", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["echo x > .verid./plugins.json.", "VERID_BURNT_PLUGIN_PROTECTED"],
    ["cat .verid/manifest.yaml", "VERID_BURNT_MANIFEST_PROTECTED"],
    ["cat .env", "VERID_BURNT_SECRET_PROTECTED"],
  ];
  for (const [command, expected] of rows) {
    const result = decide(
      { kind: "bash", command: command! },
      ctx,
      new Set(["VERID_BURNT_PLUGIN_PROTECTED" as RuleCode]),
    );
    expect(result.kind === "deny" && result.code, command).toBe(expected);
  }
});

it.skipIf(process.platform !== "win32")(
  "protects every rule from NTFS stream aliases before path matching",
  () => {
    const project = mkdtempSync(join(tmpdir(), "verid-stream-policy-"));
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
    try {
      for (const existing of [false, true]) {
        for (const [path, plain, expected] of rows) {
          if (existing) {
            mkdirSync(dirname(join(project, plain)), { recursive: true });
            writeFileSync(join(project, plain), "fixture");
          }
          for (const tool of ["Write", "mcp__filesystem__write_file"]) {
            const payload = {
              hook_event_name: "PreToolUse" as const,
              session_id: "streams",
              cwd: project,
              tool_name: tool,
              tool_input: { file_path: path, path },
            };
            const action = tool === "Write" ? toAction(payload) : mcpFiles(payload)[0]!;
            expect("invalid" in action).toBe(false);
            if ("invalid" in action) continue;
            const result = decide(action, policyContext(project));
            expect
              .soft(
                result.kind === "deny" ? result.code : result.kind,
                `${tool} ${path} existing=${existing}`,
              )
              .toBe(expected);
          }
        }
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  },
);

it("denies named plugin Bash paths and substrings without an override", () => {
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
    const result = decide(
      { kind: "bash", command },
      ctx,
      new Set(["VERID_BURNT_PLUGIN_PROTECTED"]),
    );
    expect
      .soft(result.kind === "deny" ? result.code : result.kind, command)
      .toBe("VERID_BURNT_PLUGIN_PROTECTED");
  }
});

it("allows workspace git commands and application plugins directories", () => {
  const rows = [
    "git -C .verid add -A",
    "git -C .verid commit -m x",
    "git -C .verid status --porcelain",
    "cd .verid && git add plan.md && git commit -m plan",
    "git add .verid",
    "ls .verid",
    "git add plugins/auth.ts",
    "npx vitest run plugins/",
    "git restore --source=evil -- .verid/.",
    "git -C .verid/. reset --hard evil",
    "cd .verid/. && git checkout evil -- .",
    "tar -xf evil.tar -C .verid/.",
    "rsync -a evil/ .verid/.",
    "git checkout evil -- .verid/x/../plugins",
  ];
  for (const command of rows)
    expect.soft(decide({ kind: "bash", command }, ctx).kind, command).toBe("allow");
});

it.skipIf(process.platform !== "win32")(
  "strips single-letter stream components while preserving only the initial drive",
  () => {
    const rows = [
      ["C:\\verid-missing\\a\\b:\\c", "c:\\verid-missing\\a\\b\\c"],
      ["C:\\verid-missing\\a\\b:stream\\c", "c:\\verid-missing\\a\\b\\c"],
      ["\\\\?\\C:\\verid-missing\\a\\b:\\c", "\\\\?\\c:\\verid-missing\\a\\b\\c"],
      ["\\\\.\\C:\\verid-missing\\a\\b:\\c", "\\\\.\\c:\\verid-missing\\a\\b\\c"],
      ["\\\\host\\share\\a\\b:\\c", "\\\\host\\share\\a\\b\\c"],
      ["\\\\?\\UNC\\host\\share\\a\\b:\\c", "\\\\?\\unc\\host\\share\\a\\b\\c"],
    ];
    for (const [path, expected] of rows) expect.soft(writtenPath(path!), path).toBe(expected);
    expect(normalizePath(rows[0]![0]!)).toBe(rows[0]![1]);
  },
);

it("extends developer commands to versioned and scoped npx entries", () => {
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
  for (const [command, expected] of rows) {
    const result = decide({ kind: "bash", command }, ctx);
    expect.soft(result.kind === "deny" ? result.code : result.kind, command).toBe(expected);
  }
});

it("denies plugin developer commands before all overridable Bash rules", () => {
  const rows = [
    "CLAUDECODE= verid plugin add ./evil --yes",
    "node cli.js plugin add x",
    'env -i PATH="$PATH" node cli.js plugin add x',
    'cmd //c "@verid plugin add x"',
    "verid.cmd plugin run x",
    "env -i PATH=$PATH npx verid@1.1.0 plugin add ./x --yes",
  ];
  for (const command of rows) {
    const result = decide(
      { kind: "bash", command },
      ctx,
      new Set(["VERID_BURNT_BASH_DEVELOPER_ONLY", "VERID_BURNT_PLUGIN_PROTECTED"]),
    );
    expect
      .soft(result.kind === "deny" ? result.code : result.kind, command)
      .toBe("VERID_BURNT_PLUGIN_PROTECTED");
  }
});
