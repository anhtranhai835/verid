import { describe, expect, it } from "vitest";
import {
  consumeOverride,
  handlePrompt,
  parseVeridPrompt,
  recordDenial,
  type PromptContext,
} from "../../src/core/override.js";
import type { State } from "../../src/core/state.js";

describe("parseVeridPrompt", () => {
  it.each([
    ["hello", { kind: "none" }],
    ["please /verid allow x", { kind: "none" }],
    ["/verify allow x", { kind: "none" }],
    ["/veridx allow x", { kind: "none" }],
    ["/verid", { kind: "usage" }],
    ["/verid allow", { kind: "usage" }],
    ["/verid allow    ", { kind: "usage" }],
    ["/verid foo", { kind: "usage" }],
    ["/verid confirm", { kind: "usage" }],
    ["/verid confirm a b", { kind: "usage" }],
    ["/verid allow x", { kind: "allow", reason: "x" }],
    ["  /verid allow x  ", { kind: "allow", reason: "x" }],
    [
      '/verid allow sửa manifest vì "test" & lý do dài',
      { kind: "allow", reason: 'sửa manifest vì "test" & lý do dài' },
    ],
    ["/verid confirm K7Q2AB", { kind: "confirm", code: "K7Q2AB" }],
  ])("%j", (prompt, expected) => {
    expect(parseVeridPrompt(prompt)).toEqual(expected);
  });
});

const MANIFEST = "c:\\proj\\.verid\\manifest.yaml";
const denied = {
  session: "s1",
  tool: "Write",
  target: MANIFEST,
  input_hash: "h1",
  rule: "VERID_E_MANIFEST_PROTECTED",
  at: "t0",
} as const;
const base: State = {
  schemaVersion: 1,
  counters: { blocked_actions: 1 },
  last_denied: { ...denied },
  pending_override: null,
  overrides: [],
};
const ctx: PromptContext = {
  session: "s1",
  attended: true,
  agentId: undefined,
  now: "t1",
  newCode: "K7Q2AB",
};
const pending = {
  session: "s1",
  code: "K7Q2AB",
  reason: "x",
  rule: "VERID_E_MANIFEST_PROTECTED",
  tool: "Write",
  target: MANIFEST,
  input_hash: "h1",
  created_at: "t1",
} as const;
const withPending: State = { ...base, pending_override: { ...pending } };

describe("handlePrompt: /verid allow", () => {
  it("shows a risk warning with a confirmation code and creates no override yet", () => {
    const r = handlePrompt(base, { kind: "allow", reason: "x" }, ctx);
    expect(r.outcome).toEqual({
      kind: "block",
      key: "override.risk_warning",
      params: {
        tool: "Write",
        target: MANIFEST,
        rule: "VERID_E_MANIFEST_PROTECTED",
        reason: "x",
        code: "K7Q2AB",
      },
    });
    expect(r.state.pending_override).toEqual(pending);
    expect(r.state.overrides).toEqual([]);
    expect(r.audit).toEqual({
      event: "override_warned",
      session: "s1",
      rule: "VERID_E_MANIFEST_PROTECTED",
      tool: "Write",
      target: MANIFEST,
      reason: "x",
    });
  });

  it.each([
    ["unattended session (nested claude -p)", { ...ctx, attended: false }],
    ["prompt coming from a subagent", { ...ctx, agentId: "a123" }],
  ])("rejects %s", (_name, c) => {
    const r = handlePrompt(base, { kind: "allow", reason: "x" }, c);
    expect(r.outcome).toEqual({ kind: "block", key: "VERID_E_OVERRIDE_UNATTENDED", params: {} });
    expect(r.state).toEqual(base);
  });

  it("rejects when nothing was denied in this session", () => {
    const none = handlePrompt({ ...base, last_denied: null }, { kind: "allow", reason: "x" }, ctx);
    const other = handlePrompt(base, { kind: "allow", reason: "x" }, { ...ctx, session: "s2" });
    for (const r of [none, other]) {
      expect(r.outcome).toEqual({ kind: "block", key: "VERID_E_OVERRIDE_NOTHING", params: {} });
      expect(r.state.pending_override).toBeNull();
    }
  });

  it("refuses non-overridable invariants", () => {
    const s: State = { ...base, last_denied: { ...denied, rule: "VERID_E_STATE_PROTECTED" } };
    const r = handlePrompt(s, { kind: "allow", reason: "x" }, ctx);
    expect(r.outcome).toEqual({
      kind: "block",
      key: "VERID_E_OVERRIDE_FORBIDDEN",
      params: { rule: "VERID_E_STATE_PROTECTED", target: MANIFEST },
    });
    expect(r.state.pending_override).toBeNull();
  });

  it("shows usage for a bare /verid", () => {
    expect(handlePrompt(base, { kind: "usage" }, ctx).outcome).toEqual({
      kind: "block",
      key: "VERID_E_OVERRIDE_USAGE",
      params: {},
    });
  });
});

