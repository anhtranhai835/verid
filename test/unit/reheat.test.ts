import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { checkedRepos } from "../../src/adapters/architecture.js";
import { statePaths } from "../../src/adapters/state-store.js";
import { reheatArgs } from "../../src/cli/reheat.js";
import { autoNextStep, autoPhase, type AutoFacts } from "../../src/core/auto.js";
import { kitchenOf } from "../../src/core/kitchen.js";
import { MODES, parseManifest, planned, renderManifest } from "../../src/core/manifest.js";
import type { PlanModule } from "../../src/core/plan.js";
import { pluginManifestSchema } from "../../src/core/plugin.js";
import {
  PARITY_SECTIONS,
  parityProblem,
  statusText,
  UNIT_ID,
  unitStatus,
} from "../../src/core/reheat.js";
import { FRESH_AUTO, parseState } from "../../src/core/state.js";
import { tryClose } from "../../src/hook/lifecycle.js";

const app = { path: "app", source_globs: ["**"], test_globs: ["test/**"] };
const legacy = {
  path: "legacy",
  role: "legacy",
  read_only: true,
  source_globs: ["**"],
  test_globs: ["**/*.test.*"],
};
const base = { schemaVersion: 1, mode: "reheat", repos: [app, legacy] };
const detail = (value: unknown) => {
  const r = parseManifest(value);
  return r.ok ? null : r.detail;
};

describe("reheat manifest", () => {
  it("is a mode that walks a plan, with a read-only legacy repo beside the new one", () => {
    expect(MODES).toContain("reheat");
    const r = parseManifest(base);
    expect(r.ok && r.manifest.repos[1]).toMatchObject({ role: "legacy", read_only: true });
    expect(r.ok && planned(r.manifest)).toBe(true);
  });

  it("lets a reheat project be no-brain, but not run parallel stations", () => {
    const roles = {
      reviewer: ["verid:reviewer"],
      tester: ["verid:tester"],
      coder: ["verid:coder"],
    };
    expect(parseManifest({ ...base, drive: "no-brain", roles }).ok).toBe(true);
    expect(detail({ ...base, stations: 2 })).toContain("stations");
    expect(
      detail({ schemaVersion: 1, mode: "remix", drive: "no-brain", roles, repos: [app] }),
    ).toContain("no-brain");
  });

  it("reads a reheat manifest without a legacy repo, which doctor reports", () => {
    expect(parseManifest({ ...base, repos: [app] }).ok).toBe(true);
  });

  it.each([
    [
      "a legacy repo without read_only",
      { ...base, repos: [app, { ...legacy, read_only: undefined }] },
      "read_only",
    ],
    [
      "read_only: false",
      { ...base, repos: [app, { ...legacy, read_only: false }] },
      "read_only: true",
    ],
    [
      "read_only without the role",
      { ...base, repos: [{ ...app, read_only: true }] },
      "role: legacy",
    ],
    ["a legacy repo outside reheat", { ...base, mode: "prep" }, "needs mode reheat"],
    ["a manifest of legacy repos only", { ...base, repos: [legacy] }, "not legacy"],
    [
      "overlapping legacy and new folders",
      { ...base, repos: [{ ...app, path: "." }, legacy] },
      "non-overlapping",
    ],
  ])("refuses %s", (_name, value, text) => {
    expect(detail(value)).toContain(text);
  });

  it("writes read_only back and reads the file it wrote", () => {
    const r = parseManifest(base);
    if (!r.ok) throw new Error(r.detail);
    const text = renderManifest("reheat", r.manifest.repos);
    expect(text).toContain('mode: "reheat" # prep | recipe | remix | reheat');
    expect(text).toContain('role: "legacy"');
    expect(text).toContain("read_only: true");
    expect(parseManifest(parse(text))).toMatchObject({ ok: true });
  });

  it("never runs an architecture check in the legacy repo", () => {
    const check = { command: "node check.js", inputs: ["**"] };
    const r = parseManifest({
      ...base,
      repos: [
        { ...app, architecture_check: check },
        { ...legacy, architecture_check: check },
      ],
    });
    if (!r.ok) throw new Error(r.detail);
    expect(checkedRepos(r.manifest).map((item) => item.repo.path)).toEqual(["app"]);
  });
});

