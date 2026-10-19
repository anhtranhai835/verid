import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../../src/adapters/audit-log.js";

// Runs the built CLI and hook as real processes. The manifest's test command is a fake runner
// that copies recorded vitest JUnit reports, so scenario.json picks each run's outcome.
// Paths are built with join(), so these tests run on Windows and POSIX alike.
const root = join(import.meta.dirname, "..", "..");
const CLI = join(root, "dist", "cli.js");
const HOOK = join(root, "dist", "hook.js");
const RUNNER = join(import.meta.dirname, "fake-runner.mjs");
const FIXTURES = join(root, "test", "fixtures", "claude-code");
const SESSION = "11111111-2222-3333-4444-555555555555";

let project: string;
let stateFile: string;
let auditFile: string;
let manifestFile: string;

const manifest = (sourceGlob = "src/**", testCmd = `"${process.execPath}" "${RUNNER}" {junit}`) =>
  [
    "schemaVersion: 1",
    "repos:",
    "  - path: .",
    `    test_cmd: ${JSON.stringify(testCmd)}`,
    `    source_globs: ["${sourceGlob}"]`,
    '    test_globs: ["test/**"]',
    "",
  ].join("\n");

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-tdd-"));
  mkdirSync(join(project, ".verid", ".state"), { recursive: true });
  stateFile = join(project, ".verid", ".state", "state.json");
  auditFile = join(project, ".verid", ".state", "audit.jsonl");
  manifestFile = join(project, ".verid", "manifest.yaml");
  writeFileSync(stateFile, '{"schemaVersion":1}');
  writeFileSync(manifestFile, manifest());
});
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

// Claude Code sets CLAUDE_* for hooks and Bash; start clean so the test machine's session leaks nothing.
function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
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

function cli(...args: string[]): Run {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: project,
    env: env(),
    encoding: "utf8",
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const scenario = (exit: number, junit: string | null, output = "fake runner output") =>
  writeFileSync(join(project, "scenario.json"), JSON.stringify({ exit, junit, output }));
const RED_RUN = "vitest-red.xml";
const GREEN_RUN = "vitest-green.xml";

const state = () => JSON.parse(readFileSync(stateFile, "utf8"));
const setTdd = (s: string) =>
  writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, tdd: { state: s, last_run: null } }));
