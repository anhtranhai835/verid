import { existsSync, readdirSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, MESSAGE_KEYS, RULE_CODES } from "../../src/core/errors.js";

const root = join(import.meta.dirname, "..", "..");

const filesUnder = (dir: string): string[] =>
  readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));

const rel = (file: string) => relative(root, file).replaceAll("\\", "/");

// Each test lists every offender at once, so one failure names all of them.
describe("repo rules", () => {
  it("core does no I/O (functional core, imperative shell)", () => {
    const impure = filesUnder("src/core").filter((file) => {
      const src = readFileSync(file, "utf8");
      return (
        /from\s+["'](node:)?(fs|child_process|net)(\/[^"']*)?["']/.test(src) ||
        /\bprocess\./.test(src)
      );
    });
    expect(impure.map(rel)).toEqual([]);
  });

  const load = (lang: string): Record<string, string> =>
    JSON.parse(readFileSync(join(root, "i18n", `${lang}.json`), "utf8"));
  const vi = load("vi");
  const en = load("en");
  const expected = [...ERROR_CODES, ...MESSAGE_KEYS].sort();

  it("vi and en have exactly every error code and message key", () => {
    expect(Object.keys(vi).sort()).toEqual(expected);
    expect(Object.keys(en).sort()).toEqual(expected);
  });

  it("vi and en use the same placeholders in every message", () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const differ = expected.filter(
      (key) => params(vi[key] ?? "").join() !== params(en[key] ?? "").join(),
    );
    expect(differ).toEqual([]);
  });

  it("names every error code VERID_BURNT_*", () => {
    expect(ERROR_CODES.filter((code) => !code.startsWith("VERID_BURNT_"))).toEqual([]);
  });

  // The old prefix survives in one line only: the one that upgrades state written before the rename.
  it("leaves no VERID_E_ in the code, catalogs or docs", () => {
    const allowed: Record<string, string> = {
      "src/core/state.ts": 'const LEGACY_CODE_PREFIX = "VERID_E_";',
    };
    const docs = ["README.md", "README.vi.md", "CLAUDE.md"].map((file) => join(root, file));
    const left = [...filesUnder("src"), ...filesUnder("i18n"), ...docs].flatMap((file) => {
      const name = rel(file);
      return readFileSync(file, "utf8")
        .split(/\r?\n/)
        .flatMap((line, i) =>
          line.includes("VERID_E_") && line.trim() !== allowed[name] ? [`${name}:${i + 1}`] : [],
        );
    });
    expect(left).toEqual([]);
  });

  // Relative markdown links and any `*.md` named in the text. `.verid/` is the user's project
  // (the plan the agent writes there), not this repo, so those paths are not repo files.
  it("docs and catalogs name only files that exist", () => {
    const named = (text: string) =>
      [
        ...[...text.matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)].map((m) => m[1] ?? ""),
        ...[...text.matchAll(/[\w./-]+\.md\b/g)].map((m) => m[0]),
      ].filter((path) => !path.startsWith(".verid/"));
    const missing = ["README.md", "README.vi.md", "CLAUDE.md", "i18n/en.json", "i18n/vi.json"]
      .flatMap((file) => named(readFileSync(join(root, file), "utf8")).map((p) => `${file}: ${p}`))
      .filter((entry) => !existsSync(join(root, entry.slice(entry.indexOf(": ") + 2))));
    expect(missing).toEqual([]);
  });

  // The two refusals of the auto drive are not rules (no override lifts them) but the READMEs
  // explain them too.
  it("both READMEs name every rule code and the auto drive's two refusals", () => {
    const codes = [...RULE_CODES, "VERID_BURNT_AUTO_ORDER_MODULE", "VERID_BURNT_AUTO_SERVE"];
    const missing = ["README.md", "README.vi.md"].flatMap((file) => {
      const text = readFileSync(join(root, file), "utf8");
      return codes.filter((c) => !new RegExp(`\\b${c}\\b`).test(text)).map((c) => `${file}: ${c}`);
    });
    expect(missing).toEqual([]);
  });

  it("recorded Claude Code fixtures leak no user paths or names", () => {
    const user = userInfo().username.toLowerCase();
    const leaking = filesUnder("test/fixtures").filter((file) => {
      const text = readFileSync(file, "utf8");
      return (
        /C:(\\\\|\\|\/)Users(\\\\|\\|\/)/i.test(text) ||
        (user.length >= 3 && text.toLowerCase().includes(user))
      );
    });
    expect(leaking.map(rel)).toEqual([]);
  });
});