describe("reheat state", () => {
  const unit = {
    title: "Calculator",
    family: "tools",
    gate: { at: "t", pass: true, inputs_sha256: "a", findings: 0 },
  };

  it("stays absent until a unit is inventoried, so other modes never hold it", () => {
    const parsed = parseState('{"schemaVersion":1}');
    expect(parsed.ok && "reheat" in parsed.state).toBe(false);
  });

  it("keeps a unit's extraction, gate and parity, and refuses unknown fields", () => {
    const full = {
      ...unit,
      extracted: { at: "t", files: ["screen.json"], sha256: "b" },
      parity: { at: "t", sha256: "c" },
    };
    const ok = parseState(JSON.stringify({ schemaVersion: 1, reheat: { calc: full } }));
    expect(ok.ok && ok.state.reheat?.calc).toEqual(full);
    for (const bad of [
      { ...unit, extra: 1 },
      { ...unit, gate: { ...unit.gate, pass: "yes" } },
    ])
      expect(parseState(JSON.stringify({ schemaVersion: 1, reheat: { calc: bad } })).ok).toBe(
        false,
      );
  });
});

describe("unit ids, parity records and status", () => {
  it.each(["calc", "a-1", "0abc", "x".repeat(80)])("accepts the unit id %s", (id) => {
    expect(UNIT_ID.test(id)).toBe(true);
  });
  it.each(["../x", "A", "-a", "a_b", "a b", "", "x".repeat(81), "a/b", "a\\b"])(
    "rejects the unit id %j",
    (id) => {
      expect(UNIT_ID.test(id)).toBe(false);
    },
  );

  const complete = "# P\n\n## Inputs\n1 + 2\n\n## Legacy results\n3\n\n## New results\n3\n";
  it("needs the three parts, each with content and no open question", () => {
    expect(PARITY_SECTIONS).toEqual(["Inputs", "Legacy results", "New results"]);
    expect(parityProblem(complete)).toBeNull();
    expect(parityProblem(complete.replace("## New results", "## new results"))).toBeNull();
    expect(parityProblem(complete.replace("## Legacy results", "## Legacy"))).toContain(
      "Legacy results",
    );
    expect(parityProblem(complete.replace("3\n", "").replace("3\n", ""))).toContain("empty");
    expect(parityProblem(complete.replace("1 + 2", "[NEEDS CLARIFICATION: which?]"))).toContain(
      "Inputs",
    );
    expect(parityProblem("# Parity only\n")).toContain("Inputs");
    // A deeper heading belongs to its section; it does not end it.
    expect(parityProblem(complete.replace("1 + 2", "### Case\n1 + 2"))).toBeNull();
  });

  it("counts a gate or a signature only for the bytes it was made on", () => {
    const record = {
      title: "t",
      extracted: { at: "t", files: [], sha256: "x" },
      gate: { at: "t", pass: true, inputs_sha256: "in", findings: 0 },
      parity: { at: "t", sha256: "par" },
    };
    expect(unitStatus(record, "in", "par")).toEqual({
      extracted: true,
      gate: "pass",
      parity: "signed",
    });
    expect(unitStatus(record, "other", "par").gate).toBe("stale");
    expect(unitStatus(record, "in", "changed").parity).toBe("unsigned");
    expect(unitStatus(record, "in", null).parity).toBe("none");
    expect(unitStatus({ title: "t" }, "in", null)).toEqual({
      extracted: false,
      gate: "none",
      parity: "none",
    });
    expect(unitStatus({ ...record, gate: { ...record.gate, pass: false } }, "in", "par").gate).toBe(
      "fail",
    );
    expect(statusText({ extracted: true, gate: "stale", parity: "signed" })).toBe(
      "extract yes · gate stale · parity signed",
    );
  });

  it("accepts exactly inventory, extract <unit> and gate <unit>", () => {
    expect(reheatArgs(["inventory"])).toBe(true);
    expect(reheatArgs(["extract", "calc"])).toBe(true);
    expect(reheatArgs(["gate", "calc"])).toBe(true);
    for (const bad of [[], ["inventory", "x"], ["extract"], ["gate", "a", "b"], ["serve", "calc"]])
      expect(reheatArgs(bad), bad.join(" ")).toBe(false);
  });
});

describe("adapter block of a plugin", () => {
  const plugin = { name: "screens", version: "1.0.0", veridApi: "1", description: "d" };
  const adapter = {
    unitKind: "screen",
    commands: {
      inventory: "node a.mjs i",
      extract: "node a.mjs e {unit}",
      gate: 'node a.mjs g "{specPath}"',
    },
  };
  it("takes three commands and an optional skill the package ships", () => {
    expect(pluginManifestSchema.safeParse({ ...plugin, adapter }).success).toBe(true);
    const skilled = { ...plugin, skills: ["skills/spec"], adapter: { ...adapter, skill: "spec" } };
    expect(pluginManifestSchema.safeParse(skilled).success).toBe(true);
    expect(pluginManifestSchema.safeParse({ ...skilled, skills: [] }).success).toBe(false);
  });
  it("refuses a missing command, an unreadable command and unknown keys", () => {
    const { gate: _gate, ...two } = adapter.commands;
    for (const changed of [
      { ...adapter, commands: two },
      { ...adapter, commands: { ...adapter.commands, gate: "node 'unclosed" } },
      { ...adapter, extra: 1 },
      { ...adapter, unitKind: "" },
    ])
      expect(pluginManifestSchema.safeParse({ ...plugin, adapter: changed }).success).toBe(false);
  });
});

