import { developerProject } from "../support/cook.js";
import { existsSync } from "node:fs";

import { join } from "node:path";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { planCook } from "../../src/cli/init.js";
import { moduleCommand } from "../../src/cli/module.js";
import { MODULE_INPUTS, readPlan, autoFactsOf } from "../../src/adapters/plan-file.js";
import { parseState } from "../../src/core/state.js";
import { decideDispatch } from "../../src/core/dispatch.js";

let project: string;
const fresh = parseState('{"schemaVersion":1}');
if (!fresh.ok) throw new Error("invalid fresh state");
const FRESH_STATE = fresh.state;
const t = developerProject("verid-modular-", {
  claude: "clear",
  bind: (p) => {
    project = p.root;
  },
});
const { read, put } = t;

const flags = {
  mode: "prep",
  workflow: "modular",
  resources: "repo",
  providers: ["codex"],
  src: [],
  tests: [],
};

it("previews without writes, installs portable Codex resources, and preserves customized repo copies", async () => {
  const preview = await planCook(project, flags);
  expect(existsSync(join(project, ".verid"))).toBe(false);
  expect(preview.files.some((file) => file.rel.includes("user-codex"))).toBe(false);
  expect(preview.apply().failed).toBe(false);
  expect(read(".codex/config.toml")).toContain(
    'config_file = "../.verid/agents/verid-reviewer.toml"',
  );
  expect(read(".verid/agents/verid-reviewer.toml")).toContain(".verid/skills/review/SKILL.md");
  expect(read(".verid/agents/verid-reviewer.toml")).not.toContain(project);
  expect(read(".agents/skills/verid-ba/SKILL.md")).toContain("Read .verid/skills/ba/SKILL.md");
  expect(read(".agents/skills/verid-ba/SKILL.md")).toContain("not already in this context");
  expect(read("AGENTS.md")).toContain(".verid/skills/../templates/skill-routing.md");
  expect(existsSync(join(project, ".verid/templates/skill-routing.md"))).toBe(true);
  expect(
    existsSync(join(project, ".verid/skills/context-engineering/scripts/document_reader.py")),
  ).toBe(true);
  expect(read("AGENTS.md")).toContain(".verid/workflow.md");
  expect(read("AGENTS.md")).toContain(".verid/skills/ba/SKILL.md");
  expect(read(".codex/hooks.json")).toContain("--provider codex");
  expect(existsSync(join(project, ".verid/hooks/hook.js"))).toBe(true);
  expect(existsSync(join(project, ".verid/hooks/cli.js"))).toBe(true);
  expect(read(".verid/verid.mjs")).toContain('import "./hooks/cli.js"');
  expect(existsSync(join(project, ".verid/i18n/vi.json"))).toBe(true);
  expect(existsSync(join(project, "user-codex/config.toml"))).toBe(false);
  put(".verid/templates/module/spec/spec.md", "Custom {{module}} contract\n");
  put(".verid/skills/ba/SKILL.md", read(".verid/skills/ba/SKILL.md") + "\nProject BA rule\n");
  const again = await planCook(project, { ...flags, upgrade: true }, true);
  expect(again.apply().failed).toBe(false);
  expect(read(".verid/skills/ba/SKILL.md")).toContain("Project BA rule");
  await moduleCommand(project, "identity");
  expect(read(".verid/artifacts/03-modules/identity/spec/spec.md")).toBe(
    "Custom identity contract\n",
  );
  expect(existsSync(join(project, ".verid/plan.md"))).toBe(false);
});

