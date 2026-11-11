import { existsSync, readdirSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, RULE_CODES } from "../../src/core/errors.js";

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
  const expected = Object.keys(en).sort();

  // MessageKey is typed from en.json, so en is the list of keys; vi must match it.
  it("vi and en have the same keys, including every error code", () => {
    expect(Object.keys(vi).sort()).toEqual(expected);
    expect(ERROR_CODES.filter((code) => !(code in en))).toEqual([]);
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

  // The old prefix survives in one line only: the one that refuses state written before the rename.
  it("leaves no VERID_E_ in the code, catalogs or docs", () => {
    const allowed: Record<string, string> = {
      "src/core/state.ts":
        'rules.some((r) => typeof r === "string" && r.startsWith("VERID_E_")) ||',
    };
    const docs = ["README.md", "README.vi.md"].map((file) => join(root, file));
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

  it("stable docs describe capabilities without internal plan labels", () => {
    const left = ["README.md", "README.vi.md"].flatMap((file) =>
      readFileSync(join(root, file), "utf8")
        .split(/\r?\n/)
        .flatMap((line, i) =>
          /(?:phase|part|phần)\s+\d+[a-z]?\b/i.test(line) ? [`${file}:${i + 1}`] : [],
        ),
    );
    expect(left).toEqual([]);
  });

  it("the TDD skill documents the lifecycle and the build skill follows it", () => {
    const tdd = readFileSync(join(root, "plugin/skills/tdd/SKILL.md"), "utf8");
    const build = readFileSync(join(root, "plugin/skills/build/SKILL.md"), "utf8");
    for (const detail of [
      "RAW · stub",
      "COOKING",
      "PLATED",
      "SubagentStop",
      "verid garnish",
      ".verid/log/<module>.md",
    ])
      expect(tdd, detail).toContain(detail);
    expect(build).toContain("verid:tdd");
  });

  it("both READMEs point the workflow summary at the one full description", () => {
    for (const [file, heading] of [
      ["README.md", "## How a module moves through the workflow"],
      ["README.vi.md", "## Một module đi qua workflow như thế nào?"],
    ] as const) {
      const text = readFileSync(join(root, file), "utf8");
      const section = text.split(heading)[1]?.split(/\r?\n## /)[0] ?? "";
      expect(section, file).toContain(".verid/workflow.md");
    }
  });

  it("keeps the READMEs free of the retired limitations section", () => {
    for (const [file, heading] of [
      ["README.md", "## Limitations"],
      ["README.vi.md", "## Giới hạn"],
    ] as const) {
      const text = readFileSync(join(root, file), "utf8");
      expect(text, file).not.toContain(heading);
      expect(text, file).not.toContain("LIMITATIONS.md");
      expect(text, file).not.toContain("LIMITATIONS.vi.md");
    }
  });

  it("both READMEs locate the per-machine workspace instruction files", () => {
    const rows = [
      ["README.md", "## Repository layouts", "per machine"],
      ["README.vi.md", "## Bố cục", "mỗi máy"],
    ] as const;
    for (const [file, layoutHeading, machine] of rows) {
      const text = readFileSync(join(root, file), "utf8");
      const layouts = text.split(layoutHeading)[1]?.split("\n## ")[0] ?? "";
      for (const detail of ["CLAUDE.md", "AGENTS.md", "verid cook", machine])
        expect(layouts, file).toContain(detail);
    }
  });

  it("both READMEs explain explicit external dispatch additions and BA migration", () => {
    for (const [file, heading] of [
      ["README.md", "## Manifest example"],
      ["README.vi.md", "## Ví dụ manifest"],
    ] as const) {
      const text = readFileSync(join(root, file), "utf8");
      const manifest = text.split(heading)[1]?.split("\n## ")[0] ?? "";
      expect(manifest, file).toContain("allowed_agents: []");
      expect(manifest, file).toContain('allowed_skills: ["superpowers:*"]');
      expect(manifest, file).toContain("roles");
      expect(manifest, file).toContain("TDD");
      expect(manifest, file).toContain("roles.researcher");
      expect(manifest, file).toContain("verid:ba");
    }
  });

  it("both READMEs name project and home skill definitions in hook protection", () => {
    const rows = [
      ["README.md", "docs/hook-reference.md"],
      ["README.vi.md", "docs/hook-reference.vi.md"],
    ] as const;
    for (const [file, reference] of rows) {
      const text = readFileSync(join(root, file), "utf8");
      expect(text, file).toContain(`](${reference})`);
      const blocks = readFileSync(join(root, reference), "utf8");
      const protection =
        blocks
          .split(/\r?\n/)
          .find((line) => line.startsWith("|") && line.includes("VERID_BURNT_HOOK_PROTECTED")) ??
        "";
      expect(protection, file).toContain(".claude/skills/");
      expect(protection, file).toContain("~/.claude/skills/");
    }
  });

  it("both READMEs name project and home command definitions in hook protection", () => {
    const rows = [
      ["README.md", "docs/hook-reference.md"],
      ["README.vi.md", "docs/hook-reference.vi.md"],
    ] as const;
    for (const [file, reference] of rows) {
      const text = readFileSync(join(root, file), "utf8");
      expect(text, file).toContain(`](${reference})`);
      const blocks = readFileSync(join(root, reference), "utf8");
      const protection =
        blocks
          .split(/\r?\n/)
          .find((line) => line.startsWith("|") && line.includes("VERID_BURNT_HOOK_PROTECTED")) ??
        "";
      expect(protection, file).toContain(".claude/commands/");
      expect(protection, file).toContain("~/.claude/commands/");
    }
  });

  it("both READMEs include relocated config in hook and transcript protection", () => {
    const rows = [
      ["README.md", "docs/hook-reference.md"],
      ["README.vi.md", "docs/hook-reference.vi.md"],
    ] as const;
    for (const [file, reference] of rows) {
      const text = readFileSync(join(root, file), "utf8");
      expect(text, file).toContain(`](${reference})`);
      const blocks = readFileSync(join(root, reference), "utf8");
      for (const code of ["VERID_BURNT_HOOK_PROTECTED", "VERID_BURNT_TRANSCRIPT_PROTECTED"]) {
        const protection =
          blocks.split(/\r?\n/).find((line) => line.startsWith("|") && line.includes(code)) ?? "";
        expect(protection, `${file}: ${code}`).toContain("CLAUDE_CONFIG_DIR");
      }
    }
  });

  // Relative markdown links and any `*.md` named in the text. `.verid/` is the user's project
  // (the plan the agent writes there), not this repo.
  it("docs and catalogs name only files that exist", () => {
    // text fences show generated project trees, whose files belong to the consuming repo.
    const named = (text: string) => {
      text = text.replace(/^```text\r?\n[\s\S]*?^```[ \t]*$/gm, "");
      return [
        ...[...text.matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)].map((m) => m[1] ?? ""),
        ...[...text.matchAll(/[\w./-]+\.md\b/g)].map((m) => m[0]),
      ].filter(
        (path) =>
          !path.startsWith(".verid/") &&
          !["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"].includes(path),
      );
    };
    const missing = ["README.md", "README.vi.md", "i18n/en.json", "i18n/vi.json"]
      .flatMap((file) => named(readFileSync(join(root, file), "utf8")).map((p) => `${file}: ${p}`))
      .filter((entry) => !existsSync(join(root, entry.slice(entry.indexOf(": ") + 2))));
    expect(missing).toEqual([]);
  });

  it("both READMEs describe architecture checks as advisory rather than closure gates", () => {
    for (const file of ["README.md", "README.vi.md"]) {
      const text = readFileSync(join(root, file), "utf8");
      expect(text).toContain("architecture_check");
      expect(text).toContain(".verid/rules/architecture.md");
      expect(text).toMatch(/advisory|không chặn/);
    }
  });

  // The two refusals of the auto drive and the architecture closure codes are not rules (no
  // override lifts them) but the READMEs explain them too.
  it("each README links a reference covering every rule code and the auto drive's two refusals", () => {
    // Retired codes remain accepted in old state; advisory codes are no longer hook refusals.
    const advisory = new Set([
      "PLUGIN_PROTECTED",
      "SKILL_NOT_ALLOWED",
      "AGENT_NOT_ALLOWED",
      "ROLE_DOC_ONLY",
      "ROLE_QA_E2E_ONLY",
      "PLAN_NO_RESEARCH",
      "PLAN_NO_SPEC",
      "PLAN_NO_DESIGN",
      "AUTO_WAITING_MERGE",
      "AUTO_BRANCH",
      "GIT_MAIN_COMMIT",
      "GIT_BRANCH_NAME",
      "GIT_PROTECTED_PUSH",
      "GIT_UNRESOLVED",
    ]);
    const codes = RULE_CODES.filter((code) => !advisory.has(code.replace("VERID_BURNT_", "")));
    const missing = [
      ["README.md", "docs/hook-reference.md"],
      ["README.vi.md", "docs/hook-reference.vi.md"],
    ].flatMap(([file, reference]) => {
      const readme = readFileSync(join(root, file!), "utf8");
      expect(readme, file).toContain(`](${reference})`);
      const text = readme + readFileSync(join(root, reference!), "utf8");
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
