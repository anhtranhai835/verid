import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as z from "zod/mini";
import type { Action } from "../core/policy.js";
import { parseApplyPatch } from "../core/apply-patch.js";
import { powershellWriteTargets } from "../core/powershell.js";
import {
  bashWrites,
  fileAction,
  mcpFiles,
  toAction,
  type FileAction,
  type PreToolUse,
} from "./claude-code.js";
import { VeridError } from "./state-store.js";

// The envelopes Codex 0.164.0 sent in the recorded fixtures, one per event.
const common = {
  session_id: z.string(),
  cwd: z.string(),
  transcript_path: z.nullable(z.string()),
};
const turn = {
  ...common,
  model: z.string(),
  permission_mode: z.string(),
  turn_id: z.string(),
};
const identity = { agent_id: z.optional(z.string()), agent_type: z.optional(z.string()) };
const child = { agent_id: z.string(), agent_type: z.string() };
const tool = {
  ...turn,
  ...identity,
  tool_name: z.string(),
  tool_use_id: z.string(),
  tool_input: z.record(z.string(), z.unknown()),
};
const ending = { stop_hook_active: z.boolean(), last_assistant_message: z.nullable(z.string()) };
const CODEX_EVENTS: Record<string, z.ZodMiniType> = {
  SessionStart: z.looseObject({
    ...common,
    model: z.string(),
    permission_mode: z.string(),
    source: z.string(),
  }),
  UserPromptSubmit: z.looseObject({ ...turn, ...identity, prompt: z.string() }),
  PreToolUse: z.looseObject(tool),
  PostToolUse: z.looseObject({ ...tool, tool_response: z.unknown() }),
  Stop: z.looseObject({ ...turn, ...ending }),
  SubagentStart: z.looseObject({ ...turn, ...child }),
  SubagentStop: z.looseObject({
    ...turn,
    ...child,
    ...ending,
    agent_transcript_path: z.nullable(z.string()),
  }),
  SessionEnd: z.looseObject({ ...common, reason: z.string() }),
};

/** Null paths are absent, never invented transcript files. All correlation IDs survive. */
export function codexPayload(payload: unknown): Record<string, unknown> {
  const event = (payload as { hook_event_name?: unknown } | null)?.hook_event_name;
  const schema = typeof event === "string" ? CODEX_EVENTS[event] : undefined;
  if (!schema) throw new VeridError("VERID_BURNT_PAYLOAD", { detail: "unknown hook_event_name" });
  const r = schema.safeParse(payload);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new VeridError("VERID_BURNT_PAYLOAD", {
      detail: issue ? `${issue.path.join(".") || "payload"}: ${issue.message}` : "invalid",
    });
  }
  return Object.fromEntries(
    Object.entries(r.data as Record<string, unknown>).filter(([, value]) => value !== null),
  );
}

/** Codex supplies cwd even in subdirectories; it does not set CLAUDE_PROJECT_DIR. */
export function codexProject(cwd: string): string {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".verid"))) return dir;
    if (dirname(dir) === dir) return cwd;
  }
}

export const CODEX_TOOLS = [
  "Bash",
  "apply_patch",
  "collaborationspawn_agent",
  "collaborationwait_agent",
  "update_plan",
  "Read",
  "Grep",
  "Glob",
] as const;
interface CodexAction {
  action: Action;
  files: FileAction[];
  unsupported?: string;
  invalidPatch?: string;
}
export function codexAction(p: PreToolUse): CodexAction {
  if (p.tool_name === "apply_patch") {
    if (typeof p.tool_input.command !== "string")
      throw new VeridError("VERID_BURNT_PAYLOAD", { detail: "apply_patch without command" });
    const patch = parseApplyPatch(p.tool_input.command);
    if ("invalid" in patch)
      return {
        action: { kind: "other", tool: p.tool_name },
        files: [],
        invalidPatch: patch.invalid,
      };
    return {
      action: { kind: "other", tool: p.tool_name },
      files: patch.targets.map((target) => fileAction(p.tool_name, "write", target, p.cwd)),
    };
  }
  const action = toAction(p);
  if ("invalid" in action) throw new VeridError("VERID_BURNT_PAYLOAD", { detail: action.invalid });
  if (action.kind === "bash") {
    const ps = powershellWriteTargets(action.command);
    const unverified = ["shell", "workdir", "cwd"].find(
      (field) => p.tool_input[field] !== undefined,
    );
    const unsupported = unverified ?? ps.unsupported;
    // Codex applies a patch handed to the shell from a workdir or `cd` the hook never sees, so
    // only the apply_patch tool, resolved against this cwd, may carry one.
    const shellPatch = PATCH_TEXT.test(action.command) || PATCH_PROGRAM.test(action.command);
    return {
      // Keep the Bash action: every existing mention rule still judges this command.
      action,
      files: [
        ...bashWrites(action.command, p.cwd),
        ...ps.targets.map((target) => fileAction("Bash", "write", target, p.cwd)),
      ],
      ...(shellPatch ? { invalidPatch: "a patch handed to the shell" } : {}),
      ...(unsupported ? { unsupported } : {}),
    };
  }
  return { action, files: mcpFiles(p) };
}

// Codex 0.164.0 also puts .bat shims for the patch program on PATH on Windows.
const PATCH_PROGRAM = /(?:^|[\s;&|(`'"\\/])apply_?patch(?:\.(?:exe|bat|cmd))?(?![\w-])/i;
const PATCH_TEXT = /\*\*\* Begin Patch/;

export interface HookResult {
  exit: 0 | 2;
  stdout?: string;
  stderr?: string;
}
/** Event-specific host transport; Claude Code's encoder is left untouched. */
export function codexOutput(event: string | undefined, result: HookResult): HookResult {
  // Plain stdout reaches the agent as context on Claude Code; Codex takes it in JSON.
  if (
    result.exit === 0 &&
    result.stdout &&
    (event === "SessionStart" || event === "UserPromptSubmit")
  )
    return {
      exit: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: event, additionalContext: result.stdout },
      }),
    };
  if (result.exit === 0) return result;
  const reason = result.stderr ?? "verid [VERID_BURNT_INTERNAL]";
  return {
    exit: 0,
    stdout: JSON.stringify(
      event === "PreToolUse" || event === undefined
        ? {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: reason,
            },
          }
        : { decision: "block", reason },
    ),
  };
}
