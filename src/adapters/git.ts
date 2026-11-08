import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { gitCleanAcross } from "../core/auto.js";
import { resolveMain, type RepoFacts, type RootHistory } from "../core/git-convention.js";
import { repoPathKey, type Manifest } from "../core/manifest.js";
import { isSecretPath } from "../core/policy.js";
import type { AutoState } from "../core/state.js";
import { errno } from "./state-store.js";

/**
 * Git as verid reads it: an argument array, never a shell; untranslated, so messages read the
 * same on every machine; without the optional locks the agent's own Git needs; with the objects
 * as they are, not as `refs/replace` would show them; bounded in time and output, where running
 * out counts as a failure.
 */
export function runGit(
  cwd: string,
  args: readonly string[],
  maxBuffer = 16 * 1024 * 1024,
  timeout = 15_000,
) {
  return spawnSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, LC_ALL: "C", GIT_NO_REPLACE_OBJECTS: "1" },
    timeout,
    maxBuffer,
  });
}
const ok = (r: ReturnType<typeof runGit>) => !r.error && r.status === 0;

// Git that has to finish by `deadline`; past it, a failure without running Git.
function runBy(deadline: number, cwd: string, args: readonly string[]) {
  const left = deadline - Date.now();
  if (left <= 0)
    return {
      error: new Error("verid's time for Git ran out"),
      status: null,
      stdout: "",
      stderr: "",
    } as unknown as ReturnType<typeof runGit>;
  return runGit(cwd, args, undefined, Math.min(15_000, left));
}
const failure = (r: ReturnType<typeof runGit>) =>
  r.error
    ? `git did not run: ${errno(r.error) ?? r.error.message}`
    : (r.stderr.trim().split("\n")[0] ?? `git exited ${r.status}`);

/** A folder as one key: the same folder spelled two ways on Windows is one repository. */
export const folderKey = (path: string): string => {
  const full = resolve(path);
  return process.platform === "win32" ? full.toLowerCase() : full;
};

/** The top folder of the repository holding `folder`; null outside one; an error otherwise. */
export function gitTop(folder: string, deadline = Infinity): string | null | { error: string } {
  const r = runBy(deadline, folder, ["rev-parse", "--show-toplevel"]);
  if (ok(r)) return resolve(r.stdout.trim());
  return NOT_A_REPO.test(r.stderr ?? "") ? null : { error: failure(r) };
}

/**
 * The default_branch each manifest repo declares, by the repository top it lives in: a monorepo's
 * paths in one repository declare for that one root.
 */
export function declaredMains(
  project: string,
  manifest: Pick<Manifest, "repos">,
  deadline = Infinity,
): Map<string, string[]> | { error: string } {
  const out = new Map<string, string[]>();
  for (const repo of manifest.repos) {
    if (!repo.default_branch) continue;
    const folder = resolve(project, ...repo.path.split("/"));
    if (!existsSync(folder)) continue;
    const top = gitTop(folder, deadline);
    if (top === null) continue;
    // A declaration verid cannot place must not let main fall back to another branch.
    if (typeof top !== "string") return { error: `default_branch of ${repo.path}: ${top.error}` };
    out.set(folderKey(top), [...(out.get(folderKey(top)) ?? []), repo.default_branch]);
  }
  return out;
}

/** Everything the Git rules read about the repository holding `folder`, before the line runs. */
export function repoFacts(
  folder: string,
  rootDefault: string | undefined,
  declared: () => Map<string, string[]> | { error: string },
  deadline = Infinity,
): RepoFacts | { error: string } {
  if (!existsSync(folder)) return { error: `no folder ${folder}` };
  const where = runBy(deadline, folder, ["rev-parse", "--show-toplevel", "--absolute-git-dir"]);
  if (!ok(where))
    return { error: NOT_A_REPO.test(where.stderr ?? "") ? "not a git repository" : failure(where) };
  const [topLine = ""] = where.stdout.trim().split("\n");
  const top = resolve(topLine);
  const head = runBy(deadline, folder, ["symbolic-ref", "--quiet", "HEAD"]);
  if (!ok(head) && head.status !== 1) return { error: failure(head) };
  const symbolic = ok(head) ? head.stdout.trim() : "";
  const branch = symbolic.startsWith("refs/heads/") ? symbolic.slice("refs/heads/".length) : null;
  const refs = runBy(deadline, folder, [
    "for-each-ref",
    "--format=%(refname)%00%(symref)",
    "refs/heads",
    "refs/tags",
    "refs/remotes",
  ]);
  if (!ok(refs)) return { error: failure(refs) };
  const heads: string[] = [];
  const tags: string[] = [];
  const remoteBranches: string[] = [];
  let originHead: string | null = null;
  for (const line of refs.stdout.split("\n").filter(Boolean)) {
    const [name = "", symref = ""] = line.split("\0");
    if (name.startsWith("refs/heads/")) heads.push(name.slice("refs/heads/".length));
    else if (name.startsWith("refs/tags/")) tags.push(name.slice("refs/tags/".length));
    else if (name === "refs/remotes/origin/HEAD")
      originHead = symref.startsWith("refs/remotes/origin/")
        ? symref.slice("refs/remotes/origin/".length)
        : null;
    else if (name.startsWith("refs/remotes/") && symref === "")
      remoteBranches.push(name.slice("refs/remotes/".length));
  }
  const mains = declared();
  if (!(mains instanceof Map)) return mains;
  return {
    top,
    branch,
    main: resolveMain({
      declared: mains.get(folderKey(top)) ?? [],
      rootDefault,
      originHead,
      heads,
    }),
    heads,
  };
}

