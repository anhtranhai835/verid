import { describe, expect, it } from "vitest";
import { isOverridable } from "../../src/core/errors.js";
import type { Action } from "../../src/core/policy.js";
import {
  e2eCases,
  classify,
  classifyRuns,
  cycleHint,
  cycleLabel,
  decideTdd,
  failureKey,
  fileRole,
  isAssertion,
  shrinkBaseline,
  splitBaseline,
  transition,
  type Cycle,
  type TddLayout,
  type TddState,
  type TestCase,
} from "../../src/core/tdd.js";

const pass = (id: string): TestCase => ({ id, status: "passed", message: "" });
const fail = (id: string): TestCase => ({ id, status: "failed", message: `${id} broke` });
const skip = (id: string): TestCase => ({ id, status: "skipped", message: "" });

describe("classify: only a run whose exit code and JUnit agree is evidence", () => {
  it("counts a passing or failing run whose exit code agrees with its report", () => {
    expect(classify(0, [pass("a"), skip("s")])).toEqual({ kind: "pass", passed: 1, skipped: 1 });
    expect(classify(1, [pass("a"), fail("b")])).toEqual({
      kind: "fail",
      failing: [fail("b")],
      passed: 1,
      skipped: 0,
    });
  });

  it("refuses a run with no report, or with no test that ran", () => {
    expect(classify(1, null)).toEqual({ kind: "invalid", code: "VERID_BURNT_RUN_NO_JUNIT" });
    expect(classify(0, [skip("s")])).toEqual({ kind: "invalid", code: "VERID_BURNT_RUN_NO_TESTS" });
  });

  it("refuses a run whose exit code and report disagree", () => {
    const mismatch = { kind: "invalid", code: "VERID_BURNT_RUN_EXIT_MISMATCH" };
    expect({
      "a failure but exit 0": classify(0, [fail("b")]),
      "all passing but exit 1": classify(1, [pass("a")]),
      "all passing but killed": classify(null, [pass("a")]),
    }).toEqual({
      "a failure but exit 0": mismatch,
      "all passing but exit 1": mismatch,
      "all passing but killed": mismatch,
    });
  });
});

describe("classifyRuns: the runs of several runners judged as one", () => {
  const run = (exit: number | null, cases: TestCase[] | null, timedOut = false) => ({
    exit,
    cases,
    timedOut,
  });
  it("is evidence only when each runner's exit code agrees with its own report", () => {
    expect({
      "two passing": classifyRuns([run(0, [pass("a")]), run(0, [pass("b")])]),
      "one failing": classifyRuns([run(0, [pass("a")]), run(1, [fail("b")])]),
      "a mismatch hidden by the other's exit": classifyRuns([
        run(0, [fail("a")]),
        run(1, [pass("b")]),
      ]),
      "the second leaves no report": classifyRuns([run(0, [pass("a")]), run(1, null)]),
      "the first is stopped": classifyRuns([run(null, [pass("a")], true), run(0, [pass("b")])]),
    }).toEqual({
      "two passing": { verdict: { kind: "pass", passed: 2, skipped: 0 }, at: null },
      "one failing": {
        verdict: { kind: "fail", failing: [fail("b")], passed: 1, skipped: 0 },
        at: null,
      },
      "a mismatch hidden by the other's exit": {
        verdict: { kind: "invalid", code: "VERID_BURNT_RUN_EXIT_MISMATCH" },
        at: 0,
      },
      "the second leaves no report": {
        verdict: { kind: "invalid", code: "VERID_BURNT_RUN_NO_JUNIT" },
        at: 1,
      },
      "the first is stopped": {
        verdict: { kind: "invalid", code: "VERID_BURNT_RUN_TIMEOUT" },
        at: 0,
      },
    });
  });

  it("leaves out a runner that ran no test yet, and refuses when none did", () => {
    expect({
      "fe/ has no test yet": classifyRuns([run(1, [fail("a")]), run(1, [])]),
      "nothing ran": classifyRuns([run(1, []), run(0, [skip("s")])]),
      "one runner, as classify": classifyRuns([run(1, [pass("a")])]),
    }).toEqual({
      "fe/ has no test yet": {
        verdict: { kind: "fail", failing: [fail("a")], passed: 0, skipped: 0 },
        at: null,
      },
      "nothing ran": { verdict: { kind: "invalid", code: "VERID_BURNT_RUN_NO_TESTS" }, at: null },
      "one runner, as classify": {
        verdict: { kind: "invalid", code: "VERID_BURNT_RUN_EXIT_MISMATCH" },
        at: 0,
      },
    });
  });
});

