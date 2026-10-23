import { describe, expect, it } from "vitest";
import {
  acsInName,
  modulePhases,
  moduleProblem,
  nextStep,
  openModule,
  openQuestions,
  parsePlan,
  uncoveredAcs,
  type ModulePhase,
  type ModuleView,
  type PlanModule,
} from "../../src/core/plan.js";

const NO_AC = "no line of the form - AC-1: …";

const modules = (text: string): PlanModule[] => {
  const r = parsePlan(text);
  if (!r.ok) throw new Error(r.detail);
  return r.modules;
};

describe("parsePlan: modules and their acceptance criteria", () => {
  it("reads modules and their AC codes, keeping each section's exact text", () => {
    const [auth, expenses] = modules(
      "# P\r\n\r\n## Module: auth\r\n- AC-1: a\r\n## Module: expenses\r\n- AC-2: b\r\n",
    );
    expect([auth?.name, expenses?.name]).toEqual(["auth", "expenses"]);
    expect([auth?.acs, expenses?.acs]).toEqual([["AC-1"], ["AC-2"]]);
    expect(auth?.text).toBe("## Module: auth\r\n- AC-1: a\r\n");
    expect(expenses?.text).toBe("## Module: expenses\r\n- AC-2: b\r\n");
  });

  it("asks every AC of the product module to be end to end", () => {
    const problem = (text: string) => moduleProblem(modules(text)[0] as PlanModule);
    expect({
      "all e2e": problem(
        "## Module: product\n- AC-9 (e2e): a user signs up and adds two numbers\n",
      ),
      "one unit AC": problem(
        "## Module: product\n- AC-9 (e2e): a user signs up and adds two numbers\n- AC-10: fast\n",
      ),
      "another module": problem("## Module: calc\n- AC-1: adds\n"),
    }).toEqual({
      "all e2e": null,
      "one unit AC": "every AC of the product module must be (e2e): AC-10 is not",
      "another module": null,
    });
  });

  it("reads (e2e) right after an AC code", () => {
    const rows: [string, { acs: string[]; e2e: string[] }][] = [
      ["- AC-3 (e2e): logs in", { acs: ["AC-3"], e2e: ["AC-3"] }],
      ["- AC-3(e2e): logs in", { acs: ["AC-3"], e2e: ["AC-3"] }],
      ["- AC-3: logs in (e2e)", { acs: ["AC-3"], e2e: [] }],
      ["- AC-3 (E2E): x", { acs: ["AC-3"], e2e: ["AC-3"] }],
    ];
    const got = rows.map(([line]) => {
      const [m] = modules(line);
      return [line, { acs: m?.acs, e2e: m?.e2e }];
    });
    expect(got).toEqual(rows);
  });

  it("reads a plan without module headings as one module named main, whose text is the whole file", () => {
    expect(parsePlan("﻿- AC-1: a\n- AC-2: b")).toEqual({
      ok: true,
      modules: [
        {
          name: "main",
          acs: ["AC-1", "AC-2"],
          text: "﻿- AC-1: a\n- AC-2: b",
          clarification: null,
          e2e: [],
        },
      ],
    });
    expect(parsePlan("")).toEqual({
      ok: true,
      modules: [{ name: "main", acs: [], text: "", clarification: null, e2e: [] }],
    });
  });

  it("refuses a plan whose structure is broken", () => {
    const rows: [string, string][] = [
      ["- AC-1: a\n- AC-1: b", "AC-1 appears twice"],
      ["## Module: a\n- AC-1: x\n## Module: b\n- AC-1: y", "AC-1 appears twice"],
      ["## Module: a\n## Module: a", "module a appears twice"],
      ["## Module: Auth", "module name Auth is not kebab-case"],
      ["- AC-1: x\n## Module: a\n- AC-2: y", "AC-1 is outside any module"],
      // The intro belongs to no module: a question there is about the whole plan.
      [
        "[NEEDS CLARIFICATION: scope]\n## Module: a\n- AC-1: x",
        "line 1 still has [NEEDS CLARIFICATION]",
      ],
    ];
    expect(Object.fromEntries(rows.map(([text]) => [text, parsePlan(text)]))).toEqual(
      Object.fromEntries(rows.map(([text, detail]) => [text, { ok: false, detail }])),
    );
  });

  it("records the first clarification line of a module, and says why order refuses it", () => {
    const [a, b] = modules(
      "## Module: a\n- AC-1: x\n## Module: b\n- AC-2: [NEEDS CLARIFICATION: unit?]",
    );
    expect(b?.clarification).toBe(4);
    expect([moduleProblem(a as PlanModule), moduleProblem(b as PlanModule)]).toEqual([
      null,
      "line 4 still has [NEEDS CLARIFICATION]",
    ]);
    const [main] = modules("text only");
    const [notes] = modules("## Module: a\nnotes");
    expect([moduleProblem(main as PlanModule), moduleProblem(notes as PlanModule)]).toEqual([
      NO_AC,
      NO_AC,
    ]);
  });
});

