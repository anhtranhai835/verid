import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli, runHook } from "./in-process.js";

// Runs the CLI and hook in process, on a prep project driven by auto. The manifest's
// test command is a fake runner that copies recorded vitest JUnit reports, so scenario.json picks
// each run's outcome. Paths are built with join(), so these tests run on Windows and POSIX alike.
const root = join(import.meta.dirname, "..", "..");
const CLI = join(root, "dist", "cli.js");
const RUNNER = join(import.meta.dirname, "fake-runner.mjs");
const FIXTURES = join(root, "test", "fixtures", "claude-code");
const SESSION = "11111111-2222-3333-4444-555555555555";

let project: string;
let stateFile: string;
let auditFile: string;
let manifestFile: string;

const FRESH_STATE = '{"schemaVersion":1}';

const manifest = (testCmd = `"${process.execPath}" "${RUNNER}" {junit}`) =>
  [
    "schemaVersion: 1",
    "mode: prep",
    "drive: auto",
    "roles:",
    '  reviewer: ["verid:reviewer"]',
    '  tester: ["verid:tester"]',
    '  coder: ["verid:coder"]',
    "repos:",
    "  - path: .",
    `    test_cmd: ${JSON.stringify(testCmd)}`,
    '    source_globs: ["src/**"]',
    '    test_globs: ["test/**"]',
    "",
  ].join("\n");

