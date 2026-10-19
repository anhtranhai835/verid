import { describe, expect, it } from "vitest";
import type { Action } from "../../src/core/policy.js";
import {
  classify,
  decideTdd,
  transition,
  type TddLayout,
  type TddState,
  type TestCase,
} from "../../src/core/tdd.js";

const pass = (id: string): TestCase => ({ id, status: "passed", message: "" });
const fail = (id: string): TestCase => ({ id, status: "failed", message: `${id} broke` });
const skip = (id: string): TestCase => ({ id, status: "skipped", message: "" });

describe("classify: only a run whose exit code and JUnit agree is evidence", () => {
  it.each([
    ["no JUnit report", 1, null, { kind: "invalid", code: "VERID_E_RUN_NO_JUNIT" }],
    ["an empty report", 0, [], { kind: "invalid", code: "VERID_E_RUN_NO_TESTS" }],
    ["only skipped tests", 0, [skip("s")], { kind: "invalid", code: "VERID_E_RUN_NO_TESTS" }],
    ["all passing, exit 0", 0, [pass("a"), skip("s")], { kind: "pass", passed: 1, skipped: 1 }],
    [
      "a failure, exit 1",
      1,
      [pass("a"), fail("b")],
      { kind: "fail", failing: [fail("b")], passed: 1, skipped: 0 },
    ],
    [
      "a failure, killed (exit null)",
      null,
      [fail("b")],
      { kind: "fail", failing: [fail("b")], passed: 0, skipped: 0 },
    ],
    [
      "a failure but exit 0",
      0,
      [fail("b")],
      { kind: "invalid", code: "VERID_E_RUN_EXIT_MISMATCH" },
    ],
    [
      "all passing but exit 1",
      1,
      [pass("a")],
      { kind: "invalid", code: "VERID_E_RUN_EXIT_MISMATCH" },
    ],
    [
      "all passing but killed",
      null,
      [pass("a")],
      { kind: "invalid", code: "VERID_E_RUN_EXIT_MISMATCH" },
    ],
  ] as const)("%s", (_name, exit, cases, expected) => {
    expect(classify(exit, cases === null ? null : [...cases])).toEqual(expected);
  });
});

describe("transition: the superpowers RED-GREEN-REFACTOR cycle", () => {
  it.each([
    ["RED", "fail", "GREEN"], // verify RED: watched it fail
    ["RED", "pass", "RED"], // test passes immediately: proves nothing
    ["GREEN", "fail", "GREEN"],
    ["GREEN", "pass", "REFACTOR"], // verify GREEN
    ["REFACTOR", "pass", "REFACTOR"], // stay green
    ["REFACTOR", "fail", "GREEN"], // the refactor broke something
  ] as const)("%s + %s → %s", (from, verdict, to) => {
    expect(transition(from, verdict)).toBe(to);
  });
});

describe("decideTdd", () => {
  // Paths arrive normalized by the adapter: absolute, lowercase on win32.
  const win: TddLayout = {
    repoRoot: "c:\\proj",
    sourceGlobs: ["src/**"],
    testGlobs: ["test/**", "**/*.test.ts"],
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

  it.each([
    ["RED", write("c:\\proj\\src\\a.ts"), "VERID_E_TDD_NO_FAILING_TEST"],
    ["RED", file("Edit", "write", "c:\\proj\\src\\deep\\b.ts"), "VERID_E_TDD_NO_FAILING_TEST"],
    ["RED", write("c:\\proj\\SRC\\a.ts"), "VERID_E_TDD_NO_FAILING_TEST"],
    ["RED", write("c:\\proj\\test\\a.test.ts"), "allow"],
    ["RED", write("c:\\proj\\src\\a.test.ts"), "allow"], // colocated: test globs win
    ["RED", write("c:\\proj\\docs\\notes.md"), "allow"], // neither source nor test
    ["RED", file("Read", "read", "c:\\proj\\src\\a.ts"), "allow"],
    ["RED", write("c:\\other\\src\\a.ts"), "allow"], // outside the repo
    ["RED", write("c:\\proj2\\src\\a.ts"), "allow"], // same prefix, other dir
    ["GREEN", write("c:\\proj\\src\\a.ts"), "allow"],
    ["GREEN", write("c:\\proj\\test\\a.test.ts"), "reopen"], // fix the code, not the test
    ["GREEN", write("c:\\proj\\docs\\notes.md"), "allow"],
    ["REFACTOR", write("c:\\proj\\src\\a.ts"), "allow"],
    ["REFACTOR", write("c:\\proj\\src\\a.test.ts"), "reopen"], // the next test starts a new cycle
  ] as const)("%s, %o → %s", (state, action, expected) => {
    const d = decideTdd(action, state as TddState, win);
    expect(d.kind === "deny" ? d.code : d.kind).toBe(expected);
  });

  it("works on POSIX paths too", () => {
    expect(decideTdd(write("/home/u/proj/src/a.ts"), "RED", posix)).toMatchObject({
      kind: "deny",
      code: "VERID_E_TDD_NO_FAILING_TEST",
      target: "/home/u/proj/src/a.ts",
    });
    expect(decideTdd(write("/home/u/proj/test/a.ts"), "GREEN", posix).kind).toBe("reopen");
  });

  it("leaves Bash and other tools to the Phase 0 rules", () => {
    expect(decideTdd({ kind: "bash", command: "echo x > src/a.ts" }, "RED", win).kind).toBe(
      "allow",
    );
    expect(decideTdd({ kind: "other", tool: "WebFetch" }, "RED", win).kind).toBe("allow");
  });
});
