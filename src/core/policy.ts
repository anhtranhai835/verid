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
  | { kind: "other"; tool: string };

/** Protected locations, normalized the same way as action paths. */
export interface PolicyContext {
  stateDir: string;
  manifestPath: string;
  transcriptsDir: string;
}

const allow = (reason: string): PolicyDecision => ({ kind: "allow", reason });
const deny = (code: RuleCode, target: string, reason: string): PolicyDecision => ({
  kind: "deny",
  code,
  target,
  reason,
});

/** First matching rule wins; non-overridable invariants are checked first. */
export function decide(action: Action, ctx: PolicyContext): PolicyDecision {
  if (action.kind === "file") return decideFile(action, ctx);
  if (action.kind === "bash") return decideBash(action.command);
  return allow("no rule for this tool");
}

function decideFile(a: Extract<Action, { kind: "file" }>, ctx: PolicyContext): PolicyDecision {
  // Reads are blocked too: state holds the pending confirmation code.
  if (isUnder(a.path, ctx.stateDir))
    return deny("VERID_E_STATE_PROTECTED", a.display, "verid state");
  if (isSecretPath(a.path)) return deny("VERID_E_SECRET_PROTECTED", a.display, "secret file");
  if (isUnder(a.path, ctx.transcriptsDir))
    return deny("VERID_E_TRANSCRIPT_PROTECTED", a.display, "Claude Code transcript");
  if (a.access === "write" && a.path === ctx.manifestPath)
    return deny("VERID_E_MANIFEST_PROTECTED", a.display, "verid manifest");
  return allow("no protected path");
}

// Matches `claude` as a program name: start of command or after a separator/path,
// optionally with a Windows extension, followed by an argument boundary.
const NESTED_CLAUDE = /(^|[\s;&|(`'"\\/])claude(\.exe|\.cmd|\.ps1)?(?=$|[\s;&|)`'"])/i;

// ponytail: substring/token matching is a Phase 0 stopgap and easy to evade
// (`cat .e""nv`, variables, scripts); the Phase 4 Bash allowlist replaces it.
function decideBash(command: string): PolicyDecision {
  const lower = command.toLowerCase();
  const target = command.length > 200 ? `${command.slice(0, 200)}…` : command;
  if (lower.includes(".state")) return deny("VERID_E_STATE_PROTECTED", target, "mentions .state");
  if (command.split(/[\s'"`;|&<>()=,]+/).some((t) => t !== "" && isSecretPath(t)))
    return deny("VERID_E_SECRET_PROTECTED", target, "mentions a secret file");
  if (lower.includes(".claude/projects") || lower.includes(".claude\\projects"))
    return deny("VERID_E_TRANSCRIPT_PROTECTED", target, "mentions the transcripts dir");
  if (lower.includes("manifest.yaml"))
    return deny("VERID_E_MANIFEST_PROTECTED", target, "mentions the verid manifest");
  if (NESTED_CLAUDE.test(command))
    return deny("VERID_E_BASH_NESTED_CLAUDE", target, "starts a nested Claude Code session");
  return allow("no rule matched");
}

function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}\\`) || path.startsWith(`${dir}/`);
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
