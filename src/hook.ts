import { type Result, hostFor } from "./adapters/host.js";
import * as shared from "./hook/shared.js";
import { setLanguage } from "./adapters/i18n.js";
import {
  preToolUseSchema,
  userPromptSchema,
  lifecycleSchema,
  toAction,
  type FileAction,
  bashWrites,
  mcpFiles,
  normalizePath,
  writtenPath,
  policyContext,
  inputHash,
} from "./adapters/claude-code.js";
import {
  userPrompt,
  lifecycle,
  kanbanSessionProblem,
  toLatch,
  latchBlocked,
} from "./hook/lifecycle.js";
import {
  VeridError,
  languageOf,
  statePaths,
  withLock,
  readState,
  writeState,
  type StatePaths,
} from "./adapters/state-store.js";
import type * as z from "zod/mini";
import { appendAudit } from "./adapters/audit-log.js";
import { loadManifest, tddLayouts } from "./adapters/manifest.js";
import { taskSessions, planned, type Roles } from "./core/manifest.js";
import { isUnder, decide } from "./core/policy.js";
import {
  fileRole,
  type AutoLock,
  decideTdd,
  type TddDecision,
  TDD_STRICTNESS,
} from "./core/tdd.js";
import { relative, dirname, resolve, isAbsolute } from "node:path";
import { researchMissing, specMissing, designMissing, autoFactsOf } from "./adapters/plan-file.js";
import {
  type PolicyDecision,
  type RuleCode,
  isOverridable,
  type ErrorCode,
} from "./core/errors.js";
import { decideDispatch, decideAgentContext, decideKnownTool } from "./core/dispatch.js";
import { decideInstructions } from "./adapters/instruction-protection.js";
import { matchesGlob } from "./core/glob.js";
import { roleAdvice, type Writer, ROLE_DOCUMENTS } from "./core/roles.js";
import { consumeOverride, recordDenial } from "./core/override.js";
import { autoPhase } from "./core/auto.js";
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