describe("handlePrompt: /verid confirm", () => {
  it("creates exactly one unused override bound to the denied action", () => {
    const r = handlePrompt(withPending, { kind: "confirm", code: "K7Q2AB" }, ctx);
    expect(r.outcome).toEqual({
      kind: "context",
      key: "override.created",
      params: { tool: "Write", target: MANIFEST },
    });
    expect(r.state.pending_override).toBeNull();
    expect(r.state.overrides).toEqual([
      {
        session: "s1",
        rule: "VERID_E_MANIFEST_PROTECTED",
        tool: "Write",
        target: MANIFEST,
        input_hash: "h1",
        reason: "x",
        created_at: "t1",
        used: false,
      },
    ]);
    expect(r.audit?.event).toBe("override_created");
  });

  it("accepts the code case-insensitively", () => {
    const r = handlePrompt(withPending, { kind: "confirm", code: "k7q2ab" }, ctx);
    expect(r.outcome.kind).toBe("context");
  });

  it("rejects a wrong code and keeps the pending warning", () => {
    const r = handlePrompt(withPending, { kind: "confirm", code: "ZZZZZZ" }, ctx);
    expect(r.outcome).toEqual({ kind: "block", key: "VERID_E_OVERRIDE_BAD_CODE", params: {} });
    expect(r.state).toEqual(withPending);
  });

  it("rejects a confirm whose denied action has since changed", () => {
    const s: State = { ...withPending, last_denied: { ...denied, input_hash: "h2" } };
    const r = handlePrompt(s, { kind: "confirm", code: "K7Q2AB" }, ctx);
    expect(r.outcome).toEqual({ kind: "block", key: "VERID_E_OVERRIDE_STALE", params: {} });
    expect(r.state.pending_override).toBeNull();
    expect(r.state.overrides).toEqual([]);
  });

  it("rejects confirm without a pending warning", () => {
    const r = handlePrompt(base, { kind: "confirm", code: "K7Q2AB" }, ctx);
    expect(r.outcome).toEqual({ kind: "block", key: "VERID_E_OVERRIDE_NOTHING", params: {} });
  });

  it("rejects confirm from an unattended session", () => {
    const r = handlePrompt(
      withPending,
      { kind: "confirm", code: "K7Q2AB" },
      { ...ctx, attended: false },
    );
    expect(r.outcome).toEqual({ kind: "block", key: "VERID_E_OVERRIDE_UNATTENDED", params: {} });
    expect(r.state).toEqual(withPending);
  });
});

describe("recordDenial", () => {
  it("counts the block and remembers the denied action", () => {
    const s = recordDenial(
      { ...base, last_denied: null },
      { ...denied, input_hash: "h9", at: "t5" },
    );
    expect(s.counters.blocked_actions).toBe(2);
    expect(s.last_denied).toEqual({ ...denied, input_hash: "h9", at: "t5" });
  });
});

describe("consumeOverride", () => {
  const ov = {
    session: "s1",
    rule: "VERID_E_MANIFEST_PROTECTED",
    tool: "Write",
    target: MANIFEST,
    input_hash: "h1",
    reason: "x",
    created_at: "t1",
    used: false,
  } as const;
  const s: State = { ...base, overrides: [{ ...ov }] };
  const action = {
    session: "s1",
    tool: "Write",
    input_hash: "h1",
    rule: "VERID_E_MANIFEST_PROTECTED",
  } as const;

  it("uses a matching override exactly once", () => {
    const first = consumeOverride(s, action, "t2");
    expect(first?.overrides).toEqual([{ ...ov, used: true, used_at: "t2" }]);
    expect(consumeOverride(first!, action, "t3")).toBeNull();
  });

  it.each([
    ["different input", { ...action, input_hash: "h2" }],
    ["different tool", { ...action, tool: "Edit" }],
    ["different session", { ...action, session: "s2" }],
  ])("does not apply to a %s", (_name, a) => {
    expect(consumeOverride(s, a, "t2")).toBeNull();
  });
});
