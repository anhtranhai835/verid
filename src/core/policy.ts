import type { PolicyDecision, RuleCode } from "./errors.js";

export type Access = "read" | "write";

/**
 * A tool call reduced to what the rules need. File paths are already normalized by the
 * adapter: absolute, symlinks resolved, lowercase on win32. `display` is the path as the
 * agent wrote it, for messages.
 */
export type Action =
  | { kind: "file"; tool: string; access: Access; path: string; display: string }
  | { kind: "bash"; command: string }
  /** A shell other than Bash, whose commands verid cannot read. */
  | { kind: "shell"; tool: string }
  | { kind: "other"; tool: string };

/** Protected locations, normalized the same way as action paths. */
export interface PolicyContext {
  stateDir: string;
  manifestPath: string;
  transcriptsDir: string;
  /** verid's own bundle, which the registered hooks run. */
  distDir: string;
  planPath: string;
  /** prep or recipe with no `.verid/research.md` yet: what the project is comes before a plan. */
  researchMissing: boolean;
  /** prep or recipe with no `.verid/design.md` yet: how it is built comes next. */
  designMissing: boolean;
}

const allow = (reason: string): PolicyDecision => ({ kind: "allow", reason });
const deny = (code: RuleCode, target: string, reason: string): PolicyDecision => ({
  kind: "deny",
  code,
  target,
  reason,
});

/**
 * First matching rule wins; non-overridable invariants are checked first. A rule in `lifted`,
 * which the developer allowed for this call, gives way to the next one.
 */
export function decide(
  action: Action,
  ctx: PolicyContext,
  lifted: ReadonlySet<RuleCode> = new Set(),
): PolicyDecision {
  if (action.kind === "file") return decideFile(action, ctx, lifted);
  if (action.kind === "bash") return decideBash(action.command, lifted);
  if (action.kind === "shell" && !lifted.has("VERID_BURNT_SHELL_UNSUPPORTED"))
    return deny("VERID_BURNT_SHELL_UNSUPPORTED", action.tool, "shell verid cannot read");
  return allow("no rule for this tool");
}

function decideFile(
  a: Extract<Action, { kind: "file" }>,
  ctx: PolicyContext,
  lifted: ReadonlySet<RuleCode>,
): PolicyDecision {
  const write = a.access === "write";
  const plan = write && a.path === ctx.planPath;
  // In priority order, invariants first.
  const rules: [RuleCode, string, boolean][] = [
    // Reads are blocked too: state holds the pending confirmation code.
    ["VERID_BURNT_STATE_PROTECTED", "verid state", isUnder(a.path, ctx.stateDir)],
    ["VERID_BURNT_SECRET_PROTECTED", "secret file", isSecretPath(a.path)],
    [
      "VERID_BURNT_TRANSCRIPT_PROTECTED",
      "Claude Code transcript",
      isUnder(a.path, ctx.transcriptsDir),
    ],
    // Rewriting either one switches verid off: settings register its hooks (or set
    // disableAllHooks), and the bundle is the code those hooks run. verid's commands in Claude
    // Code's menu could grant tools or run shell lines when the developer picks one. An agent
    // definition names the agent_type its subagent gets, so writing one would claim a role.
    [
      "VERID_BURNT_HOOK_PROTECTED",
      "Claude Code settings, agents or plugins, or verid's bundle",
      write &&
        (isClaudeSettings(a.path) ||
          isUnder(a.path, ctx.distDir) ||
          isVeridCommand(a.path) ||
          isAgentOrPlugin(a.path)),
    ],
    ["VERID_BURNT_MANIFEST_PROTECTED", "verid manifest", write && a.path === ctx.manifestPath],
    ["VERID_BURNT_PLAN_NO_RESEARCH", "plan before research", plan && ctx.researchMissing],
    ["VERID_BURNT_PLAN_NO_DESIGN", "plan before design", plan && ctx.designMissing],
  ];
  const hit = rules.find(([code, , matches]) => matches && !lifted.has(code));
  return hit ? deny(hit[0], a.display, hit[1]) : allow("no protected path");
}

