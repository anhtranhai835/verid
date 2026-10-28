import { describe, expect, it } from "vitest";
import {
  autoModules,
  autoNextStep,
  autoPhase,
  autoPlanProblem,
  changedServed,
  closeReady,
  coderRoundsAfter,
  gitCleanOf,
  parseVerdict,
  progressKey,
  stopHolds,
  type AutoFacts,
  type AutoPhase,
} from "../../src/core/auto.js";
import { parsePlan, type Approval, type ModuleView, type PlanModule } from "../../src/core/plan.js";
import { FRESH_AUTO, type State } from "../../src/core/state.js";

const modules = (text: string): PlanModule[] => {
  const r = parsePlan(text);
  if (!r.ok) throw new Error(r.detail);
  return r.modules;
};

const PRODUCT_MODULE = "## Module: product\n- AC-9 (e2e): adds from the page\n";

describe("parseVerdict: the reviewer's last Verdict line", () => {
  it("reads the reviewer's verdict from its last Verdict line, fail when there is none", () => {
    expect({
      plain: parseVerdict("ok\nVerdict: pass\n"),
      fail: parseVerdict("Verdict: fail"),
      bold: parseVerdict("**Verdict:** pass"),
      "bold value": parseVerdict("Verdict: **PASS**"),
      crlf: parseVerdict("ok\r\nVerdict: pass\r\n"),
      last: parseVerdict("Verdict: fail\nfixed\nVerdict: pass"),
      template: parseVerdict("Verdict: pass | fail"),
      prose: parseVerdict("the verdict: pass is yours"),
      none: parseVerdict("looks good"),
    }).toEqual({
      plain: "pass",
      fail: "fail",
      bold: "pass",
      "bold value": "pass",
      crlf: "pass",
      last: "pass",
      template: "fail",
      prose: "fail",
      none: "fail",
    });
  });
});

describe("autoPlanProblem: what an auto plan must look like", () => {
  it("asks an auto plan to end with the product module, every module approvable", () => {
    const problem = (text: string) => autoPlanProblem(modules(text));
    expect({
      ok: problem(`## Module: calc\n- AC-1: adds\n${PRODUCT_MODULE}`),
      "no product": problem("## Module: calc\n- AC-1: adds\n"),
      "no heading": problem("- AC-1: adds\n"),
      "product first": problem(`${PRODUCT_MODULE}## Module: calc\n- AC-1: adds\n`),
      question: problem(
        `## Module: calc\n- AC-1: adds [NEEDS CLARIFICATION: which]\n${PRODUCT_MODULE}`,
      ),
    }).toEqual({
      ok: null,
      "no product": "the plan has no product module",
      "no heading": "the plan has no product module",
      "product first": "the product module must come last",
      question: "calc: line 2 still has [NEEDS CLARIFICATION]",
    });
  });
});

const served: Approval = {
  sha256: "h1",
  acs: ["AC-1"],
  at: "t",
  served_at: "t",
  design_sha256: "d",
};
const hashes = { calc: "h1", report: "h2", product: "h3" };

