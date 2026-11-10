import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { upgradeModulePlan } from "../../src/adapters/plan-upgrade.js";
import { parsePlan } from "../../src/core/plan.js";
import { parseState } from "../../src/core/state.js";

it("AC-28: migration retains BOM, CRLF, module identities and iteration metadata", () => {
  const parsed = parseState('{"schemaVersion":1}');
  if (!parsed.ok) throw new Error(parsed.code);
  const raw = "\uFEFF## Module: identity\r\nIteration: 2\r\nTitle: Identity\r\n- AC-1: works\r\n";
  const after = upgradeModulePlan(raw, parsed.state, true);
  expect(after.text.startsWith("\uFEFF## Module: identity\r\n")).toBe(true);
  expect(parsePlan(after.text, true)).toMatchObject({
    ok: true,
    modules: [{ name: "identity", iteration: 2 }],
  });
  expect(upgradeModulePlan(after.text, parsed.state, true).text).toBe(after.text);
});

it("AC-12: an unchanged legacy served section is kept byte for byte", () => {
  const raw = "## Module: identity\n- AC-1: works\n";
  const parsed = parseState(
    JSON.stringify({
      schemaVersion: 1,
      modules: {
        identity: {
          sha256: createHash("sha256").update(raw).digest("hex"),
          acs: ["AC-1"],
          at: "t",
          served_at: "t",
        },
      },
    }),
  );
  if (!parsed.ok) throw new Error(parsed.code);
  expect(upgradeModulePlan(raw, parsed.state)).toEqual({ text: raw, pending: [] });
});

it("AC-28: edited legacy served work gets a pending dossier, and implicit BOM plans keep their BOM", () => {
  const parsed = parseState(
    JSON.stringify({
      schemaVersion: 1,
      modules: { identity: { sha256: "old", acs: ["AC-1"], at: "t", served_at: "t" } },
    }),
  );
  if (!parsed.ok) throw new Error(parsed.code);
  const migration = upgradeModulePlan("## Module: identity\n- AC-1: edited\n", parsed.state);
  expect(migration.pending).toEqual(["identity"]);
  expect(migration.text).toContain("Artifacts: .verid/artifacts/03-modules/identity");
  const implicit = upgradeModulePlan("\uFEFF# Plan\r\n- AC-1: works\r\n", parsed.state);
  expect(implicit.text.startsWith("\uFEFF# Plan\r\n")).toBe(true);
  expect(parsePlan(implicit.text)).toMatchObject({ ok: true, modules: [{ name: "main" }] });
});
