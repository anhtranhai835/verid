import type { MessageKey, PolicyDecision } from "./errors.js";
import { matchesGlob } from "./glob.js";
import type { Action } from "./policy.js";
import { decideRole, type Writer } from "./roles.js";

/**
 * The RED-GREEN-REFACTOR cycle of superpowers:test-driven-development, enforced under other names:
 *   RAW      (RED)       production code locked until `verid taste` records a new failure on an
 *                        assertion; a new test that cannot load opens the stub step (RAW · stub)
 *   COOKING  (GREEN)     write the minimum code; changing a test sends the cycle back to RAW
 *   PLATED   (REFACTOR)  all tests pass; the next test write starts a new cycle in RAW
 */
export const TDD_STATES = ["RAW", "COOKING", "PLATED"] as const;
export type TddState = (typeof TDD_STATES)[number];

export interface TestCase {
  /** `<classname> > <name>`, or just the name when the classname is empty or the same. */
  id: string;
  status: "passed" | "failed" | "skipped";
  /** Failure text; empty unless failed. */
  message: string;
  /**
   * For a failure: false when the test could not load or crashed rather than failing an
   * assertion; unset when unknown, which counts as an assertion.
   */
  assertion?: boolean;
}

// The names assertion libraries give their failures (Testing Library's "element not found" too).
const ASSERTION_NAME =
  /Assert|ComparisonFailure|Expectation|TestingLibraryElementError|^Xunit\.Sdk\./;
