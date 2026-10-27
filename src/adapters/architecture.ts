import { createHash } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import {
  architectureProblems,
  checkerStatus,
  type ArchitectureProblem,
  type ArchitectureStatus,
  type Snapshot,
} from "../core/architecture.js";
import { canonicalJson } from "../core/canonical-json.js";
import { matchesGlob, mayMatchUnder } from "../core/glob.js";
import { DEFAULT_TIMEOUT_SEC, type Manifest, type Repo } from "../core/manifest.js";
import { fileRole } from "../core/tdd.js";
import { appendAudit } from "./audit-log.js";
import { readState, statePaths, withLock, writeState } from "./state-store.js";
import { runCommand } from "./test-runner.js";

type Check = NonNullable<Repo["architecture_check"]>;

/** The repos whose manifest entry configures an architecture check, with it. */
export const checkedRepos = (manifest: Pick<Manifest, "repos">): { repo: Repo; check: Check }[] =>
  manifest.repos.flatMap((repo) =>
    repo.architecture_check ? [{ repo, check: repo.architecture_check }] : [],
  );

const repoRoot = (project: string, repo: Repo) => resolve(project, ...repo.path.split(/[/\\]/));
const timeoutSec = (repo: Repo, check: Check) =>
  check.timeout_sec ?? repo.timeout_sec ?? DEFAULT_TIMEOUT_SEC;
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** Each configured repo's content, by repo path, as contentOf reads it. */
export type Contents = Readonly<Record<string, Snapshot>>;

/** Reads every configured repo: the long part of a snapshot, done before any lock is taken. */
export const contentsOf = (project: string, manifest: Pick<Manifest, "repos">): Contents =>
  Object.fromEntries(
    checkedRepos(manifest).map(({ repo }) => [repo.path, contentOf(project, repo)]),
  );

/**
 * A repo's snapshot: its content bound to the design and the open module. A repo not read gets a
 * key no result has, so its check reads as stale.
 */
export function bound(content: Snapshot | undefined, binding: string): Snapshot {
  if (content === undefined) return { key: "unread" };
  if ("unavailable" in content) return content;
  return { key: sha256(canonicalJson({ content: content.key, binding })) };
}

/**
 * What a repo's check reads, as one key: every file the manifest makes code or a test, every file a
 * declared input names, the checker's settings and the repo's classification. Folders the ignore
 * globs free are entered only where an input could name a file; `.git` and verid's protected state
 * never are. An input matching nothing, a file that cannot be read and a link out of the repo give
 * no key.
 */
export function contentOf(project: string, repo: Repo): Snapshot {
  const check = repo.architecture_check;
  if (!check) return { unavailable: "no architecture_check" };
  const layout = {
    sourceGlobs: repo.source_globs,
    testGlobs: repo.test_globs,
    ignoreGlobs: repo.ignore_globs ?? [],
    e2eGlobs: repo.e2e_globs ?? [],
  };
  const root = repoRoot(project, repo);
  const protectedState = statePaths(project).dir;
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    return { unavailable: `${repo.path} cannot be read` };
  }
  const files: [string, string][] = [];
  const matched = new Set<string>();
  const linked = new Set<string>();
  const walk = (dir: string, rel: string, auto: boolean): string | null => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return `${rel || repo.path} cannot be read`;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.name === ".git" || relative(protectedState, abs) === "") continue;
      let target: string | null = abs;
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink())
        try {
          target = realpathSync(abs);
          isDir = statSync(target).isDirectory();
        } catch {
          target = null;
        }
      else if (!isDir && !entry.isFile()) continue;
      const inputs = isDir ? [] : check.inputs.filter((g) => matchesGlob(path, g));
      // Code and tests may sit under the folder unless the ignore globs free it whole. A hidden
      // folder is a tool's (.gradle, .import_linter_cache) and its checker rewrites it as it runs.
      // ponytail: code kept in a hidden folder is covered only when an input names it.
      const deeper =
        isDir &&
        auto &&
        !entry.name.startsWith(".") &&
        // Only a glob ending in /** frees every depth; `gen/*` frees gen/'s own files alone.
        !layout.ignoreGlobs.some(
          (g) => g.replaceAll("\\", "/").endsWith("/**") && matchesGlob(`${path}/x`, g),
        ) &&
        [...layout.sourceGlobs, ...layout.testGlobs, ...layout.e2eGlobs].some((g) =>
          mayMatchUnder(path, g),
        );
      const wanted = isDir
        ? deeper || check.inputs.some((g) => mayMatchUnder(path, g))
        : inputs.length > 0 || (auto && fileRole(path, layout) !== "free");
      if (!wanted) continue;
      if (target === null) return `${path} cannot be read`;
      if (entry.isSymbolicLink()) {
        const inside = relative(real, target);
        if (inside.startsWith("..") || isAbsolute(inside))
          return `${path} links outside ${repo.path}`;
        // A link back up the tree is walked once.
        if (isDir) {
          if (linked.has(target)) continue;
          linked.add(target);
        }
      }
      if (isDir) {
        const error = walk(abs, path, deeper);
        if (error) return error;
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = readFileSync(abs);
      } catch {
        return `${path} cannot be read`;
      }
      for (const g of inputs) matched.add(g);
      files.push([path, sha256(bytes)]);
    }
    return null;
  };
  const error = walk(root, "", true);
  if (error) return { unavailable: error };
  const missing = check.inputs.find((g) => !matched.has(g));
  if (missing !== undefined) return { unavailable: `input ${missing} matches no file` };
  files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    key: sha256(
      canonicalJson({
        repo: repo.path,
        check: { ...check, timeout_sec: timeoutSec(repo, check) },
        layout,
        files,
      }),
    ),
  };
}

