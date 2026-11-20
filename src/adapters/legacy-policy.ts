import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import type { Manifest } from "../core/manifest.js";
import { pluginArgs } from "../core/plugin.js";
import { bashWriteTargets, isUnder, plainRead, type PolicyContext } from "../core/policy.js";
import { powershellWriteTargets } from "../core/powershell.js";
import { renderShell, shellSpans, stripBashHeredocs } from "../core/shell-lex.js";
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
const WRAPPERS = new Set(["env", "command", "builtin", "exec", "time", "nohup", "sudo", "xargs"]);
const CHANGES_DIR = new Set(["cd", "pushd", "chdir", "set-location", "sl", "push-location"]);
const POP_DIR = new Set(["popd", "pop-location"]);
const CONTROL = /^(?:(?:if|then|elif|else|fi|while|until|do|done|!|[{}])(?:\s+|$))+/;
const SEPARATOR = /&&|\|\||[;&|()\n]/g;
const POWERSHELL_SEPARATOR = /&&|\|\||[;&|(){}\n]/g;
const REDIRECT = /(?<![<>])(?:(?<!\S)\d+)?(?:>>?|<<?)[ \t]*[^\s;&|<>()]+/g;

function* segments(command: string, spans: ReturnType<typeof shellSpans>, powershell: boolean) {
  const text = renderShell(command, spans, (word, { kind }) =>
    kind === "comment" ? " ".repeat(word.length) : word,
  );
  const syntax = renderShell(text, spans, (word, { kind }) =>
    kind === "comment" ? word : "_".repeat(word.length),
  );
  let start = 0;
  let after = "";
  for (const match of syntax.matchAll(powershell ? POWERSHELL_SEPARATOR : SEPARATOR)) {
    yield { text: text.slice(start, match.index), after, next: match[0] };
    after = match[0];
    start = match.index + match[0].length;
  }
  yield { text: text.slice(start), after, next: "" };
}

const dynamicLocation = /[$`*?[\]{}<>‘’‚‛“”„]|^[-+]|^~./;

function ambiguousPath(path: string, command: string, powershell: boolean): boolean {
  if (dynamicLocation.test(path)) return true;
  if (powershell || !path.includes("\\")) return false;
  return shellSpans(command).some(({ start, end, kind }) =>
    kind === "escape" ||
    (kind === "quote" && command[start] === '"' && /\\["\\$`\n]/.test(command.slice(start, end))),
  );
}

function location(
  program: string,
  args: string[],
  segment: string,
  powershell: boolean,
): string | undefined {
  // Redirections are checked for writes separately from the directory operand.
  if (/[<>]/.test(segment)) {
    const syntax = renderShell(segment, shellSpans(segment, powershell), (word) =>
      "_".repeat(word.length),
    );
    let operands = "";
    let start = 0;
    for (const match of syntax.matchAll(REDIRECT)) {
      operands += `${segment.slice(start, match.index)} `;
      start = match.index + match[0].length;
    }
    if (start > 0) args = words(operands + segment.slice(start)).slice(1);
  }
  const paths = args.filter((arg) => !/^(?:--|-L|-P|-Path|-LiteralPath)$/i.test(arg));
  if (paths.length === 0 && program !== "pushd" && program !== "push-location") return homedir();
  const [target] = paths;
  if (paths.length !== 1 || !target) return undefined;
  return target === "~" ? homedir() : target;
}

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
 * Follow literal working directories through shell and Git options. When a command might have
 * changed directory, only commands that can be verified as reads may run with an unknown cwd.
 */
