import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  repoPathKey,
  safeCloneRemote,
  type Layout,
  type Manifest,
  type Repo,
} from "../core/manifest.js";
import { normalizePath } from "./claude-code.js";
import { errno, statePaths, VeridError } from "./state-store.js";

/** Clone is the developer's interactive command; metadata probes remain bounded and captured. */
export function workspaceGit(cwd: string, args: string[]) {
  const clone = args[0] === "clone";
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    ...(clone ? { stdio: "inherit" as const } : { timeout: 100_000 }),
    env: {
      ...process.env,
      LC_ALL: "C",
      ...(clone && { GIT_ALLOW_PROTOCOL: "https:ssh:git:file" }),
    },
  });
}

export function insideGit(project: string): boolean {
  const result = workspaceGit(project, ["rev-parse", "--is-inside-work-tree"]);
  if (!result.error && result.status === 0) return result.stdout.trim() === "true";
  if (errno(result.error) === "ENOENT" || /not a git repository/i.test(result.stderr ?? ""))
    return false;
  throw new VeridError("VERID_BURNT_INIT_INVALID", {
    path: project,
    detail: "git could not check the layout",
  });
}

/** Detection and validation both ignore a home-folder dotfiles repo around a workspace. */
function nonHomeGitRoot(project: string): string | null {
  const result = workspaceGit(project, ["rev-parse", "--show-toplevel"]);
  if (!result.error && result.status === 0 && result.stdout.trim()) {
    const top = result.stdout.trim();
    return normalizePath(top) === normalizePath(homedir()) ? null : top;
  }
  if (errno(result.error) === "ENOENT" || /not a git repository/i.test(result.stderr ?? ""))
    return null;
  throw new VeridError("VERID_BURNT_INIT_INVALID", {
    path: project,
    detail: "git could not check the workspace root",
  });
}

/** A home-folder dotfiles repo is the only ancestor work tree allowed around a workspace. */
export function checkWorkspaceRoot(project: string): void {
  const invalid = (detail: string) =>
    new VeridError("VERID_BURNT_INIT_INVALID", { path: project, detail });
  if (existsSync(join(project, ".git")))
    throw invalid("a workspace root must not have its own .git; use a plain child folder");
  const top = nonHomeGitRoot(project);
  if (top)
    throw invalid(
      `--layout workspace cannot be used inside ancestor git repo ${top}; use --layout monorepo or move the workspace outside that repo (home-folder dotfiles are allowed)`,
    );
}

