import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../../src/adapters/audit-log.js";
import { MODES } from "../../src/core/manifest.js";
import { runCli, runHook } from "./in-process.js";

// Runs the CLI and hook in process, and the built CLI for a few runs. The test command is a fake runner
// that copies recorded vitest JUnit reports, so scenario.json picks each run's outcome.
// Paths are built with join(), so these tests run on Windows and POSIX alike.
const root = join(import.meta.dirname, "..", "..");
const CLI = join(root, "dist", "cli.js");
// What verid's messages tell the agent to run: works without `npm link`.
const VERID_CMD = `node "${CLI.replaceAll("\\", "/")}"`;
const RUNNER = join(import.meta.dirname, "fake-runner.mjs");
const FIXTURES = join(root, "test", "fixtures", "claude-code");
const SESSION = "11111111-2222-3333-4444-555555555555";

let project: string;
let stateFile: string;
let auditFile: string;
let manifestFile: string;

// A remix project that has taken its baseline: the cycle starts from a clean slate.
const FRESH_STATE = '{"schemaVersion":1,"baseline":[]}';

const manifest = (
  sourceGlob = "src/**",
  testCmd = `"${process.execPath}" "${RUNNER}" {junit}`,
  repoPath = ".",
  mode = "remix",
) =>
  [
    "schemaVersion: 1",
    `mode: ${mode}`,
    "repos:",
    `  - path: ${repoPath}`,
    `    test_cmd: ${JSON.stringify(testCmd)}`,
    `    source_globs: ["${sourceGlob}"]`,
    '    test_globs: ["test/**"]',
    "",
  ].join("\n");

beforeEach(() => {
  // `$$` in the path: it must reach the test command unchanged ({junit} replacement).
  project = mkdtempSync(join(tmpdir(), "verid-tdd-$$-"));
  stateFile = join(project, ".verid", ".state", "state.json");
  auditFile = join(project, ".verid", ".state", "audit.jsonl");
  manifestFile = join(project, ".verid", "manifest.yaml");
  freshState();
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

// A new .verid with the fresh state and manifest, so each case of a table starts from the same place.
function freshState(): void {
  rmSync(join(project, ".verid"), { recursive: true, force: true });
  mkdirSync(join(project, ".verid", ".state"), { recursive: true });
  writeFileSync(stateFile, FRESH_STATE);
  writeFileSync(manifestFile, manifest());
}

type Payload = Record<string, any>;
const esc = (s: string) => JSON.stringify(s).slice(1, -1);

function fixture(name: string, edit?: (p: Payload) => void): string {
  const text = readFileSync(join(FIXTURES, `${name}.json`), "utf8")
    // A replacer function: a string replacement would turn the `$$` in the project path into `$`.
    .replaceAll("{{CWD}}", () => esc(project))
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

// In process; the spawned runs in this file and hook.e2e prove the built CLI and hook run this code.
const hook = (input: string, extra: Record<string, string> = {}): Promise<Run> =>
  runHook(input, { CLAUDE_PROJECT_DIR: project, ...extra });
const cliWith = (extra: Record<string, string>, ...args: string[]): Promise<Run> =>
  runCli(args, project, { CLAUDE_PROJECT_DIR: project, ...extra });
const cli = (...args: string[]): Promise<Run> => cliWith({}, ...args);
// In-process calls share process state, so a table's rows run one after another, never at once.
async function serially<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (const item of items) out.push(await fn(item));
  return out;
}
// As the agent's Bash tool runs it: Claude Code gives Bash no CLAUDE_PROJECT_DIR.
const cliFromBash = (cwd: string, ...args: string[]): Promise<Run> => runCli(args, cwd);

// A `verid taste` left running, like Claude Code's run_in_background.
function cliInBackground(): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, "taste"], { cwd: project, env: env() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

async function runStarted(): Promise<void> {
  const runs = join(project, ".verid", ".state", "runs");
  for (let i = 0; i < 200; i++) {
    if (existsSync(runs) && readdirSync(runs).length > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("verid taste never started");
}

const scenario = (exit: number, junit: string | null, output = "fake runner output", delay = 0) =>
  writeFileSync(join(project, "scenario.json"), JSON.stringify({ exit, junit, output, delay }));
// Recorded with vitest: RED_RUN fails add (module missing) and greet; PARTIAL_RUN fails greet only.
const RED_RUN = "vitest-red.xml";
const PARTIAL_RUN = "vitest-partial.xml";
const GREEN_RUN = "vitest-green.xml";
// add cannot load (module missing) while greet passes; then add fails on an assertion.
const LOAD_ERROR_RUN = "vitest-load-error.xml";
const ADD_ASSERT_RUN = "vitest-add-assert.xml";
// RED_RUN with add failing on an assertion instead of a missing module.
const RED_ASSERT_RUN = "vitest-red-assert.xml";
// A project with code and no test yet.
const NO_TESTS_RUN = "vitest-no-tests.xml";

const state = () => JSON.parse(readFileSync(stateFile, "utf8"));
const setTdd = (s: string) =>
  writeFileSync(
    stateFile,
    JSON.stringify({ schemaVersion: 1, tdd: { state: s, last_run: null }, baseline: [] }),
  );
const audit = (): Payload[] =>
  readFileSync(auditFile, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
const runDir = (id: string) => join(project, ".verid", ".state", "runs", id);
const designPath = () => join(project, ".verid", "design.md");

const write = (rel: string) =>
  fixture("pre-tool-use-write", (p) => (p.tool_input.file_path = join(project, ...rel.split("/"))));
const read = (rel: string) =>
  fixture("pre-tool-use-read", (p) => (p.tool_input.file_path = join(project, ...rel.split("/"))));
const prompt = (text: string) => fixture("user-prompt-submit-verid-tip", (p) => (p.prompt = text));
const bash = (command: string) =>
  fixture("pre-tool-use-bash", (p) => (p.tool_input.command = command));
const verdict = (r: Run) => (r.code === 0 ? "exit 0" : /verid \[(\w+)\]/.exec(r.stderr)?.[1]);

// The developer, at the terminal, allows the action that was just blocked.
async function allowOnce(reason = "hotfix"): Promise<void> {
  const attended = { CLAUDE_CODE_SESSION_ATTENDED: "1" };
  const warned = await hook(prompt(`/verid tip ${reason}`), attended);
  const code = /\/verid confirm ([A-Z0-9]{6})/.exec(warned.stderr)?.[1];
  expect(code).toBeDefined();
  expect((await hook(prompt(`/verid confirm ${code}`), attended)).code).toBe(0);
}

describe("verid taste: evidence from a real run", () => {
  // Tables of cases call the CLI in process; spawned rows prove the built file runs it.
  it("runs one CLI command in process as the built CLI does, without starting on import", async () => {
    // Importing the CLI must not start it: a started CLI reads argv and sets the exit code.
    expect(process.exitCode).toBeUndefined();
    const rows = [
      [["--help"], 0, `${VERID_CMD} cook`, ""],
      [["bogus"], 2, "", "bogus"],
      [["serve"], 2, "", "serve"],
    ] as const;
    for (const [args, code, stdout, stderr] of rows) {
      const r = await runCli([...args], project, { CLAUDE_PROJECT_DIR: project });
      expect.soft(r.code, args.join(" ")).toBe(code);
      if (stdout) expect.soft(r.stdout, args.join(" ")).toContain(stdout);
      if (stderr) expect.soft(r.stderr, args.join(" ")).toContain(stderr);
    }
  });

  it("records a failing run as RAW → COOKING and shows why each test failed", async () => {
    scenario(1, RED_RUN);
    const r = await cli("taste");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("verid: RAW → COOKING");
    expect(r.stdout).toContain("FAIL test/add.test.ts");
    expect(r.stdout).toContain("Error: Cannot find module '../src/add.js'");
    expect(r.stdout).toContain("FAIL test/greet.test.ts > greet & <name> > says hi");
    expect(r.stdout).toContain("AssertionError: expected 'Hello An' to be 'Hi An'");
    expect(r.stdout).toMatch(/^en: COOKING: /m);
    expect(r.stdout).toMatch(/^vi: COOKING: /m);
    // The full output stays in the run's log instead of flooding the agent's context.
    expect(r.stdout).not.toContain("fake runner output");

    const id = state().tdd.last_run;
    expect(state().tdd).toEqual({
      state: "COOKING",
      last_run: id,
      // What a later RAW run is compared with: test id + first line of the failure.
      failing: [
        "test/add.test.ts\nError: Cannot find module '../src/add.js' imported from /project/test/add.test.ts",
        "test/greet.test.ts > greet & <name> > says hi\nAssertionError: expected 'Hello An' to be 'Hi An' // Object.is equality",
      ],
      rev: 1,
      dirty: false, // this run shows every change so far
      passed_acs: [],
      passed_e2e_acs: [],
      stub: false, // greet failed on an assertion: real RED
      crashed: ["test/add.test.ts"], // add could not load
    });
    expect(readdirSync(runDir(id)).sort()).toEqual(["junit.xml", "output.log", "run.json"]);
    expect(readFileSync(join(runDir(id), "output.log"), "utf8")).toContain("fake runner output");
    expect(JSON.parse(readFileSync(join(runDir(id), "run.json"), "utf8"))).toMatchObject({
      schemaVersion: 1,
      id,
      exit_code: 1,
      verdict: "fail",
      from: "RAW",
      to: "COOKING",
      tests: { passed: 1, failed: 2, skipped: 1 },
      failing: ["test/add.test.ts", "test/greet.test.ts > greet & <name> > says hi"],
    });
    expect(audit()).toMatchObject([
      { event: "test_run", run: id, verdict: "fail", from: "RAW", to: "COOKING" },
    ]);
    expect(verifyAuditChain(auditFile)).toEqual({ ok: true, count: 1 });
  });

  it("walks the cycle: fail → COOKING, pass → PLATED, pass stays, fail → COOKING", async () => {
    const steps = [
      [1, RED_RUN, 1, "COOKING"],
      [0, GREEN_RUN, 0, "PLATED"],
      [0, GREEN_RUN, 0, "PLATED"],
      [1, RED_RUN, 1, "COOKING"],
    ] as const;
    let last: Run | undefined;
    for (const [exit, junit, code, to] of steps) {
      scenario(exit, junit);
      last = await cli("taste");
      expect(last.code).toBe(code);
      expect(state().tdd.state).toBe(to);
    }
    expect(last?.stdout).toContain("verid: PLATED → COOKING");
    expect(last?.stdout).toContain("en: The refactor broke 2 test(s).");
    expect(audit().map((e) => `${e.from}→${e.to}`)).toEqual([
      "RAW→COOKING",
      "COOKING→PLATED",
      "PLATED→PLATED",
      "PLATED→COOKING",
    ]);
  });

  it("opens the stub when a new test cannot load, and moves on only once it fails on an assertion", async () => {
    scenario(1, LOAD_ERROR_RUN);
    let r = await cli("taste");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("verid: RAW → RAW · stub");
    expect(r.stdout).toMatch(/^en: RAW · stub: /m);
    expect(state().tdd).toMatchObject({ state: "RAW", stub: true });
    expect((await hook(write("src/add.ts"))).code).toBe(0); // the stub
    expect((await hook(write("test/add.test.ts"))).code).toBe(0); // fixing the test keeps the stub open
    expect(state().tdd.stub).toBe(true);
    expect((await cli("taste")).stdout).toContain("verid: RAW · stub → RAW · stub");
    scenario(1, ADD_ASSERT_RUN);
    r = await cli("taste");
    expect(r.stdout).toContain("verid: RAW · stub → COOKING");
    expect(state().tdd).toMatchObject({ state: "COOKING", stub: false });
  });

  it("warns when a run leaves RAW with several new failing tests: one behaviour at a time", async () => {
    scenario(1, RED_RUN); // two new failures
    expect((await cli("taste")).stdout).toMatch(/^en: 2 new tests fail at once\./m);
    scenario(0, GREEN_RUN);
    await cli("taste");
    scenario(1, RED_RUN); // PLATED → COOKING: a broken refactor, not a new behaviour
    expect((await cli("taste")).stdout).not.toContain("new tests fail at once");
    freshState();
    scenario(1, ADD_ASSERT_RUN); // one new failure
    expect((await cli("taste")).stdout).not.toContain("new tests fail at once");
  });

  // pytest keys a failure by the test's first source line, which the stub does not change.
  it("moves a pytest test from the stub to COOKING once it reaches its assertion", async () => {
    scenario(1, "pytest-crash.xml");
    expect((await cli("taste")).stdout).toContain("verid: RAW → RAW · stub");
    expect((await hook(write("src/calc.py"))).code).toBe(0); // the stub
    scenario(1, "pytest-assert.xml");
    expect((await cli("taste")).stdout).toContain("verid: RAW · stub → COOKING");
  });

  it("sends a stub that makes the test pass back to RAW", async () => {
    scenario(1, LOAD_ERROR_RUN);
    await cli("taste");
    scenario(0, GREEN_RUN);
    const r = await cli("taste");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("verid: RAW · stub → RAW");
    expect(r.stdout).toMatch(/^en: The test passed once the stub was in/m);
    expect(state().tdd).toMatchObject({ state: "RAW", stub: false });
    expect((await hook(write("src/add.ts"))).stderr).toContain("VERID_BURNT_TDD_NO_FAILING_TEST");
  });

  it("keeps RAW when every test passes: a test that never failed proves nothing", async () => {
    scenario(0, GREEN_RUN);
    const r = await cli("taste");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("verid: RAW → RAW");
    expect(r.stdout).toContain("en: No test failed, so this run is not RAW (RED) evidence.");
    expect(state().tdd.state).toBe("RAW");
  });

  it("freezes failing tests, and keeps RAW when a changed test shows no new failure", async () => {
    scenario(1, RED_RUN);
    expect((await cli("taste")).code).toBe(1); // add and greet fail → COOKING
    const weaken = await hook(write("test/add.test.ts")); // the agent tries to weaken add's test
    expect(weaken.code).toBe(2);
    expect(weaken.stderr).toContain("verid [VERID_BURNT_TDD_TEST_FROZEN]");
    expect(state().tdd.state).toBe("COOKING");

    await allowOnce("the test of add is wrong"); // only the developer unfreezes it
    expect((await hook(write("test/add.test.ts"))).code).toBe(0);
    expect(state().tdd.state).toBe("RAW"); // a changed test must be watched failing again

    scenario(1, PARTIAL_RUN); // add now passes, greet fails exactly as before
    const r = await cli("taste");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("verid: RAW → RAW");
    expect(r.stdout).toContain("en: Tests failed, but only in ways the last run already showed");
    expect(state().tdd.state).toBe("RAW");
    expect((await hook(write("src/greet.ts"))).code).toBe(2);

    expect((await hook(write("test/add.test.ts"))).code).toBe(0); // make add fail again, on an assertion
    scenario(1, RED_ASSERT_RUN);
    expect((await cli("taste")).stdout).toContain("verid: RAW → COOKING");
  });

  it("does not count a run during which a test or production code changed", async () => {
    const rows: [string, string, string][] = [
      ["RAW", "test/add.test.ts", "RAW"],
      ["PLATED", "test/add.test.ts", "RAW"],
      // Production code changed under the run: it may not show the latest code either.
      ["COOKING", "src/add.ts", "COOKING"],
    ];
    for (const [s, file, after] of rows) {
      freshState();
      setTdd(s);
      scenario(1, RED_RUN, "slow suite", 1500);
      const run = cliInBackground();
      await runStarted();
      expect((await hook(write(file))).code, s).toBe(0);
      const r = await run;
      expect(r.code, s).toBe(2);
      expect(r.stderr, s).toContain("verid [VERID_BURNT_RUN_STALE]");
      expect(state().tdd.state, s).toBe(after);
      expect(state().tdd.last_run, s).toBeNull();
      expect(audit().at(-1), s).toMatchObject({
        event: "test_run",
        verdict: "invalid",
        code: "VERID_BURNT_RUN_STALE",
      });
    }
  });

  it("does not count a run whose exit code and report disagree, or that left no report", async () => {
    const rows = [
      ["exit 0 with failing tests", 0, RED_RUN, "VERID_BURNT_RUN_EXIT_MISMATCH"],
      ["exit 1 with every test passing", 1, GREEN_RUN, "VERID_BURNT_RUN_EXIT_MISMATCH"],
      ["no JUnit report", 1, null, "VERID_BURNT_RUN_NO_JUNIT"],
    ] as const;
    for (const [name, exit, junit, code] of rows) {
      freshState();
      scenario(exit, junit, "SyntaxError: Unexpected token in src/a.ts");
      const r = await cli("taste");
      expect(r.code, name).toBe(2);
      expect(r.stderr, name).toContain(`verid [${code}]`);
      // The tail of the output is shown so the agent can see what went wrong.
      expect(r.stderr, name).toContain("SyntaxError: Unexpected token in src/a.ts");
      expect(readFileSync(stateFile, "utf8"), name).toBe(FRESH_STATE); // untouched
      expect(audit(), name).toMatchObject([{ event: "test_run", verdict: "invalid", code }]);
      const runs = readdirSync(join(project, ".verid", ".state", "runs"));
      expect(runs, name).toHaveLength(1);
      expect(
        JSON.parse(readFileSync(join(runDir(runs[0] as string), "run.json"), "utf8")),
        name,
      ).toMatchObject({ verdict: "invalid", code, from: "RAW", to: "RAW" });
    }
  });

  it("stops a run that outlives timeout_sec, with the runner's own processes, and does not count it", async () => {
    const timeoutSec = 1;
    writeFileSync(manifestFile, `${manifest()}    timeout_sec: ${timeoutSec}\n`);
    const marker = join(project, "finished");
    // The report is already written when it hangs: a timeout still is not evidence.
    writeFileSync(
      join(project, "scenario.json"),
      JSON.stringify({ exit: 0, junit: GREEN_RUN, output: "hanging suite", delay: 6000, marker }),
    );
    const started = Date.now();
    // A real process: on a timeout verid kills the runner's whole process tree, which only a real CLI shows.
    const spawned = spawnSync(process.execPath, [CLI, "taste"], {
      cwd: project,
      env: env(),
      encoding: "utf8",
    });
    const r = { code: spawned.status, stderr: spawned.stderr };
    // Total time includes CLI startup and process-tree cleanup; allow scheduling under suite load.
    expect(Date.now() - started).toBeLessThan(timeoutSec * 1000 + 10_000);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_RUN_TIMEOUT]");
    expect(r.stderr).toContain("hanging suite");
    expect(readFileSync(stateFile, "utf8")).toBe(FRESH_STATE); // untouched
    expect(audit()).toMatchObject([
      { event: "test_run", verdict: "invalid", code: "VERID_BURNT_RUN_TIMEOUT" },
    ]);
    // Observe from CLI exit so delayed startup cannot shorten the surviving runner's 6 s timer; the margin covers a slow process-tree kill under load.
    await new Promise((done) => setTimeout(done, 7000));
    expect(existsSync(marker)).toBe(false);
  }, 30_000); // a 1 s timeout, a 6 s runner and a 7 s watch: room for a busy machine

  it("needs the developer's manifest and state before running anything", async () => {
    rmSync(manifestFile);
    expect(await cli("taste")).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("VERID_BURNT_MANIFEST_MISSING"),
    });
    // cook without --mode fails, so these messages must not send the developer to it.
    expect((await cli("taste")).stderr).toContain(`${VERID_CMD} cook --mode <prep|recipe|remix>`);
    expect((await cli("bogus")).stderr).toContain("cook --mode");

    writeFileSync(manifestFile, manifest("src/**", "npm test"));
    const invalid = await cli("taste");
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain("VERID_BURNT_MANIFEST_INVALID");
    expect(invalid.stderr).toContain("repos.0.test_cmd");

    writeFileSync(manifestFile, manifest());
    rmSync(stateFile);
    expect(await cli("taste")).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("VERID_BURNT_STATE_MISSING"),
    });
    expect(existsSync(join(project, ".verid", ".state", "runs"))).toBe(false);
  });

  it("verid peek says when the gate is off or the manifest is broken", async () => {
    rmSync(manifestFile);
    const off = await cli("peek");
    expect(off.code).toBe(0);
    expect(off.stdout).toContain("verid: TDD off · no .verid/manifest.yaml");
    expect(off.stdout).toMatch(/^en: The TDD gate is off/m);

    writeFileSync(manifestFile, "schemaVersion: 1\nrepos: [");
    const broken = await cli("peek");
    expect(broken.code).toBe(2);
    expect(broken.stderr).toContain("VERID_BURNT_MANIFEST_INVALID");
  });

  it("finds the project from a subdirectory, as the agent's Bash runs it", async () => {
    mkdirSync(join(project, "test"));
    scenario(1, RED_RUN);
    expect((await cliFromBash(join(project, "test"), "taste")).code).toBe(1);
    expect((await cliFromBash(join(project, "test"), "peek")).stdout).toContain(
      "verid: TDD COOKING",
    );
  });

  it("passes the report path in VERID_JUNIT for runners configured by environment", async () => {
    // How jest-junit is set up on each platform: the shell copies VERID_JUNIT into its variable.
    const node = `"${process.execPath}" "${RUNNER}" env`;
    const cmd =
      process.platform === "win32"
        ? `set "VERID_OUT=%VERID_JUNIT%" && ${node}`
        : `VERID_OUT="$VERID_JUNIT" ${node}`;
    writeFileSync(manifestFile, manifest("src/**", cmd));
    scenario(1, RED_RUN);
    const r = await cli("taste");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(1);
  });

  it("runs test_cmd in the repo when the project is on a UNC path (Windows)", async (ctx) => {
    if (process.platform !== "win32") return ctx.skip();
    const real = realpathSync.native(project); // C:\...
    const unc = `\\\\localhost\\${real[0]}$${real.slice(2)}`; // \\localhost\C$\...
    if (!existsSync(unc)) return ctx.skip(); // no administrative share on this machine
    scenario(1, RED_RUN);
    const r = spawnSync(process.execPath, [CLI, "taste"], {
      cwd: unc,
      env: env({ CLAUDE_PROJECT_DIR: unc }),
      encoding: "utf8",
    });
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("verid: RAW → COOKING");
  });

  // verid was never released under the old names, so none is kept as an alias.
  it("prints the command menu, and changes nothing, for an unknown command or an old name", async () => {
    const before = readFileSync(stateFile, "utf8");
    for (const cmd of ["frobnicate", "init", "test", "status", "refactor", "baseline", "approve"]) {
      const r = await cli(cmd);
      expect(r).toMatchObject({ code: 2, stdout: "" });
      expect(r.stderr.split("\n")[0], cmd).toContain(cmd);
      expect(r.stderr).toContain(`🔪 ${VERID_CMD} cook`);
      expect(r.stderr).toContain(`${VERID_CMD} order [module]`);
      expect(r.stderr).toContain("/verid:");
    }
    expect(readFileSync(stateFile, "utf8")).toBe(before);
  });

  it("names what it did not expect, an argument or a flag, above the menu", async () => {
    const before = readFileSync(stateFile, "utf8");
    const rows: [string[], string][] = [
      [["order", "auth", "--lang", "en"], "--lang en"],
      [["taste", "now"], "now"],
      [["cook", "--mod", "prep"], "--mod"],
      [["serve"], "<module>"],
    ];
    const said = async (args: string[], word: string) => {
      const r = await cli(...args);
      return [r.code, r.stderr.split("\n")[0]?.includes(word)];
    };
    expect(await serially(rows, ([args, word]) => said(args, word))).toEqual(
      rows.map(() => [2, true]),
    );
    expect(readFileSync(stateFile, "utf8")).toBe(before);
  });

  it("shows the command menu for verid alone, as help rather than a refusal", async () => {
    const r = await cli();
    expect(r).toMatchObject({ code: 0, stderr: "" });
    expect(r.stdout).toMatch(/^ 🍳 verid · .* · RAW → COOKING → PLATED$/m);
    expect(r.stdout).toContain(`👅 ${VERID_CMD} taste`);
  });
});

