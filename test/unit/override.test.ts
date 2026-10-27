import { describe, expect, it } from "vitest";
import {
  consumeOverride,
  handlePrompt,
  parseVeridPrompt,
  recordDenial,
  type PromptContext,
} from "../../src/core/override.js";
import { FRESH_AUTO, type State } from "../../src/core/state.js";

describe("parseVeridPrompt", () => {
  // One table of prompts; on a failure the diff names the prompt.
  it("reads /verid tip and /verid confirm, and shows usage for anything else after /verid", () => {
    const rows: [string, unknown][] = [
      ["hello", { kind: "none" }],
      ["please /verid tip x", { kind: "none" }],
      ["/verify tip x", { kind: "none" }],
      ["/veridx tip x", { kind: "none" }],
      ["/verid", { kind: "usage" }],
      ["/verid tip", { kind: "usage" }],
      ["/verid tip    ", { kind: "usage" }],
      ["/verid foo", { kind: "usage" }],
      ["/verid confirm", { kind: "usage" }],
      ["/verid confirm a b", { kind: "usage" }],
      ["/verid allow x", { kind: "usage" }], // the name before tip is gone, not an alias
      ["/verid tip x", { kind: "tip", reason: "x" }],
      ["  /verid tip x  ", { kind: "tip", reason: "x" }],
      [
        '/verid tip sửa manifest vì "test" & lý do dài',
        { kind: "tip", reason: 'sửa manifest vì "test" & lý do dài' },
      ],
      ["/verid confirm K7Q2AB", { kind: "confirm", code: "K7Q2AB" }],
    ];
    expect(Object.fromEntries(rows.map(([p]) => [p, parseVeridPrompt(p)]))).toEqual(
      Object.fromEntries(rows),
    );
  });

  it("reads the same commands picked from Claude Code's menu, and peek and menu", () => {
    const rows: [string, unknown][] = [
      ["/verid:tip x", { kind: "tip", reason: "x" }],
      ["/verid:confirm K7Q2AB", { kind: "confirm", code: "K7Q2AB" }],
      ["/verid:peek", { kind: "peek" }],
      ["/verid:menu", { kind: "menu" }],
      ["/verid peek", { kind: "peek" }],
      ["/verid menu", { kind: "menu" }],
      ["/verid:", { kind: "usage" }],
      ["/verid:tip", { kind: "usage" }],
      ["/verid:tipx", { kind: "usage" }],
      ["/verid:peek now", { kind: "usage" }],
      ["/verid:other", { kind: "usage" }],
    ];
    expect(Object.fromEntries(rows.map(([p]) => [p, parseVeridPrompt(p)]))).toEqual(
      Object.fromEntries(rows),
    );
  });
});

const MANIFEST = "c:\\proj\\.verid\\manifest.yaml";
const denied = {
  session: "s1",
  tool: "Write",
  target: MANIFEST,
  input_hash: "h1",
  rule: "VERID_BURNT_MANIFEST_PROTECTED",
  at: "t0",
} as const;
const base: State = {
  schemaVersion: 1,
  counters: { blocked_actions: 1 },
  last_denied: { ...denied },
  pending_override: null,
  overrides: [],
  tdd: {
    state: "RAW",
    last_run: null,
    failing: [],
    rev: 0,
    dirty: false,
    passed_acs: [],
    passed_e2e_acs: [],
    stub: false,
    crashed: [],
  },
  baseline: null,
  modules: {},
  ac_stop_session: null,
  language: null,
  runners: [],
  review: null,
  security: null,
  writers: [],
  auto: FRESH_AUTO,
  architecture: {},
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
  rule: "VERID_BURNT_MANIFEST_PROTECTED",
  tool: "Write",
  target: MANIFEST,
  input_hash: "h1",
  created_at: "t1",
} as const;
const withPending: State = { ...base, pending_override: { ...pending } };

