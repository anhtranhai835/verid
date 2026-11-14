import {
  tempProject,
  autoManifest as manifest,
  told,
  enMessage,
  verdict,
  type GitResult,
} from "../support/project.js";
import { autoFactsOf } from "../../src/adapters/plan-file.js";
import { readState, statePaths } from "../../src/adapters/state-store.js";
import { readyModulePlan } from "./helpers.js";

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { join } from "node:path";
import { describe, expect, it } from "vitest";

let project: string;
let manifestFile: string;

const t = tempProject("verid-auto-$$-", {
  state: '{"schemaVersion":1}',
  manifest: () => manifest(),
  review: true,
  parents: false,
  bind: (p) => ({ dir: project, manifestFile } = p),
  setup: () => {
    writeFileSync(join(project, ".verid", ".gitignore"), ".state/\n");
  },
});
const { fixture, hook, cli, state, audit, put, seed } = t;
const { coderStop, stop, actorWrite: writeAs } = t;
const reviewerStop = t.reviewStop("verid:reviewer");
const securityStop = t.reviewStop("verid:security");
const git = t.gitChecked(checkGit);

// Only the cycle is replaced: the auto state a test built before it must stay.
const setTdd = (s: string) => seed({ tdd: { state: s, last_run: null } });

const prompt = (text: string) => fixture("user-prompt-submit-verid-tip", (p) => (p.prompt = text));

const writePlan = (text: string) => put(".verid/plan.md", readyModulePlan(project, text));
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

// The developer has approved research and design, and a plan is written.
async function signed(): Promise<void> {
  put(".verid/research.md", "# Research\n");
  put(".verid/design.md", "# Design\n");
  writePlan(CALC_AND_PRODUCT);
  await cli("order");
}

// The reviewer has passed the plan as it stands.
const planPassed = (): void =>
  seed({
    auto: {
      plan_sha256: autoFactsOf(project, readState(statePaths(project)), false, true).planHash,
    },
  });

// The project maps verid:security too, so a module closes only on its pass.
const withSecurity = (): void =>
  writeFileSync(
    manifestFile,
    manifest().replace(
      '  coder: ["verid:coder"]\n',
      '  coder: ["verid:coder"]\n  security: ["verid:security"]\n',
    ),
  );

const code = () => writeAs("verid:coder", "src/a.ts");
const test = () => writeAs("verid:tester", "test/a.test.ts");

function checkGit(r: GitResult): void {
  expect(r.status, r.stderr).toBe(0);
}

// The project is a git repo with everything committed; .verid/.gitignore keeps .state out.
function gitRepo(): void {
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
}