const audit = (): Payload[] =>
  readFileSync(auditFile, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
const runDir = (id: string) => join(project, ".verid", ".state", "runs", id);

const write = (rel: string) =>
  fixture("pre-tool-use-write", (p) => (p.tool_input.file_path = join(project, ...rel.split("/"))));
const read = (rel: string) =>
  fixture("pre-tool-use-read", (p) => (p.tool_input.file_path = join(project, ...rel.split("/"))));
const prompt = (text: string) =>
  fixture("user-prompt-submit-verid-allow", (p) => (p.prompt = text));

describe("verid test: evidence from a real run", () => {
  it("records a failing run as RED → GREEN and shows why each test failed", () => {
    scenario(1, RED_RUN);
    const r = cli("test");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("verid: RED → GREEN");
    expect(r.stdout).toContain("FAIL test/add.test.ts");
    expect(r.stdout).toContain("Error: Cannot find module '../src/add.js'");
    expect(r.stdout).toContain("FAIL test/greet.test.ts > greet & <name> > says hi");
    expect(r.stdout).toContain("AssertionError: expected 'Hello An' to be 'Hi An'");
    expect(r.stdout).toMatch(/^en: GREEN: /m);
    expect(r.stdout).toMatch(/^vi: GREEN: /m);
    // The full output stays in the run's log instead of flooding the agent's context.
    expect(r.stdout).not.toContain("fake runner output");

    const id = state().tdd.last_run;
    expect(state().tdd).toEqual({ state: "GREEN", last_run: id });
    expect(readdirSync(runDir(id)).sort()).toEqual(["junit.xml", "output.log", "run.json"]);
    expect(readFileSync(join(runDir(id), "output.log"), "utf8")).toContain("fake runner output");
    expect(JSON.parse(readFileSync(join(runDir(id), "run.json"), "utf8"))).toMatchObject({
      schemaVersion: 1,
      id,
      exit_code: 1,
      verdict: "fail",
      from: "RED",
      to: "GREEN",
      tests: { passed: 1, failed: 2, skipped: 1 },
      failing: ["test/add.test.ts", "test/greet.test.ts > greet & <name> > says hi"],
    });
    expect(audit()).toMatchObject([
      { event: "test_run", run: id, verdict: "fail", from: "RED", to: "GREEN" },
    ]);
    expect(verifyAuditChain(auditFile)).toEqual({ ok: true, count: 1 });
  });

  it("walks the cycle: fail → GREEN, pass → REFACTOR, pass stays, fail → GREEN", () => {
    const steps = [
      [1, RED_RUN, 1, "GREEN"],
      [0, GREEN_RUN, 0, "REFACTOR"],
      [0, GREEN_RUN, 0, "REFACTOR"],
      [1, RED_RUN, 1, "GREEN"],
    ] as const;
    let last: Run | undefined;
    for (const [exit, junit, code, to] of steps) {
      scenario(exit, junit);
      last = cli("test");
      expect(last.code).toBe(code);
      expect(state().tdd.state).toBe(to);
    }
    expect(last?.stdout).toContain("verid: REFACTOR → GREEN");
    expect(last?.stdout).toContain("en: The refactor broke 2 test(s).");
    expect(audit().map((e) => `${e.from}→${e.to}`)).toEqual([
      "RED→GREEN",
      "GREEN→REFACTOR",
      "REFACTOR→REFACTOR",
      "REFACTOR→GREEN",
    ]);
  });

  it("keeps RED when every test passes: a test that never failed proves nothing", () => {
    scenario(0, GREEN_RUN);
    const r = cli("test");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("verid: RED → RED");
    expect(r.stdout).toContain("en: Every test passed, so nothing proves the new test can fail");
    expect(state().tdd.state).toBe("RED");
  });

  it.each([
    ["exit 0 with failing tests", 0, RED_RUN, "VERID_E_RUN_EXIT_MISMATCH"],
    ["exit 1 with every test passing", 1, GREEN_RUN, "VERID_E_RUN_EXIT_MISMATCH"],
    ["no JUnit report", 1, null, "VERID_E_RUN_NO_JUNIT"],
  ] as const)("does not count a run with %s as evidence", (_name, exit, junit, code) => {
    scenario(exit, junit, "SyntaxError: Unexpected token in src/a.ts");
    const r = cli("test");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`verid [${code}]`);
    // The tail of the output is shown so the agent can see what went wrong.
    expect(r.stderr).toContain("SyntaxError: Unexpected token in src/a.ts");
    expect(readFileSync(stateFile, "utf8")).toBe('{"schemaVersion":1}'); // untouched
    expect(audit()).toMatchObject([{ event: "test_run", verdict: "invalid", code }]);
    const runs = readdirSync(join(project, ".verid", ".state", "runs"));
    expect(runs).toHaveLength(1);
    expect(
      JSON.parse(readFileSync(join(runDir(runs[0] as string), "run.json"), "utf8")),
    ).toMatchObject({ verdict: "invalid", code, from: "RED", to: "RED" });
  });

  it("needs the developer's manifest and state before running anything", () => {
    rmSync(manifestFile);
    expect(cli("test")).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("VERID_E_MANIFEST_MISSING"),
    });

    writeFileSync(manifestFile, manifest("src/**", "npm test"));
    const invalid = cli("test");
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain("VERID_E_MANIFEST_INVALID");
    expect(invalid.stderr).toContain("repos.0.test_cmd");

    writeFileSync(manifestFile, manifest());
    rmSync(stateFile);
    expect(cli("test")).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("VERID_E_STATE_MISSING"),
    });
    expect(existsSync(join(project, ".verid", ".state", "runs"))).toBe(false);
  });

  it("verid status shows the state and the next step", () => {
    const fresh = cli("status");
    expect(fresh.code).toBe(0);
    expect(fresh.stdout).toContain("verid: TDD RED");
    expect(fresh.stdout).toMatch(/^en: RED: production code is locked/m);

    scenario(1, RED_RUN);
    cli("test");
    const after = cli("status");
    expect(after.stdout).toContain(`verid: TDD GREEN · last run ${state().tdd.last_run}`);
  });

  it("prints usage for an unknown command", () => {
    const r = cli("frobnicate");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid test");
  });
});

