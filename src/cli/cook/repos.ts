import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  ROLE_NAMES,
  suggestManifest,
  type InitFlags,
  type Repo,
  type Roles,
  type Layout,
  type Manifest,
} from "../../core/manifest.js";
import { runnerKey, type Runner } from "../../core/runners.js";
import { bilingual } from "../../adapters/i18n.js";
import {
  checkSetupPath,
  checkWorkspaceRoot,
  cloneMarkerFile,
  cloneMissingRepo,
  detectLayout,
  initWorkspaceGit,
  validateRepoPaths,
} from "../../adapters/workspace.js";
import type { Sees } from "./inputs.js";
import type { Planner } from "./planner.js";
import type { CookPlan } from "../init.js";

/**
 * The repos the manifest lists: the folders cook makes or clones, the runners verid sees in
 * each, and the agents its roles need.
 */
export function planRepos(
  p: Planner,
  flags: InitFlags,
  given: {
    existing: Manifest | null;
    reheatRepos: Repo[] | undefined;
    layout: Layout;
    detected: ReturnType<typeof detectLayout> | null;
    repo: Repo | undefined;
    sees: Sees;
    claude: boolean;
    effective: Manifest | undefined;
    roles: Roles | null | undefined;
  },
): { configured: Repo[]; missing: Repo[] } {
  const { project, notes, step } = p;
  const { existing, reheatRepos, layout, detected, repo, sees, claude, effective, roles } = given;
  const configured =
    existing?.repos ??
    reheatRepos ??
    (layout === "workspace"
      ? (detected?.repos ?? []).map((repo) => ({ ...suggestManifest(flags), ...repo }))
      : [repo!]);
  // The folder for the new system is made here; the legacy folder was checked to exist.
  const made = reheatRepos?.filter((repo) => repo.role !== "legacy") ?? [];
  const folderOf = (repo: Repo) => resolve(project, ...repo.path.split(/[/\\]/));
  const missing = configured.filter((repo) => !made.includes(repo) && !existsSync(folderOf(repo)));
  for (const repo of made)
    if (!existsSync(folderOf(repo)))
      step("created", `${repo.path}/`, {
        content: "",
        apply: () => mkdirSync(folderOf(repo), { recursive: true }),
      });
  if (layout === "workspace") {
    validateRepoPaths(project, { layout, repos: configured }, true);
    step(existsSync(join(project, ".verid", ".git")) ? "kept" : "created", ".verid/.git/");
  }
  for (const repo of missing) {
    step("created", `${repo.path.replaceAll("\\", "/")}/`);
    notes.push(
      `${repo.path} <- ${repo.remote ?? "(no remote)"}${repo.default_branch ? ` (${repo.default_branch})` : ""}`,
    );
  }
  for (const repo of configured) {
    if (repo.role === "legacy") continue;
    const seen = sees(repo);
    if (!seen) continue;
    const scoped = seen.runners.map((r) => ({
      ...r,
      dir: runnerKey(r, repo.path).slice(r.name.length + 1),
    }));
    notes.push(runnersNote(scoped));
    // By default vitest and jest pick up Playwright's specs, and Playwright their tests.
    const names = seen.runners.map((r) => r.name);
    if (names.includes("playwright") && (names.includes("vitest") || names.includes("jest")))
      notes.push(bilingual("cook.e2e_split", {}));
  }
  // verid's agents come from its plugin, installed on each machine apart from the npm package.
  if (
    claude &&
    effective?.resources !== "repo" &&
    Object.values(roles ?? {}).some((agents) => agents?.some((a) => a.startsWith("verid:")))
  ) {
    const optional = (["architect", "planner", "qa"] as const).some((role) => roles?.[role]);
    notes.push(
      bilingual(optional ? "cook.mapped_roles" : "cook.roles", {
        agents: ROLE_NAMES.flatMap((role) => roles?.[role] ?? []).join(", "),
      }),
    );
  }
  return { configured, missing };
}

/** Which test runners verid sees now, as `vitest, maven (api)`, or that it sees none yet. */
export function runnersNote(runners: readonly Runner[]): string {
  const names = runners.map((r) => (r.dir === "." ? r.name : `${r.name} (${r.dir})`)).join(", ");
  return names ? bilingual("cook.runners", { runners: names }) : bilingual("cook.no_runner", {});
}

/** What `apply` does once the developer agrees: every planned write, then the workspace's repos. */
export function cookApplier(
  p: Planner,
  layout: Layout,
  configured: Repo[],
  missing: Repo[],
  existing: Manifest | null,
): CookPlan["apply"] {
  const { project, paths, writes, machineWrites, checkWritePath } = p;
  return () => {
    for (const write of writes) checkWritePath(write.rel);
    for (const write of machineWrites) checkSetupPath(dirname(write.path), basename(write.path));
    if (layout === "workspace") {
      checkWorkspaceRoot(project);
      validateRepoPaths(project, { layout, repos: configured }, true);
    }
    mkdirSync(paths.dir, { recursive: true });
    for (const w of writes) w.apply();
    for (const w of machineWrites) w.apply();
    const lines: string[] = [];
    const errors: string[] = [];
    if (layout === "workspace") initWorkspaceGit(project);
    const setupRepos =
      layout === "workspace"
        ? configured
        : configured.filter(
            (repo) => missing.includes(repo) || existsSync(cloneMarkerFile(project, repo.path)),
          );
    if (setupRepos.length > 0) {
      let cloned = false;
      for (const repo of setupRepos) {
        const result = cloneMissingRepo(project, repo);
        cloned ||= result.missing;
        if (!result.ok) {
          errors.push(
            bilingual(result.incomplete ? "workspace.incomplete" : "workspace.clone_failed", {
              repo: repo.path,
            }),
          );
          if (result.detail) errors.push(result.detail);
        } else if (result.missing) lines.push(bilingual("workspace.cloned", { repo: repo.path }));
      }
      if (!cloned && errors.length === 0) lines.push(bilingual("workspace.already", {}));
    } else if (existing) lines.push(bilingual("workspace.already", {}));
    return {
      failed: errors.length > 0,
      stdout: lines.length ? `${lines.join("\n")}\n` : "",
      stderr: errors.length ? `${errors.join("\n")}\n` : "",
    };
  };
}
