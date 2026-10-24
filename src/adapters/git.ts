import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { gitCleanAcross } from "../core/auto.js";
import { repoPathKey, type Manifest } from "../core/manifest.js";
import type { AutoState } from "../core/state.js";
import { errno } from "./state-store.js";

export interface GitView {
  clean: boolean;
  head: string | null;
}

// verid's own per-machine settings file changes on `verid cook`; it must not make the tree dirty.
const MACHINE_SETTINGS = ":(exclude).claude/settings.local.json";
const NOT_A_REPO = /not a git repository/i;

/**
 * The project's tree as git sees it, from the project folder down (a sibling folder in the same
 * repo does not count), with verid's per-machine settings file left out. `head` is null before the
 * first commit. null only where there is no repo to see: git is not installed, or the project is
 * not in a git repo. Any other failure of git counts as not clean, so nothing passes for committed
 * that git could not check.
 */
export function gitView(project: string): GitView | null {
  const run = (args: string[]) =>
    spawnSync("git", args, {
      cwd: project,
      encoding: "utf8",
      windowsHide: true,
      // Untranslated, so "not a git repository" reads the same whatever the machine's language.
      env: { ...process.env, LC_ALL: "C" },
    });
  // --no-optional-locks: a hook's status must not take the index lock the agent's git needs.
  // --untracked-files=normal: a new file must count as dirty even where status.showUntrackedFiles=no.
  const status = run([
    "--no-optional-locks",
    "status",
    "--porcelain",
    "--untracked-files=normal",
    "--",
    ".",
    MACHINE_SETTINGS,
  ]);
  if (errno(status.error) === "ENOENT") return null;
  const ok = !status.error && status.status === 0;
  if (!ok && NOT_A_REPO.test(status.stderr ?? "")) return null;
  const head = run(["rev-parse", "--verify", "-q", "HEAD"]);
  return {
    clean: ok && status.stdout.trim() === "",
    head: !head.error && head.status === 0 ? head.stdout.trim() : null,
  };
}

/** The legacy project subtree plus listed repos, or each workspace repo and .verid itself. */
export function gitTree(
  project: string,
  manifest?: Pick<Manifest, "layout" | "repos">,
  signed?: AutoState["signed"],
): { clean: boolean | null; head: string | null; presence: Record<string, boolean> } {
  const paths =
    manifest?.layout === "workspace"
      ? [...manifest.repos.map((repo) => repo.path), ".verid"]
      : [".", ...(manifest?.repos.map((repo) => repo.path) ?? [])];
  const views = Object.fromEntries(
    [...new Set(paths)].map((path) => {
      const folder = resolve(project, ...path.split(/[/\\]/));
      const view =
        manifest?.layout === "workspace" && !existsSync(join(folder, ".git"))
          ? null
          : gitView(folder);
      return [repoPathKey(path), view];
    }),
  );
  return {
    clean: gitCleanAcross(views, signed?.git_repos ?? { ".": signed?.git ?? false }),
    head: Object.values(views).every((view) => view === null)
      ? null
      : JSON.stringify(
          Object.entries(views)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([path, view]) => [path, view?.head ?? null]),
        ),
    presence: Object.fromEntries(
      Object.entries(views).map(([path, view]) => [path, view !== null]),
    ),
  };
}