describe("the hook enforces the cycle", () => {
  it("RED: denies production code, allows tests and other files", () => {
    const r = hook(write("src/a.ts"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_E_TDD_NO_FAILING_TEST]");
    expect(state().counters.blocked_actions).toBe(1);
    expect(audit().at(-1)).toMatchObject({ event: "denied", rule: "VERID_E_TDD_NO_FAILING_TEST" });

    expect(hook(write("test/a.test.ts")).code).toBe(0);
    expect(hook(write("docs/notes.md")).code).toBe(0);
    expect(hook(read("src/a.ts")).code).toBe(0);
    expect(state().tdd.state).toBe("RED");
  });

  it.each(["GREEN", "REFACTOR"])("%s: allows production code; changing a test reopens RED", (s) => {
    setTdd(s);
    expect(hook(write("src/a.ts")).code).toBe(0);
    expect(hook(write("test/a.test.ts")).code).toBe(0);
    expect(state().tdd.state).toBe("RED");
    expect(audit().at(-1)).toMatchObject({ event: "tdd_reopened", from: s, tool: "Write" });
    expect(hook(write("src/a.ts")).code).toBe(2);
  });

  it("runs the whole loop together with verid test", () => {
    expect(hook(write("src/add.ts")).code).toBe(2); // code first: no
    expect(hook(write("test/add.test.ts")).code).toBe(0);
    scenario(1, RED_RUN);
    expect(cli("test").code).toBe(1); // watched it fail
    expect(hook(write("src/add.ts")).code).toBe(0);
    scenario(0, GREEN_RUN);
    expect(cli("test").code).toBe(0); // watched it pass
    expect(state().tdd.state).toBe("REFACTOR");
    expect(hook(write("src/add.ts")).code).toBe(0);
    expect(hook(write("test/next.test.ts")).code).toBe(0); // the next test
    expect(hook(write("src/add.ts")).code).toBe(2);
    expect(verifyAuditChain(auditFile).ok).toBe(true);
  });

  it("is off without a manifest, as in Phase 0", () => {
    rmSync(manifestFile);
    expect(hook(write("src/a.ts")).code).toBe(0);
  });

  it("blocks writes, not reads, while the manifest is invalid", () => {
    writeFileSync(manifestFile, "schemaVersion: 1\nrepos: [");
    const r = hook(write("docs/notes.md"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("VERID_E_MANIFEST_INVALID");
    expect(hook(read("src/a.ts")).code).toBe(0);
  });

  it("follows manifest edits on the next write", () => {
    expect(hook(write("src/a.ts")).code).toBe(2);
    writeFileSync(manifestFile, manifest("lib/**"));
    expect(hook(write("src/a.ts")).code).toBe(0);
    expect(hook(write("lib/a.ts")).code).toBe(2);
  });

  it("lets the developer override the gate once, for that exact write", () => {
    expect(hook(write("src/a.ts")).code).toBe(2);
    const warned = hook(prompt("/verid allow hotfix"), { CLAUDE_CODE_SESSION_ATTENDED: "1" });
    const code = /\/verid confirm ([A-Z0-9]{6})/.exec(warned.stderr)?.[1];
    expect(code).toBeDefined();
    expect(hook(prompt(`/verid confirm ${code}`), { CLAUDE_CODE_SESSION_ATTENDED: "1" }).code).toBe(
      0,
    );
    expect(hook(write("src/a.ts")).code).toBe(0);
    expect(hook(write("src/a.ts")).code).toBe(2);
  });
});