describe("signing in a no-brain drive", () => {
  it("signs research and design itself at the first hook, and again when one changes, keeping the counters", async () => {
    put(".verid/research.md", "# Research\n");
    const early = await code(); // no design yet: nothing to sign
    const unsigned = state().auto.signed;
    put(".verid/design.md", "# Design\n");
    writePlan(CALC_AND_PRODUCT);
    await code();
    const first = state().auto.signed;
    seed({
      auto: {
        plan_sha256: autoFactsOf(project, readState(statePaths(project)), false, true).planHash,
        plan_reviews: 2,
        module_reviews: 1,
      },
    });
    await code(); // nothing changed: the signature and the plan review stay
    const kept = state().auto.plan_sha256;
    appendFileSync(join(project, ".verid", "design.md"), "\nmore");
    await stop(false);
    const after = state().auto;
    expect({
      early,
      unsigned,
      first: first?.research_sha256,
      kept: kept !== null,
      resigned: after.signed.design_sha256 === sha(".verid/design.md"),
      "plan after a design change": after.plan_sha256,
      counters: [after.plan_reviews, after.module_reviews],
      events: audit()
        .filter((e) => e.event === "auto_signed")
        .map((e) => e.by),
    }).toEqual({
      early: "VERID_BURNT_TDD_NO_FAILING_TEST",
      unsigned: null,
      first: sha(".verid/research.md"),
      kept: true,
      resigned: true,
      "plan after a design change": null,
      counters: [2, 1],
      events: ["verid", "verid"],
    });
  });
});

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
        plan_sha256: autoFactsOf(project, readState(statePaths(project)), false, true).planHash,
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
        plan_sha256: autoFactsOf(project, readState(statePaths(project)), false, true).planHash,
        plan_reviews: 0,
        coder_rounds: {},
        module_reviews: 0,
        security_reviews: 0,
        stop_holds: 0,
        progress: null,
        blocked: null,
        work: null,
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
      "plan to review": /^en: Next: have reviewer \(verid:reviewer\) check/m.test(toReview),
    }).toEqual({
      signed: `verid: auto signed · research ${sha(".verid/research.md").slice(0, 8)} · spec none · design ${sha(".verid/design.md").slice(0, 8)}`,
      "no plan": true,
      "plan to review": true,
    });
  });

  it("signs the spec with research and design; a changed spec warns and needs a new plan review", async () => {
    put(".verid/research.md", "# Research\n");
    put(".verid/spec.md", "# Spec\n- REQ-1: The system shall add.\n");
    const first = sha(".verid/spec.md");
    put(".verid/design.md", "# Design\n");
    writePlan(CALC_AND_PRODUCT);
    const signed = (await cli("order")).stdout.split("\n")[0];
    const at = {
      ...state().auto,
      plan_sha256: autoFactsOf(project, readState(statePaths(project)), false, true).planHash,
    };
    seed({ auto: at });
    put(".verid/spec.md", "# Spec\n- REQ-1: The system shall add and subtract.\n");
    const doctor = (await cli("doctor")).stdout;
    await cli("order");
    expect({
      signed,
      recorded: at.signed.spec_sha256,
      event: audit().find((e) => e.event === "auto_signed")?.spec_sha256,
      warned: doctor.includes("[SPEC_CHANGED] .verid/spec.md changed since approval"),
      "plan after a spec change": state().auto.plan_sha256,
    }).toEqual({
      signed: `verid: auto signed · research ${sha(".verid/research.md").slice(0, 8)} · spec ${first.slice(0, 8)} · design ${sha(".verid/design.md").slice(0, 8)}`,
      recorded: first,
      event: first,
      warned: true,
      "plan after a spec change": null,
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
  it("never locks a write for want of a module or a stuck drive: the TDD cycle alone judges it", async () => {
    const rows: Record<string, string | undefined> = {};
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", "# Design\n");
    rows["no plan, RAW code"] = await code();
    writePlan(CALC_AND_PRODUCT);
    setTdd("COOKING");
    rows["plan pending, red code"] = await code();
    put(".verid/blocked.md", "need a key");
    rows["blocked, red code"] = await code();
    rows["blocked, red test"] = await test();
    expect(rows).toEqual({
      "no plan, RAW code": "VERID_BURNT_TDD_NO_FAILING_TEST",
      "plan pending, red code": "exit 0",
      "blocked, red code": "exit 0",
      "blocked, red test": "VERID_BURNT_TDD_TEST_FROZEN",
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
    rows.passed =
      state().auto.plan_sha256 ===
      autoFactsOf(project, readState(statePaths(project)), false, true).planHash;
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
    gitRepo();
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
    gitRepo();
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

  it("holds every stop of a signed drive, and lets go after three holds with no progress without locking", async () => {
    await signed(); // plan not reviewed yet: same outcome every time
    const runs = [
      await stop(false),
      await stop(true),
      await stop(true),
      await stop(true),
      await stop(true),
    ];
    // hold 1 sets the outcome; holds 2 and 3 see no progress; the 4th stop is the third with none
    setTdd("COOKING");
    expect([
      runs.map((r) => r.code),
      state().auto.stop_holds,
      audit().some((e) => e.event === "auto_idle" && e.reason === "no_progress"),
      told(runs[3], "auto.stuck.no_progress", { detail: "3" }),
      await code(),
    ]).toEqual([[2, 2, 2, 0, 0], 4, true, true, "exit 0"]);
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

  it("does not hold before research and design are written", async () => {
    put(".verid/research.md", "# Research\n");
    expect((await stop(false)).code).toBe(0);
  });

  it("lets the agent stop on blocked.md, and holds it again once the file is gone", async () => {
    await signed();
    put(".verid/blocked.md", "need a key\n");
    const blocked = await stop(false);
    rmSync(join(project, ".verid", "blocked.md"));
    expect([blocked.code, (await stop(false)).code]).toEqual([0, 2]);
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
      counted: menu.includes("security reviews 1"),
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

  it("goes on after the third failed security review: the next step is the fix, never a stuck drive", async () => {
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
      r.stderr.includes(
        enMessage("auto.security_fix", {
          module: "calc",
          tester: "verid:tester",
          coder: "verid:coder",
          reviewer: "verid:reviewer",
          security: "verid:security",
        }),
      ),
    ]).toEqual([3, 2, true]);
  });

  it("drops the module's passing review once an edited plan passes its review again", async () => {
    withSecurity();
    await signed();
    planPassed();
    gitRepo();
    seed({ tdd: calcGreen });
    put("src-new.txt", "x"); // security review is still pending, so calc stays open
    await reviewerStop("Verdict: pass");
    writePlan(CALC_AND_PRODUCT.replace("AC-1: adds two numbers", "AC-1: adds two integers"));
    await reviewerStop("Verdict: pass"); // the edited plan passes
    git("add", "-A");
    git("commit", "-q", "-m", "feat(calc): add numbers");
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
    gitRepo();
    await hook(fixture("session-start")); // the module opens on its own branch
    seed({ auto: { coder_rounds: { "AC-1": 2 }, module_reviews: 1 } });
    const open = (await cli("menu")).stdout.split("\n");
    appendFileSync(join(project, ".verid", "design.md"), "\nmore");
    const stuck = (await cli("menu")).stdout;
    expect({
      unsigned: unsigned[0],
      pending: pending.slice(0, 2),
      open: open.slice(0, 4),
      "stuck calc": stuck.split("\n")[1],
    }).toEqual({
      unsigned: "verid: mode prep · drive no-brain · not signed · plan pending · 0 modules",
      pending: [
        "verid: mode prep · drive no-brain · signed · plan pending · 2 modules",
        "  calc · planned · 0/1 ACs",
      ],
      "stuck calc": "  calc · cooking · 0/1 ACs",
      open: [
        "verid: mode prep · drive no-brain · signed · plan reviewed · 2 modules",
        "  calc · cooking · 0/1 ACs",
        "  product · planned · 0/1 ACs",
        "  rounds AC-1 2 · module reviews 1 · plan reviews 0 · stops 0/3",
      ],
    });
  });

  it("gives peek and /verid:menu the same next step as the menu", async () => {
    await signed();
    planPassed();
    gitRepo();
    await hook(fixture("session-start")); // the module opens on its own branch
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
        prompted.includes(step) && prompted.startsWith("verid: mode prep · drive no-brain"),
    }).toEqual({ peek: true, "/verid:menu": true });
  });

  it("tells the agent the auto rules at session start", async () => {
    await signed();
    const out = (await hook(fixture("session-start"))).stdout;
    expect(out.includes(enMessage("drive.auto", { verid: "verid" }))).toBe(true);
  });
});
