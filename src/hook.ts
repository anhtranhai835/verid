import { randomInt } from "node:crypto";
import type * as z from "zod/mini";
import {
  isOverridable,
  RULE_CODES,
  type ErrorCode,
  type MessageKey,
  type RuleCode,
} from "./core/errors.js";
import { consumeOverride, handlePrompt, parseVeridPrompt, recordDenial } from "./core/override.js";
import { decide } from "./core/policy.js";
import { decideTdd } from "./core/tdd.js";
import { appendAudit } from "./adapters/audit-log.js";
import {
  inputHash,
  lifecycleSchema,
  policyContext,
  preToolUseSchema,
  projectDir,
  toAction,
  userPromptSchema,
} from "./adapters/claude-code.js";
import { bilingual, t, type Lang } from "./adapters/i18n.js";
import { loadManifest, tddLayout } from "./adapters/manifest.js";
import {
  readState,
  statePaths,
  VeridError,
  withLock,
  writeState,
  type StatePaths,
} from "./adapters/state-store.js";

/**
 * Single entry for PreToolUse, UserPromptSubmit, Stop and SessionStart.
 * exit 0 = allow, exit 2 = block (reason on stderr). PreToolUse fails closed;
 * UserPromptSubmit lets the prompt through on error but never creates an override;
 * Stop and SessionStart never block.
 */
interface Result {
  exit: 0 | 2;
  stdout?: string;
  stderr?: string;
}

const LENIENT = new Set(["Stop", "SubagentStop", "SessionStart"]);