describe("isAssertion: a failure that reached an assertion, not a test that could not run", () => {
  it("reads the report's tag, type and message the way each runner writes them", () => {
    const rows: [string, "failure" | "error", string, string, boolean][] = [
      [
        "vitest assertion",
        "failure",
        "AssertionError",
        "expected 'Hello An' to be 'Hi An' // Object.is equality",
        true,
      ],
      [
        "vitest missing module",
        "failure",
        "Error",
        "Cannot find module '../src/add.js' imported from /p/test/add.test.ts",
        false,
      ],
      ["vitest crash", "failure", "TypeError", "add is not a function", false],
      ["pytest assert", "failure", "", "assert add(1, 2) == 3", true],
      ["pytest collection error", "error", "", "collection failure", false],
      ["pytest NameError", "failure", "", "NameError: name 'add' is not defined", false],
      [
        "jest assertion",
        "failure",
        "",
        "Error: expect(received).toBe(expected) // Object.is equality",
        true,
      ],
      [
        "jest missing module",
        "failure",
        "",
        "Cannot find module '../src/add' from 'test/add.test.js'",
        false,
      ],
      [
        "JUnit 5 assertion",
        "failure",
        "org.opentest4j.AssertionFailedError",
        "expected: <1> but was: <2>",
        true,
      ],
      ["Java exception", "failure", "java.lang.NullPointerException", "", false],
      ["unknown shape: as before", "failure", "", "boom", true],
      // A name counts as a crash only when it names an error; any other one is the runner's own.
      ["nextest", "failure", "test failure with exit code 101", "thread 'adds' panicked", true],
      [".NET JunitXml.TestLogger", "failure", "failure", "Expected: 3 Actual: 2", true],
      ["Catch2", "failure", "REQUIRE", "add(1, 2) == 3", true],
      ["gtest on Windows", "failure", "", "C:\\src\\calc_test.cc:12", true],
      ["NUnit message only", "failure", "", "Expected: 3", true],
      // The error's name decides first: an assertion library's own, or a crash.
      ["a thrown Error saying assertion", "failure", "Error", "assertion failed", false],
      ["assert not defined", "failure", "ReferenceError", "assert is not defined", false],
      [
        "jest crash on an expect line",
        "failure",
        "",
        "TypeError: expect(...).toBeInTheDocument is not a function",
        false,
      ],
      [
        "mocha crash on an expect line",
        "failure",
        "TypeError",
        "expect(...).toBeFoo is not a function",
        false,
      ],
      ["pytest SystemExit", "failure", "", "SystemExit: 1", false],
      ["pytest warning as error", "failure", "", "DeprecationWarning: old api", false],
      [
        "pytest missing attribute",
        "failure",
        "",
        "AttributeError: module 'calc' has no attribute 'assert_valid'",
        false,
      ],
      [
        "pytest.raises not raised",
        "failure",
        "",
        "Failed: DID NOT RAISE <class 'ValueError'>",
        true,
      ],
      [
        "Gradle crash naming Assert",
        "failure",
        "java.lang.NoSuchMethodError",
        "org.junit.Assert.assertEquals(II)V",
        false,
      ],
      [
        "PHPUnit expectation",
        "failure",
        "PHPUnit\\Framework\\ExpectationFailedException",
        "Failed asserting that 2 matches expected 3.",
        true,
      ],
      [
        "RSpec expectation",
        "failure",
        "RSpec::Expectations::ExpectationNotMetError",
        "expected: 3",
        true,
      ],
      ["xUnit assertion", "failure", "Xunit.Sdk.EqualException", "Assert.Equal() Failure", true],
      // Only the first line counts, and `assert` only as a word that starts it.
      [
        "crash named like assert",
        "failure",
        "TypeError",
        "assertPositive is not a function",
        false,
      ],
      [
        "TS typo on an expect line",
        "failure",
        "Error",
        "Transform failed with 1 error:\n[PARSE_ERROR] 2 │ expect(1).toBe(3",
        false,
      ],
      [
        "pytest NameError of an assert helper",
        "failure",
        "",
        "NameError: name 'assert_valid' is not defined",
        false,
      ],
      [
        "pytest dotted exception",
        "failure",
        "",
        "json.decoder.JSONDecodeError: Expecting value",
        false,
      ],
      ["vitest snapshot mismatch", "failure", "Error", "Snapshot `x 1` mismatched", true],
      [
        "an assertion about a module name",
        "failure",
        "AssertionError",
        "expected 'x' to be 'Cannot find module'",
        true,
      ],
      [
        "Testing Library: element not found",
        "failure",
        "TestingLibraryElementError",
        "Unable to find an element with the text: Hi",
        true,
      ],
    ];
    expect(
      Object.fromEntries(rows.map(([n, tag, type, s]) => [n, isAssertion(tag, type, s)])),
    ).toEqual(Object.fromEntries(rows.map(([n, , , , want]) => [n, want])));
  });
});

