import { tempProject, HOOK, type Run } from "../support/project.js";
import { caseInsensitiveFs } from "../support/temporary.js";

import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyAuditChain } from "../../src/adapters/audit-log.js";
import { runHook } from "./in-process.js";
import { type Payload } from "./helpers.js";

let project: string;
let stateFile: string;
let auditFile: string;
let lockFile: string;

const t = tempProject("verid-e2e-", {
  state: '{"schemaVersion":1}',
  bind: (p) => ({ dir: project, stateFile, auditFile, lockFile } = p),
});
const { fixture, hookSync: hook, hookAsync, state, audit, reset: freshState } = t;

const ATTENDED = { CLAUDE_CODE_SESSION_ATTENDED: "1" };
const prompt = (text: string, edit?: (p: Payload) => void) =>
  fixture("user-prompt-submit-verid-tip", (p) => {
    p.prompt = text;
    edit?.(p);
  });
const writeManifest = (content = "schemaVersion: 1") =>
  fixture("pre-tool-use-write-verid-manifest", (p) => (p.tool_input.content = content));
const readFile = (path: string) =>
  fixture("pre-tool-use-read", (p) => (p.tool_input.file_path = path));

describe("1. the hook really blocks forbidden actions", () => {
  it("denies a recorded Write into .verid/.state with exit 2 and a stable code", () => {
    const r = hook(fixture("pre-tool-use-write-verid-state"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_STATE_PROTECTED]");
    expect(r.stderr).toMatch(/^vi: .+/m);
    expect(r.stderr).toMatch(/^en: .+/m);
    expect(state().counters.blocked_actions).toBe(1);
  });

  // Tables of cases call the hook in process; the spawned rows above prove the built file runs it.
  it("runs one payload in process as the built hook does, without reading stdin on import", async () => {
    // Importing the hook must not start it: a started hook reads stdin and sets the exit code.
    expect(process.exitCode).toBeUndefined();
    const codex = (tool_input: Payload) =>
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "codex-session",
        transcript_path: null,
        cwd: project,
        model: "gpt-6-luna",
        permission_mode: "default",
        turn_id: "codex-turn",
        tool_name: "Read",
        tool_use_id: "codex-call",
        tool_input,
      });
    const rows = [
      [fixture("pre-tool-use-write-verid-state"), [], 2, "", "VERID_BURNT_STATE_PROTECTED"],
      [fixture("pre-tool-use-read"), [], 0, "", ""],
      ["{", [], 2, "", "VERID_BURNT_PAYLOAD"],
      [fixture("pre-tool-use-read"), ["--provider", "cursor"], 2, "", "VERID_BURNT_PAYLOAD"],
      [
        codex({ file_path: ".verid/.state/state.json" }),
        ["--provider", "codex"],
        0,
        '"permissionDecision":"deny"',
        "",
      ],
    ] as const;
    for (const [input, args, code, stdout, stderr] of rows) {
      const r = await runHook(input, { CLAUDE_PROJECT_DIR: project }, [...args]);
      expect.soft(r.code, input).toBe(code);
      if (stdout) expect.soft(r.stdout, input).toContain(stdout);
      else expect.soft(r.stdout, input).toBe("");
      if (stderr) expect.soft(r.stderr, input).toContain(stderr);
      else expect.soft(r.stderr, input).toBe("");
    }
  });

  it("denies reading state (through mixed slashes, case and ..), secrets and transcripts", () => {
    // Another case names the same folder only where the file system ignores case.
    const stateDir = caseInsensitiveFs() ? ".VERID/.State" : ".verid/.state";
    const rows: [string, string][] = [
      [`${project}/SRC/../${stateDir}/state.json`, "VERID_BURNT_STATE_PROTECTED"],
      [join(project, ".env"), "VERID_BURNT_SECRET_PROTECTED"],
      [join(homedir(), ".claude", "projects", "p", "s.jsonl"), "VERID_BURNT_TRANSCRIPT_PROTECTED"],
    ];
    for (const [path, code] of rows) {
      const r = hook(readFile(path));
      expect(r.code, path).toBe(2);
      expect(r.stderr, path).toContain(`[${code}]`);
    }
  });

  it("denies writing the hook settings or the running hook, and no override can lift it", () => {
    for (const path of [join(project, ".claude", "settings.local.json"), HOOK]) {
      const r = hook(fixture("pre-tool-use-write", (p) => (p.tool_input.file_path = path)));
      expect(r.code, path).toBe(2);
      expect(r.stderr, path).toContain("verid [VERID_BURNT_HOOK_PROTECTED]");
      expect(r.stderr, path).toContain("cannot be overridden");
    }
  });

  it("denies writing an agent definition, and no override can lift it", () => {
    const path = join(project, ".claude", "agents", "x.md");
    const r = hook(fixture("pre-tool-use-write", (p) => (p.tool_input.file_path = path)));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_HOOK_PROTECTED]");
    expect(hook(prompt("/verid tip x"), ATTENDED).stderr).toContain(
      "[VERID_BURNT_OVERRIDE_FORBIDDEN]",
    );
  });

  it("denies an MCP tool reading a secret, verid state or a transcript", () => {
    const rows: [string, string][] = [
      [join(project, ".env"), "VERID_BURNT_SECRET_PROTECTED"],
      [stateFile, "VERID_BURNT_STATE_PROTECTED"],
      [join(homedir(), ".claude", "projects", "p", "s.jsonl"), "VERID_BURNT_TRANSCRIPT_PROTECTED"],
    ];
    for (const [path, code] of rows) {
      const r = hook(
        fixture("pre-tool-use-read", (p) => {
          p.tool_name = "mcp__filesystem__read_text_file";
          p.tool_input = { path, head: 10 };
        }),
      );
      expect(r.code, path).toBe(2);
      expect(r.stderr, path).toContain(code);
    }
  });

  it("denies Bash copying a file over the hook verid is running", () => {
    const r = hook(
      fixture("pre-tool-use-bash", (p) => (p.tool_input.command = `cp evil.js "${HOOK}"`)),
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_HOOK_PROTECTED]");
  });

  it("denies Bash that splits a secret file name with quotes", () => {
    const r = hook(fixture("pre-tool-use-bash", (p) => (p.tool_input.command = 'cat .e""nv')));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_SECRET_PROTECTED]");
  });
});

