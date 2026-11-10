import { type Result, hostFor } from "./adapters/host.js";
import * as shared from "./hook/shared.js";
import { setLanguage, bilingual, veridName } from "./adapters/i18n.js";
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
import { taskSessions, planned, type Roles, type Manifest } from "./core/manifest.js";
import { isUnder, decide } from "./core/policy.js";
import {
  fileRole,
  type AutoLock,
  decideTdd,
  type TddDecision,
  TDD_STRICTNESS,
  type Cycle,
} from "./core/tdd.js";
import { relative, dirname, resolve, isAbsolute } from "node:path";
import { kanbanSessionProblem, statusLine, observe, advance, tryClose } from "./hook/lifecycle.js";
import {
  researchMissing,
  specMissing,
  designMissing,
  autoFactsOf,
  menuLines,
  peekLines,
  readPlan,
  servedSections,
  planViews,
} from "./adapters/plan-file.js";
import {
  type PolicyDecision,
  type RuleCode,
  isOverridable,
  ERROR_CODES,
  type ErrorCode,
} from "./core/errors.js";
import { decideDispatch, decideAgentContext, decideKnownTool } from "./core/dispatch.js";
import { decideInstructions } from "./adapters/instruction-protection.js";
import { matchesGlob } from "./core/glob.js";
import { roleAdvice, type Writer, ROLE_DOCUMENTS } from "./core/roles.js";
import { consumeOverride, recordDenial, parseVeridPrompt, handlePrompt } from "./core/override.js";
import {
  autoPhase,
  progressKey,
  stopHolds,
  LIMIT,
  autoNextStep,
  securityOf,
  type AutoPhase,
} from "./core/auto.js";
import { subagentStart, subagentStop } from "./hook/review.js";
import { claimTaskSession } from "./core/kanban.js";
import { openModule } from "./core/plan.js";
import { auditWarnings, auditLines } from "./adapters/rule-audit.js";
import { type State } from "./core/state.js";
import { randomInt } from "node:crypto";

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
      const result = await lifecycle(p);
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

async function userPrompt(p: z.infer<typeof userPromptSchema>): Promise<Result> {
  // A host with no attended-input signal (Codex) never opens an exception from a prompt, and
  // peek and menu stay in the terminal. Every prompt still gets the research reminder.
  const attended = shared.host().attended();
  const cmd = attended === null ? { kind: "none" as const } : parseVeridPrompt(p.prompt);
  const project = shared.projectDir(p.cwd);
  const paths = statePaths(project);
  if (cmd.kind === "none") {
    const halted = shared.haltedBy(paths);
    if (halted) return { exit: 0, stdout: shared.haltedLines(halted) };
    // Until research.md says what the project is, every prompt reminds the agent to ask first.
    const manifest = await loadManifest(project);
    if (!manifest || !researchMissing(project, manifest.mode)) return { exit: 0 };
    const reminder = [
      `verid: mode ${manifest.mode} · research missing`,
      bilingual("menu.research", {}),
    ];
    return { exit: 0, stdout: `${reminder.join("\n")}\n` };
  }
  if (cmd.kind === "peek" || cmd.kind === "menu") {
    // Shown as a blocked prompt: stderr reaches the developer only, and the agent spends no turn.
    const state = readState(paths);
    const manifest = await loadManifest(project);
    const lines =
      cmd.kind === "menu" && manifest
        ? menuLines(project, manifest.mode, state, manifest.roles, manifest.drive, manifest)
        : peekLines(
            project,
            manifest?.mode ?? null,
            state,
            manifest?.roles,
            manifest?.drive,
            manifest ?? undefined,
          );
    return { exit: 2, stderr: `${lines.join("\n")}\n` };
  }
  return withLock(paths, () => {
    const state = readState(paths);
    const r = handlePrompt(state, cmd, {
      session: p.session_id,
      attended: attended === true,
      agentId: p.agent_id,
      now: new Date().toISOString(),
      newCode: newCode(),
    });
    if (r.audit) appendAudit(paths.audit, r.audit);
    if (r.state !== state) writeState(paths, r.state);
    const o = r.outcome;
    if (o.kind === "pass") return { exit: 0 };
    // block: stderr reaches the developer only; context: stdout is added to the agent's context.
    // Only an error has a code to show; the risk warning is a message.
    const tag = (ERROR_CODES as readonly string[]).includes(o.key) ? `verid [${o.key}]\n` : "";
    return o.kind === "block"
      ? { exit: 2, stderr: `${tag}${bilingual(o.key, o.params)}\n` }
      : { exit: 0, stdout: `${bilingual(o.key, o.params)}\n` };
  });
}

