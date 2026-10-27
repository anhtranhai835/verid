import { createHash, randomInt } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import type * as z from "zod/mini";
import {
  autoNextStep,
  autoPhase,
  closeReady,
  securityOf,
  coderRoundsAfter,
  LIMIT,
  parseVerdict,
  progressKey,
  stopHolds,
  type AutoFacts,
  type AutoPhase,
} from "./core/auto.js";
import {
  ERROR_CODES,
  isOverridable,
  RULE_CODES,
  type ErrorCode,
  type MessageKey,
  type PolicyDecision,
  type RuleCode,
} from "./core/errors.js";
import type { State } from "./core/state.js";
import type { Manifest, Roles } from "./core/manifest.js";
import { consumeOverride, handlePrompt, parseVeridPrompt, recordDenial } from "./core/override.js";
import { modulePhases, openModule } from "./core/plan.js";
import { decide, isUnder } from "./core/policy.js";
import { decideAgentContext, decideDispatch, decideKnownTool } from "./core/dispatch.js";
import {
  CODEX_TOOLS,
  codexAction,
  codexOutput,
  codexPayload,
  codexProject,
} from "./adapters/codex.js";
import { checkedRepos, contentsOf, type Contents } from "./adapters/architecture.js";
import { decideInstructions } from "./adapters/instruction-protection.js";
import {
  mappedAgents,
  ROLE_DOCUMENTS,
  splitOn,
  singleWriterOf,
  subagentHold,
  writerOf,
  type Writer,
} from "./core/roles.js";
import {
  cycleHint,
  cycleLabel,
  decideTdd,
  keyId,
  TDD_STRICTNESS,
  type Cycle,
  type TddDecision,
} from "./core/tdd.js";
import { appendAudit } from "./adapters/audit-log.js";
import { notifyAutoPlugins } from "./adapters/plugin-events.js";
import {
  bashWrites,
  inputHash,
  mcpFiles,
  lifecycleSchema,
  normalizePath,
  policyContext,
  preToolUseSchema,
  projectDir as claudeProjectDir,
  toAction,
  userPromptSchema,
  writtenPath,
  type FileAction,
} from "./adapters/claude-code.js";
import { gitTree } from "./adapters/git.js";
import { bilingual, inLanguage, setLanguage, t, type Lang } from "./adapters/i18n.js";
import { loadManifest, tddLayouts } from "./adapters/manifest.js";
import {
  architectureOf,
  autoFactsOf,
  designMissing,
  evidenceOf,
  menuLines,
  peekLines,
  readPlan,
  researchMissing,
} from "./adapters/plan-file.js";
import {
  languageOf,
  readState,
  statePaths,
  VeridError,
  withLock,
  writeReview,
  writeState,
  type StatePaths,
} from "./adapters/state-store.js";

/**
 * Single entry for PreToolUse, UserPromptSubmit, Stop, SubagentStop and SessionStart.
 * exit 0 = allow, exit 2 = block (reason on stderr). PreToolUse fails closed;
 * UserPromptSubmit lets the prompt through on error but never creates an override;
 * Stop, SubagentStop and SessionStart never block on error.
 */
interface Result {
  exit: 0 | 2;
  stdout?: string;
  stderr?: string;
}