async function preToolUse(p: z.infer<typeof preToolUseSchema>): Promise<Result> {
  const project = shared.projectDir(p.cwd);
  const paths = statePaths(project);
  // The developer's kill switch comes before every rule, and no /verid tip lifts it.
  const halted = shared.haltedBy(paths);
  if (halted) {
    withLock(paths, () =>
      appendAudit(paths.audit, {
        event: "denied",
        session: p.session_id,
        tool: p.tool_name,
        rule: "VERID_BURNT_HALTED",
        target: halted.reason,
      }),
    );
    return shared.deny("VERID_BURNT_HALTED", { target: halted.reason });
  }
  const adapted = shared.host().action(p);
  const action = adapted?.action ?? toAction(p);
  if ("invalid" in action) throw new VeridError("VERID_BURNT_PAYLOAD", { detail: action.invalid });
  // The files this call touches beyond the action itself: what a Bash command plainly writes,
  // or the paths an MCP tool names.
  const files: FileAction[] =
    adapted?.files ?? (action.kind === "bash" ? bashWrites(action.command, p.cwd) : mcpFiles(p));
  const writes = [...(action.kind === "file" ? [action] : []), ...files].filter(
    (f) => f.access === "write",
  );
  // A broken manifest must still allow reads; existing write gates report its error in order.
  const taskManifest = await loadManifest(project, { readOnly: true }).catch(() => null);
  let taskProblem: string | null = null;
  if (taskManifest && taskSessions(taskManifest)) {
    const key = shared.sessionKey(p.session_id);
    const layouts = tddLayouts(project, taskManifest);
    const guardedWrite = writes.some(
      (write) =>
        !isUnder(write.path, normalizePath(project)) ||
        (write.written !== undefined && !isUnder(write.written, writtenPath(project))) ||
        [
          ...layouts.real.map((layout) => ({ layout, path: write.path })),
          ...layouts.written.map((layout) => ({ layout, path: write.written ?? write.path })),
        ].some(
          ({ layout, path }) =>
            isUnder(path, layout.repoRoot) &&
            fileRole(relative(layout.repoRoot, path).replaceAll("\\", "/"), layout) !== "free",
        ),
    );
    const problem = withLock(paths, () => {
      const state = readState(paths);
      const used = state.kanban.sessions[key];
      // Planning may inspect the repo and write documents before a task is selected.
      if (!state.kanban.active && !used && !guardedWrite) return null;
      return kanbanSessionProblem(project, state, key, taskManifest);
    });
    taskProblem = problem;
  }
  const base = policyContext(project, p.cwd);
  // A security review read the module as it was, dependency, config and .env files included, so
  // any write in the project outside .verid/ needs another. A folder linked from outside the
  // project is in it as written.
  const roots = [normalizePath(project), writtenPath(project)];
  const verid = dirname(base.manifestPath);
  const voidsSecurity = writes.some(
    (w) =>
      roots.some(
        (root) => isUnder(w.path, root) || (w.written !== undefined && isUnder(w.written, root)),
      ) && !isUnder(w.path, verid),
  );
  // The manifest is read for a write to the plan only, so a broken one never blocks reads.
  const planManifest = writes.some((w) => w.path === base.planPath)
    ? await loadManifest(project)
    : null;
  const ctx = planManifest
    ? {
        ...base,
        researchMissing: researchMissing(project, planManifest.mode),
        specMissing: specMissing(project, planManifest.mode),
        designMissing: designMissing(project, planManifest.mode),
      }
    : base;
  // Built before the policy rules are known, but its errors wait: until a call gets past those
  // rules, they decide what it is told.
  const gate = await tddGate(p, project, paths, writes).catch((err: unknown) => ({
    judge: (): never => {
      throw err;
    },
    names: {},
  }));
  // Dispatch now needs the manifest even without file writes. Defer errors until the
  // existing policy has judged the call, preserving its denial priority.
  const advice: PolicyDecision[] = [];
  const spawn = shared.host().spawnTool !== undefined && p.tool_name === shared.host().spawnTool;
  const dispatch = await (async () => {
    const manifest =
      ["Skill", "Agent", "Task"].includes(p.tool_name) || spawn
        ? await loadManifest(project)
        : null;
    return (lifted: ReadonlySet<RuleCode>) => {
      const dispatched = spawn
        ? decideDispatch(
            "Agent",
            { ...p.tool_input, subagent_type: p.tool_input.agent_type },
            manifest,
            lifted,
          )
        : decideDispatch(p.tool_name, p.tool_input, manifest, lifted);
      if (dispatched.kind === "deny") advice.push(dispatched);
      return spawn
        ? decideAgentContext(p.tool_input.agent_type, p.tool_input.fork_turns, [
            // The read-only roles start fresh, so they judge the diff, not the writer's reasoning.
            ...(manifest?.roles?.reviewer ?? []),
            ...(manifest?.roles?.security ?? []),
          ])
        : ({ kind: "allow", reason: "dispatch audited" } as PolicyDecision);
    };
  })().catch((err: unknown) => (): never => {
    throw err;
  });
  // The policy rules on every action, then the role rules and the TDD gate on the writes, once
  // the rules the developer has allowed are lifted. An override covers one rule, so a rule still
  // denying needs its own. Undefined: nothing denies and no code or test is written.
  const judge = (lifted: ReadonlySet<RuleCode>): Deny | Judged | undefined => {
    const rules = [action, ...files].map((a) => decide(a, ctx, lifted));
    const policy = strictest(rules);
    if (policy.kind === "deny") return policy;
    if (shared.host().knownTools) {
      const known = decideKnownTool(p.tool_name, shared.host().knownTools!);
      if (known.kind === "deny") return known;
    }
    if (adapted) {
      if (adapted.unknownTool) {
        const known = decideKnownTool(adapted.unknownTool, []);
        if (known.kind === "deny") return known;
      }
      if (adapted.invalidPatch)
        return {
          kind: "deny",
          code: "VERID_BURNT_PATCH_UNSUPPORTED",
          target: adapted.invalidPatch,
          reason: "unreadable patch",
        };
      if (adapted.unsupported)
        return {
          kind: "deny",
          code: "VERID_BURNT_SHELL_UNSUPPORTED",
          target: adapted.unsupported,
          reason: "unreadable shell",
        };
    }
    const instructions = decideInstructions(p, writes, project, lifted);
    if (instructions.kind === "deny") return instructions;
    if (taskProblem)
      return {
        kind: "deny",
        code: "VERID_BURNT_TASK_SESSION",
        target: taskProblem,
        reason: taskProblem,
      };
    const dispatched = dispatch(lifted);
    if (dispatched.kind === "deny") return dispatched;
    const gated = gate.judge(lifted);
    return gated?.tdd.kind === "deny" ? gated.tdd : gated;
  };
  // A write of code or a test is a change like any other; an unfrozen test reopens RAW.
  const event = (j: Judged): shared.CycleEvent => ({
    session: p.session_id,
    tool: p.tool_name,
    target: j.write.display,
  });
  const change = (j: Judged): shared.Move => ({
    reopen: j.tdd.kind === "reopen",
    written: true,
    writer: p.agent_id,
  });
  const first = judge(new Set());
  for (const w of writes) {
    if (w.path === ctx.planPath) {
      if (ctx.researchMissing)
        advice.push({
          kind: "deny",
          code: "VERID_BURNT_PLAN_NO_RESEARCH",
          target: w.display,
          reason: "plan before research",
        });
      if (ctx.specMissing)
        advice.push({
          kind: "deny",
          code: "VERID_BURNT_PLAN_NO_SPEC",
          target: w.display,
          reason: "plan before spec",
        });
      if (ctx.designMissing)
        advice.push({
          kind: "deny",
          code: "VERID_BURNT_PLAN_NO_DESIGN",
          target: w.display,
          reason: "plan before design",
        });
    }
  }
  if (writes.length && (first === undefined || "write" in first)) {
    const manifest = await loadManifest(project);
    const writer = shared.writerFor(p.agent_id, p.agent_type, manifest?.roles);
    for (const w of writes) {
      const path = relative(project, resolve(p.cwd, w.display)).replaceAll("\\", "/");
      const e2e = manifest?.repos.some((repo) => {
        const rel = relative(resolve(project, repo.path), resolve(p.cwd, w.display)).replaceAll(
          "\\",
          "/",
        );
        return (repo.e2e_globs ?? []).some((glob) => matchesGlob(rel, glob));
      });
      const hint = roleAdvice(writer, e2e ? "e2e" : "free", w.display, path);
      if (hint.kind === "deny") advice.push(hint);
    }
  }
  let auditWarning = "";
  try {
    if (advice.length)
      withLock(paths, () => {
        for (const d of advice)
          if (d.kind === "deny")
            appendAudit(paths.audit, {
              event: "warning",
              code: d.code,
              target: d.target,
              reason: d.reason,
              session: p.session_id,
            });
      });
  } catch (err) {
    auditWarning = `verid: audit unavailable: ${err instanceof Error ? err.message : String(err)}\n`;
  }

  if (first === undefined || "write" in first) {
    if (first) shared.move(paths, event(first), change(first));
    // Only a pass to void is written, so other writes never wait on the state lock.
    else if (voidsSecurity)
      withLock(paths, () => writeState(paths, shared.withoutSecurity(readState(paths))));
    return { exit: 0, ...(auditWarning && { stderr: auditWarning }) };
  }

  const now = new Date().toISOString();
  const call = { session: p.session_id, tool: p.tool_name, input_hash: inputHash(p.tool_input) };
  return withLock(paths, () => {
    let state = readState(paths);
    let denied = first;
    const lifted = new Set<RuleCode>();
    for (;;) {
      const key = { ...call, rule: denied.code };
      const used = shared.host().overrides ? consumeOverride(state, key, now) : null;
      if (!used) {
        appendAudit(paths.audit, { event: "denied", ...key, target: denied.target });
        writeState(paths, recordDenial(state, { ...key, target: denied.target, at: now }));
        const target =
          isAbsolute(denied.target) && isUnder(normalizePath(denied.target), normalizePath(project))
            ? relative(project, denied.target).replaceAll("\\", "/")
            : denied.target;
        return shared.deny(denied.code, { ...gate.names, target });
      }
      lifted.add(denied.code);
      // Before anything is written: a call verid cannot judge stays denied and keeps its override.
      const rest = judge(lifted);
      // Audit first: if it fails, state is untouched and the action stays denied.
      appendAudit(paths.audit, { event: "override_used", ...key, target: denied.target });
      state = used; // spent even when another rule still denies: that one needs its own /verid tip
      if (rest !== undefined && "code" in rest) {
        denied = rest;
        continue;
      }
      if (rest) state = shared.moved(paths, state, event(rest), change(rest));
      else if (voidsSecurity) state = shared.withoutSecurity(state);
      writeState(paths, state);
      return { exit: 0 };
    }
  });
}