async function main(): Promise<void> {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  // Only for routing errors when the payload is not even JSON.
  let event = /"hook_event_name"\s*:\s*"(\w+)"/.exec(raw)?.[1];
  let result: Result;
  try {
    const payload = parseJson(raw);
    event = (payload as { hook_event_name?: string } | null)?.hook_event_name ?? event;
    result = await handle(payload);
  } catch (err) {
    result = onError(event, err);
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exit;
}

async function handle(payload: unknown): Promise<Result> {
  switch ((payload as { hook_event_name?: unknown } | null)?.hook_event_name) {
    case "PreToolUse":
      return preToolUse(parse(preToolUseSchema, payload));
    case "UserPromptSubmit":
      return userPrompt(parse(userPromptSchema, payload));
    case "Stop":
    case "SessionStart":
      return lifecycle(parse(lifecycleSchema, payload));
    default:
      throw new VeridError("VERID_E_PAYLOAD", { detail: "unknown hook_event_name" });
  }
}

async function preToolUse(p: z.infer<typeof preToolUseSchema>): Promise<Result> {
  const project = projectDir(p.cwd);
  const paths = statePaths(project);
  const action = toAction(p);
  if ("invalid" in action) throw new VeridError("VERID_E_PAYLOAD", { detail: action.invalid });
  let decision = decide(action, policyContext(project));
  if (decision.kind === "allow") {
    const state = readState(paths); // no usable state → nothing is allowed
    // The TDD gate needs the manifest only for file writes; no manifest = Phase 0 behaviour.
    if (action.kind !== "file" || action.access !== "write") return { exit: 0 };
    const manifest = await loadManifest(project);
    if (!manifest) return { exit: 0 };
    const tdd = decideTdd(action, state.tdd.state, tddLayout(project, manifest));
    if (tdd.kind === "reopen")
      reopen(paths, { session: p.session_id, tool: p.tool_name, target: action.display });
    if (tdd.kind !== "deny") return { exit: 0 };
    decision = tdd;
  }

  const now = new Date().toISOString();
  const key = {
    session: p.session_id,
    tool: p.tool_name,
    input_hash: inputHash(p.tool_input),
    rule: decision.code,
  };
  return withLock(paths, () => {
    const state = readState(paths);
    const used = consumeOverride(state, key, now);
    // Audit first: if it fails, state is untouched and the action stays denied.
    if (used) {
      appendAudit(paths.audit, { event: "override_used", ...key, target: decision.target });
      writeState(paths, used);
      return { exit: 0 };
    }
    appendAudit(paths.audit, { event: "denied", ...key, target: decision.target });
    writeState(paths, recordDenial(state, { ...key, target: decision.target, at: now }));
    return deny(decision.code, { target: decision.target });
  });
}

/** A test changed after it was watched failing: it must be watched failing again. */
function reopen(paths: StatePaths, event: { session: string; tool: string; target: string }): void {
  withLock(paths, () => {
    const state = readState(paths);
    if (state.tdd.state === "RED") return; // a concurrent hook got here first
    appendAudit(paths.audit, { event: "tdd_reopened", ...event, from: state.tdd.state });
    writeState(paths, { ...state, tdd: { ...state.tdd, state: "RED" } });
  });
}

function userPrompt(p: z.infer<typeof userPromptSchema>): Result {
  const cmd = parseVeridPrompt(p.prompt);
  if (cmd.kind === "none") return { exit: 0 };
  const paths = statePaths(projectDir(p.cwd));
  return withLock(paths, () => {
    const state = readState(paths);
    const r = handlePrompt(state, cmd, {
      session: p.session_id,
      // Set by Claude Code itself: 1 only when a person is at the terminal (spike S2).
      attended: process.env.CLAUDE_CODE_SESSION_ATTENDED === "1",
      agentId: p.agent_id,
      now: new Date().toISOString(),
      newCode: newCode(),
    });
    if (r.audit) appendAudit(paths.audit, r.audit);
    if (r.state !== state) writeState(paths, r.state);
    const o = r.outcome;
    if (o.kind === "pass") return { exit: 0 };
    // block: stderr reaches the developer only; context: stdout is added to the agent's context.
    return o.kind === "block"
      ? { exit: 2, stderr: `verid [${o.key}]\n${bilingual(o.key, o.params)}\n` }
      : { exit: 0, stdout: `${bilingual(o.key, o.params)}\n` };
  });
}

function lifecycle(p: z.infer<typeof lifecycleSchema>): Result {
  const paths = statePaths(projectDir(p.cwd));
  readState(paths);
  const event = p.hook_event_name === "Stop" ? "stop" : "session_start";
  withLock(paths, () => appendAudit(paths.audit, { event, session: p.session_id }));
  return { exit: 0 };
}

function onError(event: string | undefined, err: unknown): Result {
  const code: ErrorCode = err instanceof VeridError ? err.code : "VERID_E_INTERNAL";
  const params =
    err instanceof VeridError
      ? err.params
      : { detail: err instanceof Error ? err.message : String(err) };
  if (event && LENIENT.has(event)) return { exit: 0, stderr: `verid [${code}]\n` };
  if (event === "UserPromptSubmit")
    return {
      exit: 0,
      stdout: JSON.stringify({ systemMessage: bilingual("prompt.hook_failed", { detail: code }) }),
    };
  return deny(code, params);
}

function deny(code: ErrorCode, params: Record<string, string>): Result {
  const rule = (RULE_CODES as readonly string[]).includes(code) ? (code as RuleCode) : undefined;
  const hint: MessageKey | undefined = rule
    ? isOverridable(rule)
      ? "hint.overridable"
      : "hint.not_overridable"
    : undefined;
  const line = (lang: Lang) =>
    `${lang}: ${t(lang, code, params)}${hint ? ` ${t(lang, hint, params)}` : ""}`;
  return { exit: 2, stderr: `verid [${code}]\n${line("vi")}\n${line("en")}\n` };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new VeridError("VERID_E_PAYLOAD", { detail: "not JSON" });
  }
}

function parse<S extends z.ZodMiniType>(schema: S, payload: unknown): z.infer<S> {
  const r = schema.safeParse(payload);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  throw new VeridError("VERID_E_PAYLOAD", {
    detail: issue ? `${issue.path.join(".") || "payload"}: ${issue.message}` : "invalid",
  });
}

// No 0/O/1/I so the code is easy to read back and type.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

await main();