describe("autoModules and changedServed: modules in plan order", () => {
  const mods = modules(
    `## Module: calc\n- AC-1: adds\n## Module: report\n- AC-2: prints\n${PRODUCT_MODULE}`,
  );

  it("opens the first module not served, in plan order", () => {
    const phases = (approvals: Record<string, Approval>, passed: string[]) =>
      autoModules(mods, hashes, approvals, { passedAcs: passed, passedE2eAcs: [] }).map(
        (v) => `${v.name}:${v.phase}`,
      );
    expect({
      none: phases({}, []),
      "calc served": phases({ calc: served }, []),
      "report covered": phases({ calc: served }, ["AC-2"]),
      "calc edited": phases({ calc: { ...served, sha256: "old" } }, []),
    }).toEqual({
      none: ["calc:cooking", "report:planned", "product:planned"],
      "calc served": ["calc:done", "report:cooking", "product:planned"],
      "report covered": ["calc:done", "report:evaluating", "product:planned"],
      "calc edited": ["calc:cooking", "report:planned", "product:planned"],
    });
  });

  it("opens product again when another module was served after it", () => {
    const phases = (approvals: Record<string, Approval>) =>
      autoModules(mods, hashes, approvals, { passedAcs: [], passedE2eAcs: [] }).map(
        (v) => `${v.name}:${v.phase}`,
      );
    const at = (sha256: string, served_at: string): Approval => ({ ...served, sha256, served_at });
    expect({
      "product last": phases({
        calc: at("h1", "t1"),
        report: at("h2", "t2"),
        product: at("h3", "t3"),
      }),
      "calc after product": phases({
        calc: at("h1", "t4"),
        report: at("h2", "t2"),
        product: at("h3", "t3"),
      }),
      "report new before product": phases({ calc: at("h1", "t1"), product: at("h3", "t3") }),
    }).toEqual({
      "product last": ["calc:done", "report:done", "product:done"],
      "calc after product": ["calc:done", "report:done", "product:cooking"],
      "report new before product": ["calc:done", "report:cooking", "product:planned"],
    });
  });

  it("names the served modules whose section was edited or removed since", () => {
    expect({
      edited: changedServed(hashes, {
        calc: { ...served, sha256: "old" },
        report: { ...served, sha256: "h2", served_at: null },
      }),
      removed: changedServed(hashes, {
        gone: served,
        dropped: { ...served, served_at: null },
        report: { ...served, sha256: "h2" },
      }),
    }).toEqual({ edited: ["calc"], removed: ["gone"] });
  });
});

describe("autoPhase: where an auto drive stands", () => {
  const calc = modules("## Module: calc\n- AC-1: adds\n");
  const calcAndProduct = modules(`## Module: calc\n- AC-1: adds\n${PRODUCT_MODULE}`);
  const servedProduct: Approval = { ...served, sha256: "h3", acs: ["AC-9"] };
  const base: AutoFacts = {
    auto: {
      ...FRESH_AUTO,
      signed: { research_sha256: "r", design_sha256: "d", at: "t", git: false },
      plan_sha256: "p",
    },
    researchHash: "r",
    designHash: "d",
    planHash: "p",
    plan: { ok: true, modules: calcAndProduct, hashes: { calc: "h1", product: "h3" } },
    approvals: {},
    evidence: { passedAcs: [], passedE2eAcs: [] },
    blockedFile: null,
  };
  const label = (p: AutoPhase): string =>
    p.kind === "stuck"
      ? `stuck:${p.reason}:${p.detail}`
      : p.kind === "module"
        ? `module:${p.view.name}`
        : p.kind === "plan"
          ? `plan:${p.missing}:${p.problem}`
          : p.kind;

  it("tells where auto stands: unsigned, stuck, planning, a module, or done", () => {
    expect({
      base: label(autoPhase(base)),
      unsigned: label(autoPhase({ ...base, auto: { ...base.auto, signed: null } })),
      "blocked latched": label(
        autoPhase({ ...base, auto: { ...base.auto, blocked: "need a key" } }),
      ),
      "blocked file": label(autoPhase({ ...base, blockedFile: "need a key" })),
      research: label(autoPhase({ ...base, researchHash: "r2" })),
      design: label(autoPhase({ ...base, designHash: "d2" })),
      "design gone": label(autoPhase({ ...base, designHash: null })),
      "served edited": label(
        autoPhase({ ...base, approvals: { calc: { ...served, sha256: "old" } } }),
      ),
      "plan reviews": label(autoPhase({ ...base, auto: { ...base.auto, plan_reviews: 3 } })),
      "coder rounds": label(
        autoPhase({ ...base, auto: { ...base.auto, coder_rounds: { "AC-1": 3 } } }),
      ),
      "module reviews": label(autoPhase({ ...base, auto: { ...base.auto, module_reviews: 3 } })),
      "security reviews": label(
        autoPhase({ ...base, auto: { ...base.auto, security_reviews: 3 } }),
      ),
      stops: label(autoPhase({ ...base, auto: { ...base.auto, stop_holds: 3 } })),
      "two at once": label(autoPhase({ ...base, designHash: "d2", blockedFile: "x" })),
      "no plan": label(autoPhase({ ...base, plan: null, planHash: null })),
      "bad plan": label(autoPhase({ ...base, plan: { ok: false, detail: "AC-1 appears twice" } })),
      "not reviewed": label(autoPhase({ ...base, auto: { ...base.auto, plan_sha256: null } })),
      "edited since": label(autoPhase({ ...base, planHash: "p2" })),
      "no product": label(
        autoPhase({ ...base, plan: { ok: true, modules: calc, hashes: { calc: "h1" } } }),
      ),
      done: label(autoPhase({ ...base, approvals: { calc: served, product: servedProduct } })),
    }).toEqual({
      base: "module:calc",
      unsigned: "unsigned",
      "blocked latched": "stuck:blocked:need a key",
      "blocked file": "stuck:blocked:need a key",
      research: "stuck:research_changed:.verid/research.md",
      design: "stuck:design_changed:.verid/design.md",
      "design gone": "stuck:design_changed:.verid/design.md",
      "served edited": "stuck:served_changed:calc",
      "plan reviews": "stuck:plan_reviews:3",
      "coder rounds": "stuck:coder_rounds:AC-1",
      "module reviews": "stuck:module_reviews:3",
      "security reviews": "stuck:security_reviews:3",
      stops: "stuck:no_progress:3",
      "two at once": "stuck:blocked:x",
      "no plan": "plan:true:null",
      "bad plan": "plan:false:AC-1 appears twice",
      "not reviewed": "plan:false:null",
      "edited since": "plan:false:null",
      "no product": "plan:false:the plan has no product module",
      done: "done",
    });
  });
});

