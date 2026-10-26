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

  it("stable docs describe capabilities without internal plan labels", () => {
    const left = ["README.md", "README.vi.md", "CLAUDE.md"].flatMap((file) =>
      readFileSync(join(root, file), "utf8")
        .split(/\r?\n/)
        .flatMap((line, i) =>
          /(?:phase|part|phần)\s+\d+[a-z]?\b/i.test(line) ? [`${file}:${i + 1}`] : [],
        ),
    );
    expect(left).toEqual([]);
  });

  it("both READMEs explain other instruction sources outside the protected block", () => {
    const rows = [
      ["README.md", "## Limitations"],
      ["README.vi.md", "## Giới hạn"],
    ] as const;
    for (const [file, limitationsHeading] of rows) {
      const text = readFileSync(join(root, file), "utf8");
      const limitations = text.split(limitationsHeading)[1] ?? "";
      const instructionLine =
        limitations.split(/\r?\n/).find((line) => line.includes("CLAUDE.local.md")) ?? "";
      expect(instructionLine, file).toContain(".claude/CLAUDE.md");
      expect(instructionLine, file).toContain(".claude/rules/");
    }
  });

  it("both READMEs locate the per-machine workspace instruction files", () => {
    const rows = [
      ["README.md", "## Layouts", "per machine"],
      ["README.vi.md", "## Bố cục", "mỗi máy"],
    ] as const;
    for (const [file, layoutHeading, machine] of rows) {
      const text = readFileSync(join(root, file), "utf8");
      const layouts = text.split(layoutHeading)[1]?.split("\n## ")[0] ?? "";
      const rootInstructions =
        layouts
          .split(/\r?\n/)
          .find((line) => line.includes("CLAUDE.md") && line.includes("AGENTS.md")) ?? "";
      expect(rootInstructions, file).toContain("verid cook");
      expect(rootInstructions, file).toContain(machine);
    }
  });

  it("both READMEs explain the general-purpose default used by superpowers", () => {
    const rows = [
      ["README.md", /removing it denies/i],
      ["README.vi.md", /xoá nó.*từ chối/i],
    ] as const;
    for (const [file, removal] of rows) {
      const text = readFileSync(join(root, file), "utf8");
      const manifest = text.split("## manifest.yaml")[1]?.split("\n## ")[0] ?? "";
      expect(manifest, file).toContain('allowed_agents: ["general-purpose"]');
      const dispatch =
        manifest
          .split(/\r?\n/)
          .find((line) => line.includes("general-purpose") && line.includes("superpowers")) ?? "";
      expect(dispatch, file).toMatch(removal);
      expect(dispatch, file).toContain("roles");
      expect(dispatch, file).toContain("TDD");
    }
  });

  it("both READMEs name project and home skill definitions in hook protection", () => {
    const rows = [
      ["README.md", "## What the hook blocks"],
      ["README.vi.md", "## Hook chặn gì"],
    ] as const;
    for (const [file, blocksHeading] of rows) {
      const text = readFileSync(join(root, file), "utf8");
      const blocks = text.split(blocksHeading)[1]?.split("\n## ")[0] ?? "";
      const protection =
        blocks.split(/\r?\n/).find((line) => line.includes("VERID_BURNT_HOOK_PROTECTED")) ?? "";
      expect(protection, file).toContain(".claude/skills/");
      expect(protection, file).toContain("~/.claude/skills/");
    }
  });

  it("both READMEs name project and home command definitions in hook protection", () => {
    const rows = [
      ["README.md", "## What the hook blocks"],
      ["README.vi.md", "## Hook chặn gì"],
    ] as const;
    for (const [file, blocksHeading] of rows) {
      const text = readFileSync(join(root, file), "utf8");
      const blocks = text.split(blocksHeading)[1]?.split("\n## ")[0] ?? "";
      const protection =
        blocks.split(/\r?\n/).find((line) => line.includes("VERID_BURNT_HOOK_PROTECTED")) ?? "";
      expect(protection, file).toContain(".claude/commands/");
      expect(protection, file).toContain("~/.claude/commands/");
    }
  });

  it("both READMEs include relocated config in hook and transcript protection", () => {
    const rows = [
      ["README.md", "## What the hook blocks"],
      ["README.vi.md", "## Hook chặn gì"],
    ] as const;
    for (const [file, blocksHeading] of rows) {
      const text = readFileSync(join(root, file), "utf8");
      const blocks = text.split(blocksHeading)[1]?.split("\n## ")[0] ?? "";
      for (const code of ["VERID_BURNT_HOOK_PROTECTED", "VERID_BURNT_TRANSCRIPT_PROTECTED"]) {
        const protection = blocks.split(/\r?\n/).find((line) => line.includes(code)) ?? "";
        expect(protection, `${file}: ${code}`).toContain("CLAUDE_CONFIG_DIR");
      }
    }
  });

  it("both READMEs disclose allowed namespace skills already on disk", () => {
    const rows = [
      ["README.md", "## Limitations", "already on disk", "allowed namespace"],
      ["README.vi.md", "## Giới hạn", "đã có trên đĩa", "namespace được phép"],
    ] as const;
    for (const [file, heading, installed, namespace] of rows) {
      const limitations = readFileSync(join(root, file), "utf8").split(heading)[1] ?? "";
      const skill =
        limitations
          .split(/\r?\n/)
          .find((line) => line.includes(".claude/skills/") && line.includes("`name`")) ?? "";
      expect(skill, file).toContain(installed);
      expect(skill, file).toContain(namespace);
    }
  });

  it("both READMEs explain any-host drive shares and the remaining path aliases", () => {
    const rows = [
      [
        "README.md",
        "## Limitations",
        [
          "administrative drive shares",
          "any host",
          "local drive",
          "Other shares",
          "mapped network drives to other shares",
          "`subst`",
          "bypass",
          "prefixes",
        ],
      ],
      [
        "README.vi.md",
        "## Giới hạn",
        [
          "Share quản trị ổ đĩa",
          "mọi host",
          "ổ đĩa cục bộ",
          "share khác",
          "ổ mạng ánh xạ tới share khác",
          "`subst`",
          "vượt",
          "tiền tố",
        ],
      ],
    ] as const;
    for (const [file, heading, phrases] of rows) {
      const limitations = readFileSync(join(root, file), "utf8").split(heading)[1] ?? "";
      const unc = limitations.split(/\r?\n/).find((line) => line.includes("UNC")) ?? "";
      for (const phrase of phrases) expect.soft(unc, file).toContain(phrase);
    }
  });

  it("both READMEs disclose parsed Bash skill and command targets and unparsed writes", () => {
    const rows = [
      ["README.md", "## Limitations", "parsed write targets", "read or run", "unparsed"],
      [
        "README.vi.md",
        "## Giới hạn",
        "đích ghi phân tích được",
        "đọc hay chạy",
        "không phân tích được",
      ],
    ] as const;
    for (const [file, heading, targets, readers, gaps] of rows) {
      const limitations = readFileSync(join(root, file), "utf8").split(heading)[1] ?? "";
      const bash =
        limitations
          .split(/\r?\n/)
          .find((line) => line.includes("Bash") && line.includes(".claude/skills/")) ?? "";
      expect(bash, file).toContain(".claude/commands/");
      expect(bash, file).toContain(targets);
      expect(bash, file).toContain(readers);
      expect(bash, file).toContain(gaps);
      expect(bash, file).toContain("cd");
      const mentions =
        limitations
          .split(/\r?\n/)
          .find((line) => line.startsWith("- Bash") && line.includes(".claude/agents")) ?? "";
      expect(mentions, file).not.toContain(".claude/skills");
      expect(mentions, file).toContain(".claude/commands/verid");
    }
  });

  // Relative markdown links and any `*.md` named in the text. `.verid/` is the user's project
  // (the plan the agent writes there), not this repo. AGENTS.md is generated for Codex
  // projects, so it need not exist in verid's own Claude Code project.
  it("docs and catalogs name only files that exist", () => {
    const named = (text: string) =>
      [
        ...[...text.matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)].map((m) => m[1] ?? ""),
        ...[...text.matchAll(/[\w./-]+\.md\b/g)].map((m) => m[0]),
      ].filter(
        (path) =>
          !path.startsWith(".verid/") &&
          !["AGENTS.md", "CLAUDE.local.md", ".claude/CLAUDE.md"].includes(path),
      );
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