describe("2. valid actions run normally", () => {
  it("audits the recorded unmapped Agent payload without blocking", () => {
    const result = hook(fixture("pre-tool-use-agent"));
    expect(result.code).toBe(0);
    expect(readFileSync(join(project, ".verid/.state/audit.jsonl"), "utf8")).toContain(
      "VERID_BURNT_AGENT_NOT_ALLOWED",
    );
  });
  it("lets every recorded harmless payload through silently", () => {
    for (const name of [
      "pre-tool-use-write",
      "pre-tool-use-edit",
      "pre-tool-use-notebook-edit",
      "pre-tool-use-bash",
      "pre-tool-use-read",
      "pre-tool-use-grep",
      "pre-tool-use-glob",
      "pre-tool-use-read-from-subagent",
      "pre-tool-use-write-from-plugin-agent",
      "session-start",
      "stop",
      "subagent-stop-reviewer",
    ]) {
      freshState();
      expect(hook(fixture(name)), name).toEqual({ code: 0, stdout: "", stderr: "" });
    }
  });

  it("lets ordinary prompts through untouched, even without state", () => {
    rmSync(stateFile);
    expect(hook(prompt("please add a test"), ATTENDED)).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
  });
});

describe("3. errors fail closed", () => {
  // Until a valid payload names the project, its language is not known: both are printed.
  it("denies a payload it cannot read, in both languages unless it named the project", () => {
    writeFileSync(stateFile, '{"schemaVersion":1,"language":"vi"}');
    const rows: [string, string, boolean][] = [
      ["not JSON", "{oops", true],
      ["no tool_name", fixture("pre-tool-use-write", (p) => delete p.tool_name), true],
      [
        "valid, but a Write without a path",
        fixture("pre-tool-use-write", (p) => delete p.tool_input.file_path),
        false,
      ],
    ];
    for (const [name, input, both] of rows) {
      const r = hook(input);
      expect(r.code, name).toBe(2);
      expect(r.stderr, name).toContain("[VERID_BURNT_PAYLOAD]");
      expect(/^en: /m.test(r.stderr), name).toBe(both);
    }
  });

  it("denies even a harmless Write when state is missing, broken or unreadable", () => {
    const rows: [string, () => void, string][] = [
      ["state.json missing", () => rmSync(stateFile), "VERID_BURNT_STATE_MISSING"],
      [
        "whole .verid folder removed",
        () => rmSync(join(project, ".verid"), { recursive: true }),
        "VERID_BURNT_STATE_MISSING",
      ],
      [
        "state.json is not JSON",
        () => writeFileSync(stateFile, "{nope"),
        "VERID_BURNT_STATE_CORRUPT",
      ],
      [
        "unknown field in state, next to a chosen language",
        () => writeFileSync(stateFile, '{"schemaVersion":1,"language":"vi","x":1}'),
        "VERID_BURNT_STATE_CORRUPT",
      ],
      [
        "unknown schemaVersion",
        () => writeFileSync(stateFile, '{"schemaVersion":99}'),
        "VERID_BURNT_STATE_VERSION",
      ],
      [
        "unexpected I/O error (state.json is a folder)",
        () => {
          rmSync(stateFile);
          mkdirSync(stateFile);
        },
        "VERID_BURNT_INTERNAL",
      ],
    ];
    for (const [name, breakIt, code] of rows) {
      freshState();
      breakIt();
      const r = hook(fixture("pre-tool-use-write"));
      expect(r.code, name).toBe(2);
      expect(r.stderr, name).toContain(`[${code}]`);
      expect(/^en: /m.test(r.stderr), name).toBe(true); // a state it cannot read names no language
    }
  });

  it("points the developer to verid cook when state is missing", () => {
    rmSync(stateFile);
    expect(hook(fixture("pre-tool-use-write")).stderr).toMatch(/cli\.js" cook`/);
  });

  it("waits ~1s before taking over a fresh lock whose holder is gone (it may be a just-released one)", () => {
    writeFileSync(lockFile, JSON.stringify({ pid: 999_999_999, at: Date.now() }));
    const started = Date.now();
    const r = hook(fixture("pre-tool-use-write-verid-state"));
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(r.stderr).toContain("[VERID_BURNT_STATE_PROTECTED]");
  });

  it("denies with VERID_BURNT_LOCK_TIMEOUT when a live process holds the lock", () => {
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }));
    const r = hook(fixture("pre-tool-use-write-verid-state"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("[VERID_BURNT_LOCK_TIMEOUT]");
  });

  it("takes over a stale lock: its holder is gone, or it is older than 10s", () => {
    for (const lock of [
      { pid: 999_999_999, at: Date.now() - 2_000 },
      { pid: process.pid, at: Date.now() - 60_000 },
    ]) {
      freshState();
      writeFileSync(lockFile, JSON.stringify(lock));
      utimesSync(lockFile, new Date(lock.at), new Date(lock.at));
      const r = hook(fixture("pre-tool-use-write-verid-state"));
      expect(r.stderr, JSON.stringify(lock)).toContain("[VERID_BURNT_STATE_PROTECTED]");
    }
  });

  it("never blocks Stop, whatever breaks", () => {
    writeFileSync(stateFile, "{nope");
    expect(hook(fixture("stop")).code).toBe(0);
    expect(hook('{"hook_event_name":"Stop", broken').code).toBe(0);
    rmSync(join(project, ".verid"), { recursive: true });
    expect(hook(fixture("stop")).code).toBe(0);
    expect(hook(fixture("session-start")).code).toBe(0);
  });

  it("lets a /verid prompt through with a warning but creates no override when state is broken", () => {
    writeFileSync(stateFile, '{"schemaVersion":1,"x":1}');
    const r = hook(prompt("/verid tip x"), ATTENDED);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).systemMessage).toContain("VERID_BURNT_STATE_CORRUPT");
    expect(readFileSync(stateFile, "utf8")).toBe('{"schemaVersion":1,"x":1}');
  });
});

