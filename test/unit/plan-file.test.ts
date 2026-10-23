import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  autoFactsOf,
  blockedFile,
  designFile,
  planFile,
  readPlan,
  researchFile,
} from "../../src/adapters/plan-file.js";
import { parseState } from "../../src/core/state.js";

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-plan-"));
  mkdirSync(join(project, ".verid"));
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

const hashes = () => {
  const r = readPlan(project);
  if (!r?.ok) throw new Error(`plan not read: ${JSON.stringify(r)}`);
  return r.hashes;
};

describe("readPlan", () => {
  it("hashes a plan without headings exactly as the file's bytes, as 0.1.0-beta.1 did", () => {
    // sha256 of "abc", written without a trailing newline.
    writeFileSync(planFile(project), "abc");
    expect(hashes()).toEqual({
      main: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
  });

  it("hashes each module's section on its own: editing one leaves the other's hash", () => {
    writeFileSync(
      planFile(project),
      "﻿# Plan\r\n## Module: a\r\n- AC-1: x\r\n## Module: b\r\n- AC-2: y\r\n",
    );
    const before = hashes();
    appendFileSync(planFile(project), "- AC-3: z\r\n");
    const after = hashes();
    expect(after.a).toBe(before.a);
    expect(after.b).not.toBe(before.b);
  });

  it("is null while there is no plan, and reports a broken plan", () => {
    expect(readPlan(project)).toBeNull();
    writeFileSync(planFile(project), "- AC-1: a\n- AC-1: b");
    expect(readPlan(project)).toEqual({ ok: false, detail: "AC-1 appears twice" });
  });

  it("does not take any other failure for a missing plan", () => {
    mkdirSync(planFile(project)); // a directory where the file should be: EISDIR
    expect(() => readPlan(project)).toThrow();
  });
});

describe("autoFactsOf", () => {
  const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  const PLAN =
    "## Module: calc\n- AC-1: adds\n## Module: product\n- AC-9 (e2e): adds from the page\n";
  const stateOf = (extra: object = {}) => {
    const r = parseState(JSON.stringify({ schemaVersion: 1, ...extra }));
    if (!r.ok) throw new Error(r.code);
    return r.state;
  };

  it("reads what an auto drive is judged on: the files' hashes, the plan, the blocked note", () => {
    writeFileSync(researchFile(project), "what it is\r\n");
    writeFileSync(designFile(project), "how it is built\n");
    writeFileSync(planFile(project), PLAN);
    writeFileSync(blockedFile(project), "  need a key \n");
    const state = stateOf({
      modules: { calc: { sha256: "h", acs: ["AC-1"], at: "t" } },
      auto: { plan_sha256: "p" },
      tdd: { state: "RAW", last_run: "r1", passed_acs: ["AC-1"], passed_e2e_acs: ["AC-9"] },
    });
    const before = readdirSync(join(project, ".verid"));
    const facts = autoFactsOf(project, state);
    expect(readdirSync(join(project, ".verid"))).toEqual(before); // reads, writes nothing
    expect({
      researchHash: facts.researchHash,
      designHash: facts.designHash,
      planHash: facts.planHash,
      plan: facts.plan?.ok,
      blockedFile: facts.blockedFile,
      approvals: facts.approvals,
      auto: facts.auto,
      evidence: facts.evidence,
    }).toEqual({
      researchHash: sha("what it is\r\n"),
      designHash: sha("how it is built\n"),
      planHash: sha(PLAN),
      plan: true,
      blockedFile: "need a key",
      approvals: state.modules,
      auto: state.auto,
      evidence: { passedAcs: ["AC-1"], passedE2eAcs: ["AC-9"] },
    });
  });

  it("finds nothing in missing files, and nothing in a blocked.md of only whitespace", () => {
    const state = stateOf();
    const nothing = (f: ReturnType<typeof autoFactsOf>) =>
      [f.researchHash, f.designHash, f.planHash, f.plan, f.blockedFile].every((v) => v === null);
    const missing = nothing(autoFactsOf(project, state));
    writeFileSync(blockedFile(project), " \r\n\t");
    expect({ missing, blank: nothing(autoFactsOf(project, state)) }).toEqual({
      missing: true,
      blank: true,
    });
  });
});
