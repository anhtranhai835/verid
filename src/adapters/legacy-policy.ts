import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import type { Manifest } from "../core/manifest.js";
import { pluginArgs } from "../core/plugin.js";
import { bashWriteTargets, isUnder, type PolicyContext } from "../core/policy.js";
import { normalizePath, writtenPath } from "./claude-code.js";

/** What Git may do in a legacy repo: look. Everything else can change a file, the index or a ref. */
const READ_ONLY_GIT = new Set([
  "status",
  "diff",
  "log",
  "show",
  "blame",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "rev-list",
  "grep",
  "cat-file",
  "describe",
  "shortlog",
  "show-ref",
  "for-each-ref",
  "help",
  "version",
]);
/** Git commands that rewrite the files of the paths they are given, wherever Git runs. */
const REWRITES_PATHS = new Set([
  "checkout",
  "switch",
  "restore",
  "reset",
  "clean",
  "rm",
  "mv",
  "apply",
  "stash",
  "revert",
  "cherry-pick",
]);
/** Commands that remove or rename what they are given, so a folder holding the legacy repo goes with it. */
const REMOVES = new Set(["rm", "rmdir", "mv", "unlink", "shred"]);
/** Commands that run another one: the program they run is the one that counts. */
const WRAPPERS = new Set(["env", "command", "exec", "time", "nohup", "sudo", "xargs"]);
const CHANGES_DIR = new Set(["cd", "pushd", "chdir"]);

/** Words of one simple command, quotes grouped as the shell would; blanks split when they cannot be. */
function words(segment: string): string[] {
  let found: string[];
  try {
    found = pluginArgs(segment);
  } catch {
    found = segment.trim().split(/\s+/).filter(Boolean);
  }
  while (found[0] !== undefined && /^[A-Za-z_]\w*=/.test(found[0])) found.shift();
  while (found[0] !== undefined && WRAPPERS.has(programOf(found[0]))) {
    found.shift();
    while (found[0] !== undefined && (found[0].startsWith("-") || /^[A-Za-z_]\w*=/.test(found[0])))
      found.shift();
  }
  return found;
}
const programOf = (word: string): string =>
  basename(word.replaceAll("\\", "/"))
    .toLowerCase()
    .replace(/\.(?:exe|cmd|bat)$/, "");

/**
 * The first thing a Bash command does to a legacy repo, or null. It follows the working directory
 * through `cd`, `-C` and `--git-dir`/`--work-tree`, and judges redirects, the common writing
 * commands and Git. Like every shell rule it reads text: a script, a variable or an alias gets
 * through. Reads, and Git commands that only look, stay allowed.
 */
export function legacyShellWrite(
  command: string,
  cwd: string,
  roots: readonly string[],
): string | null {
  const spellings = (path: string) => [normalizePath(path), writtenPath(path)];
  const inside = (path: string) =>
    spellings(path).some((p) => roots.some((root) => isUnder(p, root)));
  // A path that is, or holds, a legacy root: removing or renaming it takes the legacy repo too.
  const holds = (path: string) =>
    spellings(path).some((p) => roots.some((root) => isUnder(p, root) || isUnder(root, p)));
  let dir = resolve(cwd);
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const [name, ...args] = words(segment);
    if (name === undefined) continue;
    const program = programOf(name);
    if (CHANGES_DIR.has(program)) {
      const target = args.find((arg) => !arg.startsWith("-"));
      dir = target === undefined || target === "~" ? homedir() : resolve(dir, target);
      continue;
    }
    for (const target of bashWriteTargets(segment))
      if (inside(resolve(dir, target))) return `writes ${target} in the legacy repo`;
    if (REMOVES.has(program))
      for (const arg of args)
        if (!arg.startsWith("-") && holds(resolve(dir, arg)))
          return `${program} ${arg} takes the legacy repo with it`;
    if (program !== "git") continue;
    let repo = dir;
    const elsewhere: string[] = [];
    let sub: string | undefined;
    let at = 0;
    for (; at < args.length; at++) {
      const arg = args[at]!;
      const glued = /^-C(.+)$/.exec(arg)?.[1];
      const option = /^--(?:git-dir|work-tree)(?:=(.*))?$/.exec(arg);
      if (arg === "-C" || glued !== undefined) repo = resolve(repo, glued ?? args[++at] ?? "");
      else if (option) elsewhere.push(resolve(repo, option[1] ?? args[++at] ?? ""));
      else if (arg === "-c" || arg === "--exec-path") at++;
      else if (!arg.startsWith("-")) {
        sub = arg;
        break;
      }
    }
    if (sub === undefined || READ_ONLY_GIT.has(sub)) continue;
    const named = REWRITES_PATHS.has(sub)
      ? args.slice(at + 1).filter((arg) => !arg.startsWith("-"))
      : [];
    if ([repo, ...elsewhere].some(inside) || named.some((arg) => inside(resolve(repo, arg))))
      return `git ${sub} in the legacy repo`;
  }
  return null;
}

/** The legacy roots of a reheat manifest, ready for the hook's rules; nothing in any other mode. */
export function legacyPolicy(
  project: string,
  manifest: Pick<Manifest, "mode" | "repos"> | null,
  cwd: string,
): Pick<PolicyContext, "legacy"> {
  if (manifest?.mode !== "reheat") return {};
  const roots = [
    ...new Set(
      manifest.repos
        .filter((repo) => repo.role === "legacy")
        .flatMap((repo) => {
          const folder = resolve(project, ...repo.path.split(/[/\\]/));
          return [normalizePath(folder), writtenPath(folder)];
        }),
    ),
  ];
  if (roots.length === 0) return {};
  return { legacy: { roots, shellWrite: (command) => legacyShellWrite(command, cwd, roots) } };
}