async function lifecycle(p: z.infer<typeof lifecycleSchema>): Promise<Result> {
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
  const { tdd } = readState(paths);
  const event = p.hook_event_name === "Stop" ? "stop" : "session_start";
  withLock(paths, () => appendAudit(paths.audit, { event, session: p.session_id }));
  const manifest = await loadManifest(project);
  if (!manifest) return { exit: 0 };
  let taskContext: string[] = [];
  if (planned(manifest))
    taskContext.push(
      "verid: module dossiers in .verid/artifacts/03-modules/<name> are required before order. Read .verid/workflow.md; use verid board for priorities.",
    );
  if (planned(manifest) && manifest.drive === "auto")
    taskContext.push(
      "verid: AI drive follows the developer's priority queue in one session. Finish the current task before moving to the next.",
    );
  if (taskSessions(manifest)) {
    const key = shared.sessionKey(p.session_id);
    const kanban = withLock(paths, () => {
      const state = readState(paths);
      const kanban =
        p.hook_event_name === "SessionStart"
          ? claimTaskSession(state.kanban, key, p.source === "startup")
          : state.kanban;
      if (kanban !== state.kanban) writeState(paths, { ...state, kanban });
      return kanban;
    });
    const problem = kanbanSessionProblem(project, { ...readState(paths), kanban }, key, manifest);
    taskContext.push(
      problem
        ? `verid: ${problem}`
        : `verid: task ${kanban.active!.module}; ONE TASK PER SESSION. Read its plan section and log; TDD → review → developer serve → STOP. Never start another task in this session.`,
    );
    if (p.hook_event_name === "Stop" && problem) return { exit: 0 };
  }
  const { mode } = manifest;
  const line = (cycle: Cycle) => statusLine(mode, cycle, tdd.last_run);
  if (event === "stop") {
    const held = manifest.drive === "auto" ? autoStop(p, project, paths, manifest) : null;
    if (held) return held;
    // Each stop is held at most once: Claude Code sets stop_hook_active on the stop that follows
    // a hold, which always goes through.
    if (p.stop_hook_active) return { exit: 0 };
    // Evidence before claims: the last run failed, a test still cannot load, or no run shows the
    // latest change, so the work is not done.
    if (tdd.state === "COOKING" || tdd.stub || tdd.dirty) {
      withLock(paths, () =>
        appendAudit(paths.audit, { event: "stop_blocked", session: p.session_id }),
      );
      const why =
        tdd.state === "COOKING" ? "stop.green" : tdd.stub ? "stop.stub" : "stop.unverified";
      return { exit: 2, stderr: `${line(tdd)}\n${bilingual(why, {})}\n` };
    }
    if (mode === "remix") return { exit: 0 };
    // The open module asks for a passing test per AC, and once they all pass, for an evaluation
    // before the developer serves it. Either hold is once per conversation, shared, and state
    // remembers which one, since a conversation may stop many times.
    return withLock(paths, () => {
      const state = readState(paths);
      const plan = readPlan(
        project,
        manifest.iterations !== undefined,
        planned(manifest),
        servedSections(state),
      );
      const views = plan?.ok ? planViews(project, plan, state) : [];
      const open = openModule(views);
      if (!open || state.ac_stop_session === p.session_id) return { exit: 0 };
      const cooking = open.phase === "cooking";
      // Audit first: if it fails, state is untouched and the hold is not remembered.
      appendAudit(paths.audit, {
        event: "stop_blocked",
        session: p.session_id,
        reason: cooking ? "uncovered" : "evaluate",
        module: open.name,
      });
      writeState(paths, { ...state, ac_stop_session: p.session_id });
      const why = cooking
        ? bilingual("stop.uncovered", { acs: open.uncovered.join(", ") })
        : bilingual("stop.evaluate", { module: open.name, ...shared.mappedNames(manifest.roles) });
      return { exit: 2, stderr: `${line(tdd)}\n${why}\n` };
    });
  }
  if (manifest.drive === "auto") observe(project, paths, manifest);
  // A new conversation is a new task, and new behaviour needs a failing test first: a finished
  // cycle starts over in RAW. Resuming or compacting goes on with the same work.
  let cycle: Cycle = tdd;
  if (
    !taskSessions(manifest) &&
    tdd.state === "PLATED" &&
    (p.source === "startup" || p.source === "clear")
  ) {
    const event = { session: p.session_id, tool: "SessionStart", target: p.source };
    shared.move(paths, event, { reopen: true, written: false });
    cycle = { state: "RAW", stub: false };
  }
  // SessionStart stdout goes into the agent's context: with the gate on, the agent learns the
  // cycle before its first write rather than from its first denial.
  const { roles } = manifest;
  const agents = shared.mappedNames(roles);
  const standing = menuLines(
    project,
    mode,
    readState(paths),
    roles,
    manifest.drive,
    manifest,
    undefined,
    shared.host().singleWriter,
  );
  // Session context is an index, not a second copy of the full menu or skill instructions.
  // Keep its size independent of the number of modules, questions and audit findings.
  const next = standing.at(-1)!;
  const command = veridName();
  // The open module's log carries the last session's decisions into this one.
  const open = shared.loggedModule(project, manifest, readState(paths));
  const log = open ? [`verid: log .verid/log/${open}.md`, bilingual("session.log", {})] : [];
  if (p.source === "resume") {
    const alias = command !== "verid" && next.includes(command) ? `verid = ${command}\n` : "";
    const logged = log.map((text) => `${text}\n`).join("");
    return {
      exit: 0,
      stdout: `${line(cycle)}\n${alias}${taskContext.map((text) => `${text}\n`).join("")}${logged}${next.replaceAll(command, "verid")}\n`,
    };
  }
  return {
    exit: 0,
    stdout: [
      line(cycle),
      ...taskContext,
      ...(command === "verid" ? [] : [`verid = ${command}`]),
      // Which agent to dispatch for each role, read from the manifest now: the instruction block
      // carries the skill guide and the workflow, but only cook and upgrade rewrite it. The mode's
      // own walk-through is in no block.
      ...(roles && !shared.host().singleWriter
        ? [
            `verid: roles ${Object.entries(agents)
              .filter(
                ([role]) =>
                  roles[role as keyof Roles] || ["reviewer", "tester", "coder"].includes(role),
              )
              .map(([role, names]) => `${role} ${names}`)
              .join(" · ")}`,
          ]
        : []),
      bilingual(`mode.${mode}`, {}),
      ...(shared.host().singleWriter
        ? [
            bilingual(
              shared.host().id === "antigravity"
                ? "session.single_writer_antigravity"
                : "session.single_writer",
              { reviewer: agents.reviewer, security: agents.security },
            ),
          ]
        : []),
      ...(manifest.drive === "auto" ? [bilingual("drive.auto", {})] : []),
      standing[0]!,
      ...standing.filter((text) => /(?:^|\n)  iteration /.test(text)),
      bilingual("session.menu", {}),
      ...log,
      next,
      "",
    ]
      .map((text) => (text.startsWith("verid = ") ? text : text.replaceAll(command, "verid")))
      .join("\n"),
  };
}

