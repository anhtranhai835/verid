import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { contentRoot, installedSkills, reviewerTemplateFile } from "./codex-settings.js";
import { checkSetupPath } from "./workspace.js";
import type { Manifest } from "../core/manifest.js";

export type ResourceFile = { rel: string; content: Buffer | string };
const DEV_ONLY = new Set([".coverage", "__pycache__", "node_modules"]);
export const skillsFor = (manifest: Pick<Manifest, "resources">): string =>
  manifest.resources === "repo" ? ".verid/skills" : installedSkills();

/** Copy supporting scripts, references and licenses too; never follow package links. */
export function resourceTree(
  source: string,
  target: string,
  excluded: ReadonlySet<string> = new Set(),
): ResourceFile[] {
  return readdirSync(source, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry): ResourceFile[] => {
      if (excluded.has(entry.name)) return [];
      if (entry.isSymbolicLink()) throw new Error(`Linked resource: ${join(source, entry.name)}`);
      // A skill script's own test suite and coverage output are verid's, never the agent's.
      if (DEV_ONLY.has(entry.name) || (entry.name === "tests" && source.endsWith("scripts")))
        return [];
      if (entry.isDirectory())
        return resourceTree(join(source, entry.name), `${target}/${entry.name}`, excluded);
      return [{ rel: `${target}/${entry.name}`, content: readFileSync(join(source, entry.name)) }];
    });
}

/** Native host entries route to the repo copy, so changes there are used on the next call. */
export function repoResources(project: string, providers: Manifest["providers"]): ResourceFile[] {
  const root = contentRoot();
  const files = [
    ...resourceTree(join(root, "skills"), ".verid/skills"),
    ...resourceTree(join(root, "agents"), ".verid/agents"),
    ...resourceTree(join(root, "templates"), ".verid/templates"),
    { rel: ".verid/templates/codex-reviewer.toml", content: readFileSync(reviewerTemplateFile()) },
  ];
  const effective = (file: ResourceFile) => {
    checkSetupPath(project, file.rel);
    return existsSync(join(project, file.rel))
      ? readFileSync(join(project, file.rel), "utf8")
      : file.content.toString();
  };
  for (const file of [...files]) {
    const skill = /^\.verid\/skills\/([^/]+)\/SKILL\.md$/.exec(file.rel);
    const agent = /^\.verid\/agents\/([^/]+)\.md$/.exec(file.rel);
    if (!skill && !agent) continue;
    const name = (skill ?? agent)![1]!;
    const text = effective(file);
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
    if (!frontmatter) throw new Error(`Missing frontmatter: ${file.rel}`);
    const header = frontmatter
      .replace(/^name:.*$/m, `name: verid-${name}`)
      .replace(/^(skills:[\s\S]*?)(?=^[\w-]+:|$(?![\s\S]))/m, (field) =>
        field.replace(/\bverid:([a-z][a-z-]*)\b/g, "verid-$1"),
      );
    const body = `Read ${file.rel} unless already current in context; follow it and resolve supporting files from its folder. verid:<name> means local verid-<name>. Run CLI commands as node .verid/verid.mjs <command> from the project root. Load AGENTS.md and .verid/workflow.md if present and not already in this context; reread changed or lost instructions.\n`;
    if (providers.includes("claude-code"))
      files.push({
        rel: skill ? `.claude/skills/verid-${name}/SKILL.md` : `.claude/agents/verid-${name}.md`,
        content: `---\n${header}\n---\n\n${body}`,
      });
    if (skill && providers.includes("codex"))
      files.push({
        rel: `.agents/skills/verid-${name}/SKILL.md`,
        content: `---\n${header}\n---\n\n${body}`,
      });
  }
  return files;
}
