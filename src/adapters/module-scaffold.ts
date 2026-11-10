import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { contentRoot } from "./codex-settings.js";
import { resourceTree } from "./repo-resources.js";
import { VeridError } from "./state-store.js";
import { checkSetupPath } from "./workspace.js";

/** Checked drafts, also used by setup previews without writing anything. */
export function moduleDrafts(project: string, name: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(name))
    throw new VeridError("VERID_BURNT_INIT_INVALID", {
      path: "module",
      detail: "use a kebab-case module name, up to 80 characters",
    });
  const base = `.verid/artifacts/03-modules/${name}`;
  checkSetupPath(project, ".verid/templates/module");
  const local = existsSync(join(project, ".verid/templates/module"));
  const files = new Map(
    resourceTree(join(contentRoot(), "templates/module"), base).map((file) => [file.rel, file]),
  );
  if (local)
    for (const file of resourceTree(join(project, ".verid/templates/module"), base))
      files.set(file.rel, file);
  return [...files.values()].map((file) => {
    checkSetupPath(project, file.rel);
    if (local)
      checkSetupPath(project, `.verid/templates/module/${file.rel.slice(base.length + 1)}`);
    return { rel: file.rel, content: file.content.toString().replaceAll("{{module}}", name) };
  });
}

/** Creates missing drafts only; never overwrites project content. */
export function scaffoldModule(project: string, name: string): string[] {
  return moduleDrafts(project, name).map((file) => {
    if (existsSync(join(project, file.rel))) return `= ${file.rel}`;
    mkdirSync(dirname(join(project, file.rel)), { recursive: true });
    writeFileSync(join(project, file.rel), file.content, { flag: "wx" });
    return `+ ${file.rel}`;
  });
}
