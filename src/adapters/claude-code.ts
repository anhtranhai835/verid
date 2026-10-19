import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import * as z from "zod/mini";
import { canonicalJson } from "../core/canonical-json.js";
import type { Action, PolicyContext } from "../core/policy.js";

// Validate only the fields verid reads; Claude Code adds fields between versions.
export const preToolUseSchema = z.looseObject({
  hook_event_name: z.literal("PreToolUse"),
  session_id: z.string(),
  cwd: z.string(),
  tool_name: z.string(),
  tool_input: z.record(z.string(), z.unknown()),
});
export const userPromptSchema = z.looseObject({
  hook_event_name: z.literal("UserPromptSubmit"),
  session_id: z.string(),
  cwd: z.string(),
  prompt: z.string(),
  agent_id: z.optional(z.string()),
});
export const lifecycleSchema = z.looseObject({
  hook_event_name: z.enum(["Stop", "SessionStart"]),
  session_id: z.string(),
  cwd: z.string(),
});
export type PreToolUse = z.infer<typeof preToolUseSchema>;

// Field holding the target path, per tool. MultiEdit is gone in Claude Code 2.1.300 but kept for older versions.
const WRITE_TOOLS: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};
const READ_TOOLS: Record<string, string> = { Read: "file_path", Grep: "path", Glob: "path" };

export function toAction(p: PreToolUse): Action | { invalid: string } {
  const input = p.tool_input;
  if (p.tool_name === "Bash")
    return typeof input.command === "string"
      ? { kind: "bash", command: input.command }
      : { invalid: "Bash without command" };
  const field = WRITE_TOOLS[p.tool_name] ?? READ_TOOLS[p.tool_name];
  if (!field) return { kind: "other", tool: p.tool_name };
  // Grep and Glob search the working directory when no path is given.
  const raw =
    input[field] ?? (p.tool_name === "Grep" || p.tool_name === "Glob" ? p.cwd : undefined);
  if (typeof raw !== "string" || raw === "") return { invalid: `${p.tool_name} without ${field}` };
  return {
    kind: "file",
    tool: p.tool_name,
    access: p.tool_name in WRITE_TOOLS ? "write" : "read",
    path: normalizePath(resolve(p.cwd, raw)),
    display: raw,
  };
}

export function projectDir(cwd: string): string {
  return process.env.CLAUDE_PROJECT_DIR || cwd;
}

export function policyContext(project: string): PolicyContext {
  return {
    stateDir: normalizePath(join(project, ".verid", ".state")),
    manifestPath: normalizePath(join(project, ".verid", "manifest.yaml")),
    transcriptsDir: normalizePath(join(homedir(), ".claude", "projects")),
  };
}

export function inputHash(toolInput: unknown): string {
  return createHash("sha256").update(canonicalJson(toolInput), "utf8").digest("hex");
}

/**
 * Absolute, `..` resolved, symlinks/junctions resolved for the part that exists
 * (realpath of the nearest existing parent when the file is new), lowercase on win32.
 */
export function normalizePath(path: string): string {
  const real = realpathLoose(resolve(path));
  return process.platform === "win32" ? real.toLowerCase() : real;
}

function realpathLoose(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(realpathLoose(parent), basename(path));
  }
}
