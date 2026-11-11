import { lstatSync, writeFileSync } from "node:fs";
import { delimiter, join, relative, resolve } from "node:path";
import {
  architectureProblems,
  checkerStatus,
  type ArchitectureProblem,
  type ArchitectureStatus,
} from "../core/architecture.js";
import { DEFAULT_TIMEOUT_SEC, type Manifest, type Repo } from "../core/manifest.js";
import { appendAudit } from "./audit-log.js";
import { readState, statePaths, withLock, writeState } from "./state-store.js";
import { runCommand } from "./test-runner.js";

type Check = NonNullable<Repo["architecture_check"]>;

/**
 * The repos whose manifest entry configures an architecture check, with it. A legacy repo is never
 * checked: the command could write there, and the legacy system is only read.
 */
export const checkedRepos = (manifest: Pick<Manifest, "repos">): { repo: Repo; check: Check }[] =>
  manifest.repos.flatMap((repo) =>
    repo.architecture_check && repo.role !== "legacy"
      ? [{ repo, check: repo.architecture_check }]
      : [],
  );

const repoRoot = (project: string, repo: Repo) => resolve(project, ...repo.path.split(/[/\\]/));
const timeoutSec = (repo: Repo, check: Check) =>
  check.timeout_sec ?? repo.timeout_sec ?? DEFAULT_TIMEOUT_SEC;

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
 * what it showed, provided the hook-observed TDD revision stayed unchanged during the run.
 * Results are observations for audit, not closure gates.
 */
export async function runArchitecture(
  project: string,
  manifest: Pick<Manifest, "repos">,
  run: { id: string; dir: string },
  rev: number,
): Promise<{ lines: string[]; problems: ArchitectureProblem[] }> {
  const repos = checkedRepos(manifest);
  if (repos.length === 0) return { lines: [], problems: [] };
  const ran: ({ status: ArchitectureStatus; detail: string; log: string } | null)[] = [];
  for (const [i, { repo, check }] of repos.entries()) {
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
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    const results = { ...state.architecture };
    const at = new Date().toISOString();
    for (const [i, { repo }] of repos.entries()) {
      const r = ran[i];
      if (r && state.tdd.rev === rev)
        results[repo.path] = {
          snapshot: run.id,
          status: r.status,
          run: run.id,
          log: relative(project, r.log),
          at,
          detail: r.detail,
        };
    }
    const problems = architectureProblems(
      repos.map(({ repo }) => ({ repo: repo.path })),
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
