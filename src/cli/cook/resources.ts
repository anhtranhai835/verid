import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planned, type InitFlags, type Manifest, type Provider } from "../../core/manifest.js";
import { installationRoot, contentRoot, runtimeDirectory } from "../../adapters/codex-settings.js";
import { bilingual } from "../../adapters/i18n.js";
import { readState } from "../../adapters/state-store.js";
import { repoResources, resourceTree } from "../../adapters/repo-resources.js";
import { moduleDrafts } from "../../adapters/module-scaffold.js";
import { upgradeModulePlan } from "../../adapters/plan-upgrade.js";
import { DOCS_NOTE, projectRules } from "../../core/rules.js";
import { type Planner, readText } from "./planner.js";

/**
 * What a project keeps in `.verid/`: the repo copy of verid when it asked for one, the workflow
 * templates of a planned mode, and the module dossiers an upgraded plan still needs.
 */
export function planResources(
  p: Planner,
  flags: InitFlags,
  existing: Manifest | null,
  effective: Manifest | undefined,
  providers: Provider[],
): void {
  const { project, paths, notes, checkWritePath, step, addResource } = p;
  if (effective?.resources === "repo") {
    for (const file of repoResources(project, providers)) addResource(file.rel, file.content);
    for (const file of resourceTree(runtimeDirectory(), ".verid/hooks")) {
      if (file.rel.endsWith(".js")) addResource(file.rel, file.content);
    }
    addResource(".verid/hooks/package.json", '{"type":"module","private":true}\n');
    addResource(".verid/verid.mjs", '#!/usr/bin/env node\nimport "./hooks/cli.js";\n');
    for (const file of resourceTree(join(installationRoot(), "i18n"), ".verid/i18n"))
      addResource(file.rel, file.content);
    addResource(
      ".verid/policies/README.md",
      readFileSync(join(contentRoot(), "templates/policies/README.md")),
    );
    notes.push(bilingual("cook.resources_repo", {}));
  }
  if (effective && planned(effective)) {
    for (const file of resourceTree(join(contentRoot(), "templates"), ".verid/templates"))
      addResource(file.rel, file.content);
    for (const rel of [
      "workflow.md",
      "constitution.md",
      "architecture-profile.md",
      "ownership.yaml",
      "approvals/README.md",
    ])
      addResource(`.verid/${rel}`, readFileSync(join(contentRoot(), "templates", rel)));
    for (const phase of [
      "00-baseline",
      "01-research",
      "02-discovery",
      "03-modules",
      "04-plans",
      "05-implementation",
      "06-evaluation",
      "07-release",
      "adr",
    ])
      addResource(
        `.verid/artifacts/${phase}/README.md`,
        `# ${phase}\n\nRead .verid/workflow.md for this phase. Store project evidence and decisions here.\n`,
      );
    notes.push(bilingual("cook.workflow_modular", {}));
    if (flags.upgrade && existing) {
      const planPath = join(project, ".verid/plan.md");
      const before = readText(planPath);
      if (before !== null) {
        const state = readState(paths);
        const migration = upgradeModulePlan(before, state, effective.iterations !== undefined);
        for (const name of migration.pending)
          for (const file of moduleDrafts(project, name)) addResource(file.rel, file.content);
        if (migration.text !== before) {
          checkWritePath(".verid/plan.md");
          step("updated", ".verid/plan.md", {
            content: migration.text,
            apply: () => writeFileSync(planPath, migration.text),
          });
          notes.push(
            bilingual("init.module_reapproval", { modules: migration.pending.join(", ") }),
          );
        }
      }
    }
  }
}

/** The project's rule files and the note in `.verid/docs`: written once, then the developer's. */
export function planRulesAndDocs(p: Planner, effective: Manifest | undefined): void {
  const { project, step } = p;
  for (const [name, text] of Object.entries(projectRules(effective?.architecture ?? "ddd"))) {
    const rel = `.verid/rules/${name}`;
    if (readText(join(project, rel)) !== null) step("kept", rel);
    else
      step("created", rel, {
        content: text,
        apply: () => {
          mkdirSync(join(project, ".verid", "rules"), { recursive: true });
          writeFileSync(join(project, rel), text, { flag: "wx" });
        },
      });
  }
  // Once the folder exists it is the developer's: cook never writes into it again.
  if (existsSync(join(project, ".verid", "docs"))) step("kept", ".verid/docs/");
  else
    step("created", ".verid/docs/README.md", {
      content: DOCS_NOTE,
      apply: () => {
        mkdirSync(join(project, ".verid", "docs"), { recursive: true });
        writeFileSync(join(project, ".verid", "docs", "README.md"), DOCS_NOTE, { flag: "wx" });
      },
    });
}
