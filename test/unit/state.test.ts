import { describe, expect, it } from "vitest";
import { FRESH_AUTO, parseState } from "../../src/core/state.js";

describe("parseState", () => {
  it("fills defaults so a hand-made bootstrap file works", () => {
    expect(parseState('{"schemaVersion":1}')).toEqual({
      ok: true,
      state: {
        schemaVersion: 1,
        counters: { blocked_actions: 0 },
        last_denied: null,
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
        auto: {
          signed: null,
          plan_sha256: null,
          plan_reviews: 0,
          coder_rounds: {},
          module_reviews: 0,
          security_reviews: 0,
          stop_holds: 0,
          progress: null,
          blocked: null,
          work: null,
        },
        architecture: {},
      },
    });
  });

  it("gives old state the auto defaults, and an old review the fail verdict", () => {
    const old = parseState(
      JSON.stringify({
        schemaVersion: 1,
        review: {
          module: "calc",
          agent_type: "verid:reviewer",
          file: "r.md",
          sha256: "x",
          at: "t",
        },
      }),
    );
    if (!old.ok) throw new Error(old.code);
    expect({ auto: old.state.auto, verdict: old.state.review?.verdict }).toEqual({
      auto: {
        signed: null,
        plan_sha256: null,
        plan_reviews: 0,
        coder_rounds: {},
        module_reviews: 0,
        security_reviews: 0,
        stop_holds: 0,
        progress: null,
        blocked: null,
        work: null,
      },
      verdict: "fail",
    });
  });

  it("reads a signature made before signing recorded git as signed outside git", () => {
    const old = parseState(
      JSON.stringify({
        schemaVersion: 1,
        auto: { signed: { research_sha256: "r", design_sha256: "d", at: "t" } },
      }),
    );
    if (!old.ok) throw new Error(old.code);
    expect(old.state.auto.signed).toEqual({
      research_sha256: "r",
      design_sha256: "d",
      at: "t",
      git: false,
    });
  });

  it("reads approved and served modules, and a recorded baseline", () => {
    const modules = {
      auth: { sha256: "a", acs: ["AC-1"], at: "t", served_at: "t2", design_sha256: "d" },
      ui: { sha256: "b", acs: [], at: "t" },
    };
    expect(
      parseState(JSON.stringify({ schemaVersion: 1, modules, ac_stop_session: "s1" })),
    ).toMatchObject({
      ok: true,
      state: {
        modules: {
          auth: modules.auth,
          ui: { ...modules.ui, served_at: null, design_sha256: null },
        },
      },
    });
    expect(parseState('{"schemaVersion":1,"baseline":["x\\ny"]}')).toMatchObject({
      ok: true,
      state: { baseline: ["x\ny"] },
    });
    const review = { module: "calc", agent_type: "r", file: "f.md", sha256: "h", at: "t" };
    expect(parseState(JSON.stringify({ schemaVersion: 1, review, writers: ["a1"] }))).toMatchObject(
      { ok: true, state: { review, writers: ["a1"] } },
    );
  });

  it("keeps where each module's work began, auto's open work and the work a review read", () => {
    const work = { ".": { main: "main", base: "a".repeat(40) } };
    const parsed = parseState(
      JSON.stringify({
        schemaVersion: 1,
        modules: {
          calc: { sha256: "a", acs: [], at: "t", work },
          outside: { sha256: "b", acs: [], at: "t", work: {} },
          legacy: { sha256: "c", acs: [], at: "t" },
        },
        review: {
          module: "calc",
          agent_type: "r",
          file: "f",
          sha256: "h",
          at: "t",
          identity: "w1",
        },
        security: { module: "calc", agent_type: "s", file: "f", sha256: "h", at: "t" },
        auto: { work: { module: "calc", roots: work } },
      }),
    );
    const state = parsed.ok ? parsed.state : null;
    expect({
      bases: state?.modules.calc?.work,
      "outside git": state?.modules.outside?.work,
      legacy: state?.modules.legacy?.work,
      identity: state?.review?.identity,
      "no identity": state?.security?.identity,
      auto: state?.auto.work,
      "fresh auto": parseState('{"schemaVersion":1}').ok && FRESH_AUTO.work,
      "bad base": parseState(
        JSON.stringify({
          schemaVersion: 1,
          auto: { work: { module: "calc", roots: { ".": { main: "main" } } } },
        }),
      ).ok,
    }).toEqual({
      bases: work,
      "outside git": {},
      legacy: undefined,
      identity: "w1",
      "no identity": null,
      auto: { module: "calc", roots: work },
      "fresh auto": null,
      "bad base": false,
    });
  });

  // Broken state fails closed: every tool call is then blocked until the developer looks at it.
  it("rejects state that is broken, from the future, or not what verid wrote", () => {
    const rows: [string, string, string][] = [
      ["not JSON", "{nope", "VERID_BURNT_STATE_CORRUPT"],
      ["an array", "[]", "VERID_BURNT_STATE_CORRUPT"],
      ["null", "null", "VERID_BURNT_STATE_CORRUPT"],
      ["no schemaVersion", "{}", "VERID_BURNT_STATE_VERSION"],
      ["future schemaVersion", '{"schemaVersion":2}', "VERID_BURNT_STATE_VERSION"],
      ["unknown top-level field", '{"schemaVersion":1,"x":1}', "VERID_BURNT_STATE_CORRUPT"],
      [
        "negative counter",
        '{"schemaVersion":1,"counters":{"blocked_actions":-1}}',
        "VERID_BURNT_STATE_CORRUPT",
      ],
      [
        "fractional counter",
        '{"schemaVersion":1,"counters":{"blocked_actions":1.5}}',
        "VERID_BURNT_STATE_CORRUPT",
      ],
      [
        "unknown rule in last_denied",
        '{"schemaVersion":1,"last_denied":{"session":"s","tool":"Write","target":"t","input_hash":"h","rule":"NOPE","at":"t"}}',
        "VERID_BURNT_STATE_CORRUPT",
      ],
      [
        "override without used flag",
        '{"schemaVersion":1,"overrides":[{"session":"s","rule":"VERID_BURNT_MANIFEST_PROTECTED","tool":"Write","target":"t","input_hash":"h","reason":"r","created_at":"t"}]}',
        "VERID_BURNT_STATE_CORRUPT",
      ],
      [
        "unknown TDD state",
        '{"schemaVersion":1,"tdd":{"state":"BLUE","last_run":null}}',
        "VERID_BURNT_STATE_CORRUPT",
      ],
      [
        "negative TDD revision",
        '{"schemaVersion":1,"tdd":{"state":"RAW","last_run":null,"failing":[],"rev":-1}}',
        "VERID_BURNT_STATE_CORRUPT",
      ],
      [
        "a non-string baseline entry",
        '{"schemaVersion":1,"baseline":[1]}',
        "VERID_BURNT_STATE_CORRUPT",
      ],
      [
        "a module approval without its hash",
        '{"schemaVersion":1,"modules":{"a":{"acs":[],"at":"t"}}}',
        "VERID_BURNT_STATE_CORRUPT",
      ],
      [
        "a review without its hash",
        '{"schemaVersion":1,"review":{"module":"calc","agent_type":"r","file":"f.md","at":"t"}}',
        "VERID_BURNT_STATE_CORRUPT",
      ],
      [
        "a non-string passed AC",
        '{"schemaVersion":1,"tdd":{"state":"RAW","last_run":null,"passed_acs":[1]}}',
        "VERID_BURNT_STATE_CORRUPT",
      ],
      [
        "an architecture result with an unknown status",
        '{"schemaVersion":1,"architecture":{"api":{"snapshot":"s","status":"ok","run":"r","log":"l","at":"t"}}}',
        "VERID_BURNT_STATE_CORRUPT",
      ],
    ];
    expect(Object.fromEntries(rows.map(([name, raw]) => [name, parseState(raw)]))).toEqual(
      Object.fromEntries(rows.map(([name, , code]) => [name, { ok: false, code }])),
    );
  });
});

