import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { mcpAccess, mcpPaths } from "../core/policy.js";
import { fileAction, type PreToolUse } from "./claude-code.js";
import { shellFiles } from "./codex.js";
import type { Host, HostAction, Result } from "./host.js";
import { VeridError } from "./state-store.js";

/**
 * Google Antigravity. Its hooks name the event in argv (`--event PreToolUse`) and send camelCase
 * payloads: `conversationId`, `workspacePaths`, `toolCall: { name, args }`, `lastUserInput`.
 * Each becomes the event verid already judges for Claude Code, so the same rules, TDD gate and
 * review binding apply. The main agent is the single writer, as on Codex; the read-only roles
 * run as subagents through `invoke_subagent`.
 */
const EVENTS: Record<string, string> = {
  SessionStart: "SessionStart",
  PreInvocation: "UserPromptSubmit",
  PreToolUse: "PreToolUse",
  PostToolUse: "PostToolUse",
  Stop: "Stop",
};
export const ANTIGRAVITY_EVENTS = Object.keys(EVENTS);

const SOURCES = new Set(["startup", "resume", "clear", "compact"]);

// Antigravity's file tools, by the verid action each one is.
const WRITE_TOOLS = new Set(["write_to_file", "write_file", "create_file"]);
const EDIT_TOOLS = new Set(["replace_file_content", "multi_replace_file_content", "edit_file"]);
const READ_TOOLS = new Set(["view_file", "read_file", "view_file_outline", "view_code_item"]);
const SEARCH_TOOLS = new Set(["grep_search", "codebase_search"]);
const LIST_TOOLS = new Set(["find_by_name", "list_dir"]);
// Input typed into a running command: verid never sees what that command does with it.
const SHELL_INPUT_TOOLS = new Set(["send_command_input"]);
const PATH_ARGS = ["TargetFile", "Path", "AbsolutePath", "File", "file_path", "path"];

type Payload = Record<string, unknown>;

export function antigravityHost(event: string | undefined): Host {
  const internal = event === undefined ? undefined : EVENTS[event];
  // Set once events() finds the project; output() needs them for the stop marker.
  let project = "";
  let session = "";
  return {
    id: "antigravity",
    singleWriter: true,
    // A person types every PreInvocation input, so /verid tip and /verid confirm work in chat.
    overrides: true,
    ...(internal ? { event: internal } : {}),
    events(payload) {
      if (!internal)
        throw new VeridError("VERID_BURNT_PAYLOAD", {
          detail: `unknown Antigravity event ${event ?? "(none)"}`,
        });
      const p = record(payload, "payload");
      const found = veridProject(p.workspacePaths);
      if (found === null) return [];
      project = found;
      session = text(p.conversationId, "conversationId");
      const base = { session_id: session, cwd: project };
      switch (event) {
        case "SessionStart":
          return [
            {
              hook_event_name: "SessionStart",
              ...base,
              source: typeof p.source === "string" && SOURCES.has(p.source) ? p.source : "startup",
            },
          ];
        case "PreInvocation": {
          const prompt = typeof p.lastUserInput === "string" ? p.lastUserInput : "";
          // Antigravity asks again before each model call of a turn; only its first is the prompt.
          if (!newTurn(project, session, p.executionNum, prompt)) return [];
          return [{ hook_event_name: "UserPromptSubmit", ...base, prompt }];
        }
        case "Stop":
          return [
            {
              hook_event_name: "Stop",
              ...base,
              stop_hook_active: readTurn(project, session).held,
            },
          ];
        case "PreToolUse":
          return toolEvents(toolCall(p), base, project);
        default: {
          // PostToolUse: only a finished subagent matters, as its report.
          const call = toolCall(p);
          if (call.name !== "invoke_subagent") return [];
          const type = subagentType(call.args);
          const report = verdictReport([p.toolResult, p.result, p.output, p.response, call]);
          if (!type || report === null) return [];
          return [
            {
              hook_event_name: "SubagentStop",
              ...base,
              agent_id: agentId(call, type),
              agent_type: type,
              last_assistant_message: report,
              stop_hook_active: false,
            },
          ];
        }
      }
    },
    projectDir: (cwd) => project || cwd,
    attended: () => true,
    action: antigravityAction,
    output(_internal, result) {
      if (event === "Stop" && result.exit === 2 && project)
        writeTurn(project, session, { ...readTurn(project, session), held: true });
      return antigravityOutput(event, result);
    },
    promptFailed: (code) => ({ exit: 0, stderr: `verid [${code}]\n` }),
  };
}