describe("failureKey: the same failure across runs", () => {
  it("keeps the test id and only the first message line, since stack lines move", () => {
    expect(failureKey({ id: "t > a", status: "failed", message: "boom" })).toBe("t > a\nboom");
    expect(
      failureKey({
        id: "t > a",
        status: "failed",
        message: "  AssertionError: 1 !== 2\n ❯ t.ts:4:43",
      }),
    ).toBe("t > a\nAssertionError: 1 !== 2");
  });
});

describe("baseline: failures known before verid", () => {
  const b = fail("b");
  const c = fail("c");

  it("tells known failures from new ones by name, and reports a known one whose message moved", () => {
    expect(splitBaseline([b, c], ["b\nb broke"])).toEqual({ fresh: [c], known: [b], changed: [] });
    const moved = { ...b, message: "b broke differently" };
    expect(splitBaseline([moved], ["b\nb broke"])).toEqual({
      fresh: [],
      known: [moved],
      changed: [moved],
    });
  });

  it("drops a baseline test once it passes, and keeps one that still fails", () => {
    expect(shrinkBaseline([pass("b")], ["b\nb broke"])).toEqual([]);
    expect(shrinkBaseline([fail("b")], ["b\nb broke"])).toEqual(["b\nb broke"]);
  });

  // A file that failed to load is one entry named after the file; once it loads, its tests are
  // named "<file> > ...".
  it("drops a file's load error once a test in that file passes, and only that file's", () => {
    const loadError = "test/add.test.ts\nCannot find module";
    expect(shrinkBaseline([pass("test/add.test.ts > adds")], [loadError])).toEqual([]);
    expect(shrinkBaseline([pass("test/add.test.tsx > x")], [loadError])).toEqual([loadError]);
  });
});

