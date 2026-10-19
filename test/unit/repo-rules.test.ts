import { readdirSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, MESSAGE_KEYS } from "../../src/core/errors.js";

const root = join(import.meta.dirname, "..", "..");

const filesUnder = (dir: string): string[] =>
  readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));

describe("core stays pure (functional core, imperative shell)", () => {
  it.each(filesUnder("src/core"))("%s does no I/O", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/from\s+["'](node:)?(fs|child_process|net)(\/[^"']*)?["']/);
    expect(src).not.toMatch(/\bprocess\./);
  });
});

describe("i18n catalogs", () => {
  const load = (lang: string): Record<string, string> =>
    JSON.parse(readFileSync(join(root, "i18n", `${lang}.json`), "utf8"));
  const vi = load("vi");
  const en = load("en");
  const expected = [...ERROR_CODES, ...MESSAGE_KEYS].sort();
  const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it("vi and en have exactly every error code and message key", () => {
    expect(Object.keys(vi).sort()).toEqual(expected);
    expect(Object.keys(en).sort()).toEqual(expected);
  });

  it.each(expected)("%s uses the same placeholders in vi and en", (key) => {
    expect(params(vi[key] ?? "")).toEqual(params(en[key] ?? ""));
  });
});

describe("recorded Claude Code fixtures", () => {
  const user = userInfo().username.toLowerCase();
  it.each(filesUnder("test/fixtures"))("%s leaks no user paths or names", (file) => {
    const text = readFileSync(file, "utf8");
    expect(text).not.toMatch(/C:(\\\\|\\|\/)Users(\\\\|\\|\/)/i);
    if (user.length >= 3) expect(text.toLowerCase()).not.toContain(user);
  });
});