describe("4. the agent cannot forge an override", () => {
  it("ignores /verid tip written inside tool input", () => {
    const r = hook(writeManifest("/verid tip x"));
    expect(r.code).toBe(2);
    expect(
      hook(fixture("pre-tool-use-bash", (p) => (p.tool_input.command = 'echo "/verid tip x"')))
        .code,
    ).toBe(0);
    expect(state().pending_override).toBeNull();
    expect(state().overrides).toEqual([]);
  });

  it("rejects /verid tip from claude -p, an unknown session or a subagent", () => {
    const rows: [string, Payload, Record<string, string>][] = [
      [
        "CLAUDE_CODE_SESSION_ATTENDED=0 (nested claude -p)",
        {},
        { CLAUDE_CODE_SESSION_ATTENDED: "0" },
      ],
      ["no CLAUDE_CODE_SESSION_ATTENDED", {}, {}],
      ["a subagent prompt (agent_id)", { agent_id: "a1c3eb1467eb86b66" }, ATTENDED],
    ];
    for (const [name, fields, extraEnv] of rows) {
      freshState();
      hook(writeManifest());
      const r = hook(
        prompt("/verid tip x", (p) => Object.assign(p, fields)),
        extraEnv,
      );
      expect(r.code, name).toBe(2);
      expect(r.stderr, name).toContain("[VERID_BURNT_OVERRIDE_UNATTENDED]");
      expect(state().pending_override, name).toBeNull();
    }
  });
});