const LENIENT = new Set(["Stop", "SubagentStop", "SessionStart"]);
// Provider selection is an explicit invocation contract, never inferred from stdin.
// ponytail: one module-wide flag set by each run(); overlapping runs in one process would race.
let CODEX = false;
const projectDir = (cwd: string) => (CODEX ? codexProject : claudeProjectDir)(cwd);
const writerFor: typeof writerOf = (...args) => (CODEX ? singleWriterOf : writerOf)(...args);
const splitFor = (roles: Roles | undefined) => !CODEX && splitOn(roles);
const mappedNames = (roles: Roles | undefined) => mappedAgents(roles, CODEX);

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
  CODEX = args[0] === "--provider" && args[1] === "codex";
  // A payload that names no project gets both languages, as in a fresh process.
  setLanguage(null);
  // Only for routing errors when the payload is not even JSON.
  let event = /"hook_event_name"\s*:\s*"(\w+)"/.exec(raw)?.[1];
  let result: Result;
  try {
    if (
      args.length !== 0 &&
      !(
        args.length === 2 &&
        args[0] === "--provider" &&
        ["codex", "claude-code"].includes(args[1]!)
      )
    )
      throw new VeridError("VERID_BURNT_PAYLOAD", {
        detail: "expected --provider claude-code|codex",
      });
    const payload = CODEX ? codexPayload(parseJson(raw)) : parseJson(raw);
    event = (payload as { hook_event_name?: string } | null)?.hook_event_name ?? event;
    result = await handle(payload);
  } catch (err) {
    result = onError(event, err);
  }
  return CODEX ? codexOutput(event, result) : result;
}

