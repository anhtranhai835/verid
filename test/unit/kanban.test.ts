import { describe, expect, it } from "vitest";
import {
  claimTaskSession,
  effectiveOrder,
  moveInQueue,
  planFromSpec,
  taskSessionProblem,
} from "../../src/core/kanban.js";
import { parseManifest } from "../../src/core/manifest.js";
import { moduleProblem, parsePlan } from "../../src/core/plan.js";
import { specTrace } from "../../src/core/spec.js";
import { parseState, type State } from "../../src/core/state.js";

describe("spec to task plan", () => {
  it("AC-18: every generated module, including product, links its dossier", () => {
    const plan = parsePlan(planFromSpec("- REQ-1: Sign in\n"));
    if (!plan.ok) throw new Error(plan.detail);
    for (const module of plan.modules)
      expect(module.text).toContain(`Artifacts: .verid/artifacts/03-modules/${module.name}`);
  });
  it("creates traceable tasks with unique ACs and a final product task", () => {
    const spec =
      "- REQ-2: Sign in with valid credentials\n- NFR-1: Respond within 200ms\n- SEC-1: Do not leak credentials\n- REQ-9: Retired\n  Dropped in v2\nDropped twice must not remove SEC-1\n";
    const output = planFromSpec(spec);
    const parsed = parsePlan(output);
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(parsed.modules.map((item) => item.name)).toEqual(["req-2", "nfr-1", "sec-1", "product"]);
    expect(parsed.modules.map(moduleProblem)).toEqual([null, null, null, null]);
    expect(parsed.modules.at(-1)?.depends).toEqual(["req-2", "nfr-1", "sec-1"]);
    expect(parsed.modules.at(-1)?.e2e).toEqual(["AC-4"]);
    expect(specTrace(spec, output)).toEqual({ uncovered: [], unknown: [] });
  });

  it("refuses empty requirements, duplicate IDs and unresolved clarifications", () => {
    expect(() => planFromSpec("# Spec")).toThrow("REQ-1");
    expect(() => planFromSpec("- REQ-1: A\n- REQ-1: B")).toThrow("Duplicate requirement");
    expect(() => planFromSpec("- REQ-1: [NEEDS CLARIFICATION]")).toThrow("CLARIFICATION");
  });
});

describe("one task per session", () => {
  const selected = (): State["kanban"] => ({
    queue: [],
    active: { module: "first", session: null, spec_sha256: "spec" },
    sessions: {},
  });
  it("binds a selected task once, preserves resume and refuses a concurrent session", () => {
    const bound = claimTaskSession(selected(), "codex:one");
    expect(bound.active?.session).toBe("codex:one");
    expect(claimTaskSession(bound, "codex:one")).toBe(bound);
    expect(claimTaskSession(bound, "codex:two").active?.session).toBe("codex:one");
    expect(taskSessionProblem(bound, "codex:one", "spec")).toBeNull();
    expect(taskSessionProblem(bound, "codex:two", "spec")).toEqual({
      key: "task_session.other_session",
      module: "first",
    });
    expect(taskSessionProblem(bound, "codex:one", "changed")?.key).toBe(
      "task_session.spec_changed",
    );
    expect(taskSessionProblem({ ...bound, active: null }, "codex:one", "spec")?.key).toBe(
      "task_session.none",
    );
  });
  it("never reuses a planning session, prior task session, or an unbound resumed conversation", () => {
    const planning = claimTaskSession(
      { active: null, sessions: {}, queue: [] },
      "claude-code:plan",
    );
    const next = { ...selected(), sessions: planning.sessions };
    expect(claimTaskSession(next, "claude-code:plan").active?.session).toBeNull();
    const prior = claimTaskSession(selected(), "codex:one");
    const second = {
      ...selected(),
      active: { module: "second", session: null, spec_sha256: "spec" },
      sessions: prior.sessions,
    };
    expect(claimTaskSession(second, "codex:one").active?.session).toBeNull();
    expect(claimTaskSession(second, "codex:resume", false).active?.session).toBeNull();
    expect(claimTaskSession(second, "codex:new").active?.module).toBe("second");
  });
  it("retains ownership after state is persisted and rejects malformed task state", () => {
    const kanban = claimTaskSession(selected(), "codex:one");
    const parsed = parseState(JSON.stringify({ schemaVersion: 1, kanban }));
    expect(parsed).toMatchObject({ ok: true, state: { kanban } });
    expect(
      parseState(JSON.stringify({ schemaVersion: 1, kanban: { active: {}, sessions: {} } })).ok,
    ).toBe(false);
  });
});

it("requires human task selection in prep or recipe mode", () => {
  const input = {
    schemaVersion: 1,
    workflow: "kanban",
    mode: "prep",
    repos: [{ path: ".", source_globs: ["src/**"], test_globs: ["test/**"] }],
  };
  expect(parseManifest(input).ok).toBe(true);
  expect(parseManifest({ ...input, mode: "remix" }).ok).toBe(true);
  expect(parseManifest({ ...input, drive: "auto" }).ok).toBe(false);
});

it("AC-20, AC-21, AC-25, AC-26: priority order pins current work and keeps product last", () => {
  const modules = ["a", "b", "c", "product"].map((name) => ({ name }));
  expect(effectiveOrder([], modules)).toEqual(["a", "b", "c", "product"]);
  expect(effectiveOrder(["product", "unknown", "b", "b", "a"], modules)).toEqual([
    "b",
    "a",
    "c",
    "product",
  ]);
  expect(effectiveOrder(["a", "c", "b"], modules, new Set(), "b")).toEqual([
    "b",
    "a",
    "c",
    "product",
  ]);
  expect(moveInQueue(["a", "b", "product"], "b", "up")).toEqual(["b", "a", "product"]);
  expect(moveInQueue(["a", "b", "product"], "b", "down")).toEqual(["a", "b", "product"]);
  expect(moveInQueue(["a", "b", "product"], "a", "up")).toEqual(["a", "b", "product"]);
});

it("AC-23: old task state defaults to an empty queue", () => {
  expect(
    parseState(JSON.stringify({ schemaVersion: 1, kanban: { active: null, sessions: {} } })),
  ).toMatchObject({ ok: true, state: { kanban: { queue: [] } } });
});
