import type { PolicyDecision, RuleCode } from "./errors.js";

/** Work branches start with one of these, then a slash and a name. */
export const WORK_PREFIXES = ["feat", "fix", "chore", "docs", "refactor", "test"] as const;
const WORK_BRANCH = new RegExp(`^(?:${WORK_PREFIXES.join("|")})/.+$`);

export const isWorkBranch = (name: string): boolean => WORK_BRANCH.test(name);

// Conventional Commits 1.0: `<type>[(scope)][!]: <description>`, then a blank line before any body.
const HEADER = /^[A-Za-z]+(?:\([^()\s][^()]*\))?!?: \S/;

/** Whether a full commit message has a Conventional Commit header and a blank line after it. */
export function isConventionalCommit(message: string): boolean {
  const lines = message.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  return HEADER.test(lines[0] ?? "") && (lines.length === 1 || lines[1] === "");
}

export interface Word {
  text: string;
  /**
   * The shell computes it at run time: a variable, a substitution, a glob, `~`, or a backslash
   * outside quotes, which Bash and PowerShell read differently.
   */
  dynamic: boolean;
}

/** One Git command a shell line runs, as far as the line itself shows it. */
export interface GitCall {
  /** Literal folders it runs from, in order: each `cd` before it, then each `-C`. */
  dirs: string[];
  /** The subcommand and its words. */
  args: Word[];
  /** Why verid cannot tell where or how it runs; null when the line shows it. */
  unresolved: string | null;
  /** The operator after it: `&&`, `;`, newline, `||`, `|`, `&`, a parenthesis, or "" at the end. */
  then: string;
}

type Token = { word: Word; target?: true } | { op: string };

const REDIRECT = /^(?:<<<|<<-|<<|>>|>&|<&|&>>|&>|>\||<>|<|>)/;
const OPERATOR = /^(?:&&|\|\||;;|\|&|[;|&()])/;

/** How a shell reads quotes and escapes: Bash, or PowerShell (which Codex uses on Windows). */
export type ShellSyntax = "bash" | "powershell";

/**
 * The words and operators of a shell line, quotes removed. A heredoc body and a comment are not
 * read; a redirection target is marked, since it is not an argument. In PowerShell a backslash is
 * an ordinary character, a backtick escapes, quotes double to escape and here-strings are data.
 */
