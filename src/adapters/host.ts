import type { Action } from "../core/policy.js";
import type { ErrorCode } from "../core/errors.js";
import type { Provider } from "../core/manifest.js";
import { bilingual } from "./i18n.js";
import { projectDir as claudeProjectDir, type FileAction, type PreToolUse } from "./claude-code.js";
import { CODEX_TOOLS, codexAction, codexOutput, codexPayload, codexProject } from "./codex.js";
import { VeridError } from "./state-store.js";

export interface Result {
  exit: 0 | 2;
  stdout?: string;
  stderr?: string;
}

/** A tool call as the rules judge it, when the host's tools are not Claude Code's. */
interface HostAction {
  action: Action;
  /** What the call writes or reads beyond the action itself. */
  files: FileAction[];
  /** A shell or field verid cannot read: the call is denied. */
  unsupported?: string;
  invalidPatch?: string;
  /** A tool verid has no mapping for that changes files it cannot locate: denied as unknown. */
  unknownTool?: string;
}

/**
 * One agent host: how its hook payloads become verid's events, and verid's answers its output.
 * The rules themselves never ask which host it is; they ask what the host can do.
 */
export interface Host {
  readonly id: Provider;
  /** The main thread writes tests and code; subagents are only the read-only roles. */
  readonly singleWriter: boolean;
  /** `/verid tip` and `/verid confirm` open exceptions, and denials say so. */
  readonly overrides: boolean;
  /** The host's own subagent tool, judged as an Agent dispatch that starts fresh. */
  readonly spawnTool?: string;
  /** Every tool the host has: any other, MCP tools aside, is denied as unknown. */
  readonly knownTools?: readonly string[];
  /** The host's hook event, when its argv names it rather than its payload. */
  readonly event?: string;
  /**
   * verid's events for the parsed payload: the first one decides the answer, the rest run only
   * once it lets the call through. None: not a verid project, the call goes through untouched.
   */
  events(payload: unknown): unknown[];
  projectDir(cwd: string): string;
  /** Whether a person typed the prompt; null when prompts never carry verid commands. */
  attended(): boolean | null;
  /** The tool call in verid's terms, or null for Claude Code's tools as they are. */
  action(p: PreToolUse): HostAction | null;
  /** verid's answer as the host reads it. */
  output(event: string | undefined, result: Result): Result;
  /** A prompt hook that failed: the prompt goes through. */
  promptFailed(code: ErrorCode): Result;
}

export const claudeHost: Host = {
  id: "claude-code",
  singleWriter: false,
  overrides: true,
  events: (payload) => [payload],
  projectDir: claudeProjectDir,
  // Set by Claude Code itself: 1 only when a person is at the terminal (spike S2).
  attended: () => process.env.CLAUDE_CODE_SESSION_ATTENDED === "1",
  action: () => null,
  output: (_event, result) => result,
  promptFailed: (code) => ({
    exit: 0,
    stdout: JSON.stringify({ systemMessage: bilingual("prompt.hook_failed", { detail: code }) }),
  }),
};

// Events Codex sends that verid has nothing to do with.
const CODEX_IGNORED = new Set(["PostToolUse", "SessionEnd"]);

const codexHost: Host = {
  id: "codex",
  singleWriter: true,
  // Codex has no attended-input signal: a prompt never opens an exception there.
  overrides: false,
  spawnTool: "collaborationspawn_agent",
  knownTools: CODEX_TOOLS,
  events: (payload) => {
    const parsed = codexPayload(payload);
    return CODEX_IGNORED.has(String(parsed.hook_event_name)) ? [] : [parsed];
  },
  projectDir: codexProject,
  attended: () => null,
  action: codexAction,
  output: codexOutput,
  promptFailed: (code) => ({ exit: 0, stderr: `verid [${code}]\n` }),
};

/** Provider selection is an explicit invocation contract, never inferred from stdin. */
export function hostFor(args: readonly string[]): { host: Host; error?: VeridError } {
  const bad = (host: Host) => ({
    host,
    error: new VeridError("VERID_BURNT_PAYLOAD", {
      detail: "expected --provider claude-code|codex",
    }),
  });
  if (args.length === 0) return { host: claudeHost };
  if (args[0] !== "--provider") return bad(claudeHost);
  if (args[1] === "codex") return args.length === 2 ? { host: codexHost } : bad(codexHost);
  if (args[1] === "claude-code") return args.length === 2 ? { host: claudeHost } : bad(claudeHost);
  return bad(claudeHost);
}