describe("transition: the RAW-COOKING-PLATED cycle", () => {
  const failing = (...cases: TestCase[]) => ({ kind: "fail" as const, failing: cases });
  const passing = { kind: "pass" as const };
  const b = fail("b");
  const c = fail("c");

  const raw: Cycle = { state: "RAW", stub: false };
  const stub: Cycle = { state: "RAW", stub: true };
  const at = (state: TddState): Cycle => ({ state, stub: false });

  it("moves RAW → COOKING on a failure, COOKING → PLATED on a pass, PLATED → COOKING on a failure", () => {
    expect({
      "verify RAW: watched it fail": transition(raw, failing(b), []),
      "verify COOKING": transition(at("COOKING"), passing, ["b\nb broke"]),
      "the refactor broke something": transition(at("PLATED"), failing(b), []),
    }).toEqual({
      "verify RAW: watched it fail": { state: "COOKING", stub: false },
      "verify COOKING": { state: "PLATED", stub: false },
      "the refactor broke something": { state: "COOKING", stub: false },
    });
  });

  // In RAW the run must show a failure the last run did not have: a test that was failing
  // before proves nothing about the test that was just written or changed.
  it("keeps RAW unless the run shows a failure the last run did not have", () => {
    expect({
      "passes immediately": transition(raw, passing, []),
      "same failure": transition(raw, failing(b), ["b\nb broke"]),
      "same failure, stack moved": transition(
        raw,
        failing({ ...b, message: "b broke\n ❯ moved:9:1" }),
        ["b\nb broke"],
      ),
      "a new test fails": transition(raw, failing(b, c), ["b\nb broke"]),
      "fails another way": transition(raw, failing({ ...b, message: "b broke differently" }), [
        "b\nb broke",
      ]),
    }).toEqual({
      "passes immediately": { state: "RAW", stub: false },
      "same failure": { state: "RAW", stub: false },
      "same failure, stack moved": { state: "RAW", stub: false },
      "a new test fails": { state: "COOKING", stub: false },
      "fails another way": { state: "COOKING", stub: false },
    });
  });

  // RED needs an assertion: a test that cannot load opens the stub step, which production code
  // may use only until the test fails on an assertion.
  it("opens the stub on a new failure that cannot load, and leaves it for an assertion or a pass", () => {
    const broken = (id: string): TestCase => ({
      id,
      status: "failed",
      message: `${id} cannot load`,
      assertion: false,
    });
    const a = broken("a");
    expect({
      "RAW, a new load error": transition(raw, failing(a), []),
      "RAW, a load error and an assertion": transition(raw, failing(a, b), []),
      "RAW, the same load error as before": transition(raw, failing(a), ["a\na cannot load"]),
      "stub, still cannot load": transition(stub, failing(a), ["a\na cannot load"]),
      "stub, now fails on an assertion": transition(stub, failing(b), ["a\na cannot load"]),
      "stub, the stub made it pass": transition(stub, passing, ["a\na cannot load"]),
      "stub, only an old assertion failure": transition(stub, failing(b), ["b\nb broke"]),
      "COOKING, a load error": transition(at("COOKING"), failing(a), []),
      // pytest keys a failure by the test's first source line, the same before and after the
      // stub: what counts is that the test crashed last time and now reaches an assertion.
      "stub, the same test now fails on an assertion": transition(
        stub,
        failing({ id: "a", status: "failed", message: "def test_a():", assertion: true }),
        ["a\ndef test_a():"],
        ["a"],
      ),
      "RAW, an old assertion failure that never crashed": transition(
        raw,
        failing({ id: "a", status: "failed", message: "def test_a():", assertion: true }),
        ["a\ndef test_a():"],
        [],
      ),
    }).toEqual({
      "RAW, a new load error": { state: "RAW", stub: true },
      "RAW, a load error and an assertion": { state: "COOKING", stub: false },
      "RAW, the same load error as before": { state: "RAW", stub: false },
      "stub, still cannot load": { state: "RAW", stub: true },
      "stub, now fails on an assertion": { state: "COOKING", stub: false },
      "stub, the stub made it pass": { state: "RAW", stub: false },
      "stub, only an old assertion failure": { state: "RAW", stub: false },
      "COOKING, a load error": { state: "COOKING", stub: false },
      "stub, the same test now fails on an assertion": { state: "COOKING", stub: false },
      "RAW, an old assertion failure that never crashed": { state: "RAW", stub: false },
    });
  });

  it("shows the open stub as RAW · stub, with its own hint", () => {
    expect([
      [cycleLabel(stub), cycleHint(stub)],
      [cycleLabel(at("COOKING")), cycleHint(at("COOKING"))],
    ]).toEqual([
      ["RAW · stub", "status.stub"],
      ["COOKING", "status.cooking"],
    ]);
  });
});

