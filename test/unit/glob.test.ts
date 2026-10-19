import { describe, expect, it } from "vitest";
import { matchesGlob } from "../../src/core/glob.js";

describe("matchesGlob", () => {
  it.each([
    ["src/**", "src/a.ts", true],
    ["src/**", "src/x/y/a.ts", true],
    ["src/**", "srcx/a.ts", false],
    ["src/**", "test/a.ts", false],
    ["**/*.test.ts", "a.test.ts", true],
    ["**/*.test.ts", "x/y/a.test.ts", true],
    ["**/*.test.ts", "x/a.test.tsx", false],
    ["*.ts", "a.ts", true],
    ["*.ts", "x/a.ts", false],
    ["src/?.ts", "src/a.ts", true],
    ["src/?.ts", "src/ab.ts", false],
    ["a.ts", "abts", false],
    ["src/(a)+.ts", "src/(a)+.ts", true],
    ["SRC/**", "src/a.ts", true],
    ["src\\**", "src/a.ts", true],
    ["./src/**", "src/a.ts", true],
  ])("%s against %s → %s", (glob, path, expected) => {
    expect(matchesGlob(path, glob)).toBe(expected);
  });
});
