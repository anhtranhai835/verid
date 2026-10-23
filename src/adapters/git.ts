import { spawnSync } from "node:child_process";
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