function tokenize(line: string, syntax: ShellSyntax = "bash"): Token[] {
  const ps = syntax === "powershell";
  // PowerShell takes typographic quotes as quotes.
  const s = ps
    ? line.replace(/[\u201C\u201D\u201E]/g, '"').replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    : line;
  const out: Token[] = [];
  let word: Word | null = null;
  let target = false;
  let heredoc: { strip: boolean } | null = null;
  const bodies: { delim: string; strip: boolean }[] = [];
  const open = (): Word => (word ??= { text: "", dynamic: false });
  const finish = () => {
    if (word === null) return;
    if (heredoc) bodies.push({ delim: word.text, ...heredoc });
    else out.push(target ? { word, target: true } : { word });
    heredoc = null;
    target = false;
    word = null;
  };
  // `$(...)` or `${...}`, nested and quoted parts included, as one dynamic run of the word.
  const balanced = (i: number, close: string): number => {
    const openChar = s[i];
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === (ps ? "`" : "\\"))
        j++; // an escaped character is not a quote or a bracket
      else if (s[j] === "'" || s[j] === '"')
        j = s.indexOf(s[j]!, j + 1) === -1 ? s.length : s.indexOf(s[j]!, j + 1);
      else if (s[j] === openChar) depth++;
      else if (s[j] === close && --depth === 0) return j + 1;
    }
    return s.length;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    const rest = s.slice(i);
    if ((ps ? /^`\r?\n/ : /^\\\r?\n/).test(rest)) {
      i += rest[1] === "\r" ? 3 : 2; // a line joined to the next
    } else if (ps && word === null && /^@(["'])\r?\n/.test(rest)) {
      // A here-string: everything up to a line that starts with its closing quote and @.
      const quote = rest[1]!;
      const end = s.indexOf(`\n${quote}@`, i);
      const w = open();
      const body = s.slice(s.indexOf("\n", i) + 1, end === -1 ? s.length : end).replace(/\r$/, "");
      w.text += body;
      if (end === -1 || (quote === '"' && /[$`]/.test(body))) w.dynamic = true;
      i = end === -1 ? s.length : end + 3;
    } else if (c === " " || c === "\t" || c === "\r") {
      finish();
      i++;
    } else if (c === "\n") {
      finish();
      out.push({ op: "\n" });
      i++;
      for (const { delim, strip } of bodies.splice(0)) {
        for (;;) {
          const end = s.indexOf("\n", i);
          const line = s.slice(i, end === -1 ? s.length : end).replace(/\r$/, "");
          i = end === -1 ? s.length : end + 1;
          if ((strip ? line.replace(/^\t+/, "") : line) === delim || end === -1) break;
        }
      }
    } else if (c === "#" && word === null) {
      while (i < s.length && s[i] !== "\n") i++;
    } else if (REDIRECT.test(rest) && !(c === "&" && rest[1] === "&")) {
      const op = REDIRECT.exec(rest)![0];
      // `2>` names a file descriptor, not a word.
      const fd = word as Word | null;
      if (fd !== null && /^\d+$/.test(fd.text) && !fd.dynamic) word = null;
      else finish();
      if (op === "<<" || op === "<<-") heredoc = { strip: op === "<<-" };
      else target = true;
      i += op.length;
    } else if (OPERATOR.test(rest)) {
      const op = OPERATOR.exec(rest)![0];
      finish();
      out.push({ op });
      i += op.length;
    } else if (c === "'") {
      const w = open();
      let j = i + 1;
      for (;;) {
        const end = s.indexOf("'", j);
        w.text += s.slice(j, end === -1 ? s.length : end);
        if (end === -1) w.dynamic = true;
        j = end === -1 ? s.length : end + 1;
        // PowerShell writes a quote inside single quotes as two.
        if (!(ps && s[j] === "'")) break;
        w.text += "'";
        j++;
      }
      i = j;
    } else if (!ps && c === "$" && rest[1] === "'") {
      // ANSI-C quoting: backslash escapes, and the shell decodes them at run time.
      const w = open();
      w.dynamic = true;
      i += 2;
      while (i < s.length && s[i] !== "'") {
        const esc =
          /^\\(?:x([0-9a-fA-F]{1,2})|([0-7]{1,3})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8})|([\s\S]))/.exec(
            s.slice(i),
          );
        if (esc === null) {
          w.text += s[i];
          i++;
          continue;
        }
        const hex = esc[1] ?? esc[3] ?? esc[4];
        w.text += hex
          ? String.fromCodePoint(parseInt(hex, 16))
          : esc[2]
            ? String.fromCharCode(parseInt(esc[2], 8))
            : (esc[5] ?? "");
        i += esc[0].length;
      }
      i++;
    } else if (c === '"') {
      const w = open();
      i++;
      while (i < s.length && !(s[i] === '"' && !(ps && s[i + 1] === '"'))) {
        if (ps && s[i] === '"') {
          w.text += '"'; // a doubled quote
          i += 2;
        } else if (ps && s[i] === "`") {
          w.text += s[i + 1] ?? "";
          w.dynamic = true;
          i += 2;
        } else if (!ps && s[i] === "\\" && /[$`"\\\n]/.test(s[i + 1] ?? "")) {
          if (s[i + 1] !== "\n") w.text += s[i + 1];
          i += 2;
        } else if (s[i] === "$" && (s[i + 1] === "(" || s[i + 1] === "{")) {
          const end = balanced(i + 1, s[i + 1] === "(" ? ")" : "}");
          w.text += s.slice(i, end);
          w.dynamic = true;
          i = end;
        } else {
          if (s[i] === "$" || (!ps && s[i] === "`")) w.dynamic = true;
          w.text += s[i];
          i++;
        }
      }
      if (i >= s.length) w.dynamic = true;
      i++;
    } else if (c === "$" && (rest[1] === "(" || rest[1] === "{")) {
      const end = balanced(i + 1, rest[1] === "(" ? ")" : "}");
      const w = open();
      w.text += s.slice(i, end);
      w.dynamic = true;
      i = end;
    } else if (ps && (c === "`" || c === "\\")) {
      // A PowerShell escape, or a backslash, which PowerShell keeps as it is.
      const w = open();
      if (c === "`") w.dynamic = true;
      w.text += c === "`" ? (s[i + 1] ?? "") : c;
      i += c === "`" ? 2 : 1;
    } else if (c === "`") {
      const end = s.indexOf("`", i + 1);
      const w = open();
      w.text += s.slice(i, end === -1 ? s.length : end + 1);
      w.dynamic = true;
      i = end === -1 ? s.length : end + 1;
    } else if (c === "\\") {
      const w = open();
      w.text += s[i + 1] ?? "";
      w.dynamic = true;
      i += 2;
    } else {
      const fresh = word === null;
      const w = open();
      if (c === "$" && /[\w{(@*#?!$:-]/.test(rest[1] ?? "")) w.dynamic = true;
      if ("*?[".includes(c) || (c === "~" && fresh)) w.dynamic = true;
      if (ps && c === "@" && fresh && /[A-Za-z_]/.test(rest[1] ?? "")) w.dynamic = true;
      w.text += c;
      i++;
    }
  }
  finish();
  return out;
}

const RESERVED = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "do",
  "done",
  "while",
  "until",
  "for",
  "select",
  "case",
  "esac",
  "function",
  "!",
  "{",
  "}",
]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const GIT_VARIABLE = /^(?:\$?env:)?GIT_\w/i;
// Git's own variables, and the folders it reads global configuration from.
const SELECTS_GIT =
  /^(?:\$?env:)?(?:GIT_\w|(?:HOME|XDG_CONFIG_HOME|USERPROFILE|EDITOR|VISUAL|PAGER)(?:=|$))/i;
const CD = new Set(["cd", "chdir", "pushd", "set-location", "sl", "push-location"]);
const POP = new Set(["popd", "pop-location"]);
const WRAPPERS = new Set(["command", "exec", "nohup", "time"]);
const GIT_PROGRAM = /^git(?:\.exe)?$/i;
// Global options that change nothing about which repository or ref a command reaches.
const HARMLESS_GLOBALS = new Set([
  "--no-pager",
  "-P",
  "-p",
  "--paginate",
  "--no-optional-locks",
  "--literal-pathspecs",
  "--glob-pathspecs",
  "--noglob-pathspecs",
  "--icase-pathspecs",
  "--no-replace-objects",
  "--no-lazy-fetch",
  "--no-advice",
]);
// Global options that print something and run no subcommand.
const INFO_GLOBALS = new Set([
  "--version",
  "-v",
  "--help",
  "-h",
  "--html-path",
  "--man-path",
  "--info-path",
  "--exec-path",
]);
// A `cd` takes effect for the next command only when both run in this shell, one after the other.
const SEQUENTIAL = new Set(["", ";", "\n", "&&"]);

/**
 * Every literal Git call in a shell line: `git` or `git.exe` by any path, after leading
 * assignments and the `env`, `command`, `exec`, `nohup` and `time` wrappers, with literal `cd`
 * and `-C` folders. Quoted text, comments and heredoc bodies are data. No shell is interpreted:
 * control flow, grouping, Git variables, a lost working folder, Git options that pick another
 * repository and computed words make a call unresolved. Scripts, aliases, functions and
 * substitutions that run Git out of sight are not found.
 */
export function gitCalls(command: string, syntax: ShellSyntax = "bash"): GitCall[] {
  const calls: GitCall[] = [];
  let dirs: string[] = [];
  let cwdKnown = true;
  let flow = false;
  let gitEnv = false;
  let words: Word[] = [];
  let before = "";
  const analyze = (after: string) => {
    let i = 0;
    while (i < words.length && !words[i]!.dynamic && RESERVED.has(words[i]!.text)) {
      flow = true;
      i++;
    }
    let wrapperOption = false;
    let computedPrefix = false;
    for (;;) {
      const w = words[i];
      if (w === undefined || (w.dynamic && !ASSIGNMENT.test(w.text))) break;
      const name = w.text.toLowerCase();
      if (ASSIGNMENT.test(w.text)) {
        if (SELECTS_GIT.test(w.text)) gitEnv = true;
        // A value computed at run time is the environment of this one command.
        else if (w.dynamic) computedPrefix = true;
        i++;
      } else if (name === "env" || WRAPPERS.has(name)) {
        i++;
        while (
          words[i]?.text.startsWith("-") ||
          (name === "env" && ASSIGNMENT.test(words[i]?.text ?? ""))
        ) {
          const option = words[i]!.text;
          if (name === "command" && /^-[vV]$/.test(option)) return; // looks the name up, runs nothing
          if (option.startsWith("-")) wrapperOption = true;
          else if (SELECTS_GIT.test(option)) gitEnv = true;
          i++;
        }
      } else break;
    }
    // A wrapper's options may take a value (`env -C dir`): Git anywhere after them counts.
    // Escapes and quotes still spell git: the call is found, and judged unresolved.
    const isGit = (w: Word) => GIT_PROGRAM.test(w.text.split(/[\\/]/).at(-1) ?? "");
    if (wrapperOption && words[i] && !isGit(words[i]!)) {
      const later = words.findIndex((w, k) => k > i && isGit(w));
      if (later !== -1) i = later;
    }
    const program = words[i];
    if (program === undefined) return;
    const name = program.text.toLowerCase();
    const rest = words.slice(i + 1);
    if (!isGit(program)) {
      if ([program, ...rest].some((w) => SELECTS_GIT.test(w.text))) gitEnv = true;
      if (CD.has(name)) {
        const path = rest[0];
        const literal =
          rest.length === 1 && !path!.dynamic && path!.text !== "" && !path!.text.startsWith("-");
        if (literal && cwdKnown && SEQUENTIAL.has(before) && SEQUENTIAL.has(after))
          dirs = [...dirs, path!.text];
        else cwdKnown = false;
      } else if (POP.has(name)) cwdKnown = false;
      return;
    }
    const call: GitCall = { dirs: [...dirs], args: [], unresolved: null, then: after };
    const reasons: string[] = [];
    let j = 0;
    for (; j < rest.length; j++) {
      const w = rest[j]!;
      if (w.dynamic) break;
      if (w.text === "-C") {
        const path = rest[++j];
        if (path === undefined || path.dynamic) reasons.push("dynamic folder");
        else call.dirs.push(path.text);
      } else if (INFO_GLOBALS.has(w.text)) return;
      else if (w.text.startsWith("-")) {
        if (!HARMLESS_GLOBALS.has(w.text)) reasons.push(`git option ${w.text}`);
      } else break;
    }
    const sub = rest[j];
    if (sub === undefined) return;
    call.args = rest.slice(j);
    const why = [
      flow && "control flow",
      gitEnv && "git environment",
      !cwdKnown && "working folder",
      wrapperOption && "wrapper option",
      computedPrefix && "git environment",
      ...reasons,
      (sub.dynamic || program.dynamic) && "dynamic command",
    ].find((r) => typeof r === "string");
    call.unresolved = why ?? null;
    calls.push(call);
  };
  for (const token of tokenize(command, syntax)) {
    if ("op" in token) {
      if (token.op === "(" || token.op === ")") flow = true;
      analyze(token.op);
      words = [];
      before = token.op;
    } else if (!token.target) words.push(token.word);
  }
  analyze("");
  return calls;
}

/** One repository as a Git call finds it before the line runs, read offline by the adapter. */
export interface RepoFacts {
  /** The repository's top folder: one repository however a call reaches it. */
  top: string;
  /** The branch checked out; null when HEAD is detached. */
  branch: string | null;
  /** The branch a rebase in progress will update; absent outside one. */
  rebasing?: string | null;
  main: MainIdentity;
  heads: readonly string[];
  tags: readonly string[];
  /** Remote-tracking branches, as `origin/x`. */
  remoteBranches: readonly string[];
  /** Values of push.default and the remote.*, branch.* and alias.* variables, by Git's key. */
  config: Readonly<Record<string, readonly string[]>>;
}
export type CallFacts = RepoFacts | { error: string } | null;

// Subcommands that write no branch ref, keep the checked-out branch and run nothing else.
const HARMLESS = new Set([
  "add",
  "rm",
  "mv",
  "restore",
  "status",
  "log",
  "diff",
  "show",
  "ls-files",
  "ls-tree",
  "ls-remote",
  "rev-parse",
  "rev-list",
  "blame",
  "annotate",
  "grep",
  "describe",
  "shortlog",
  "cat-file",
  "show-ref",
  "show-branch",
  "for-each-ref",
  "name-rev",
  "merge-base",
  "reflog",
  "whatchanged",
  "help",
  "version",
  "var",
  "check-ignore",
  "check-attr",
  "check-ref-format",
  "check-mailmap",
  "cherry",
  "range-diff",
  "diff-tree",
  "diff-files",
  "diff-index",
  "count-objects",
  "fsck",
  "verify-commit",
  "verify-tag",
  "archive",
  "format-patch",
  "clean",
  "clone",
  "tag",
  "notes",
  "gc",
  "prune",
  "maintenance",
  "sparse-checkout",
  "apply",
  "hash-object",
  "write-tree",
  "commit-tree",
  "mktree",
  "mktag",
  "pack-refs",
  "repack",
  "rerere",
  "bundle",
  "interpret-trailers",
  "stripspace",
  "update-index",
  "patch-id",
]);
// Subcommands verid does not follow: they rewrite or send refs in bulk, or run other commands.
const OPAQUE = new Set([
  "filter-branch",
  "filter-repo",
  "fast-import",
  "send-pack",
  "http-push",
  "replace",
  "gui",
  "citool",
  "p4",
  "svn",
  "difftool",
  "mergetool",
]);

/** Whether a call needs its repository's facts: anything but a subcommand that changes no ref. */
export const needsFacts = (call: GitCall): boolean => call.unresolved === null && !isHarmless(call);
export const isHarmless = (call: GitCall): boolean =>
  !call.args[0]!.dynamic &&
  HARMLESS.has(call.args[0]!.text) &&
  // `--output` makes log, diff and friends write a file of the agent's choosing.
  !call.args.some(
    (w) =>
      /^--output(?:-directory)?(?:=|$)/.test(w.text) ||
      (call.args[0]!.text === "format-patch" && /^-o/.test(w.text)),
  );

interface Denial {
  code: RuleCode;
  target: string;
}
/** What a call leaves behind in its repository, when it succeeds. */
interface Effect {
  /** The branch it checks out; null detaches HEAD. */
  to?: string | null;
  rename?: [string, string];
  /** It changes HEAD in a way verid does not follow. */
  unknown?: boolean;
  /** It changes Git configuration: upstreams, remotes, push mappings or aliases. */
  config?: boolean;
}
interface Repo {
  facts: RepoFacts;
  /** The branches HEAD may be on by now; null for a detached HEAD. */
  branches: (string | null)[];
  unknown: boolean;
}
// Unresolved first: it cannot be overridden, so overriding another rule must not hide it.
const PRIORITY: RuleCode[] = [
  "VERID_BURNT_GIT_UNRESOLVED",
  "VERID_BURNT_GIT_MAIN_COMMIT",
  "VERID_BURNT_AUTO_WAITING_MERGE",
  "VERID_BURNT_GIT_PROTECTED_PUSH",
  "VERID_BURNT_GIT_BRANCH_NAME",
];
const REASONS: Partial<Record<RuleCode, string>> = {
  VERID_BURNT_GIT_UNRESOLVED: "Git command verid cannot resolve",
  VERID_BURNT_GIT_MAIN_COMMIT: "changes main's history",
  VERID_BURNT_AUTO_WAITING_MERGE:
    "changes or pushes the branch of the module waiting for its merge",
  VERID_BURNT_GIT_PROTECTED_PUSH: "pushes to a protected ref",
  VERID_BURNT_GIT_BRANCH_NAME: "work branch without an agreed prefix",
};

/**
 * The Git rules on each call of a shell line, in order: main's history is the developer's, work
 * branches carry an agreed prefix, pushes never reach a protected ref, and what verid cannot
 * resolve is refused. Each call is judged on the branches the line may have left it on: after
 * `&&` the earlier call succeeded, after `;` or a newline it may have failed, and after any other
 * operator verid cannot tell. One decision per denied call; a rule in `lifted` gives way. A
 * `frozen` branch, the auto module's while it waits for the developer's merge, keeps its history
 * as main does.
 */
export function decideGit(
  calls: readonly GitCall[],
  facts: readonly CallFacts[],
  rules: { protectedRefs: readonly string[]; frozen?: string },
  lifted: ReadonlySet<RuleCode>,
): PolicyDecision[] {
  const repos = new Map<string, Repo>();
  let configChanged = false;
  const out: PolicyDecision[] = [];
  calls.forEach((call, k) => {
    if (isHarmless(call)) return;
    const text = `git ${call.args.map((w) => w.text).join(" ")}`;
    const shown = text.length > 160 ? `${text.slice(0, 160)}…` : text;
    const f = facts[k] ?? null;
    let denials: Denial[];
    if (call.unresolved !== null) denials = [unresolved(call.unresolved)];
    else if (call.args[0]!.text !== "commit" && call.args.slice(1).some((w) => w.dynamic))
      denials = [unresolved(`computed argument to git ${call.args[0]!.text}`)];
    else if (f === null || "error" in f) denials = [unresolved(f?.error ?? "no repository facts")];
    else {
      const repo = repos.get(f.top) ?? { facts: f, branches: [f.branch], unknown: false };
      const judged = judgeCall(call, repo, rules, configChanged);
      denials = judged.denials;
      const { effect } = judged;
      if (effect.config) configChanged = true;
      let next = repo;
      if (effect.unknown || effect.to !== undefined || effect.rename) {
        const after: Repo = effect.unknown
          ? { ...repo, unknown: true }
          : {
              ...repo,
              branches:
                effect.to !== undefined
                  ? [effect.to]
                  : repo.branches.map((b) => (b === effect.rename![0] ? effect.rename![1] : b)),
            };
        next =
          call.then === "&&"
            ? after
            : SEQUENTIAL.has(call.then)
              ? {
                  ...after,
                  branches: [...new Set([...repo.branches, ...after.branches])],
                  unknown: repo.unknown || after.unknown,
                }
              : { ...repo, unknown: true };
      }
      repos.set(f.top, next);
    }
    const hit = PRIORITY.flatMap((code) =>
      denials.filter((d) => d.code === code && !lifted.has(code)),
    )[0];
    if (hit)
      out.push({
        kind: "deny",
        code: hit.code,
        target: `${hit.target} · ${shown}`,
        reason: REASONS[hit.code] ?? "git",
      });
  });
  return out;
}

const unresolved = (target: string): Denial => ({ code: "VERID_BURNT_GIT_UNRESOLVED", target });

interface Scanned {
  flags: Set<string>;
  values: Map<string, string>;
  pos: Word[];
  unknown: string[];
  dynamic: boolean;
}

/**
 * A subcommand's words split into options and positional words, by the options it is known to
 * take: `valued` take a value, as the next word, after `=`, or attached to a short option.
 * Everything after `--` is positional.
 */
function scan(
  words: readonly Word[],
  flags: readonly string[],
  valued: readonly string[] = [],
): Scanned {
  const known = new Set(flags);
  const takes = new Set(valued);
  const out: Scanned = {
    flags: new Set(),
    values: new Map(),
    pos: [],
    unknown: [],
    dynamic: false,
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w.dynamic) {
      out.dynamic = true;
      out.pos.push(w);
    } else if (w.text === "--") {
      out.pos.push(...words.slice(i + 1));
      out.dynamic ||= words.slice(i + 1).some((x) => x.dynamic);
      break;
    } else if (!w.text.startsWith("-") || w.text === "-") out.pos.push(w);
    else if (w.text.startsWith("--") && w.text.includes("=")) {
      const name = w.text.slice(0, w.text.indexOf("="));
      if (known.has(name) || takes.has(name)) out.values.set(name, w.text.slice(name.length + 1));
      else out.unknown.push(name);
    } else if (takes.has(w.text)) {
      const value = words[++i];
      if (value?.dynamic) out.dynamic = true;
      out.values.set(w.text, value?.text ?? "");
    } else if (known.has(w.text)) out.flags.add(w.text);
    else if (!w.text.startsWith("--") && takes.has(w.text.slice(0, 2)))
      out.values.set(w.text.slice(0, 2), w.text.slice(2));
    else if (
      /^-[a-zA-Z]{2,}$/.test(w.text) &&
      [...w.text.slice(1)].every((c) => known.has(`-${c}`))
    )
      for (const c of w.text.slice(1)) out.flags.add(`-${c}`);
    else out.unknown.push(w.text);
  }
  return out;
}
const has = (s: Scanned, ...names: string[]) =>
  names.some((n) => s.flags.has(n) || s.values.has(n));

const yes = (value: string | undefined) => /^(?:true|yes|on|1)$/i.test(value ?? "");
// A refspec pattern's `*` matches any part of a ref name, slashes included.
// Ref names compare without case: on Windows, refs/heads/MAIN is main's own file.
const matches = (patternIn: string, refIn: string) => {
  const pattern = patternIn.toLowerCase();
  const ref = refIn.toLowerCase();
  return pattern.includes("*")
    ? new RegExp(
        `^${pattern
          .split("*")
          .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*")}$`,
      ).test(ref)
    : pattern === ref;
};

const PUSH_FLAGS = [
  "-q",
  "--quiet",
  "-v",
  "--verbose",
  "--progress",
  "--no-progress",
  "-n",
  "--dry-run",
  "--porcelain",
  "-f",
  "--force",
  "--force-if-includes",
  "--no-force-if-includes",
  "--force-with-lease",
  "--no-force-with-lease",
  "--atomic",
  "--no-atomic",
  "--no-verify",
  "--verify",
  "-u",
  "--set-upstream",
  "--thin",
  "--no-thin",
  "--signed",
  "--no-signed",
  "--follow-tags",
  "--no-follow-tags",
  "--tags",
  "--all",
  "--branches",
  "--mirror",
  "-d",
  "--delete",
  "--prune",
  "-4",
  "-6",
  "--ipv4",
  "--ipv6",
  "--no-recurse-submodules",
  "--recurse-submodules",
];
const FETCH_FLAGS = [
  "-q",
  "--quiet",
  "-v",
  "--verbose",
  "--all",
  "--prune",
  "-p",
  "--prune-tags",
  "-P",
  "--tags",
  "-t",
  "--no-tags",
  "-n",
  "--force",
  "-f",
  "--dry-run",
  "--progress",
  "--no-progress",
  "--unshallow",
  "--update-shallow",
  "--multiple",
  "--atomic",
  "--append",
  "-a",
  "--keep",
  "-k",
  "--no-write-fetch-head",
  "--write-fetch-head",
  "--set-upstream",
  "--no-recurse-submodules",
  "--recurse-submodules",
  "-4",
  "-6",
  "--ipv4",
  "--ipv6",
  "--show-forced-updates",
  "--no-show-forced-updates",
  "--auto-gc",
  "--no-auto-gc",
  "--auto-maintenance",
  "--no-auto-maintenance",
  "--porcelain",
  "--refetch",
];
const FETCH_VALUED = [
  "--depth",
  "--deepen",
  "--shallow-since",
  "--shallow-exclude",
  "-j",
  "--jobs",
  "-o",
  "--server-option",
  "--negotiation-tip",
  "--filter",
  "--recurse-submodules-default",
  "--submodule-prefix",
];
const RESET_SAFE = new Set([
  "--soft",
  "--mixed",
  "--hard",
  "--merge",
  "--keep",
  "-q",
  "--quiet",
  "--no-refresh",
  "--refresh",
  "-N",
  "--intent-to-add",
  "-p",
  "--patch",
  "--recurse-submodules",
  "--no-recurse-submodules",
  "--pathspec-file-nul",
]);
const BRANCH_FLAGS = [
  "-d",
  "-D",
  "--delete",
  "-m",
  "-M",
  "--move",
  "-c",
  "-C",
  "--copy",
  "-f",
  "--force",
  "-r",
  "--remotes",
  "-a",
  "--all",
  "-l",
  "--list",
  "-v",
  "-vv",
  "--verbose",
  "-q",
  "--quiet",
  "-t",
  "--track",
  "--no-track",
  "--create-reflog",
  "--show-current",
  "--unset-upstream",
  "--edit-description",
  "--recurse-submodules",
  "-i",
  "--ignore-case",
  "--omit-empty",
  "--color",
  "--no-color",
  "--column",
  "--no-column",
  "--abbrev",
  "--no-abbrev",
  "--contains",
  "--no-contains",
  "--merged",
  "--no-merged",
];
const BRANCH_VALUED = ["-u", "--set-upstream-to", "--points-at", "--sort", "--format"];
// Only these switch `git branch` to listing; any other option still creates, moves or deletes.
const BRANCH_LIST = [
  "-l",
  "--list",
  "--contains",
  "--no-contains",
  "--merged",
  "--no-merged",
  "--points-at",
];
const CHECKOUT_FLAGS = [
  "-q",
  "--quiet",
  "-f",
  "--force",
  "--ours",
  "--theirs",
  "-m",
  "--merge",
  "--detach",
  "-p",
  "--patch",
  "--progress",
  "--no-progress",
  "-t",
  "--track",
  "--no-track",
  "--guess",
  "--no-guess",
  "-l",
  "--ignore-skip-worktree-bits",
  "--overlay",
  "--no-overlay",
  "--recurse-submodules",
  "--no-recurse-submodules",
  "--ignore-other-worktrees",
  "--overwrite-ignore",
  "--no-overwrite-ignore",
  "--pathspec-file-nul",
  "--conflict",
  "--pathspec-from-file",
];
const SWITCH_FLAGS = [
  "-q",
  "--quiet",
  "-f",
  "--force",
  "--discard-changes",
  "-m",
  "--merge",
  "--progress",
  "--no-progress",
  "-t",
  "--track",
  "--no-track",
  "--guess",
  "--no-guess",
  "--ignore-other-worktrees",
  "--recurse-submodules",
  "--no-recurse-submodules",
  "--conflict",
  "-d",
  "--detach",
];
const REBASE_VALUED = [
  "--empty",
  "--whitespace",
  "--onto",
  "-s",
  "--strategy",
  "-X",
  "--strategy-option",
  "-C",
];
const REBASE_FLAGS = [
  "--root",
  "-i",
  "--interactive",
  "--update-refs",
  "--no-update-refs",
  "--continue",
  "--skip",
  "--abort",
  "--quit",
  "--edit-todo",
  "--show-current-patch",
  "-q",
  "--quiet",
  "-v",
  "--verbose",
  "--stat",
  "-n",
  "--no-stat",
  "--no-verify",
  "--verify",
  "-f",
  "--force-rebase",
  "--no-ff",
  "--fork-point",
  "--no-fork-point",
  "--ignore-whitespace",
  "--committer-date-is-author-date",
  "--ignore-date",
  "--reset-author-date",
  "--signoff",
  "--autosquash",
  "--no-autosquash",
  "--autostash",
  "--no-autostash",
  "--reschedule-failed-exec",
  "--no-reschedule-failed-exec",
  "--rebase-merges",
  "--no-rebase-merges",
  "-r",
  "--keep-base",
  "--keep-empty",
  "--no-keep-empty",
  "--apply",
  "--merge",
  "-m",
  "--no-gpg-sign",
  "--gpg-sign",
  "-S",
  "--empty",
  "--whitespace",
];
const PULL_FLAGS = [
  ...FETCH_FLAGS,
  "--rebase",
  "-r",
  "--no-rebase",
  "--ff",
  "--no-ff",
  "--ff-only",
  "--squash",
  "--no-squash",
  "--commit",
  "--no-commit",
  "--edit",
  "-e",
  "--no-edit",
  "--stat",
  "--no-stat",
  "--log",
  "--no-log",
  "--signoff",
  "--no-signoff",
  "--autostash",
  "--no-autostash",
  "--allow-unrelated-histories",
  "--verify",
  "--no-verify",
  "--verify-signatures",
  "--no-verify-signatures",
  "--gpg-sign",
  "--no-gpg-sign",
  "-S",
  "--cleanup",
];
const ENDS = ["--abort", "--quit", "--show-current-patch"];
// Options of merge, cherry-pick, revert and am. A short option that takes a value in one of them
// is read as taking one in all: a misread value can only make verid judge the call, never skip it.
const SEQUENCE_FLAGS = [
  "--continue",
  "--skip",
  "--no-commit",
  "-n",
  "--commit",
  "--edit",
  "-e",
  "--no-edit",
  "--ff",
  "--no-ff",
  "--ff-only",
  "--squash",
  "--no-squash",
  "--stat",
  "--no-stat",
  "--log",
  "--no-log",
  "--signoff",
  "--no-signoff",
  "--verify",
  "--no-verify",
  "--verify-signatures",
  "--no-verify-signatures",
  "--autostash",
  "--no-autostash",
  "--allow-unrelated-histories",
  "--rerere-autoupdate",
  "--no-rerere-autoupdate",
  "-q",
  "--quiet",
  "-v",
  "--verbose",
  "--progress",
  "--no-progress",
  "-x",
  "--keep-redundant-commits",
  "--allow-empty",
  "--allow-empty-message",
  "-k",
  "--keep",
  "-3",
  "--3way",
  "--no-3way",
  "--scissors",
  "--no-scissors",
  "-u",
  "--utf8",
  "--no-utf8",
  "--keep-non-patch",
  "--keep-cr",
  "--no-keep-cr",
  "--message-id",
  "--ignore-space-change",
  "--ignore-whitespace",
  "--reject",
  "--no-gpg-sign",
];
const SEQUENCE_VALUED = [
  "-m",
  "--message",
  "-F",
  "--file",
  "-s",
  "--strategy",
  "-X",
  "--strategy-option",
  "-S",
  "--gpg-sign",
  "--cleanup",
  "--into-name",
  "--exclude",
  "--include",
  "--directory",
  "-p",
  "-C",
  "--whitespace",
  "--patch-format",
  "--quoted-cr",
  "--empty",
  "--mainline",
];

function judgeCall(
  call: GitCall,
  repo: Repo,
  { protectedRefs, frozen }: { protectedRefs: readonly string[]; frozen?: string },
  configChanged: boolean,
): { denials: Denial[]; effect: Effect } {
  const f = repo.facts;
  const [subWord, ...words] = call.args;
  const sub = subWord!.text;
  const denials: Denial[] = [];
  let effect: Effect = {};
  const main = f.main.ok ? f.main.main : null;
  // On Windows refs/heads/MAIN is main's own file, so a branch name is compared without case.
  const isMain = (name: string, m: string) =>
    [m, `refs/heads/${m}`].some((ref) => ref.toLowerCase() === name.toLowerCase());
  const needMain = (): string | null => {
    if (main === null) denials.push(unresolved(`main: ${(f.main as { detail: string }).detail}`));
    return main;
  };
  // The branch a command writes commits to: never main, and a work branch otherwise.
  const onBranch = (branches = repo.branches) => {
    if (repo.unknown) return void denials.push(unresolved("branch changed earlier in the line"));
    const m = needMain();
    if (m === null) return;
    for (const b of branches.map(
      (b) => b ?? (repo.branches.length === 1 ? (f.rebasing ?? null) : null),
    )) {
      if (b === null) denials.push(unresolved("detached HEAD"));
      else if (isMain(b, m))
        denials.push({ code: "VERID_BURNT_GIT_MAIN_COMMIT", target: `${sub} on ${b}` });
      else if (isFrozen(b))
        denials.push({ code: "VERID_BURNT_AUTO_WAITING_MERGE", target: `${sub} on ${b}` });
      else if (!isWorkBranch(b))
        denials.push({ code: "VERID_BURNT_GIT_BRANCH_NAME", target: `${sub} on ${b}` });
    }
  };
  // The branch waiting for its merge, kept as main is kept.
  const isFrozen = (name: string) => frozen !== undefined && isMain(name, frozen);
  const freeze = () =>
    denials.push({ code: "VERID_BURNT_AUTO_WAITING_MERGE", target: `${sub} writes ${frozen}` });
  // A branch the command creates, resets or renames to.
  const newBranch = (name: Word | undefined) => {
    if (name === undefined || name.dynamic) return void denials.push(unresolved("branch name"));
    const m = needMain();
    if (m === null) return;
    if (isMain(name.text, m))
      denials.push({ code: "VERID_BURNT_GIT_MAIN_COMMIT", target: `${sub} writes ${m}` });
    else if (isFrozen(name.text)) freeze();
    else if (!isWorkBranch(name.text))
      denials.push({ code: "VERID_BURNT_GIT_BRANCH_NAME", target: name.text });
  };
  const writesMain = (name: string) => {
    const m = needMain();
    if (m !== null && isMain(name, m))
      denials.push({ code: "VERID_BURNT_GIT_MAIN_COMMIT", target: `${sub} writes ${m}` });
    else if (isFrozen(name)) freeze();
  };
  // Checking out a branch that does not exist creates it from the remote branch of that name.
  const checkout = (name: Word) => {
    if (name.dynamic || name.text === "-") return { unknown: true };
    if (f.heads.includes(name.text)) return { to: name.text };
    if (f.remoteBranches.some((r) => r.slice(r.indexOf("/") + 1) === name.text)) {
      newBranch(name);
      return { to: name.text };
    }
    return { unknown: true };
  };

  const remoteHead = (ref: string) => /^refs\/remotes\/[^/]+\/HEAD$/i.test(ref);
  if (OPAQUE.has(sub)) denials.push(unresolved(`git ${sub}`));
  else if (sub === "commit") onBranch();
  else if (["merge", "cherry-pick", "revert", "am"].includes(sub)) {
    // Option values such as `-m --abort` are values: only a real option ends the operation.
    const s = scan(words, [...ENDS, ...SEQUENCE_FLAGS], SEQUENCE_VALUED);
    if (s.unknown.length > 0) denials.push(unresolved(`${sub} option ${s.unknown[0]}`));
    else if (!has(s, ...ENDS)) onBranch();
  } else if (sub === "rebase") {
    const s = scan(words, REBASE_FLAGS, [...REBASE_VALUED, "-x", "--exec"]);
    const updates =
      (has(s, "--update-refs") || yes(f.config["rebase.updaterefs"]?.[0])) &&
      !has(s, "--no-update-refs");
    // Git takes any unambiguous prefix of a long option, so what is not known is refused.
    if (s.unknown.length > 0) denials.push(unresolved(`rebase option ${s.unknown[0]}`));
    else if (has(s, "-x", "--exec", "-i", "--interactive", "--edit-todo"))
      denials.push(unresolved("rebase runs commands or an editor's todo list"));
    else if (configChanged) denials.push(unresolved("Git config changed earlier in the line"));
    else if (updates) denials.push(unresolved("rebase --update-refs moves other branches"));
    else if (!has(s, ...ENDS)) {
      const branch = has(s, "--root") ? s.pos[0] : s.pos[1];
      if (branch === undefined) onBranch();
      else if (branch.dynamic) denials.push(unresolved("dynamic branch"));
      else {
        onBranch([branch.text]);
        effect = { to: branch.text };
      }
    }
  } else if (sub === "reset") {
    const dash = words.findIndex((w) => w.text === "--");
    const before = dash === -1 ? words : words.slice(0, dash);
    const moves = before.some(
      (w) => !RESET_SAFE.has(w.text) && !w.text.startsWith("--pathspec-from-file"),
    );
    if (moves) {
      if (repo.unknown) denials.push(unresolved("branch changed earlier in the line"));
      else if (repo.branches.some((b) => b !== null && isMain(b, needMain() ?? "\0")))
        denials.push({ code: "VERID_BURNT_GIT_MAIN_COMMIT", target: "reset on main" });
      else if (repo.branches.some((b) => b !== null && isFrozen(b)))
        denials.push({ code: "VERID_BURNT_AUTO_WAITING_MERGE", target: `reset on ${frozen}` });
    }
  } else if (sub === "branch") {
    const s = scan(words, BRANCH_FLAGS, BRANCH_VALUED);
    if (s.unknown.length > 0) denials.push(unresolved(`branch option ${s.unknown[0]}`));
    else if (has(s, "-d", "-D", "--delete")) {
      if (has(s, "-r", "--remotes")) {
        if (s.pos.some((w) => w.dynamic || /(?:^|\/)HEAD$/i.test(w.text)))
          denials.push(unresolved("origin/HEAD names main"));
      } else
        for (const w of s.pos)
          w.dynamic ? denials.push(unresolved("branch name")) : writesMain(w.text);
    } else if (has(s, "-m", "-M", "--move")) {
      if (s.pos.some((w) => w.dynamic)) denials.push(unresolved("branch name"));
      else {
        const [oldName, newName] =
          s.pos.length >= 2 ? [s.pos[0]!.text, s.pos[1]] : [null, s.pos[0]];
        const old = oldName ?? repo.branches[0] ?? null;
        if (oldName === null && (repo.unknown || repo.branches.length !== 1 || old === null))
          denials.push(unresolved("branch to rename"));
        else {
          writesMain(old!);
          newBranch(newName);
          if (newName) effect = { rename: [old!, newName.text] };
        }
      }
    } else if (has(s, "-c", "-C", "--copy")) newBranch(s.pos.at(-1));
    else if (has(s, "-u", "--set-upstream-to", "--unset-upstream", "--edit-description"))
      effect = { config: true };
    else if (s.pos.length > 0 && !has(s, ...BRANCH_LIST)) {
      newBranch(s.pos[0]);
      if (has(s, "-t", "--track")) effect = { config: true };
    }
  } else if (sub === "checkout" || sub === "switch") {
    const creates =
      sub === "checkout"
        ? ["-b", "-B", "--orphan"]
        : ["-c", "--create", "-C", "--force-create", "--orphan"];
    const s = scan(words, sub === "checkout" ? CHECKOUT_FLAGS : SWITCH_FLAGS, [
      ...creates,
      "--conflict",
      "--pathspec-from-file",
    ]);
    const creating = words.filter(
      (w) =>
        creates.includes(w.text.split("=")[0]!) ||
        (/^-[a-zA-Z]./.test(w.text) && creates.includes(w.text.slice(0, 2))),
    ).length;
    const created = creates.find((o) => s.values.has(o));
    const dash = words.findIndex((w) => w.text === "--");
    const dashed = dash !== -1 && dash < words.length - 1;
    if (s.unknown.length > 0) denials.push(unresolved(`${sub} option ${s.unknown[0]}`));
    else if (creating > 1) denials.push(unresolved(`${sub} given two branches to create`));
    else if (created) {
      const value = words.find((w, i) => words[i - 1]?.text === created) ?? {
        text: s.values.get(created)!,
        dynamic: false,
      };
      newBranch(value);
      effect = { to: value.text };
    } else if (has(s, "--detach", "-d")) effect = { to: null };
    else if (dashed || has(s, "-p", "--patch", "--pathspec-from-file")) effect = {};
    else if (s.pos.length === 1) effect = checkout(s.pos[0]!);
    else if (s.pos.length > 1 && sub === "switch") effect = { unknown: true };
  } else if (sub === "update-ref") {
    const s = scan(words, ["-d", "--no-deref", "--create-reflog", "-z", "--stdin"], ["-m"]);
    const ref = s.pos[0];
    if (has(s, "--stdin") || s.unknown.length > 0 || s.dynamic || ref === undefined)
      denials.push(unresolved("update-ref"));
    else if (remoteHead(ref.text)) denials.push(unresolved("origin/HEAD names main"));
    else if (ref.text !== "HEAD" && !/^refs\//.test(ref.text))
      denials.push(unresolved(`update-ref of ${ref.text}`));
    else if (ref.text === "HEAD" && !has(s, "--no-deref")) {
      if (repo.unknown) denials.push(unresolved("branch changed earlier in the line"));
      else for (const b of repo.branches) if (b !== null) writesMain(b);
    } else if (ref.text === "HEAD") effect = has(s, "-d") ? { unknown: true } : { to: null };
    else writesMain(ref.text);
  } else if (sub === "symbolic-ref") {
    const s = scan(
      words,
      ["-q", "--quiet", "-d", "--delete", "--short", "--recurse", "--no-recurse"],
      ["-m"],
    );
    const [name, target] = s.pos;
    const writes = target !== undefined || has(s, "-d", "--delete");
    if (s.unknown.length > 0 || s.dynamic) denials.push(unresolved("symbolic-ref"));
    else if (!writes) effect = {};
    else if (name?.text !== "HEAD" || target === undefined)
      denials.push(unresolved("symbolic-ref other than HEAD can alias or remove a branch"));
    else if (/^refs\/heads\/./.test(target.text)) {
      const branch = target.text.slice("refs/heads/".length);
      effect = { to: branch };
    } else effect = { unknown: true };
  } else if (sub === "fetch" || sub === "pull") {
    const s =
      sub === "fetch"
        ? scan(words, FETCH_FLAGS, FETCH_VALUED)
        : scan(words, PULL_FLAGS, [
            ...FETCH_VALUED,
            "-s",
            "--strategy",
            "-X",
            "--strategy-option",
            "--cleanup",
          ]);
    const current = repo.branches.length === 1 ? repo.branches[0] : null;
    const rebaseMode = has(s, "--no-rebase")
      ? "false"
      : (s.values.get("--rebase") ??
        (has(s, "--rebase", "-r")
          ? "true"
          : (f.config[`branch.${current}.rebase`]?.[0] ??
            f.config["pull.rebase"]?.[0] ??
            "false")));
    if (s.unknown.length > 0) denials.push(unresolved(`${sub} option ${s.unknown[0]}`));
    else if (sub === "pull" && /^(?:interactive|i)$/i.test(rebaseMode))
      denials.push(unresolved("pull runs an interactive rebase"));
    else if (
      sub === "pull" &&
      !/^(?:false|no|off|0)$/i.test(rebaseMode) &&
      yes(f.config["rebase.updaterefs"]?.[0])
    )
      denials.push(unresolved("rebase --update-refs moves other branches"));
    else if (s.dynamic) denials.push(unresolved("dynamic fetch argument"));
    else if (configChanged) denials.push(unresolved("Git config changed earlier in the line"));
    else {
      const all = has(s, "--all");
      const multiple = has(s, "--multiple");
      const remotes = all
        ? Object.keys(f.config).flatMap((k) => /^remote\.(.+)\.(?:url|fetch)$/.exec(k)?.[1] ?? [])
        : multiple
          ? s.pos.map((w) => w.text)
          : [s.pos[0]?.text ?? f.config[`branch.${current}.remote`]?.[0] ?? "origin"];
      const refspecs = all || multiple ? [] : s.pos.slice(1).map((w) => w.text);
      const dsts = [
        ...remotes.flatMap((r) => f.config[`remote.${r}.fetch`] ?? []),
        ...refspecs.map((r, i) =>
          refspecs[i - 1] === "tag" ? `refs/tags/${r}:refs/tags/${r}` : r,
        ),
      ].flatMap((spec) => {
        const colon = spec.indexOf(":");
        const dst = colon === -1 ? "" : spec.slice(colon + 1);
        return dst === ""
          ? []
          : dst.startsWith("refs/")
            ? [dst]
            : [`refs/heads/${dst}`, `refs/${dst}`];
      });
      if (dsts.some((d) => remoteHead(d))) denials.push(unresolved("origin/HEAD names main"));
      const m = dsts.length > 0 ? needMain() : main;
      if (m !== null && dsts.some((d) => matches(d, `refs/heads/${m}`)))
        denials.push({ code: "VERID_BURNT_GIT_MAIN_COMMIT", target: `${sub} into ${m}` });
      else if (frozen !== undefined && dsts.some((d) => matches(d, `refs/heads/${frozen}`)))
        freeze();
      if (sub === "pull") onBranch();
    }
  } else if (sub === "push") {
    denials.push(...push(words, repo, protectedRefs, configChanged, needMain, frozen));
    if (words.some((w) => w.text === "-u" || w.text === "--set-upstream"))
      effect = { config: true };
  } else if (sub === "worktree") {
    if (words[0]?.text === "add") {
      const s = scan(
        words.slice(1),
        [
          "-f",
          "--force",
          "--detach",
          "-d",
          "--checkout",
          "--no-checkout",
          "--lock",
          "--orphan",
          "-q",
          "--quiet",
          "--track",
          "--no-track",
          "--guess-remote",
          "--no-guess-remote",
        ],
        ["-b", "-B", "--reason"],
      );
      const created = s.values.has("-b") ? "-b" : s.values.has("-B") ? "-B" : null;
      if (s.unknown.length > 0 || s.dynamic) denials.push(unresolved("worktree add"));
      else if (created) newBranch({ text: s.values.get(created)!, dynamic: false });
      else if (!has(s, "--detach", "-d") && s.pos.length === 1) {
        const base = s.pos[0]!.text.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
        if (!f.heads.includes(base)) newBranch({ text: base, dynamic: false });
      }
    }
  } else if (sub === "stash") {
    if (words[0]?.text === "branch") {
      newBranch(words[1]);
      effect = { to: words[1]?.text ?? null };
    }
  } else if (sub === "config") {
    const reads = [
      "--get",
      "--get-all",
      "--get-regexp",
      "--get-urlmatch",
      "--get-color",
      "--get-colorbool",
      "--list",
      "-l",
      "get",
      "list",
    ];
    const pos = words.filter((w) => !w.text.startsWith("-"));
    const options = words.filter((w) => w.text.startsWith("-")).map((w) => w.text.split("=")[0]!);
    const read =
      ["get", "list"].includes(pos[0]?.text ?? "") ||
      options.some((o) => reads.includes(o)) ||
      (pos.length === 1 && options.length === 0);
    if (!read) denials.push(unresolved("git config can make Git run programs or move refs"));
  } else if (sub === "remote") {
    const action = words[0]?.text ?? "";
    if (
      ["set-head", "set-url"].includes(action) ||
      (["rename", "rm", "remove"].includes(action) && words.length > 1)
    )
      denials.push(unresolved(`remote ${action} changes the origin/HEAD that may name main`));
    else if (["add", "set-branches"].includes(action)) effect = { config: true };
  } else if (sub === "submodule") {
    if (words.some((w) => w.text === "foreach"))
      denials.push(unresolved("submodule foreach runs commands"));
  } else if (sub === "bisect") {
    if (words[0]?.text === "run") denials.push(unresolved("bisect run runs commands"));
    else effect = { unknown: true };
  } else
    denials.push(
      unresolved(f.config[`alias.${sub}`] !== undefined ? `alias ${sub}` : `git ${sub}`),
    );
  return { denials, effect };
}

/** Every ref a push may write, judged: protected refs, then work-branch names. */
function push(
  words: readonly Word[],
  repo: Repo,
  protectedRefs: readonly string[],
  configChanged: boolean,
  needMain: () => string | null,
  frozen?: string,
): Denial[] {
  const f = repo.facts;
  const s = scan(words, PUSH_FLAGS, ["-o", "--push-option", "--recurse-submodules"]);
  if (s.unknown.length > 0) return [unresolved(`push option ${s.unknown[0]}`)];
  if (s.dynamic) return [unresolved("dynamic push argument")];
  const submodules = has(s, "--no-recurse-submodules")
    ? "no"
    : (s.values.get("--recurse-submodules") ??
      repo.facts.config["push.recursesubmodules"]?.[0] ??
      "");
  if (/^(?:on-demand|only)$/i.test(submodules)) return [unresolved("push into submodules")];
  if (configChanged) return [unresolved("Git config changed earlier in the line")];
  const main = needMain();
  if (main === null) return [];
  const guarded = [`refs/heads/${main}`, ...protectedRefs];
  const out: Denial[] = [];
  const [remoteWord, ...specs] = s.pos.map((w) => w.text);
  const current = (): string | null | undefined =>
    repo.unknown || repo.branches.length !== 1 ? undefined : repo.branches[0];
  const branchOf = () => {
    const b = current();
    if (b === undefined) out.push(unresolved("branch changed earlier in the line"));
    else if (b === null) out.push(unresolved("detached HEAD"));
    return b ?? null;
  };
  const cfg = (key: string) => f.config[key]?.[0];
  const remote =
    remoteWord ??
    (() => {
      const b = current();
      return (
        (b &&
          (cfg(`branch.${b}.pushremote`) ??
            cfg("remote.pushdefault") ??
            cfg(`branch.${b}.remote`))) ??
        "origin"
      );
    })();
  if (has(s, "--mirror") || yes(cfg(`remote.${remote}.mirror`)))
    return [{ code: "VERID_BURNT_GIT_PROTECTED_PUSH", target: "--mirror" }];
  if (has(s, "--prune"))
    return [
      { code: "VERID_BURNT_GIT_PROTECTED_PUSH", target: "--prune may delete protected refs" },
    ];
  const dsts: string[] = [];
  if (has(s, "--all", "--branches")) dsts.push(...f.heads.map((h) => `refs/heads/${h}`));
  if (has(s, "--tags", "--follow-tags")) dsts.push(...f.tags.map((t) => `refs/tags/${t}`));
  const configured = f.config[`remote.${remote}.push`] ?? [];
  // Where one refspec lands. A short destination may name a branch or a tag; both count.
  const resolve = (spec: string, fromConfig: boolean) => {
    const text = spec.replace(/^\+/, "");
    const colon = text.indexOf(":");
    const named = (dst: string) =>
      dst.startsWith("refs/") ? [dst] : [`refs/heads/${dst}`, `refs/tags/${dst}`, `refs/${dst}`];
    if (has(s, "-d", "--delete")) return void dsts.push(...named(text));
    if (colon !== -1) {
      const dst = text.slice(colon + 1);
      return dst === ""
        ? void out.push(unresolved(`refspec ${spec}`))
        : void dsts.push(...named(dst));
    }
    if (configured.length > 0 && !fromConfig)
      return void out.push(unresolved(`source-only refspec with remote.${remote}.push`));
    // push.default upstream sends a branch to its upstream: that counts as a destination too.
    const branch = (b: string) => {
      dsts.push(`refs/heads/${b}`);
      const merge = cfg(`branch.${b}.merge`);
      if (merge) dsts.push(merge);
    };
    if (text === "HEAD" || text === "@") {
      const b = branchOf();
      if (b) branch(b);
    } else if (text.startsWith("refs/")) dsts.push(text);
    else if (f.heads.includes(text)) branch(text);
    else if (f.tags.includes(text)) dsts.push(`refs/tags/${text}`);
    else out.push(unresolved(`source ${text}`));
  };
  for (let i = 0; i < specs.length; i++)
    if (specs[i] === "tag" && specs[i + 1] !== undefined) dsts.push(`refs/tags/${specs[++i]}`);
    else resolve(specs[i]!, false);
  if (specs.length === 0 && !has(s, "--all", "--branches", "--tags", "--follow-tags")) {
    if (configured.length > 0) for (const spec of configured) resolve(spec, true);
    else {
      const b = branchOf();
      const mode = cfg("push.default") ?? "simple";
      if (b === null || mode === "nothing") {
        // nothing is pushed, or the detached HEAD was refused above
      } else if (mode === "current" || mode === "simple") dsts.push(`refs/heads/${b}`);
      else if (mode === "upstream" || mode === "tracking") {
        const merge = cfg(`branch.${b}.merge`);
        if (merge) dsts.push(merge);
        else out.push(unresolved(`no upstream for ${b}`));
      } else if (mode === "matching") dsts.push(...f.heads.map((h) => `refs/heads/${h}`));
      else out.push(unresolved(`push.default ${mode}`));
    }
  }
  for (const dst of new Set(dsts)) {
    const hit = guarded.find((ref) => matches(dst, ref));
    if (hit) out.push({ code: "VERID_BURNT_GIT_PROTECTED_PUSH", target: hit });
    // The branch waiting for its merge is the developer's to push, here or to any remote.
    else if (frozen !== undefined && matches(dst, `refs/heads/${frozen}`))
      out.push({ code: "VERID_BURNT_AUTO_WAITING_MERGE", target: dst });
    else if (dst.startsWith("refs/heads/")) {
      const name = dst.slice("refs/heads/".length);
      const ok = dst.includes("*")
        ? WORK_PREFIXES.some((p) => name.startsWith(`${p}/`))
        : isWorkBranch(name);
      if (!ok) out.push({ code: "VERID_BURNT_GIT_BRANCH_NAME", target: dst });
    }
  }
  return out;
}

/** What tells one Git root which branch is main; the adapter reads it, offline. */
export interface MainFacts {
  /** default_branch of every manifest repo in this root. */
  declared: readonly string[];
  /** The manifest's root `git.default_branch`. */
  rootDefault?: string | undefined;
  /** The branch the local `refs/remotes/origin/HEAD` names; null without it. */
  originHead: string | null;
  /** Local branch names. */
  heads: readonly string[];
}

export type MainIdentity = { ok: true; main: string } | { ok: false; detail: string };

/**
 * Main for one root: a repo's declaration, the root's, the local origin/HEAD, then the sole local
 * main or master. Never the branch checked out now, and never a remote: what cannot be told
 * apart is refused.
 */
export function resolveMain(f: MainFacts): MainIdentity {
  const declared = [...new Set(f.declared)];
  if (declared.length > 1)
    return { ok: false, detail: `conflicting default_branch: ${declared.join(", ")}` };
  const named = declared[0] ?? f.rootDefault ?? f.originHead;
  if (named) return { ok: true, main: named };
  const found = ["main", "master"].filter((name) => f.heads.includes(name));
  if (found.length > 1) return { ok: false, detail: "both main and master exist" };
  return found[0] ? { ok: true, main: found[0] } : { ok: false, detail: "no main branch" };
}

/** One Git root's history since the module's recorded base, as the adapter read it. */
export interface RootHistory {
  /** The repo, by its manifest path. */
  repo: string;
  /** Why the history could not be read: Git gone, a missing base, a failed or too long read. */
  error?: string;
  /** Whether the recorded base is an ancestor of HEAD. */
  ancestor?: boolean;
  /** Every commit in base..HEAD, newest first, with its full message. */
  commits?: readonly { sha: string; message: string }[];
}
export type CloseProblem = {
  code: "VERID_BURNT_GIT_WORK_BASE" | "VERID_BURNT_GIT_COMMIT_MESSAGE";
  params: Record<string, string>;
};

/**
 * What the module's Git history says at close: the first reason it cannot close (a base it
 * cannot trust, or a message that is not a Conventional Commit, oldest first), and the repos with
 * more than one commit, which only earns an advisory. A read that failed is never an empty range.
 */
export function closeHistory(roots: readonly RootHistory[]): {
  problem: CloseProblem | null;
  counts: { repo: string; commits: number }[];
} {
  let problem: CloseProblem | null = null;
  const counts: { repo: string; commits: number }[] = [];
  for (const root of roots) {
    const base = (detail: string): CloseProblem => ({
      code: "VERID_BURNT_GIT_WORK_BASE",
      params: { repo: root.repo, detail },
    });
    if (root.error !== undefined || root.commits === undefined) {
      problem ??= base(root.error ?? "no history read");
      continue;
    }
    if (root.ancestor !== true) {
      problem ??= base("HEAD does not descend from the recorded main commit");
      continue;
    }
    if (root.commits.length > 1) counts.push({ repo: root.repo, commits: root.commits.length });
    const bad = [...root.commits].reverse().find((c) => !isConventionalCommit(c.message));
    problem ??= bad
      ? {
          code: "VERID_BURNT_GIT_COMMIT_MESSAGE",
          params: {
            repo: root.repo,
            commit: bad.sha.slice(0, 12),
            header: bad.message.split(/\r?\n/)[0] ?? "",
          },
        }
      : null;
  }
  return { problem, counts };
}
