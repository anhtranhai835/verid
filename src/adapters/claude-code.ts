import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/mini";
import { canonicalJson } from "../core/canonical-json.js";
import {
  bashWriteTargets,
  mcpAccess,
  mcpPaths,
  type Access,
  type Action,
  type PolicyContext,
} from "../core/policy.js";

// Validate only the fields verid reads; Claude Code adds fields between versions.
export const preToolUseSchema = z.looseObject({
  hook_event_name: z.literal("PreToolUse"),
  session_id: z.string(),
  cwd: z.string(),
  tool_name: z.string(),
  tool_input: z.record(z.string(), z.unknown()),
  // Set only in a subagent's payload (core/roles.ts).
  agent_id: z.optional(z.string()),
  agent_type: z.optional(z.string()),
});
export const userPromptSchema = z.looseObject({
  hook_event_name: z.literal("UserPromptSubmit"),
  session_id: z.string(),
  cwd: z.string(),
  prompt: z.string(),
  agent_id: z.optional(z.string()),
});
export const lifecycleSchema = z.looseObject({
  hook_event_name: z.enum(["Stop", "SubagentStop", "SessionStart"]),
  session_id: z.string(),
  cwd: z.string(),
  stop_hook_active: z.optional(z.boolean()),
  source: z.optional(z.string()),
  // SubagentStop only.
  agent_id: z.optional(z.string()),
  agent_type: z.optional(z.string()),
  last_assistant_message: z.optional(z.string()),
  agent_transcript_path: z.optional(z.string()),
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
  if (!field)
    // PowerShell, or an MCP tool that runs a `command`: verid cannot read what it runs.
    return p.tool_name === "PowerShell" ||
      (typeof input.command === "string" && input.command !== "")
      ? { kind: "shell", tool: p.tool_name }
      : { kind: "other", tool: p.tool_name };
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

export type FileAction = Extract<Action, { kind: "file" }>;

/** What a Bash command plainly writes, as file writes the rules and the TDD gate can judge. */
export function bashWrites(command: string, cwd: string): FileAction[] {
  return [...new Set(bashWriteTargets(command))].map((t) => fileAction("Bash", "write", t, cwd));
}

/** The paths an MCP tool names, as file reads or writes (by the tool's name); [] for other tools. */
export function mcpFiles(p: PreToolUse): FileAction[] {
  if (!p.tool_name.startsWith("mcp__")) return [];
  const access = mcpAccess(p.tool_name);
  return [...new Set(mcpPaths(p.tool_input))].map((t) => fileAction(p.tool_name, access, t, p.cwd));
}

function fileAction(tool: string, access: Access, raw: string, cwd: string): FileAction {
  let display = raw.replace(/^~(?=$|[\\/])/, homedir());
  if (display.startsWith("file:"))
    try {
      display = fileURLToPath(display);
    } catch {
      // Not a local file URL: judged as written.
    }
  return { kind: "file", tool, access, path: normalizePath(resolve(cwd, display)), display };
}

export function projectDir(cwd: string): string {
  return process.env.CLAUDE_PROJECT_DIR || cwd;
}

export function policyContext(project: string): PolicyContext {
  return {
    stateDir: normalizePath(join(project, ".verid", ".state")),
    manifestPath: normalizePath(join(project, ".verid", "manifest.yaml")),
    transcriptsDir: normalizePath(join(homedir(), ".claude", "projects")),
    // This code runs bundled in dist/, next to hook.js and its chunks.
    distDir: normalizePath(dirname(fileURLToPath(import.meta.url))),
    planPath: normalizePath(join(project, ".verid", "plan.md")),
    // Read from the manifest, and only for a write to the plan (hook.ts).
    researchMissing: false,
    designMissing: false,
  };
}

export function inputHash(toolInput: unknown): string {
  return createHash("sha256").update(canonicalJson(toolInput), "utf8").digest("hex");
}

/** Absolute and `..` resolved but links kept, lowercase on win32: the path as the agent wrote it. */
export function writtenPath(path: string): string {
  const abs = stripStreams(resolve(path));
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

/**
 * Absolute, `..` resolved, symlinks/junctions resolved for the part that exists
 * (realpath of the nearest existing parent when the file is new), lowercase on win32.
 */
export function normalizePath(path: string): string {
  // NTFS accepts streams on files and directory components, including new targets.
  // Strip before realpath so its missing-parent fallback cannot retain an alias.
  const real = stripStreams(realpathLoose(stripStreams(resolve(path))));
  return process.platform === "win32" ? real.toLowerCase() : real;
}

function stripStreams(path: string): string {
  if (process.platform !== "win32") return path;
  // Device prefixes precede the drive; strip streams from the remaining path components.
  const prefix = /^\\\\[?.]\\/.exec(path)?.[0] ?? "";
  return (
    prefix +
    path
      .slice(prefix.length)
      .split(/([\\/])/)
      .map((part, index) =>
        index === 0 && /^[A-Za-z]:$/.test(part) ? part : part.replace(/:.*$/, ""),
      )
      .join("")
  );
}

function realpathLoose(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(realpathLoose(parent), basename(path));
  }
}