type Deny = Extract<PolicyDecision, { kind: "deny" }>;
interface Who {
  writer: Writer;
  split: boolean;
}
const ANYONE: Who = { writer: "main", split: false };

interface Gate {
  /**
   * The role rules and the TDD gate on the writes, once the `lifted` rules no longer deny: the
   * harshest decision, or undefined when none denies and no code or test is written.
   */
  judge: (lifted: ReadonlySet<RuleCode>) => Judged | undefined;
  /** Who made the call and who holds each role, for the role rules' messages. */
  names: Record<string, string>;
}

async function tddGate(
  p: z.infer<typeof preToolUseSchema>,
  project: string,
  paths: StatePaths,
  writes: FileAction[],
): Promise<Gate> {
  const state = readState(paths); // no usable state → nothing is allowed
  // The TDD gate needs the manifest only for writes; no manifest = Phase 0 behaviour.
  const manifest = writes.length > 0 ? await loadManifest(project) : null;
  if (!manifest) return { judge: () => undefined, names: {} };
  const { real, written } = tddLayouts(project, manifest);
  // Production code waits for an open module: approved, not served, its section unchanged since.
  // Remix has no plan. An auto drive opens its modules itself, in plan order, and is stuck when it
  // cannot go on without the developer.
  const facts =
    manifest.drive === "auto"
      ? autoFactsOf(project, state, manifest.iterations !== undefined, planned(manifest))
      : null;
  // A write is judged before it runs, so a Bash `rm .verid/blocked.md` latches the file first.
  if (facts !== null && toLatch(state, facts.blockedFile))
    withLock(paths, () =>
      writeState(paths, latchBlocked(paths, readState(paths), facts.blockedFile, p.session_id)),
    );
  // A branch or a merge is looked for at Stop, SubagentStop and SessionStart only: never in a
  // tool call, whose hook the host lets through once it runs out of time.
  const auto = facts === null ? null : autoPhase(facts);
  const planApproved =
    manifest.mode === "remix" ||
    (auto ? auto.kind === "module" : shared.hasOpenModule(project, state, manifest));
  const lock: AutoLock | null = auto?.kind === "stuck" ? "VERID_BURNT_AUTO_STUCK" : null;
  const who = {
    writer: shared.writerFor(p.agent_id, p.agent_type, manifest.roles),
    split: shared.splitFor(manifest.roles),
  };
  const judge = (
    approved: boolean,
    by: (w: FileAction) => Who = () => who,
    locked = lock,
  ): Judged[] =>
    writes.flatMap((w) => {
      const asWritten = { ...w, path: writtenPath(resolve(p.cwd, w.display)) };
      const drive = auto ? { lock: locked } : undefined;
      return [
        { write: w, tdd: decideTdd(w, state.tdd, real, approved, by(w), drive) },
        { write: w, tdd: decideTdd(asWritten, state.tdd, written, approved, by(w), drive) },
      ];
    });
  const judged = judge(planApproved);
  return {
    judge: (lifted) => {
      // A write whose role rule was allowed is judged as anyone's: the cycle still applies.
      const roleLifted = (w: FileAction) =>
        judged.some(
          (j) =>
            j.write === w &&
            j.tdd.kind === "deny" &&
            j.tdd.code.startsWith("VERID_BURNT_ROLE_") &&
            lifted.has(j.tdd.code),
        );
      const planLifted =
        lifted.has("VERID_BURNT_PLAN_NOT_APPROVED") || lifted.has("VERID_BURNT_AUTO_NO_MODULE");
      // Judged again with the lock off, not passed(): a test the auto lock denied still meets the
      // frozen cycle, and one that reopens it still does.
      const unlocked = lock !== null && lifted.has(lock);
      const again = planLifted || unlocked || writes.some(roleLifted);
      const base = again
        ? judge(
            planLifted || planApproved,
            (w) => (roleLifted(w) ? ANYONE : who),
            unlocked ? null : lock,
          )
        : judged;
      const harsh = harshest(base.map((j) => passed(j, lifted)));
      return harsh.tdd.kind === "allow" ? undefined : harsh;
    },
    names: roleNames(p.agent_id, p.agent_type, manifest.roles),
  };
}