async function handle(payload: unknown): Promise<Result> {
  if (
    CODEX &&
    ["PostToolUse", "SubagentStart", "SessionEnd"].includes(
      String((payload as { hook_event_name?: unknown })?.hook_event_name),
    )
  )
    return { exit: 0 };
  switch ((payload as { hook_event_name?: unknown } | null)?.hook_event_name) {
    case "PreToolUse":
      return preToolUse(inProject(parse(preToolUseSchema, payload)));
    case "UserPromptSubmit":
      return userPrompt(inProject(parse(userPromptSchema, payload)));
    case "Stop":
    case "SubagentStop":
    case "SessionStart": {
      const p = inProject(parse(lifecycleSchema, payload));
      const result = await lifecycle(p);
      // Only an existing decision reaches the observer; a verid error still follows onError.
      const warnings =
        p.hook_event_name === "SessionStart" ? [] : await notifyAutoPlugins(projectDir(p.cwd));
      return warnings.length
        ? { ...result, stderr: `${result.stderr ?? ""}${warnings.join("\n")}\n` }
        : result;
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
  setLanguage(languageOf(projectDir(payload.cwd)));
  return payload;
}

async function preToolUse(p: z.infer<typeof preToolUseSchema>): Promise<Result> {
  const project = projectDir(p.cwd);
  const paths = statePaths(project);
  const adapted = CODEX ? codexAction(p) : null;
  const action = adapted?.action ?? toAction(p);
  if ("invalid" in action) throw new VeridError("VERID_BURNT_PAYLOAD", { detail: action.invalid });
  // The files this call touches beyond the action itself: what a Bash command plainly writes,
  // or the paths an MCP tool names.
  const files: FileAction[] =
    adapted?.files ?? (action.kind === "bash" ? bashWrites(action.command, p.cwd) : mcpFiles(p));
  const writes = [...(action.kind === "file" ? [action] : []), ...files].filter(
    (f) => f.access === "write",
  );
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
  const dispatch = await (async () => {
    const manifest = [
      "Skill",
      "Agent",
      "Task",
      ...(CODEX ? ["collaborationspawn_agent"] : []),
    ].includes(p.tool_name)
      ? await loadManifest(project)
      : null;
    return (lifted: ReadonlySet<RuleCode>) => {
      const dispatched =
        CODEX && p.tool_name === "collaborationspawn_agent"
          ? decideDispatch(
              "Agent",
              { ...p.tool_input, subagent_type: p.tool_input.agent_type },
              manifest,
              lifted,
            )
          : decideDispatch(p.tool_name, p.tool_input, manifest, lifted);
      if (dispatched.kind === "deny") return dispatched;
      return CODEX && p.tool_name === "collaborationspawn_agent"
        ? decideAgentContext(p.tool_input.agent_type, p.tool_input.fork_turns, [
            // The read-only roles start fresh, so they judge the diff, not the writer's reasoning.
            ...(manifest?.roles?.reviewer ?? []),
            ...(manifest?.roles?.security ?? []),
          ])
        : dispatched;
    };
  })().catch((err: unknown) => (): never => {
    throw err;
  });
  // The policy rules on every action, then the role rules and the TDD gate on the writes, once
  // the rules the developer has allowed are lifted. An override covers one rule, so a rule still
  // denying needs its own. Undefined: nothing denies and no code or test is written.
  const judge = (lifted: ReadonlySet<RuleCode>): Deny | Judged | undefined => {
    const policy = strictest([action, ...files].map((a) => decide(a, ctx, lifted)));
    if (policy.kind === "deny") return policy;
    if (CODEX) {
      const known = decideKnownTool(p.tool_name, CODEX_TOOLS);
      if (known.kind === "deny") return known;
      if (adapted?.invalidPatch)
        return {
          kind: "deny",
          code: "VERID_BURNT_PATCH_UNSUPPORTED",
          target: adapted.invalidPatch,
          reason: "unreadable patch",
        };
      if (adapted?.unsupported)
        return {
          kind: "deny",
          code: "VERID_BURNT_SHELL_UNSUPPORTED",
          target: adapted.unsupported,
          reason: "unreadable shell",
        };
    }
    const instructions = decideInstructions(p, writes, project, lifted);
    if (instructions.kind === "deny") return instructions;
    const dispatched = dispatch(lifted);
    if (dispatched.kind === "deny") return dispatched;
    const gated = gate.judge(lifted);
    return gated?.tdd.kind === "deny" ? gated.tdd : gated;
  };
  // A write of code or a test is a change like any other; an unfrozen test reopens RAW.
  const event = (j: Judged): CycleEvent => ({
    session: p.session_id,
    tool: p.tool_name,
    target: j.write.display,
  });
  const change = (j: Judged): Move => ({
    reopen: j.tdd.kind === "reopen",
    written: true,
    writer: p.agent_id,
  });
  const first = judge(new Set());
  if (first === undefined || "write" in first) {
    if (first) move(paths, event(first), change(first));
    // Only a pass to void is written, so other writes never wait on the state lock.
    else if (voidsSecurity && readState(paths).security !== null)
      withLock(paths, () => writeState(paths, withoutSecurity(readState(paths))));
    return { exit: 0 };
  }

  const now = new Date().toISOString();
  const call = { session: p.session_id, tool: p.tool_name, input_hash: inputHash(p.tool_input) };
  return withLock(paths, () => {
    let state = readState(paths);
    let denied = first;
    const lifted = new Set<RuleCode>();
    for (;;) {
      const key = { ...call, rule: denied.code };
      const used = CODEX ? null : consumeOverride(state, key, now);
      if (!used) {
        appendAudit(paths.audit, { event: "denied", ...key, target: denied.target });
        writeState(paths, recordDenial(state, { ...key, target: denied.target, at: now }));
        return deny(denied.code, { ...gate.names, target: denied.target });
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
      if (rest) state = moved(paths, state, event(rest), change(rest));
      else if (voidsSecurity) state = withoutSecurity(state);
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
      ? autoFactsOf(project, state, manifest.iterations !== undefined)
      : null;
  // A write is judged before it runs, so a Bash `rm .verid/blocked.md` latches the file first.
  if (facts !== null && toLatch(state, facts.blockedFile))
    withLock(paths, () =>
      writeState(paths, latchBlocked(paths, readState(paths), facts.blockedFile, p.session_id)),
    );
  const auto = facts === null ? null : autoPhase(facts);
  const planApproved =
    manifest.mode === "remix" || (auto ? auto.kind === "module" : hasOpenModule(project, state));
  const stuck = auto?.kind === "stuck";
  const who = {
    writer: writerFor(p.agent_id, p.agent_type, manifest.roles),
    split: splitFor(manifest.roles),
  };
  const judge = (
    approved: boolean,
    by: (w: FileAction) => Who = () => who,
    locked = stuck,
  ): Judged[] =>
    writes.flatMap((w) => {
      const asWritten = { ...w, path: writtenPath(resolve(p.cwd, w.display)) };
      const drive = auto ? { stuck: locked } : undefined;
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
      // Judged again with the lock off, not passed(): a test the stuck lock denied still meets the
      // frozen cycle, and one that reopens it still does.
      const unlocked = stuck && lifted.has("VERID_BURNT_AUTO_STUCK");
      const again = planLifted || unlocked || writes.some(roleLifted);
      const base = again
        ? judge(
            planLifted || planApproved,
            (w) => (roleLifted(w) ? ANYONE : who),
            stuck && !unlocked,
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
    ...mappedNames(roles),
    document: ROLE_DOCUMENTS[writerFor(agentId, agentType, roles)] ?? "—",
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

interface CycleEvent {
  session: string;
  tool: string;
  target: string;
}
/**
 * `reopen`: a test changed or a new task began; `written`: production code or a test changed;
 * `writer`: the subagent that wrote it, held at its stop until a run shows the change.
 */
interface Move {
  reopen: boolean;
  written: boolean;
  writer?: string | undefined;
}

function move(paths: StatePaths, event: CycleEvent, change: Move): void {
  withLock(paths, () => writeState(paths, moved(paths, readState(paths), event, change)));
}

/**
 * rev moves on so a `verid taste` already running cannot count as evidence for what changed.
 * Written files need a run before the agent stops; a changed test must be watched failing, so the
 * cycle goes (or stays) RAW.
 */
function moved(paths: StatePaths, state: State, event: CycleEvent, change: Move): State {
  // Audit only real changes of state: test writes in RAW are routine.
  if (change.reopen && state.tdd.state !== "RAW")
    appendAudit(paths.audit, { event: "tdd_reopened", ...event, from: state.tdd.state });
  const tdd = { ...state.tdd, rev: state.tdd.rev + 1 };
  if (change.reopen) tdd.state = "RAW";
  if (change.written) tdd.dirty = true;
  const writers =
    change.writer === undefined || state.writers.includes(change.writer)
      ? state.writers
      : [...state.writers, change.writer];
  // A review covers the code it read: a change after it needs another, and so does a security review.
  return { ...state, tdd, writers, ...(change.written && { review: null, security: null }) };
}

const withoutSecurity = (state: State): State =>
  state.security === null ? state : { ...state, security: null };

async function userPrompt(p: z.infer<typeof userPromptSchema>): Promise<Result> {
  // Codex has no attended-input signal: a prompt never opens an exception there, and peek and
  // menu stay in the terminal. Every prompt still gets the research reminder.
  const cmd = CODEX ? { kind: "none" as const } : parseVeridPrompt(p.prompt);
  const project = projectDir(p.cwd);
  const paths = statePaths(project);
  if (cmd.kind === "none") {
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
    // Only an error has a code to show; the risk warning is a message.
    const tag = (ERROR_CODES as readonly string[]).includes(o.key) ? `verid [${o.key}]\n` : "";
    return o.kind === "block"
      ? { exit: 2, stderr: `${tag}${bilingual(o.key, o.params)}\n` }
      : { exit: 0, stdout: `${bilingual(o.key, o.params)}\n` };
  });
}

async function lifecycle(p: z.infer<typeof lifecycleSchema>): Promise<Result> {
  if (p.hook_event_name === "SubagentStop") return subagentStop(p);
  const project = projectDir(p.cwd);
  const paths = statePaths(project);
  const { tdd } = readState(paths);
  const event = p.hook_event_name === "Stop" ? "stop" : "session_start";
  withLock(paths, () => appendAudit(paths.audit, { event, session: p.session_id }));
  const manifest = await loadManifest(project);
  if (!manifest) return { exit: 0 };
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
      const plan = readPlan(project);
      const views = plan?.ok
        ? modulePhases(plan.modules, plan.hashes, state.modules, evidenceOf(project, state))
        : [];
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
        : bilingual("stop.evaluate", { module: open.name, ...mappedNames(manifest.roles) });
      return { exit: 2, stderr: `${line(tdd)}\n${why}\n` };
    });
  }
  // A new conversation is a new task, and new behaviour needs a failing test first: a finished
  // cycle starts over in RAW. Resuming or compacting goes on with the same work.
  let cycle: Cycle = tdd;
  if (tdd.state === "PLATED" && (p.source === "startup" || p.source === "clear")) {
    const event = { session: p.session_id, tool: "SessionStart", target: p.source };
    move(paths, event, { reopen: true, written: false });
    cycle = { state: "RAW", stub: false };
  }
  // SessionStart stdout goes into the agent's context: with the gate on, the agent learns the
  // cycle before its first write rather than from its first denial.
  const { roles } = manifest;
  const agents = mappedNames(roles);
  return {
    exit: 0,
    stdout: [
      line(cycle),
      bilingual("session.intro", {}),
      // Which agent to dispatch for each role: the hook holds each to its own files.
      ...(roles && !CODEX
        ? [
            `verid: roles ${Object.entries(agents)
              .filter(
                ([role]) =>
                  roles[role as keyof Roles] || ["reviewer", "tester", "coder"].includes(role),
              )
              .map(([role, names]) => `${role} ${names}`)
              .join(" · ")}`,
            bilingual("session.roles", {}),
            ...Object.entries(ROLE_DOCUMENTS).flatMap(([role, document]) =>
              roles[role as keyof Roles] ? [bilingual("session.drafter", { role, document })] : [],
            ),
            ...(roles.qa ? [bilingual("session.qa", {})] : []),
          ]
        : []),
      bilingual(`mode.${mode}`, {}),
      ...(CODEX ? [bilingual("session.single_writer", { reviewer: agents.reviewer })] : []),
      ...(manifest.drive === "auto" ? [bilingual("drive.auto", {})] : []),
      bilingual(cycleHint(cycle), {}),
      // Where the project stands and the next step, as `verid menu` shows them.
      ...menuLines(
        project,
        mode,
        readState(paths),
        roles,
        manifest.drive,
        manifest,
        undefined,
        CODEX,
      ),
      "",
    ].join("\n"),
  };
}

const statusLine = (mode: string, cycle: Cycle, lastRun: string | null) =>
  `verid: TDD ${cycleLabel(cycle)} · mode ${mode} · last run ${lastRun ?? "none"}`;

/**
 * Stop in an auto drive the developer signed; null before that, for the human holds. The open
 * module is served if it is ready, then every stop is held with the next step until the drive is
 * done or stuck. stop_hook_active does not matter here: a hold that finds the outcome unchanged
 * counts as no progress, and the LIMIT-th in a row leaves the drive stuck and lets the agent go.
 */
function autoStop(
  p: z.infer<typeof lifecycleSchema>,
  project: string,
  paths: StatePaths,
  manifest: Manifest,
): Result | null {
  const contents = contentsBefore(project, paths, manifest);
  return withLock(paths, () => {
    let state = readState(paths);
    if (state.auto.signed === null) return null;
    let facts = autoFactsOf(project, state, manifest.iterations !== undefined);
    const session = p.session_id;
    state = latchBlocked(paths, state, facts.blockedFile, session);
    facts = { ...facts, auto: state.auto };
    const before = autoPhase(facts);
    const next = tryClose(project, paths, state, facts, manifest, contents);
    const closed = next !== state && before.kind === "module" ? before.view.name : null;
    state = next;
    facts = { ...facts, auto: state.auto, approvals: state.modules };
    let phase = autoPhase(facts);
    let git: ReturnType<typeof gitTree> | null = null;
    if (!over(phase)) {
      git = gitTree(project, manifest, state.auto.signed);
      const served = Object.entries(state.modules)
        .filter(([, a]) => a.served_at !== null)
        .map(([m]) => m);
      const key = progressKey({
        tdd: state.tdd,
        planHash: facts.planHash,
        auto: state.auto,
        served,
        head: git?.head ?? null,
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
      git?.clean ?? null,
      securityOf(state, manifest.roles),
      phase.kind === "module" && phase.view.phase === "evaluating"
        ? architectureOf(project, manifest, state, contents)
        : [],
    );
    const lines = [
      statusLine(manifest.mode, state.tdd, state.tdd.last_run),
      ...(closed === null ? [] : [bilingual("auto.closed", { module: closed })]),
      bilingual(step.key, { ...mappedNames(manifest.roles), ...step.params }),
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

/**
 * Each configured repo's files, read before the state lock is taken so a long walk never holds
 * it, and only while the auto drive's module could close; {} otherwise, which no check passes.
 */
function contentsBefore(project: string, paths: StatePaths, manifest: Manifest): Contents {
  if (manifest.drive !== "auto" || checkedRepos(manifest).length === 0) return {};
  const phase = autoPhase(
    autoFactsOf(project, readState(paths), manifest.iterations !== undefined),
  );
  return phase.kind === "module" && phase.view.phase === "evaluating"
    ? contentsOf(project, manifest)
    : {};
}

/** Stuck or done: the drive has nothing left for the agent, so Stop lets it go. */
const over = (phase: AutoPhase): boolean => phase.kind === "stuck" || phase.kind === "done";

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

/**
 * An auto drive serves its open module itself once closeReady holds, recorded as `verid serve`
 * records it, and the next module starts its review and coder loops from zero. The state as given
 * when the module is not ready. Audits the close; the caller writes the state, under the lock.
 */
function tryClose(
  project: string,
  paths: StatePaths,
  state: State,
  facts: AutoFacts,
  manifest: Manifest,
  contents: Contents,
): State {
  const phase = autoPhase(facts);
  if (phase.kind !== "module" || !facts.plan?.ok) return state;
  const { view } = phase;
  const clean = gitTree(project, manifest, state.auto.signed).clean;
  const architecture =
    view.phase === "evaluating" ? architectureOf(project, manifest, state, contents) : [];
  const security = securityOf(state, manifest.roles);
  if (!closeReady(view, state.tdd, state.review, clean, security, architecture)) return state;
  const now = new Date().toISOString();
  appendAudit(paths.audit, { event: "module_served", module: view.name, by: "auto" });
  const approval = {
    sha256: facts.plan.hashes[view.name] as string,
    acs: view.acs,
    at: now,
    served_at: now,
    design_sha256: facts.designHash,
  };
  return {
    ...state,
    modules: { ...state.modules, [view.name]: approval },
    review: null,
    security: null,
    auto: { ...state.auto, module_reviews: 0, security_reviews: 0, coder_rounds: {} },
  };
}

/**
 * A subagent that wrote code or a test is held once, as Stop holds the main thread, until a run
 * shows its change; the mapped reviewer is never held, and its final report becomes the review.
 * In an auto drive the coder's stop that goes through also ends a round on the module it builds.
 */
async function subagentStop(p: z.infer<typeof lifecycleSchema>): Promise<Result> {
  const project = projectDir(p.cwd);
  const manifest = await loadManifest(project);
  if (!manifest) return { exit: 0 };
  const paths = statePaths(project);
  const writer = writerFor(p.agent_id, p.agent_type, manifest.roles);
  const auto = manifest.drive === "auto";
  if (writer === "reviewer" || writer === "security") {
    if (manifest.mode !== "remix") recordReview(p, project, paths, auto, manifest, writer);
    return { exit: 0 };
  }
  const agentId = p.agent_id;
  if (agentId === undefined) return { exit: 0 };
  return withLock(paths, () => {
    const state = readState(paths);
    // An agent that wrote nothing is never held, but its stop still ends the coder's round.
    const wrote = state.writers.includes(agentId);
    const why =
      wrote && !p.stop_hook_active
        ? subagentHold(writer, splitFor(manifest.roles), state.tdd)
        : null;
    if (why) {
      appendAudit(paths.audit, {
        event: "subagent_stop_blocked",
        session: p.session_id,
        agent_id: agentId,
        agent_type: p.agent_type,
      });
      const line = statusLine(manifest.mode, state.tdd, state.tdd.last_run);
      return { exit: 2, stderr: `${line}\n${bilingual(why, {})}\n` };
    }
    const rounds =
      auto && writer === "coder"
        ? coderRounds(project, paths, state, p, manifest.iterations !== undefined)
        : null;
    if (!wrote && rounds === null) return { exit: 0 };
    writeState(paths, {
      ...state,
      writers: state.writers.filter((a) => a !== agentId),
      ...(rounds && { auto: { ...state.auto, coder_rounds: rounds } }),
    });
    return { exit: 0 };
  });
}

/**
 * The rounds each AC has had once a coder's stop goes through, or null when no module is being
 * built. Audits the ACs that gained one; the caller writes the state, under the lock.
 */
function coderRounds(
  project: string,
  paths: StatePaths,
  state: State,
  p: z.infer<typeof lifecycleSchema>,
  iterations: boolean,
): Record<string, number> | null {
  if (autoPhase(autoFactsOf(project, state, iterations)).kind !== "module") return null;
  const { failing, crashed, passed_acs } = state.tdd;
  const before = state.auto.coder_rounds;
  const after = coderRoundsAfter(before, [...failing.map(keyId), ...crashed], passed_acs);
  const acs = Object.entries(after)
    .filter(([ac, n]) => n > (before[ac] ?? 0))
    .map(([ac]) => ac);
  if (acs.length > 0)
    appendAudit(paths.audit, { event: "coder_round", session: p.session_id, acs });
  return after;
}

/**
 * The mapped reviewer's final report becomes a review. verid writes it, not the agent, under
 * .state where no agent reads or writes. A human drive reviews the open module. An auto drive
 * reviews its plan until the plan passes, then the module it is building; in any other phase
 * there is nothing to review. Remix has no module to review. The security reviewer's report is
 * recorded the same way, under its own name, and never reviews the plan.
 */
function recordReview(
  p: z.infer<typeof lifecycleSchema>,
  project: string,
  paths: StatePaths,
  auto: boolean,
  manifest: Manifest,
  kind: "reviewer" | "security",
): void {
  const report = p.last_assistant_message ?? "";
  const sha256 = createHash("sha256").update(report, "utf8").digest("hex");
  const verdict = parseVerdict(report);
  // Only a pass can close the module, so only a pass is worth the walk inside this hook's timeout.
  const contents = verdict === "pass" ? contentsBefore(project, paths, manifest) : {};
  withLock(paths, () => {
    const state = readState(paths);
    const facts = auto ? autoFactsOf(project, state, manifest.iterations !== undefined) : null;
    const phase = facts === null ? null : autoPhase(facts);
    const module =
      phase === null
        ? openModuleName(project, state)
        : phase.kind === "module"
          ? phase.view.name
          : undefined;
    const at = new Date().toISOString();
    const saved = (subject: string) => {
      const name = `${subject}-${at.replace(/[:.]/g, "-")}.md`;
      return { name, file: relative(project, join(paths.reviews, name)) };
    };
    const who = { session: p.session_id, agent_type: p.agent_type, agent_id: p.agent_id };
    // Audit first, then the report, then state: a failure on the way leaves the old review.
    if (kind === "reviewer" && phase?.kind === "plan") {
      const { name, file } = saved("plan");
      // A plan auto cannot run does not pass, whatever the reviewer says.
      const passed = verdict === "pass" && !phase.missing && phase.problem === null;
      const hash = passed ? (facts?.planHash ?? null) : null;
      appendAudit(paths.audit, { event: "plan_reviewed", ...who, sha256, verdict, file });
      writeReview(paths, name, report);
      const { auto: now } = state;
      // A module review read the plan as it was: once a changed plan passes, it needs another.
      writeState(paths, {
        ...state,
        ...(hash === null
          ? { auto: { ...now, plan_reviews: now.plan_reviews + 1 } }
          : {
              auto: { ...now, plan_sha256: hash, plan_reviews: 0 },
              review: null,
              security: null,
            }),
      });
      return;
    }
    if (!module) return;
    const security = kind === "security";
    const { name, file } = saved(security ? `security-${module}` : module);
    const event = security ? "security_recorded" : "review_recorded";
    appendAudit(paths.audit, { event, ...who, module, sha256, verdict, file });
    writeReview(paths, name, report);
    const recorded = { module, agent_type: p.agent_type ?? "", file, sha256, at, verdict };
    const failures = security ? "security_reviews" : "module_reviews";
    const next: State = {
      ...state,
      ...(security ? { security: recorded } : { review: recorded }),
      ...(auto &&
        verdict !== "pass" && {
          auto: { ...state.auto, [failures]: state.auto[failures] + 1 },
        }),
    };
    // A pass on a committed tree serves the module now, not at the agent's next stop.
    writeState(
      paths,
      facts
        ? tryClose(project, paths, next, { ...facts, auto: next.auto }, manifest, contents)
        : next,
    );
  });
}

/** A missing or broken plan has no open module, so production code stays locked. */
function hasOpenModule(project: string, state: State): boolean {
  return openModuleName(project, state) !== undefined;
}

function openModuleName(project: string, state: State): string | undefined {
  const plan = readPlan(project);
  if (!plan?.ok) return undefined;
  const views = modulePhases(plan.modules, plan.hashes, state.modules, evidenceOf(project, state));
  return openModule(views)?.name;
}

function onError(event: string | undefined, err: unknown): Result {
  const code: ErrorCode = err instanceof VeridError ? err.code : "VERID_BURNT_INTERNAL";
  const params =
    err instanceof VeridError
      ? err.params
      : { detail: err instanceof Error ? err.message : String(err) };
  // Codex continues every held Stop, so a hold on error would never end there either.
  if (event && LENIENT.has(event)) return { exit: 0, stderr: `verid [${code}]\n` };
  if (event === "UserPromptSubmit")
    return CODEX
      ? { exit: 0, stderr: `verid [${code}]\n` }
      : {
          exit: 0,
          stdout: JSON.stringify({
            systemMessage: bilingual("prompt.hook_failed", { detail: code }),
          }),
        };
  return deny(code, params);
}

function deny(code: ErrorCode, params: Record<string, string>): Result {
  const rule = (RULE_CODES as readonly string[]).includes(code) ? (code as RuleCode) : undefined;
  const hint: MessageKey | undefined =
    rule && !CODEX
      ? isOverridable(rule)
        ? "hint.overridable"
        : "hint.not_overridable"
      : undefined;
  const line = (lang: Lang) => `${t(lang, code, params)}${hint ? ` ${t(lang, hint, params)}` : ""}`;
  return { exit: 2, stderr: `verid [${code}]\n${inLanguage(line)}\n` };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new VeridError("VERID_BURNT_PAYLOAD", { detail: "not JSON" });
  }
}

function parse<S extends z.ZodMiniType>(schema: S, payload: unknown): z.infer<S> {
  const r = schema.safeParse(payload);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  throw new VeridError("VERID_BURNT_PAYLOAD", {
    detail: issue ? `${issue.path.join(".") || "payload"}: ${issue.message}` : "invalid",
  });
}

// No 0/O/1/I so the code is easy to read back and type.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}