/** The nearest folder holding `.verid`, from each workspace root; null for any other workspace. */
function veridProject(roots: unknown): string | null {
  const starts = [...(Array.isArray(roots) ? roots : []), process.cwd()].filter(
    (root): root is string => typeof root === "string" && root !== "",
  );
  for (const start of starts)
    for (let dir = resolve(start); ; dir = dirname(dir)) {
      if (existsSync(join(dir, ".verid"))) return dir;
      if (dirname(dir) === dir) break;
    }
  return null;
}

interface Call {
  name: string;
  args: Payload;
  id?: string;
}

function toolCall(p: Payload): Call {
  const call = record(p.toolCall, "toolCall");
  const args = call.args === undefined ? {} : record(call.args, "toolCall.args");
  return {
    name: text(call.name, "toolCall.name"),
    args,
    ...(typeof call.id === "string" && call.id !== "" ? { id: call.id } : {}),
  };
}

/** The PreToolUse verid judges, and for a subagent the start of its review job once allowed. */
function toolEvents(call: Call, base: { session_id: string; cwd: string }, project: string) {
  const { name, args } = call;
  const pre = (tool_name: string, tool_input: Payload, cwd = project) => ({
    hook_event_name: "PreToolUse",
    ...base,
    cwd,
    tool_name,
    tool_input,
  });
  const path = firstText(args, PATH_ARGS) ?? "";
  if (WRITE_TOOLS.has(name)) {
    const content = args.CodeContent ?? args.Content ?? args.content;
    return [pre("Write", { file_path: path, ...(typeof content === "string" && { content }) })];
  }
  if (EDIT_TOOLS.has(name)) return [pre("Edit", { file_path: path })];
  if (READ_TOOLS.has(name)) return [pre("Read", { file_path: path })];
  if (SEARCH_TOOLS.has(name) || LIST_TOOLS.has(name)) {
    const dir = firstText(args, ["SearchPath", "SearchDirectory", "DirectoryPath", "path"]);
    return [pre(SEARCH_TOOLS.has(name) ? "Grep" : "Glob", dir === undefined ? {} : { path: dir })];
  }
  if (name === "run_command") {
    const cwd = firstText(args, ["Cwd", "cwd"]);
    const command = args.CommandLine ?? args.command;
    return [
      pre(
        "Bash",
        typeof command === "string" ? { command } : {},
        cwd === undefined ? project : resolve(project, cwd),
      ),
    ];
  }
  if (name === "invoke_subagent") {
    const type = subagentType(args) ?? "";
    const prompt = firstText(args, ["Prompt", "prompt", "Task", "task"]);
    return [
      pre("Agent", { subagent_type: type, ...(prompt !== undefined && { prompt }) }),
      // The review snapshot is taken only once the dispatch is allowed.
      ...(type
        ? [
            {
              hook_event_name: "SubagentStart",
              ...base,
              agent_id: agentId(call, type),
              agent_type: type,
            },
          ]
        : []),
    ];
  }
  if (name === "call_mcp_tool") {
    const server = firstText(args, ["ServerName", "server"]) ?? "mcp";
    const tool = firstText(args, ["ToolName", "tool"]) ?? "tool";
    const input = args.Arguments ?? args.arguments;
    return [
      pre(
        `mcp__${server}__${tool}`,
        input !== null && typeof input === "object" && !Array.isArray(input)
          ? (input as Payload)
          : {},
      ),
    ];
  }
  return [pre(name, args)];
}

const CLAUDE_TOOLS = new Set(["Write", "Edit", "Read", "Grep", "Glob", "Agent"]);

/**
 * The shell is read as sh and as PowerShell (Antigravity runs PowerShell on Windows). A tool
 * verid has no mapping for is judged by its name and the paths its arguments name, as MCP tools
 * are; one whose name says it writes, with no path verid can find, is refused.
 */
export function antigravityAction(p: PreToolUse): HostAction | null {
  if (p.tool_name === "Bash") {
    const command = p.tool_input.command;
    if (typeof command !== "string" || command === "")
      throw new VeridError("VERID_BURNT_PAYLOAD", { detail: "run_command without CommandLine" });
    const shell = shellFiles(command, p.cwd);
    return {
      action: { kind: "bash", command },
      files: shell.files,
      ...(shell.unsupported ? { unsupported: shell.unsupported } : {}),
    };
  }
  if (CLAUDE_TOOLS.has(p.tool_name) || p.tool_name.startsWith("mcp__")) return null;
  if (SHELL_INPUT_TOOLS.has(p.tool_name))
    return {
      action: { kind: "other", tool: p.tool_name },
      files: [],
      unsupported: p.tool_name,
    };
  const access = mcpAccess(p.tool_name);
  const paths = [...new Set(mcpPaths(p.tool_input))];
  return {
    action: { kind: "other", tool: p.tool_name },
    files: paths.map((path) => fileAction(p.tool_name, access, path, p.cwd)),
    ...(access === "write" && paths.length === 0 ? { unknownTool: p.tool_name } : {}),
  };
}

