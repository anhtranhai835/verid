import { describe, expect, it } from "vitest";
import { kitchenOf, type KitchenInput } from "../../src/core/kitchen.js";
import type { AutoPhase } from "../../src/core/auto.js";
import type { ModuleView } from "../../src/core/plan.js";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const view = (phase: ModuleView["phase"]): ModuleView => ({
  name: "req-1",
  phase,
  acs: ["AC-1"],
  uncovered: [],
  designChanged: false,
  servedAt: null,
});
const input = (over: Partial<KitchenInput> = {}): KitchenInput => ({
  phase: { kind: "module", view: view("cooking") },
  tdd: "RAW",
  research: true,
  design: true,
  halted: null,
  denied: null,
  tasks: [],
  now: NOW,
  ...over,
});

describe("kitchen roles follow the real run", () => {
  it.each<[string, Partial<KitchenInput>, string]>([
    [
      "research not written: head chef",
      { phase: { kind: "unsigned" }, research: false },
      "head_chef",
    ],
    ["design not written: sous chef", { phase: { kind: "unsigned" }, design: false }, "sous_chef"],
    ["both written, unsigned: the waiter asks", { phase: { kind: "unsigned" } }, "waiter"],
    [
      "plan being written: head chef",
      { phase: { kind: "plan", missing: true, problem: null } },
      "head_chef",
    ],
    ["RAW: the taster writes a failing test", { tdd: "RAW" }, "taster"],
    ["COOKING: the cook makes it pass", { tdd: "COOKING" }, "cook"],
    ["PLATED with ACs left: the taster again", { tdd: "PLATED" }, "taster"],
    [
      "evaluating: the inspector reviews",
      { phase: { kind: "module", view: view("evaluating") } },
      "inspector",
    ],
    [
      "stuck: the waiter",
      { phase: { kind: "stuck", reason: "blocked", detail: "Which DB?" } },
      "waiter",
    ],
    ["halted: the waiter", { halted: "lunch" }, "waiter"],
    ["all served: the waiter", { phase: { kind: "done" } }, "waiter"],
  ])("%s", (_name, over, role) => {
    expect(kitchenOf(input(over)).role).toBe(role);
  });

  it("puts each task on the pass by its real state", () => {
    const tasks = [
      { id: "a", title: "A", column: "done", selected: false },
      { id: "b", title: "B", column: "progress", selected: true },
      { id: "c", title: "C", column: "backlog", selected: false },
    ];
    expect(kitchenOf(input({ tdd: "COOKING", tasks })).pass).toEqual([
      { id: "a", title: "A", station: "served" },
      { id: "b", title: "B", station: "COOKING" },
      { id: "c", title: "C", station: "order" },
    ]);
  });
});

describe("the waiter speaks only when the user is needed", () => {
  it("says nothing while the kitchen works", () => {
    expect(kitchenOf(input()).waiter).toBeNull();
  });

  it("explains a recent hook denial in plain words, with its code", () => {
    const denied = { rule: "VERID_BURNT_TDD_NO_FAILING_TEST", at: "2026-11-11T11:58:00Z" } as const;
    expect(kitchenOf(input({ denied })).waiter).toEqual({
      kind: "deny_tdd",
      params: { code: "VERID_BURNT_TDD_NO_FAILING_TEST" },
    });
    const guard = { rule: "VERID_BURNT_SECRET_PROTECTED", at: "2026-11-11T11:58:00Z" } as const;
    expect(kitchenOf(input({ denied: guard })).waiter?.kind).toBe("deny_guard");
    const plan = { rule: "VERID_BURNT_PLAN_NO_DESIGN", at: "2026-11-11T11:58:00Z" } as const;
    expect(kitchenOf(input({ denied: plan })).waiter?.kind).toBe("deny_plan");
    const role = { rule: "VERID_BURNT_ROLE_CODER_ONLY", at: "2026-11-11T11:58:00Z" } as const;
    expect(kitchenOf(input({ denied: role })).waiter?.kind).toBe("deny_role");
  });

  it("forgets a denial the kitchen has long moved past", () => {
    const denied = { rule: "VERID_BURNT_TDD_NO_FAILING_TEST", at: "2026-11-11T10:00:00Z" } as const;
    expect(kitchenOf(input({ denied })).waiter).toBeNull();
  });

  it("brings the agent's question, repeated failed reviews and the signature to the user", () => {
    const blocked: AutoPhase = { kind: "stuck", reason: "blocked", detail: "Which DB?" };
    expect(kitchenOf(input({ phase: blocked })).waiter).toEqual({
      kind: "question",
      params: { detail: "Which DB?" },
    });
    const reviews: AutoPhase = { kind: "stuck", reason: "module_reviews", detail: "3" };
    expect(kitchenOf(input({ phase: reviews })).waiter).toEqual({
      kind: "reviews",
      params: { detail: "3" },
    });
    expect(kitchenOf(input({ phase: { kind: "unsigned" } })).waiter?.kind).toBe("sign");
    expect(kitchenOf(input({ halted: "lunch" })).waiter).toEqual({
      kind: "halted",
      params: { detail: "lunch" },
    });
  });
});