describe("modulePhases, openModule and nextStep: where each module stands", () => {
  const mod = (name: string, acs: string[]): PlanModule => ({
    name,
    acs,
    text: name,
    clarification: null,
    e2e: [],
  });
  const ok = (sha256: string, served_at: string | null = null) => ({
    sha256,
    acs: [],
    at: "t",
    served_at,
    design_sha256: "d" as string | null,
  });
  const plan = ["a", "b", "c", "d", "e"].map((n, i) => mod(n, [`AC-${i + 1}`]));
  const hashes = { a: "ha", b: "hb", c: "hc", d: "hd", e: "he" };
  const approvals = { b: ok("hb"), c: ok("old"), d: ok("hd", "t2"), e: ok("he") };
  const evidence = { passedAcs: ["AC-2", "AC-3"], passedE2eAcs: [], designHash: "d" };
  const views = modulePhases(plan, hashes, approvals, evidence);
  const view = (name: string, phase: ModulePhase, acs: string[] = []): ModuleView => ({
    name,
    phase,
    acs: acs.length > 0 ? acs : ["AC-1"],
    uncovered: phase === "cooking" ? (acs.length > 0 ? acs : ["AC-1"]) : [],
    designChanged: false,
    servedAt: phase === "done" ? "t1" : null,
  });

  it("derives each module's phase from its approval, its section hash and the passing ACs", () => {
    expect(views).toEqual([
      {
        name: "a",
        phase: "planned",
        acs: ["AC-1"],
        uncovered: ["AC-1"],
        designChanged: false,
        servedAt: null,
      },
      {
        name: "b",
        phase: "evaluating",
        acs: ["AC-2"],
        uncovered: [],
        designChanged: false,
        servedAt: null,
      },
      {
        name: "c",
        phase: "planned",
        acs: ["AC-3"],
        uncovered: [],
        designChanged: false,
        servedAt: null,
      },
      {
        name: "d",
        phase: "done",
        acs: ["AC-4"],
        uncovered: ["AC-4"],
        designChanged: false,
        servedAt: "t2",
      },
      {
        name: "e",
        phase: "cooking",
        acs: ["AC-5"],
        uncovered: ["AC-5"],
        designChanged: false,
        servedAt: null,
      },
    ]);
  });

  it("finds the open module: cooking or evaluating", () => {
    expect(openModule(views)?.name).toBe("b");
    expect(openModule(views.filter((v) => v.name !== "b"))?.name).toBe("e");
    expect(openModule(views.filter((v) => ["a", "c", "d"].includes(v.name)))).toBeUndefined();
  });

  it("keeps a module open only while its section and the design match what was ordered", () => {
    const one = [mod("m", ["AC-9"])];
    const rows: [string, string | null, string | null, string | null, ModulePhase, boolean][] = [
      ["same design", "d1", "d1", null, "cooking", false],
      ["design edited", "d1", "d2", null, "planned", true],
      ["design deleted", "d1", null, null, "planned", true],
      ["ordered before designs", null, "d1", null, "planned", true],
      ["served, design edited", "d1", "d2", "t2", "done", false],
      ["served before designs", null, "d1", "t2", "done", false],
    ];
    const got = rows.map(([name, ordered, now, served]) => {
      const approval = { sha256: "hm", acs: ["AC-9"], at: "t", served_at: served };
      const [v] = modulePhases(
        one,
        { m: "hm" },
        { m: { ...approval, design_sha256: ordered } },
        { passedAcs: [], passedE2eAcs: [], designHash: now },
      );
      return [name, v?.phase, v?.designChanged];
    });
    expect(got).toEqual(rows.map(([name, , , , phase, changed]) => [name, phase, changed]));
  });

  it("orders the product module last, and says the product is done once it is served last", () => {
    const at = (v: ModuleView, servedAt: string) => ({ ...v, servedAt });
    const product = (phase: ModulePhase) => view("product", phase, ["AC-9"]);
    expect({
      "calc and product planned": nextStep(
        true,
        true,
        [view("calc", "planned"), product("planned")],
        false,
      ),
      "calc done, product planned": nextStep(
        true,
        true,
        [view("calc", "done"), product("planned")],
        false,
      ),
      "both done": nextStep(true, true, [view("calc", "done"), at(product("done"), "t2")], false),
      "a module served after the product": nextStep(
        true,
        true,
        [view("calc", "done"), at(product("done"), "t2"), at(view("extra", "done"), "t3")],
        false,
      ),
      "product first in the file": nextStep(
        true,
        true,
        [product("planned"), view("calc", "planned")],
        false,
      ),
      "no product, every module done": nextStep(true, true, [view("calc", "done")], false),
    }).toEqual({
      "calc and product planned": { key: "menu.order", module: "calc" },
      "calc done, product planned": { key: "menu.order", module: "product" },
      "both done": { key: "menu.done" },
      "a module served after the product": { key: "menu.order", module: "product" },
      "product first in the file": { key: "menu.order", module: "calc" },
      "no product, every module done": { key: "menu.served" },
    });
  });

  it("gives exactly one next step, in the spec's order", () => {
    expect({
      "prep, no research": nextStep(false, false, [view("x", "cooking")], false),
      "recipe, no research": nextStep(false, false, [], false),
      "recipe, no module yet": nextStep(true, true, [], false),
      "main without ACs": nextStep(
        true,
        true,
        [
          {
            name: "main",
            phase: "planned",
            acs: [],
            uncovered: [],
            designChanged: false,
            servedAt: null,
          },
        ],
        false,
      ),
      "an open cooking module": nextStep(true, true, [view("x", "cooking")], false),
      "an open evaluating module": nextStep(true, true, [view("x", "evaluating")], false),
      "a planned module next": nextStep(
        true,
        true,
        [view("a", "done"), view("b", "planned")],
        false,
      ),
      "a planned module without ACs": nextStep(
        true,
        true,
        [
          view("a", "done"),
          {
            name: "b",
            phase: "planned",
            acs: [],
            uncovered: [],
            designChanged: false,
            servedAt: null,
          },
        ],
        false,
      ),
      "every module done": nextStep(true, true, [view("a", "done")], false),
      // Open questions are asked before splitting or ordering, never before the open module.
      "a question, no open module": nextStep(true, true, [view("a", "planned")], true),
      "a question while a module is open": nextStep(
        true,
        true,
        [view("x", "cooking"), view("b", "planned")],
        true,
      ),
      "prep without research, with a question": nextStep(false, false, [], true),
      "research, no design": nextStep(true, false, [], false),
      "no research, no design": nextStep(false, false, [], false),
      "a module whose design changed": nextStep(
        true,
        true,
        [view("a", "planned"), { ...view("b", "planned"), designChanged: true }],
        false,
      ),
    }).toEqual({
      "research, no design": { key: "menu.design" },
      "no research, no design": { key: "menu.research" },
      "a module whose design changed": { key: "menu.order", module: "b" },
      "a question, no open module": { key: "menu.ask" },
      "a question while a module is open": { key: "menu.cook", module: "x" },
      "prep without research, with a question": { key: "menu.research" },
      "prep, no research": { key: "menu.research" },
      "recipe, no research": { key: "menu.research" },
      "recipe, no module yet": { key: "menu.split" },
      "main without ACs": { key: "menu.split" },
      "an open cooking module": { key: "menu.cook", module: "x" },
      "an open evaluating module": { key: "menu.evaluate", module: "x" },
      "a planned module next": { key: "menu.order", module: "b" },
      "a planned module without ACs": { key: "menu.split" },
      "every module done": { key: "menu.served" },
    });
  });
});