// A project set up before the renames has `VERID_E_` rule codes and RED, GREEN and REFACTOR on
// disk; without the upgrade every such project would be locked by STATE_CORRUPT.
describe("parseState on state written before the renames", () => {
  const where = { session: "s", tool: "Write", target: "t", input_hash: "h" };
  const fields = (rule: string) => ({
    last_denied: { last_denied: { ...where, rule, at: "t" } },
    pending_override: {
      pending_override: { ...where, rule, code: "c", reason: "r", created_at: "t" },
    },
    overrides: { overrides: [{ ...where, rule, reason: "r", created_at: "t", used: false }] },
  });
  const read = (field: object) => parseState(JSON.stringify({ schemaVersion: 1, ...field }));
  const corrupt = { ok: false, code: "VERID_BURNT_STATE_CORRUPT" };

  it("reads an old VERID_E_ rule code as its VERID_BURNT_ code, wherever it is stored", () => {
    const old = fields("VERID_E_TDD_NO_FAILING_TEST");
    const rule = "VERID_BURNT_TDD_NO_FAILING_TEST";
    expect(read(old.last_denied)).toMatchObject({ ok: true, state: { last_denied: { rule } } });
    expect(read(old.pending_override)).toMatchObject({
      ok: true,
      state: { pending_override: { rule } },
    });
    expect(read(old.overrides)).toMatchObject({ ok: true, state: { overrides: [{ rule }] } });
  });

  it("still rejects an old-prefix rule that does not exist, wherever it is stored", () => {
    const bad = fields("VERID_E_NOPE");
    expect([read(bad.last_denied), read(bad.pending_override), read(bad.overrides)]).toEqual([
      corrupt,
      corrupt,
      corrupt,
    ]);
  });

  it("reads a 0.1.0-beta.1 plan approval as the module main", () => {
    expect(read({ plan: { sha256: "h", acs: ["AC-1"], at: "t" } })).toMatchObject({
      ok: true,
      state: { modules: { main: { sha256: "h", acs: ["AC-1"], at: "t", served_at: null } } },
    });
    expect(read({ plan: null })).toMatchObject({ ok: true, state: { modules: {} } });
    expect(read({ plan: { acs: [] } })).toEqual(corrupt);
  });

  it("reads RED, GREEN and REFACTOR as RAW, COOKING and PLATED, and nothing else", () => {
    const tdd = (state: unknown) => read({ tdd: { state, last_run: null } });
    expect([tdd("RED"), tdd("GREEN"), tdd("REFACTOR")]).toMatchObject([
      { ok: true, state: { tdd: { state: "RAW" } } },
      { ok: true, state: { tdd: { state: "COOKING" } } },
      { ok: true, state: { tdd: { state: "PLATED" } } },
    ]);
    expect([tdd("red"), tdd(1), tdd(null)]).toEqual([corrupt, corrupt, corrupt]);
  });
});