/** The agent type seen (main for the main thread) and the mapped tester and coder, or —. */
function roleNames(
  agentId: string | undefined,
  agentType: string | undefined,
  roles: Roles | undefined,
): Record<string, string> {
  return {
    writer: agentId === undefined ? "main" : (agentType ?? "?"),
    ...shared.mappedNames(roles),
    document: ROLE_DOCUMENTS[shared.writerFor(agentId, agentType, roles)] ?? "—",
  };
}

interface Judged {
  write: FileAction;
  tdd: TddDecision;
}

const harshest = (judged: Judged[]): Judged =>
  judged.reduce((a, b) => (TDD_STRICTNESS[b.tdd.kind] > TDD_STRICTNESS[a.tdd.kind] ? b : a));

/** A rule the developer allowed no longer denies: the write counts as it would without that rule. */
function passed(j: Judged, lifted: ReadonlySet<RuleCode>): Judged {
  if (j.tdd.kind !== "deny" || !lifted.has(j.tdd.code)) return j;
  const kind = j.tdd.code === "VERID_BURNT_TDD_TEST_FROZEN" ? "reopen" : "code";
  return { ...j, tdd: { kind, reason: j.tdd.reason } };
}

/** An invariant beats an overridable rule: overriding the one must not let the other through. */
function strictest(decisions: PolicyDecision[]): PolicyDecision {
  const denies = decisions.filter((d) => d.kind === "deny");
  return (
    denies.find((d) => !isOverridable(d.code)) ??
    denies[0] ??
    decisions[0] ?? { kind: "allow", reason: "nothing to judge" }
  );
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