export interface GitView {
  clean: boolean;
  head: string | null;
}

// verid's own per-machine settings files change on `verid cook`; they must not make the tree dirty.
const MACHINE_SETTINGS = [":(exclude).claude/settings.local.json", ":(exclude).codex/hooks.json"];
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
      // Untranslated, so "not a git repository" reads the same whatever the machine's language;
      // the objects as they are, not as refs/replace would show them.
      env: { ...process.env, LC_ALL: "C", GIT_NO_REPLACE_OBJECTS: "1" },
    });
  // --no-optional-locks: a hook's status must not take the index lock the agent's git needs.
  // --untracked-files=normal: a new file must count as dirty even where status.showUntrackedFiles=no.
  const status = run([
    "--no-optional-locks",
    "-c",
    "core.fsmonitor=false",
    "status",
    "--porcelain",
    "--untracked-files=normal",
    "--",
    ".",
    ...MACHINE_SETTINGS,
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

/** One Git root of the project: the repo path it is known by, and its top folder. */
export interface WorkRoot {
  repo: string;
  top: string;
}

/**
 * Each Git repository the project's work lands in, once: the project folder and every listed repo
 * in a monorepo (one repository however many paths it holds), or each child repo and `.verid` in a
 * workspace, never the workspace folder itself. Folders outside Git are not roots; a repository
 * Git cannot read is an error.
 */
export function workRoots(
  project: string,
  manifest: Pick<Manifest, "layout" | "repos">,
  deadline = Infinity,
): WorkRoot[] | { repo: string; error: string } {
  const paths = [
    ...new Set(
      manifest.layout === "workspace"
        ? [...manifest.repos.map((r) => r.path), ".verid"]
        : [".", ...manifest.repos.map((r) => r.path)],
    ),
  ];
  const roots: WorkRoot[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const folder = resolve(project, ...path.split("/"));
    if (manifest.layout === "workspace" && !existsSync(join(folder, ".git"))) continue;
    if (!existsSync(folder)) continue;
    const top = gitTop(folder, deadline);
    if (top === null) continue;
    if (typeof top !== "string") return { repo: path, error: top.error };
    if (seen.has(folderKey(top))) continue;
    seen.add(folderKey(top));
    roots.push({ repo: path, top });
  }
  return roots;
}

export type Work = NonNullable<AutoState["work"]>["roots"];

/** Main's commit in each Git root now, where module work begins; a problem when one is unclear. */
export function captureWork(
  project: string,
  manifest: Pick<Manifest, "layout" | "repos" | "git">,
  deadline = Date.now() + 4_000,
): Work | { repo: string; detail: string } {
  const roots = workRoots(project, manifest, deadline);
  if (!Array.isArray(roots)) return { repo: roots.repo, detail: roots.error };
  let declared: Map<string, string[]> | { error: string } | undefined;
  const work: Work = {};
  for (const { repo, top } of roots) {
    const facts = repoFacts(
      top,
      manifest.git?.default_branch,
      () => (declared ??= declaredMains(project, manifest, deadline)),
      deadline,
    );
    if ("error" in facts) return { repo, detail: facts.error };
    if (!facts.main.ok) return { repo, detail: `main: ${facts.main.detail}` };
    const main = facts.main.main;
    const tip = runBy(deadline, top, [
      "rev-parse",
      "--verify",
      "-q",
      `refs/heads/${main}^{commit}`,
    ]);
    if (!ok(tip)) return { repo, detail: `main ${main} has no commit yet` };
    work[repo] = { main, base: tip.stdout.trim() };
  }
  return work;
}

// Enough for any module; a longer range is refused rather than read in part.
const MAX_COMMITS = 500;

/**
 * Each recorded root's commits since its base, read again in full every time. With a `branch`,
 * the auto module's, a root whose HEAD is elsewhere has no history to trust.
 */
export function readHistories(
  project: string,
  work: Work,
  branch?: string,
  deadline = Infinity,
): RootHistory[] {
  return Object.entries(work).map(([repo, { base }]): RootHistory => {
    const folder = resolve(project, ...repo.split("/"));
    const top = existsSync(folder) ? gitTop(folder, deadline) : null;
    if (top === null) return { repo, error: "the repository is gone or no longer in Git" };
    if (typeof top !== "string") return { repo, error: top.error };
    const head = runBy(deadline, top, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]);
    if (!ok(head)) return { repo, error: "HEAD has no commit" };
    if (branch !== undefined) {
      const on = runBy(deadline, top, ["symbolic-ref", "-q", "--short", "HEAD"]);
      const name = ok(on) ? on.stdout.trim() : "a detached HEAD";
      if (name !== branch) return { repo, error: `HEAD is on ${name}, not on ${branch}` };
    }
    const ancestor = runBy(deadline, top, ["merge-base", "--is-ancestor", base, "HEAD"]);
    if (!ok(ancestor) && ancestor.status !== 1)
      return { repo, error: `the recorded base ${base.slice(0, 12)} cannot be read` };
    if (!ok(ancestor)) return { repo, ancestor: false, commits: [] };
    const log = runBy(deadline, top, [
      "log",
      "-z",
      `--max-count=${MAX_COMMITS + 1}`,
      "--format=%H%n%B",
      `${base}..HEAD`,
    ]);
    if (!ok(log)) return { repo, error: failure(log) };
    const commits = log.stdout
      .split("\0")
      .filter((entry) => entry.trim() !== "")
      .map((entry) => {
        const cut = entry.indexOf("\n");
        return { sha: entry.slice(0, cut).trim(), message: entry.slice(cut + 1) };
      });
    if (commits.length > MAX_COMMITS)
      return { repo, error: `more than ${MAX_COMMITS} commits since the recorded base` };
    return { repo, ancestor: true, commits };
  });
}

// What review evidence never shows: the files the secret rule protects, and verid's own state.
const UNSHOWN = [
  "**/.env",
  "**/.env.*",
  "**/.npmrc",
  "**/.pypirc",
  "**/.netrc",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/*credentials*",
  "**/*secret*",
  "**/.ssh/**",
  "**/.codex/auth.json",
  "**/.state/**",
  "**/.verid/review/**",
].map((glob) => `:(exclude,glob,icase)${glob}`);
const LOG_LIMIT = 400_000;

/**
 * A module's work for a reviewer that cannot run Git: for each recorded root, every commit since
 * its base with its full message and its diff, then the uncommitted diff and the names of new
 * files. Secret files and verid's state are left out; it writes nothing.
 */
export function workLog(project: string, work: Work): string[] {
  const lines: string[] = [];
  for (const [repo, { main, base }] of Object.entries(work)) {
    const exclusions = [
      ...UNSHOWN,
      ...(repo === ".verid" ? [":(exclude,glob,icase)review/**"] : []),
    ];
    const folder = resolve(project, ...repo.split("/"));
    const head = runGit(folder, ["rev-parse", "--verify", "-q", "HEAD"]);
    const branch = runGit(folder, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    lines.push(
      `== repo ${repo} · main ${main} · base ${base.slice(0, 12)} · HEAD ${ok(head) ? head.stdout.trim().slice(0, 12) : "?"} (${ok(branch) ? branch.stdout.trim() : "detached"})`,
    );
    const shas = runGit(folder, [
      "rev-list",
      "--reverse",
      `--max-count=${MAX_COMMITS}`,
      `${base}..HEAD`,
    ]);
    if (!ok(shas)) lines.push(`(history unreadable: ${failure(shas)})`);
    for (const sha of ok(shas) ? shas.stdout.split("\n").filter(Boolean) : []) {
      const message = runGit(folder, ["log", "-1", "--format=%B", sha]);
      const diff = runGit(folder, [
        "diff-tree",
        "-p",
        "-r",
        "--root",
        "--no-commit-id",
        "--no-ext-diff",
        "--no-textconv",
        sha,
        "--",
        ".",
        ...exclusions,
      ]);
      lines.push(`--- commit ${sha}`, message.stdout.trimEnd(), "", diff.stdout.trimEnd());
    }
    const changed = runGit(folder, [
      "diff",
      "HEAD",
      "--no-ext-diff",
      "--no-textconv",
      "--",
      ".",
      ...exclusions,
    ]);
    const added = runGit(folder, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
      ...exclusions,
    ]);
    lines.push("--- uncommitted", changed.stdout.trimEnd());
    const names = added.stdout.split("\0").filter((name) => name !== "" && !isSecretPath(name));
    if (names.length > 0) lines.push("--- new files", ...names);
  }
  const text = lines.join("\n");
  return text.length > LOG_LIMIT
    ? [`${text.slice(0, LOG_LIMIT)}`, "(cut: the work history is longer than verid prints)"]
    : lines;
}