describe("5. an override works once, for the exact action, and is audited", () => {
  const confirmCode = (r: Run) => /\/verid confirm ([A-Z2-9]{6})/.exec(r.stderr)?.[1] ?? "";

  it("deny → tip (risk warning) → confirm → retry once → deny again", () => {
    expect(hook(writeManifest()).code).toBe(2);

    const warned = hook(prompt("/verid tip need to bump schema"), ATTENDED);
    expect(warned.code).toBe(2);
    expect(warned.stderr).toContain("RISK WARNING");
    expect(warned.stderr).toContain("CẢNH BÁO RỦI RO");
    expect(warned.stderr).not.toContain("override.risk_warning"); // a message, not a code
    const code = confirmCode(warned);
    expect(code).toHaveLength(6);
    expect(state().overrides).toEqual([]);

    const confirmed = hook(prompt(`/verid confirm ${code}`), ATTENDED);
    expect(confirmed.code).toBe(0);
    expect(confirmed.stdout).toContain("exactly once");

    expect(hook(writeManifest("schemaVersion: 2")).code).toBe(2); // a different action
    expect(hook(writeManifest()).code).toBe(0); // the exact denied action
    expect(hook(writeManifest()).code).toBe(2); // used up

    const events = audit().map((e) => e.event);
    expect(events).toEqual([
      "denied",
      "override_warned",
      "override_created",
      "denied",
      "override_used",
      "denied",
    ]);
    expect(readFileSync(auditFile, "utf8")).not.toContain(code);
    expect(verifyAuditChain(auditFile)).toEqual({ ok: true, count: 6 });
  });

  it("detects a tampered audit line", () => {
    hook(writeManifest());
    hook(writeManifest());
    const lines = readFileSync(auditFile, "utf8").split("\n");
    lines[0] = lines[0]!.replace("denied", "allowed");
    writeFileSync(auditFile, lines.join("\n"));
    expect(verifyAuditChain(auditFile)).toEqual({ ok: false, line: 1 });
  });

  it("refuses invariants, wrong codes and other sessions", () => {
    hook(fixture("pre-tool-use-write-verid-state"));
    expect(hook(prompt("/verid tip x"), ATTENDED).stderr).toContain(
      "[VERID_BURNT_OVERRIDE_FORBIDDEN]",
    );

    hook(writeManifest());
    const code = confirmCode(hook(prompt("/verid tip x"), ATTENDED));
    expect(hook(prompt("/verid confirm ZZZZZZ"), ATTENDED).stderr).toContain(
      "[VERID_BURNT_OVERRIDE_BAD_CODE]",
    );
    expect(hook(prompt(`/verid confirm ${code}`), ATTENDED).code).toBe(0);
    const otherSession = fixture("pre-tool-use-write-verid-manifest", (p) => {
      p.session_id = "other";
      p.tool_input.content = "schemaVersion: 1";
    });
    expect(hook(otherSession).code).toBe(2);
  });

  it("shows usage for a bare /verid", () => {
    expect(hook(prompt("/verid"), ATTENDED).stderr).toContain("[VERID_BURNT_OVERRIDE_USAGE]");
  });
});

