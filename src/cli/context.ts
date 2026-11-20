import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { nextStep, openModule } from "../core/plan.js";
import { contextPacket } from "../core/context-packet.js";
import { findRunners } from "../adapters/test-runner.js";
import { checkSetupPath } from "../adapters/workspace.js";
import {
  designFile,
  dossierStatus,
  MODULE_INPUTS,
  planFile,
  researchFile,
  planViews,
  readDesignHash,
  readPlan,
  specFile,
  servedSections,
} from "../adapters/plan-file.js";
import { readState, readFileHash, statePaths } from "../adapters/state-store.js";
import type { CliResult } from "./test.js";
import { bilingual } from "../adapters/i18n.js";
import { loadManifest } from "../adapters/manifest.js";
import { planModule } from "./plan-module.js";

export const CONTEXT_OPTIONS = { ac: { type: "string" } } as const;

/** `[module] [--ac <id>]`, either order, nothing else. */
export function contextArgs(
  args: string[],
): { module?: string | undefined; ac?: string | undefined } | null {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: CONTEXT_OPTIONS,
      allowPositionals: true,
    });
    return positionals.length > 1 ? null : { module: positionals[0], ac: values.ac };
  } catch {
    return null;
  }
}

/** The task packet: read-only, built from the files each call, never cached. */
export async function contextCommand(project: string, args: string[]): Promise<CliResult> {
  const { module: wanted, ac } = contextArgs(args)!;
  const state = readState(statePaths(project));
  let target = wanted ?? state.kanban.active?.module ?? state.auto.work?.module;
  if (target === undefined) {
    const current = readPlan(project, false, false, servedSections(state), true);
    if (current?.ok) {
      const views = planViews(project, current, state);
      target = openModule(views)?.name;
      // No module open and more than one planned: the reviewer before order gets the whole plan.
      if (target === undefined && current.modules.length > 1) {
        const lines = current.modules.map((m) => {
          const phase = views.find((v) => v.name === m.name)?.phase ?? "planned";
          const dossier = dossierStatus(project, m).problem;
          return `${m.name}: ${phase} · .verid/artifacts/03-modules/${m.name}/ ${dossier ? `· ${dossier}` : "ready"}`;
        });
        const packet = [
          "verid context: stage plan review",
          "Read: .verid/plan.md, .verid/spec.md, .verid/design.md, and each module's dossier.",
          ...lines,
          "",
        ].join("\n");
        return { exit: 0, stdout: packet, stderr: "" };
      }
    }
  }
  if (target === undefined && !existsSync(planFile(project))) {
    const stage = await stageContext(project);
    if (stage) return { exit: 0, stdout: stage, stderr: "" };
  }
  const { plan, name, module, manifest } = await planModule(project, "context", target);
  const views = planViews(project, plan, state);
  const read = (rel: string) => {
    const file = join(project, ...rel.split("/"));
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  };
  const base = `.verid/artifacts/03-modules/${name}`;
  const files = MODULE_INPUTS.map((input) => {
    checkSetupPath(project, `${base}/${input}`);
    const text = read(`${base}/${input}`);
    return {
      path: input,
      state:
        text === null
          ? "missing"
          : !text.trim()
            ? "empty"
            : text.includes("[NEEDS CLARIFICATION")
              ? "unresolved"
              : "ok",
    } as const;
  });
  const spec = read(".verid/spec.md");
  const log = read(`.verid/log/${name}.md`)
    ?.split(/\r?\n/)
    .findLast((line) => line.trim() !== "");
  const commands = manifest.repos.flatMap((repo) => {
    if (repo.role === "legacy") return [];
    if (repo.test_cmd !== undefined) return [repo.test_cmd];
    try {
      return findRunners(resolve(project, ...repo.path.split(/[/\\]/)), {
        sourceGlobs: repo.source_globs,
        testGlobs: repo.test_globs,
        ignoreGlobs: repo.ignore_globs ?? [],
      }).runners.map((runner) => runner.name);
    } catch {
      return [];
    }
  });
  const stdout = contextPacket({
    module,
    plan: { path: ".verid/plan.md", sha: plan.hashes[name] ?? null },
    spec:
      spec === null
        ? null
        : { path: ".verid/spec.md", text: spec, sha: readFileHash(specFile(project)) },
    design: existsSync(designFile(project))
      ? { path: ".verid/design.md", sha: readDesignHash(project) }
      : null,
    needs: (module.depends ?? []).map((dep) => ({
      name: dep,
      phase: views.find((view) => view.name === dep)?.phase ?? "not in plan",
    })),
    files,
    dossier: base,
    run: commands.length > 0 ? `verid taste (${commands.join(", ")})` : "verid taste",
    log: { path: `.verid/log/${name}.md`, last: log ? log.trim() : null },
    ...(ac !== undefined && { ac }),
  });
  return { exit: 0, stdout, stderr: "" };
}

/**
 * Before a plan, the packet is the stage's: which inputs exist and the one next step. Research,
 * spec and design work reads these, not a module; asking for a module still needs the plan.
 */
async function stageContext(project: string): Promise<string | null> {
  const manifest = await loadManifest(project, { readOnly: true }).catch(() => null);
  if (!manifest || manifest.mode === "remix") return null;
  const has = (file: string) => existsSync(file);
  const inputs = [
    ["research.md", has(researchFile(project))],
    ["spec.md", has(specFile(project))],
    ["design.md", has(designFile(project))],
  ] as const;
  const [research, spec, design] = inputs.map(([, present]) => present);
  const step = nextStep(research!, design!, [], false, spec!);
  const stage = step.key === "menu.split" ? "plan" : step.key.replace("menu.", "");
  return [
    `verid context: mode ${manifest.mode} · stage ${stage}`,
    ...inputs.map(([file, present]) => `.verid/${file}: ${present ? "ok" : "missing"}`),
    "developer inputs: .verid/docs/",
    bilingual(step.key, {}),
    "",
  ].join("\n");
}
