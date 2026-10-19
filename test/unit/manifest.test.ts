import { describe, expect, it } from "vitest";
import { parseManifest } from "../../src/core/manifest.js";

const repo = {
  test_cmd: "npx vitest run --reporter=junit --outputFile={junit}",
  source_globs: ["src/**"],
  test_globs: ["test/**"],
};

describe("parseManifest", () => {
  it("accepts one repo and defaults its path to the project dir", () => {
    expect(parseManifest({ schemaVersion: 1, repos: [repo] })).toEqual({
      ok: true,
      manifest: { schemaVersion: 1, repos: [{ path: ".", ...repo }] },
    });
  });

  it.each([
    ["not a mapping", "schemaVersion: 1", /mapping/],
    ["a list", [], /mapping/],
    ["null (empty file)", null, /mapping/],
    ["no schemaVersion", { repos: [repo] }, /schemaVersion/],
    ["a future schemaVersion", { schemaVersion: 2, repos: [repo] }, /schemaVersion/],
    ["no repos", { schemaVersion: 1 }, /^repos/],
    ["two repos", { schemaVersion: 1, repos: [repo, repo] }, /^repos/],
    [
      "a test_cmd without {junit}",
      { schemaVersion: 1, repos: [{ ...repo, test_cmd: "npm test" }] },
      /^repos\.0\.test_cmd/,
    ],
    [
      "no source globs",
      { schemaVersion: 1, repos: [{ ...repo, source_globs: [] }] },
      /^repos\.0\.source_globs/,
    ],
    [
      "an empty test glob",
      { schemaVersion: 1, repos: [{ ...repo, test_globs: [""] }] },
      /^repos\.0\.test_globs/,
    ],
    ["an unknown key", { schemaVersion: 1, repos: [repo], mode: "prep" }, /mode|key/i],
  ])("rejects %s", (_name, doc, detail) => {
    const r = parseManifest(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(detail);
  });
});
