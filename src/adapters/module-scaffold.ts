import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { contentRoot } from "./codex-settings.js";
import { resourceTree } from "./repo-resources.js";
import { VeridError } from "./state-store.js";
import { checkSetupPath } from "./workspace.js";
import { parsePlan } from "../core/plan.js";
import { citedIds, liveRequirements } from "../core/spec.js";

/** The dossier a module starts from: the full one, or a short one for a small change or a bug. */
export type ModulePath = "module" | "quick" | "fix";
const TEMPLATE = { module: "module", quick: "module-quick", fix: "module-fix" } as const;

/** Checked drafts, also used by setup previews without writing anything. */
export function moduleDrafts(project: string, name: string, path: ModulePath = "module") {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(name))
    throw new VeridError("VERID_BURNT_INIT_INVALID", {
      path: "module",
      detail: "use a kebab-case module name, up to 80 characters",
    });
  const base = `.verid/artifacts/03-modules/${name}`;
  const template = `.verid/templates/${TEMPLATE[path]}`;
  checkSetupPath(project, template);
  const local = existsSync(join(project, template));
  const files = new Map(
    resourceTree(join(contentRoot(), "templates", TEMPLATE[path]), base).map((file) => [
      file.rel,
      file,
    ]),
  );
  if (local)
    for (const file of resourceTree(join(project, template), base)) files.set(file.rel, file);
  files.delete(`${base}/README.md`);
  return [...files.values()].map((file) => {
    checkSetupPath(project, file.rel);
    if (local) checkSetupPath(project, `${template}/${file.rel.slice(base.length + 1)}`);
    return { rel: file.rel, content: file.content.toString().replaceAll("{{module}}", name) };
  });
}

const readText = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");
const AC = /^[ \t]*[-*][ \t]+(AC-\d+)[ \t]*(\([eE]2[eE]\))?:[ \t]*(.*?)[ \t]*$/;
const REQ_PLACEHOLDER = /^\[NEEDS CLARIFICATION: globally unique REQ-n[^\r\n]*\r?\n/m;
const TABLE_HEAD = /^\| Requirement[^\r\n]*\r?\n\|[-| ]*\r?\n/m;

/**
 * What the plan section and spec already say about the module: its cited requirement lines and
 * one test-plan row per AC. Null when the plan has no section for it.
 */
function seed(project: string, name: string) {
  const plan = parsePlan(readText(join(project, ".verid", "plan.md")));
  const module = plan.ok ? plan.modules.find((m) => m.name === name) : undefined;
  if (!module) return null;
  const live = new Map(liveRequirements(readText(join(project, ".verid", "spec.md"))));
  const acs = module.text.split(/\r?\n/).flatMap((line) => {
    const m = AC.exec(line);
    return m ? [{ code: m[1]!, level: m[2] ? "e2e" : "unit", text: m[3]!, line }] : [];
  });
  const requirements = citedIds(acs.map((a) => a.line).join("\n")).flatMap((id) => {
    const line = live.get(id);
    return line === undefined ? [] : [line];
  });
  const rows = acs.map(
    (a) =>
      `| ${citedIds(a.line).join(", ")} | ${a.code} | ${a.level} |  | ${a.text.replaceAll("|", "\|")} |`,
  );
  return { requirements, rows };
}

/** Puts the module's known requirement lines and AC rows into the two drafts that take them. */
function fill(rel: string, content: string, found: ReturnType<typeof seed>): string {
  if (!found) return content;
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  if (rel.endsWith("/ba/requirements.md") && found.requirements.length)
    return content.replace(
      REQ_PLACEHOLDER,
      () =>
        `${found.requirements.join(eol)}${eol}[NEEDS CLARIFICATION: add missing requirements and sources]${eol}`,
    );
  if (rel.endsWith("/tests/test-plan.md") && found.rows.length)
    return content.replace(TABLE_HEAD, (head) => `${head}${found.rows.join(eol)}${eol}`);
  return content;
}

/** Creates missing drafts only; never overwrites project content. */
export function scaffoldModule(
  project: string,
  name: string,
  path: ModulePath = "module",
): string[] {
  const found = seed(project, name);
  return moduleDrafts(project, name, path).map((file) => {
    if (existsSync(join(project, file.rel))) return `= ${file.rel}`;
    mkdirSync(dirname(join(project, file.rel)), { recursive: true });
    writeFileSync(join(project, file.rel), fill(file.rel, file.content, found), { flag: "wx" });
    return `+ ${file.rel}`;
  });
}
