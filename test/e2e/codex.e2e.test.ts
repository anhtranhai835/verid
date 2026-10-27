import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const HOOK = join(ROOT, "dist/hook.js");
// Real Codex 0.164.0 hook stdin, cwd templated as in the Claude Code fixtures.
const FIXTURES = join(ROOT, "test/fixtures/codex");
let project: string;
const stateFile = () => join(project, ".verid/.state/state.json");
function manifest(extra: Record<string, unknown> = {}) {
  writeFileSync(
    join(project, ".verid/manifest.yaml"),
    JSON.stringify({
      schemaVersion: 1,
      mode: "remix",
      providers: ["codex"],
      repos: [{ path: ".", source_globs: ["src/**"], test_globs: ["test/**"] }],
      roles: {
        reviewer: ["reviewer", "verid_reviewer"],
        tester: ["verid:tester"],
        coder: ["verid:coder"],
      },
      ...extra,
    }),
  );
}
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid codex test-"));
  mkdirSync(join(project, ".verid/.state"), { recursive: true });
  writeFileSync(stateFile(), '{"schemaVersion":1,"baseline":[]}');
  manifest();
});
afterEach(() => rmSync(project, { recursive: true, force: true }));
function hook(payload: unknown, provider = "codex", extraEnv: Record<string, string> = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CODEX)/.test(k)),
  );
  const r = spawnSync(process.execPath, [HOOK, "--provider", provider], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    env: { ...env, ...extraEnv },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const envelope = (event: string, extra = {}) => ({
  session_id: "codex-session",
  transcript_path: null,
  cwd: project,
  hook_event_name: event,
  model: "gpt-6-luna",
  permission_mode: "default",
  turn_id: "codex-turn",
  ...extra,
});
const call = (tool_name: string, tool_input: Record<string, unknown>, extra = {}) => ({
  ...envelope("PreToolUse"),
  tool_name,
  tool_input,
  tool_use_id: "codex-call",
  ...extra,
});
function reason(r: ReturnType<typeof hook>): string {
  expect(r.code).toBe(0);
  expect(r.stderr).toBe("");
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;
}
const patch = (target: string) =>
  `*** Begin Patch\n*** Add File: ${target}\n+content\n*** End Patch`;

describe("Codex hook transport and policy", () => {
  it("records the mapped reviewer's final text as the open module's review", () => {
    manifest({ mode: "recipe" });
    writeFileSync(join(project, ".verid/design.md"), "# Design\n");
    writeFileSync(join(project, ".verid/plan.md"), "## Module: feature\n- AC-1: adds\n");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CODEX)/.test(k)),
    );
    const approved = spawnSync(process.execPath, [join(ROOT, "dist/cli.js"), "order", "feature"], {
      cwd: project,
      env,
      encoding: "utf8",
    });
    expect(approved.status, approved.stderr).toBe(0);
    const message = "AC-1 and design checked against the diff.\nVerdict: pass";
    const r = hook(
      envelope("SubagentStop", {
        agent_id: "review-1",
        agent_type: "verid_reviewer",
        agent_transcript_path: null,
        stop_hook_active: false,
        last_assistant_message: message,
      }),
    );
    expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
    const state = JSON.parse(readFileSync(stateFile(), "utf8"));
    expect(state.review).toMatchObject({
      module: "feature",
      agent_type: "verid_reviewer",
      verdict: "pass",
    });
    expect(readFileSync(join(project, state.review.file), "utf8")).toBe(message);
  });
  it.skipIf(process.platform !== "win32")(
    "reuses Windows path normalization for Codex configuration and shell mentions",
    () => {
      const config = join(project, ".codex");
      mkdirSync(config);
      writeFileSync(join(config, "hooks.json"), "{}\r\n");
      const base = join(config, "hooks.json");
      const share = `\\\\arbitrary-host.invalid\\${base[0]}$${base.slice(2)}`;
      const rows = [
        base.toUpperCase(),
        `\\\\?\\${base}`,
        `${base}:data`,
        share,
        `\\\\?\\UNC\\arbitrary-host.invalid\\${base[0]}$${base.slice(2)}`,
      ];
      const short = spawnSync("cmd.exe", ["/d", "/c", `for %I in ("${config}") do @echo %~sI`], {
        encoding: "utf8",
      });
      expect(short.status).toBe(0);
      rows.push(join(short.stdout.trim(), "hooks.json"));
      for (const path of rows) {
        expect(reason(hook(call("apply_patch", { command: patch(path) }))), path).toContain(
          "VERID_BURNT_HOOK_PROTECTED",
        );
        expect(
          reason(
            hook(call("Bash", { command: `Set-Content '${path.replaceAll("\\", "\\\\")}' x` })),
          ),
          path,
        ).toContain("VERID_BURNT_HOOK_PROTECTED");
      }
    },
  );
  it("encodes SessionStart context as Codex JSON", () => {
    const r = hook(envelope("SessionStart", { source: "startup" }));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: expect.stringContaining("TDD RAW"),
      },
    });
    expect(r.stdout).toContain("main agent writes tests and code");
    expect(r.stdout).not.toContain("the tester writes the failing test");
  });
  it("refuses developer CLI commands when a Codex tool-shell marker is present", () => {
    const rows = [
      [["cook", "--dry-run"], "VERID_BURNT_INIT_IN_AGENT"],
      [["upgrade", "--dry-run"], "VERID_BURNT_INIT_IN_AGENT"],
      [["garnish"], "VERID_BURNT_REFACTOR_IN_AGENT"],
      [["stock"], "VERID_BURNT_BASELINE_IN_AGENT"],
      [["order"], "VERID_BURNT_APPROVE_IN_AGENT"],
      [["serve", "module"], "VERID_BURNT_SERVE_IN_AGENT"],
      [["plugin", "list"], "VERID_BURNT_PLUGIN_IN_AGENT"],
    ] as const;
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CODEX)/.test(k)),
    );
    for (const [args, expected] of rows) {
      const r = spawnSync(process.execPath, [join(ROOT, "dist/cli.js"), ...args], {
        cwd: project,
        env: { ...env, CODEX_THREAD_ID: "tool-shell-thread" },
        encoding: "utf8",
      });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(expected);
    }
  });
  it("runs all captured event and tool envelopes through the real hook", () => {
    const rows = [
      ["session-start.json", "allow"],
      ["user-prompt-submit.json", "allow"],
      ["pre-tool-use-bash.json", "allow"],
      ["post-tool-use-bash.json", "allow"],
      ["pre-tool-use-apply-patch-add.json", "allow"],
      ["post-tool-use-apply-patch-add.json", "allow"],
      ["pre-tool-use-apply-patch-update.json", "allow"],
      ["post-tool-use-apply-patch-update.json", "allow"],
      ["pre-tool-use-apply-patch-move-invalid.json", "VERID_BURNT_PATCH_UNSUPPORTED"],
      ["pre-tool-use-apply-patch-move.json", "allow"],
      ["post-tool-use-apply-patch-move.json", "allow"],
      ["pre-tool-use-apply-patch-delete.json", "allow"],
      ["post-tool-use-apply-patch-delete.json", "allow"],
      ["pre-tool-use-mcp.json", "allow"],
      ["post-tool-use-mcp.json", "allow"],
      ["pre-tool-use-spawn-agent.json", "allow"],
      ["post-tool-use-spawn-agent.json", "allow"],
      ["subagent-start.json", "allow"],
      ["pre-tool-use-subagent-bash.json", "allow"],
      ["post-tool-use-subagent-bash.json", "allow"],
      ["subagent-stop.json", "allow"],
      ["pre-tool-use-wait-agent.json", "allow"],
      ["post-tool-use-wait-agent.json", "allow"],
      ["stop-observe.json", "allow"],
      ["session-end.json", "allow"],
      ["stop-hook-active-false.json", "allow"],
      ["stop-hook-active-true.json", "allow"],
    ];
    expect(rows.map(([f]) => f).sort()).toEqual(readdirSync(FIXTURES).sort());
    for (const [file, expected] of rows) {
      const p = JSON.parse(readFileSync(join(FIXTURES, file!), "utf8"));
      const r = hook({ ...p, cwd: project });
      expect(r.code, file).toBe(0);
      expect(r.stderr, file).toBe("");
      if (expected !== "allow") expect(reason(r), file).toContain(expected);
      else expect(r.stdout, file).not.toContain('"permissionDecision":"deny"');
    }
  });
  it("uses the tested JSON denial shape and keeps Claude denial bytes", () => {
    const p = call("Bash", { command: "echo x > .verid/.state/state.json" });
    const r = hook(p);
    expect(JSON.parse(r.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("VERID_BURNT_STATE_PROTECTED"),
      },
    });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const claude = hook(p, "claude-code");
    expect(claude.code).toBe(2);
    expect(claude.stdout).toBe("");
    expect(claude.stderr).toMatch(/^verid \[VERID_BURNT_STATE_PROTECTED\]\n/);
  });
  it("validates each event: tool calls fail closed, a broken lifecycle or prompt never holds", () => {
    // A denial names what is wrong: the field, or that the event is unknown.
    const rows = [
      ["not json", "not JSON"],
      [call("Bash", { command: 1 }), "command"],
      [{ ...call("Bash", { command: "echo ok" }), turn_id: undefined }, "turn_id"],
      [{ ...call("Bash", { command: "echo ok" }), tool_use_id: undefined }, "tool_use_id"],
      [envelope("Unknown"), "unknown hook_event_name"],
      // As on Claude Code: Codex continues every held Stop, so a hold on error would never end.
      [{ ...envelope("Stop", { stop_hook_active: false }), last_assistant_message: 42 }, "pass"],
      [
        envelope("SubagentStop", {
          stop_hook_active: false,
          last_assistant_message: null,
          agent_transcript_path: null,
        }),
        "pass",
      ],
      [{ ...envelope("SessionStart"), source: 7 }, "pass"],
      [{ ...envelope("UserPromptSubmit"), prompt: 7 }, "pass"],
    ] as const;
    for (const [p, expected] of rows) {
      const r = hook(p);
      expect(r.code).toBe(0);
      if (expected !== "pass") {
        expect(r.stdout).toContain("VERID_BURNT_PAYLOAD");
        expect(r.stdout).toMatch(/"(?:permissionDecision|decision)":"(?:deny|block)"/);
        expect(r.stdout.length, r.stdout).toBeLessThan(600);
        expect(r.stdout).toContain(expected);
      } else {
        expect(r.stdout, JSON.stringify(p)).toBe("");
        expect(r.stderr).toContain("VERID_BURNT_PAYLOAD");
      }
    }
  });
  it("returns the tested hold shape for Stop and SubagentStop", () => {
    writeFileSync(
      stateFile(),
      '{"schemaVersion":1,"tdd":{"state":"COOKING","last_run":null},"writers":["child"]}',
    );
    const rows = [
      envelope("Stop", { stop_hook_active: false, last_assistant_message: null }),
      envelope("SubagentStop", {
        agent_id: "child",
        agent_type: "other",
        agent_transcript_path: null,
        stop_hook_active: false,
        last_assistant_message: null,
      }),
    ];
    for (const p of rows) {
      const r = hook(p);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
      expect(JSON.parse(r.stdout)).toEqual({
        decision: "block",
        reason: expect.stringContaining("COOKING"),
      });
    }
  });
  it("keeps the main writer unsplit while applying TDD and reviewer read-only", () => {
    // A dual-provider project may map a Codex security agent: it reads only, from a fresh context.
    manifest({
      roles: {
        reviewer: ["reviewer", "verid_reviewer"],
        tester: ["verid:tester"],
        coder: ["verid:coder"],
        security: ["codex_security"],
      },
    });
    const rows = [
      ["test/example.test.ts", {}, "allow"],
      ["src/example.ts", {}, "VERID_BURNT_TDD_NO_FAILING_TEST"],
      [
        "notes.txt",
        { agent_id: "review-1", agent_type: "verid_reviewer" },
        "VERID_BURNT_ROLE_READ_ONLY",
      ],
      ["test/example.test.ts", { agent_type: "verid_reviewer" }, "allow"],
      [
        "notes.txt",
        { agent_id: "security-1", agent_type: "codex_security" },
        "VERID_BURNT_ROLE_READ_ONLY",
      ],
    ] as const;
    for (const [path, identity, expected] of rows) {
      const r = hook(call("apply_patch", { command: patch(path) }, identity));
      if (expected === "allow") expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
      else expect(reason(r)).toContain(expected);
    }
    writeFileSync(stateFile(), '{"schemaVersion":1,"tdd":{"state":"COOKING","last_run":null}}');
    expect(hook(call("apply_patch", { command: patch("src/example.ts") }))).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
  });
  it("judges every patch target before writing and never accepts environment routing", () => {
    const rows = [
      [
        "*** Begin Patch\n*** Update File: test/old.ts\n*** Move to: src/new.ts\n@@\n-old\n+new\n*** End Patch",
        "VERID_BURNT_TDD_NO_FAILING_TEST",
      ],
      [
        "*** Begin Patch\n*** Delete File: .codex/hooks.json\n*** Add File: test/ok.ts\n+ok\n*** End Patch",
        "VERID_BURNT_HOOK_PROTECTED",
      ],
      [
        "*** Begin Patch\n*** Add File: test/ok.ts\n+ok\n*** Add File: src/new.ts\n+code\n*** End Patch",
        "VERID_BURNT_TDD_NO_FAILING_TEST",
      ],
      [
        "*** Begin Patch\nEnvironment ID: other\n*** Add File: test/ok.ts\n+ok\n*** End Patch",
        "VERID_BURNT_PATCH_UNSUPPORTED",
      ],
      // Codex trims the NEL off and writes the manifest.
      [
        "*** Begin Patch\n*** Add File: .verid/manifest.yaml\u0085\n+x\n*** End Patch",
        "VERID_BURNT_PATCH_UNSUPPORTED",
      ],
    ];
    for (const [command, expected] of rows)
      expect(reason(hook(call("apply_patch", { command })))).toContain(expected);
  });
  it("audits a malformed patch like any other denial", () => {
    const r = hook(call("apply_patch", { command: "not a patch" }));
    expect(reason(r)).toContain("VERID_BURNT_PATCH_UNSUPPORTED");
    expect(readFileSync(join(project, ".verid/.state/audit.jsonl"), "utf8")).toContain(
      "VERID_BURNT_PATCH_UNSUPPORTED",
    );
  });
  it.skipIf(process.platform !== "win32")(
    "judges a new file with trailing dots or spaces as the file Windows writes",
    () => {
      const rows = [
        ["codex", call("apply_patch", { command: patch("src/c.ts.") })],
        ["codex", call("apply_patch", { command: patch("src/c.ts. .") })],
        ["codex", call("Bash", { command: "Set-Content 'src/d.ts.' x" })],
        ["codex", call("apply_patch", { command: patch("src./e.ts") })],
        [
          "claude-code",
          call(
            "Write",
            { file_path: "src/b.ts.", content: "x" },
            { agent_id: "coder-1", agent_type: "verid:coder" },
          ),
        ],
      ] as const;
      for (const [provider, payload] of rows) {
        const r = hook(payload, provider);
        const text = provider === "codex" ? reason(r) : r.stderr;
        expect(text, JSON.stringify(payload.tool_input)).toContain(
          "VERID_BURNT_TDD_NO_FAILING_TEST",
        );
      }
    },
  );
  it("refuses unverified shell and workdir overrides instead of assuming fixture metadata", () => {
    const rows = [
      { command: "echo ok", shell: "bash" },
      { command: "Set-Content code.ts x", workdir: "src" },
      { command: "Set-Content code.ts x", cwd: "src" },
    ];
    for (const input of rows)
      expect(reason(hook(call("Bash", input)))).toContain("VERID_BURNT_SHELL_UNSUPPORTED");
  });
  it("requires allowlisted agent_type and a fresh reviewer context", () => {
    // A dual-provider project may map a Codex security agent: it reads only, from a fresh context.
    manifest({
      roles: {
        reviewer: ["reviewer", "verid_reviewer"],
        tester: ["verid:tester"],
        coder: ["verid:coder"],
        security: ["codex_security"],
      },
    });
    const rows = [
      [{ agent_type: "verid_reviewer", fork_turns: "none" }, "allow"],
      [{ agent_type: "reviewer", fork_turns: "none" }, "allow"],
      [{ agent_type: "unmapped", fork_turns: "none" }, "VERID_BURNT_AGENT_NOT_ALLOWED"],
      [{ fork_turns: "none" }, "VERID_BURNT_AGENT_NOT_ALLOWED"],
      [{ agent_type: "verid_reviewer" }, "VERID_BURNT_AGENT_CONTEXT"],
      [{ agent_type: "verid_reviewer", fork_turns: "all" }, "VERID_BURNT_AGENT_CONTEXT"],
      [{ agent_type: "codex_security", fork_turns: "none" }, "allow"],
      [{ agent_type: "codex_security", fork_turns: "all" }, "VERID_BURNT_AGENT_CONTEXT"],
    ] as const;
    for (const [input, expected] of rows) {
      const r = hook(call("collaborationspawn_agent", input));
      if (expected === "allow") expect(r.stdout).toBe("");
      else expect(reason(r)).toContain(expected);
    }
  });
  it("denies unknown tools and keeps the observed read/control tools and MCP usable", () => {
    const rows = [
      ["collaborationwait_agent", { timeout_ms: 30000 }, "allow"],
      // Codex's plan tool only updates the plan shown to the developer.
      ["update_plan", { plan: [{ step: "write the test", status: "in_progress" }] }, "allow"],
      ["Read", { file_path: "notes.txt" }, "allow"],
      [
        "mcp__files__write",
        { target: { path: ".codex/config.toml" } },
        "VERID_BURNT_HOOK_PROTECTED",
      ],
      ["collaborationfollowup_task", { message: "work" }, "VERID_BURNT_TOOL_UNSUPPORTED"],
      ["unknown_writer", { file_path: "src/code.ts" }, "VERID_BURNT_TOOL_UNSUPPORTED"],
    ] as const;
    for (const [tool, input, expected] of rows) {
      const r = hook(call(tool, input));
      if (expected === "allow") expect(r.stdout).toBe("");
      else {
        expect(reason(r)).toContain(expected);
        if (expected === "VERID_BURNT_TOOL_UNSUPPORTED") expect(r.stdout).toContain(tool);
      }
    }
  });
  it("unions PowerShell and Bash targets and rejects unreadable shell constructs", () => {
    const rows = [
      ["Set-Content src/code.ts 'code'", "VERID_BURNT_TDD_NO_FAILING_TEST"],
      ["Set-Content test/code.test.ts 'test'", "allow"],
      ["echo x | Out-File .codex/hooks.json", "VERID_BURNT_HOOK_PROTECTED"],
      ["rm src/code.ts", "VERID_BURNT_TDD_NO_FAILING_TEST"],
      ["iex $command", "VERID_BURNT_SHELL_UNSUPPORTED"],
      ["pwsh -EncodedCommand ZQBjAGgAbwA=", "VERID_BURNT_SHELL_UNSUPPORTED"],
      ["[ScriptBlock]::Create($text)", "VERID_BURNT_SHELL_UNSUPPORTED"],
      ["& $program 'text'", "VERID_BURNT_SHELL_UNSUPPORTED"],
      ["codex exec 'write code'", "VERID_BURNT_BASH_NESTED_CODEX"],
      // Codex applies a patch handed to the shell from a workdir or `cd` the hook never sees, so
      // only the apply_patch tool, resolved against the hook's cwd, may carry one.
      [
        "apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: src/code.ts\n+x\n*** End Patch\nEOF",
        "VERID_BURNT_PATCH_UNSUPPORTED",
      ],
      [
        "apply_patch '*** Begin Patch\n*** Delete File: .codex/hooks.json\n*** End Patch'",
        "VERID_BURNT_HOOK_PROTECTED",
      ],
      [
        "apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: test/code.test.ts\n+x\n*** End Patch\nEOF",
        "VERID_BURNT_PATCH_UNSUPPORTED",
      ],
      [
        "cd src && apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: a.ts\n+x\n*** End Patch\nEOF",
        "VERID_BURNT_PATCH_UNSUPPORTED",
      ],
      [
        "cd .codex && apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: hooks.json\n@@\n-x\n+y\n*** End Patch\nEOF",
        "VERID_BURNT_PATCH_UNSUPPORTED",
      ],
      ['apply_patch "$patch"', "VERID_BURNT_PATCH_UNSUPPORTED"],
      ["applypatch < change.patch", "VERID_BURNT_PATCH_UNSUPPORTED"],
      // Codex puts .bat shims for the patch program on PATH on Windows.
      ["apply_patch.bat (Get-Content -Raw test/p.txt)", "VERID_BURNT_PATCH_UNSUPPORTED"],
      // PowerShell runs `name(…)` with the parenthesis's output as the argument.
      ["apply_patch(Get-Content -Raw test/p.txt)", "VERID_BURNT_PATCH_UNSUPPORTED"],
      ["apply_patch.bat(Get-Content -Raw test/p.txt)", "VERID_BURNT_PATCH_UNSUPPORTED"],
      ["cmd /c applypatch.cmd < test/p.txt", "VERID_BURNT_PATCH_UNSUPPORTED"],
      ["verid setup-codex", "VERID_BURNT_BASH_DEVELOPER_ONLY"],
      ["npx verid taste", "allow"],
      ["git diff --stat", "allow"],
      ["npm test", "allow"],
    ];
    for (const [command, expected] of rows) {
      const r = hook(call("Bash", { command }));
      if (expected === "allow") expect(r.stdout, command).toBe("");
      else expect(reason(r), command).toContain(expected);
      if (expected === "VERID_BURNT_PATCH_UNSUPPORTED")
        expect(reason(r), command).toContain("apply_patch tool");
    }
  });
  it("protects Codex configuration, skills, transcripts and secrets through path aliases", () => {
    const home = homedir();
    const rows = [
      [".codex/hooks.json", "VERID_BURNT_HOOK_PROTECTED"],
      [".agents/skills/fork/SKILL.md", "VERID_BURNT_HOOK_PROTECTED"],
      [join(home, ".codex/config.toml"), "VERID_BURNT_HOOK_PROTECTED"],
      [join(home, ".agents/skills/fork/SKILL.md"), "VERID_BURNT_HOOK_PROTECTED"],
      [join(home, ".codex/sessions/log.jsonl"), "VERID_BURNT_TRANSCRIPT_PROTECTED"],
      [join(home, ".codex/auth.json"), "VERID_BURNT_SECRET_PROTECTED"],
      [join(ROOT, "plugin/codex/verid-reviewer.toml"), "VERID_BURNT_HOOK_PROTECTED"],
      // The AGENTS.md block sends Codex to these installed skills by absolute path.
      [join(ROOT, "plugin/skills/review/SKILL.md"), "VERID_BURNT_HOOK_PROTECTED"],
    ];
    for (const [path, expected] of rows) {
      expect(reason(hook(call("apply_patch", { command: patch(path!) })))).toContain(expected);
      const doubled = path!.replaceAll("/", "//").replaceAll("\\", "\\\\");
      expect(reason(hook(call("Bash", { command: `Set-Content '${doubled}' x` })))).toContain(
        expected,
      );
    }
    // Codex's home also keeps prompt history and thread databases beside the sessions.
    const reads = [
      [join(home, ".codex/auth.json"), "VERID_BURNT_SECRET_PROTECTED"],
      [join(home, ".codex/sessions/x.jsonl"), "VERID_BURNT_TRANSCRIPT_PROTECTED"],
      [join(home, ".codex/history.jsonl"), "VERID_BURNT_TRANSCRIPT_PROTECTED"],
      [join(home, ".codex/sqlite/codex-dev.db"), "VERID_BURNT_TRANSCRIPT_PROTECTED"],
      [join(home, ".codex/logs_2.sqlite"), "VERID_BURNT_TRANSCRIPT_PROTECTED"],
    ];
    for (const [path, expected] of reads) {
      expect(reason(hook(call("Read", { file_path: path }))), path).toContain(expected);
      expect(hook(call("Read", { file_path: path }), "claude-code").stderr, path).toContain(
        expected,
      );
    }
  });
  it("reminds the agent through Codex context that research comes first", () => {
    manifest({ mode: "recipe" });
    const rows = ["build the login page", "/verid peek"];
    for (const prompt of rows) {
      const r = hook(envelope("UserPromptSubmit", { prompt }));
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: expect.stringContaining("research missing"),
        },
      });
    }
  });
  it("lets the developer override a nested-Codex false positive on Claude Code only", () => {
    const rows = [
      ["claude-code", "grep -rn codex src", "only the developer can override"],
      ["codex", "grep -rn codex src", "VERID_BURNT_BASH_NESTED_CODEX"],
    ] as const;
    for (const [provider, command, expected] of rows) {
      const r = hook(call("Bash", { command }), provider);
      const text = provider === "codex" ? reason(r) : r.stderr;
      expect(text).toContain("VERID_BURNT_BASH_NESTED_CODEX");
      expect(text).toContain(expected);
      expect(text).not.toContain("cannot be overridden");
    }
  });
  it("never creates or consumes a developer exception on Codex", () => {
    const denied = call("Bash", { command: "verid stock" });
    expect(reason(hook(denied))).toContain("VERID_BURNT_BASH_DEVELOPER_ONLY");
    const rows = ["/verid tip allowed", "/verid confirm ABCDEF"];
    for (const prompt of rows) {
      expect(hook(envelope("UserPromptSubmit", { prompt }))).toEqual({
        code: 0,
        stdout: "",
        stderr: "",
      });
      expect(reason(hook(denied))).toContain("VERID_BURNT_BASH_DEVELOPER_ONLY");
    }
    const state = JSON.parse(readFileSync(stateFile(), "utf8"));
    expect(state.override ?? null).toBeNull();
  });
});