// A name leading the message, as `TypeError: …` or `json.decoder.JSONDecodeError: …`.
const LEADING_NAME = /^\s*([A-Za-z_$][\w.$]*)\s*:/;
// A crash names an error, and does it in its last segment: `TypeError`, `java.lang.Npe…Exception`,
// `SystemExit`, `DeprecationWarning`. Any other name (`failure`, `REQUIRE`) is the runner's own.
const CRASH_NAME = /(Error|Exception|Exit|Warning|Interrupt)$/;
const ASSERTION_LINE = /^\s*assert\b|expect\(|Snapshot .* mismatched/;
const LOAD_ERROR = /Cannot find module|ModuleNotFoundError|ImportError/;

/**
 * Whether a failure reached an assertion, read from the report's tag (`<failure>` or `<error>`),
 * its `type` attribute and the first line of its message (later lines quote source code). RED
 * needs one: a test that cannot load or crashes has not shown the behaviour is missing.
 * The name decides first: an assertion library's own, or an error's, which is a crash (a bare
 * `Error` unless the message shows an assertion). Any other name, or none, leaves it to the
 * message, and a shape verid cannot read counts as an assertion, as before.
 */
export function isAssertion(tag: "failure" | "error", type: string, summary: string): boolean {
  if (tag === "error") return false;
  const line = summary.split("\n", 1)[0] ?? "";
  const name = type.trim() || (LEADING_NAME.exec(line)?.[1] ?? "");
  if (ASSERTION_NAME.test(name)) return true;
  const crash = CRASH_NAME.test(name.split(/[.:\\]+/).at(-1) ?? "");
  if (crash && name !== "Error") return false;
  if (ASSERTION_LINE.test(line)) return true;
  return !crash && !LOAD_ERROR.test(line);
}

export type InvalidRunCode =
  | "VERID_BURNT_RUN_NO_JUNIT"
  | "VERID_BURNT_RUN_NO_TESTS"
  | "VERID_BURNT_RUN_EXIT_MISMATCH"
  | "VERID_BURNT_RUN_TIMEOUT"
  | "VERID_BURNT_RUN_STALE";

export type RunVerdict =
  | { kind: "pass"; passed: number; skipped: number }
  | { kind: "fail"; failing: TestCase[]; passed: number; skipped: number }
  | { kind: "invalid"; code: InvalidRunCode };

/**
 * A run is evidence only when the exit code and the JUnit report agree. `<error>` counts as
 * a failure: in pytest a missing module under test is a collection error, which opens the stub
 * step in RAW, so treating it otherwise would leave no way out.
 */
export function classify(exitCode: number | null, cases: TestCase[] | null): RunVerdict {
  if (cases === null) return { kind: "invalid", code: "VERID_BURNT_RUN_NO_JUNIT" };
  const skipped = cases.filter((c) => c.status === "skipped").length;
  if (skipped === cases.length) return { kind: "invalid", code: "VERID_BURNT_RUN_NO_TESTS" };
  const failing = cases.filter((c) => c.status === "failed");
  const passed = cases.length - skipped - failing.length;
  if (failing.length > 0 !== (exitCode !== 0))
    return { kind: "invalid", code: "VERID_BURNT_RUN_EXIT_MISMATCH" };
  return failing.length > 0
    ? { kind: "fail", failing, passed, skipped }
    : { kind: "pass", passed, skipped };
}

/**
 * Identifies a failure across runs: the test and the first line of its message. Later lines
 * hold stack positions, which move whenever the test file is edited.
 */
export function failureKey(c: TestCase): string {
  return `${c.id}\n${(c.message.split("\n")[0] ?? "").trim()}`;
}

/** The test a failureKey() names: the part before the message. */
export const keyId = (key: string): string => key.split("\n", 1)[0] ?? key;

/**
 * Splits a failing run by test name against the failures recorded before verid started.
 * `known` failures are not the agent's to fix; `changed` is the part of `known` whose first
 * message line moved, which the developer should hear about.
 */
export function splitBaseline(
  failing: readonly TestCase[],
  baseline: readonly string[],
): { fresh: TestCase[]; known: TestCase[]; changed: TestCase[] } {
  const ids = new Set(baseline.map(keyId));
  const known = failing.filter((c) => ids.has(c.id));
  return {
    fresh: failing.filter((c) => !ids.has(c.id)),
    known,
    changed: known.filter((c) => !baseline.includes(failureKey(c))),
  };
}

/**
 * A baseline test that passes is fixed for good; skipped or absent ones prove nothing. A test
 * file that failed to load is one entry named after the file, so it also leaves once a passing
 * test inside it (`<file> > ...`) shows the file loads.
 */
export function shrinkBaseline(cases: readonly TestCase[], baseline: readonly string[]): string[] {
  const passed = new Set<string>();
  for (const { id, status } of cases) {
    if (status !== "passed") continue;
    passed.add(id);
    for (let i = id.indexOf(" > "); i >= 0; i = id.indexOf(" > ", i + 1))
      passed.add(id.slice(0, i));
  }
  return baseline.filter((key) => !passed.has(keyId(key)));
}

/** Where the cycle is: the state, and in RAW whether the stub step is open. */
export interface Cycle {
  state: TddState;
  stub: boolean;
}

/** How the cycle is shown: `RAW · stub` while the stub step is open. */
export const cycleLabel = (c: Cycle): string => (c.stub ? "RAW · stub" : c.state);

/** The status message for where the cycle is. */
export const cycleHint = (c: Cycle): MessageKey =>
  c.stub ? "status.stub" : (`status.${c.state.toLowerCase()}` as MessageKey);

/**
 * The failures the last run did not have, and the assertion failures of tests that crashed in it:
 * reaching an assertion is new even where the failure key (pytest's first source line) is not.
 */
export const newFailures = (
  failing: readonly TestCase[],
  lastFailing: readonly string[],
  lastCrashed: readonly string[] = [],
): TestCase[] =>
  failing.filter(
    (c) =>
      !lastFailing.includes(failureKey(c)) || (c.assertion !== false && lastCrashed.includes(c.id)),
  );

/**
 * A failing run means "make it pass", except in RAW: there it must show a new failure that
 * reached an assertion. A test that was already failing proves nothing about the test just
 * written or changed, which may have been weakened until it passes. A new test that cannot load
 * opens the stub step instead: production code may then add what the test needs to run, and the
 * stub stays open while a test still cannot load.
 */
export function transition(
  from: Cycle,
  run: { kind: "pass" } | { kind: "fail"; failing: TestCase[] },
  lastFailing: readonly string[],
  lastCrashed: readonly string[] = [],
): Cycle {
  if (run.kind === "pass") return { state: from.state === "RAW" ? "RAW" : "PLATED", stub: false };
  if (from.state !== "RAW") return { state: "COOKING", stub: false };
  const fresh = newFailures(run.failing, lastFailing, lastCrashed);
  if (fresh.some((c) => c.assertion !== false)) return { state: "COOKING", stub: false };
  const errors = (from.stub ? run.failing : fresh).filter((c) => c.assertion === false);
  return { state: "RAW", stub: errors.length > 0 };
}

/** Where the repo is and which of its paths are production code and tests. */
export interface TddLayout {
  /** The project owns `.verid/`, even when the repo is a subfolder. */
  projectRoot?: string;
  /** Normalized like action paths. */
  repoRoot: string;
  sourceGlobs: string[];
  testGlobs: string[];
  /** Never production code, even inside the source globs: documents, data, generated folders. */
  ignoreGlobs: string[];
  /** End-to-end tests: tests, even outside the test globs. */
  e2eGlobs?: string[];
}

export type TddDecision =
  PolicyDecision | { kind: "code"; reason: string } | { kind: "reopen"; reason: string };

/** Across repo roots and written/resolved paths, keep the strictest decision. Ties keep the first. */
export const TDD_STRICTNESS = { allow: 0, code: 1, reopen: 2, deny: 3 } as const;

/**
 * What a repo-relative path is: a test when it matches a test glob, even if it matches the others
 * too, so runner config among the tests stays frozen; otherwise free when ignored or outside the
 * source globs; otherwise production code.
 */
export function fileRole(
  rel: string,
  layout: Omit<TddLayout, "repoRoot">,
): "test" | "code" | "free" {
  const matches = (globs: string[]) => globs.some((g) => matchesGlob(rel, g));
  if (matches(layout.testGlobs) || isE2eFile(rel, layout)) return "test";
  return matches(layout.ignoreGlobs) || !matches(layout.sourceGlobs) ? "free" : "code";
}

const isE2eFile = (rel: string, layout: Omit<TddLayout, "repoRoot">): boolean =>
  (layout.e2eGlobs ?? []).some((g) => matchesGlob(rel, g));

/**
 * Gate for file writes. `code` allows a write to production code, which no run shows yet.
 * `reopen` allows a test write and sends the cycle back to RAW (or keeps it there): the changed
 * test must be watched failing. In COOKING the tests are frozen: changing a failing test is how an
 * agent fakes a pass, so only production code may make it pass. Production code also waits for
 * an approved plan, in every state and before the RAW check; tests stay writable so the agent
 * can work while the developer reads the plan.
 * With the stub step open, RAW allows production code too, and a test write keeps the stub open.
 * Who writes is judged first, outside the repo too: the role says who, the cycle says when.
 * In an auto drive, a stuck drive locks production code and tests alike (the developer clears it),
 * and production code with no open module is denied as the drive's own wait rather than as a plan
 * the developer has yet to approve.
 */
export function decideTdd(
  action: Action,
  { state, stub }: Cycle,
  layout: TddLayout | readonly TddLayout[],
  planApproved: boolean,
  who: { writer: Writer; split: boolean } = { writer: "main", split: false },
  auto?: { stuck: boolean },
): TddDecision {
  if (Array.isArray(layout)) {
    const matching = layout.filter(
      (repo) => action.kind === "file" && relativeTo(action.path, repo.repoRoot) !== null,
    );
    // Outside every repo, preserve the existing role rules and outside-repo TDD decision.
    const candidates = matching.length ? matching : layout.slice(0, 1);
    const decisions = candidates.map((repo) =>
      decideTdd(action, { state, stub }, repo, planApproved, who, auto),
    );
    return decisions.length
      ? decisions.reduce((a, b) => (TDD_STRICTNESS[b.kind] > TDD_STRICTNESS[a.kind] ? b : a))
      : { kind: "allow", reason: "no repo" };
  }
  return decideRepoTdd(action, { state, stub }, layout as TddLayout, planApproved, who, auto);
}

function decideRepoTdd(
  action: Action,
  { state, stub }: Cycle,
  layout: TddLayout,
  planApproved: boolean,
  who: { writer: Writer; split: boolean },
  auto?: { stuck: boolean },
): TddDecision {
  if (action.kind !== "file" || action.access !== "write")
    return { kind: "allow", reason: "not a file write" };
  const rel = relativeTo(action.path, layout.repoRoot);
  const role = rel === null ? "outside" : fileRole(rel, layout);
  const byRole = decideRole(
    who.writer,
    who.split,
    rel !== null && isE2eFile(rel, layout) ? "e2e" : role,
    action.display,
    relativeTo(action.path, layout.projectRoot ?? layout.repoRoot),
  );
  if (byRole.kind === "deny") return byRole;
  if (role === "outside") return { kind: "allow", reason: "outside the repo" };
  if (auto?.stuck && role !== "free")
    return {
      kind: "deny",
      code: "VERID_BURNT_AUTO_STUCK",
      target: action.display,
      reason: "the auto drive is stuck",
    };
  if (role === "test")
    return state === "COOKING"
      ? {
          kind: "deny",
          code: "VERID_BURNT_TDD_TEST_FROZEN",
          target: action.display,
          reason: "test changed while tests fail",
        }
      : { kind: "reopen", reason: `test changed in ${state}` };
  if (role === "free") return { kind: "allow", reason: "neither production code nor a test" };
  if (!planApproved)
    return {
      kind: "deny",
      code: auto ? "VERID_BURNT_AUTO_NO_MODULE" : "VERID_BURNT_PLAN_NOT_APPROVED",
      target: action.display,
      reason: "production code before the plan is approved",
    };
  if (state === "RAW" && !stub)
    return {
      kind: "deny",
      code: "VERID_BURNT_TDD_NO_FAILING_TEST",
      target: action.display,
      reason: "production code before a failing test",
    };
  return { kind: "code", reason: `${cycleLabel({ state, stub })} allows production code` };
}

/** Repo-relative path with `/` separators, or null when `path` is not inside `root`. */
function relativeTo(path: string, root: string): string | null {
  const base = root.replace(/[\\/]+$/, "");
  if (!path.startsWith(base)) return null;
  const rest = path.slice(base.length);
  if (rest !== "" && rest[0] !== "/" && rest[0] !== "\\") return null;
  return rest.replace(/^[\\/]+/, "").replaceAll("\\", "/");
}

/**
 * The runs of several runners as one verdict, and which runner made it invalid. Each runner's
 * exit code must agree with its own report: one passing run cannot hide another's mismatch. A
 * runner that ran no test yet (a new fe/ folder) is left out, as long as another one ran tests.
 */
export function classifyRuns(
  runs: readonly { exit: number | null; cases: TestCase[] | null; timedOut: boolean }[],
): { verdict: RunVerdict; at: number | null } {
  const counted: TestCase[] = [];
  let failed = false;
  for (const [at, run] of runs.entries()) {
    // A report written before the hang may look complete, but the run never finished.
    if (run.timedOut) return { verdict: { kind: "invalid", code: "VERID_BURNT_RUN_TIMEOUT" }, at };
    const verdict = classify(run.exit, run.cases);
    if (verdict.kind === "invalid" && verdict.code === "VERID_BURNT_RUN_NO_TESTS") continue;
    if (verdict.kind === "invalid") return { verdict, at };
    counted.push(...(run.cases ?? []));
    failed ||= verdict.kind === "fail";
  }
  return { verdict: classify(failed ? 1 : 0, counted), at: null };
}

/**
 * The tests that count as end-to-end: all a Playwright run reports, since its classnames are
 * relative to its testDir, and elsewhere a test whose file matches e2e_globs. The file is the
 * classname, the part of the id before ` > `, with `\` read as `/`; a classname with no `/`
 * names a package (pytest, Java, .NET), whose dots are read as folders.
 */
export function e2eCases(
  runs: readonly { runner: string | null; cases: readonly TestCase[] }[],
  e2eGlobs: readonly string[],
): TestCase[] {
  const inGlobs = (c: TestCase) => {
    const at = c.id.indexOf(" > ");
    if (at < 0) return false;
    const file = c.id.slice(0, at).replaceAll("\\", "/");
    const path = file.includes("/") ? file : file.replaceAll(".", "/");
    return e2eGlobs.some((g) => matchesGlob(path, g));
  };
  return runs.flatMap(({ runner, cases }) =>
    runner === "playwright" ? [...cases] : cases.filter(inGlobs),
  );
}
