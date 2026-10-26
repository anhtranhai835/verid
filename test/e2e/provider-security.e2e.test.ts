import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = join(import.meta.dirname, "../../dist/hook.js");
let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-provider-security-"));
  mkdirSync(join(project, ".verid/.state"), { recursive: true });
  writeFileSync(join(project, ".verid/.state/state.json"), '{"schemaVersion":1}');
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

function manifest(extra: Record<string, unknown> = {}): void {
  writeFileSync(
    join(project, ".verid/manifest.yaml"),
    JSON.stringify({
      schemaVersion: 1,
      mode: "remix",
      repos: [{ path: ".", source_globs: ["src/**"], test_globs: ["test/**"] }],
      ...extra,
    }),
  );
}
function hook(payload: Record<string, unknown>, attended = false) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE")),
  );
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: "provider-security", cwd: project, ...payload }),
    encoding: "utf8",
    env: {
      ...env,
      CLAUDE_PROJECT_DIR: project,
      ...(attended ? { CLAUDE_CODE_SESSION_ATTENDED: "1" } : {}),
    },
  });
  return { code: r.status, stderr: r.stderr, stdout: r.stdout };
}
const call = (tool_name: string, tool_input: Record<string, unknown>, extra = {}) => ({
  hook_event_name: "PreToolUse",
  tool_name,
  tool_input,
  ...extra,
});
function approve(): void {
  const r = hook(
    { hook_event_name: "UserPromptSubmit", prompt: "/verid tip developer reviewed this action" },
    true,
  );
  expect(r.code).toBe(2);
  const code = /\/verid confirm ([A-Z2-9]{6})/.exec(r.stderr)?.[1];
  expect(code).toHaveLength(6);
  expect(
    hook({ hook_event_name: "UserPromptSubmit", prompt: `/verid confirm ${code}` }, true).code,
  ).toBe(0);
}

