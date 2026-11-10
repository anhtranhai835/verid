import { type Result, hostFor } from "./adapters/host.js";
import * as shared from "./hook/shared.js";
import { setLanguage } from "./adapters/i18n.js";
import { preToolUse } from "./hook/pre-tool-use.js";
import { preToolUseSchema, userPromptSchema, lifecycleSchema } from "./adapters/claude-code.js";
import { userPrompt, lifecycle } from "./hook/lifecycle.js";
import { VeridError, languageOf, statePaths } from "./adapters/state-store.js";
import { type ErrorCode } from "./core/errors.js";
import { subagentStart, subagentStop } from "./hook/review.js";

/**
 * Single entry for tool, prompt, session and subagent lifecycle hooks.
 * exit 0 = allow, exit 2 = block (reason on stderr). PreToolUse fails closed;
 * UserPromptSubmit lets the prompt through on error but never creates an override;
 * Stop, SubagentStop and SessionStart never block on error.
 */
const LENIENT = new Set(["Stop", "SubagentStart", "SubagentStop", "SessionStart"]);

/** `dist/hook.js`: one payload from stdin, the result on stdout, stderr and the exit code. */
export async function main(): Promise<void> {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  const result = await run(raw, process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exit;
}

/** The whole hook for one payload, with the hook's arguments; tests call it in process. */
export async function run(raw: string, args: readonly string[]): Promise<Result> {
  const chosen = hostFor(args);
  shared.setHost(chosen.host);
  // A payload that names no project gets both languages, as in a fresh process.
  setLanguage(null);
  // Only for routing errors when the payload is not even JSON.
  let event = shared.host().event ?? /"hook_event_name"\s*:\s*"(\w+)"/.exec(raw)?.[1];
  let result: Result;
  try {
    if (chosen.error) throw chosen.error;
    const [payload, ...after] = shared.host().events(shared.parseJson(raw));
    if (payload === undefined) result = { exit: 0 };
    else {
      event = (payload as { hook_event_name?: string } | null)?.hook_event_name ?? event;
      result = await handle(payload);
      // What follows the call (a subagent's review job) only once verid lets it through.
      if (result.exit === 0) for (const next of after) await handle(next).catch(() => undefined);
    }
  } catch (err) {
    result = onError(event, err);
  }
  return shared.host().output(event, result);
}

async function handle(payload: unknown): Promise<Result> {
  switch ((payload as { hook_event_name?: unknown } | null)?.hook_event_name) {
    case "PreToolUse":
      return preToolUse(inProject(shared.parse(preToolUseSchema, payload)));
    case "UserPromptSubmit":
      return userPrompt(inProject(shared.parse(userPromptSchema, payload)));
    case "Stop":
    case "SubagentStart":
    case "SubagentStop":
    case "SessionStart": {
      const p = inProject(shared.parse(lifecycleSchema, payload));
      const project = shared.projectDir(p.cwd);
      const paths = statePaths(project);
      // Halted, no agent is held back and none is told to go on: the developer has the wheel.
      const halted = shared.haltedBy(paths);
      if (halted)
        return p.hook_event_name === "SessionStart"
          ? { exit: 0, stdout: shared.haltedLines(halted) }
          : { exit: 0 };
      if (p.hook_event_name === "SubagentStart") return subagentStart(p);
      if (p.hook_event_name === "SubagentStop") return subagentStop(p);
      const result = await lifecycle(p, project, paths);
      return result;
    }
    default:
      throw new VeridError("VERID_BURNT_PAYLOAD", { detail: "unknown hook_event_name" });
  }
}

/**
 * Messages follow the language chosen on this machine, once a valid payload names the project;
 * a payload it cannot read gets both languages.
 */
function inProject<P extends { cwd: string }>(payload: P): P {
  setLanguage(languageOf(shared.projectDir(payload.cwd)));
  return payload;
}

function onError(event: string | undefined, err: unknown): Result {
  const code: ErrorCode = err instanceof VeridError ? err.code : "VERID_BURNT_INTERNAL";
  const params =
    err instanceof VeridError
      ? err.params
      : { detail: err instanceof Error ? err.message : String(err) };
  // Codex continues every held Stop, so a hold on error would never end there either.
  if (event && LENIENT.has(event)) return { exit: 0, stderr: `verid [${code}]\n` };
  if (event === "UserPromptSubmit") return shared.host().promptFailed(code);
  return shared.deny(code, params);
}