describe("decideTdd", () => {
  it("preserves the actual allow reason when judging a list of repos", () => {
    const layout: TddLayout = {
      repoRoot: "/project/api",
      sourceGlobs: ["src/**"],
      testGlobs: ["tests/**"],
      ignoreGlobs: [],
    };
    const rows = [
      { path: "/project/notes/a.ts", reason: "outside the repo" },
      { path: "/project/api/readme.md", reason: "neither production code nor a test" },
    ];
    for (const row of rows)
      expect(
        decideTdd(
          { kind: "file", tool: "Write", access: "write", path: row.path, display: row.path },
          { state: "RAW", stub: false },
          [layout],
          true,
        ),
      ).toEqual({ kind: "allow", reason: row.reason });
  });
  it("uses the project root to confine drafting writes even when the repo is a subfolder", () => {
    const layout = {
      projectRoot: "c:/proj",
      repoRoot: "c:/proj/backend",
      sourceGlobs: ["**"],
      testGlobs: ["**/*.test.ts"],
      ignoreGlobs: ["**/*.md"],
    };
    const rows = [
      ["researcher", "c:/proj/.verid/research.md", "allow"],
      ["architect", "c:/proj/.verid/design.md", "allow"],
      ["planner", "c:/proj/.verid/plan.md", "allow"],
      ["researcher", "c:/proj/backend/.verid/research.md", "VERID_BURNT_ROLE_DOC_ONLY"],
      ["architect", "c:/proj/.verid/design.md.bak", "VERID_BURNT_ROLE_DOC_ONLY"],
      ["planner", "c:/other/.verid/plan.md", "VERID_BURNT_ROLE_DOC_ONLY"],
    ] as const;
    for (const [writer, path, want] of rows) {
      const d = decideTdd(
        { kind: "file", tool: "Write", access: "write", path, display: ".verid/plan.md" },
        { state: "RAW", stub: false },
        layout,
        false,
        { writer, split: true },
      );
      expect(d.kind === "deny" ? d.code : d.kind, path).toBe(want);
    }
  });

  it("keeps qa end-to-end writes under the TDD and stuck gates", () => {
    const layout = {
      repoRoot: "c:/proj",
      sourceGlobs: ["**"],
      testGlobs: ["**/*.test.ts"],
      ignoreGlobs: [],
      e2eGlobs: ["journeys/**"],
    };
    const rows = [
      ["RAW", "journeys/login.py", false, "reopen"],
      ["COOKING", "journeys/login.py", false, "VERID_BURNT_TDD_TEST_FROZEN"],
      ["PLATED", "journeys/login.py", false, "reopen"],
      ["RAW", "browser/login.spec.ts", false, "VERID_BURNT_ROLE_QA_E2E_ONLY"],
      ["COOKING", "browser/login.spec.ts", false, "VERID_BURNT_ROLE_QA_E2E_ONLY"],
      ["RAW", "browser/unit.spec.ts", false, "VERID_BURNT_ROLE_QA_E2E_ONLY"],
      ["RAW", "journeys/login.py", "VERID_BURNT_AUTO_STUCK", "VERID_BURNT_AUTO_STUCK"],
    ] as const;
    for (const [state, rel, stuck, want] of rows) {
      const path = `c:/proj/${rel}`;
      const d = decideTdd(
        { kind: "file", tool: "Write", access: "write", path, display: path },
        { state, stub: false },
        layout,
        true,
        { writer: "qa", split: true },
        { lock: stuck || null },
      );
      expect(d.kind === "deny" ? d.code : d.kind, `${state} ${rel}`).toBe(want);
    }
  });

  // Paths arrive normalized by the adapter: absolute, lowercase on win32.
  const win: TddLayout = {
    repoRoot: "c:\\proj",
    sourceGlobs: ["src/**"],
    testGlobs: ["test/**", "**/*.test.ts"],
    ignoreGlobs: [],
    e2eGlobs: [],
  };
  const posix: TddLayout = { ...win, repoRoot: "/home/u/proj" };
  const file = (tool: string, access: "read" | "write", path: string): Action => ({
    kind: "file",
    tool,
    access,
    path,
    display: path,
  });
  const write = (path: string) => file("Write", "write", path);
  const decisions = (
    state: TddState,
    planApproved: boolean,
    rows: [string, Action, string][],
    stub = false,
  ) => {
    const got = rows.map(([name, a]) => {
      const d = decideTdd(a, { state, stub }, win, planApproved);
      return [name, d.kind === "deny" ? d.code : d.kind];
    });
    expect(Object.fromEntries(got)).toEqual(
      Object.fromEntries(rows.map(([name, , want]) => [name, want])),
    );
  };

  it("RAW: locks production code, reopens on a test write, ignores everything else", () => {
    decisions("RAW", true, [
      ["write src", write("c:\\proj\\src\\a.ts"), "VERID_BURNT_TDD_NO_FAILING_TEST"],
      [
        "edit deep src",
        file("Edit", "write", "c:\\proj\\src\\deep\\b.ts"),
        "VERID_BURNT_TDD_NO_FAILING_TEST",
      ],
      ["write SRC in capitals", write("c:\\proj\\SRC\\a.ts"), "VERID_BURNT_TDD_NO_FAILING_TEST"],
      ["write a test (runs in flight go stale)", write("c:\\proj\\test\\a.test.ts"), "reopen"],
      ["write a colocated test (test globs win)", write("c:\\proj\\src\\a.test.ts"), "reopen"],
      ["write docs", write("c:\\proj\\docs\\notes.md"), "allow"],
      ["read src", file("Read", "read", "c:\\proj\\src\\a.ts"), "allow"],
      ["write outside the repo", write("c:\\other\\src\\a.ts"), "allow"],
      ["write a same-prefix dir", write("c:\\proj2\\src\\a.ts"), "allow"],
    ]);
  });

  // Fix the code, not the test: a failing test is frozen until production code passes it.
  it("COOKING: allows production code and freezes the tests", () => {
    decisions("COOKING", true, [
      ["write src (the next run must show it)", write("c:\\proj\\src\\a.ts"), "code"],
      ["write a test", write("c:\\proj\\test\\a.test.ts"), "VERID_BURNT_TDD_TEST_FROZEN"],
      ["write a colocated test", write("c:\\proj\\src\\a.test.ts"), "VERID_BURNT_TDD_TEST_FROZEN"],
      ["write docs", write("c:\\proj\\docs\\notes.md"), "allow"],
    ]);
  });

  // The default manifest: every file is code except tests and what is ignored, in any language.
  it("leaves ignored files free and keeps tests tests, where everything else is code", () => {
    const all: TddLayout = {
      ...win,
      sourceGlobs: ["**"],
      testGlobs: ["**/test/**"],
      ignoreGlobs: ["**/*.md", "**/*.json", "**/node_modules/**"],
    };
    const role = (state: TddState, path: string) => {
      const d = decideTdd(write(path), { state, stub: false }, all, true);
      return d.kind === "deny" ? d.code : d.kind;
    };
    expect({
      "java code, RAW": role("RAW", "c:\\proj\\src\\main\\java\\app.java"),
      "a Makefile, RAW": role("RAW", "c:\\proj\\makefile"),
      "java code, COOKING": role("COOKING", "c:\\proj\\src\\main\\java\\app.java"),
      "a java test, COOKING": role("COOKING", "c:\\proj\\src\\test\\java\\apptest.java"),
      "docs, RAW": role("RAW", "c:\\proj\\readme.md"),
      "a dependency, RAW": role("RAW", "c:\\proj\\node_modules\\x\\index.js"),
      "test data, ignored and a test, COOKING": role("COOKING", "c:\\proj\\test\\data.json"),
    }).toEqual({
      "java code, RAW": "VERID_BURNT_TDD_NO_FAILING_TEST",
      "a Makefile, RAW": "VERID_BURNT_TDD_NO_FAILING_TEST",
      "java code, COOKING": "code",
      "a java test, COOKING": "VERID_BURNT_TDD_TEST_FROZEN",
      "docs, RAW": "allow",
      "a dependency, RAW": "allow",
      "test data, ignored and a test, COOKING": "VERID_BURNT_TDD_TEST_FROZEN",
    });
  });

  it("counts a file in e2e_globs as a test, even outside the test globs", () => {
    const layout = { sourceGlobs: ["**"], testGlobs: ["**/test/**"], ignoreGlobs: [] };
    expect({
      "an e2e file": fileRole("e2e/login.spec.ts", { ...layout, e2eGlobs: ["**/e2e/**"] }),
      "the same, no e2e_globs": fileRole("e2e/login.spec.ts", { ...layout, e2eGlobs: [] }),
    }).toEqual({ "an e2e file": "test", "the same, no e2e_globs": "code" });
  });

  it("PLATED: allows production code, and the next test starts a new cycle", () => {
    decisions("PLATED", true, [
      ["write src", write("c:\\proj\\src\\a.ts"), "code"],
      ["write a test", write("c:\\proj\\src\\a.test.ts"), "reopen"],
      ["write docs", write("c:\\proj\\docs\\notes.md"), "allow"],
    ]);
  });

  // Without an approved plan, production code is locked in every state and before the RAW check;
  // tests and other files are unaffected.
  it("locks production code in every state while the plan is not approved", () => {
    const src = write("c:\\proj\\src\\a.ts");
    decisions("RAW", false, [
      ["write src", src, "VERID_BURNT_PLAN_NOT_APPROVED"],
      ["write a test", write("c:\\proj\\test\\a.test.ts"), "reopen"],
      ["write docs", write("c:\\proj\\docs\\notes.md"), "allow"],
    ]);
    decisions("COOKING", false, [
      ["write src", src, "VERID_BURNT_PLAN_NOT_APPROVED"],
      ["write a test", write("c:\\proj\\test\\a.test.ts"), "VERID_BURNT_TDD_TEST_FROZEN"],
    ]);
    decisions("PLATED", false, [["write src", src, "VERID_BURNT_PLAN_NOT_APPROVED"]]);
  });

  // An auto drive adds locks the human drive does not have: nothing but docs while it is stuck, while
  // a closed module waits for its merge or while its branch cannot be prepared, and no production
  // code while no module is open (tests stay writable, as with the plan gate).
  it("in auto, locks code and tests while stuck, waiting or unprepared, and code with no open module", () => {
    const at = (file: string, approved: boolean, auto?: Parameters<typeof decideTdd>[5]) => {
      const d = decideTdd(
        write(`c:\\proj\\${file}`),
        { state: "COOKING", stub: false },
        win,
        approved,
        undefined,
        auto,
      );
      return d.kind === "deny" ? d.code : d.kind;
    };
    expect({
      "stuck code": at("src/a.ts", true, { lock: "VERID_BURNT_AUTO_STUCK" }),
      "stuck test": at("test/a.test.ts", true, { lock: "VERID_BURNT_AUTO_STUCK" }),
      "stuck free": at("README.md", true, { lock: "VERID_BURNT_AUTO_STUCK" }),
      "waiting code": at("src/a.ts", false, { lock: "VERID_BURNT_AUTO_WAITING_MERGE" }),
      "waiting test": at("test/a.test.ts", false, { lock: "VERID_BURNT_AUTO_WAITING_MERGE" }),
      "waiting free": at("README.md", false, { lock: "VERID_BURNT_AUTO_WAITING_MERGE" }),
      "unprepared code": at("src/a.ts", false, { lock: "VERID_BURNT_AUTO_BRANCH" }),
      "unprepared test": at("test/a.test.ts", false, { lock: "VERID_BURNT_AUTO_BRANCH" }),
      "no module code": at("src/a.ts", false, { lock: null }),
      "no module test": at("test/a.test.ts", false, { lock: null }),
      "open code": at("src/a.ts", true, { lock: null }),
      human: at("src/a.ts", false),
    }).toEqual({
      "stuck code": "VERID_BURNT_AUTO_STUCK",
      "stuck test": "VERID_BURNT_AUTO_STUCK",
      "stuck free": "allow",
      "waiting code": "VERID_BURNT_AUTO_WAITING_MERGE",
      "waiting test": "VERID_BURNT_AUTO_WAITING_MERGE",
      "waiting free": "allow",
      "unprepared code": "VERID_BURNT_AUTO_BRANCH",
      "unprepared test": "VERID_BURNT_AUTO_BRANCH",
      "no module code": "VERID_BURNT_AUTO_NO_MODULE",
      "no module test": "VERID_BURNT_TDD_TEST_FROZEN",
      "open code": "code",
      human: "VERID_BURNT_PLAN_NOT_APPROVED",
    });
    expect([
      isOverridable("VERID_BURNT_AUTO_STUCK"),
      isOverridable("VERID_BURNT_AUTO_NO_MODULE"),
      isOverridable("VERID_BURNT_AUTO_WAITING_MERGE"),
      isOverridable("VERID_BURNT_AUTO_BRANCH"),
    ]).toEqual([true, true, true, false]);
  });

  // The stub step opens production code only for the stub; the plan gate still comes first.
  it("RAW · stub: opens production code for the stub and keeps tests writable, after the plan gate", () => {
    decisions(
      "RAW",
      true,
      [
        ["write src", write("c:\\proj\\src\\a.ts"), "code"],
        ["write a test (the stub stays open)", write("c:\\proj\\test\\a.test.ts"), "reopen"],
      ],
      true,
    );
    decisions(
      "RAW",
      false,
      [
        [
          "write src, no open module",
          write("c:\\proj\\src\\a.ts"),
          "VERID_BURNT_PLAN_NOT_APPROVED",
        ],
      ],
      true,
    );
  });

  it("works on POSIX paths too", () => {
    const raw: Cycle = { state: "RAW", stub: false };
    expect(decideTdd(write("/home/u/proj/src/a.ts"), raw, posix, true)).toMatchObject({
      kind: "deny",
      code: "VERID_BURNT_TDD_NO_FAILING_TEST",
      target: "/home/u/proj/src/a.ts",
    });
    expect(decideTdd(write("/home/u/proj/src/a.ts"), raw, posix, false)).toMatchObject({
      kind: "deny",
      code: "VERID_BURNT_PLAN_NOT_APPROVED",
      target: "/home/u/proj/src/a.ts",
    });
    expect(
      decideTdd(write("/home/u/proj/test/a.ts"), { state: "PLATED", stub: false }, posix, true)
        .kind,
    ).toBe("reopen");
  });

  it("leaves Bash and other tools to the policy rules", () => {
    const raw: Cycle = { state: "RAW", stub: false };
    expect(decideTdd({ kind: "bash", command: "echo x > src/a.ts" }, raw, win, false).kind).toBe(
      "allow",
    );
    expect(decideTdd({ kind: "other", tool: "WebFetch" }, raw, win, false).kind).toBe("allow");
  });
});