// Matches `claude` as a program name: start of command or after a separator/path,
// optionally with a Windows extension, followed by an argument boundary.
const NESTED_CLAUDE = /(^|[\s;&|(`'"\\/])claude(\.exe|\.cmd|\.ps1)?(?=$|[\s;&|)`'"])/i;

// verid's developer commands refuse only while CLAUDECODE=1, so an agent could clear that variable.
// Block the variable's name and a direct call to those commands: `verid` (or its Windows shim
// `verid.cmd`, `.ps1`, `.exe`) and the bare entry point `cli` / `cli.js` that `node dist/cli` runs.
const CLAUDECODE_VAR = /\bclaudecode\b/;
const DEVELOPER_COMMAND =
  /(?:\bverid(?:\.(?:cmd|ps1|exe))?|\bcli(?:\.js)?)["']?\s+(?:cook|garnish|stock|order|serve)\b/;
// The agent's Bash inherits CLAUDE_CODE_SESSION_ATTENDED, so a `/verid tip` piped into the hook
// would hand it the confirmation code. A copy or a path built at run time still gets through.
const VERID_HOOK = /\bdist[\\/]+hook\b|\bhook\.js\b/;

// In priority order, invariants first. Each rule gets the command lowercased.
const BASH_RULES: [RuleCode, string, (command: string) => boolean][] = [
  ["VERID_BURNT_STATE_PROTECTED", "mentions .state", (c) => c.includes(".state")],
  [
    "VERID_BURNT_SECRET_PROTECTED",
    "mentions a secret file",
    (c) => c.split(/[\s'"`;|&<>()=,]+/).some((t) => t !== "" && isSecretPath(t)),
  ],
  [
    "VERID_BURNT_TRANSCRIPT_PROTECTED",
    "mentions the transcripts dir",
    (c) => c.includes(".claude/projects") || c.includes(".claude\\projects"),
  ],
  [
    "VERID_BURNT_HOOK_PROTECTED",
    "mentions Claude Code settings, agents, plugins or verid's commands",
    (c) =>
      /\.claude[\\/](settings|agents(?![\w.-])|plugins(?![\w.-])|commands[\\/]verid(?![\w.-]))/.test(
        c,
      ),
  ],
  [
    "VERID_BURNT_MANIFEST_PROTECTED",
    "mentions the verid manifest",
    (c) => c.includes("manifest.yaml"),
  ],
  [
    "VERID_BURNT_BASH_NESTED_CLAUDE",
    "starts a nested Claude Code session",
    (c) => NESTED_CLAUDE.test(c),
  ],
  [
    "VERID_BURNT_BASH_DEVELOPER_ONLY",
    "changes CLAUDECODE, or runs a developer-only verid command or verid's hook",
    (c) => CLAUDECODE_VAR.test(c) || DEVELOPER_COMMAND.test(c) || VERID_HOOK.test(c),
  ],
];

// Substring matching, with no Bash allowlist on purpose (see the known limits): variables, globs,
// `$(...)`, `node -e` and scripts get through. The command is also read with quotes and backslash
// escapes removed, the way sh joins words, so `.e""nv` is `.env`. The raw form stays, because
// there a backslash may be a Windows path separator.
function decideBash(command: string, lifted: ReadonlySet<RuleCode>): PolicyDecision {
  const target = command.length > 200 ? `${command.slice(0, 200)}…` : command;
  const forms = [command, unquote(command)].map((c) => c.toLowerCase());
  for (const [code, reason, matches] of BASH_RULES)
    if (!lifted.has(code) && forms.some((c) => matches(c))) return deny(code, target, reason);
  return allow("no rule matched");
}

const unquote = (command: string) => command.replace(/\\(.)|["']/gs, "$1");

// MCP tools have no fixed schema: keys ending like these hold paths, and a tool whose name says
// it changes files writes them. Anything else an MCP tool touches is not seen (known limits).
const PATH_KEY = /(path|paths|file|filename|dir|directory|folder|source|destination|target|uri)$/i;
const WRITING_TOOL =
  /write|edit|create|move|rename|delete|remove|patch|replace|insert|append|save/i;

/** Single-line strings under path-like keys of an MCP tool's input, at any depth. */
export function mcpPaths(input: unknown, key = ""): string[] {
  if (typeof input === "string")
    return PATH_KEY.test(key) && input !== "" && !input.includes("\n") ? [input] : [];
  if (Array.isArray(input)) return input.flatMap((v) => mcpPaths(v, key));
  if (input !== null && typeof input === "object")
    return Object.entries(input).flatMap(([k, v]) => mcpPaths(v, k));
  return [];
}

export const mcpAccess = (tool: string): Access =>
  WRITING_TOOL.test(tool.split("__").at(-1) ?? "") ? "write" : "read";

// Commands that write their path arguments: all of them, or the destination (with each
// source's name inside it, in case it is a directory). sed and perl only with -i.
const WRITES_ALL = new Set(["tee", "touch", "rm", "truncate"]);
const WRITES_DEST = new Set(["cp", "mv", "ln", "install"]);
const IN_PLACE = new Set(["sed", "perl"]);
const HEREDOC = /<<-?[ \t]*(['"]?)([\w.-]+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g;
const OPERATOR = /^[;&|<()\n]$/;

// `node -e "…"`, `python -c "…"` and the like: when the inline code writes, the paths it quotes
// are its targets. Taken from the command as written, since the code is full of operators.
const INLINE_CODE =
  /\b(?:node|python3?|py|perl|ruby|deno|bun|php)(?:\.exe)?\s(?:[^\n;&|]*?\s)?(?:-[ecpEr]|--eval|--print)\s+(["'])([\s\S]*?)\1/g;
const INLINE_WRITE = /write|append|copy|rename|unlink|\brm|truncate|move|symlink/i;
const ASSIGNMENT = /^([A-Za-z_]\w*)=(.*)$/;

/**
 * Files a Bash command plainly writes: redirect targets, the paths of common writing commands
 * and of inline interpreter code that writes, with variables assigned in the same command filled
 * in. It catches the usual shortcuts, not a determined agent: `$(...)`, `cd` and scripts are not
 * followed (see the README's limitations).
 */
export function bashWriteTargets(command: string): string[] {
  const text = command.replace(HEREDOC, "<<$2$3"); // a heredoc body is data, not commands
  const inline = [...text.matchAll(INLINE_CODE)].flatMap(([, , code = ""]) =>
    INLINE_WRITE.test(code)
      ? [...code.matchAll(/(['"`])([^'"`\n]+)\1/g)]
          .map((m) => m[2] ?? "")
          .filter((p) => /[\\/]|\.\w+$/.test(p))
      : [],
  );
  // What is quoted stays one word, as sh reads it: `sed -i 's/(a|b)/c/' f` writes f.
  const masked = text.replace(QUOTED, (q) => q.replace(WORD_BREAK, hide));
  const forms = [masked.replace(/["']/g, ""), unquote(masked)];
  return [...inline, ...forms.flatMap(writeTargets).map((t) => t.replace(HIDDEN, show))];
}

const QUOTED = /"(?:\\.|[^"\\])*"|'[^']*'/gs;
// Characters that end a word or a command, swapped for private-use ones while the command is split.
const BREAKS = ";&|<>()\n \t\r";
const WORD_BREAK = /[;&|<>()\n \t\r]/g;
const HIDDEN = /[\ue000-\ue00a]/g;
const hide = (c: string) => String.fromCharCode(0xe000 + BREAKS.indexOf(c));
const show = (c: string) => BREAKS[c.charCodeAt(0) - 0xe000] ?? c;

function writeTargets(command: string): string[] {
  const tokens = command.split(/(>>?|[;&|<()\n])|[ \t\r]+/).filter((t) => t !== undefined && t);
  const targets: string[] = [];
  const vars = new Map<string, string>();
  let words: string[] = [];
  const endCommand = () => {
    const [name = "", ...args] = words;
    const program = name.split(/[\\/]/).at(-1) ?? "";
    if (["export", "declare", "local", "readonly"].includes(program))
      for (const a of args) {
        const [, key, value] = ASSIGNMENT.exec(a) ?? [];
        if (key !== undefined && value !== undefined) vars.set(key, value);
      }
    const paths = args.filter((a) => !a.startsWith("-"));
    if (WRITES_ALL.has(program)) targets.push(...paths);
    if (IN_PLACE.has(program) && args.some((a) => /^(-[a-z]*i|--in-place)/i.test(a)))
      targets.push(...paths);
    const dest = paths.at(-1);
    if (WRITES_DEST.has(program) && dest !== undefined && paths.length > 1) {
      const sources = paths.slice(0, -1);
      if (program === "mv") targets.push(...sources);
      targets.push(dest, ...sources.map((s) => `${dest}/${s.split(/[\\/]/).at(-1)}`));
    }
    words = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const next = tokens[i + 1];
    const operand = next !== undefined && !OPERATOR.test(next) && !next.startsWith(">");
    if (token === ">" || token === ">>") {
      if (operand) targets.push(next);
      if (operand) i++;
    } else if (token === "<") {
      if (operand) i++; // an input file
    } else if (OPERATOR.test(token)) endCommand();
    else {
      const [, key, value] = (words.length === 0 && ASSIGNMENT.exec(token)) || [];
      if (key !== undefined && value !== undefined) vars.set(key, value);
      else words.push(token);
    }
  }
  endCommand();
  return targets.map((t) =>
    t.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (m, v: string) => vars.get(v) ?? m),
  );
}

function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}\\`) || path.startsWith(`${dir}/`);
}

/** `.claude/commands/verid` and what is in it, anywhere: the project's or the user's. */
function isVeridCommand(path: string): boolean {
  const segments = path.toLowerCase().split(/[\\/]+/);
  return segments.some(
    (s, i) => s === ".claude" && segments[i + 1] === "commands" && segments[i + 2] === "verid",
  );
}

/** `.claude/agents` or `.claude/plugins` and what is in them, anywhere. */
function isAgentOrPlugin(path: string): boolean {
  const segments = path.toLowerCase().split(/[\\/]+/);
  return segments.some(
    (s, i) => s === ".claude" && (segments[i + 1] === "agents" || segments[i + 1] === "plugins"),
  );
}

/** `.claude/settings*.json` anywhere: the project's, the user's, or a subfolder's. */
function isClaudeSettings(path: string): boolean {
  const segments = path.toLowerCase().split(/[\\/]+/);
  const base = segments.at(-1) ?? "";
  return segments.at(-2) === ".claude" && base.startsWith("settings") && base.endsWith(".json");
}

const ENV_TEMPLATES = new Set([".env.example", ".env.sample", ".env.template"]);
const SECRET_NAMES = new Set([".env", ".npmrc", ".pypirc", ".netrc"]);
const SECRET_EXTENSIONS = [".pem", ".key", ".p12", ".pfx"];
const SECRET_PREFIXES = ["id_rsa", "id_ed25519"];
const SECRET_SUBSTRINGS = ["credentials", "secret"];

/**
 * Default secret patterns. Developers will be able to add patterns in manifest.yaml
 * (Phase 4) but never remove these. Matching is case-insensitive.
 */
export function isSecretPath(path: string): boolean {
  const segments = path
    .toLowerCase()
    .split(/[\\/]+/)
    .filter(Boolean);
  const base = segments.at(-1) ?? "";
  if (ENV_TEMPLATES.has(base)) return false;
  return (
    SECRET_NAMES.has(base) ||
    base.startsWith(".env.") ||
    SECRET_EXTENSIONS.some((e) => base.endsWith(e)) ||
    SECRET_PREFIXES.some((p) => base.startsWith(p)) ||
    SECRET_SUBSTRINGS.some((s) => base.includes(s)) ||
    segments.includes(".ssh")
  );
}
