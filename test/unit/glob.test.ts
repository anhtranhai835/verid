import { describe, expect, it } from "vitest";
import { matchesGlob, mayMatchUnder } from "../../src/core/glob.js";

// Each row is [glob, path, matches]; on a failure the diff names the row.
const expectMatches = (rows: [string, string, boolean][]) =>
  expect(Object.fromEntries(rows.map(([g, p]) => [`${g} ~ ${p}`, matchesGlob(p, g)]))).toEqual(
    Object.fromEntries(rows.map(([g, p, want]) => [`${g} ~ ${p}`, want])),
  );

describe("matchesGlob", () => {
  it("matches ** across folders and * and ? within one segment", () => {
    expectMatches([
      ["src/**", "src/a.ts", true],
      ["src/**", "src/x/y/a.ts", true],
      ["**/*.test.ts", "a.test.ts", true],
      ["**/*.test.ts", "x/y/a.test.ts", true],
      ["*.ts", "a.ts", true],
      ["*.ts", "x/a.ts", false],
      ["src/?.ts", "src/a.ts", true],
      ["src/?.ts", "src/ab.ts", false],
    ]);
  });

  // A boundary matched wrongly decides what counts as production code, and so what the gate locks.
  it("keeps folder and extension boundaries, and matches regex characters literally", () => {
    expectMatches([
      ["src/**", "srcx/a.ts", false],
      ["src/**", "test/a.ts", false],
      ["**/*.test.ts", "x/a.test.tsx", false],
      ["a.ts", "abts", false],
      ["src/(a)+.ts", "src/(a)+.ts", true],
    ]);
  });

  // A folder the snapshot skips must hold no file a declared input could name.
  it("tells whether a file under a folder could match, from the glob's segments before **", () => {
    const rows: [string, string, boolean][] = [
      ["package.json", "node_modules", false],
      ["node_modules/dependency-cruiser/package.json", "node_modules", true],
      ["node_modules/dependency-cruiser/package.json", "node_modules/dependency-cruiser", true],
      ["node_modules/dependency-cruiser/package.json", "node_modules/other", false],
      ["node_modules/*/package.json", "node_modules/x", true],
      ["node_modules/*/package.json", "node_modules/x/y", false],
      ["**/tsconfig.json", "node_modules/x/y", true],
      ["src/**", "src", true],
      ["src/**", "lib", false],
      ["Config/*.cjs", "config", true],
      [".\\rules\\*.cjs", "rules", true],
    ];
    expect(
      Object.fromEntries(rows.map(([g, d]) => [`${g} under ${d}`, mayMatchUnder(d, g)])),
    ).toEqual(Object.fromEntries(rows.map(([g, d, want]) => [`${g} under ${d}`, want])));
  });

  it("ignores case, backslashes and a leading ./", () => {
    expectMatches([
      ["SRC/**", "src/a.ts", true],
      ["src\\**", "src/a.ts", true],
      ["./src/**", "src/a.ts", true],
    ]);
  });
});