describe("what verid says about a run", () => {
  it("names the run's files relative to the project", async () => {
    scenario(1, null, "SyntaxError: Unexpected token in src/a.ts");
    const r = await cli("taste");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(join(".verid", ".state", "runs"));
    expect(r.stderr).not.toContain(project);
    scenario(1, RED_RUN);
    const counted = await cli("taste");
    expect(counted.stdout).toContain(join(".verid", ".state", "runs"));
    expect(counted.stdout).not.toContain(project);
  });

  it("has verid peek say why the last taste did not count, until a run counts", async () => {
    scenario(1, null, "no runner yet");
    await cli("taste");
    const refused = await cli("peek");
    expect(refused.stdout).toContain("[VERID_BURNT_RUN_NO_JUNIT]");
    expect(refused.stdout).toContain(readdirSync(join(project, ".verid", ".state", "runs"))[0]);
    scenario(1, RED_RUN);
    await cli("taste");
    expect((await cli("peek")).stdout).not.toContain("VERID_BURNT_RUN_NO_JUNIT");
  });
});

describe("verid taste finds the test runner when the manifest names none", () => {
  const AUTO_MANIFEST = [
    "schemaVersion: 1",
    "mode: remix",
    "repos:",
    "  - path: .",
    '    source_globs: ["src/**"]',
    '    test_globs: ["test/**"]',
    "",
  ].join("\n");
  // Only node and the system shell on PATH: a runner's own tool (gotestsum) is surely missing.
  const bare = () => {
    const kept = Object.entries(env()).filter(([k]) => k.toUpperCase() !== "PATH");
    const system =
      process.platform === "win32"
        ? join(process.env.SystemRoot ?? "C:\\Windows", "System32")
        : "/usr/bin:/bin";
    const sep = process.platform === "win32" ? ";" : ":";
    return { ...Object.fromEntries(kept), PATH: `${dirname(process.execPath)}${sep}${system}` };
  };
  const bareCli = (command: string) => {
    const r = spawnSync(process.execPath, [CLI, command], {
      cwd: project,
      env: bare(),
      encoding: "utf8",
    });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const taste = () => bareCli("taste");

  it("refuses to run before the project has a runner, naming the build files it cannot run", async () => {
    writeFileSync(manifestFile, AUTO_MANIFEST);
    writeFileSync(join(project, "Cargo.toml"), "[package]\n");
    const r = taste();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_RUN_NO_RUNNER]");
    expect(r.stderr).toContain("Cargo.toml");
    expect(readFileSync(stateFile, "utf8")).toBe(FRESH_STATE); // untouched
    // With no build file at all, there is nothing to name.
    rmSync(join(project, "Cargo.toml"));
    const empty = taste();
    expect(empty.stderr).toContain("verid [VERID_BURNT_RUN_NO_RUNNER]");
    expect(empty.stderr).not.toMatch(/test_cmd in \.verid|test_cmd trong \.verid|: -/);
  });

  it("tells the agent what to install when a runner leaves no report, and remembers the runner", async () => {
    writeFileSync(manifestFile, AUTO_MANIFEST);
    writeFileSync(join(project, "go.mod"), "module example.com/x\n");
    const r = taste();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_RUN_NO_JUNIT]");
    expect(r.stderr).toContain("go install gotest.tools/gotestsum@latest");
    expect(state()).toMatchObject({ runners: ["go@."], tdd: { state: "RAW", last_run: null } });
  });

  it("has verid stock, refused for a missing tool, say to run stock again", async () => {
    writeFileSync(manifestFile, AUTO_MANIFEST);
    writeFileSync(stateFile, '{"schemaVersion":1}');
    writeFileSync(join(project, "go.mod"), "module example.com/x\n");
    const r = bareCli("stock");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("go install gotest.tools/gotestsum@latest");
    expect(r.stderr).toContain(`${VERID_CMD} stock\``);
    expect(r.stderr).not.toContain(`${VERID_CMD} taste`);
  });

  // A new test that calls a missing class fails the build: no report, so no stub step from it.
  it("says a Maven or Gradle run with no report may not have compiled, and points to /verid tip", async () => {
    const rows: [string, string][] = [
      ["pom.xml", "maven"],
      ["build.gradle", "gradle"],
    ];
    for (const [buildFile, runner] of rows) {
      freshState();
      rmSync(join(project, "pom.xml"), { force: true });
      writeFileSync(manifestFile, AUTO_MANIFEST);
      writeFileSync(join(project, buildFile), "");
      const r = taste();
      expect(r.stderr, runner).toMatch(
        new RegExp(`^en: ${runner} \\(\\.\\) wrote no test report.*not compile.*/verid tip`, "m"),
      );
      expect(state().tdd, runner).toMatchObject({ state: "RAW", stub: false });
      expect(bareCli("peek").stdout, runner).toContain("/verid tip");
    }
  });

  it("keeps what to install in verid peek, after the run that did not count", async () => {
    writeFileSync(manifestFile, AUTO_MANIFEST);
    writeFileSync(join(project, "go.mod"), "module example.com/x\n");
    taste();
    expect(bareCli("peek").stdout).toContain("go install gotest.tools/gotestsum@latest");
  });

  it("refuses to run once a runner it has seen loses its build file", async () => {
    writeFileSync(manifestFile, AUTO_MANIFEST);
    writeFileSync(stateFile, '{"schemaVersion":1,"baseline":[],"runners":["go@.","pytest@."]}');
    writeFileSync(join(project, "pytest.ini"), "[pytest]\n");
    const r = taste();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_RUN_RUNNER_GONE]");
    // By name, and for either cause: the build file is gone, or it no longer names the runner.
    expect(r.stderr).toMatch(/^en: verid ran go before .*no longer names it/m);
    expect(r.stderr).not.toContain("@.");
    expect(r.stderr).not.toContain("pytest");
    expect(existsSync(join(project, ".verid", ".state", "runs"))).toBe(false); // nothing ran
  });
});

