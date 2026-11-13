import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { openModule } from "../core/plan.js";
import { contextPacket } from "../core/context-packet.js";
import { findRunners } from "../adapters/test-runner.js";
import { checkSetupPath } from "../adapters/workspace.js";
import {
  designFile,
  MODULE_INPUTS,
  planViews,
  readDesignHash,
  readPlan,
  specFile,
  servedSections,
} from "../adapters/plan-file.js";
import { readState, readFileHash, statePaths } from "../adapters/state-store.js";
import type { CliResult } from "./test.js";
import { planModule } from "./plan-module.js";

/** `[module] [--ac <id>]`, either order, nothing else. */
export function contextArgs(
  args: string[],
): { module?: string | undefined; ac?: string | undefined } | null {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { ac: { type: "string" } },
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
    const current = readPlan(project, false, false, servedSections(state));
    if (current?.ok) target = openModule(planViews(project, current, state))?.name;
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
