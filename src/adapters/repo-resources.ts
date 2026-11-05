import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { installedSkills, installationRoot } from "./codex-settings.js";
import { checkSetupPath } from "./workspace.js";
import type { Manifest } from "../core/manifest.js";

export type ResourceFile = { rel: string; content: Buffer | string };
export const skillsFor = (manifest: Pick<Manifest, "resources">): string =>
  manifest.resources === "repo" ? ".verid/skills" : installedSkills();

/** Copy supporting scripts, references and licenses too; never follow package links. */
export function resourceTree(source: string, target: string): ResourceFile[] {
  return readdirSync(source, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry): ResourceFile[] => {
      if (entry.isSymbolicLink()) throw new Error(`Linked resource: ${join(source, entry.name)}`);
      if (entry.isDirectory())
        return resourceTree(join(source, entry.name), `${target}/${entry.name}`);
      return [{ rel: `${target}/${entry.name}`, content: readFileSync(join(source, entry.name)) }];
    });
}

/** Native host entries route to the repo copy, so changes there are used on the next call. */
export function repoResources(project: string, providers: Manifest["providers"]): ResourceFile[] {
  const root = join(installationRoot(), "plugin");
  const files = [
    ...resourceTree(join(root, "skills"), ".verid/skills"),
    ...resourceTree(join(root, "agents"), ".verid/agents"),
    ...resourceTree(join(root, "templates"), ".verid/templates"),
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
    const header = frontmatter.replace(/^name:.*$/m, `name: verid-${name}`);
    const body = `Read ${file.rel} from the project root and follow its instructions. Resolve supporting files relative to that file's folder. In this repo, calls named verid:<name> use the local verid-<name> skill or agent. Read AGENTS.md and .verid/workflow.md when present before starting.\n`;
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