describe("the hook enforces the cycle", () => {
  it("RAW: denies production code, allows tests and other files", async () => {
    const r = await hook(write("src/a.ts"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_TDD_NO_FAILING_TEST]");
    expect(r.stderr).toContain(`run \`${VERID_CMD} taste\``); // the agent can run it as is
    expect(state().counters.blocked_actions).toBe(1);
    expect(audit().at(-1)).toMatchObject({
      event: "denied",
      rule: "VERID_BURNT_TDD_NO_FAILING_TEST",
    });

    expect((await hook(write("test/a.test.ts"))).code).toBe(0);
    expect((await hook(write("docs/notes.md"))).code).toBe(0);
    expect((await hook(read("src/a.ts"))).code).toBe(0);
    expect(state().tdd.state).toBe("RAW");
  });

  it("COOKING: allows production code, freezes the tests until they pass", async () => {
    setTdd("COOKING");
    expect((await hook(write("src/a.ts"))).code).toBe(0);
    expect((await hook(bash("sed -i 's/1/2/' test/a.test.ts"))).code).toBe(2);
    const r = await hook(write("test/a.test.ts"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_TDD_TEST_FROZEN]");
    expect(r.stderr).toContain("/verid tip"); // the way out goes through the developer
    expect(state().tdd.state).toBe("COOKING");
    expect(audit().at(-1)).toMatchObject({ event: "denied", rule: "VERID_BURNT_TDD_TEST_FROZEN" });

    await allowOnce("the test asserts the wrong value");
    expect((await hook(write("test/a.test.ts"))).code).toBe(0);
    expect(state().tdd.state).toBe("RAW");
    expect(audit().at(-1)).toMatchObject({ event: "tdd_reopened", from: "COOKING", tool: "Write" });
  });

  it("PLATED: allows production code; changing a test reopens RAW", async () => {
    setTdd("PLATED");
    expect((await hook(write("src/a.ts"))).code).toBe(0);
    expect((await hook(write("test/a.test.ts"))).code).toBe(0);
    expect(state().tdd.state).toBe("RAW");
    expect(audit().at(-1)).toMatchObject({
      event: "tdd_reopened",
      from: "PLATED",
      tool: "Write",
    });
    expect((await hook(write("src/a.ts"))).code).toBe(2);
  });

  it("runs the whole loop together with verid taste", async () => {
    expect((await hook(write("src/add.ts"))).code).toBe(2); // code first: no
    expect((await hook(write("test/add.test.ts"))).code).toBe(0);
    scenario(1, RED_RUN);
    expect((await cli("taste")).code).toBe(1); // watched it fail
    expect((await hook(write("src/add.ts"))).code).toBe(0);
    scenario(0, GREEN_RUN);
    expect((await cli("taste")).code).toBe(0); // watched it pass
    expect(state().tdd.state).toBe("PLATED");
    expect((await hook(write("src/add.ts"))).code).toBe(0);
    expect((await hook(write("test/next.test.ts"))).code).toBe(0); // the next test
    expect((await hook(write("src/add.ts"))).code).toBe(2);
    expect(verifyAuditChain(auditFile).ok).toBe(true);
  });

  it("keeps the developer's verid commands out of the agent's Bash, but not verid taste", async () => {
    for (const sub of ["cook", "garnish", "stock", "order"])
      expect((await hook(bash(`${VERID_CMD} ${sub}`))).code).toBe(2);
    // What verid's own messages tell the agent to run.
    expect((await hook(bash(`${VERID_CMD} taste`))).code).toBe(0);
    expect((await hook(bash(`${VERID_CMD} peek`))).code).toBe(0);

    const r = await hook(bash("CLAUDECODE=0 verid order"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("VERID_BURNT_BASH_DEVELOPER_ONLY");
    expect(r.stderr).toContain("/verid tip"); // the developer can still let it through
    expect(audit().at(-1)).toMatchObject({
      event: "denied",
      rule: "VERID_BURNT_BASH_DEVELOPER_ONLY",
    });

    await allowOnce("the developer asked for it");
    expect((await hook(bash("CLAUDECODE=0 verid order"))).code).toBe(0);
  });

  it("also checks the path as written, so a junction cannot hide source or tests", async () => {
    // Junctions need no admin rights on Windows; elsewhere this makes a symlink.
    const outside = mkdtempSync(join(tmpdir(), "verid-outside-"));
    try {
      mkdirSync(join(outside, "src"));
      mkdirSync(join(outside, "test"));
      symlinkSync(join(outside, "src"), join(project, "src"), "junction");
      symlinkSync(join(outside, "test"), join(project, "test"), "junction");
      expect((await hook(write("src/a.ts"))).code).toBe(2);
      setTdd("PLATED");
      expect((await hook(write("test/a.test.ts"))).code).toBe(0);
      expect(state().tdd.state).toBe("RAW");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("sees plain Bash writes: production code stays locked in RAW, a test edit reopens RAW", async () => {
    const heredoc = "cat > src/add.ts <<'EOF'\nexport const add = (a, b) => a + b;\nEOF";
    const r = await hook(bash(heredoc));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_TDD_NO_FAILING_TEST]");
    expect((await hook(bash("sed -i 's/1/2/' src/add.ts"))).code).toBe(2);
    expect(
      (await hook(bash(`node -e "require('fs').writeFileSync('src/add.ts', 'x')"`))).code,
    ).toBe(2);
    expect((await hook(bash('f=src/add.ts; echo x > "$f"'))).code).toBe(2);
    expect((await hook(bash("cat src/add.ts"))).code).toBe(0);
    expect((await hook(bash("npm test 2>&1 | tee notes.log"))).code).toBe(0);

    setTdd("PLATED");
    expect((await hook(bash("sed -i 's/1/2/' src/add.ts"))).code).toBe(0);
    expect((await hook(bash("sed -i 's/1/2/' test/add.test.ts"))).code).toBe(0);
    expect(state().tdd.state).toBe("RAW");
    expect(audit().at(-1)).toMatchObject({
      event: "tdd_reopened",
      from: "PLATED",
      tool: "Bash",
      target: "test/add.test.ts",
    });
  });

  it("judges MCP file tools too: a write to production code in RAW is denied", async () => {
    const mcp = (tool: string, input: Payload) =>
      fixture("pre-tool-use-write", (p) => {
        p.tool_name = tool;
        p.tool_input = input;
      });
    const src = join(project, "src", "add.ts");
    const r = await hook(mcp("mcp__filesystem__write_file", { path: src, content: "x" }));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_TDD_NO_FAILING_TEST]");
    expect((await hook(mcp("mcp__filesystem__read_text_file", { path: src }))).code).toBe(0);

    setTdd("PLATED");
    const test = join(project, "test", "add.test.ts");
    expect((await hook(mcp("mcp__filesystem__edit_file", { path: test, edits: [] }))).code).toBe(0);
    expect(state().tdd.state).toBe("RAW");
  });

  it("blocks shells it cannot read, such as PowerShell, unless the developer allows that one call", async () => {
    const tool = (name: string, input: Payload) =>
      fixture("pre-tool-use-write", (p) => {
        p.tool_name = name;
        p.tool_input = input;
      });
    const powershell = tool("PowerShell", { command: "Set-Content src/a.ts x" });
    const r = await hook(powershell);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_SHELL_UNSUPPORTED]");
    const terminal = await hook(tool("mcp__terminal__run_in_terminal", { command: "verid order" }));
    expect(terminal.code).toBe(2);
    expect(terminal.stderr).toContain("verid [VERID_BURNT_SHELL_UNSUPPORTED]");

    // Tools with no command stay as they were, including MCP file tools.
    const src = join(project, "src", "add.ts");
    expect((await hook(tool("mcp__filesystem__read_text_file", { path: src }))).code).toBe(0);
    expect((await hook(tool("WebFetch", { url: "https://example.com", prompt: "x" }))).code).toBe(
      0,
    );
    // The paths a shell tool names are still judged: an invariant beats the overridable rule.
    const secret = tool("mcp__terminal__run_in_terminal", {
      command: "ls",
      path: join(project, ".env"),
    });
    expect((await hook(secret)).stderr).toContain("verid [VERID_BURNT_SECRET_PROTECTED]");

    expect((await hook(powershell)).code).toBe(2); // the latest denial is the one /verid tip lifts
    await allowOnce();
    expect((await hook(powershell)).code).toBe(0);
    expect((await hook(powershell)).code).toBe(2); // one call per tip
  });

  it("starts a new conversation in RAW: a finished cycle does not carry over to the next task", async () => {
    const start = async (source: string) =>
      await hook(fixture("session-start", (p) => (p.source = source)));
    for (const source of ["resume", "compact"]) {
      setTdd("PLATED");
      expect((await start(source)).code).toBe(0);
      expect(state().tdd.state).toBe("PLATED");
    }
    for (const source of ["startup", "clear"]) {
      setTdd("PLATED");
      expect((await start(source)).stdout).toContain("verid: TDD RAW");
      expect(state().tdd.state).toBe("RAW");
    }
    expect(audit().at(-1)).toMatchObject({
      event: "tdd_reopened",
      from: "PLATED",
      tool: "SessionStart",
    });
    // Failing tests are work in progress: COOKING carries over.
    setTdd("COOKING");
    await start("startup");
    expect(state().tdd.state).toBe("COOKING");
  });

  it("lets only the developer declare a refactoring session, and only on a passing run", async () => {
    const refactor = (extra: Record<string, string> = {}) => {
      const r = spawnSync(process.execPath, [CLI, "garnish"], {
        cwd: project,
        env: env(extra),
        encoding: "utf8",
      });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    expect(refactor().stderr).toContain("VERID_BURNT_REFACTOR_NOT_GREEN"); // no run yet
    scenario(1, LOAD_ERROR_RUN);
    await cli("taste");
    expect(refactor().stderr).toContain("VERID_BURNT_REFACTOR_NOT_GREEN"); // the stub step is open
    scenario(1, RED_RUN);
    await cli("taste");
    expect(refactor().stderr).toContain("VERID_BURNT_REFACTOR_NOT_GREEN"); // tests failing
    scenario(0, GREEN_RUN);
    await cli("taste");
    await hook(fixture("session-start")); // a new conversation: back to RAW
    expect(state().tdd.state).toBe("RAW");

    expect(refactor({ CLAUDECODE: "1" }).stderr).toContain("VERID_BURNT_REFACTOR_IN_AGENT");
    expect(state().tdd.state).toBe("RAW");
    const r = refactor();
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("verid: TDD PLATED");
    expect(state().tdd.state).toBe("PLATED");
    expect(audit().at(-1)).toMatchObject({ event: "tdd_refactor", from: "RAW" });
  });

  it("will not let the agent stop once while the last run failed: evidence before claims", async () => {
    setTdd("COOKING");
    const r = await hook(fixture("stop"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("superpowers:verification-before-completion");
    expect(r.stderr).toContain(`${VERID_CMD} taste`);
    // Claude Code sets stop_hook_active on the stop that follows: never loop.
    expect((await hook(fixture("stop", (p) => (p.stop_hook_active = true)))).code).toBe(0);

    for (const s of ["RAW", "PLATED"]) {
      setTdd(s);
      expect((await hook(fixture("stop"))).code).toBe(0);
    }
    setTdd("COOKING");
    rmSync(manifestFile);
    expect((await hook(fixture("stop"))).code).toBe(0);
  });

  it("will not let the agent stop once while a test cannot load, before the unseen-change hold", async () => {
    scenario(1, LOAD_ERROR_RUN);
    await cli("taste");
    expect((await hook(write("src/add.ts"))).code).toBe(0); // the stub, not run yet: dirty too
    const stop = await hook(fixture("stop"));
    expect(stop.code).toBe(2);
    expect(stop.stderr).toContain("verid: TDD RAW · stub");
    expect(stop.stderr).toMatch(/^en: The last `.*taste` failed because a test could not load/m);
    expect(audit().at(-1)).toMatchObject({ event: "stop_blocked" });
    expect((await hook(fixture("stop", (p) => (p.stop_hook_active = true)))).code).toBe(0);
  });

  it("shows the stub at session start and in verid peek, and keeps it in a new conversation", async () => {
    scenario(1, LOAD_ERROR_RUN);
    await cli("taste");
    const shown = [(await hook(fixture("session-start"))).stdout, (await cli("peek")).stdout];
    expect(shown.map((out) => out.includes("verid: TDD RAW · stub · mode remix"))).toEqual([
      true,
      true,
    ]);
    expect(shown.map((out) => /^en: RAW · stub: /m.test(out))).toEqual([true, true]);
    expect(state().tdd.stub).toBe(true); // as a new conversation keeps COOKING
  });

  it("will not let the agent stop once on changes that no run has seen", async () => {
    const stop = async () => await hook(fixture("stop"));
    setTdd("PLATED");
    expect((await hook(write("docs/notes.md"))).code).toBe(0); // neither source nor test
    expect((await stop()).code).toBe(0);
    expect((await hook(write("src/a.ts"))).code).toBe(0); // refactored, never run
    const r = await stop();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("superpowers:verification-before-completion");
    expect(r.stderr).toContain(`${VERID_CMD} taste`);
    expect(audit().at(-1)).toMatchObject({ event: "stop_blocked" });
    expect((await hook(fixture("stop", (p) => (p.stop_hook_active = true)))).code).toBe(0);

    scenario(0, GREEN_RUN);
    expect((await cli("taste")).code).toBe(0);
    expect((await stop()).code).toBe(0); // the run saw the change

    expect((await hook(write("test/next.test.ts"))).code).toBe(0); // a test written, never watched failing
    expect((await stop()).code).toBe(2);
  });

  it("is off without a manifest, as in Phase 0", async () => {
    rmSync(manifestFile);
    expect((await hook(write("src/a.ts"))).code).toBe(0);
  });

  it("tells the agent at session start where the cycle is and how to move it", async () => {
    setTdd("COOKING");
    const r = await hook(fixture("session-start"));
    expect(r.code).toBe(0);
    // SessionStart stdout goes into the agent's context.
    expect(r.stdout).toContain("verid: TDD COOKING · mode remix");
    expect(r.stdout).toContain("superpowers:test-driven-development");
    // The agent knows superpowers' names for the states, so it can link the two cycles.
    expect(r.stdout).toMatch(/^en: .*RAW = RED, COOKING = GREEN, PLATED = REFACTOR/m);
    expect(r.stdout).toMatch(/^vi: .*RAW = RED, COOKING = GREEN, PLATED = REFACTOR/m);
    // verid ships no skills: it points at superpowers' for each kind of work.
    for (const skill of [
      "systematic-debugging",
      "verification-before-completion",
      "requesting-code-review",
    ])
      expect(r.stdout).toContain(`superpowers:${skill}`);
    expect(r.stdout).toContain(`${VERID_CMD} taste`);
    expect(r.stdout).toContain(`${VERID_CMD} peek`);
    expect(r.stdout).toMatch(/^en: This project is guarded by verid.*one question at a time/m);
    // RED means a failure on an assertion: the agent hears it before its first test.
    setTdd("RAW");
    expect((await hook(fixture("session-start"))).stdout).toMatch(
      /^en: RAW: .*fails on an assertion/m,
    );

    rmSync(manifestFile);
    expect(await hook(fixture("session-start"))).toMatchObject({ code: 0, stdout: "" });
  });

  it("names the mode at session start and in verid peek, with only that mode's text", async () => {
    for (const mode of MODES) {
      freshState();
      writeFileSync(manifestFile, manifest().replace("mode: remix", `mode: ${mode}`));
      const start = await hook(fixture("session-start"));
      expect(start.code, mode).toBe(0);
      expect(start.stdout, mode).toContain(`mode ${mode}`);
      expect((await cli("peek")).stdout, mode).toContain(`mode ${mode}`);
      // The agent gets the text for its own mode, in both languages, and not another mode's.
      const body = start.stdout.replace(/^verid: .*$/m, "");
      for (const m of MODES)
        expect(new RegExp(`^(vi|en): .*\\b${m}\\b`, "m").test(body), `${mode}: ${m}`).toBe(
          m === mode,
        );
    }
  });

  it("sends a prep agent to brainstorm with the developer and write the plan first", async () => {
    writeFileSync(manifestFile, manifest(undefined, undefined, undefined, "prep"));
    const start = await hook(fixture("session-start"));
    expect(start.code).toBe(0);
    const prep = start.stdout.match(/^(vi|en): .*\bprep\b.*$/gm) ?? [];
    expect(prep).toHaveLength(2); // one line per language
    for (const text of prep) {
      expect(text).toContain("superpowers:brainstorming");
      expect(text).toContain(".verid/plan.md");
      expect(text).toContain("test list");
      expect(text).toContain("JUnit");
      expect(text).toContain(`${VERID_CMD} taste`);
      // The developer approves the plan before code, and a test carries the AC code in its name.
      expect(text).toContain("[NEEDS CLARIFICATION");
      expect(text).toContain(`${VERID_CMD} order`);
      expect(text).toContain("AC-1 adds two numbers");
      // The whole flow: research, modules, one approved module at a time, evaluation, serve.
      expect(text).toContain(".verid/research.md");
      expect(text).toContain("## Module:");
      expect(text).toContain(`${VERID_CMD} order <module>`);
      expect(text).toContain("superpowers:requesting-code-review");
      expect(text).toContain(`${VERID_CMD} serve <module>`);
      expect(text).toContain(`${VERID_CMD} menu`);
    }
    // Anything unclear becomes a question, asked one at a time with options.
    expect(start.stdout).toMatch(/^en: Mode prep: .*one question at a time, with 2–3 options/m);
    expect(start.stdout).toMatch(
      /^en: Mode prep: .*have the mapped reviewer check it against its ACs and the design/m,
    );
  });

  it("sends a recipe agent from the specification to a plan the developer approves", async () => {
    writeFileSync(manifestFile, manifest(undefined, undefined, undefined, "recipe"));
    const start = await hook(fixture("session-start"));
    expect(start.code).toBe(0);
    const recipe = start.stdout.match(/^(vi|en): .*\brecipe\b.*$/gm) ?? [];
    expect(recipe).toHaveLength(2); // one line per language
    for (const text of recipe) {
      expect(text).toContain(".verid/plan.md");
      expect(text).toContain("- AC-1:");
      expect(text).toContain("[NEEDS CLARIFICATION");
      expect(text).toContain(`${VERID_CMD} order`);
      expect(text).toContain("AC-1 adds two numbers");
      expect(text).toContain("## Module:");
      expect(text).toContain(`${VERID_CMD} serve <module>`);
      expect(text).toContain(".verid/research.md"); // first: what the project is, where the spec is
    }
    expect(start.stdout).toMatch(/^en: Mode recipe: .*one question at a time, with 2–3 options/m);
    expect(start.stdout).toMatch(
      /^en: Mode recipe: .*have the mapped reviewer check it against its ACs and the design/m,
    );
    // Before a module's ACs: a fresh reviewer on that module's part of the spec, not all of it.
    expect(start.stdout).toMatch(
      /^en: Mode recipe: .*only that module's part of the specification with the builder check of superpowers:brainstorming/m,
    );
  });

  it("blocks writes, not reads, while the manifest is invalid", async () => {
    writeFileSync(manifestFile, "schemaVersion: 1\nrepos: [");
    const r = await hook(write("docs/notes.md"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("VERID_BURNT_MANIFEST_INVALID");
    expect((await hook(read("src/a.ts"))).code).toBe(0);
    // A policy rule still speaks first; once allowed, the write waits for a manifest verid can
    // read, and the override stays for that retry.
    const fix = write(".verid/manifest.yaml");
    expect(verdict(await hook(fix))).toBe("VERID_BURNT_MANIFEST_PROTECTED");
    await allowOnce();
    expect(verdict(await hook(fix))).toBe("VERID_BURNT_MANIFEST_INVALID");
    expect(state().overrides).toMatchObject([{ used: false }]);
    expect(audit().map((e) => e.event)).not.toContain("override_used");
  });

  it("follows manifest edits on the next write", async () => {
    expect((await hook(write("src/a.ts"))).code).toBe(2);
    writeFileSync(manifestFile, manifest("lib/**"));
    expect((await hook(write("src/a.ts"))).code).toBe(0);
    expect((await hook(write("lib/a.ts"))).code).toBe(2);
  });

  it("lets the developer override the gate once, for that exact write", async () => {
    expect((await hook(write("src/a.ts"))).code).toBe(2);
    await allowOnce();
    expect((await hook(write("src/a.ts"))).code).toBe(0);
    expect(state().tdd.dirty).toBe(true); // a change like any other: a run must show it
    expect((await hook(write("src/a.ts"))).code).toBe(2);
  });

  it("lets an override past the policy rule it names only: the call still meets the next rule and the cycle", async () => {
    // RAW: production code waits for a failing test, whatever else the call does.
    const code = bash("cp .verid/manifest.yaml m.bak && echo y > src/a.ts");
    const rows: [string, string, string][] = [
      ["reads the manifest, writes code", code, "VERID_BURNT_TDD_NO_FAILING_TEST"],
      [
        "reads the manifest, starts claude",
        bash("cat .verid/manifest.yaml | claude -p fix"),
        "VERID_BURNT_BASH_NESTED_CLAUDE",
      ],
      ["writes the manifest", write(".verid/manifest.yaml"), "exit 0"],
    ];
    const got = await serially(rows, async ([name, input]) => {
      freshState();
      const first = verdict(await hook(input));
      await allowOnce();
      return [name, first, verdict(await hook(input)), state().tdd.dirty];
    });
    expect(got).toEqual(
      rows.map(([name, , then]) => [name, "VERID_BURNT_MANIFEST_PROTECTED", then, false]),
    );

    // Each rule needs a tip of its own; once both have one, the code is a change like any other.
    freshState();
    await hook(code);
    await allowOnce();
    await hook(code);
    await allowOnce();
    expect(verdict(await hook(code))).toBe("VERID_BURNT_MANIFEST_PROTECTED"); // its tip was spent
    await allowOnce();
    expect(verdict(await hook(code))).toBe("exit 0");
    expect(state().tdd.dirty).toBe(true);
  });
});

describe("remix baseline", () => {
  // What the cycle holds before any run: the state file has no tdd of its own.
  const INITIAL_TDD = {
    state: "RAW",
    last_run: null,
    failing: [],
    rev: 0,
    dirty: false,
    passed_acs: [],
    passed_e2e_acs: [],
    stub: false,
    crashed: [],
  };
  const hasRuns = () => existsSync(join(project, ".verid", ".state", "runs"));

  it("never opens the stub for a known failure that cannot load", async () => {
    scenario(1, LOAD_ERROR_RUN);
    writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1 })); // no baseline yet
    expect((await cli("stock")).code).toBe(0);
    expect((await cli("taste")).code).toBe(0); // only known failures: the run passes
    expect(state().tdd).toMatchObject({ state: "RAW", stub: false });
    expect((await hook(write("src/add.ts"))).stderr).toContain("VERID_BURNT_TDD_NO_FAILING_TEST");
  });

  it("refuses verid stock inside Claude Code", async () => {
    scenario(1, RED_RUN);
    const r = await cliWith({ CLAUDECODE: "1" }, "stock");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("VERID_BURNT_BASELINE_IN_AGENT");
    expect(readFileSync(stateFile, "utf8")).toBe(FRESH_STATE); // untouched
    expect(hasRuns()).toBe(false); // the tests were not even run
  });

  it("records the failing tests of a run as the baseline, leaving the cycle alone", async () => {
    scenario(1, RED_RUN);
    const r = await cli("stock");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("2");
    expect(r.stdout).toContain("test/add.test.ts");
    expect(r.stdout).toContain("test/greet.test.ts > greet & <name> > says hi");
    expect(r.stdout).toMatch(/^en: Baseline recorded: 2 /m);

    const { baseline, tdd } = state();
    expect(baseline).toHaveLength(2);
    expect(baseline[0].startsWith("test/add.test.ts\n")).toBe(true);
    expect(tdd).toEqual(INITIAL_TDD); // the baseline is not a TDD run

    const id = readdirSync(join(project, ".verid", ".state", "runs"))[0] as string;
    expect(audit().at(-1)).toMatchObject({
      event: "baseline_recorded",
      run: id,
      failing: 2,
      junit_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.parse(readFileSync(join(runDir(id), "run.json"), "utf8"))).toMatchObject({
      id,
      purpose: "baseline",
      exit_code: 1,
      verdict: "fail",
      failing: ["test/add.test.ts", "test/greet.test.ts > greet & <name> > says hi"],
    });
    expect(verifyAuditChain(auditFile)).toEqual({ ok: true, count: 1 });
  });

  it("records nothing from a run that is not evidence", async () => {
    scenario(0, RED_RUN); // exit 0 while the report has failing tests
    const r = await cli("stock");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("VERID_BURNT_RUN_EXIT_MISMATCH");
    expect(state().baseline).toEqual([]);
    expect(readFileSync(stateFile, "utf8")).toBe(FRESH_STATE);
    expect(existsSync(auditFile)).toBe(false);
  });

  // The developer takes the baseline from a run that fails like this report says.
  const recordBaseline = async (junit: string) => {
    scenario(1, junit);
    expect((await cli("stock")).code).toBe(0);
  };
  const NO_BASELINE = '{"schemaVersion":1}';

  it("will not run tests in remix before the developer records a baseline", async () => {
    writeFileSync(stateFile, NO_BASELINE);
    scenario(1, RED_RUN);
    const r = await cli("taste");
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("verid [VERID_BURNT_RUN_NO_BASELINE]");
    expect(r.stderr).toContain("baseline");
    expect(readFileSync(stateFile, "utf8")).toBe(NO_BASELINE); // untouched
    expect(hasRuns()).toBe(false); // the tests were not even run
    expect(existsSync(auditFile)).toBe(false);
  });

  // Code with no test yet: stock has nothing to record, and taste waits for a baseline.
  it("asks for a first passing test when verid stock finds no test at all", async () => {
    writeFileSync(stateFile, NO_BASELINE);
    scenario(0, NO_TESTS_RUN);
    const r = await cli("stock");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_RUN_NO_TESTS]");
    expect(r.stderr).toMatch(/^en: .*first test that passes.*stock` again/m);
    expect(readFileSync(stateFile, "utf8")).toBe(NO_BASELINE);
  });

  it("names verid stock in the menu and at session start until there is a baseline", async () => {
    writeFileSync(stateFile, NO_BASELINE);
    const said = (text: string) =>
      text
        .split("\n")
        .filter((l) => l.startsWith("en: No baseline yet:"))
        .map((l) => [l.includes(`${VERID_CMD} stock`), l.includes("a test that passes")]);
    expect({
      menu: await said((await cli("menu")).stdout),
      start: await said((await hook(fixture("session-start"))).stdout),
    }).toEqual({ menu: [[true, true]], start: [[true, true]] });
    writeFileSync(stateFile, FRESH_STATE);
    expect(await said((await cli("menu")).stdout)).toEqual([]);
  });

  it("keeps baseline failures out of the cycle", async () => {
    await recordBaseline(RED_RUN);
    scenario(1, RED_RUN); // the same two tests still fail
    const r = await cli("taste");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("verid: RAW → RAW");
    expect(r.stdout).toContain("2 failed");
    expect(r.stdout).toMatch(/^en: 2 test\(s\) were already failing before verid/m);
    expect(r.stdout).not.toContain("FAIL "); // nothing for the agent to fix
    expect(state().tdd).toMatchObject({ state: "RAW", failing: [] });
    expect(state().baseline).toHaveLength(2);
    expect(audit().at(-1)).toMatchObject({ event: "test_run", verdict: "pass", baseline_known: 2 });

    // Stop comes before any test write: a write marks the cycle dirty, and Stop then holds.
    expect((await hook(fixture("stop"))).code).toBe(0);
    expect((await hook(write("test/a.test.ts"))).code).toBe(0); // not frozen
    expect((await cli("garnish")).code).toBe(0);
    expect(state().tdd.state).toBe("PLATED");
  });

  it("lets a new failure through the cycle as usual", async () => {
    await recordBaseline(PARTIAL_RUN); // only greet fails
    expect((await hook(write("test/add.test.ts"))).code).toBe(0);
    scenario(1, RED_ASSERT_RUN); // add fails too
    const r = await cli("taste");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("RAW → COOKING");
    expect(r.stdout).toContain("FAIL test/add.test.ts");
    expect(r.stdout).not.toContain("FAIL test/greet.test.ts");
    expect(r.stdout).toMatch(/^en: 1 test\(s\) were already failing before verid/m);
    const { failing } = state().tdd;
    expect(failing).toHaveLength(1);
    expect(failing[0].startsWith("test/add.test.ts > adds two numbers\n")).toBe(true);
    expect((await hook(write("test/add.test.ts"))).stderr).toContain("VERID_BURNT_TDD_TEST_FROZEN");
  });

  it("drops a baseline test once it passes, and never adds one", async () => {
    await recordBaseline(RED_RUN); // add.test.ts cannot load, and greet fails
    const greet = state().baseline.find((k: string) => k.startsWith("test/greet.test.ts"));
    expect(state().baseline).toHaveLength(2);

    scenario(1, PARTIAL_RUN); // add.test.ts loads now and its test passes
    const left = await cli("taste");
    expect(left.code).toBe(0); // greet is still a known failure
    expect(state().baseline).toEqual([greet]);
    expect(left.stdout).toMatch(/^en: 1 baseline test\(s\) pass now/m);

    scenario(1, RED_RUN); // add.test.ts left the baseline, so failing to load again is new
    const reload = await cli("taste");
    expect(reload.stdout).toContain("RAW → RAW · stub");
    expect(state().baseline).toEqual([greet]);

    scenario(1, RED_ASSERT_RUN); // a failing run adds nothing to the baseline
    const again = await cli("taste");
    expect(again.code).toBe(1);
    expect(again.stdout).toContain("RAW · stub → COOKING");
    expect(again.stdout).toContain("FAIL test/add.test.ts");
    expect(state().baseline).toEqual([greet]);
  });
});

describe("prep and recipe plan", () => {
  const planPath = () => join(project, ".verid", "plan.md");
  const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
  const GOOD_PLAN = "- AC-1: adds\n- AC-2: greets";

  // How the project is built is agreed before any module is ordered, and a reviewer is mapped.
  const ROLES = 'roles:\n  reviewer: ["feature-dev:code-reviewer"]\n';
  beforeEach(() => {
    writeFileSync(manifestFile, manifest("src/**", undefined, ".", "recipe") + ROLES);
    writeFileSync(designPath(), "# Design\n");
  });
  // The mapped reviewer stops: verid records its final report as the open module's review.
  const reviewed = async () =>
    expect(
      (await hook(fixture("subagent-stop-reviewer", (p) => (p.last_assistant_message = "LGTM"))))
        .code,
    ).toBe(0);

  // A refusal changes nothing: not the state, not the audit log.
  const refusedWith = (r: Run, code: string) => {
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(`verid [${code}]`);
    expect(readFileSync(stateFile, "utf8")).toBe(FRESH_STATE);
    expect(state().modules ?? {}).toEqual({});
    expect(existsSync(auditFile)).toBe(false);
  };

  it("leaves approving to the developer, and checks the plan first", async () => {
    writeFileSync(planPath(), GOOD_PLAN);
    refusedWith(await cliWith({ CLAUDECODE: "1" }, "order"), "VERID_BURNT_APPROVE_IN_AGENT");

    rmSync(planPath());
    const missing = await cli("order");
    refusedWith(missing, "VERID_BURNT_PLAN_MISSING");
    expect(missing.stderr).toContain(planPath());

    writeFileSync(planPath(), "- AC-1: adds\n- AC-1: greets");
    const twice = await cli("order");
    refusedWith(twice, "VERID_BURNT_PLAN_INVALID");
    expect(twice.stderr).toContain("AC-1 appears twice");
    expect(twice.stderr).toContain(planPath());

    writeFileSync(planPath(), "- AC-1: adds [NEEDS CLARIFICATION: which type?]");
    refusedWith(await cli("order"), "VERID_BURNT_PLAN_INVALID");

    writeFileSync(planPath(), "no criteria here");
    refusedWith(await cli("order"), "VERID_BURNT_PLAN_INVALID");

    writeFileSync(planPath(), GOOD_PLAN);
    writeFileSync(manifestFile, manifest("src/**", undefined, ".", "remix"));
    const remix = await cli("order");
    refusedWith(remix, "VERID_BURNT_MODE_MISMATCH");
    expect(remix.stderr).toContain("in mode remix");

    rmSync(manifestFile);
    refusedWith(await cli("order"), "VERID_BURNT_MANIFEST_MISSING");
  });

  const MODULES_PLAN = "## Module: auth\n- AC-1: adds\n## Module: ui\n- AC-2: greets\n";

  it("counts one acceptance criterion, or several criteria", async () => {
    const plan = (auth: string) =>
      `## Module: auth\n- AC-1: ${auth}\n## Module: ui\n- AC-2: greets\n- AC-3: waves\n`;
    writeFileSync(planPath(), plan("adds"));
    const one = (await cli("order", "auth")).stdout.split("\n")[0];
    writeFileSync(planPath(), plan("adds up")); // auth's section changed: it is set aside
    const two = (await cli("order", "ui")).stdout.split("\n")[0];
    expect([one, two]).toEqual([
      "verid: module auth approved · 1 acceptance criterion",
      "verid: module ui approved · 2 acceptance criteria",
    ]);
  });

  // What the hook answers a production write in RAW: the plan gate first, then the cycle.
  const gate = async () =>
    /verid \[(VERID_BURNT_\w+)\]/.exec((await hook(write("src/a.ts"))).stderr)?.[1];

  it("approves one module of a plan with modules, and opens production code", async () => {
    writeFileSync(planPath(), MODULES_PLAN);
    const which = await cli("order");
    expect(which.code).toBe(2);
    expect(which.stderr).toContain("verid [VERID_BURNT_MODULE_REQUIRED]");
    expect(which.stderr).toContain("auth, ui");
    expect((await cli("order", "nope")).stderr).toContain("verid [VERID_BURNT_MODULE_UNKNOWN]");
    expect(await gate()).toBe("VERID_BURNT_PLAN_NOT_APPROVED");

    expect((await cli("order", "auth")).code).toBe(0);
    expect(state().modules.auth).toMatchObject({ acs: ["AC-1"], served_at: null });
    expect(audit().at(-1)).toMatchObject({ event: "plan_approved", module: "auth", acs: 1 });
    expect(await gate()).toBe("VERID_BURNT_TDD_NO_FAILING_TEST");
  });

  it("keeps one module open at a time", async () => {
    writeFileSync(planPath(), MODULES_PLAN);
    expect((await cli("order", "auth")).code).toBe(0);
    const second = await cli("order", "ui");
    expect(second.code).toBe(2);
    expect(second.stderr).toContain("verid [VERID_BURNT_MODULE_OPEN]");
    expect(second.stderr).toContain("auth");
    expect((await cli("order", "auth")).code).toBe(0); // the open module itself may be approved again

    // An edited module is set aside; once another is ordered, reverting the edit must not reopen it.
    writeFileSync(planPath(), MODULES_PLAN.replace("adds", "adds more"));
    expect((await cli("order", "ui")).code).toBe(0);
    writeFileSync(planPath(), MODULES_PLAN);
    const menu = (await cli("menu")).stdout;
    expect(menu).toContain("auth · planned");
    expect(menu).toContain("ui · cooking");
    expect(Object.keys(state().modules)).toEqual(["ui"]);
  });

  it("lets the agent draft another module while one is open, unless the plan breaks", async () => {
    writeFileSync(planPath(), MODULES_PLAN);
    expect((await cli("order", "auth")).code).toBe(0);
    appendFileSync(planPath(), "- AC-3: more\n");
    expect(await gate()).toBe("VERID_BURNT_TDD_NO_FAILING_TEST");
    appendFileSync(planPath(), "- AC-1: dup\n");
    expect(await gate()).toBe("VERID_BURNT_PLAN_NOT_APPROVED");
  });

  it("locks production code again when the open module's section changes", async () => {
    writeFileSync(planPath(), MODULES_PLAN);
    expect((await cli("order", "auth")).code).toBe(0);
    writeFileSync(planPath(), MODULES_PLAN.replace("adds", "adds two numbers"));
    expect(await gate()).toBe("VERID_BURNT_PLAN_NOT_APPROVED");
    expect((await cli("order", "auth")).code).toBe(0);
    expect(await gate()).toBe("VERID_BURNT_TDD_NO_FAILING_TEST");
  });

  it("refuses a module that still has a question or no AC", async () => {
    writeFileSync(
      planPath(),
      "## Module: auth\n- AC-1: adds [NEEDS CLARIFICATION: type?]\n## Module: ui\nnotes\n",
    );
    const question = await cli("order", "auth");
    expect(question.stderr).toContain("verid [VERID_BURNT_PLAN_INVALID]");
    expect(question.stderr).toContain("line 2 still has [NEEDS CLARIFICATION]");
    expect((await cli("order", "ui")).stderr).toContain("verid [VERID_BURNT_PLAN_INVALID]");
    expect(state().modules ?? {}).toEqual({});
  });

  // Its approval signed no design, so it is ordered again; the plan without headings still works.
  it("asks a 0.1.0-beta.1 project to order its plan again, as the module main", async () => {
    writeFileSync(planPath(), GOOD_PLAN);
    const plan = { sha256: sha256(readFileSync(planPath())), acs: ["AC-1", "AC-2"], at: "t" };
    writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, baseline: [], plan }));
    expect(await gate()).toBe("VERID_BURNT_PLAN_NOT_APPROVED");
    expect((await cli("menu")).stdout).toContain(
      "  main · planned · 0/2 ACs · design changed since order",
    );
    expect((await cli("order")).code).toBe(0);
    expect(await gate()).toBe("VERID_BURNT_TDD_NO_FAILING_TEST");
  });

  it("records the approved plan", async () => {
    writeFileSync(planPath(), GOOD_PLAN);
    const r = await cli("order");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("AC-1, AC-2");
    expect(r.stdout).toMatch(/^en: Module main approved: AC-1, AC-2\./m);

    const sha = sha256(readFileSync(planPath()));
    // A plan without module headings is the module main.
    expect(state().modules).toEqual({
      main: {
        sha256: sha,
        acs: ["AC-1", "AC-2"],
        at: expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/),
        served_at: null,
        design_sha256: sha256(readFileSync(designPath())),
      },
    });
    expect(audit().at(-1)).toMatchObject({
      event: "plan_approved",
      module: "main",
      sha256: sha,
      acs: 2,
    });
    expect(verifyAuditChain(auditFile)).toEqual({ ok: true, count: 1 });
    expect(state().tdd.state).toBe("RAW"); // approving is not a TDD run
  });

  it("approves the bytes of an edited plan, and forgets the earlier Stop", async () => {
    writeFileSync(
      stateFile,
      JSON.stringify({
        schemaVersion: 1,
        baseline: [],
        plan: { sha256: "old", acs: ["AC-9"], at: "2026-01-01T00:00:00.000Z" },
        ac_stop_session: SESSION,
      }),
    );
    // What an editor on Windows saves: a BOM and CRLF. The hash covers these exact bytes.
    writeFileSync(planPath(), "﻿# Plan\r\n- AC-3: reads\r\n- AC-4: writes\r\n");
    expect((await cli("order")).code).toBe(0);
    expect(state().modules.main).toMatchObject({
      sha256: sha256(readFileSync(planPath())),
      acs: ["AC-3", "AC-4"],
    });
    expect(state().ac_stop_session).toBeNull();
    expect(audit().at(-1)).toMatchObject({ event: "plan_approved", acs: 2 });
  });

  it("locks the plan until research.md and then design.md exist, and reminds at each prompt", async () => {
    const research = join(project, ".verid", "research.md");
    rmSync(designPath());
    for (const mode of ["prep", "recipe"]) {
      writeFileSync(manifestFile, manifest("src/**", undefined, ".", mode));
      const locked = await hook(write(".verid/plan.md"));
      expect(locked.code, mode).toBe(2);
      expect(locked.stderr, mode).toContain("verid [VERID_BURNT_PLAN_NO_RESEARCH]");
      const byBash = (await hook(bash("echo x > .verid/plan.md"))).stderr;
      expect(byBash, mode).toContain("verid [VERID_BURNT_PLAN_NO_RESEARCH]");
      const reminded = await hook(prompt("build me a todo app"));
      expect(reminded.code, mode).toBe(0);
      expect(reminded.stdout, mode).toContain(`verid: mode ${mode} · research missing`);
      expect(reminded.stdout, mode).toMatch(/^en: Next: ask the developer what this project/m);
      expect((await hook(write(".verid/research.md"))).code, mode).toBe(0);
    }
    writeFileSync(research, "# Research\n");
    const noDesign = await hook(write(".verid/plan.md"));
    expect(noDesign.code).toBe(2);
    expect(noDesign.stderr).toContain("verid [VERID_BURNT_PLAN_NO_DESIGN]");
    expect((await hook(write(".verid/design.md"))).code).toBe(0);
    writeFileSync(designPath(), "# Design\n");
    expect((await hook(write(".verid/plan.md"))).code).toBe(0);
    expect((await hook(prompt("go on"))).stdout).toBe("");
    // remix has no plan: nothing to lock and nothing to remind.
    rmSync(research);
    rmSync(designPath());
    writeFileSync(manifestFile, manifest("src/**", undefined, ".", "remix"));
    expect((await hook(write(".verid/plan.md"))).code).toBe(0);
    expect((await hook(prompt("go on"))).stdout).toBe("");
  });

  it("locks production code until the plan is approved, and again once it changes", async () => {
    writeFileSync(join(project, ".verid", "research.md"), "# Research\n");
    const locked = await hook(write("src/a.ts"));
    expect(locked.code).toBe(2);
    expect(locked.stderr).toContain("verid [VERID_BURNT_PLAN_NOT_APPROVED]");
    expect(locked.stderr).toContain(`${VERID_CMD} order`); // the agent can pass it on as is
    expect((await hook(write("test/a.test.ts"))).code).toBe(0); // tests and the plan itself stay writable
    expect((await hook(write(".verid/plan.md"))).code).toBe(0);

    writeFileSync(planPath(), GOOD_PLAN);
    expect((await cli("order")).code).toBe(0);
    expect((await hook(write("src/a.ts"))).stderr).toContain(
      "verid [VERID_BURNT_TDD_NO_FAILING_TEST]",
    );

    writeFileSync(planPath(), `${GOOD_PLAN}\n- AC-3: waves`);
    expect((await hook(write("src/a.ts"))).stderr).toContain(
      "verid [VERID_BURNT_PLAN_NOT_APPROVED]",
    );
    expect((await hook(write("test/a.test.ts"))).code).toBe(0);

    expect((await cli("order")).code).toBe(0);
    expect((await hook(write("src/a.ts"))).stderr).toContain(
      "verid [VERID_BURNT_TDD_NO_FAILING_TEST]",
    );

    rmSync(planPath()); // a deleted plan is not the approved one
    expect((await hook(write("src/a.ts"))).stderr).toContain(
      "verid [VERID_BURNT_PLAN_NOT_APPROVED]",
    );
  });

  it("checks the plan before the cycle, in COOKING and PLATED too", async () => {
    for (const s of ["COOKING", "PLATED"]) {
      setTdd(s);
      expect((await hook(write("src/a.ts"))).stderr).toContain(
        "verid [VERID_BURNT_PLAN_NOT_APPROVED]",
      );
    }
    setTdd("COOKING");
    writeFileSync(planPath(), GOOD_PLAN);
    expect((await cli("order")).code).toBe(0);
    expect((await hook(write("src/a.ts"))).code).toBe(0);
  });

  it("lets the developer override the plan gate once, as a change like any other", async () => {
    setTdd("COOKING"); // the plan is the only thing between this write and the disk
    expect((await hook(write("src/a.ts"))).stderr).toContain(
      "verid [VERID_BURNT_PLAN_NOT_APPROVED]",
    );
    await allowOnce();
    expect((await hook(write("src/a.ts"))).code).toBe(0);
    expect(state().tdd.dirty).toBe(true); // a run must show it
    expect(audit().at(-1)).toMatchObject({
      event: "override_used",
      rule: "VERID_BURNT_PLAN_NOT_APPROVED",
    });
    expect((await hook(write("src/a.ts"))).code).toBe(2);
  });

  it("lets an override past the one rule it was given for, not the next one", async () => {
    // RAW and no approved plan: this write would also be denied for want of a failing test.
    expect((await hook(write("src/a.ts"))).stderr).toContain(
      "verid [VERID_BURNT_PLAN_NOT_APPROVED]",
    );
    await allowOnce();
    const r = await hook(write("src/a.ts"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_TDD_NO_FAILING_TEST]");
    // The plan override is spent; the rule that still denies is what /verid tip would cover now.
    expect(audit().at(-2)).toMatchObject({
      event: "override_used",
      rule: "VERID_BURNT_PLAN_NOT_APPROVED",
    });
    expect(audit().at(-1)).toMatchObject({
      event: "denied",
      rule: "VERID_BURNT_TDD_NO_FAILING_TEST",
    });
    expect(state().last_denied.rule).toBe("VERID_BURNT_TDD_NO_FAILING_TEST");
    expect(state().overrides).toMatchObject([
      { rule: "VERID_BURNT_PLAN_NOT_APPROVED", used: true },
    ]);
    expect(state().tdd.dirty).toBe(false); // nothing was written
  });

  it("judges every file a command writes: allowing the plan gate does not unfreeze a test", async () => {
    setTdd("COOKING");
    const both = bash("echo x > src/a.ts && echo y > test/b.test.ts");
    expect((await hook(both)).stderr).toContain("verid [VERID_BURNT_PLAN_NOT_APPROVED]");
    await allowOnce();
    const r = await hook(both);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_TDD_TEST_FROZEN]");
    expect(r.stderr).toContain("test/b.test.ts");
    expect(state().last_denied.rule).toBe("VERID_BURNT_TDD_TEST_FROZEN");
    expect(state().tdd).toMatchObject({ state: "COOKING", dirty: false }); // neither file was written

    // Each tip is used up once: the command passes only when every rule that denies it has had
    // a tip left to spend, and the frozen test then reopens RAW like any other.
    await allowOnce();
    expect((await hook(both)).stderr).toContain("verid [VERID_BURNT_PLAN_NOT_APPROVED]"); // the first is spent
    await allowOnce();
    expect((await hook(both)).code).toBe(0);
    expect(state().tdd).toMatchObject({ state: "RAW", dirty: true });
    expect(state().overrides.map((o: Payload) => [o.rule, o.used])).toEqual([
      ["VERID_BURNT_PLAN_NOT_APPROVED", true],
      ["VERID_BURNT_TDD_TEST_FROZEN", true],
      ["VERID_BURNT_PLAN_NOT_APPROVED", true],
    ]);
    expect((await hook(both)).code).toBe(2);
  });

  // The approved plan has AC-1 and AC-2; vitest-ac.xml passes `add > AC-1 adds two numbers`.
  const approveAndRun = async (plan = GOOD_PLAN, run = "vitest-ac.xml") => {
    writeFileSync(planPath(), plan);
    expect((await cli("order")).code).toBe(0);
    scenario(0, run);
    expect((await cli("taste")).code).toBe(0);
  };
  const stopFrom = async (session: string, active = false) =>
    await hook(
      fixture("stop", (p) => {
        p.session_id = session;
        p.stop_hook_active = active;
      }),
    );
  const patchTdd = (change: Record<string, unknown>) =>
    writeFileSync(stateFile, JSON.stringify({ ...state(), tdd: { ...state().tdd, ...change } }));

  const notReady = (r: Run, because: string) => {
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_SERVE_NOT_READY]");
    expect(r.stderr).toContain(because);
  };

  it("serves a module only with evidence, from the developer's terminal", async () => {
    writeFileSync(researchPath(), "# Research\n");
    writeFileSync(planPath(), MODULES_PLAN);
    expect((await cli("order", "auth")).code).toBe(0);
    expect((await cliWith({ CLAUDECODE: "1" }, "serve", "auth")).stderr).toContain(
      "verid [VERID_BURNT_SERVE_IN_AGENT]",
    );
    expect((await cli("serve", "nope")).stderr).toContain("verid [VERID_BURNT_MODULE_UNKNOWN]");
    notReady(await cli("serve", "ui"), "not open");
    notReady(await cli("serve", "auth"), "AC-1");

    // AC-1 passes, but another test fails: the module's evidence is not a passing run.
    scenario(1, "vitest-ac-failing.xml");
    await cli("taste");
    notReady(await cli("serve", "auth"), "the last run failed");

    scenario(0, "vitest-ac.xml");
    expect((await cli("taste")).code).toBe(0);
    await reviewed();
    const served = await cli("serve", "auth");
    expect(served.code).toBe(0);
    expect(state().modules.auth.served_at).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    expect(audit().at(-1)).toMatchObject({ event: "module_served", module: "auth" });
    expect(served.stdout).toContain(`${VERID_CMD} order ui`); // the menu's next step
    notReady(await cli("serve", "auth"), "not open"); // served once
    expect(await gate()).toBe("VERID_BURNT_PLAN_NOT_APPROVED"); // no module is open any more
  });

  it("serves a module only with a review recorded after its last change", async () => {
    const plan = "## Module: calc\n- AC-1: adds\n## Module: other\n- AC-2: greets\n";
    const ready = async () => {
      writeFileSync(planPath(), plan);
      expect((await cli("order", "calc")).code).toBe(0);
      scenario(0, "vitest-ac.xml");
      expect((await cli("taste")).code).toBe(0);
    };
    const forOther = () => {
      const s = state();
      writeFileSync(stateFile, JSON.stringify({ ...s, review: { ...s.review, module: "other" } }));
    };
    const rows: [string, () => Promise<unknown>, string][] = [
      [
        "no reviewer mapped",
        async () => {
          writeFileSync(manifestFile, manifest("src/**", undefined, ".", "recipe"));
          await ready();
        },
        "no reviewer is mapped",
      ],
      ["no review yet", ready, "no review of calc since its last change"],
      ["no review yet: how to install the reviewer", ready, "claude plugin install verid@verid"],
      [
        "a review of another module",
        async () => {
          await ready();
          await reviewed();
          forOther();
        },
        "no review of calc",
      ],
      [
        "a change after the review",
        async () => {
          await ready();
          await reviewed();
          await hook(write("test/calc.test.ts"));
          await cli("taste");
        },
        "no review of calc",
      ],
    ];
    for (const [name, setup, because] of rows) {
      freshState();
      writeFileSync(manifestFile, manifest("src/**", undefined, ".", "recipe") + ROLES);
      writeFileSync(designPath(), "# Design\n");
      await setup();
      const r = await cli("serve", "calc");
      expect([name, r.code, r.stderr.includes(because)]).toEqual([name, 2, true]);
    }
    freshState();
    writeFileSync(manifestFile, manifest("src/**", undefined, ".", "recipe") + ROLES);
    writeFileSync(designPath(), "# Design\n");
    await ready();
    await reviewed();
    const served = await cli("serve", "calc");
    expect(served.code).toBe(0);
    expect(served.stdout).toContain("feature-dev:code-reviewer");
    expect(served.stdout).toContain(join(".verid", ".state", "reviews", "calc-"));
  });

  it("serves a module only with a passing security review after its last change, once one is mapped", async () => {
    const security = `${ROLES}  security: ["verid:security"]\n`;
    // The mapped security reviewer stops: verid records its final report beside the review.
    const secured = async (verdict: string) =>
      expect(
        (
          await hook(
            fixture("subagent-stop-reviewer", (p) => {
              p.agent_type = "verid:security";
              p.last_assistant_message = `Findings: none\nVerdict: ${verdict}`;
            }),
          )
        ).code,
      ).toBe(0);
    const reviewedAndTested = async () => {
      freshState();
      writeFileSync(manifestFile, manifest("src/**", undefined, ".", "recipe") + security);
      writeFileSync(designPath(), "# Design\n");
      writeFileSync(planPath(), "## Module: calc\n- AC-1: adds\n");
      expect((await cli("order", "calc")).code).toBe(0);
      scenario(0, "vitest-ac.xml");
      expect((await cli("taste")).code).toBe(0);
      await reviewed();
    };
    const rows: [string, () => Promise<unknown>, number, string][] = [
      ["no security review yet", async () => {}, 2, "no passing security review of calc"],
      ["a failed security review", () => secured("fail"), 2, "no passing security review of calc"],
      [
        "a change after the security review, reviewed again",
        async () => {
          await secured("pass");
          await hook(write("test/calc.test.ts"));
          await cli("taste");
          await reviewed();
        },
        2,
        "no passing security review of calc",
      ],
      // The security review read dependencies, config and .env too: any project write voids it.
      [
        "a dependency edit after the security review",
        async () => {
          await secured("pass");
          await hook(write("package.json"));
        },
        2,
        "no passing security review of calc",
      ],
      [
        "a dependency edit in a folder linked from outside the project",
        async () => {
          const outside = mkdtempSync(join(tmpdir(), "verid-linked-"));
          symlinkSync(outside, join(project, "lib"), "junction");
          await secured("pass");
          await hook(write("lib/package.json"));
        },
        2,
        "no passing security review of calc",
      ],
      [
        "a new order after the security review, reviewed again",
        async () => {
          await secured("pass");
          expect((await cli("order", "calc")).code).toBe(0);
          await reviewed();
        },
        2,
        "no passing security review of calc",
      ],
      [
        "a .verid note after the security review",
        async () => {
          await secured("pass");
          await hook(write(".verid/notes.md"));
        },
        0,
        "Security review by verid:security",
      ],
      ["a passing security review", () => secured("pass"), 0, "Security review by verid:security"],
    ];
    for (const [name, after, code, says] of rows) {
      await reviewedAndTested();
      await after();
      const r = await cli("serve", "calc");
      expect([name, r.code, (r.code === 0 ? r.stdout : r.stderr).includes(says)]).toEqual([
        name,
        code,
        true,
      ]);
    }
    expect(
      audit()
        .filter((e) => e.event === "security_recorded")
        .map((e) => e.verdict),
    ).toEqual(["pass"]);
  });

  it("tells the agent which mapped agent to dispatch at each step", async () => {
    const mapped = [
      "roles:",
      '  reviewer: ["verid:reviewer"]',
      '  tester: ["verid:tester"]',
      '  coder: ["verid:coder"]',
      '  researcher: ["custom:research"]',
      '  architect: ["custom:architect"]',
      '  planner: ["custom:planner"]',
      '  qa: ["custom:qa"]',
      "",
    ].join("\n");
    writeFileSync(manifestFile, manifest("src/**", undefined, ".", "recipe") + mapped);
    writeFileSync(join(project, ".verid", "research.md"), "# Research\n");
    const start = (await hook(fixture("session-start"))).stdout;
    writeFileSync(planPath(), "## Module: calc\n- AC-1: adds\n");
    expect((await cli("order", "calc")).code).toBe(0);
    scenario(0, "vitest-ac.xml");
    expect((await cli("taste")).code).toBe(0);
    const evaluate = (await cli("menu")).stdout;
    // No roles: no roles line, and the evaluation step asks the developer to map a reviewer.
    writeFileSync(manifestFile, manifest("src/**", undefined, ".", "recipe"));
    const bare = (await hook(fixture("session-start"))).stdout;
    const unmapped = (await cli("menu")).stdout;
    const says = [
      "verid: roles reviewer verid:reviewer · tester verid:tester · coder verid:coder",
      "researcher custom:research · architect custom:architect · planner custom:planner · qa custom:qa",
      "superpowers:subagent-driven-development",
      "Dispatch the mapped agents, not general-purpose",
    ];
    expect({
      start: says.filter((s) => !start.includes(s)),
      evaluate: /^en: Next: evaluate module calc.*verid:reviewer/m.test(evaluate),
      bare: bare.includes("verid: roles"),
      unmapped: /^en: Next: evaluate module calc.*`roles\.reviewer`/m.test(unmapped),
    }).toEqual({ start: [], evaluate: true, bare: false, unmapped: true });
  });

  it("orders the product module last, and says the product is done once it is served", async () => {
    const e2e = manifest("src/**", undefined, ".", "recipe").replace(
      '    test_globs: ["test/**"]\n',
      '    test_globs: ["test/**"]\n    e2e_globs: ["**/e2e/**"]\n',
    );
    writeFileSync(manifestFile, e2e + ROLES);
    writeFileSync(join(project, ".verid", "research.md"), "# Research\n");
    const product = "## Module: product\n- AC-9 (e2e): a user signs up and adds two numbers\n";
    writeFileSync(planPath(), `## Module: calc\n- AC-1: adds\n${product}`);
    const early = await cli("order", "product");
    expect(early.code).toBe(2);
    expect(early.stderr).toContain("verid [VERID_BURNT_PRODUCT_TOO_EARLY]");
    expect(early.stderr).toContain("calc");

    expect((await cli("order", "calc")).code).toBe(0);
    scenario(0, "vitest-ac.xml");
    expect((await cli("taste")).code).toBe(0);
    await reviewed();
    expect((await cli("serve", "calc")).code).toBe(0);

    expect((await cli("order", "product")).code).toBe(0);
    scenario(0, "playwright-product.xml");
    expect((await cli("taste")).code).toBe(0);
    await reviewed();
    expect((await cli("serve", "product")).code).toBe(0);
    const menu = (await cli("menu")).stdout;
    expect(menu).toContain("  product · done");
    expect(menu).toMatch(/^en: Next: the product module is served, so the product is done/m);
  });

  it("will not order the product module while a module has no AC yet", async () => {
    writeFileSync(
      planPath(),
      "## Module: draft\n## Module: product\n- AC-9 (e2e): a user signs up\n",
    );
    const r = await cli("order", "product");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_PRODUCT_TOO_EARLY]");
    expect(r.stderr).toContain("draft");
  });

  it("gives taste's log line and serve's reasons in the chosen language", async () => {
    writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, language: "vi" }));
    writeFileSync(planPath(), MODULES_PLAN);
    const refused = (await cli("serve", "auth")).stderr; // not ordered yet
    scenario(0, GREEN_RUN);
    const tasted = (await cli("taste")).stdout;
    expect({
      serve: [refused.includes("chưa mở"), refused.includes("it is not open")],
      taste: [tasted.includes("Log đầy đủ"), tasted.includes("Full log")],
    }).toEqual({ serve: [true, false], taste: [true, false] });
  });

  it("lists the open questions when serving leaves asking them as the next step", async () => {
    writeFileSync(planPath(), MODULES_PLAN);
    writeFileSync(join(project, ".verid", "research.md"), "[NEEDS CLARIFICATION: who pays?]\n");
    expect((await cli("order", "auth")).code).toBe(0);
    scenario(0, "vitest-ac.xml");
    await cli("taste");
    await reviewed();
    const served = (await cli("serve", "auth")).stdout;
    expect(served).toContain("  ? research.md:1 who pays?");
    expect(served).toMatch(/^en: Next: ask the developer the open questions above/m);
  });

  it("keeps a served module done when the next one is ordered", async () => {
    writeFileSync(planPath(), MODULES_PLAN);
    expect((await cli("order", "auth")).code).toBe(0);
    scenario(0, "vitest-ac.xml");
    await cli("taste");
    await reviewed();
    expect((await cli("serve", "auth")).code).toBe(0);
    expect((await cli("order", "ui")).code).toBe(0);
    const menu = (await cli("menu")).stdout;
    expect(menu).toContain("auth · done");
    expect(menu).toContain("ui · cooking");
    expect(state().modules.auth.served_at).not.toBeNull();
  });

  it("will not serve a module while a change has not been run", async () => {
    writeFileSync(planPath(), MODULES_PLAN);
    expect((await cli("order", "auth")).code).toBe(0);
    scenario(0, "vitest-ac.xml");
    expect((await cli("taste")).code).toBe(0);
    expect((await hook(write("test/b.test.ts"))).code).toBe(0); // a test write the last run has not seen
    notReady(await cli("serve", "auth"), "no run has seen");
  });

  it("holds the stop once to evaluate a module whose every AC passes", async () => {
    writeFileSync(planPath(), MODULES_PLAN);
    expect((await cli("order", "auth")).code).toBe(0);
    scenario(0, "vitest-ac.xml");
    expect((await cli("taste")).code).toBe(0);
    const held = await stopFrom("s-eval");
    expect(held.code).toBe(2);
    expect(held.stderr).toContain("superpowers:requesting-code-review");
    // QC by the mapped reviewer, against the module's ACs and the design.
    expect(held.stderr).toMatch(/^en: .*have the reviewer \(feature-dev:code-reviewer;/m);
    expect(held.stderr).toContain(`${VERID_CMD} serve auth`);
    expect((await stopFrom("s-eval")).code).toBe(0); // once per conversation
    expect((await stopFrom("s-other")).code).toBe(2); // a new conversation is held again
  });

  it("does not hold a second time once the uncovered hold was used in this conversation", async () => {
    writeFileSync(planPath(), MODULES_PLAN);
    expect((await cli("order", "auth")).code).toBe(0);
    scenario(0, GREEN_RUN); // no test names AC-1
    expect((await cli("taste")).code).toBe(0);
    const uncovered = await stopFrom("s-one");
    expect(uncovered.code).toBe(2);
    expect(uncovered.stderr).toContain("AC-1");
    scenario(0, "vitest-ac.xml");
    expect((await cli("taste")).code).toBe(0);
    expect((await stopFrom("s-one")).code).toBe(0);
  });

  const researchPath = () => join(project, ".verid", "research.md");
  const asMode = (mode: string) =>
    writeFileSync(manifestFile, manifest("src/**", undefined, ".", mode));

  it("shows research, modules with their phase and coverage, and the next step", async () => {
    asMode("prep");
    rmSync(designPath());
    const empty = await cli("menu");
    expect(empty.code).toBe(0);
    expect(empty.stdout).toContain(
      "verid: mode prep · research missing · design missing · 0 modules",
    );
    expect(empty.stdout).toMatch(/^en: Next: ask the developer what .*`\.verid\/research\.md`/m);

    writeFileSync(researchPath(), "# Research\n");
    const design = (await cli("menu")).stdout;
    expect(design).toContain("verid: mode prep · research written · design missing · 0 modules");
    expect(design).toMatch(
      /^en: Next: agree with the developer how the project is built.*`\.verid\/design\.md`/m,
    );

    writeFileSync(designPath(), "# Design\n");
    writeFileSync(planPath(), MODULES_PLAN);
    const planned = (await cli("menu")).stdout;
    expect(planned).toContain("verid: mode prep · research written · design written · 2 modules");
    expect(planned).toContain("  auth · planned · 0/1 ACs");
    expect(planned).toContain(`${VERID_CMD} order auth`);

    expect((await cli("order", "auth")).code).toBe(0);
    expect((await cli("menu")).stdout).toContain("  auth · cooking · 0/1 ACs");
  });

  it("shows /verid:peek and /verid:menu to the developer in Claude Code, sending no prompt", async () => {
    asMode("prep");
    const menu = await hook(prompt("/verid:menu"));
    expect(menu.code).toBe(2);
    expect(menu.stdout).toBe("");
    expect(menu.stderr).toContain(
      "verid: mode prep · research missing · design written · 0 modules",
    );
    expect(menu.stderr).toMatch(/^en: Next: /m);
    const peek = await hook(prompt("/verid peek"));
    expect(peek.code).toBe(2);
    expect(peek.stdout).toBe("");
    expect(peek.stderr).toContain("verid: TDD RAW · mode prep · last run none");
    expect(peek.stderr).toMatch(/^en: Next: ask the developer what /m);
  });

  // Until a module is open, the plan locks production code whatever the cycle says.
  it("gives the same next step in verid peek as in verid menu, and the cycle once a module is open", async () => {
    asMode("prep");
    const next = (text: string) => text.split("\n").filter((l) => l.startsWith("en: Next: "));
    const seen = async () => {
      const peek = (await cli("peek")).stdout;
      const step = next(peek);
      return [
        step.length === 1 && step[0] === next((await cli("menu")).stdout)[0],
        /^en: RAW: /m.test(peek),
      ];
    };
    const research = await seen();
    writeFileSync(researchPath(), "# Research\n");
    writeFileSync(planPath(), MODULES_PLAN);
    const order = await seen();
    expect((await cli("order", "auth")).code).toBe(0);
    const open = await seen();
    expect({ research, order, open }).toEqual({
      research: [true, false],
      order: [true, false],
      open: [true, true],
    });
  });

  it("shows research in recipe too, and the baseline in remix", async () => {
    writeFileSync(planPath(), MODULES_PLAN);
    expect((await cli("menu")).stdout).toContain(
      "verid: mode recipe · research missing · design written · 2 modules",
    );
    asMode("remix");
    const remix = (await cli("menu")).stdout;
    expect(remix).toContain("verid: mode remix · baseline 0");
    expect(remix).not.toContain("auth");
  });

  it("lists open questions, and asks them before ordering but not before the open module", async () => {
    writeFileSync(join(project, ".verid", "research.md"), "[NEEDS CLARIFICATION: who pays?]\n");
    writeFileSync(
      planPath(),
      "## Module: auth\n- AC-1: adds\n## Module: ui\n- AC-2: [NEEDS CLARIFICATION: which locale?]\n",
    );
    const before = (await cli("menu")).stdout;
    expect(before).toContain("  ? plan.md:4 which locale?");
    expect(before).toContain("  ? research.md:1 who pays?");
    expect(before).toMatch(/^en: Next: ask the developer the open questions above/m);
    expect((await hook(fixture("session-start"))).stdout).toContain("  ? plan.md:4 which locale?");
    expect((await cli("order", "auth")).code).toBe(0);
    const open = (await cli("menu")).stdout;
    expect(open).toContain("  ? plan.md:4 which locale?");
    expect(open).toMatch(/^en: Next: build module auth/m);
  });

  it("says what is wrong with an invalid plan", async () => {
    writeFileSync(planPath(), "- AC-1: a\n- AC-1: b");
    const r = await cli("menu");
    expect(r.stdout).toContain("verid: mode recipe · plan invalid");
    expect(r.stdout).toContain("AC-1 appears twice");
  });

  it("lets the agent run verid menu", async () => {
    expect((await hook(bash(`${VERID_CMD} menu`))).code).toBe(0);
  });

  it("shows the menu at session start", async () => {
    writeFileSync(researchPath(), "# Research\n");
    writeFileSync(planPath(), MODULES_PLAN);
    const start = (await hook(fixture("session-start"))).stdout;
    expect(start).toContain("  auth · planned · 0/1 ACs");
    expect(start).toContain(`${VERID_CMD} order auth`);
  });

  it("keeps verid peek to the cycle and points to verid menu", async () => {
    writeFileSync(planPath(), MODULES_PLAN);
    const peek = (await cli("peek")).stdout;
    expect(peek).not.toContain("AC-");
    expect(peek).toMatch(
      new RegExp(`^vi: .*${VERID_CMD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} menu`, "m"),
    );
    expect(peek).toMatch(
      new RegExp(`^en: .*${VERID_CMD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} menu`, "m"),
    );
  });

  it("holds the first stop of each conversation while an approved AC has no passing test", async () => {
    await approveAndRun();
    expect(state().tdd.passed_acs).toEqual(["AC-1"]);

    const held = await hook(fixture("stop"));
    expect(held.code).toBe(2);
    expect(held.stderr).toContain("AC-2");
    expect(held.stderr).not.toContain("AC-1,");
    expect(audit().at(-1)).toMatchObject({
      event: "stop_blocked",
      session: SESSION,
      reason: "uncovered",
    });
    expect(state().ac_stop_session).toBe(SESSION);

    expect((await hook(fixture("stop"))).code).toBe(0); // once for this conversation
    expect((await stopFrom("another-conversation")).code).toBe(2); // each conversation has its own
    expect(state().ac_stop_session).toBe("another-conversation");
    expect((await cli("menu")).stdout).toContain("  main · cooking · 1/2 ACs"); // AC-2 still uncovered

    // Approving again is a new chance to hold, and the list is the new plan's.
    writeFileSync(planPath(), `${GOOD_PLAN}\n- AC-3: waves`);
    expect((await cli("order")).code).toBe(0);
    expect(state().ac_stop_session).toBeNull();
    const again = await hook(fixture("stop"));
    expect(again.code).toBe(2);
    expect(again.stderr).toContain("AC-2, AC-3");
  });

  it("lets through the stop that follows a hold, without remembering it as one", async () => {
    await approveAndRun();
    expect((await stopFrom(SESSION, true)).code).toBe(0);
    expect(state().ac_stop_session).toBeNull(); // not held, so not remembered
    expect((await stopFrom(SESSION)).code).toBe(2);
    expect((await stopFrom(SESSION)).code).toBe(0);
  });

  it("counts the AC codes of the last valid run only, not the ones before", async () => {
    await approveAndRun();
    expect(state().tdd.passed_acs).toEqual(["AC-1"]);
    // A run that is not evidence leaves everything as it was.
    scenario(0, null);
    expect((await cli("taste")).code).toBe(2);
    expect(state().tdd.passed_acs).toEqual(["AC-1"]);
    // The test is gone, or red: AC-1 no longer has a passing test.
    scenario(0, GREEN_RUN);
    expect((await cli("taste")).code).toBe(0);
    expect(state().tdd.passed_acs).toEqual([]);
    scenario(0, "vitest-ac.xml");
    expect((await cli("taste")).code).toBe(0);
    scenario(1, RED_RUN);
    expect((await cli("taste")).code).toBe(1);
    expect(state().tdd.passed_acs).toEqual([]);
  });

  it("re-locks production code when design.md changes after the order, until ordered again", async () => {
    writeFileSync(planPath(), GOOD_PLAN);
    expect((await cli("order")).code).toBe(0);
    scenario(1, RED_ASSERT_RUN);
    expect((await cli("taste")).code).toBe(1);
    expect((await hook(write("src/calc.ts"))).code).toBe(0);

    writeFileSync(designPath(), "# Design\nA new store.\n");
    const locked = await hook(write("src/calc.ts"));
    expect(locked.stderr).toContain("verid [VERID_BURNT_PLAN_NOT_APPROVED]");
    expect((await cli("menu")).stdout).toContain("design changed since order");

    expect((await cli("order")).code).toBe(0);
    expect((await hook(write("src/calc.ts"))).code).toBe(0);
  });

  // An editor on Windows may save the design with a BOM and CRLF: the order signs those bytes.
  it("signs the design's bytes as saved, BOM and CRLF included", async () => {
    writeFileSync(planPath(), GOOD_PLAN);
    writeFileSync(designPath(), "﻿# Design\r\nOne store.\r\n");
    expect((await cli("order")).code).toBe(0);
    expect(await gate()).toBe("VERID_BURNT_TDD_NO_FAILING_TEST");
    writeFileSync(designPath(), "﻿# Design\nOne store.\n");
    expect(await gate()).toBe("VERID_BURNT_PLAN_NOT_APPROVED");
  });

  it("refuses to order a module before design.md exists", async () => {
    writeFileSync(planPath(), GOOD_PLAN);
    rmSync(designPath());
    const r = await cli("order");
    refusedWith(r, "VERID_BURNT_DESIGN_MISSING");
    expect(r.stderr).toContain(designPath());
  });

  it("covers an (e2e) AC only once an e2e test passes", async () => {
    const e2e = manifest("src/**", undefined, ".", "recipe").replace(
      '    test_globs: ["test/**"]\n',
      '    test_globs: ["test/**"]\n    e2e_globs: ["**/e2e/**"]\n',
    );
    writeFileSync(manifestFile, e2e);
    writeFileSync(planPath(), "## Module: calc\n- AC-2 (e2e): logs in\n");
    expect((await cli("order", "calc")).code).toBe(0);
    scenario(0, "vitest-ac2-unit.xml");
    expect((await cli("taste")).code).toBe(0);
    expect((await cli("menu")).stdout).toContain("  calc · cooking · 0/1 ACs");
    // Recorded with Playwright on Windows: the classname uses backslashes.
    scenario(0, "playwright-e2e.xml");
    expect((await cli("taste")).code).toBe(0);
    expect((await cli("menu")).stdout).toContain("  calc · evaluating · 1/1 ACs");
  });
});