describe("the coder's rounds, closing a module, progress, and the next step", () => {
  const view: ModuleView = {
    name: "calc",
    phase: "evaluating",
    acs: ["AC-1"],
    uncovered: [],
    designChanged: false,
    servedAt: null,
  };
  const passReview: NonNullable<State["review"]> = {
    module: "calc",
    agent_type: "verid:reviewer",
    file: "f",
    sha256: "s",
    at: "t",
    verdict: "pass",
    identity: null,
  };
  const passSecurity = { ...passReview, agent_type: "verid:security" };

  it("counts a coder's red round for the ACs its red tests name, and forgets ACs that pass with none left", () => {
    expect({
      more: coderRoundsAfter({ "AC-1": 1, "AC-3": 2 }, ["test/calc.test.ts > AC-1 adds"], ["AC-3"]),
      two: coderRoundsAfter({}, ["t > AC_1 and AC-2"], []),
      unnamed: coderRoundsAfter({ "AC-1": 2 }, ["t > adds"], []),
      green: coderRoundsAfter({ "AC-1": 2 }, [], ["AC-1"]),
      twice: coderRoundsAfter({}, ["t > AC-1 a", "t > AC-1 b"], []),
      overlap: coderRoundsAfter({ "AC-1": 1 }, ["t > AC-1 b"], ["AC-1"]),
    }).toEqual({
      more: { "AC-1": 2 },
      two: { "AC-1": 1, "AC-2": 1 },
      unnamed: { "AC-1": 2 },
      green: {},
      twice: { "AC-1": 1 },
      overlap: { "AC-1": 2 },
    });
  });

  it("builds a new rounds object, so the one state shares between projects is never touched", () => {
    const given = { "AC-1": 1 };
    const out = coderRoundsAfter(given, ["t > AC-1 a"], []);
    expect({
      given,
      "counted on a copy": out !== given,
      "nothing changed is still a copy": coderRoundsAfter(given, [], []) !== given,
      "the default is not handed out":
        coderRoundsAfter(FRESH_AUTO.coder_rounds, [], []) !== FRESH_AUTO.coder_rounds,
    }).toEqual({
      given: { "AC-1": 1 },
      "counted on a copy": true,
      "nothing changed is still a copy": true,
      "the default is not handed out": true,
    });
  });

  it("asks git only where signing saw a repository, so a repository gone since counts as dirty", () => {
    expect({
      "clean, signed outside": gitCleanOf({ clean: true }, false),
      "clean, signed inside": gitCleanOf({ clean: true }, true),
      "dirty, signed outside": gitCleanOf({ clean: false }, false),
      "dirty, signed inside": gitCleanOf({ clean: false }, true),
      "gone, signed inside": gitCleanOf(null, true),
      "none, signed outside": gitCleanOf(null, false),
    }).toEqual({
      "clean, signed outside": true,
      "clean, signed inside": true,
      "dirty, signed outside": false,
      "dirty, signed inside": false,
      "gone, signed inside": false,
      "none, signed outside": null,
    });
  });

  it("closes a module only on green evidence, a passing review after the last change, and a clean tree", () => {
    const tdd = { last_run: "r1", failing: [], dirty: false };
    expect({
      ready: closeReady(view, tdd, passReview, true),
      "no git": closeReady(view, tdd, passReview, null),
      cooking: closeReady({ ...view, phase: "cooking" }, tdd, passReview, true),
      "no run": closeReady(view, { ...tdd, last_run: null }, passReview, true),
      red: closeReady(view, { ...tdd, failing: ["k"] }, passReview, true),
      dirty: closeReady(view, { ...tdd, dirty: true }, passReview, true),
      "no review": closeReady(view, tdd, null, true),
      "other module": closeReady(view, tdd, { ...passReview, module: "report" }, true),
      "review fail": closeReady(view, tdd, { ...passReview, verdict: "fail" }, true),
      "git dirty": closeReady(view, tdd, passReview, false),
      "security pass": closeReady(view, tdd, passReview, true, passSecurity),
      "no security review": closeReady(view, tdd, passReview, true, null),
      "security fail": closeReady(view, tdd, passReview, true, {
        ...passSecurity,
        verdict: "fail",
      }),
      "security of another module": closeReady(view, tdd, passReview, true, {
        ...passSecurity,
        module: "report",
      }),
      "architecture fresh": closeReady(view, tdd, passReview, true, undefined, []),
      "architecture stale": closeReady(view, tdd, passReview, true, undefined, [
        { code: "VERID_BURNT_ARCHITECTURE_STALE", repo: "api", detail: "", log: "" },
      ]),
    }).toEqual({
      ready: true,
      "no git": true,
      cooking: false,
      "no run": false,
      red: false,
      dirty: false,
      "no review": false,
      "other module": false,
      "review fail": false,
      "git dirty": false,
      "security pass": true,
      "no security review": false,
      "security fail": false,
      "security of another module": false,
      "architecture fresh": true,
      "architecture stale": false,
    });
  });

  it("closes only on reviews of the work as it is now, with a Git history that holds", () => {
    const tdd = { last_run: "r1", failing: [], dirty: false };
    const now = { identity: "w2", problem: null };
    const read = (identity: string) => ({ ...passReview, identity });
    const message = {
      code: "VERID_BURNT_GIT_COMMIT_MESSAGE" as const,
      params: { repo: ".", commit: "abc", header: "wip" },
    };
    expect({
      current: closeReady(view, tdd, read("w2"), true, undefined, [], now),
      "review read other work": closeReady(view, tdd, read("w1"), true, undefined, [], now),
      "security read other work": closeReady(
        view,
        tdd,
        read("w2"),
        true,
        { ...passSecurity, identity: "w1" },
        [],
        now,
      ),
      "history problem": closeReady(view, tdd, read("w2"), true, undefined, [], {
        ...now,
        problem: message,
      }),
    }).toEqual({
      current: true,
      "review read other work": false,
      "security read other work": false,
      "history problem": false,
    });
  });

  it("asks for a commit before the review, then the Git fix, then a review of the committed work", () => {
    const open: AutoPhase = { kind: "module", view };
    const now = { identity: "w2", problem: null };
    const message = {
      code: "VERID_BURNT_GIT_COMMIT_MESSAGE" as const,
      params: { repo: ".", commit: "abc", header: "wip" },
    };
    const step = (...args: Parameters<typeof autoNextStep>) => {
      const s = autoNextStep(...args);
      return `${s.key} ${Object.values(s.params).join(" ")}`;
    };
    expect({
      "uncommitted, no review": step(open, true, true, null, false, undefined, [], now),
      "history problem": step(open, true, true, null, true, undefined, [], {
        ...now,
        problem: message,
      }),
      "review of other work": step(
        open,
        true,
        true,
        { ...passReview, identity: "w1" },
        true,
        undefined,
        [],
        now,
      ),
      "security of other work": step(
        open,
        true,
        true,
        { ...passReview, identity: "w2" },
        true,
        { ...passSecurity, identity: "w1" },
        [],
        now,
      ),
    }).toEqual({
      "uncommitted, no review": "auto.commit calc",
      "history problem": "VERID_BURNT_GIT_COMMIT_MESSAGE . abc wip calc",
      "review of other work": "auto.review calc",
      "security of other work": "auto.security calc",
    });
  });

  it("keys progress on outcomes: the same outcome is the same key whatever the order or the hold count", () => {
    const f: Parameters<typeof progressKey>[0] = {
      tdd: { state: "COOKING", stub: false, failing: ["b", "a"], passed_acs: ["AC-1"] },
      planHash: "p",
      auto: FRESH_AUTO,
      served: ["calc"],
      head: "h1",
    };
    const same = (g: typeof f) => progressKey(g) === progressKey(f);
    expect({
      reordered: same({ ...f, tdd: { ...f.tdd, failing: ["a", "b"] } }),
      "more holds": same({ ...f, auto: { ...FRESH_AUTO, stop_holds: 2, progress: "x" } }),
      "new commit": same({ ...f, head: "h2" }),
      "new failure": same({ ...f, tdd: { ...f.tdd, failing: ["a"] } }),
      "plan edited": same({ ...f, planHash: "p2" }),
      "a review failed": same({ ...f, auto: { ...FRESH_AUTO, module_reviews: 1 } }),
      "a security review failed": same({ ...f, auto: { ...FRESH_AUTO, security_reviews: 1 } }),
      "a round failed": same({ ...f, auto: { ...FRESH_AUTO, coder_rounds: { "AC-1": 1 } } }),
      "module closed": same({ ...f, served: ["calc", "report"] }),
    }).toEqual({
      reordered: true,
      "more holds": true,
      "new commit": false,
      "new failure": false,
      "plan edited": false,
      "a review failed": false,
      "a security review failed": false,
      "a round failed": false,
      "module closed": false,
    });
  });

  it("leaves the lists it keys on in the order they came", () => {
    const failing = ["b", "a"];
    const passed_acs = ["AC-2", "AC-1"];
    const served = ["report", "calc"];
    progressKey({
      tdd: { state: "COOKING", stub: false, failing, passed_acs },
      planHash: null,
      auto: FRESH_AUTO,
      served,
      head: null,
    });
    expect({ failing, passed_acs, served }).toEqual({
      failing: ["b", "a"],
      passed_acs: ["AC-2", "AC-1"],
      served: ["report", "calc"],
    });
  });

  it("counts holds in a row with no progress, from zero when the outcome changes", () => {
    expect({
      first: stopHolds(FRESH_AUTO, "k"),
      again: stopHolds({ ...FRESH_AUTO, progress: "k", stop_holds: 1 }, "k"),
      moved: stopHolds({ ...FRESH_AUTO, progress: "k", stop_holds: 2 }, "j"),
    }).toEqual({
      first: { stop_holds: 0, progress: "k" },
      again: { stop_holds: 2, progress: "k" },
      moved: { stop_holds: 0, progress: "j" },
    });
  });

  it("names the one next step of an auto drive", () => {
    const step = (
      phase: AutoPhase,
      research = true,
      design = true,
      review: State["review"] = null,
      git: boolean | null = true,
      security?: State["security"],
      architecture: Parameters<typeof autoNextStep>[6] = [],
    ) => {
      const s = autoNextStep(phase, research, design, review, git, security, architecture);
      return `${s.key}${Object.values(s.params)
        .map((v) => ` ${v}`)
        .join("")}`;
    };
    const open = (phase: "cooking" | "evaluating"): AutoPhase => ({
      kind: "module",
      view: { ...view, phase },
    });
    const unavailable = {
      code: "VERID_BURNT_ARCHITECTURE_UNAVAILABLE" as const,
      repo: "api",
      detail: "timed out after 1 s",
      log: "l.log",
    };
    expect({
      research: step({ kind: "unsigned" }, false, false),
      design: step({ kind: "unsigned" }, true, false),
      sign: step({ kind: "unsigned" }),
      stuck: step({ kind: "stuck", reason: "design_changed", detail: ".verid/design.md" }),
      write: step({ kind: "plan", missing: true, problem: null }),
      fix: step({ kind: "plan", missing: false, problem: "the plan has no product module" }),
      review: step({ kind: "plan", missing: false, problem: null }),
      cook: step(open("cooking")),
      evaluate: step(open("evaluating")),
      commit: step(open("evaluating"), true, true, passReview, false),
      "review failed": step(open("evaluating"), true, true, { ...passReview, verdict: "fail" }),
      "review failed, cooking": step(open("cooking"), true, true, {
        ...passReview,
        verdict: "fail",
      }),
      "other module failed": step(open("evaluating"), true, true, {
        ...passReview,
        module: "report",
        verdict: "fail",
      }),
      "review before security": step(open("evaluating"), true, true, null, true, null),
      security: step(open("evaluating"), true, true, passReview, true, null),
      "security failed": step(open("evaluating"), true, true, passReview, true, {
        ...passSecurity,
        verdict: "fail",
      }),
      "security failed, cooking": step(open("cooking"), true, true, null, true, {
        ...passSecurity,
        verdict: "fail",
      }),
      "security of another module": step(open("evaluating"), true, true, passReview, true, {
        ...passSecurity,
        module: "report",
      }),
      "security passed, dirty": step(
        open("evaluating"),
        true,
        true,
        passReview,
        false,
        passSecurity,
      ),
      architecture: step(open("evaluating"), true, true, null, true, undefined, [unavailable]),
      "architecture after a review": step(
        open("evaluating"),
        true,
        true,
        passReview,
        true,
        undefined,
        [unavailable],
      ),
      "architecture, review failed": step(
        open("evaluating"),
        true,
        true,
        { ...passReview, verdict: "fail" },
        true,
        undefined,
        [unavailable],
      ),
      "architecture, cooking": step(open("cooking"), true, true, null, true, undefined, [
        unavailable,
      ]),
      done: step({ kind: "done" }),
    }).toEqual({
      research: "menu.research",
      design: "menu.design",
      sign: "auto.sign",
      stuck: "auto.stuck.design_changed .verid/design.md",
      write: "auto.plan",
      fix: "auto.plan_fix the plan has no product module",
      review: "auto.plan_review",
      cook: "menu.cook calc",
      evaluate: "auto.review calc",
      commit: "auto.commit calc",
      "review failed": "auto.fix calc",
      "review failed, cooking": "auto.fix calc",
      "other module failed": "auto.review calc",
      "review before security": "auto.review calc",
      security: "auto.security calc",
      "security failed": "auto.security_fix calc",
      "security failed, cooking": "auto.security_fix calc",
      "security of another module": "auto.security calc",
      "security passed, dirty": "auto.commit calc",
      architecture: "VERID_BURNT_ARCHITECTURE_UNAVAILABLE api timed out after 1 s l.log",
      "architecture after a review":
        "VERID_BURNT_ARCHITECTURE_UNAVAILABLE api timed out after 1 s l.log",
      "architecture, review failed": "auto.fix calc",
      "architecture, cooking": "menu.cook calc",
      done: "auto.done",
    });
  });
});