describe("a drive that follows the legacy gate and the parity signature", () => {
  const module = (name: string, acs: string[]): PlanModule => ({
    name,
    acs,
    text: `## Module: ${name}\n`,
    clarification: null,
    e2e: name === "product" ? acs : [],
  });
  const facts = (reheat?: AutoFacts["reheat"]): AutoFacts => ({
    auto: {
      ...FRESH_AUTO,
      signed: { research_sha256: "r", spec_sha256: "s", design_sha256: "d", at: "t", git: false },
      plan_sha256: "p",
    },
    researchHash: "r",
    specHash: "s",
    designHash: "d",
    planHash: "p",
    plan: {
      ok: true,
      modules: [module("calc", ["AC-1"]), module("product", ["AC-2"])],
      hashes: { calc: "c", product: "p" },
    },
    approvals: {},
    evidence: { passedAcs: ["AC-1"], passedE2eAcs: [] },
    blockedFile: null,
    ...(reheat ? { reheat } : {}),
  });

  it("opens no unit whose gate has not passed on its current spec", () => {
    const waiting = { ungated: new Set(["calc"]), unsigned: new Set(["calc"]) };
    const phase = autoPhase(facts(waiting));
    expect(phase).toEqual({ kind: "stuck", reason: "reheat_gate", detail: "calc" });
    const step = autoNextStep(phase, true, true, null);
    expect(step).toEqual({ key: "auto.stuck.reheat_gate", params: { detail: "calc" } });
    expect(autoPhase(facts({ ungated: new Set(), unsigned: new Set(["calc"]) })).kind).toBe(
      "module",
    );
    // Modules that are not legacy units, and projects in other modes, are not held.
    expect(autoPhase(facts({ ungated: new Set(["other"]), unsigned: new Set() })).kind).toBe(
      "module",
    );
    expect(autoPhase(facts()).kind).toBe("module");
  });

  it("tells the board's waiter about the gate and the signature", () => {
    const input = {
      tdd: "RAW" as const,
      research: true,
      design: true,
      halted: null,
      denied: null,
      tasks: [],
      now: 0,
    };
    const gate = kitchenOf({
      ...input,
      phase: { kind: "stuck", reason: "reheat_gate", detail: "calc" },
    });
    expect(gate.waiter).toEqual({ kind: "gate", params: { detail: "calc" } });
    expect(kitchenOf({ ...input, phase: null, parity: "calc" }).waiter).toEqual({
      kind: "parity",
      params: { detail: "calc" },
    });
    expect(kitchenOf({ ...input, phase: null, parity: null }).waiter).toBeNull();
  });

  describe("closing a ready unit", () => {
    let project: string;
    beforeEach(() => {
      project = mkdtempSync(join(tmpdir(), "verid-reheat-close-"));
      mkdirSync(join(project, ".verid", ".state"), { recursive: true });
    });
    afterEach(() => rmSync(project, { recursive: true, force: true }));

    const manifest = () => {
      const roles = {
        reviewer: ["verid:reviewer"],
        tester: ["verid:tester"],
        coder: ["verid:coder"],
      };
      const r = parseManifest({ ...base, drive: "no-brain", roles });
      if (!r.ok) throw new Error(r.detail);
      return r.manifest;
    };
    const ready = () => {
      const parsed = parseState('{"schemaVersion":1}');
      if (!parsed.ok) throw new Error("state");
      const review = {
        module: "calc",
        agent_type: "verid:reviewer",
        file: "f",
        sha256: "x",
        at: "t",
        verdict: "pass" as const,
        identity: null,
      };
      return {
        ...parsed.state,
        tdd: {
          ...parsed.state.tdd,
          state: "PLATED" as const,
          last_run: "run",
          passed_acs: ["AC-1"],
        },
        review,
      };
    };

    it("serves a ready unit once its parity record is signed, and not before", () => {
      const state = ready();
      const paths = statePaths(project);
      const unsigned = facts({ ungated: new Set(), unsigned: new Set(["calc"]) });
      expect(tryClose(project, paths, state, unsigned, manifest(), [])).toBe(state);
      const closed = tryClose(
        project,
        paths,
        state,
        facts({ ungated: new Set(), unsigned: new Set() }),
        manifest(),
        [],
      );
      expect(closed.modules.calc?.served_at).toBeTruthy();
      // Without reheat facts, a module closes exactly as before.
      expect(
        tryClose(project, paths, state, facts(), manifest(), []).modules.calc?.served_at,
      ).toBeTruthy();
    });
  });
});