export function legacyShellWrite(
  command: string,
  cwd: string,
  roots: readonly string[],
  powershell = false,
): string | null {
  const spellings = (path: string) => [normalizePath(path), writtenPath(path)];
  const inside = (path: string) =>
    spellings(path).some((p) => roots.some((root) => isUnder(p, root)));
  // A path that is, or holds, a legacy root: removing or renaming it takes the legacy repo too.
  const holds = (path: string) =>
    spellings(path).some((p) => roots.some((root) => isUnder(p, root) || isUnder(root, p)));
  let dirs: string[] | null = [resolve(cwd)];
  let skipped: string[] = [];
  const unknown = "cannot verify the working directory for writes to the legacy repo";
  const raw = powershell ? command : stripBashHeredocs(command);
  const spans = shellSpans(raw, powershell);
  if (spans.some(({ kind }) => kind === "incomplete")) return unknown;
  for (const { text, after, next } of segments(raw, spans, powershell)) {
    // An && chain runs in the changed directory only if the change succeeded. Later commands
    // may still run when that chain was skipped.
    if (after !== "&&" && skipped.length > 0) {
      if (dirs !== null) dirs = [...new Set([...dirs, ...skipped])];
      skipped = [];
    }
    const trimmed = text.trimStart();
    const segment = trimmed.replace(CONTROL, "");
    const [name, ...args] = words(segment);
    if (name === undefined) continue;
    const program = programOf(name);
    const ps = powershellWriteTargets(segment, powershell);
    for (const target of [...bashWriteTargets(segment), ...ps.targets]) {
      if (powershell && /^\$null$/i.test(target) && plainRead(segment, true)) continue;
      if (dirs === null) return unknown;
      if (dirs.some((dir) => inside(resolve(dir, target))))
        return `writes ${target} in the legacy repo`;
    }
    if (CHANGES_DIR.has(program) || POP_DIR.has(program)) {
      const target =
        POP_DIR.has(program) || next === "(" ? undefined : location(program, args, segment, powershell);
      if (target === undefined || dirs === null || ambiguousPath(target, segment, powershell)) dirs = null;
      else {
        const reached: string[] = isAbsolute(target)
          ? [resolve(target)]
          : dirs.map((dir) => resolve(dir, target));
        if (next === "&&" && after !== "|" && after !== "||") {
          skipped.push(...dirs);
          dirs = reached;
        } else dirs = [...new Set([...dirs, ...reached])];
      }
      continue;
    }
    if (REMOVES.has(program))
      for (const arg of args)
        if (!arg.startsWith("-") && dirs?.some((dir) => holds(resolve(dir, arg))))
          return `${program} ${arg} takes the legacy repo with it`;
    if (program !== "git") {
      if (dirs === null && !plainRead(segment, powershell)) return unknown;
      continue;
    }
    let repos = dirs;
    const elsewhere: string[] = [];
    let sub: string | undefined;
    let at = 0;
    for (; at < args.length; at++) {
      const arg = args[at]!;
      const glued = /^-C(.+)$/.exec(arg)?.[1];
      const option = /^--(?:git-dir|work-tree)(?:=(.*))?$/.exec(arg);
      if (arg === "-C" || glued !== undefined) {
        const folder = glued ?? args[++at] ?? "";
        repos = ambiguousPath(folder, segment, powershell)
          ? null
          : repos?.map((repo) => resolve(repo, folder)) ?? null;
      } else if (option) {
        const folder = option[1] ?? args[++at] ?? "";
        for (const repo of repos ?? []) elsewhere.push(resolve(repo, folder));
      } else if (arg === "-c" || arg === "--exec-path") at++;
      else if (!arg.startsWith("-")) {
        sub = arg;
        break;
      }
    }
    if (sub === undefined || READ_ONLY_GIT.has(sub)) continue;
    if (repos === null) return unknown;
    const named = REWRITES_PATHS.has(sub)
      ? args.slice(at + 1).filter((arg) => !arg.startsWith("-"))
      : [];
    if (
      [...repos, ...elsewhere].some(inside) ||
      repos.some((repo) => named.some((arg) => inside(resolve(repo, arg))))
    )
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
  return {
    legacy: {
      roots,
      shellWrite: (command, powershell) => legacyShellWrite(command, cwd, roots, powershell),
    },
  };
}