describe("openQuestions: what is still to agree with the developer", () => {
  it("finds every marker with its line and question", () => {
    expect({
      crlf: openQuestions("## Module: a\r\n- AC-1: x [NEEDS CLARIFICATION: which unit?]\r\n"),
      bare: openQuestions("intro\n[NEEDS CLARIFICATION]\n"),
      two: openQuestions("[NEEDS CLARIFICATION: one] and [NEEDS CLARIFICATION: two]"),
      unclosed: openQuestions("[NEEDS CLARIFICATION: open"),
      none: openQuestions("no questions"),
    }).toEqual({
      crlf: [{ line: 2, text: "which unit?" }],
      bare: [{ line: 2, text: "" }],
      two: [
        { line: 1, text: "one" },
        { line: 1, text: "two" },
      ],
      unclosed: [{ line: 1, text: "open" }],
      none: [],
    });
  });
});

describe("uncoveredAcs: approved codes with no passing test", () => {
  it("lists the approved codes no passing test names, matching codes exactly", () => {
    const passed = (passedAcs: string[]) => ({ passedAcs, passedE2eAcs: [] });
    expect(uncoveredAcs(["AC-1", "AC-2"], [], passed(["AC-1", "AC-9"]))).toEqual(["AC-2"]);
    expect(uncoveredAcs(["AC-01"], [], passed(["AC-1"]))).toEqual(["AC-01"]);
  });

  it("covers an (e2e) AC only with an e2e test", () => {
    const rows: [string[], string[], string[]][] = [
      [["AC-1", "AC-2"], [], ["AC-2"]],
      [["AC-1"], ["AC-2"], []],
      [[], ["AC-1", "AC-2"], []],
    ];
    const got = rows.map(([passedAcs, passedE2eAcs]) =>
      uncoveredAcs(["AC-1", "AC-2"], ["AC-2"], { passedAcs, passedE2eAcs }),
    );
    expect(got).toEqual(rows.map(([, , want]) => want));
  });
});

