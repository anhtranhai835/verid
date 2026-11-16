import { describe, expect, it } from "vitest";
import { claimTaskSession, effectiveOrder, taskSessionProblem } from "../../src/core/kanban.js";
import { parseManifest } from "../../src/core/manifest.js";
import { parseState, type State } from "../../src/core/state.js";
import { orderedModules } from "../../src/adapters/plan-file.js";

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

it("AC-20, AC-21, AC-25, AC-26: plan order pins current work and keeps product last", () => {
  const modules = ["a", "b", "c", "product"].map((name) => ({ name }));
  for (const [building, served, expected] of [
    [null, [], ["a", "b", "c", "product"]],
    ["b", [], ["b", "a", "c", "product"]],
    ["b", ["b"], ["a", "b", "c", "product"]],
  ] as const)
    expect(effectiveOrder(modules, new Set(served), building)).toEqual(expected);
});

it("AC-23: old task state still parses but its queue cannot change plan order", () => {
  const modules = ["a", "b", "c", "product"].map((name) => ({ name }));
  for (const queue of [undefined, [], ["product", "c", "b", "unknown", "b"]]) {
    const parsed = parseState(
      JSON.stringify({ schemaVersion: 1, kanban: { queue, active: null, sessions: {} } }),
    );
    expect(parsed).toMatchObject({ ok: true, state: { kanban: { queue: queue ?? [] } } });
    if (!parsed.ok) throw new Error("fixture state invalid");
    expect(orderedModules(modules, parsed.state)).toEqual(modules);
  }
});