/** Only the home-dotfiles ancestor is exempt from automatic git membership detection. */
export function detectLayout(
  project: string,
  requested?: Layout,
): {
  layout: Layout;
  repos: Pick<Repo, "path" | "remote" | "default_branch">[];
} {
  if (
    requested !== "workspace" &&
    insideGit(project) &&
    (existsSync(join(project, ".git")) || nonHomeGitRoot(project) !== null)
  )
    return { layout: "monorepo", repos: [] };
  const repos: Pick<Repo, "path" | "remote" | "default_branch">[] = [];
  for (const entry of readdirSync(project, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const folder = join(project, entry.name);
    if (!existsSync(join(folder, ".git"))) continue;
    repoFolder(project, entry.name);
    if (!entry.isDirectory() || !insideGit(folder))
      throw new VeridError("VERID_BURNT_INIT_INVALID", {
        path: folder,
        detail: "not a usable git repo",
      });
    const remote = workspaceGit(folder, ["remote", "get-url", "origin"]);
    const origin = workspaceGit(folder, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    const branch = origin.status === 0 ? origin.stdout.trim().replace(/^origin\//, "") : undefined;
    repos.push({
      path: entry.name,
      ...(remote.status === 0 &&
        remote.stdout.trim() && { remote: sharedRemote(remote.stdout.trim()) }),
      ...(branch && { default_branch: branch }),
    });
  }
  return { layout: repos.length ? "workspace" : "monorepo", repos };
}

/** Only the conventional passwordless SSH user `git` is retained; all other userinfo is stripped. */
export function sharedRemote(remote: string): string {
  const url = /^([a-z][\w+.-]*:\/\/)([^/?#]+)(.*)$/i.exec(remote);
  if (url) {
    const [, scheme = "", authority = "", rest = ""] = url;
    const at = authority.lastIndexOf("@");
    if (at < 0 || (scheme.toLowerCase() === "ssh://" && authority.slice(0, at) === "git"))
      return remote;
    return `${scheme}${authority.slice(at + 1)}${rest}`;
  }
  const scp = /^([^/\\]+)@([^/\\:]+:.+)$/.exec(remote);
  return scp && scp[1] !== "git" ? scp[2]! : remote;
}

/**
 * A workspace destination must stay inside its root in both spellings. Reject links in every
 * existing component, even a dangling one, before using it for cloning, hooks or runners.
 */
export function repoFolder(project: string, path: string): string {
  return checkedPath(project, path, true);
}

/** Setup files must not redirect writes through linked directories or file links either. */
export function checkSetupPath(project: string, path: string): void {
  checkedPath(project, path, false);
}

function checkedPath(project: string, path: string, directory: boolean): string {
  const folder = resolve(project, ...path.split(/[/\\]/));
  const base = normalizePath(project);
  const target = normalizePath(folder);
  const invalid = () =>
    new VeridError("VERID_BURNT_MANIFEST_INVALID", {
      path: join(project, ".verid", "manifest.yaml"),
      detail: `path ${path} must stay inside the project without links or aliases`,
    });
  if (!target.startsWith(`${base}/`) && !target.startsWith(`${base}\\`)) throw invalid();
  let current = resolve(project);
  const parts = path.split(/[/\\]/);
  for (const [i, part] of parts.entries()) {
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || ((directory || i < parts.length - 1) && !stat.isDirectory()))
        throw invalid();
    } catch (error) {
      if (errno(error) !== "ENOENT") throw error;
    }
  }
  return folder;
}

export function validateRepoPaths(
  project: string,
  manifest: Pick<Manifest, "layout" | "repos">,
  allowMissing = false,
): void {
  for (const [i, repo] of manifest.repos.entries()) {
    const folder =
      manifest.layout === "workspace"
        ? repoFolder(project, repo.path)
        : resolve(project, ...repo.path.split(/[/\\]/));
    if (!allowMissing && !existsSync(folder))
      throw new VeridError("VERID_BURNT_MANIFEST_INVALID", {
        path: join(project, ".verid", "manifest.yaml"),
        detail: `repos.${i}.path: ${folder} is not a directory`,
      });
    if (existsSync(folder) && !statSync(folder).isDirectory())
      throw new VeridError("VERID_BURNT_MANIFEST_INVALID", {
        path: join(project, ".verid", "manifest.yaml"),
        detail: `repos.${i}.path: ${folder} is not a directory`,
      });
  }
}

/** Stable per-repo markers live in protected state, independently of the clone's .git/HEAD. */
export function cloneMarkerFile(project: string, path: string): string {
  const name = createHash("sha256").update(repoPathKey(path)).digest("hex");
  return join(statePaths(project).dir, "clones", `${name}.pending`);
}

/** A resolved HEAD or recreated index alone can hide an interrupted checkout. */
function hasCheckout(folder: string): boolean {
  const head = workspaceGit(folder, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (head.error || head.status !== 0) return false;
  const index = workspaceGit(folder, ["rev-parse", "--git-path", "index"]);
  if (
    index.error ||
    index.status !== 0 ||
    !index.stdout.trim() ||
    !existsSync(resolve(folder, index.stdout.trim()))
  )
    return false;
  const diff = workspaceGit(folder, ["diff", "--cached", "--quiet", "HEAD"]);
  return !diff.error && diff.status === 0;
}

/** Re-check immediately before mutation; existing folders are never replaced. */
export function cloneMissingRepo(
  project: string,
  repo: Repo,
): { ok: boolean; missing: boolean; incomplete?: boolean; detail?: string } {
  const folder = repoFolder(project, repo.path);
  const marker = cloneMarkerFile(project, repo.path);
  const clearMarker = () => {
    checkSetupPath(project, relative(project, marker));
    rmSync(marker, { force: true });
  };
  const existing = () => {
    const ok = existsSync(join(folder, ".git")) && insideGit(folder);
    if (existsSync(marker)) {
      if (!ok || !hasCheckout(folder)) return { ok: false, missing: false, incomplete: true };
      clearMarker();
    }
    return { ok, missing: false };
  };
  if (existsSync(folder)) return existing();
  if (existsSync(marker)) clearMarker();
  if (!repo.remote || !safeCloneRemote(repo.remote)) return { ok: false, missing: true };
  checkSetupPath(project, relative(project, marker));
  mkdirSync(dirname(folder), { recursive: true });
  repoFolder(project, repo.path);
  // Claim exactly this destination. A folder created by somebody else is never ours to remove.
  try {
    mkdirSync(folder);
  } catch (error) {
    if (errno(error) !== "EEXIST") throw error;
    repoFolder(project, repo.path);
    return existing();
  }
  let ok = false;
  let detail: string | undefined;
  try {
    mkdirSync(dirname(marker), { recursive: true });
    // Synchronous and before git: even Ctrl-C leaves a record of this unfinished clone.
    writeFileSync(marker, `${repo.path}\n`);
    const result = workspaceGit(project, [
      "clone",
      ...(repo.default_branch ? ["--branch", repo.default_branch] : []),
      "--",
      repo.remote,
      folder,
    ]);
    ok = !result.error && result.status === 0;
  } catch (error) {
    // A failed spawn has the same retry/cleanup semantics as a nonzero git exit.
    detail = error instanceof Error ? error.message : String(error);
  } finally {
    if (!ok) {
      repoFolder(project, repo.path);
      rmSync(folder, { recursive: true, force: true });
    }
    // Keep the marker if cleanup throws; a completed checkout or absent folder needs none.
    clearMarker();
  }
  return { ok, missing: true, ...(detail !== undefined && { detail }) };
}

export function initWorkspaceGit(project: string): void {
  const folder = join(project, ".verid");
  if (lstatSync(folder).isSymbolicLink())
    throw new VeridError("VERID_BURNT_INIT_INVALID", {
      path: folder,
      detail: "must not be a link",
    });
  if (existsSync(join(folder, ".git"))) {
    if (insideGit(folder)) return;
  } else {
    const result = workspaceGit(folder, ["init", "--quiet"]);
    if (!result.error && result.status === 0) return;
  }
  throw new VeridError("VERID_BURNT_INIT_INVALID", { path: folder, detail: "git init failed" });
}