describe("acsInName: the AC codes a test name claims to cover", () => {
  it("reads whole AC codes from a test name only", () => {
    expect({
      "add > AC-1 adds": acsInName("add > AC-1 adds"),
      "AC-10 and AC-2": acsInName("AC-10 and AC-2"),
      "XAC-1": acsInName("XAC-1"),
      "AC-12 only": acsInName("AC-12 only"),
    }).toEqual({
      "add > AC-1 adds": ["AC-1"],
      "AC-10 and AC-2": ["AC-10", "AC-2"],
      "XAC-1": [],
      "AC-12 only": ["AC-12"],
    });
  });

  // Java, Kotlin, Go, C# and Python names cannot hold a dash.
  it("reads AC_1 as AC-1, with the same boundaries", () => {
    expect({
      "com.example.CalcTest > AC_1_addsTwoNumbers": acsInName(
        "com.example.CalcTest > AC_1_addsTwoNumbers",
      ),
      test_AC_2_rejects: acsInName("test_AC_2_rejects"),
      Test_AC_3: acsInName("Test_AC_3"),
      AC_10_adds: acsInName("AC_10_adds"),
      XAC_1: acsInName("XAC_1"),
      TestAC_1: acsInName("TestAC_1"),
      "ac_1 adds": acsInName("ac_1 adds"),
    }).toEqual({
      "com.example.CalcTest > AC_1_addsTwoNumbers": ["AC-1"],
      test_AC_2_rejects: ["AC-2"],
      Test_AC_3: ["AC-3"],
      AC_10_adds: ["AC-10"],
      XAC_1: [],
      TestAC_1: [],
      "ac_1 adds": [],
    });
  });
});