describe("Claude provider dispatch allowlists", () => {
  it("allows only fixed skill namespaces, exact additions and namespace wildcard additions", () => {
    manifest({ allowed_skills: ["team:approved", "company:*"] });
    const rows = [
      ["verid:build", 0],
      ["superpowers:test-driven-development", 0],
      ["andrej-karpathy-skills:karpathy-guidelines", 0],
      ["team:approved", 0],
      ["company:review", 0],
      ["unknown:fork", 2],
      ["team:other", 2],
      ["company", 2],
      ["company:", 2],
      ["superpowers-evil:fork", 2],
    ] as const;
    for (const [skill, code] of rows) {
      const r = hook(call("Skill", { skill }));
      expect(r.code, skill).toBe(code);
      if (code === 2) {
        expect(r.stderr).toContain("VERID_BURNT_SKILL_NOT_ALLOWED");
        expect(r.stderr).toContain("allowed_skills");
        expect(r.stderr).toContain("superpowers:*");
        expect(r.stderr).toContain("team:approved");
      }
    }
  });
  it("checks Agent and Task dispatch against all mapped roles plus exact allowed_agents", () => {
    manifest({
      roles: { reviewer: ["verid:reviewer"], researcher: ["custom:researcher"] },
      allowed_agents: ["team:helper"],
    });
    const rows = [
      ["Agent", "verid:reviewer", 0],
      ["Task", "custom:researcher", 0],
      ["Agent", "team:helper", 0],
      ["Agent", "general-purpose", 2],
      ["Task", "unknown-plugin:agent", 2],
      ["Agent", undefined, 2],
      ["Task", "team:other", 2],
    ] as const;
    for (const [tool, subagent_type, code] of rows) {
      const r = hook(call(tool, { subagent_type, prompt: "work" }));
      expect(r.code, `${tool} ${subagent_type}`).toBe(code);
      if (code === 2) {
        expect(r.stderr).toContain("VERID_BURNT_AGENT_NOT_ALLOWED");
        expect(r.stderr).toContain("roles");
        expect(r.stderr).toContain("allowed_agents");
        expect(r.stderr).toContain("verid:reviewer");
      }
    }
  });
  it("uses default skill namespaces and no unmapped agent permissions for old or absent manifests", () => {
    const rows = [false, true] as const;
    for (const old of rows) {
      if (old) manifest();
      expect(hook(call("Skill", { skill: "superpowers:test-driven-development" })).code).toBe(0);
      expect(hook(call("Skill", { skill: "unknown:fork" })).stderr).toContain(
        "VERID_BURNT_SKILL_NOT_ALLOWED",
      );
      expect(hook(call("Agent", { subagent_type: "general-purpose" })).stderr).toContain(
        "VERID_BURNT_AGENT_NOT_ALLOWED",
      );
    }
  });
  it("lets the developer override a denied skill or agent for the exact call once", () => {
    manifest();
    const rows = [
      ["Skill", { skill: "unknown:fork" }],
      ["Agent", { subagent_type: "general-purpose" }],
      ["Task", { subagent_type: "unknown-plugin:agent" }],
    ] as const;
    for (const [tool, input] of rows) {
      const payload = call(tool, input);
      expect(hook(payload).code).toBe(2);
      approve();
      expect(hook(call(tool, { ...input, prompt: "changed" })).code).toBe(2);
      expect(hook(payload).code).toBe(0);
      expect(hook(payload).code).toBe(2);
    }
  });
  it("does not let an allowlisted dispatch bypass an existing shell denial", () => {
    manifest();
    const rows = ["Skill", "Agent", "Task"];
    for (const tool of rows) {
      const r = hook(
        call(tool, {
          skill: "superpowers:test-driven-development",
          subagent_type: "unknown:agent",
          command: "write something",
        }),
      );
      expect(r.stderr).toContain("VERID_BURNT_SHELL_UNSUPPORTED");
    }
  });
  it("keeps role and TDD checks on an allowed general-purpose agent", () => {
    const rows = [
      {
        roles: { tester: ["verid:tester"], coder: ["verid:coder"] },
        path: "src/code.ts",
        code: "VERID_BURNT_ROLE_CODER_ONLY",
      },
      {
        roles: { tester: ["verid:tester"], coder: ["verid:coder"] },
        path: "test/code.test.ts",
        code: "VERID_BURNT_ROLE_TESTER_ONLY",
      },
      { roles: undefined, path: "src/code.ts", code: "VERID_BURNT_TDD_NO_FAILING_TEST" },
    ];
    for (const { roles, path, code } of rows) {
      manifest({ allowed_agents: ["general-purpose"], roles });
      expect(hook(call("Agent", { subagent_type: "general-purpose", prompt: "work" })).code).toBe(
        0,
      );
      const r = hook(
        call(
          "Write",
          { file_path: join(project, path), content: "code" },
          { agent_id: "general-1", agent_type: "general-purpose" },
        ),
      );
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(code);
    }
  });
});