/**
 * Stop in an auto drive the developer signed; null before that, for the human holds. The open
 * module is served if it is ready, then every stop is held with the next step until the drive is
 * done or stuck, or waits on the developer: for a module's merge, or for Git to allow its branch.
 * stop_hook_active does not matter here: a hold that finds the outcome unchanged counts as no
 * progress, and the LIMIT-th in a row leaves the drive stuck and lets the agent go. A wait is not
 * a hold and never counts.
 */
function autoStop(
  p: z.infer<typeof lifecycleSchema>,
  project: string,
  paths: StatePaths,
  manifest: Manifest,
): Result | null {
  return withLock(paths, () => {
    let state = readState(paths);
    if (state.auto.signed === null) return null;
    let facts = autoFactsOf(project, state, manifest.iterations !== undefined, planned(manifest));
    const session = p.session_id;
    state = latchBlocked(paths, state, facts.blockedFile, session);
    state = advance(project, paths, state, { ...facts, auto: state.auto }, manifest);
    facts = { ...facts, auto: state.auto };
    const before = autoPhase(facts);
    const warnings = auditWarnings(project, manifest, state);
    const tried = tryClose(project, paths, state, facts, manifest, warnings);
    const closed = tried !== state && before.kind === "module" ? before.view.name : null;
    state = advance(
      project,
      paths,
      tried,
      { ...facts, auto: tried.auto, approvals: tried.modules },
      manifest,
    );
    facts = { ...facts, auto: state.auto, approvals: state.modules };
    let phase = autoPhase(facts);

    if (!over(phase)) {
      const served = Object.entries(state.modules)
        .filter(([, a]) => a.served_at !== null)
        .map(([m]) => m);
      const key = progressKey({
        tdd: state.tdd,
        planHash: facts.planHash,
        auto: state.auto,
        served,
        head: null,
      });
      state = { ...state, auto: { ...state.auto, ...stopHolds(state.auto, key) } };
      // Audit first, on either path: if it fails, state is untouched and the hold is not counted.
      if (state.auto.stop_holds >= LIMIT) {
        appendAudit(paths.audit, { event: "auto_stuck", session, reason: "no_progress" });
        phase = autoPhase({ ...facts, auto: state.auto });
      }
    }
    const step = autoNextStep(
      phase,
      facts.researchHash !== null,
      facts.designHash !== null,
      state.review,
      securityOf(state, manifest.roles),
      facts.specHash !== null,
    );
    const lines = [
      statusLine(manifest.mode, state.tdd, state.tdd.last_run),
      ...auditLines(project, manifest, state, false, warnings),
      ...(closed === null ? [] : [bilingual("auto.closed", { module: closed })]),
      bilingual(step.key, { ...shared.mappedNames(manifest.roles), ...step.params }),
    ].join("\n");
    // The agent may stop, and the developer sees why.
    if (over(phase)) {
      writeState(paths, state);
      return { exit: 0, stdout: JSON.stringify({ systemMessage: lines }) };
    }
    appendAudit(paths.audit, { event: "stop_blocked", session, reason: "auto", step: step.key });
    writeState(paths, state);
    return { exit: 2, stderr: `${lines}\n` };
  });
}

/** Only stuck and finished drives let the agent stop. */
const over = (phase: AutoPhase): boolean => ["stuck", "done"].includes(phase.kind);

/** Whether there is a blocked.md to latch: the drive is signed and not blocked already. */
const toLatch = (state: State, blocked: string | null): blocked is string =>
  blocked !== null && state.auto.signed !== null && state.auto.blocked === null;

/**
 * blocked.md latched into state the first time a hook sees it: deleting the file does not resume
 * the drive, only `verid order` does. The state as given when there is nothing to latch. Audits
 * the latch; the caller writes the state, under the lock.
 */
function latchBlocked(
  paths: StatePaths,
  state: State,
  blocked: string | null,
  session: string,
): State {
  if (!toLatch(state, blocked)) return state;
  appendAudit(paths.audit, { event: "auto_stuck", session, reason: "blocked" });
  return { ...state, auto: { ...state.auto, blocked } };
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

// No 0/O/1/I so the code is easy to read back and type.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}