describe("6. state survives restarts and concurrent hooks", () => {
  it("keeps counting across separate processes", () => {
    for (let i = 0; i < 3; i++) hook(fixture("pre-tool-use-write-verid-state"));
    expect(state().counters.blocked_actions).toBe(3);
  });

  it("loses no write when 20 hooks deny at the same time", async () => {
    const runs = await Promise.all(
      Array.from({ length: 20 }, () => hookAsync(fixture("pre-tool-use-write-verid-state"))),
    );
    expect(runs.map((r) => r.code)).toEqual(Array(20).fill(2));
    expect(runs.every((r) => r.stderr.includes("[VERID_BURNT_STATE_PROTECTED]"))).toBe(true);
    expect(state().counters.blocked_actions).toBe(20);
    expect(verifyAuditChain(auditFile)).toEqual({ ok: true, count: 20 });
  });
});

describe("7. a repeated denial is short", () => {
  const writeState = (session?: string) =>
    fixture("pre-tool-use-write-verid-state", (p) => {
      if (session) p.session_id = session;
    });
  const readState = (name: string) => readFile(join(project, ".verid/.state", name));
  const full = "CLI-owned review packets may be read";

  it("shortens a second denial of the same rule and target in one session to its code and first sentence", () => {
    const first = hook(writeState());
    const again = hook(writeState());
    expect(first.stderr).toContain(full);
    expect([again.code, again.stderr.startsWith("verid [VERID_BURNT_STATE_PROTECTED]\n")]).toEqual([
      2,
      true,
    ]);
    expect(again.stderr).not.toContain(full);
    expect(again.stderr).toMatch(
      /^en: Same as before: Protected verid data \(.+\): private state cannot be read or written\.$/m,
    );
    expect(again.stderr.length).toBeLessThan(first.stderr.length);
    expect(state().counters.blocked_actions).toBe(2);
  });

  it("prints the full reason for another target, another rule or another session", () => {
    hook(readState("a.json"));
    const target = hook(readState("b.json"));
    hook(writeManifest());
    const rule = hook(writeState());
    const session = hook(writeState("another-session"));
    expect(
      [target, rule, session].map((r) => [r.code, r.stderr.includes("Same as before")]),
    ).toEqual([
      [2, false],
      [2, false],
      [2, false],
    ]);
  });

  it("prints the full reason again after the session's context is compacted", () => {
    hook(writeState());
    const compacted = fixture("session-start", (p) => (p.source = "compact"));
    expect(hook(compacted).code).toBe(0);
    expect(state().last_denied).toBeNull();
    expect(hook(writeState()).stderr).toContain(full);
  });

  it("keeps another session's last denial when one session is compacted", () => {
    hook(writeState("another-session"));
    hook(fixture("session-start", (p) => (p.source = "compact")));
    expect(state().last_denied).toMatchObject({ session: "another-session" });
  });
});