/** verid's answer in the shape each Antigravity hook reads. */
function antigravityOutput(event: string | undefined, result: Result): Result {
  const json = (value: unknown): Result => ({ exit: 0, stdout: `${JSON.stringify(value)}\n` });
  const said = (value: string | undefined) => (value ?? "").trim();
  const inject = (systemMessage: string) =>
    json({ injectSteps: [{ systemMessage: { systemMessage } }] });
  switch (event) {
    case "PreToolUse":
      return result.exit === 0
        ? json({ decision: "allow" })
        : json({ decision: "deny", reason: said(result.stderr) || "verid [VERID_BURNT_INTERNAL]" });
    case "Stop":
      return result.exit === 0
        ? json({ decision: "allow" })
        : json({ decision: "continue", reason: said(result.stderr) || "verid" });
    case "SessionStart":
      return said(result.stdout) ? inject(said(result.stdout)) : json({});
    case "PreInvocation": {
      // A blocked prompt is shown to the developer only and ends the turn: no model call is spent.
      if (result.exit === 2)
        return json({
          injectSteps: [{ errorMessage: { userMessage: said(result.stderr) } }],
          terminationBehavior: "terminate",
        });
      const out = said(result.stdout);
      return out ? inject(systemText(out)) : json({});
    }
    default:
      return json({});
  }
}

function systemText(out: string): string {
  try {
    const parsed = JSON.parse(out) as { systemMessage?: unknown };
    if (typeof parsed?.systemMessage === "string") return parsed.systemMessage;
  } catch {
    // Plain text context.
  }
  return out;
}

const subagentType = (args: Payload): string | undefined =>
  firstText(args, ["TypeName", "typeName", "subagent_type", "AgentName", "agentName"]);

/** Ties a subagent's start to its stop: the call ID, or its type within this conversation. */
const agentId = (call: Call, type: string): string => `agy:${call.id ?? type}`;

/** The first text found in these places that ends with a verdict line, as the review report. */
function verdictReport(places: unknown[]): string | null {
  const VERDICT = /(?:^|\n)[ \t*_#>-]*Verdict:\s*(?:pass|fail)\b[^\n]*\s*$/i;
  const seen = new Set<unknown>();
  const find = (value: unknown, depth: number): string | null => {
    if (typeof value === "string")
      return VERDICT.test(value.replace(/\r/g, "").trimEnd()) ? value.trim() : null;
    if (depth > 6 || value === null || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    for (const item of Array.isArray(value) ? value : Object.values(value)) {
      const hit = find(item, depth + 1);
      if (hit !== null) return hit;
    }
    return null;
  };
  for (const place of places) {
    const hit = find(place, 0);
    if (hit !== null) return hit;
  }
  return null;
}

// Per conversation: the last turn whose prompt verid handled, and whether a stop was held since.
interface Turn {
  turn: string | null;
  held: boolean;
}
const turnFile = (project: string, session: string) =>
  join(
    project,
    ".verid",
    ".state",
    "antigravity",
    `${createHash("sha256").update(session).digest("hex").slice(0, 32)}.json`,
  );

function readTurn(project: string, session: string): Turn {
  try {
    const t = JSON.parse(readFileSync(turnFile(project, session), "utf8")) as Partial<Turn>;
    return { turn: typeof t.turn === "string" ? t.turn : null, held: t.held === true };
  } catch {
    return { turn: null, held: false };
  }
}

function writeTurn(project: string, session: string, turn: Turn): void {
  const file = turnFile(project, session);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(turn)}\n`);
}

/**
 * Whether this PreInvocation starts a new turn: another execution, or another prompt. A new turn
 * also ends a held stop, so the stop after a hold goes through once, as on Claude Code.
 */
function newTurn(project: string, session: string, execution: unknown, prompt: string): boolean {
  const id = `${typeof execution === "number" || typeof execution === "string" ? execution : ""}:${createHash("sha256").update(prompt).digest("hex")}`;
  if (readTurn(project, session).turn === id) return false;
  writeTurn(project, session, { turn: id, held: false });
  return true;
}

function record(value: unknown, where: string): Payload {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new VeridError("VERID_BURNT_PAYLOAD", { detail: `${where}: expected object` });
  return value as Payload;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string" || value === "")
    throw new VeridError("VERID_BURNT_PAYLOAD", { detail: `${where}: expected string` });
  return value;
}

function firstText(args: Payload, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}