describe("handlePrompt: /verid tip", () => {
  it("shows a risk warning with a confirmation code and creates no override yet", () => {
    const r = handlePrompt(base, { kind: "tip", reason: "x" }, ctx);
    expect(r.outcome).toEqual({
      kind: "block",
      key: "override.risk_warning",
      params: {
        tool: "Write",
        target: MANIFEST,
        rule: "VERID_BURNT_MANIFEST_PROTECTED",
        reason: "x",
        code: "K7Q2AB",
      },
    });
    expect(r.state.pending_override).toEqual(pending);
    expect(r.state.overrides).toEqual([]);
    expect(r.audit).toEqual({
      event: "override_warned",
      session: "s1",
      rule: "VERID_BURNT_MANIFEST_PROTECTED",
      tool: "Write",
      target: MANIFEST,
      reason: "x",
    });
  });

  it("rejects an unattended session (nested claude -p) and a prompt from a subagent", () => {
    for (const c of [
      { ...ctx, attended: false },
      { ...ctx, agentId: "a123" },
    ]) {
      const r = handlePrompt(base, { kind: "tip", reason: "x" }, c);
      expect(r.outcome).toEqual({
        kind: "block",
        key: "VERID_BURNT_OVERRIDE_UNATTENDED",
        params: {},
      });
      expect(r.state).toEqual(base);
    }
  });

  it("rejects when nothing was denied in this session", () => {
    const none = handlePrompt({ ...base, last_denied: null }, { kind: "tip", reason: "x" }, ctx);
    const other = handlePrompt(base, { kind: "tip", reason: "x" }, { ...ctx, session: "s2" });
    for (const r of [none, other]) {
      expect(r.outcome).toEqual({ kind: "block", key: "VERID_BURNT_OVERRIDE_NOTHING", params: {} });
      expect(r.state.pending_override).toBeNull();
    }
  });

  it("refuses non-overridable invariants", () => {
    const s: State = { ...base, last_denied: { ...denied, rule: "VERID_BURNT_STATE_PROTECTED" } };
    const r = handlePrompt(s, { kind: "tip", reason: "x" }, ctx);
    expect(r.outcome).toEqual({
      kind: "block",
      key: "VERID_BURNT_OVERRIDE_FORBIDDEN",
      params: { rule: "VERID_BURNT_STATE_PROTECTED", target: MANIFEST },
    });
    expect(r.state.pending_override).toBeNull();
  });

  it("shows usage for a bare /verid", () => {
    expect(handlePrompt(base, { kind: "usage" }, ctx).outcome).toEqual({
      kind: "block",
      key: "VERID_BURNT_OVERRIDE_USAGE",
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
        rule: "VERID_BURNT_MANIFEST_PROTECTED",
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
    expect(r.outcome).toEqual({ kind: "block", key: "VERID_BURNT_OVERRIDE_BAD_CODE", params: {} });
    expect(r.state).toEqual(withPending);
  });

  it("rejects a confirm whose denied action has since changed", () => {
    const s: State = { ...withPending, last_denied: { ...denied, input_hash: "h2" } };
    const r = handlePrompt(s, { kind: "confirm", code: "K7Q2AB" }, ctx);
    expect(r.outcome).toEqual({ kind: "block", key: "VERID_BURNT_OVERRIDE_STALE", params: {} });
    expect(r.state.pending_override).toBeNull();
    expect(r.state.overrides).toEqual([]);
  });

  it("rejects confirm without a pending warning", () => {
    const r = handlePrompt(base, { kind: "confirm", code: "K7Q2AB" }, ctx);
    expect(r.outcome).toEqual({ kind: "block", key: "VERID_BURNT_OVERRIDE_NOTHING", params: {} });
  });

  it("rejects confirm from an unattended session", () => {
    const r = handlePrompt(
      withPending,
      { kind: "confirm", code: "K7Q2AB" },
      { ...ctx, attended: false },
    );
    expect(r.outcome).toEqual({
      kind: "block",
      key: "VERID_BURNT_OVERRIDE_UNATTENDED",
      params: {},
    });
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
    rule: "VERID_BURNT_MANIFEST_PROTECTED",
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
    rule: "VERID_BURNT_MANIFEST_PROTECTED",
  } as const;

  it("uses a matching override exactly once", () => {
    const first = consumeOverride(s, action, "t2");
    expect(first?.overrides).toEqual([{ ...ov, used: true, used_at: "t2" }]);
    expect(consumeOverride(first!, action, "t3")).toBeNull();
  });

  it("does not apply to a different input, tool or session", () => {
    expect([
      consumeOverride(s, { ...action, input_hash: "h2" }, "t2"),
      consumeOverride(s, { ...action, tool: "Edit" }, "t2"),
      consumeOverride(s, { ...action, session: "s2" }, "t2"),
    ]).toEqual([null, null, null]);
  });
});