// Words a shell runs itself; a command starting with one is left to the shell.
const SHELL_WORDS = new Set([
  ".",
  "call",
  "cd",
  "command",
  "echo",
  "exec",
  "exit",
  "export",
  "for",
  "if",
  "pushd",
  "set",
  "source",
  "start",
  "type",
]);

// Any entry but a folder: an App Execution Alias (a Store install) is a link stat cannot follow.
const isProgram = (path: string) => {
  try {
    return !lstatSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Whether the program a command starts can be found, as the shell would look for it: a path from
 * the repo, or a name on PATH (on Windows, from the repo first and with PATHEXT). cmd.exe answers a
 * missing program with exit 1, as a failing check does, so this is asked before running it. A form
 * verid does not read (a built-in, an assignment, a group, `~`) is left to the shell.
 */
export function launchable(command: string, cwd: string): boolean {
  const word = /^\s*(?:"([^"]+)"|(\S+))/.exec(command);
  const program = word?.[1] ?? word?.[2] ?? "";
  if (!/^[\w.:\\/ -]+$/.test(program) || SHELL_WORDS.has(program.toLowerCase())) return true;
  const win = process.platform === "win32";
  const exts = win
    ? ["", ...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)]
    : [""];
  const dirs = /[\\/]/.test(program)
    ? [cwd]
    : [...(win ? [cwd] : []), ...(process.env.PATH ?? "").split(delimiter).filter(Boolean)];
  return dirs.some((dir) => exts.some((ext) => isProgram(resolve(cwd, dir, program + ext))));
}

/** A check's status in a status line, which stays in English. */
export const WORD: Record<ArchitectureProblem["code"], string> = {
  VERID_BURNT_ARCHITECTURE_FAILED: "failed",
  VERID_BURNT_ARCHITECTURE_STALE: "stale",
  VERID_BURNT_ARCHITECTURE_UNAVAILABLE: "unavailable",
};

/**
 * `verid taste`, after a passing suite: run each configured repo's check in its root and record
 * what it showed. A result is recorded only for a snapshot that nothing changed during the run, the
 * TDD revision included (a write the hook saw); otherwise none is, and the check is stale.
 */
export async function runArchitecture(
  project: string,
  manifest: Pick<Manifest, "repos">,
  binding: string,
  run: { id: string; dir: string },
  rev: number,
): Promise<{ lines: string[]; problems: ArchitectureProblem[] }> {
  const repos = checkedRepos(manifest);
  if (repos.length === 0) return { lines: [], problems: [] };
  const snapshotOf = (repo: Repo) => bound(contentOf(project, repo), binding);
  const before = repos.map(({ repo }) => snapshotOf(repo));
  const ran: ({ status: ArchitectureStatus; detail: string; log: string } | null)[] = [];
  for (const [i, { repo, check }] of repos.entries()) {
    if ("unavailable" in before[i]!) {
      ran.push(null);
      continue;
    }
    const cwd = repoRoot(project, repo);
    const log = join(run.dir, `architecture-${i}.log`);
    const seconds = timeoutSec(repo, check);
    if (!launchable(check.command, cwd)) {
      writeFileSync(log, `verid: ${check.command}: the program was not found\n`);
      ran.push({ status: "unavailable", detail: "the command was not found", log });
      continue;
    }
    writeFileSync(log, `verid: architecture check in ${repo.path}: ${check.command}\n`);
    const r = await runCommand(check.command, cwd, log, seconds * 1000);
    const status = checkerStatus(r.exit, r.timedOut);
    const detail =
      status !== "unavailable"
        ? ""
        : r.timedOut
          ? `timed out after ${seconds} s`
          : r.exit === null
            ? "the command did not start"
            : `the command could not run (exit ${r.exit})`;
    ran.push({ status, detail, log });
  }
  const after = repos.map(({ repo }) => snapshotOf(repo));
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    const results = { ...state.architecture };
    const at = new Date().toISOString();
    for (const [i, { repo }] of repos.entries()) {
      const [b, a, r] = [before[i]!, after[i]!, ran[i]];
      if (r && "key" in b && "key" in a && a.key === b.key && state.tdd.rev === rev)
        results[repo.path] = {
          snapshot: b.key,
          status: r.status,
          run: run.id,
          log: relative(project, r.log),
          at,
          detail: r.detail,
        };
    }
    const problems = architectureProblems(
      repos.map(({ repo }, i) => ({ repo: repo.path, snapshot: after[i]! })),
      results,
    );
    const outcome = (repo: Repo) => problems.find((p) => p.repo === repo.path);
    // Audit first: if it fails, state is untouched and no result is recorded.
    appendAudit(paths.audit, {
      event: "architecture_checked",
      run: run.id,
      repos: repos.map(({ repo }) => ({ repo: repo.path, code: outcome(repo)?.code ?? "pass" })),
    });
    writeState(paths, { ...state, architecture: results });
    const lines = repos.map(({ repo }, i) => {
      const problem = outcome(repo);
      const log = ran[i] ? ` · log ${relative(project, ran[i]!.log)}` : "";
      return `verid: architecture ${repo.path} · ${problem ? WORD[problem.code] : "pass"}${log}`;
    });
    return { lines, problems };
  });
}