describe("e2eCases", () => {
  it("counts every test a Playwright run reports, and elsewhere a test whose file is in e2e_globs", () => {
    const rows: [string, string | null, string, boolean][] = [
      ["Playwright, testDir e2e", "playwright", "login.spec.ts > AC-3 logs in", true],
      ["vitest, a file in e2e/", "vitest", "e2e/login.spec.ts > AC-3 logs in", true],
      ["vitest, a unit test", "vitest", "src/calc.test.ts > AC-3 adds", false],
      ["test_cmd, a Windows path", null, "e2e\\login.spec.ts > AC-3", true],
      ["test_cmd, a .e2e. file", null, "web/login.e2e.ts > AC-4", true],
      ["no classname", "vitest", "AC-5 no classname", false],
      ["pytest, an e2e package", "pytest", "tests.e2e.test_login > test_AC_6_logs_in", true],
      ["Java, an e2e package", "maven", "com.acme.e2e.LoginTest > AC_7_logsIn", true],
      ["pytest, a unit package", "pytest", "tests.unit.test_calc > test_AC_8_adds", false],
    ];
    const tc = (id: string): TestCase => ({ id, status: "passed", message: "" });
    const got = rows.map(([name, runner, id]) => [
      name,
      e2eCases([{ runner, cases: [tc(id)] }], ["**/e2e/**", "**/*.e2e.*"]).length === 1,
    ]);
    expect(got).toEqual(rows.map(([name, , , want]) => [name, want]));
  });
});
