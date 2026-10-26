import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../../src/adapters/audit-log.js";

// Runs the built hook as a real process, the way Claude Code does, fed with recorded payloads.
const root = join(import.meta.dirname, "..", "..");
const HOOK = join(root, "dist", "hook.js");
const FIXTURES = join(root, "test", "fixtures", "claude-code");
const SESSION = "11111111-2222-3333-4444-555555555555";

let project: string;
let stateFile: string;
let auditFile: string;
let lockFile: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-e2e-"));
  stateFile = join(project, ".verid", ".state", "state.json");
  auditFile = join(project, ".verid", ".state", "audit.jsonl");
  lockFile = join(project, ".verid", ".state", "state.lock");
  freshState();
});

// A new .verid with bootstrap state, so each case of a table starts from the same place.
function freshState(): void {
  rmSync(join(project, ".verid"), { recursive: true, force: true });
  mkdirSync(join(project, ".verid", ".state"), { recursive: true });
  writeFileSync(stateFile, '{"schemaVersion":1}');
}
afterEach(() => rmSync(project, { recursive: true, force: true }));

type Payload = Record<string, any>;
const esc = (s: string) => JSON.stringify(s).slice(1, -1);

function fixture(name: string, edit?: (p: Payload) => void): string {
  const text = readFileSync(join(FIXTURES, `${name}.json`), "utf8")
    .replaceAll("{{CWD}}", esc(project))
    .replaceAll("{{HOME}}", esc(homedir()))
    .replaceAll("{{SESSION_ID}}", SESSION)
    .replaceAll(/\{\{[A-Z_]+\}\}/g, "placeholder");
  const payload = JSON.parse(text) as Payload;
  edit?.(payload);
  return JSON.stringify(payload);
}

// Claude Code sets CLAUDE_* for its hooks; start clean so the test machine's own session leaks nothing.
function env(extra: Record<string, string>): NodeJS.ProcessEnv {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE")),
  );
  return { ...base, CLAUDE_PROJECT_DIR: project, ...extra };
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function hook(input: string, extra: Record<string, string> = {}): Run {
  const r = spawnSync(process.execPath, [HOOK], { input, env: env(extra), encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function hookAsync(input: string): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [HOOK], { env: env({}) });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => done({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

const state = () => JSON.parse(readFileSync(stateFile, "utf8"));
const audit = (): Payload[] =>
  readFileSync(auditFile, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

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

  it("denies reading state (through mixed slashes, case and ..), secrets and transcripts", () => {
    const rows: [string, string][] = [
      [`${project}/SRC/../.VERID/.State/state.json`, "VERID_BURNT_STATE_PROTECTED"],
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
  it("denies the recorded Agent payload when its general-purpose type is unmapped", () => {
    const result = hook(fixture("pre-tool-use-agent"));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("VERID_BURNT_AGENT_NOT_ALLOWED");
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
