import { describe, expect, it } from "vitest";
import { parsePlan } from "../../src/core/plan.js";
import { parseManifest } from "../../src/core/manifest.js";
import { boundariesOverlap, stationProblem } from "../../src/core/station.js";
import { autoPhase, autoNextStep, type AutoFacts } from "../../src/core/auto.js";
import { FRESH_AUTO } from "../../src/core/state.js";

const module = {
  name: "identity",
  text: "",
  acs: ["AC-1"],
  e2e: [],
  clarification: null,
  boundary: ["src/identity/**", "test/identity/**"],
  depends: ["foundation"],
};
const facts = {
  module,
  approved: true,
  served: new Set(["foundation"]),
  active: [] as { module: string; boundary: string[] }[],
  limit: 3,
};

describe("station independence", () => {
  it("reads boundaries and dependencies only before acceptance criteria", () => {
    const plan = parsePlan(
      "## Module: identity\nBoundary: src/identity/**, test/identity/**\nDepends: foundation\n- AC-1: works\nBoundary: ignored/**\n",
    );
    expect(plan).toMatchObject({
      ok: true,
      modules: [{ boundary: module.boundary, depends: ["foundation"] }],
    });
  });

  it.each([
    [["src/**"], ["src/identity/**"], true],
    [["src/a/**"], ["src/ab/**"], false],
    [["src/a/file.ts"], ["src/a/**"], true],
    [["src/A/**"], ["src/a/**"], true],
    [["**/*.ts"], ["src/a/**"], true],
    [["src/a/**"], ["test/a/**"], false],
  ])("detects possible overlap for %j and %j", (a, b, overlap) => {
    expect(boundariesOverlap(a, b)).toBe(overlap);
  });

  it("accepts an ordered module with served dependencies", () => {
    expect(stationProblem(facts)).toBeNull();
  });

  it("refuses each missing prerequisite with a distinct code", () => {
    expect(stationProblem({ ...facts, approved: false })).toBe("VERID_BURNT_STATION_NOT_ORDERED");
    expect(stationProblem({ ...facts, served: new Set() })).toBe("VERID_BURNT_STATION_DEPENDENCY");
    expect(
      stationProblem({
        ...facts,
        limit: 1,
        active: [{ module: "other", boundary: ["src/other/**"] }],
      }),
    ).toBe("VERID_BURNT_STATION_LIMIT");
    expect(stationProblem({ ...facts, active: [{ module: "other", boundary: ["src/**"] }] })).toBe(
      "VERID_BURNT_STATION_OVERLAP",
    );
    for (const boundary of [
      [],
      ["../escape/**"],
      ["/absolute/**"],
      [".verid/**"],
      ["src/../other/**"],
      ["C:/src/**"],
    ])
      expect(stationProblem({ ...facts, module: { ...module, boundary } })).toBe(
        "VERID_BURNT_STATION_BOUNDARY",
      );
  });

  it("keeps parallel drive opt in and rejects unsupported limits", () => {
    const base = {
      schemaVersion: 1,
      mode: "prep",
      repos: [{ path: ".", source_globs: ["**"], test_globs: ["test/**"] }],
    };
    expect(parseManifest(base)).toMatchObject({ ok: true, manifest: { stations: 1 } });
    for (const stations of [0, -1, 1.5, 4, "2"])
      expect(parseManifest({ ...base, stations }).ok).toBe(false);
    expect(parseManifest({ ...base, stations: 3 })).toMatchObject({
      ok: true,
      manifest: { stations: 3 },
    });
    expect(
      parseManifest({
        ...base,
        layout: "workspace",
        stations: 2,
        repos: [{ ...base.repos[0], path: "api" }],
      }).ok,
    ).toBe(false);
  });

  it("keeps the coordinator waiting while a station failure stays local", () => {
    const plan = parsePlan(
      "## Module: identity\n- AC-1: works\n\n## Module: product\n- AC-9 (e2e): works\n",
    );
    if (!plan.ok) throw new Error(plan.detail);
    const facts: AutoFacts = {
      auto: {
        ...FRESH_AUTO,
        signed: {
          research_sha256: "r",
          spec_sha256: "s",
          design_sha256: "d",
          at: "now",
          git: true,
        },
        plan_sha256: "p",
      },
      researchHash: "r",
      specHash: "s",
      designHash: "d",
      planHash: "p",
      plan: { ...plan, hashes: { identity: "i", product: "x" } },
      approvals: {},
      evidence: { passedAcs: [], passedE2eAcs: [] },
      blockedFile: null,
      parallel: true,
    };
    expect(autoPhase(facts)).toEqual({ kind: "stations" });
    expect(autoNextStep(autoPhase(facts), true, true, null).key).toBe("auto.stations");
    expect(
      autoPhase({
        ...facts,
        parallel: false,
        station: "identity",
        auto: { ...facts.auto, coder_rounds: { "AC-1": 3 } },
      }),
    ).toMatchObject({ kind: "stuck", reason: "coder_rounds" });
    expect(autoPhase(facts)).toEqual({ kind: "stations" });
  });
});
