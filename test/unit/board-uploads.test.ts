import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveUpload, uploadName } from "../../src/adapters/board-uploads.js";

describe("board uploads", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("keeps a safe name inside the uploads folder", () => {
    for (const [raw, name] of <[string, string][]>[
      ["Báo cáo Q3.pdf", "Báo cáo Q3.pdf"],
      ["../../.verid/.state/state.json", "state.json"],
      ["..\\..\\secret.env", "secret.env"],
      [".hidden", "hidden"],
      ["a<b>:c|d?.txt", "a_b__c_d_.txt"],
      ["CON.txt", "_CON.txt"],
      ["nul", "_nul"],
      ["", "file"],
      ["...", "file"],
      [`${"x".repeat(200)}.docx`, `${"x".repeat(115)}.docx`],
    ])
      expect(uploadName(raw), raw).toBe(name);
  });

  it("never overwrites: a taken name gets a number", () => {
    dir = mkdtempSync(join(tmpdir(), "verid-uploads-"));
    expect(saveUpload(dir, "spec.pdf", Buffer.from("one"))).toBe(".verid/uploads/spec.pdf");
    expect(saveUpload(dir, "spec.pdf", Buffer.from("two"))).toBe(".verid/uploads/spec-1.pdf");
    expect(readFileSync(join(dir, ".verid/uploads/spec.pdf"), "utf8")).toBe("one");
  });
});
