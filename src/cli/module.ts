import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadManifest } from "../adapters/manifest.js";
import { checkSetupPath } from "../adapters/workspace.js";
import { resourceTree } from "../adapters/repo-resources.js";
import { VeridError } from "../adapters/state-store.js";
import type { CliResult } from "./test.js";

/** Drafts only: never creates a plan, approval, test result or review verdict. */
export async function moduleCommand(project: string, name: string): Promise<CliResult> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(name))
    throw new VeridError("VERID_BURNT_INIT_INVALID", {
      path: "module",
      detail: "use a kebab-case module name, up to 80 characters",
    });
  const manifest = await loadManifest(project, { readOnly: true });
  if (manifest?.workflow !== "modular")
    throw new VeridError("VERID_BURNT_INIT_INVALID", {
      path: "workflow",
      detail: "verid module needs workflow: modular",
    });
  const base = `.verid/artifacts/03-modules/${name}`;
  const source = join(project, ".verid/templates/module");
  checkSetupPath(project, ".verid/templates/module");
  const files = resourceTree(source, base).map((file) => {
    checkSetupPath(project, file.rel);
    const sourceRel = `.verid/templates/module/${file.rel.slice(base.length + 1)}`;
    checkSetupPath(project, sourceRel);
    return { rel: file.rel, content: file.content.toString().replaceAll("{{module}}", name) };
  });
  const lines: string[] = [];
  for (const file of files) {
    if (existsSync(join(project, file.rel))) {
      lines.push(`= ${file.rel}`);
      continue;
    }
    mkdirSync(dirname(join(project, file.rel)), { recursive: true });
    writeFileSync(join(project, file.rel), file.content, { flag: "wx" });
    lines.push(`+ ${file.rel}`);
  }
  return {
    exit: 0,
    stdout: `${lines.join("\n")}\nFill the module drafts, then add its ACs and Artifacts: ${base} to .verid/plan.md.\n`,
    stderr: "",
  };
}
