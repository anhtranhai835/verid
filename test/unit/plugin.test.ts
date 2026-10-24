import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = join(import.meta.dirname, "..", "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

/** The text between the leading `---` fences of a Markdown file. */
const fenced = (file: string): string => /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(file))?.[1] ?? "";

/** The `key: value` lines between the leading `---` fences of a Markdown file. */
const frontmatter = (file: string): Record<string, string> => {
  return Object.fromEntries(
    fenced(file)
      .split(/\r?\n/)
      .map((line) => /^(\w+):\s*(.*)$/.exec(line))
      .filter((m) => m !== null)
      .map((m) => [m[1], (m[2] ?? "").trim()]),
  );
};

const agents = () => readdirSync(join(root, "plugin", "agents")).filter((f) => f.endsWith(".md"));
const skills = () => readdirSync(join(root, "plugin", "skills"));

// Each test lists every offender at once, so one failure names all of them.
describe("verid plugin", () => {
  it("uses the local language for the layouts heading in both READMEs", () => {
    const rows = [
      { file: "README.md", heading: "## Layouts" },
      { file: "README.vi.md", heading: "## Bố cục" },
    ];
    for (const row of rows) expect(read(row.file)).toContain(row.heading);
  });
  it("directs workspace qa to the frontend by default and to each target repo's e2e globs", () => {
    const build = read("plugin/skills/build/SKILL.md");
    const qa = read("plugin/agents/qa.md");
    expect(build).toContain("role: frontend");
    expect(build).toContain("each repo");
    expect(build).toContain(".verid");
    expect(qa).toContain("repo-relative");
    expect(qa).toContain("role: frontend");
  });
  it("ships a plugin that matches the package", () => {
    const pkg = JSON.parse(read("package.json"));
    const market = JSON.parse(read(".claude-plugin/marketplace.json"));
    const plugin = JSON.parse(read("plugin/.claude-plugin/plugin.json"));
    const entry = market.plugins.find((p: { name: string }) => p.name === "verid");
    const cases: [string, unknown, unknown][] = [
      ["marketplace name", market.name, "verid"],
      ["marketplace plugin source", entry?.source, "./plugin"],
      ["plugin name", plugin.name, "verid"],
      ["plugin version", plugin.version, pkg.version],
    ];
    expect(cases.filter(([, got, want]) => got !== want)).toEqual([]);

    const badAgents = agents().filter((file) => {
      const fm = frontmatter(`plugin/agents/${file}`);
      return fm.name !== file.replace(/\.md$/, "") || !fm.description || !fm.tools;
    });
    expect(badAgents).toEqual([]);
    const badSkills = skills().filter((dir) => {
      const file = `plugin/skills/${dir}/SKILL.md`;
      return !existsSync(join(root, file)) || frontmatter(file).name !== dir;
    });
    expect(badSkills).toEqual([]);
  });

  it("writes every frontmatter as valid YAML", () => {
    const files = [
      ...agents().map((file) => `plugin/agents/${file}`),
      ...skills().map((dir) => `plugin/skills/${dir}/SKILL.md`),
    ];
    const invalid = files.filter((file) => {
      try {
        return typeof parse(fenced(file)) !== "object";
      } catch {
        return true;
      }
    });
    expect(invalid).toEqual([]);
  });

  it("keeps the reviewer read-only", () => {
    const tools = (frontmatter("plugin/agents/reviewer.md").tools ?? "").split(/,\s*/);
    const cases: [string, boolean][] = [
      ["Read", true],
      ["Skill", false],
      ["Write", false],
      ["Edit", false],
      ["NotebookEdit", false],
      ["Bash", false],
    ];
    expect(cases.filter(([tool, has]) => tools.includes(tool) !== has)).toEqual([]);
  });

  it("tells each agent verid's rules", () => {
    const cases: [string, string][] = [
      ["plugin/agents/tester.md", "verid taste"],
      ["plugin/agents/tester.md", "AC-"],
      ["plugin/agents/tester.md", "COOKING"],
      ["plugin/agents/tester.md", "e2e_globs"],
      ["plugin/agents/tester.md", "superpowers:test-driven-development"],
      ["plugin/agents/coder.md", "PLATED"],
      ["plugin/agents/coder.md", "superpowers:test-driven-development"],
      ["plugin/agents/coder.md", "VERID_BURNT_ROLE_TESTER_ONLY"],
      ["plugin/agents/reviewer.md", "design.md"],
      ["plugin/agents/reviewer.md", "AC-"],
      ["plugin/skills/design/SKILL.md", "design.md"],
      ["plugin/skills/plan/SKILL.md", "## Module:"],
      ["plugin/skills/plan/SKILL.md", "(e2e)"],
      ["plugin/skills/build/SKILL.md", "verid:tester"],
      ["plugin/skills/build/SKILL.md", "verid:coder"],
      ["plugin/skills/build/SKILL.md", "verid menu"],
      ["plugin/skills/review/SKILL.md", "verid:reviewer"],
      ["plugin/skills/review/SKILL.md", "verid serve"],
    ];
    const text = (file: string) => (existsSync(join(root, file)) ? read(file) : "");
    expect(cases.filter(([file, says]) => !text(file).includes(says))).toEqual([]);
  });

  it("directs every agent and skill to the external Karpathy guidelines", () => {
    const files = [
      "plugin/agents/coder.md",
      "plugin/agents/tester.md",
      "plugin/agents/qa.md",
      "plugin/agents/reviewer.md",
      "plugin/agents/researcher.md",
      "plugin/agents/architect.md",
      "plugin/agents/planner.md",
      "plugin/skills/design/SKILL.md",
      "plugin/skills/plan/SKILL.md",
      "plugin/skills/build/SKILL.md",
      "plugin/skills/review/SKILL.md",
    ];
    const agentCases: [string, boolean][] = [
      ["coder", true],
      ["tester", true],
      ["qa", true],
      ["reviewer", false],
      ["researcher", false],
      ["architect", false],
      ["planner", true],
    ];
    expect(
      agentCases.filter(
        ([agent, hasSkill]) =>
          (frontmatter(`plugin/agents/${agent}.md`).tools ?? "").split(/,\s*/).includes("Skill") !==
          hasSkill,
      ),
    ).toEqual([]);
    expect(
      agentCases
        .filter(([, hasSkill]) => !hasSkill)
        .filter(([agent]) => {
          const { skills } = parse(fenced(`plugin/agents/${agent}.md`));
          return (
            !Array.isArray(skills) || !skills.includes("andrej-karpathy-skills:karpathy-guidelines")
          );
        }),
    ).toEqual([]);
    expect(
      files.filter((file) => !read(file).includes("andrej-karpathy-skills:karpathy-guidelines")),
    ).toEqual([]);
  });

  it("asks the reviewer for the verdict line verid reads, and each auto step for its part", () => {
    expect({
      "reviewer pass": read("plugin/agents/reviewer.md").includes("Verdict: pass"),
      "reviewer fail": read("plugin/agents/reviewer.md").includes("Verdict: fail"),
      "design signs": read("plugin/skills/design/SKILL.md").includes("verid order"),
      "plan blocked": read("plugin/skills/plan/SKILL.md").includes(".verid/blocked.md"),
      "build blocked": read("plugin/skills/build/SKILL.md").includes(".verid/blocked.md"),
      "review commits": /commit/i.test(read("plugin/skills/review/SKILL.md")),
    }).toEqual({
      "reviewer pass": true,
      "reviewer fail": true,
      "design signs": true,
      "plan blocked": true,
      "build blocked": true,
      "review commits": true,
    });
  });

  it("names only codes and skills that exist", () => {
    // superpowers 7.0.0, the version verid's prompts are written against.
    const superpowers = [
      "brainstorming",
      "diagnosing-superpowers",
      "dispatching-parallel-agents",
      "executing-plans",
      "finishing-a-development-branch",
      "receiving-code-review",
      "requesting-code-review",
      "subagent-driven-development",
      "systematic-debugging",
      "test-driven-development",
      "using-git-worktrees",
      "using-superpowers",
      "verification-before-completion",
      "writing-plans",
      "writing-skills",
    ];
    const en = JSON.parse(read("i18n/en.json"));
    const files = readdirSync(join(root, "plugin"), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => readFileSync(join(e.parentPath, e.name), "utf8"));
    const named = (re: RegExp) => [...new Set(files.flatMap((s) => [...s.matchAll(re)]))];
    const unknown = [
      ...named(/VERID_BURNT_[A-Z0-9_]+/g)
        .map((m) => m[0])
        .filter((code) => !(code in en)),
      ...named(/superpowers:([a-z-]+)/g)
        .filter((m) => !superpowers.includes(m[1] ?? ""))
        .map((m) => m[0]),
      ...named(/verid:([a-z-]+)/g)
        .filter(
          (m) =>
            !existsSync(join(root, "plugin", "agents", `${m[1]}.md`)) &&
            !existsSync(join(root, "plugin", "skills", m[1] ?? "", "SKILL.md")),
        )
        .map((m) => m[0]),
    ];
    expect([...new Set(unknown)]).toEqual([]);
  });
});