describe("roles", () => {
  const SPLIT = [
    "roles:",
    '  tester: ["code-modernization:test-engineer"]',
    '  coder: ["general-purpose"]',
  ];
  // A prep project with research, a plan and its module ordered; the cycle starts RAW.
  const prepWith = async (roles: string[], order = true) => {
    writeFileSync(
      manifestFile,
      manifest("src/**", undefined, ".", "prep") + roles.join("\n") + "\n",
    );
    writeFileSync(join(project, ".verid", "research.md"), "# What it is for\n");
    writeFileSync(designPath(), "# How it is built\n");
    writeFileSync(join(project, ".verid", "plan.md"), "## Module: calc\n- AC-1: adds\n");
    if (order) expect((await cli("order", "calc")).code).toBe(0);
  };
  // A write or a Bash call by a subagent of this type; no type is the main thread.
  const by = (type: string | undefined, edit: (p: Payload) => void) =>
    fixture(
      type === undefined ? "pre-tool-use-write" : "pre-tool-use-write-from-plugin-agent",
      (p) => {
        if (type !== undefined) p.agent_type = type;
        edit(p);
      },
    );
  const writeAs = (type: string | undefined, path: string) =>
    by(type, (p) => (p.tool_input.file_path = path));
  const inProject = (rel: string) => join(project, ...rel.split("/"));

  const EXTENDED = [
    ...SPLIT,
    '  researcher: ["verid:researcher"]',
    '  architect: ["verid:architect"]',
    '  planner: ["verid:planner"]',
    '  qa: ["verid:qa"]',
  ];

  it("confines drafting subagents to their project documents for file tools and Bash", async () => {
    await prepWith(EXTENDED);
    const rows = [
      ["verid:researcher", ".verid/research.md", ".verid/design.md"],
      ["verid:architect", ".verid/design.md", "README.md"],
      ["verid:planner", ".verid/plan.md", "test/unit.test.ts"],
    ] as const;
    for (const [agent, allowed, forbidden] of rows) {
      expect(verdict(await hook(writeAs(agent, inProject(allowed))))).toBe("exit 0");
      const blocked = await hook(writeAs(agent, inProject(forbidden)));
      expect(verdict(blocked)).toBe("VERID_BURNT_ROLE_DOC_ONLY");
      expect(blocked.stderr).toContain(allowed);
      const command = by(agent, (p) => {
        p.tool_name = "Bash";
        p.tool_input = { command: `echo x > ${forbidden}` };
      });
      expect(verdict(await hook(command))).toBe("VERID_BURNT_ROLE_DOC_ONLY");
    }
  });

  it("allows qa end-to-end tests while refusing unit tests, code and docs through file tools and Bash", async () => {
    await prepWith(EXTENDED);
    const raw = readFileSync(manifestFile, "utf8").replace(
      '    test_globs: ["test/**"]',
      '    test_globs: ["test/**"]\n    e2e_globs: ["journeys/**"]',
    );
    writeFileSync(manifestFile, raw);
    const rows = [
      ["journeys/login.py", "exit 0"],
      ["test/unit.test.ts", "VERID_BURNT_ROLE_QA_E2E_ONLY"],
      ["src/a.ts", "VERID_BURNT_ROLE_QA_E2E_ONLY"],
      ["README.md", "VERID_BURNT_ROLE_QA_E2E_ONLY"],
    ] as const;
    for (const [rel, want] of rows) {
      expect(verdict(await hook(writeAs("verid:qa", inProject(rel)))), rel).toBe(want);
      const input = by("verid:qa", (p) => {
        p.tool_name = "Bash";
        p.tool_input = { command: `echo x > ${rel}` };
      });
      expect(verdict(await hook(input)), `Bash ${rel}`).toBe(want);
    }
    expect(
      verdict(
        await hook(writeAs("code-modernization:test-engineer", inProject("journeys/login.py"))),
      ),
    ).toBe("exit 0");
  });

  it("denies qa unit paths when Write content or Bash comments name Playwright", async () => {
    await prepWith(EXTENDED);
    const rows = [
      [
        "Write",
        { file_path: inProject("src/foo.test.ts"), content: '// from "@playwright/test"\n' },
        "VERID_BURNT_ROLE_QA_E2E_ONLY",
      ],
      [
        "Bash",
        { command: 'echo x > src/foo.test.ts # from "@playwright/test"' },
        "VERID_BURNT_ROLE_QA_E2E_ONLY",
      ],
    ] as const;
    const got = await serially(rows, async ([tool, input]) => {
      const payload = by("verid:qa", (p) => {
        p.tool_name = tool;
        p.tool_input = input;
      });
      return [tool, verdict(await hook(payload))];
    });
    expect(got).toEqual(rows.map(([tool, , want]) => [tool, want]));
  });

  it("keeps drafting documents at the project root when the guarded repo is a subfolder", async () => {
    await prepWith(EXTENDED, false);
    mkdirSync(inProject("backend"));
    writeFileSync(
      manifestFile,
      readFileSync(manifestFile, "utf8").replace("  - path: .", "  - path: backend"),
    );
    const rows = [
      [".verid/research.md", "exit 0"],
      ["backend/.verid/research.md", "VERID_BURNT_ROLE_DOC_ONLY"],
    ] as const;
    for (const [rel, want] of rows)
      expect(verdict(await hook(writeAs("verid:researcher", inProject(rel))))).toBe(want);
  });

  it("classifies qa writes only by e2e globs regardless of Playwright imports", async () => {
    await prepWith(EXTENDED);
    writeFileSync(
      manifestFile,
      readFileSync(manifestFile, "utf8").replace(
        '    test_globs: ["test/**"]',
        '    test_globs: ["test/**"]\n    e2e_globs: ["journeys/**"]',
      ),
    );
    mkdirSync(inProject("browser"));
    mkdirSync(inProject("journeys"));
    const source =
      'import { test, expect } from "@playwright/test";\ntest("AC-1 logs in", async ({ page }) => {});\n';
    writeFileSync(inProject("browser/existing.spec.ts"), source);
    writeFileSync(inProject("journeys/login.spec.ts"), source);
    const proposed = by("verid:qa", (p) => {
      p.tool_input = { file_path: inProject("browser/new.spec.ts"), content: source };
    });
    const edit = by("verid:qa", (p) => {
      p.tool_name = "Edit";
      p.tool_input = {
        file_path: inProject("browser/existing.spec.ts"),
        old_string: "logs in",
        new_string: "signs in",
      };
    });
    const command = by("verid:qa", (p) => {
      p.tool_name = "Bash";
      p.tool_input = { command: "touch browser/existing.spec.ts" };
    });
    const removeImport = by("verid:qa", (p) => {
      p.tool_name = "MultiEdit";
      p.tool_input = {
        file_path: inProject("journeys/login.spec.ts"),
        edits: [{ old_string: 'import { test, expect } from "@playwright/test";', new_string: "" }],
      };
    });
    const rows = [
      [proposed, "VERID_BURNT_ROLE_QA_E2E_ONLY"],
      [edit, "VERID_BURNT_ROLE_QA_E2E_ONLY"],
      [command, "VERID_BURNT_ROLE_QA_E2E_ONLY"],
      [writeAs("verid:qa", inProject("browser/unit.spec.ts")), "VERID_BURNT_ROLE_QA_E2E_ONLY"],
      [writeAs("verid:qa", inProject("journeys/new.spec.ts")), "exit 0"],
      [removeImport, "exit 0"],
    ] as const;
    expect(await serially(rows, async ([input]) => verdict(await hook(input)))).toEqual(
      rows.map(([, want]) => want),
    );
  });

  it("keeps legacy source and free paths under their original gates for every writer", async () => {
    const rows = [
      ["RAW source", [], undefined, "src/a.spec.ts", "remix", "VERID_BURNT_TDD_NO_FAILING_TEST"],
      [
        "unapproved source",
        [],
        undefined,
        "src/a.spec.ts",
        "recipe",
        "VERID_BURNT_PLAN_NOT_APPROVED",
      ],
      ["free file", [], undefined, "browser/a.spec.ts", "remix", "exit 0"],
      [
        "split main source",
        SPLIT,
        undefined,
        "src/a.spec.ts",
        "remix",
        "VERID_BURNT_ROLE_CODER_ONLY",
      ],
      [
        "split coder source",
        SPLIT,
        "general-purpose",
        "src/a.spec.ts",
        "remix",
        "VERID_BURNT_TDD_NO_FAILING_TEST",
      ],
      [
        "split tester source",
        SPLIT,
        "code-modernization:test-engineer",
        "src/a.spec.ts",
        "remix",
        "VERID_BURNT_ROLE_CODER_ONLY",
      ],
      [
        "split other source",
        SPLIT,
        "Explore",
        "src/a.spec.ts",
        "remix",
        "VERID_BURNT_ROLE_CODER_ONLY",
      ],
      ["split main free file", SPLIT, undefined, "browser/a.spec.ts", "remix", "exit 0"],
      ["split coder free file", SPLIT, "general-purpose", "browser/a.spec.ts", "remix", "exit 0"],
      [
        "reviewer",
        ["roles:", '  reviewer: ["custom:reviewer"]'],
        "custom:reviewer",
        "src/a.spec.ts",
        "remix",
        "VERID_BURNT_ROLE_READ_ONLY",
      ],
    ] as const;
    const got = await serially(rows, async ([name, roles, agent, rel, mode]) => {
      freshState();
      writeFileSync(
        manifestFile,
        manifest("src/**", undefined, ".", mode) + roles.join("\n") + "\n",
      );
      const payload = by(agent, (p) => {
        p.tool_input = {
          file_path: inProject(rel),
          content: 'import { test } from "@playwright/test";\n',
        };
      });
      const result = await hook(payload);
      return [name, verdict(result), state().tdd?.dirty ?? false];
    });
    expect(got).toEqual(rows.map(([name, , , , , want]) => [name, want, false]));
  });

  it("classifies existing test-named paths without reading their contents", async () => {
    mkdirSync(inProject("src/a.spec.ts"), { recursive: true });
    mkdirSync(inProject("browser/a.spec.ts"), { recursive: true });
    mkdirSync(inProject("test/a.spec.ts"), { recursive: true });
    const rows = [
      [
        "Edit",
        { file_path: inProject("src/a.spec.ts"), old_string: "x", new_string: "y" },
        "VERID_BURNT_TDD_NO_FAILING_TEST",
        false,
      ],
      [
        "MultiEdit",
        {
          file_path: inProject("browser/a.spec.ts"),
          edits: [{ old_string: "x", new_string: "y" }],
        },
        "exit 0",
        false,
      ],
      ["Bash", { command: "touch test/a.spec.ts" }, "exit 0", true],
      [
        "mcp__filesystem__write_file",
        { path: inProject("browser/a.spec.ts"), content: "x" },
        "exit 0",
        false,
      ],
    ] as const;
    const got = await serially(rows, async ([tool, input]) => {
      freshState();
      const payload = by(undefined, (p) => {
        p.tool_name = tool;
        p.tool_input = input;
      });
      const result = await hook(payload);
      return [tool, verdict(result), state().tdd?.dirty ?? false];
    });
    expect(got).toEqual(rows.map(([tool, , want, dirty]) => [tool, want, dirty]));
  });

  it("mentions optional roles at session start only when they are mapped", async () => {
    const rows = [
      [[], undefined, []],
      [
        SPLIT,
        "verid: roles reviewer — · tester code-modernization:test-engineer · coder general-purpose",
        [],
      ],
      [
        ["roles:", '  reviewer: ["custom:reviewer"]'],
        "verid: roles reviewer custom:reviewer · tester — · coder —",
        [],
      ],
      [
        ["roles:", '  planner: ["custom:planner"]'],
        "verid: roles reviewer — · tester — · coder — · planner custom:planner",
        ["planner"],
      ],
      [
        ["roles:", '  qa: ["custom:qa"]'],
        "verid: roles reviewer — · tester — · coder — · qa custom:qa",
        ["qa"],
      ],
      [
        EXTENDED,
        "verid: roles reviewer — · tester code-modernization:test-engineer · coder general-purpose · researcher verid:researcher · architect verid:architect · planner verid:planner · qa verid:qa",
        ["researcher", "architect", "planner", "qa"],
      ],
    ] as const;
    const got = await serially(rows, async ([roles]) => {
      freshState();
      writeFileSync(manifestFile, manifest() + roles.join("\n") + "\n");
      const result = await hook(fixture("session-start"));
      return [
        result.code,
        result.stdout.split("\n").find((line) => line.startsWith("verid: roles ")),
        [...new Set(result.stdout.match(/\b(?:researcher|architect|planner|qa)\b/g) ?? [])],
      ];
    });
    expect(got).toEqual(rows.map(([, line, roles]) => [0, line, roles]));
  });

  it("keeps new role overrides bound to one call and still applies the TDD gate", async () => {
    const rows = [
      ["verid:researcher", "notes.md", false, "VERID_BURNT_ROLE_DOC_ONLY", "exit 0"],
      [
        "verid:qa",
        "src/a.ts",
        false,
        "VERID_BURNT_ROLE_QA_E2E_ONLY",
        "VERID_BURNT_TDD_NO_FAILING_TEST",
      ],
      [
        "verid:qa",
        "test/a.test.ts",
        true,
        "VERID_BURNT_ROLE_QA_E2E_ONLY",
        "VERID_BURNT_TDD_TEST_FROZEN",
      ],
    ] as const;
    for (const [agent, rel, cooking, first, after] of rows) {
      freshState();
      await prepWith(EXTENDED);
      if (cooking) {
        scenario(1, RED_ASSERT_RUN);
        expect((await cli("taste")).code).toBe(1);
      }
      const input = writeAs(agent, inProject(rel));
      expect(verdict(await hook(input))).toBe(first);
      await allowOnce();
      expect(verdict(await hook(input))).toBe(after);
      expect(verdict(await hook(input))).toBe(first);
    }
  });

  it("blocks every write by the mapped reviewer, its Bash and outside the repo too", async () => {
    await prepWith(["roles:", '  reviewer: ["feature-dev:code-reviewer"]']);
    const reviewer = "feature-dev:code-reviewer";
    const bashAs = by(reviewer, (p) => {
      p.tool_name = "Bash";
      p.tool_input = { command: "echo x > out.txt" };
    });
    const rows: [string, string][] = [
      ["notes.txt", writeAs(reviewer, inProject("notes.txt"))],
      ["src/a.ts", writeAs(reviewer, inProject("src/a.ts"))],
      ["bash", bashAs],
      ["temp dir", writeAs(reviewer, join(tmpdir(), "verid-reviewer-note.txt"))],
    ];
    expect(
      Object.fromEntries(
        await serially(rows, async ([n, input]) => [n, verdict(await hook(input))]),
      ),
    ).toEqual(Object.fromEntries(rows.map(([n]) => [n, "VERID_BURNT_ROLE_READ_ONLY"])));
  });

  it("keeps the tester to tests and the coder to code once both are mapped", async () => {
    await prepWith(SPLIT);
    const tester = "code-modernization:test-engineer";
    const coder = "general-purpose";
    const rows: [string, string | undefined, string, string][] = [
      ["main writes code", undefined, "src/a.ts", "VERID_BURNT_ROLE_CODER_ONLY"],
      ["main writes a test", undefined, "test/a.test.ts", "VERID_BURNT_ROLE_TESTER_ONLY"],
      ["main writes research", undefined, ".verid/research.md", "exit 0"],
      ["coder writes a test", coder, "test/a.test.ts", "VERID_BURNT_ROLE_TESTER_ONLY"],
      ["tester writes a test", tester, "test/a.test.ts", "exit 0"],
      ["tester writes code", tester, "src/a.ts", "VERID_BURNT_ROLE_CODER_ONLY"],
      ["coder writes code in RAW", coder, "src/a.ts", "VERID_BURNT_TDD_NO_FAILING_TEST"],
      ["another subagent writes code", "Explore", "src/a.ts", "VERID_BURNT_ROLE_CODER_ONLY"],
    ];
    expect(
      Object.fromEntries(
        await serially(rows, async ([n, type, rel]) => [
          n,
          verdict(await hook(writeAs(type, inProject(rel)))),
        ]),
      ),
    ).toEqual(Object.fromEntries(rows.map(([n, , , want]) => [n, want])));
  });

  it("lets a role rule be overridden once, then still applies the TDD gate", async () => {
    await prepWith(SPLIT);
    const input = writeAs("general-purpose", inProject("test/a.test.ts"));
    expect(verdict(await hook(input))).toBe("VERID_BURNT_ROLE_TESTER_ONLY");
    await allowOnce();
    expect(verdict(await hook(input))).toBe("exit 0");
    expect(state().tdd.state).toBe("RAW");
    expect(state().tdd.dirty).toBe(true);
    expect(verdict(await hook(input))).toBe("VERID_BURNT_ROLE_TESTER_ONLY");
  });

  it("lets a plan-rule override past that rule only: the writes still meet the roles and the gates", async () => {
    // From the main thread, one command writes the plan and production code.
    const both = bash("echo x > .verid/plan.md; echo y > src/a.ts");
    // A missing design closes the ordered module; a missing research does not.
    const rows: [string, string[], string, string, string][] = [
      ["split", SPLIT, "design.md", "VERID_BURNT_PLAN_NO_DESIGN", "VERID_BURNT_ROLE_CODER_ONLY"],
      ["no design", [], "design.md", "VERID_BURNT_PLAN_NO_DESIGN", "VERID_BURNT_PLAN_NOT_APPROVED"],
      [
        "no research",
        [],
        "research.md",
        "VERID_BURNT_PLAN_NO_RESEARCH",
        "VERID_BURNT_TDD_NO_FAILING_TEST",
      ],
    ];
    const got = await serially(rows, async ([name, roles, missing]) => {
      freshState();
      await prepWith(roles);
      rmSync(join(project, ".verid", missing));
      const first = verdict(await hook(both));
      await allowOnce();
      return [name, first, verdict(await hook(both))];
    });
    expect(got).toEqual(rows.map(([name, , , first, then]) => [name, first, then]));
  });

  // A typo in roles, or verid's plugin not installed: the developer sees what Claude Code
  // reported, what is mapped, and how to install verid's agents.
  it("names the agent type it saw, the mapped agents and how to install them, when a role blocks", async () => {
    await prepWith(SPLIT);
    const r = await hook(writeAs("feature-dev:code-reviwer", inProject("src/a.ts")));
    expect(verdict(r)).toBe("VERID_BURNT_ROLE_CODER_ONLY");
    expect(
      ["feature-dev:code-reviwer", "general-purpose", "claude plugin install verid@verid"].filter(
        (s) => !r.stderr.includes(s),
      ),
    ).toEqual([]);
  });

  const REVIEWER = ["roles:", '  reviewer: ["feature-dev:code-reviewer"]'];
  const stopAs = (type: string, message: string, edit?: (p: Payload) => void) =>
    fixture("subagent-stop-reviewer", (p) => {
      p.agent_type = type;
      p.last_assistant_message = message;
      edit?.(p);
    });
  const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

  it("records the mapped reviewer's last message for the open module, and nothing otherwise", async () => {
    await prepWith(REVIEWER);
    const message = "LGTM: AC-1 and AC-2 hold.";
    const r = await hook(stopAs("feature-dev:code-reviewer", message));
    expect({ code: r.code, stdout: r.stdout }).toEqual({ code: 0, stdout: "" });
    const review = state().review;
    expect([review.module, review.agent_type]).toEqual(["calc", "feature-dev:code-reviewer"]);
    expect(readFileSync(join(project, review.file), "utf8")).toBe(message);
    expect(audit().at(-1)).toMatchObject({
      event: "review_recorded",
      module: "calc",
      sha256: sha(message),
    });

    const remix = () => writeFileSync(manifestFile, manifest() + REVIEWER.join("\n") + "\n");
    const rows: [string, () => unknown, string][] = [
      ["an agent not in roles", () => prepWith(REVIEWER), "general-purpose"],
      ["no open module", () => prepWith(REVIEWER, false), "feature-dev:code-reviewer"],
      ["no roles", () => prepWith([]), "feature-dev:code-reviewer"],
      ["remix", remix, "feature-dev:code-reviewer"],
    ];
    const got = await serially(rows, async ([name, setup, type]) => {
      freshState();
      await setup();
      return [name, (await hook(stopAs(type, message))).code, state().review ?? null];
    });
    expect(got).toEqual(rows.map(([name]) => [name, 0, null]));
  });

  it("forgets the review once code or a test is written, or a module is ordered, but not after a run or a doc edit", async () => {
    await prepWith(REVIEWER);
    scenario(1, RED_ASSERT_RUN);
    expect((await cli("taste")).code).toBe(1);
    const reviewed = async () => await hook(stopAs("feature-dev:code-reviewer", "ok"));
    await reviewed();
    const rows: [string, () => Promise<unknown>, boolean][] = [
      ["a doc edit", () => hook(write("README.md")), true],
      ["a passing run", () => (scenario(0, GREEN_RUN), cli("taste")), true],
      ["a code write", () => hook(write("src/calc.ts")), false],
      ["an order", async () => (await reviewed(), await cli("order", "calc")), false],
    ];
    const got = await serially(
      rows,
      async ([name, step]) => (await step(), [name, state().review !== null]),
    );
    expect(got).toEqual(rows.map(([name, , kept]) => [name, kept]));
  });

  it("holds a subagent that wrote code until a run shows it, once", async () => {
    await prepWith(REVIEWER);
    scenario(1, RED_ASSERT_RUN);
    expect((await cli("taste")).code).toBe(1);
    const asA1 = (p: Payload) => (p.agent_id = "a1");
    const wrote = await hook(
      by("general-purpose", (p) => (asA1(p), (p.tool_input.file_path = inProject("src/calc.ts")))),
    );
    expect(wrote.code).toBe(0);
    expect(state().writers).toEqual(["a1"]);

    const held = await hook(stopAs("general-purpose", "done", asA1));
    expect(held.code).toBe(2);
    expect(held.stderr).toContain("no claim of completion without passing evidence");
    expect(audit().at(-1)).toMatchObject({ event: "subagent_stop_blocked", agent_id: "a1" });

    const again = await hook(
      stopAs("general-purpose", "done", (p) => (asA1(p), (p.stop_hook_active = true))),
    );
    expect(again.code).toBe(0);
    expect(state().writers).toEqual([]);

    const other = await hook(stopAs("general-purpose", "done", (p) => (p.agent_id = "a2")));
    expect(other.code).toBe(0);
  });
});