beforeEach(() => {
  // `$$` in the path: it must reach the test command unchanged ({junit} replacement).
  project = mkdtempSync(join(tmpdir(), "verid-auto-$$-"));
  stateFile = join(project, ".verid", ".state", "state.json");
  auditFile = join(project, ".verid", ".state", "audit.jsonl");
  manifestFile = join(project, ".verid", "manifest.yaml");
  mkdirSync(join(project, ".verid", ".state"), { recursive: true });
  writeFileSync(join(project, ".verid", ".gitignore"), ".state/\n");
  writeFileSync(stateFile, FRESH_STATE);
  writeFileSync(manifestFile, manifest());
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

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

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

// In process; hook.e2e and tdd.e2e spawn the built hook and CLI.
const hook = (input: string, extra: Record<string, string> = {}): Promise<Run> =>
  runHook(input, { CLAUDE_PROJECT_DIR: project, ...extra });
const cliWith = (extra: Record<string, string>, ...args: string[]): Promise<Run> =>
  runCli(args, project, { CLAUDE_PROJECT_DIR: project, ...extra });
const cli = (...args: string[]): Promise<Run> => cliWith({}, ...args);

const scenario = (exit: number, junit: string | null, output = "fake runner output", delay = 0) =>
  writeFileSync(join(project, "scenario.json"), JSON.stringify({ exit, junit, output, delay }));

const state = () => JSON.parse(readFileSync(stateFile, "utf8"));
// Only the cycle is replaced: the auto state a test built before it must stay.
const setTdd = (s: string) => seed({ tdd: { state: s, last_run: null } });
const audit = (): Payload[] =>
  readFileSync(auditFile, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

const write = (rel: string) =>
  fixture("pre-tool-use-write", (p) => (p.tool_input.file_path = join(project, ...rel.split("/"))));
const prompt = (text: string) => fixture("user-prompt-submit-verid-tip", (p) => (p.prompt = text));
const verdict = (r: Run) => (r.code === 0 ? "exit 0" : /verid \[(\w+)\]/.exec(r.stderr)?.[1]);

// The developer, at the terminal, allows the action that was just blocked.
async function allowOnce(reason = "hotfix"): Promise<void> {
  const attended = { CLAUDE_CODE_SESSION_ATTENDED: "1" };
  const warned = await hook(prompt(`/verid tip ${reason}`), attended);
  const code = /\/verid confirm ([A-Z0-9]{6})/.exec(warned.stderr)?.[1];
  expect(code).toBeDefined();
  expect((await hook(prompt(`/verid confirm ${code}`), attended)).code).toBe(0);
}

const put = (rel: string, text: string) => writeFileSync(join(project, ...rel.split("/")), text);
const writePlan = (text: string) => put(".verid/plan.md", text);
const sha = (rel: string) =>
  createHash("sha256")
    .update(readFileSync(join(project, ...rel.split("/"))))
    .digest("hex");

const CALC_AND_PRODUCT = [
  "## Module: calc",
  "- AC-1: adds two numbers",
  "",
  "## Module: product",
  "- AC-9 (e2e): adds two numbers from the page",
  "",
].join("\n");

// Merge into what state.json holds now; `auto` is merged field by field, the rest replaced.
function seed(partial: Payload): void {
  const { auto, ...rest } = partial;
  const now = state();
  writeFileSync(
    stateFile,
    JSON.stringify({ ...now, ...rest, ...(auto && { auto: { ...now.auto, ...auto } }) }),
  );
}

// The developer has approved research and design, and a plan is written.
async function signed(): Promise<void> {
  put(".verid/research.md", "# Research\n");
  put(".verid/design.md", "# Design\n");
  writePlan(CALC_AND_PRODUCT);
  await cli("order");
}

// The reviewer has passed the plan as it stands.
const planPassed = (): void => seed({ auto: { plan_sha256: sha(".verid/plan.md") } });

// A subagent stops: the mapped reviewer with its report, or the coder c1, held once as Stop is.
const reviewerStop = async (report: string): Promise<Run> =>
  await hook(
    fixture("subagent-stop-reviewer", (p) => {
      p.agent_type = "verid:reviewer";
      p.last_assistant_message = report;
    }),
  );
const securityStop = async (report: string): Promise<Run> =>
  await hook(
    fixture("subagent-stop-reviewer", (p) => {
      p.agent_type = "verid:security";
      p.last_assistant_message = report;
    }),
  );
// The project maps verid:security too, so a module closes only on its pass.
const withSecurity = (): void =>
  writeFileSync(
    manifestFile,
    manifest().replace(
      '  coder: ["verid:coder"]\n',
      '  coder: ["verid:coder"]\n  security: ["verid:security"]\n',
    ),
  );
const coderStop = async (active: boolean): Promise<Run> =>
  await hook(
    fixture("subagent-stop-reviewer", (p) => {
      p.agent_type = "verid:coder";
      p.agent_id = "c1";
      p.stop_hook_active = active;
    }),
  );
// The main thread stops; Claude Code sets stop_hook_active on the stop that follows a hold.
const stop = async (active = false): Promise<Run> =>
  await hook(
    fixture("stop", (p) => {
      p.stop_hook_active = active;
    }),
  );

// The roles are split, so each write comes from the agent that owns the file: a main-thread
// write would be denied by a role rule and hide the auto rule.
const writeAs = async (agent: string, rel: string) =>
  verdict(
    await hook(
      fixture("pre-tool-use-write-from-plugin-agent", (p) => {
        p.agent_type = agent;
        p.tool_input.file_path = join(project, ...rel.split("/"));
      }),
    ),
  );
const code = () => writeAs("verid:coder", "src/a.ts");
const test = () => writeAs("verid:tester", "test/a.test.ts");
const notes = () => writeAs("verid:coder", "notes.md");

function git(...args: string[]): void {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: project,
    encoding: "utf8",
  });
  expect(r.status, r.stderr).toBe(0);
}

// The project is a git repo with everything committed; .verid/.gitignore keeps .state out.
function gitRepo(): void {
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
}

// A message's English line, as the hook fills it: {verid} names the CLI as it runs here.
const EN = JSON.parse(readFileSync(join(root, "i18n", "en.json"), "utf8")) as Record<
  string,
  string
>;
const enMessage = (key: string, params: Record<string, string>) =>
  (EN[key] ?? key).replace(
    /\{(\w+)\}/g,
    (m, name: string) =>
      params[name] ?? (name === "verid" ? `node "${CLI.replaceAll("\\", "/")}"` : m),
  );
// Stop let the agent go (exit 0) and told the developer the message, as a systemMessage.
const told = (r: Run | undefined, key: string, params: Record<string, string>) =>
  r?.code === 0 &&
  String((JSON.parse(r.stdout || "{}") as Payload).systemMessage).includes(enMessage(key, params));

describe("verid order and verid serve in an auto drive", () => {
  it("refuses what auto does itself, and what it cannot sign", async () => {
    const rows: Record<string, string | undefined> = {};
    rows["no research"] = verdict(await cli("order"));
    put(".verid/research.md", "# Research\n");
    rows["no design"] = verdict(await cli("order"));
    put(".verid/design.md", "# Design\n");
    rows["a module"] = verdict(await cli("order", "calc"));
    rows.serve = verdict(await cli("serve", "calc"));
    rows.sign = verdict(await cli("order"));
    expect(rows).toEqual({
      "no research": "VERID_BURNT_RESEARCH_MISSING",
      "no design": "VERID_BURNT_DESIGN_MISSING",
      "a module": "VERID_BURNT_AUTO_ORDER_MODULE",
      serve: "VERID_BURNT_AUTO_SERVE",
      sign: "exit 0",
    });
  });

  it("signs research and design, and on a resume keeps the plan only if neither changed", async () => {
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", "# Design\n");
    writePlan(CALC_AND_PRODUCT);
    await cli("order");
    const signed = state().auto.signed;
    // The design changes below, so its hash is taken now.
    const files = [sha(".verid/research.md"), sha(".verid/design.md")];
    seed({
      auto: {
        plan_sha256: sha(".verid/plan.md"),
        plan_reviews: 2,
        coder_rounds: { "AC-1": 2 },
        module_reviews: 1,
        stop_holds: 2,
        progress: "k",
        blocked: "x",
      },
    });
    put(".verid/blocked.md", "need a key");
    await cli("order");
    const kept = state().auto;
    appendFileSync(join(project, ".verid", "design.md"), "\nmore");
    await cli("order");
    expect({
      hashes: [signed.research_sha256, signed.design_sha256],
      kept: { ...kept, signed: null },
      "blocked.md": existsSync(join(project, ".verid", "blocked.md")),
      "after design change": state().auto.plan_sha256,
      events: audit().filter((e) => e.event === "auto_signed").length,
    }).toEqual({
      hashes: files,
      kept: {
        signed: null,
        plan_sha256: sha(".verid/plan.md"),
        plan_reviews: 0,
        coder_rounds: {},
        module_reviews: 0,
        security_reviews: 0,
        stop_holds: 0,
        progress: null,
        blocked: null,
      },
      "blocked.md": false,
      "after design change": null,
      events: 3,
    });
  });

  it("records at signing whether the project is in a git repository", async () => {
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", "# Design\n");
    writePlan(CALC_AND_PRODUCT);
    await cli("order");
    const outside = state().auto.signed.git;
    gitRepo();
    await cli("order");
    expect({ outside, inside: state().auto.signed.git }).toEqual({ outside: false, inside: true });
  });

  it("says what was signed and the one next step, naming the mapped reviewer", async () => {
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", "# Design\n");
    const noPlan = (await cli("order")).stdout;
    writePlan(CALC_AND_PRODUCT);
    const toReview = (await cli("order")).stdout;
    expect({
      signed: noPlan.split("\n")[0],
      "no plan": /^en: Next: write `\.verid\/plan\.md`/m.test(noPlan),
      "plan to review": /^en: Next: have the reviewer \(verid:reviewer\) check/m.test(toReview),
    }).toEqual({
      signed: `verid: auto signed · research ${sha(".verid/research.md").slice(0, 8)} · design ${sha(".verid/design.md").slice(0, 8)}`,
      "no plan": true,
      "plan to review": true,
    });
  });

  it("reopens a served module whose section changed when the developer resumes", async () => {
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", "# Design\n");
    writePlan(CALC_AND_PRODUCT);
    // calc was served for the sha256 of an older section, and plan.md no longer has a module gone
    const old = { sha256: "old", acs: ["AC-1"], at: "t", served_at: "t", design_sha256: "d" };
    seed({ modules: { calc: old, gone: old } });
    await cli("order");
    expect(state().modules).toEqual({});
  });
});

describe("writes in an auto drive", () => {
  it("locks production code until a module is open, and code and tests while stuck", async () => {
    const rows: Record<string, string | undefined> = {};
    rows.unsigned = await code();
    await signed();
    rows["plan pending"] = await code();
    planPassed();
    setTdd("COOKING");
    rows.open = await code();
    put(".verid/blocked.md", "need a key");
    rows["stuck code"] = await code();
    rows["stuck test"] = await test();
    rows["stuck notes"] = await notes();
    expect(rows).toEqual({
      unsigned: "VERID_BURNT_AUTO_NO_MODULE",
      "plan pending": "VERID_BURNT_AUTO_NO_MODULE",
      open: "exit 0",
      "stuck code": "VERID_BURNT_AUTO_STUCK",
      "stuck test": "VERID_BURNT_AUTO_STUCK",
      "stuck notes": "exit 0",
    });
  });

  it("latches blocked.md at the first write it sees, so a Bash rm of it does not resume", async () => {
    await signed();
    put(".verid/blocked.md", "need a key\n");
    const rm = await hook(
      fixture("pre-tool-use-bash", (p) => (p.tool_input.command = "rm .verid/blocked.md")),
    );
    rmSync(join(project, ".verid", "blocked.md")); // what the rm does once it runs
    expect([
      verdict(rm),
      state().auto.blocked,
      await code(),
      audit().some((e) => e.event === "auto_stuck" && e.reason === "blocked"),
    ]).toEqual(["exit 0", "need a key", "VERID_BURNT_AUTO_STUCK", true]);
  });

  it("lets the developer tip past an auto lock once", async () => {
    await signed();
    setTdd("COOKING");
    const first = await code();
    await allowOnce();
    expect([first, await code(), await code()]).toEqual([
      "VERID_BURNT_AUTO_NO_MODULE",
      "exit 0",
      "VERID_BURNT_AUTO_NO_MODULE",
    ]);
  });

  it("holds a test to the cycle even after the developer tipped past the stuck lock", async () => {
    await signed();
    planPassed();
    put(".verid/blocked.md", "need a key");
    const tipped = async (cycle: string) => {
      setTdd(cycle);
      const first = await test();
      await allowOnce();
      return [first, await test(), state().tdd.state];
    };
    expect({ cooking: await tipped("COOKING"), plated: await tipped("PLATED") }).toEqual({
      cooking: ["VERID_BURNT_AUTO_STUCK", "VERID_BURNT_TDD_TEST_FROZEN", "COOKING"],
      plated: ["VERID_BURNT_AUTO_STUCK", "exit 0", "RAW"],
    });
  });
});

describe("subagents stopping in an auto drive", () => {
  it("passes the plan on the reviewer's pass, and counts every other report as a fail", async () => {
    await signed();
    const rows: Record<string, unknown> = {};
    await reviewerStop("looks wrong\nVerdict: fail");
    await reviewerStop("no verdict at all");
    rows.counted = state().auto.plan_reviews;
    await reviewerStop("**Verdict:** pass");
    rows.passed = state().auto.plan_sha256 === sha(".verid/plan.md");
    rows.reset = state().auto.plan_reviews;
    rows.reports = readdirSync(join(project, ".verid", ".state", "reviews")).filter((f) =>
      f.startsWith("plan-"),
    ).length;
    rows.audited = audit()
      .filter((e) => e.event === "plan_reviewed")
      .map((e) => e.verdict);
    expect(rows).toEqual({
      counted: 2,
      passed: true,
      reset: 0,
      reports: 3,
      audited: ["fail", "fail", "pass"],
    });
  });

  it("fails the plan review of a plan auto cannot run, whatever the reviewer says", async () => {
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", "# Design\n");
    writePlan("## Module: calc\n- AC-1: adds\n");
    await cli("order");
    await reviewerStop("Verdict: pass");
    expect([state().auto.plan_sha256, state().auto.plan_reviews]).toEqual([null, 1]);
  });

  it("records the module review's verdict and counts a failing one", async () => {
    await signed();
    planPassed();
    await reviewerStop("Verdict: fail");
    const failed = state();
    await reviewerStop("Verdict: pass");
    const passed = state();
    expect([
      [failed.review?.module, failed.review?.verdict, failed.auto.module_reviews],
      [passed.review?.verdict, passed.auto.module_reviews],
      audit().find((e) => e.event === "review_recorded")?.verdict,
    ]).toEqual([["calc", "fail", 1], ["pass", 1], "fail"]);
  });

  it("counts a coder round that ends red against the ACs its red tests name", async () => {
    await signed();
    planPassed();
    // c1 wrote code, so its first stop while red is held, as today
    seed({
      writers: ["c1"],
      tdd: {
        state: "COOKING",
        last_run: null,
        failing: ["test/calc.test.ts > AC-1 adds\nexpected 2"],
        passed_acs: [],
      },
    });
    const held = await coderStop(false); // held once, not a round yet
    const heldRounds = state().auto.coder_rounds;
    await coderStop(true);
    const red = state().auto.coder_rounds;
    seed({
      tdd: { state: "PLATED", last_run: null, failing: [], passed_acs: ["AC-1"], dirty: false },
    });
    await coderStop(true);
    expect([held.code, heldRounds, red, state().auto.coder_rounds]).toEqual([
      2,
      {},
      { "AC-1": 1 },
      {},
    ]);
    expect(
      audit()
        .filter((e) => e.event === "coder_round")
        .map((e) => e.acs),
    ).toEqual([["AC-1"]]);
  });
});

describe("Stop in an auto drive", () => {
  // Every AC of calc passed in the last run, and nothing changed since.
  const calcGreen = {
    state: "PLATED",
    last_run: "r1",
    failing: [],
    dirty: false,
    passed_acs: ["AC-1"],
  };

  it("holds every stop of a signed drive, and lets go after three holds with no progress", async () => {
    await signed(); // plan not reviewed yet: same outcome every time
    const runs = [
      await stop(false),
      await stop(true),
      await stop(true),
      await stop(true),
      await stop(true),
    ];
    // hold 1 sets the outcome; holds 2 and 3 see no progress; the 4th stop is the third with none
    expect([
      runs.map((r) => r.code),
      state().auto.stop_holds,
      audit().some((e) => e.event === "auto_stuck" && e.reason === "no_progress"),
      told(runs[3], "auto.stuck.no_progress", { detail: "3" }),
    ]).toEqual([[2, 2, 2, 0, 0], 3, true, true]);
  });

  it("tells the developer why it lets the agent go: done, or stuck", async () => {
    await signed();
    planPassed();
    gitRepo();
    seed({ tdd: { ...calcGreen, passed_acs: ["AC-1", "AC-9"], passed_e2e_acs: ["AC-9"] } });
    await reviewerStop("Verdict: pass"); // serves calc
    await reviewerStop("Verdict: pass"); // serves product, the last module
    const done = await stop(false);
    put(".verid/blocked.md", "need a key\n");
    const blocked = await stop(false);
    expect({
      done: told(done, "auto.done", {}),
      blocked: told(blocked, "auto.stuck.blocked", { detail: "need a key" }),
    }).toEqual({ done: true, blocked: true });
  });

  it("starts the count of holds with no progress over when the outcome changes", async () => {
    await signed();
    await stop(false);
    await stop(true); // no progress since the first hold
    await reviewerStop("Verdict: fail"); // a counter moved
    await stop(true);
    expect(state().auto.stop_holds).toBe(0);
  });

  it("counts a rerun of verid taste and a passing review on a dirty tree as no progress", async () => {
    await signed();
    planPassed();
    scenario(0, "vitest-ac.xml"); // AC-1 passes again, as calcGreen already says
    gitRepo();
    seed({ tdd: calcGreen });
    put("dirty.txt", "x"); // untracked, so the passing review cannot close calc
    const holds: unknown[] = [];
    const hold = async (active: boolean) => {
      const r = await stop(active);
      holds.push([r.code, state().auto.stop_holds]);
    };
    await hold(false);
    const taste = await cli("taste");
    await hold(true);
    await reviewerStop("Verdict: pass");
    await hold(true);
    expect({
      holds,
      taste: [taste.code, state().tdd.last_run !== "r1"],
      review: state().review?.verdict,
      served: Object.keys(state().modules),
    }).toEqual({
      holds: [
        [2, 0],
        [2, 1],
        [2, 2],
      ],
      taste: [0, true],
      review: "pass",
      served: [],
    });
  });

  it("does not hold before the developer signs", async () => {
    put(".verid/research.md", "# Research\n");
    expect((await stop(false)).code).toBe(0);
  });

  it("latches blocked.md: the agent may stop, and deleting the file does not resume", async () => {
    await signed();
    put(".verid/blocked.md", "need a key\n");
    const r = await stop(false);
    rmSync(join(project, ".verid", "blocked.md"));
    expect([
      r.code,
      state().auto.blocked,
      await code(),
      audit().some((e) => e.event === "auto_stuck" && e.reason === "blocked"),
    ]).toEqual([0, "need a key", "VERID_BURNT_AUTO_STUCK", true]);
  });

  it("closes the open module on green evidence, a passing review and a clean tree, then opens the next", async () => {
    await signed();
    planPassed();
    gitRepo();
    seed({ tdd: calcGreen, auto: { module_reviews: 1, coder_rounds: { "AC-1": 1 } } });
    await reviewerStop("Verdict: pass");
    const r = await stop(false);
    const { modules, review, auto } = state();
    expect({
      calc: [
        modules.calc?.acs,
        typeof modules.calc?.served_at,
        modules.calc?.design_sha256 === sha(".verid/design.md"),
      ],
      reset: [review, auto.module_reviews, auto.coder_rounds],
      audited: audit()
        .filter((e) => e.event === "module_served")
        .map((e) => e.by),
      held: r.code,
      next: /AC-9|product/.test(r.stderr),
    }).toEqual({
      calc: [["AC-1"], "string", true],
      reset: [null, 0, {}],
      audited: ["auto"],
      held: 2,
      next: true,
    });
  });

  it("closes a module only once the mapped security reviewer passes it after the reviewer", async () => {
    withSecurity();
    await signed();
    planPassed();
    gitRepo();
    seed({ tdd: calcGreen });
    await reviewerStop("Verdict: pass");
    const waiting = await stop(false);
    const reviewed = state();
    await securityStop("Verdict: fail");
    const failed = state();
    const menu = (await cli("menu")).stdout;
    await securityStop("Verdict: pass");
    const passed = state();
    expect({
      waiting: [waiting.code, waiting.stderr.includes("verid:security"), reviewed.modules.calc],
      failed: [failed.security?.verdict, failed.auto.security_reviews, failed.modules.calc],
      counted: menu.includes("security reviews 1/3"),
      passed: [
        typeof passed.modules.calc?.served_at,
        passed.security,
        passed.auto.security_reviews,
      ],
      audited: audit()
        .filter((e) => e.event === "security_recorded")
        .map((e) => e.verdict),
    }).toEqual({
      waiting: [2, true, undefined],
      failed: ["fail", 1, undefined],
      counted: true,
      passed: ["string", null, 0],
      audited: ["fail", "pass"],
    });
  });

  it("leaves the drive stuck after the third failed security review", async () => {
    withSecurity();
    await signed();
    planPassed();
    gitRepo();
    seed({ tdd: calcGreen, auto: { security_reviews: 2 } });
    await reviewerStop("Verdict: pass");
    await securityStop("Verdict: fail");
    const r = await stop(false);
    expect([
      state().auto.security_reviews,
      r.code,
      r.stdout.includes("security reviewer has failed"),
    ]).toEqual([3, 0, true]);
  });

  it("keeps the module open while the tree is dirty, and asks for a commit", async () => {
    await signed();
    planPassed();
    gitRepo();
    seed({ tdd: calcGreen });
    put("src-new.txt", "x"); // untracked before the review, so it cannot close then
    await reviewerStop("Verdict: pass");
    const r = await stop(false);
    expect([
      state().modules.calc,
      r.code,
      r.stderr.includes(enMessage("auto.commit", { module: "calc" })),
    ]).toEqual([undefined, 2, true]);
  });

  it("does not close a module signed inside git once the repository is gone, and closes it when it is back", async () => {
    await signed();
    gitRepo();
    await cli("order"); // signed again, now inside the repository
    planPassed();
    seed({ tdd: calcGreen });
    // git answers "not a git repository" from here on
    renameSync(join(project, ".git"), join(project, ".git-moved"));
    await reviewerStop("Verdict: pass");
    const away = await stop(false);
    const servedAway = state().modules.calc;
    renameSync(join(project, ".git-moved"), join(project, ".git"));
    const back = await stop(false);
    expect({
      "served while gone": servedAway,
      "asks for a commit": [
        away.code,
        away.stderr.includes(enMessage("auto.commit", { module: "calc" })),
      ],
      "served when back": typeof state().modules.calc?.served_at,
      "says so": back.stderr.includes(enMessage("auto.closed", { module: "calc" })),
    }).toEqual({
      "served while gone": undefined,
      "asks for a commit": [2, true],
      "served when back": "string",
      "says so": true,
    });
  });

  it("closes the reviewed module at the stop after the agent commits, and says so", async () => {
    await signed();
    planPassed();
    gitRepo();
    seed({ tdd: calcGreen });
    put("src-new.txt", "x");
    await reviewerStop("Verdict: pass");
    git("add", "-A");
    git("commit", "-q", "-m", "calc");
    const r = await stop(false);
    expect([
      typeof state().modules.calc?.served_at,
      r.code,
      r.stderr.includes(enMessage("auto.closed", { module: "calc" })),
    ]).toEqual(["string", 2, true]);
  });

  it("drops the module's passing review once an edited plan passes its review again", async () => {
    await signed();
    planPassed();
    gitRepo();
    seed({ tdd: calcGreen });
    put("src-new.txt", "x"); // untracked, so the passing review cannot close calc yet
    await reviewerStop("Verdict: pass");
    writePlan(CALC_AND_PRODUCT.replace("AC-1: adds two numbers", "AC-1: adds two integers"));
    await reviewerStop("Verdict: pass"); // the edited plan passes
    git("add", "-A");
    git("commit", "-q", "-m", "calc");
    const r = await stop(false);
    expect([
      state().modules.calc,
      r.code,
      r.stderr.includes(enMessage("auto.review", { module: "calc", reviewer: "verid:reviewer" })),
    ]).toEqual([undefined, 2, true]);
  });

  it("lets the agent stop once the product module is served last", async () => {
    await signed();
    planPassed();
    gitRepo();
    seed({ tdd: { ...calcGreen, passed_acs: ["AC-1", "AC-9"], passed_e2e_acs: ["AC-9"] } });
    await reviewerStop("Verdict: pass"); // serves calc
    await reviewerStop("Verdict: pass"); // serves product, the last module
    const last = (await stop(false)).code;
    const { modules } = state();
    // calc served again after product: product's review of the whole has to run again
    seed({ modules: { ...modules, calc: { ...modules.calc, served_at: "9999-12-31T00:00:00Z" } } });
    expect([Object.keys(modules), last, (await stop(false)).code]).toEqual([
      ["calc", "product"],
      0,
      2,
    ]);
  });
});

describe("menu, peek and session start in an auto drive", () => {
  it("shows where an auto drive stands and its one next step", async () => {
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", "# Design\n");
    const unsigned = (await cli("menu")).stdout.split("\n");
    await signed();
    const pending = (await cli("menu")).stdout.split("\n");
    planPassed();
    seed({ auto: { coder_rounds: { "AC-1": 2 }, module_reviews: 1 } });
    const open = (await cli("menu")).stdout.split("\n");
    appendFileSync(join(project, ".verid", "design.md"), "\nmore");
    const stuck = (await cli("menu")).stdout;
    expect({
      unsigned: unsigned[0],
      pending: pending.slice(0, 2),
      open: open.slice(0, 4),
      "stuck calc": stuck.split("\n")[1],
      stuck: stuck.includes(enMessage("auto.stuck.design_changed", { detail: ".verid/design.md" })),
    }).toEqual({
      unsigned: "verid: mode prep · drive auto · not signed · plan pending · 0 modules",
      pending: [
        "verid: mode prep · drive auto · signed · plan pending · 2 modules",
        "  calc · planned · 0/1 ACs",
      ],
      "stuck calc": "  calc · planned · 0/1 ACs",
      open: [
        "verid: mode prep · drive auto · signed · plan reviewed · 2 modules",
        "  calc · cooking · 0/1 ACs",
        "  product · planned · 0/1 ACs",
        "  rounds AC-1 2/3 · module reviews 1/3 · plan reviews 0/3 · stops 0/3",
      ],
      stuck: true,
    });
  });

  it("gives peek and /verid:menu the same next step as the menu", async () => {
    await signed();
    planPassed();
    const step = enMessage("menu.cook", {
      module: "calc",
      tester: "verid:tester",
      coder: "verid:coder",
    });
    const peek = (await cli("peek")).stdout;
    const prompted = (await hook(prompt("/verid:menu"))).stderr;
    expect({
      peek: peek.includes(step),
      "/verid:menu":
        prompted.includes(step) && prompted.startsWith("verid: mode prep · drive auto"),
    }).toEqual({ peek: true, "/verid:menu": true });
  });

  it("tells the agent the auto rules at session start", async () => {
    await signed();
    const out = (await hook(fixture("session-start"))).stdout;
    expect(out.includes(enMessage("drive.auto", {}))).toBe(true);
  });
});
