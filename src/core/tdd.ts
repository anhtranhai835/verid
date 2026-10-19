import type { PolicyDecision } from "./errors.js";
import { matchesGlob } from "./glob.js";
import type { Action } from "./policy.js";

/**
 * The RED-GREEN-REFACTOR cycle of superpowers:test-driven-development, enforced:
 *   RED       production code locked until `verid test` records a failing test
 *   GREEN     write the minimum code; changing a test sends the cycle back to RED
 *   REFACTOR  all tests pass; the next test write starts a new cycle in RED
 */
export const TDD_STATES = ["RED", "GREEN", "REFACTOR"] as const;
export type TddState = (typeof TDD_STATES)[number];

export interface TestCase {
  /** `<classname> > <name>`, or just the name when the classname is empty or the same. */
  id: string;
  status: "passed" | "failed" | "skipped";
  /** Failure text; empty unless failed. */
  message: string;
}

export type InvalidRunCode =
  "VERID_E_RUN_NO_JUNIT" | "VERID_E_RUN_NO_TESTS" | "VERID_E_RUN_EXIT_MISMATCH";

export type RunVerdict =
  | { kind: "pass"; passed: number; skipped: number }
  | { kind: "fail"; failing: TestCase[]; passed: number; skipped: number }
  | { kind: "invalid"; code: InvalidRunCode };

/**
 * A run is evidence only when the exit code and the JUnit report agree. `<error>` counts as
 * a failure: in pytest a missing module under test is a collection error, and production
 * code is locked in RED, so treating it otherwise would leave no way out.
 */
export function classify(exitCode: number | null, cases: TestCase[] | null): RunVerdict {
  if (cases === null) return { kind: "invalid", code: "VERID_E_RUN_NO_JUNIT" };
  const skipped = cases.filter((c) => c.status === "skipped").length;
  if (skipped === cases.length) return { kind: "invalid", code: "VERID_E_RUN_NO_TESTS" };
  const failing = cases.filter((c) => c.status === "failed");
  const passed = cases.length - skipped - failing.length;
  if (failing.length > 0 !== (exitCode !== 0))
    return { kind: "invalid", code: "VERID_E_RUN_EXIT_MISMATCH" };
  return failing.length > 0
    ? { kind: "fail", failing, passed, skipped }
    : { kind: "pass", passed, skipped };
}

/** A failing run always means "make it pass"; a passing run in RED proves nothing. */
export function transition(state: TddState, verdict: "pass" | "fail"): TddState {
  if (verdict === "fail") return "GREEN";
  return state === "RED" ? "RED" : "REFACTOR";
}

/** Where the repo is and which of its paths are production code and tests. */
export interface TddLayout {
  /** Normalized like action paths. */
  repoRoot: string;
  sourceGlobs: string[];
  testGlobs: string[];
}

export type TddDecision = PolicyDecision | { kind: "reopen"; reason: string };

/**
 * Gate for file writes. `reopen` allows the write and sends the cycle back to RED: a test
 * changed after it was watched failing, so it must be watched failing again. A path matching
 * both globs counts as a test.
 */
export function decideTdd(action: Action, state: TddState, layout: TddLayout): TddDecision {
  if (action.kind !== "file" || action.access !== "write")
    return { kind: "allow", reason: "not a file write" };
  const rel = relativeTo(action.path, layout.repoRoot);
  if (rel === null) return { kind: "allow", reason: "outside the repo" };
  if (layout.testGlobs.some((g) => matchesGlob(rel, g)))
    return state === "RED"
      ? { kind: "allow", reason: "test write in RED" }
      : { kind: "reopen", reason: `test changed in ${state}` };
  if (state === "RED" && layout.sourceGlobs.some((g) => matchesGlob(rel, g)))
    return {
      kind: "deny",
      code: "VERID_E_TDD_NO_FAILING_TEST",
      target: action.display,
      reason: "production code before a failing test",
    };
  return { kind: "allow", reason: `${state} allows this write` };
}

/** Repo-relative path with `/` separators, or null when `path` is not inside `root`. */
function relativeTo(path: string, root: string): string | null {
  const base = root.replace(/[\\/]+$/, "");
  if (!path.startsWith(base)) return null;
  const rest = path.slice(base.length);
  if (rest !== "" && rest[0] !== "/" && rest[0] !== "\\") return null;
  return rest.replace(/^[\\/]+/, "").replaceAll("\\", "/");
}