describe("verid instruction block protection", () => {
  const block = "<!-- verid:begin -->\nProtected instructions\n<!-- verid:end -->";
  it("compares LF and CRLF blocks while allowing multiline edits only outside them", () => {
    manifest();
    const rows = [
      ["Edit", { old_string: "Before\nUser text", new_string: "Notes\nMore notes" }, 0],
      [
        "MultiEdit",
        { edits: [{ old_string: "Before\nUser text", new_string: "Notes\nMore notes" }] },
        0,
      ],
      ["Write", { content: `Changed\n${block}\nAfter` }, 0],
      ["Write", { content: `Changed\r\n${block.replaceAll("\n", "\r\n")}\r\nAfter` }, 0],
      ["Edit", { old_string: "Protected instructions\n", new_string: "Disabled\n" }, 2],
      ["Write", { content: `Before\n${block.replace("Protected", "Disabled")}\nAfter` }, 2],
    ] as const;
    for (const file of ["CLAUDE.md", "AGENTS.md"]) {
      for (const ending of ["\r\n", "\n"]) {
        writeFileSync(
          join(project, file),
          `Before\nUser text\n${block}\nAfter`.replaceAll("\n", ending),
        );
        for (const [tool, input, code] of rows) {
          const r = hook(call(tool, { file_path: join(project, file), ...input }));
          expect(r.code, `${file} ${JSON.stringify(ending)} ${tool} ${JSON.stringify(input)}`).toBe(
            code,
          );
          if (code === 2) expect(r.stderr).toContain("VERID_BURNT_INSTRUCTIONS_PROTECTED");
        }
      }
    }
  });
  it("allows direct edits outside either block and denies changes, removal or unverifiable writes", () => {
    manifest();
    const rows = [
      ["Write", { content: `Changed user text\n${block}\nAfter` }, 0],
      ["Edit", { old_string: "Before", new_string: "User notes" }, 0],
      [
        "MultiEdit",
        {
          edits: [
            { old_string: "Before", new_string: "Notes" },
            { old_string: "After", new_string: "More notes" },
          ],
        },
        0,
      ],
      ["Write", { content: "No block" }, 2],
      ["Edit", { old_string: "Protected", new_string: "Disabled" }, 2],
      ["Edit", { old_string: "Protected", new_string: "$&", replace_all: true }, 2],
      [
        "MultiEdit",
        {
          edits: [
            { old_string: "Before", new_string: "Notes" },
            { old_string: "verid:begin", new_string: "custom:begin" },
          ],
        },
        2,
      ],
      ["Write", {}, 2],
      ["NotebookEdit", { new_source: "arbitrary" }, 2],
      ["mcp__filesystem__write_file", { content: `Before\n${block}\nAfter` }, 2],
      ["Bash", {}, 2],
      ["Read", {}, 0],
    ] as const;
    for (const file of ["CLAUDE.md", "AGENTS.md"]) {
      writeFileSync(join(project, file), `Before\n${block}\nAfter`);
      for (const [tool, input, code] of rows) {
        const target = {
          file_path: join(project, file),
          notebook_path: join(project, file),
          path: join(project, file),
          command: `rm ${file}`,
          ...input,
        };
        // Preserve the existing unsupported-shell rule on tools with command input.
        if (tool !== "Bash") delete (target as Record<string, unknown>).command;
        const r = hook(call(tool, target));
        expect(r.code, `${file} ${tool} ${JSON.stringify(input)}`).toBe(code);
        if (code === 2) expect(r.stderr).toContain("VERID_BURNT_INSTRUCTIONS_PROTECTED");
      }
    }
  });
  it("fails closed on malformed blocks and protects parent deletion while allowing ordinary files", () => {
    manifest();
    writeFileSync(join(project, "CLAUDE.md"), "<!-- verid:begin -->\nbroken");
    const rows = [
      ["Write", { file_path: "CLAUDE.md", content: "replaced" }, 2],
      ["Bash", { command: `rm -rf "${project}"` }, 2],
      ["Write", { file_path: "README.md", content: "user docs" }, 0],
    ] as const;
    for (const [tool, input, code] of rows) {
      const result = hook(call(tool, input));
      expect(result.code).toBe(code);
      if (code === 2) expect(result.stderr).toContain("VERID_BURNT_INSTRUCTIONS_PROTECTED");
    }
  });
  it("grants an exact one-call exception without lifting the reviewer read-only rule", () => {
    manifest({ roles: { reviewer: ["verid:reviewer"] } });
    writeFileSync(join(project, "CLAUDE.md"), `Before\n${block}\nAfter`);
    const payload = call("Write", { file_path: "CLAUDE.md", content: "developer replacement" });
    expect(hook(payload).stderr).toContain("VERID_BURNT_INSTRUCTIONS_PROTECTED");
    approve();
    expect(hook(payload).code).toBe(0);
    expect(hook(payload).code).toBe(2);
    const reviewer = { ...payload, agent_id: "reviewer-1", agent_type: "verid:reviewer" };
    expect(hook(reviewer).code).toBe(2);
    approve();
    expect(hook(reviewer).stderr).toContain("VERID_BURNT_ROLE_READ_ONLY");
    expect(readFileSync(join(project, "CLAUDE.md"), "utf8")).toContain(block);
  });
});