it("maps Claude local agents and skills to repo copies with no plugin dependency", async () => {
  const plan = await planCook(project, { ...flags, providers: ["claude-code", "codex"] });
  expect(plan.apply().failed).toBe(false);
  const manifest = parse(read(".verid/manifest.yaml"));
  expect(manifest.roles.coder).toEqual(["verid-coder"]);
  expect(manifest.roles.reviewer).toEqual(["verid-reviewer", "verid_reviewer"]);
  expect(read(".claude/agents/verid-coder.md")).toContain("name: verid-coder");
  expect(read(".claude/agents/verid-coder.md")).toContain("Read .verid/agents/coder.md");
  const security = parse(read(".claude/agents/verid-security.md").split("---")[1]!);
  expect(security.skills).toEqual(["verid-security"]);
  for (const skill of security.skills)
    expect(existsSync(join(project, `.claude/skills/${skill}/SKILL.md`))).toBe(true);
  expect(read(".claude/skills/verid-ba/SKILL.md")).toContain("Read .verid/skills/ba/SKILL.md");
  expect(decideDispatch("Skill", { skill: "verid-ba" }, manifest, new Set()).kind).toBe("allow");
  expect(
    decideDispatch("Agent", { subagent_type: "verid-debugger" }, manifest, new Set()).kind,
  ).toBe("allow");
  expect(read("AGENTS.md")).toContain("coder verid-coder");
  expect(plan.notes.join("\n")).not.toContain("claude plugin install");
});

it("rejects bad choices and names before writing, and always scaffolds planned projects", async () => {
  for (const extra of [{ workflow: "unknown" }, { resources: "unknown" }])
    await expect(planCook(project, { ...flags, ...extra })).rejects.toMatchObject({
      code: "VERID_BURNT_INIT_INVALID",
    });
  expect(existsSync(join(project, ".verid"))).toBe(false);
  const classic = await planCook(project, { mode: "prep", src: [], tests: [] });
  expect(
    classic.files.some(
      (file) => file.rel.startsWith(".verid/artifacts/") || file.rel.startsWith(".verid/skills/"),
    ),
  ).toBe(true);
  expect(classic.apply().failed).toBe(false);
  const repeated = await planCook(project, { mode: "prep", resources: "repo", src: [], tests: [] });
  expect(repeated.apply().failed).toBe(false);
  expect(read(".claude/settings.local.json")).not.toContain(".verid");
  expect(existsSync(join(project, ".verid/hooks/hook.js"))).toBe(false);
  await expect(moduleCommand(project, "../escape")).rejects.toBeDefined();
  expect((await moduleCommand(project, "identity")).exit).toBe(0);
});

it("signs module inputs independently, blocks unfinished drafts and keeps review output out of the signature", async () => {
  expect((await planCook(project, flags)).apply().failed).toBe(false);
  await moduleCommand(project, "identity");
  await moduleCommand(project, "profile");
  const section = (name: string, ac: number) =>
    `## Module: ${name}\nArtifacts: .verid/artifacts/03-modules/${name}\n- AC-${ac}: works (REQ-${ac})\n`;
  put(".verid/plan.md", section("identity", 1) + section("profile", 2));
  expect(readPlan(project, false, true)).toMatchObject({
    ok: false,
    detail: expect.stringContaining("resolve the module draft"),
  });
  for (const name of ["identity", "profile"])
    for (const input of MODULE_INPUTS)
      put(`.verid/artifacts/03-modules/${name}/${input}`, `Agreed ${name}: ${input}\n`);
  const before = readPlan(project, false, true);
  if (!before?.ok) throw new Error("plan invalid");
  const planHash = autoFactsOf(project, FRESH_STATE).planHash;
  put(".verid/artifacts/03-modules/identity/spec/spec.md", "Changed contract\n");
  const after = readPlan(project, false, true);
  if (!after?.ok) throw new Error("plan invalid");
  expect(after.hashes.identity).not.toBe(before.hashes.identity);
  expect(after.hashes.profile).toBe(before.hashes.profile);
  expect(autoFactsOf(project, FRESH_STATE).planHash).not.toBe(planHash);
  put(".verid/artifacts/03-modules/identity/review/review.md", "Actual independent review\n");
  expect(readPlan(project, false, true)).toEqual(after);
  put(".verid/plan.md", "## Module: identity\n- AC-1: works\n");
  expect(readPlan(project, false, true)).toMatchObject({
    ok: false,
    detail: expect.stringContaining("requires Artifacts"),
  });
  put(".verid/plan.md", "## Module: identity\nArtifacts: ../../outside\n- AC-1: works\n");
  expect(readPlan(project)).toMatchObject({
    ok: false,
    detail: expect.stringContaining("Artifacts must be"),
  });
});
