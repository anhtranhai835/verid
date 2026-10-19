import { describe, expect, it } from "vitest";
import { parseState } from "../../src/core/state.js";

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
      },
    });
  });

  it.each([
    ["not JSON", "{nope", "VERID_E_STATE_CORRUPT"],
    ["an array", "[]", "VERID_E_STATE_CORRUPT"],
    ["null", "null", "VERID_E_STATE_CORRUPT"],
    ["no schemaVersion", "{}", "VERID_E_STATE_VERSION"],
    ["future schemaVersion", '{"schemaVersion":2}', "VERID_E_STATE_VERSION"],
    ["unknown top-level field", '{"schemaVersion":1,"x":1}', "VERID_E_STATE_CORRUPT"],
    [
      "negative counter",
      '{"schemaVersion":1,"counters":{"blocked_actions":-1}}',
      "VERID_E_STATE_CORRUPT",
    ],
    [
      "fractional counter",
      '{"schemaVersion":1,"counters":{"blocked_actions":1.5}}',
      "VERID_E_STATE_CORRUPT",
    ],
    [
      "unknown rule in last_denied",
      '{"schemaVersion":1,"last_denied":{"session":"s","tool":"Write","target":"t","input_hash":"h","rule":"NOPE","at":"t"}}',
      "VERID_E_STATE_CORRUPT",
    ],
    [
      "override without used flag",
      '{"schemaVersion":1,"overrides":[{"session":"s","rule":"VERID_E_MANIFEST_PROTECTED","tool":"Write","target":"t","input_hash":"h","reason":"r","created_at":"t"}]}',
      "VERID_E_STATE_CORRUPT",
    ],
  ])("rejects %s", (_name, raw, code) => {
    expect(parseState(raw)).toEqual({ ok: false, code });
  });
});
